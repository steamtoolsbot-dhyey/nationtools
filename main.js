const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const AdmZip = require('adm-zip');
const axios = require('axios');
const { exec } = require('child_process');
const vdf = require('@node-steam/vdf');
const cheerio = require('cheerio');
const sevenBin = require('win-7zip');
const { extractFull } = require('node-7z');
const os = require('os');

// Fix 7z.exe path for packaged builds (asar can't execute native binaries)
let sevenZipPath = sevenBin['7z'];
if (sevenZipPath.includes('app.asar')) {
    sevenZipPath = sevenZipPath.replace('app.asar', 'app.asar.unpacked');
}

const { execSync } = require('child_process');

function getSteamPath() {
    try {
        const result = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath').toString();
        const match = result.match(/SteamPath\s+REG_SZ\s+(.+)/i);
        if (match) {
            return path.normalize(match[1]);
        }
    } catch (e) {}
    return 'C:\\Program Files (x86)\\Steam';
}

let STEAM_DIR = getSteamPath();
const LUA_DIR = path.join(STEAM_DIR, 'config', 'lua');
const DLL_SOURCE = path.join(__dirname, 'dll');

// Downloads Manager Map
const activeDownloads = new Map();
const pendingDownloads = new Map();

let mainWindow;

// Lite Mode preference (stored in userData)
function getLiteModePrefsPath() {
    return path.join(app.getPath('userData'), 'lite-mode.json');
}

function isLiteModeEnabled() {
    try {
        const prefsPath = getLiteModePrefsPath();
        if (fs.existsSync(prefsPath)) {
            const data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
            return data.enabled === true;
        }
    } catch (e) {}
    return false;
}

function createWindow() {
    const liteMode = isLiteModeEnabled();
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: liteMode, // native frame in lite mode, frameless in normal mode
        autoHideMenuBar: true
    });
    mainWindow.maximize();
    mainWindow.loadFile('index.html');
}

ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    }
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });

// Lite Mode IPC handlers
ipcMain.handle('get-lite-mode', () => isLiteModeEnabled());
ipcMain.handle('toggle-lite-mode', (event, enabled) => {
    try {
        fs.writeFileSync(getLiteModePrefsPath(), JSON.stringify({ enabled }), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
});
ipcMain.handle('restart-app', () => {
    // For portable builds, electron-builder sets PORTABLE_EXECUTABLE_FILE
    // to the outer .exe path. app.relaunch() alone would try to relaunch
    // from the temp extraction directory which gets cleaned up.
    const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (portableExe) {
        const { spawn } = require('child_process');
        spawn(portableExe, [], { detached: true, stdio: 'ignore' }).unref();
        app.exit(0);
    } else {
        // Dev mode / non-portable: normal relaunch works fine
        app.relaunch();
        app.exit(0);
    }
});

app.whenReady().then(() => {
    createWindow();
    
    session.defaultSession.on('will-download', (event, item, webContents) => {
        const url = item.getURLChain()[0] || item.getURL();
        
        let downloadId = null;
        const match = url.match(/dlid=([^&]+)/);
        if (match) {
            downloadId = match[1];
        } else if (global.appUpdateUrl && (url === global.appUpdateUrl || item.getFilename().toLowerCase().includes('nation-tools'))) {
            downloadId = 'app_update';
        }
        
        if (!downloadId) return;
        
        const pending = pendingDownloads.get(downloadId);
        
        if (pending) {
            const { targetPath, resolve } = pending;
            item.setSavePath(targetPath);
            
            activeDownloads.set(downloadId, {
                item: item,
                tempPath: targetPath,
                targetPath: targetPath
            });
            
            item.on('updated', (event, state) => {
                if (state === 'progressing') {
                    const received = item.getReceivedBytes();
                    const total = item.getTotalBytes();
                    const progress = total > 0 ? (received / total) * 100 : 0;
                    mainWindow.webContents.send('download-progress', { id: downloadId, progress, type: 'file' });
                }
            });
            
            item.once('done', async (event, state) => {
                activeDownloads.delete(downloadId);
                pendingDownloads.delete(downloadId);
                
                if (state === 'completed') {
                    if (pending.extractTo) {
                        // This is an auto-install fix, so we need to extract it
                        if (mainWindow) {
                            mainWindow.webContents.send('download-progress', { id: downloadId, progress: 100, type: 'extracting' });
                        }
                        try {
                            await new Promise((res, rej) => {
                                const stream = extractFull(targetPath, pending.extractTo, {
                                    $bin: sevenZipPath,
                                    $pass: 'online-fix.me', // Default password for online-fix.me archives
                                    recursive: true
                                });
                                stream.on('end', res);
                                stream.on('error', rej);
                            });
                            fs.unlinkSync(targetPath); // Cleanup zip
                            resolve({ success: true, path: pending.extractTo });
                        } catch (e) {
                            resolve({ success: false, message: `Extraction failed: ${e.message}` });
                        }
                    } else {
                        resolve({ success: true, path: targetPath });
                    }
                } else if (state === 'cancelled') {
                    resolve({ success: false, message: 'Canceled' });
                } else {
                    resolve({ success: false, message: `Download failed: ${state}` });
                }
            });
        }
    });
    
    // Auto Updater
    
    /*
    // Built-in Auto Updater (Buggy with Portable EXEs)
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    
    autoUpdater.on('update-available', (info) => {
        if (mainWindow) mainWindow.webContents.send('update-available', info.version);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
        if (mainWindow) {
            mainWindow.webContents.send('download-progress', {
                id: 'app_update',
                progress: progressObj.percent,
                type: 'app_update'
            });
        }
    });
    
    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow) mainWindow.webContents.send('update-downloaded', info.version);
    });
    
    autoUpdater.checkForUpdatesAndNotify().catch(e => {});
    */
    
    // Custom Portable/Unpacked Updater Fallback
    setTimeout(async () => {
        try {
            const res = await axios.get('https://api.github.com/repos/steamtoolsbot-dhyey/nationtools/releases/latest', {
                headers: { 'User-Agent': 'Nation-Tools' }
            });
            const latestVersion = res.data.tag_name.replace('v', '');
            const currentVersion = app.getVersion();
            
            if (latestVersion !== currentVersion) {
                const exeAsset = res.data.assets.find(a => a.name.endsWith('.exe') && !a.name.includes('Setup'));
                const setupAsset = res.data.assets.find(a => a.name.includes('Setup'));
                const downloadUrl = (exeAsset || setupAsset)?.browser_download_url;
                
                if (downloadUrl && mainWindow) {
                    mainWindow.webContents.send('manual-update-available', {
                        version: latestVersion,
                        url: downloadUrl
                    });
                }
            }
        } catch (e) {
            console.error("Manual update check failed:", e.message);
        }
    }, 3000);
});

// restart-app handler is registered above (Lite Mode section)

// Manual Portable Update Handler
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('install-manual-update', async (event, url) => {
    try {
        const updateFile = path.join(os.tmpdir(), `NationTools_Update_${Date.now()}.exe`);
        
        // Use axios streaming for reliable progress on GitHub redirects
        const response = await axios({
            url: url,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'Nation-Tools' }
        });
        
        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        const writer = fs.createWriteStream(updateFile);
        
        response.data.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0 && mainWindow) {
                const progress = Math.round((receivedBytes / totalBytes) * 100);
                mainWindow.webContents.send('download-progress', { id: 'app_update', progress, type: 'file' });
            }
        });
        
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        // Send 100% complete
        if (mainWindow) {
            mainWindow.webContents.send('download-progress', { id: 'app_update', progress: 100, type: 'file' });
        }
        
        shell.openPath(updateFile);
        app.quit();
        return true;
    } catch (e) {
        console.error("Failed to manual update:", e);
        if (mainWindow) {
            mainWindow.webContents.send('download-progress', { id: 'app_update', progress: -1, type: 'error' });
        }
        return false;
    }
});

// 1. OpenSteamTools Verification & Auto-Install
ipcMain.handle('check-tools-missing', () => {
    try {
        if (!fs.existsSync(STEAM_DIR)) return true;
        const requiredFiles = ['OpenSteamTool.dll', 'dwmapi.dll'];
        return requiredFiles.some(file => !fs.existsSync(path.join(STEAM_DIR, file)));
    } catch (e) {
        return true;
    }
});

ipcMain.handle('check-first-launch', () => {
    try {
        if (!fs.existsSync(STEAM_DIR)) return true;
        const requiredFiles = ['OpenSteamTool.dll', 'dwmapi.dll'];
        return !fs.existsSync(LUA_DIR) || requiredFiles.some(file => !fs.existsSync(path.join(STEAM_DIR, file)));
    } catch (e) {
        return true;
    }
});

ipcMain.handle('install-tools', async () => {
    try {
        if (!fs.existsSync(STEAM_DIR)) {
            return { success: false, message: `Steam directory not found at ${STEAM_DIR}` };
        }
        if (!fs.existsSync(LUA_DIR)) fs.mkdirSync(LUA_DIR, { recursive: true });

        // Close Steam first so DLLs are not locked
        try {
            execSync('taskkill /F /IM steam.exe', { stdio: 'ignore' });
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {} // Steam may not be running

        // Strip read-only attributes on existing proxy DLLs before overwriting
        const proxyDlls = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll', 'winmm.dll'];
        for (const dll of proxyDlls) {
            const dllPath = path.join(STEAM_DIR, dll);
            if (fs.existsSync(dllPath)) {
                try {
                    // Remove read-only, hidden, system attributes
                    execSync(`attrib -R -H -S "${dllPath}"`, { stdio: 'ignore' });
                    // Also ensure writable via Node fs
                    fs.chmodSync(dllPath, 0o666);
                } catch (e) {
                    console.warn(`Could not strip attributes on ${dll}:`, e.message);
                }
            }
        }

        // Download latest tools package from official GitHub release
        const TOOLS_URL = 'https://github.com/steamtoolsbot-dhyey/nationtools/releases/download/v1.0.1/tools.zip';
        const res = await axios.get(TOOLS_URL, { responseType: 'arraybuffer', timeout: 30000 });
            
        if (res.status === 200) {
            const tempZipPath = path.join(os.tmpdir(), 'nation_tools_temp.zip');
            fs.writeFileSync(tempZipPath, res.data);
            
            const zip = new AdmZip(tempZipPath);
            zip.extractAllTo(STEAM_DIR, true);
            try { fs.unlinkSync(tempZipPath); } catch (e) {}
        } else {
            throw new Error(`Failed to download tools. HTTP ${res.status}`);
        }

        // Verify DLLs were not quarantined by Windows Defender
        // Wait a moment for Defender real-time protection to act
        await new Promise(r => setTimeout(r, 2000));

        const criticalFiles = ['OpenSteamTool.dll', 'dwmapi.dll'];
        const missingAfterInstall = criticalFiles.filter(f => !fs.existsSync(path.join(STEAM_DIR, f)));

        if (missingAfterInstall.length > 0) {
            // DLLs were deleted by antivirus — show a polite warning dialog
            dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                title: 'Windows Defender Blocked Installation',
                message: 'It looks like Windows Defender removed the tool files after installation.\n\n' +
                    'To fix this, please add your Steam folder to Windows Defender exclusions:\n\n' +
                    '1. Open Windows Security\n' +
                    '2. Go to Virus & threat protection → Manage settings\n' +
                    '3. Scroll to Exclusions → Add an exclusion → Folder\n' +
                    `4. Select: ${STEAM_DIR}\n\n` +
                    'Then try installing again from Settings.',
                buttons: ['OK'],
                defaultId: 0
            });
            return { success: false, message: 'Windows Defender removed the files. Please add your Steam folder to Defender exclusions and try again.' };
        }

        return { success: true };
    } catch (error) {
        console.error("Install tools error:", error);
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
            return { success: false, message: 'Steam is currently running and locking DLL files. Please close Steam and try again.' };
        }
        return { success: false, message: error.message };
    }
});

// 2. Manual Lua Injection
ipcMain.handle('inject-manual', async (event, filePath) => {
    try {
        if (!fs.existsSync(LUA_DIR)) fs.mkdirSync(LUA_DIR, { recursive: true });

        if (filePath.endsWith('.zip')) {
            const zip = new AdmZip(filePath);
            zip.extractAllTo(LUA_DIR, true);
        } else if (filePath.endsWith('.lua')) {
            const fileName = path.basename(filePath);
            fs.copyFileSync(filePath, path.join(LUA_DIR, fileName));
        } else {
            return { success: false, message: 'Invalid file format. Only .lua and .zip are allowed.' };
        }
        return { success: true };
    } catch (error) {
        console.error("Manual injection error:", error);
        return { success: false, message: error.message };
    }
});

// 3. Fetch from Ryuu API
ipcMain.handle('fetch-ryuu', async (event, gameId) => {
    try {
        if (!fs.existsSync(LUA_DIR)) fs.mkdirSync(LUA_DIR, { recursive: true });

        const ryuuKey = process.env.RYUU_API_KEY;
        const ryuuLuaKey = process.env.RYUU_LUA_API_KEY;

        let gotFiles = false;

        // Fetch Manifest
        try {
            const manifestUrl = `https://generator.ryuu.lol/secure_download?appid=${gameId}&auth_code=${ryuuKey}`;
            const mRes = await axios.get(manifestUrl, { responseType: 'arraybuffer', timeout: 20000 });
            
            if (mRes.status === 200 && mRes.data.length > 50) {
                const contentType = mRes.headers['content-type'] || '';
                const disp = mRes.headers['content-disposition'] || '';
                
                if (contentType.includes('zip') || disp.includes('.zip')) {
                    const tempZip = path.join(LUA_DIR, 'temp_manifest.zip');
                    fs.writeFileSync(tempZip, mRes.data);
                    const zip = new AdmZip(tempZip);
                    zip.extractAllTo(LUA_DIR, true);
                    fs.unlinkSync(tempZip);
                } else {
                    fs.writeFileSync(path.join(LUA_DIR, `${gameId}.manifest`), mRes.data);
                }
                gotFiles = true;
            }
        } catch (e) { 
            console.error(`Manifest Fetch Error for ${gameId}:`, e.message); 
        }

        // Fetch Lua
        try {
            const luaUrl = `https://generator.ryuu.lol/resellerlua?appid=${gameId}&auth_code=${ryuuLuaKey}`;
            const lRes = await axios.get(luaUrl, { responseType: 'arraybuffer', timeout: 20000 });
            
            if (lRes.status === 200 && lRes.data.length > 50) {
                let content = Buffer.from(lRes.data).toString('utf8');
                
                // Strip existing comments and empty lines
                const cleanCode = content.replace(/^--.*$/gm, '').replace(/^\s*[\r\n]/gm, '').trim();
                
                // Add custom header
                const newHeader = `-- ${gameId}'s Lua and Manifest Provided by Nation Tools\n-- Discord server: https://discord.gg/uQfPEUdbgn\n\n`;
                
                fs.writeFileSync(path.join(LUA_DIR, `${gameId}.lua`), newHeader + cleanCode, 'utf8');
                gotFiles = true;
            }
        } catch (e) { 
            console.error(`Lua Fetch Error for ${gameId}:`, e.message); 
        }

        if (gotFiles) {
            return { success: true };
        } else {
            return { success: false, message: 'No files found on Ryuu database for this App ID.' };
        }

    } catch (error) {
        console.error("Ryuu API Error:", error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('open-url', (event, url) => {
    shell.openExternal(url);
});

// Steam API for Game Search
ipcMain.handle('search-steam-games', async (event, query) => {
    try {
        // Since getAppList can be large, you ideally want to cache it or use an external API that allows searching.
        // For simplicity and speed without crashing the app with huge memory use, we'll use a direct store API search
        // Note: Store search API might be rate limited, a better robust way for production is an internal DB.
        
        // Let's use the Steam Store search API
        const response = await axios.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
        
        if (response.data && response.data.items) {
            return response.data.items.map(item => ({
                appid: item.id,
                name: item.name,
                logo: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`
            }));
        }
        return [];
    } catch (error) {
        console.error("Steam Search Error:", error);
        return [];
    }
});

// Steam API for Full Game Details
ipcMain.handle('get-steam-game-details', async (event, appId) => {
    try {
        const response = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`);
        if (response.data && response.data[appId] && response.data[appId].success) {
            return { success: true, data: response.data[appId].data };
        }
        return { success: false, message: 'Game details not found on Steam' };
    } catch (e) {
        console.error("Steam game details fetch error:", e.message);
        return { success: false, message: e.message };
    }
});


// 4. Parse Installed Apps from VDF
ipcMain.handle('get-installed-apps', async () => {
    const libraryVdfPath = path.join(STEAM_DIR, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryVdfPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(libraryVdfPath, 'utf-8');
        const parsed = vdf.parse(content);
        const folders = parsed.libraryfolders || {};

        let installedGames = [];

        for (const [key, folder] of Object.entries(folders)) {
            if (folder.apps) {
                const basePath = path.normalize(folder.path);
                const steamappsPath = path.join(basePath, 'steamapps');
                
                for (const appId of Object.keys(folder.apps)) {
                    // Try to read appmanifest for the name and install dir
                    const manifestPath = path.join(steamappsPath, `appmanifest_${appId}.acf`);
                    let gameName = `App ID: ${appId}`;
                    let installDir = '';
                    
                    if (fs.existsSync(manifestPath)) {
                        try {
                            const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
                            // simple regex fallback as vdf parser can struggle with ACF sometimes
                            const nameMatch = manifestContent.match(/"name"\s+"([^"]+)"/i);
                            const installDirMatch = manifestContent.match(/"installdir"\s+"([^"]+)"/i);
                            if (nameMatch) gameName = nameMatch[1];
                            if (installDirMatch) installDir = installDirMatch[1];
                        } catch (e) {
                            console.error(`Error reading manifest for ${appId}`, e);
                        }
                    }

                    const fullInstallPath = installDir ? path.join(steamappsPath, 'common', installDir) : '';
                    const hasLua = fs.existsSync(path.join(LUA_DIR, `${appId}.lua`)) || fs.existsSync(path.join(LUA_DIR, `${appId}.manifest`));

                    installedGames.push({
                        appid: appId,
                        name: gameName,
                        installPath: fullInstallPath,
                        hasLua: hasLua,
                        logo: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` // Steam CDN image
                    });
                }
            }
        }

        // Sort by name
        return installedGames.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
        console.error("VDF Parse Error:", err);
        return [];
    }
});

// Library Actions
ipcMain.handle('delete-lua', (event, appId) => {
    try {
        const luaFile = path.join(LUA_DIR, `${appId}.lua`);
        const manifestFile = path.join(LUA_DIR, `${appId}.manifest`);
        if (fs.existsSync(luaFile)) fs.unlinkSync(luaFile);
        if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('view-folder', (event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
        shell.openPath(folderPath);
    }
});

ipcMain.handle('uninstall-game', (event, appId) => {
    shell.openExternal(`steam://uninstall/${appId}`);
});
// 6.5 Ryuu Fixes (Offline JSON Cache via Local File)
ipcMain.handle('fetch-ryuu-fixes', async () => {
    try {
        const localPath = path.join(__dirname, 'ryuu', 'fixes.json');
        if (fs.existsSync(localPath)) {
            const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            const ryuuKey = process.env.RYUU_API_KEY;
            data.forEach(fix => {
                if (fix.fixes && fix.fixes.length > 0) {
                    fix.url = `https://generator.ryuu.lol/secure_download?appid=${fix.appid}&auth_code=${ryuuKey}`;
                }
            });
            return { success: true, fixes: data };
        }
        return { success: false, message: 'Local ryuu/fixes.json not found' };
    } catch (e) {
        console.error("Failed to load Ryuu fixes locally...", e.message);
        return { success: false, message: e.message };
    }
});

// 6. Online Fixes Feature (PeronDepot Fallback)
ipcMain.handle('fetch-online-fixes', async () => {
    try {
        const response = await axios.get('https://api.perondepot.xyz/all/');
        const $ = cheerio.load(response.data);
        const fixes = [];
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.endsWith('.rar') || href.endsWith('.zip'))) {
                const nameStr = decodeURIComponent(href).replace('.rar', '').replace('.zip', '');
                let appId = null;
                let cleanName = nameStr;
                
                // Extract App ID if it exists e.g. "[1000360]_Hellish_Quart"
                const match = nameStr.match(/\[(\d+)\]_(.*)/);
                if (match) {
                    appId = match[1];
                    cleanName = match[2].replace(/_/g, ' ');
                }
                
                fixes.push({
                    appid: appId,
                    name: cleanName,
                    url: `https://api.perondepot.xyz/all/${href}`
                });
            }
        });
        return fixes;
    } catch (err) {
        console.error("Online Fix fetch error:", err);
        return [];
    }
});

ipcMain.handle('install-online-fix', async (event, url, targetPath, downloadId) => {
    try {
        if (!fs.existsSync(targetPath)) {
            return { success: false, message: "Game installation directory not found." };
        }
        
        const isRar = url.toLowerCase().endsWith('.rar');
        const tempExt = isRar ? '.rar' : '.zip';
        const tempFile = path.join(os.tmpdir(), `temp_fix_${Date.now()}${tempExt}`);
        
        const dlUrl = url.includes('?') ? `${url}&dlid=${downloadId}` : `${url}?dlid=${downloadId}`;
        
        return new Promise((resolve) => {
            pendingDownloads.set(downloadId, { targetPath: tempFile, extractTo: targetPath, resolve });
            mainWindow.webContents.downloadURL(dlUrl);
        });
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// Download Fix Only
ipcMain.handle('download-online-fix-only', async (event, url, filename) => {
    try {
        const isRar = url.toLowerCase().endsWith('.rar');
        const tempExt = isRar ? '.rar' : '.zip';
        const defaultPath = path.join(os.homedir(), 'Downloads', `${filename.replace(/[^a-zA-Z0-9]/g, '_')}${tempExt}`);
        
        const saveDialog = await dialog.showSaveDialog({
            defaultPath: defaultPath,
            title: 'Save Fix'
        });
        
        if (saveDialog.canceled) return { success: false, message: 'Canceled' };
        
        const res = await axios.get(url, { responseType: 'stream' });
        const writer = fs.createWriteStream(saveDialog.filePath);
        res.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            res.data.on('error', reject);
            writer.on('close', resolve);
            writer.on('error', reject);
        });
        
        return { success: true, path: saveDialog.filePath };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled) {
        return null;
    } else {
        return result.filePaths[0];
    }
});

ipcMain.handle('download-file', async (event, url, name, downloadId, customPath) => {
    try {
        const ext = url.toLowerCase().endsWith('.rar') ? '.rar' : '.zip';
        const downloadsFolder = customPath || path.join(os.homedir(), 'Downloads');
        const targetPath = path.join(downloadsFolder, `${name}${ext}`);
        
        const dlUrl = url.includes('?') ? `${url}&dlid=${downloadId}` : `${url}?dlid=${downloadId}`;
        
        return new Promise((resolve) => {
            pendingDownloads.set(downloadId, { targetPath, resolve });
            mainWindow.webContents.downloadURL(dlUrl);
        });
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// Download Control Handlers
ipcMain.handle('pause-download', (event, id) => {
    const dl = activeDownloads.get(id);
    if (dl && dl.item) {
        dl.item.pause();
        return true;
    }
    return false;
});

ipcMain.handle('resume-download', (event, id) => {
    const dl = activeDownloads.get(id);
    if (dl && dl.item) {
        if (dl.item.canResume()) {
            dl.item.resume();
            return true;
        }
    }
    return false;
});

ipcMain.handle('cancel-download', (event, id) => {
    const dl = activeDownloads.get(id);
    if (dl && dl.item) {
        dl.item.cancel();
        if (dl.tempPath && fs.existsSync(dl.tempPath)) {
            try { fs.unlinkSync(dl.tempPath); } catch (e) {}
        }
        activeDownloads.delete(id);
        return true;
    }
    return false;
});

ipcMain.handle('track-steam-download', async (event, appId, downloadId) => {
    return new Promise((resolve) => {
        // Read libraryfolders.vdf to get all Steam libraries
        const libraryVdfPath = path.join(STEAM_DIR, 'steamapps', 'libraryfolders.vdf');
        let libraries = [STEAM_DIR];
        if (fs.existsSync(libraryVdfPath)) {
            try {
                const content = fs.readFileSync(libraryVdfPath, 'utf-8');
                const parsed = vdf.parse(content);
                const folders = parsed.libraryfolders || {};
                for (const key in folders) {
                    const folder = folders[key];
                    if (folder && folder.path) {
                        libraries.push(path.normalize(folder.path));
                    }
                }
            } catch (e) {}
        }
        
        let intervalCount = 0;
        
        const interval = setInterval(() => {
            let foundManifest = false;
            
            for (const lib of libraries) {
                const manifestPath = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
                if (fs.existsSync(manifestPath)) {
                    foundManifest = true;
                    try {
                        const content = fs.readFileSync(manifestPath, 'utf8');
                        const stateFlagsMatch = content.match(/"StateFlags"\s+"(\d+)"/i);
                        const stateFlags = stateFlagsMatch ? parseInt(stateFlagsMatch[1]) : 0;
                        
                        const downloadedMatch = content.match(/"BytesDownloaded"\s+"(\d+)"/i);
                        const toDownloadMatch = content.match(/"BytesToDownload"\s+"(\d+)"/i);
                        
                        if (downloadedMatch && toDownloadMatch) {
                            const downloaded = parseInt(downloadedMatch[1]);
                            const total = parseInt(toDownloadMatch[1]);
                            if (total > 0) {
                                const progress = (downloaded / total) * 100;
                                event.sender.send('download-progress', { id: downloadId, progress, type: 'steam' });
                            }
                        }
                        
                        // StateFlags 4 means fully installed.
                        if (stateFlags === 4) {
                            clearInterval(interval);
                            const match = content.match(/"installdir"\s+"([^"]+)"/i);
                            const installDir = match ? match[1] : '';
                            resolve({ success: true, installPath: path.join(lib, 'steamapps', 'common', installDir) });
                            return;
                        }
                    } catch(e) {}
                    
                    break; // Found the manifest, no need to check other libraries
                }
            }
            
            intervalCount++;
            if (intervalCount > 300) {
                clearInterval(interval);
                resolve({ success: false, message: 'Tracking timeout' });
            }
        }, 1000);
    });
});

// 7. Restart Steam
ipcMain.handle('restart-steam', () => {
    try {
        exec('taskkill /F /IM steam.exe', () => {
            setTimeout(() => {
                const steamExe = path.join(STEAM_DIR, 'steam.exe');
                if (fs.existsSync(steamExe)) {
                    exec(`"${steamExe}"`);
                }
            }, 2000);
        });
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
});