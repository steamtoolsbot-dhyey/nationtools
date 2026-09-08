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
const urlToDownloadId = new Map();

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
    setupSteamLibraryWatcher();
    
    session.defaultSession.on('will-download', (event, item, webContents) => {
        const urlChain = item.getURLChain() || [];
        const currentUrl = item.getURL();
        
        let downloadId = null;

        // Check if original URL or redirected URL was registered in urlToDownloadId
        for (const u of urlChain) {
            if (urlToDownloadId.has(u)) {
                downloadId = urlToDownloadId.get(u);
                urlToDownloadId.delete(u);
                break;
            }
        }
        if (!downloadId && urlToDownloadId.has(currentUrl)) {
            downloadId = urlToDownloadId.get(currentUrl);
            urlToDownloadId.delete(currentUrl);
        }

        // Fallback for dlid param in URL or app update
        if (!downloadId) {
            const match = currentUrl.match(/dlid=([^&]+)/) || (urlChain[0] && urlChain[0].match(/dlid=([^&]+)/));
            if (match) {
                downloadId = match[1];
            } else if (global.appUpdateUrl && (currentUrl === global.appUpdateUrl || item.getFilename().toLowerCase().includes('nation-tools'))) {
                downloadId = 'app_update';
            }
        }
        
        if (!downloadId) return;
        
        const pending = pendingDownloads.get(downloadId);
        
        if (pending) {
            let savePath = pending.targetPath;
            if (pending.targetDir) {
                const ext = path.extname(item.getFilename()) || '.zip';
                const baseName = pending.baseName || path.basename(item.getFilename(), ext);
                savePath = path.join(pending.targetDir, `${baseName}${ext}`);
                pending.targetPath = savePath;
            }

            item.setSavePath(savePath);
            
            activeDownloads.set(downloadId, {
                item: item,
                tempPath: savePath,
                targetPath: savePath
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
                        // This is an auto-apply / auto-install fix, so extract it
                        if (mainWindow) {
                            mainWindow.webContents.send('download-progress', { id: downloadId, progress: 100, type: 'extracting' });
                        }
                        try {
                            const extractOptions = {
                                $bin: sevenZipPath,
                                recursive: true
                            };
                            if (pending.password) {
                                extractOptions.$pass = pending.password;
                            }
                            await new Promise((res, rej) => {
                                const stream = extractFull(savePath, pending.extractTo, extractOptions);
                                stream.on('end', res);
                                stream.on('error', rej);
                            });
                            try { fs.unlinkSync(savePath); } catch (e) {} // Cleanup temp file
                            resolve({ success: true, path: pending.extractTo });
                        } catch (e) {
                            resolve({ success: false, message: `Extraction failed: ${e.message}` });
                        }
                    } else {
                        resolve({ success: true, path: savePath });
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

// ==========================================
// LUA TOOLS AUTHENTICATION & DOWNLOADS
// ==========================================
const LUA_AUTH_FILE = path.join(app.getPath('userData'), 'lua-auth.json');

function getSavedLuaAuth() {
    try {
        if (fs.existsSync(LUA_AUTH_FILE)) {
            const data = JSON.parse(fs.readFileSync(LUA_AUTH_FILE, 'utf8'));
            if (data && data.cookieStr) {
                return data;
            }
        }
    } catch(e) {}
    return null;
}

function saveLuaAuth(data) {
    try {
        fs.writeFileSync(LUA_AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch(e) {
        console.error('Failed to save lua auth:', e);
        return false;
    }
}

function clearLuaAuth() {
    try {
        if (fs.existsSync(LUA_AUTH_FILE)) {
            fs.unlinkSync(LUA_AUTH_FILE);
        }
    } catch(e) {}
}

// Check if user is logged into lua.tools
ipcMain.handle('get-lua-auth-status', () => {
    const auth = getSavedLuaAuth();
    if (auth) {
        return { loggedIn: true, user: auth.user };
    }
    return { loggedIn: false };
});

// Logout from lua.tools
ipcMain.handle('lua-logout', async () => {
    clearLuaAuth();
    try {
        const authSession = session.fromPartition('persist:luatools_session');
        await authSession.clearStorageData();
    } catch(e) {}
    return { success: true };
});

// Login to lua.tools via Discord (lua.tools is completely invisible to the user)
ipcMain.handle('lua-discord-login', async () => {
    return new Promise(async (resolve) => {
        const authSession = session.fromPartition('persist:luatools_session');
        
        // Clean out any stale lua.tools session cookies to guarantee fresh authorization
        try {
            const oldCookies = await authSession.cookies.get({});
            for (const c of oldCookies) {
                if (c.domain && c.domain.includes('lua.tools')) {
                    const domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
                    const url = `https://${domain}${c.path || '/'}`;
                    try { await authSession.cookies.remove(url, c.name); } catch(err) {}
                }
            }
        } catch(e) {}

        const authWindow = new BrowserWindow({
            width: 500,
            height: 720,
            title: 'Discord Login — lua.tools',
            backgroundColor: '#313338',
            autoHideMenuBar: true,
            show: false, // Keep hidden so user NEVER sees lua.tools website
            icon: path.join(__dirname, 'icons', 'icon.png'),
            webPreferences: {
                session: authSession,
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        let resolved = false;

        const checkAndSaveCookies = async () => {
            if (resolved) return true;
            try {
                const allCookies = await authSession.cookies.get({});
                const authCookies = allCookies.filter(c => c.name.startsWith('sb-') && c.name.includes('auth-token') && !c.name.includes('code-verifier'));
                if (authCookies.length > 0) {
                    const cookieStr = authCookies
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(c => `${c.name}=${c.value}`)
                        .join('; ');

                    let userData = { name: 'Discord User', avatar: '' };
                    try {
                        const token0 = authCookies.find(c => c.name.endsWith('.0')) || authCookies[0];
                        const token1 = authCookies.find(c => c.name.endsWith('.1'));
                        let fullB64 = token0.value.replace(/^base64-/, '');
                        if (token1) fullB64 += token1.value;
                        const decoded = JSON.parse(Buffer.from(fullB64, 'base64').toString('utf8'));
                        if (decoded && decoded.user) {
                            const meta = decoded.user.user_metadata || {};
                            userData = {
                                name: meta.full_name || meta.name || meta.global_name || 'Discord User',
                                avatar: meta.avatar_url || meta.picture || ''
                            };
                        }
                    } catch(e) {}

                    saveLuaAuth({ cookieStr, user: userData, savedAt: Date.now() });
                    resolved = true;
                    if (!authWindow.isDestroyed()) authWindow.close();
                    resolve({ success: true, user: userData });
                    return true;
                }
            } catch(e) {}
            return false;
        };

        // Disable canvas particles and animations to completely eliminate any GPU/CPU stutter
        authWindow.webContents.on('dom-ready', () => {
            authWindow.webContents.insertCSS('canvas { display: none !important; } * { animation: none !important; transition: none !important; }').catch(() => {});
        });

        // Show window ONLY when navigating to Discord
        authWindow.webContents.on('will-navigate', (event, url) => {
            if (url.includes('discord.com')) {
                if (!authWindow.isDestroyed()) {
                    authWindow.show();
                    authWindow.focus();
                }
            } else if (url.includes('lua.tools')) {
                // Instantly hide window on return so user never sees lua.tools
                if (!authWindow.isDestroyed()) {
                    authWindow.hide();
                }
            }
        });

        authWindow.webContents.on('did-navigate', async (event, url) => {
            if (url.includes('discord.com')) {
                if (!authWindow.isDestroyed()) {
                    authWindow.show();
                    authWindow.focus();
                }
            } else if (url.includes('error=access_denied')) {
                resolved = true;
                if (!authWindow.isDestroyed()) authWindow.close();
                resolve({ success: false, message: 'Discord authorization was cancelled.' });
            } else if (url.includes('lua.tools') && !url.includes('discord.com')) {
                // Returned to lua.tools after Discord authorization
                setTimeout(checkAndSaveCookies, 500);
                setTimeout(checkAndSaveCookies, 1500);
                setTimeout(checkAndSaveCookies, 3000);
            }
        });

        authWindow.webContents.on('did-finish-load', async () => {
            const currentUrl = authWindow.webContents.getURL();
            
            if (currentUrl.includes('lua.tools') && !currentUrl.includes('auth/callback')) {
                // Auto click login button while hidden to initiate PKCE and redirect to Discord
                authWindow.webContents.executeJavaScript(`
                    (() => {
                        let attempts = 0;
                        const clickBtn = () => {
                            attempts++;
                            const btns = Array.from(document.querySelectorAll('button'));
                            const btn = btns.find(b => b.textContent && (
                                b.textContent.includes('Login with Discord') || 
                                b.textContent.includes('Login to Fetch') || 
                                b.textContent.includes('Login')
                            ));
                            if (btn) {
                                btn.click();
                                return true;
                            }
                            return false;
                        };
                        if (!clickBtn()) {
                            const timer = setInterval(() => {
                                if (clickBtn() || attempts > 20) clearInterval(timer);
                            }, 100);
                        }
                    })()
                `).catch(() => {});
            } else if (currentUrl.includes('lua.tools')) {
                setTimeout(checkAndSaveCookies, 500);
            }
        });

        authWindow.on('closed', async () => {
            if (!resolved) {
                const loggedIn = await checkAndSaveCookies();
                if (!loggedIn) {
                    resolve({ success: false, message: 'Login was closed before completing.' });
                }
            }
        });

        authWindow.loadURL('https://lua.tools');
    });
});

// Get download URL from lua.tools without opening external browser
ipcMain.handle('get-lua-download-url', async (event, fixId, slot = 'fix') => {
    try {
        const auth = getSavedLuaAuth();
        if (!auth || !auth.cookieStr) {
            return { success: false, needLogin: true, message: 'Please log in with Discord first.' };
        }

        const res = await axios.get(`https://lua.tools/api/denuvo/download?fix=${fixId}&slot=${slot}`, {
            headers: { 'Cookie': auth.cookieStr },
            validateStatus: () => true
        });

        if (res.data && res.data.url) {
            return { success: true, url: res.data.url };
        } else if (res.status === 401 || res.status === 403) {
            clearLuaAuth();
            return { success: false, needLogin: true, message: 'Session expired. Please log in with Discord again.' };
        } else {
            console.error('Failed to get download URL from lua.tools:', res.data);
            return { success: false, message: res.data?.error || 'Failed to generate download link' };
        }
    } catch(err) {
        console.error('Error fetching download link:', err);
        return { success: false, message: err.message };
    }
});

ipcMain.handle('download-lua-fix', async (event, fixId, slot) => {
    try {
        const auth = getSavedLuaAuth();
        if (!auth || !auth.cookieStr) {
            return { success: false, needLogin: true, message: 'Please log in with Discord first.' };
        }

        const res = await axios.get(`https://lua.tools/api/denuvo/download?fix=${fixId}&slot=${slot}`, {
            headers: { 'Cookie': auth.cookieStr },
            validateStatus: () => true
        });

        if (res.data && res.data.url) {
            shell.openExternal(res.data.url);
            return { success: true, url: res.data.url };
        } else if (res.status === 401 || res.status === 403) {
            clearLuaAuth();
            return { success: false, needLogin: true, message: 'Session expired. Please log in with Discord again.' };
        } else {
            console.error('Failed to get download URL from lua.tools:', res.data);
            return { success: false, message: res.data?.error || 'Failed to generate download link' };
        }
    } catch(err) {
        console.error('Error fetching download link:', err);
        return { success: false, message: err.message };
    }
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

// Helper to check if a folder exists on disk
ipcMain.handle('check-folder-exists', (event, folderPath) => {
    try {
        return Boolean(folderPath && fs.existsSync(folderPath));
    } catch (e) {
        return false;
    }
});

// 4. Parse Installed Apps across all Steam library folders accurately
function getInstalledAppsList() {
    const libraryVdfPath = path.join(STEAM_DIR, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryVdfPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(libraryVdfPath, 'utf-8');
        const parsed = vdf.parse(content);
        const folders = parsed.libraryfolders || {};

        let installedGames = [];
        const seenAppIds = new Set();

        for (const [key, folder] of Object.entries(folders)) {
            if (!folder || !folder.path) continue;
            const basePath = path.normalize(folder.path);
            const steamappsPath = path.join(basePath, 'steamapps');
            if (!fs.existsSync(steamappsPath)) continue;

            const appIds = new Set();
            if (folder.apps) {
                for (const id of Object.keys(folder.apps)) {
                    appIds.add(id);
                }
            }
            try {
                const manifestFiles = fs.readdirSync(steamappsPath);
                for (const f of manifestFiles) {
                    const match = f.match(/^appmanifest_(\d+)\.acf$/i);
                    if (match) {
                        appIds.add(match[1]);
                    }
                }
            } catch(e) {}

            for (const appId of appIds) {
                if (seenAppIds.has(appId)) continue;

                const manifestPath = path.join(steamappsPath, `appmanifest_${appId}.acf`);
                if (!fs.existsSync(manifestPath)) continue;

                let gameName = `App ID: ${appId}`;
                let installDir = '';
                
                try {
                    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
                    const nameMatch = manifestContent.match(/"name"\s+"([^"]+)"/i);
                    const installDirMatch = manifestContent.match(/"installdir"\s+"([^"]+)"/i);
                    if (nameMatch) gameName = nameMatch[1];
                    if (installDirMatch) installDir = installDirMatch[1];
                } catch (e) {
                    console.error(`Error reading manifest for ${appId}`, e);
                }

                const fullInstallPath = installDir ? path.join(steamappsPath, 'common', installDir) : '';
                
                // Only consider the game installed if its installation folder exists on disk
                if (!fullInstallPath || !fs.existsSync(fullInstallPath)) {
                    continue;
                }

                seenAppIds.add(appId);
                const hasLua = fs.existsSync(path.join(LUA_DIR, `${appId}.lua`)) || fs.existsSync(path.join(LUA_DIR, `${appId}.manifest`));

                installedGames.push({
                    appid: appId,
                    name: gameName,
                    installPath: fullInstallPath,
                    hasLua: hasLua,
                    logo: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
                });
            }
        }

        // Sort by name
        return installedGames.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
        console.error("VDF Parse Error:", err);
        return [];
    }
}

ipcMain.handle('get-installed-apps', async () => {
    return getInstalledAppsList();
});

// Real-Time Steam Library Tracking
let lastLibraryFingerprint = '';
let isWatchingSteam = false;

function getSteamLibraryFingerprint() {
    try {
        const libraryVdfPath = path.join(STEAM_DIR, 'steamapps', 'libraryfolders.vdf');
        if (!fs.existsSync(libraryVdfPath)) return '';
        let fp = `${fs.statSync(libraryVdfPath).mtimeMs}:`;

        const content = fs.readFileSync(libraryVdfPath, 'utf-8');
        const parsed = vdf.parse(content);
        const folders = parsed.libraryfolders || {};

        for (const [key, folder] of Object.entries(folders)) {
            if (folder && folder.path) {
                const steamappsPath = path.join(path.normalize(folder.path), 'steamapps');
                if (fs.existsSync(steamappsPath)) {
                    try {
                        const files = fs.readdirSync(steamappsPath).filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf'));
                        fp += `${folder.path}[${files.sort().join(',')}]`;
                    } catch(e) {}
                }
            }
        }
        return fp;
    } catch(e) {
        return '';
    }
}

function checkAndNotifySteamLibraryChanges() {
    const currentFp = getSteamLibraryFingerprint();
    if (currentFp && currentFp !== lastLibraryFingerprint) {
        lastLibraryFingerprint = currentFp;
        const freshApps = getInstalledAppsList();
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('steam-library-updated', freshApps);
        }
    }
}

function setupSteamLibraryWatcher() {
    if (isWatchingSteam) return;
    isWatchingSteam = true;
    lastLibraryFingerprint = getSteamLibraryFingerprint();

    // 1. Periodic poll check every 3 seconds (lightweight, zero overhead)
    setInterval(() => {
        checkAndNotifySteamLibraryChanges();
    }, 3000);

    // 2. Attach fs.watch to libraryfolders.vdf for instant notification
    try {
        const libraryVdfPath = path.join(STEAM_DIR, 'steamapps', 'libraryfolders.vdf');
        if (fs.existsSync(libraryVdfPath)) {
            fs.watch(libraryVdfPath, () => {
                setTimeout(checkAndNotifySteamLibraryChanges, 500);
            });
        }
    } catch(e) {}
}

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

ipcMain.handle('install-online-fix', async (event, url, targetPath, downloadId, password = null) => {
    try {
        if (!fs.existsSync(targetPath)) {
            return { success: false, message: "Game installation directory not found." };
        }
        
        const isRar = url.toLowerCase().endsWith('.rar');
        const tempExt = isRar ? '.rar' : '.zip';
        const tempFile = path.join(os.tmpdir(), `temp_fix_${Date.now()}${tempExt}`);
        
        return new Promise((resolve) => {
            pendingDownloads.set(downloadId, { 
                targetPath: tempFile, 
                extractTo: targetPath, 
                password: password || (url.includes('perondepot') ? 'online-fix.me' : undefined),
                resolve 
            });
            urlToDownloadId.set(url, downloadId);
            mainWindow.webContents.downloadURL(url);
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
        const downloadsFolder = customPath || path.join(os.homedir(), 'Downloads');
        const ext = url.toLowerCase().endsWith('.rar') ? '.rar' : '.zip';
        const targetPath = path.join(downloadsFolder, `${name}${ext}`);
        
        return new Promise((resolve) => {
            pendingDownloads.set(downloadId, { 
                targetPath, 
                targetDir: downloadsFolder, 
                baseName: name, 
                resolve 
            });
            urlToDownloadId.set(url, downloadId);
            mainWindow.webContents.downloadURL(url);
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

// Helper to load luafixes database from userData or bundled files
function getLuaFixesData() {
    try {
        const candidatePaths = [
            path.join(app.getPath('userData'), 'luafixes.json'),
            path.join(__dirname, 'luafixes.json'),
            path.join(process.resourcesPath, 'luafixes.json'),
            path.join(process.resourcesPath, 'app.asar', 'luafixes.json'),
            path.join(process.cwd(), 'luafixes.json')
        ];

        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        }
    } catch (e) {
        console.error('Failed to load lua tools games:', e.message);
    }
    return [];
}

function saveLuaFixesData(data) {
    try {
        const userLuaPath = path.join(app.getPath('userData'), 'luafixes.json');
        fs.writeFileSync(userLuaPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save lua tools games to userData:', e.message);
    }
}

// Get list of games from lua.tools
ipcMain.handle('fetch-lua-tools-games', async () => {
    return getLuaFixesData();
});

// Fetch single game fixes dynamically from lua.tools as a fallback
function extractRscJsonArray(text, startKey) {
    const keyIndex = text.indexOf(startKey);
    if (keyIndex === -1) return null;
    const arrayStartIndex = text.indexOf('[', keyIndex + startKey.length);
    if (arrayStartIndex === -1) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = arrayStartIndex; i < text.length; i++) {
        const char = text[i];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (!inString) {
            if (char === '[') depth++;
            else if (char === ']') {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(text.substring(arrayStartIndex, i + 1));
                    } catch(e) {
                        return null;
                    }
                }
            }
        }
    }
    return null;
}

ipcMain.handle('fetch-single-lua-game', async (event, appId) => {
    try {
        const res = await axios.get(`https://lua.tools/fixes/${appId}`, {
            timeout: 10000,
            validateStatus: () => true
        });
        if (res.status === 200) {
            const html = res.data;
            const chunksMatch = [...html.matchAll(/<script>self\.__next_f\.push\((.*?)\)<\/script>/g)];
            let fullPayload = "";
            for (const m of chunksMatch) {
                try {
                    const p = JSON.parse(m[1]);
                    if (Array.isArray(p) && p.length > 1 && typeof p[1] === 'string') {
                        fullPayload += p[1];
                    }
                } catch(e) {}
            }
            
            const releases = extractRscJsonArray(fullPayload, '"releases":');
            if (releases && releases.length > 0) {
                const fixes = releases.map(rel => {
                    let desc = rel.description;
                    if (typeof desc === 'string' && desc.startsWith('$')) {
                        const refId = desc.slice(1);
                        const marker = `${refId}:T`;
                        const idx = fullPayload.indexOf(marker);
                        if (idx !== -1) {
                            const comma = fullPayload.indexOf(',', idx);
                            if (comma !== -1) {
                                const hexLen = fullPayload.substring(idx + marker.length, comma);
                                const len = parseInt(hexLen, 16);
                                if (!isNaN(len)) {
                                    const buf = Buffer.from(fullPayload);
                                    const bIdx = buf.indexOf(Buffer.from(marker));
                                    const bComma = buf.indexOf(Buffer.from(','), bIdx);
                                    desc = buf.subarray(bComma + 1, bComma + 1 + len).toString('utf8').trim();
                                }
                            }
                        }
                    }
                    if (typeof desc === 'string' && desc.includes('5:[')) {
                        desc = desc.split(/5:\[/)[0].trim();
                    }
                    return {
                        title: rel.title,
                        description: desc,
                        tags: rel.tags,
                        id: rel.id,
                        hasManifest: rel.hasManifest,
                        hasFix: rel.hasFix,
                        createdAt: rel.createdAt
                    };
                });
                
                // Update local luafixes cache in userData
                try {
                    const allGames = getLuaFixesData();
                    const g = allGames.find(item => String(item.appId) === String(appId));
                    if (g) {
                        g.fixes = fixes;
                        saveLuaFixesData(allGames);
                    }
                } catch(e) {}

                return { appId, fixes };
            }
        }
        return null;
    } catch(e) {
        console.error(`fetch-single-lua-game error for ${appId}:`, e.message);
        return null;
    }
});