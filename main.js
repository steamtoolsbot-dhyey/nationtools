const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('KyroSphere');

// Protocol registration for kyrosphere://
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('kyrosphere', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('kyrosphere');
}

// Suppress internal Chromium network socket probe warnings (e.g. WebRTC STUN -105)
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Disable AutomationControlled to prevent Cloudflare Turnstile "Verification failed" flag
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');


const {
  fetchCategories,
  fetchRecentGames,
  fetchGameDetails,
  loadFullGamesIndex,
  syncFullGamesIndex,
  searchFullIndex,
  loadCachedGames,
  saveCachedGames,
  getGameMedia,
  batchGetGameMedia
} = require('./scrapers/steamrip');
const {
  searchFitgirlRepacks,
  getFitgirlGameDetails,
  normalizeGameTitle
} = require('./scrapers/fitgirl');
const {
  parseMultiPartLinks,
  resolveInAppDirectStream
} = require('./downloader/hoster_resolvers');
const { DownloadManager, taskToJSON } = require('./downloader/manager');
const { sendToJDownloader, isJDownloaderRunning } = require('./downloader/jdownloader_api');
const discordRpc = require('./services/discord_rpc');
const steamPriceService = require('./services/steam_price_service');
const systemInfoService = require('./services/system_info');

// Global error shielding to prevent main process dialog crashes
process.on('uncaughtException', (err) => {
  console.error('[Main Process Uncaught Exception Shield]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main Process Unhandled Rejection Shield]:', reason);
});

let mainWindow;
let downloadManager;

// Settings persistence
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'xero-settings.json');
}

function loadSettings() {
  const defaults = {
    downloadDir: path.join(os.homedir(), 'Downloads', 'KYROSPHERE'),
    autoExtract: true,
    particlesEnabled: true,
    theme: 'theme-aurora',
    maxConcurrent: 3
  };
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const oldThemes = { 'theme-ice': 'theme-aurora', 'theme-midnight': 'theme-aurora', 'theme-cyberpunk': 'theme-neon', 'theme-crimson': 'theme-ember', 'theme-emerald': 'theme-jade' };
      if (parsed.theme && oldThemes[parsed.theme]) {
        parsed.theme = oldThemes[parsed.theme];
      }
      return { ...defaults, ...parsed };
    }
  } catch (e) {}
  return defaults;
}

function saveSettings(newSettings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(newSettings, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function createWindow() {
  const settings = loadSettings();
  downloadManager = new DownloadManager(settings.downloadDir);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    title: 'KYROSPHERE',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    backgroundColor: '#070709',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open MAXIMIZED by default (NOT full screen, as requested by user)
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    initAutoUpdater();
    try {
      discordRpc.init();
    } catch (e) {
      console.warn('[Discord RPC] Init failed:', e.message);
    }
  });

  // Relay download events to renderer and auto-register in Library on completion
  downloadManager.on('progress', async (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', data);
    }
    if (data && data.state === 'completed') {
      try {
        await syncCompletedDownloadsWithLibrary();
      } catch (e) {
        console.warn('[Library Auto-Sync] Download completed sync error:', e.message);
      }
    }
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

// Auto-Updater configuration and lifecycle
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('[AutoUpdater] Failed to load module:', e.message);
}

function initAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'steamtoolsbot-dhyey',
    repo: 'xero-nation'
  });

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update-status', { status: 'checking', message: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      message: `Update v${info.version} available! Downloading in background...`
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update-status', {
      status: 'not-available',
      message: 'KYROSPHERE is up to date.'
    });
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Error:', err.message);
    sendToRenderer('update-status', {
      status: 'error',
      message: 'Could not connect to update server.'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progressObj.percent || 0),
      bytesPerSecond: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total,
      message: `Downloading update: ${Math.round(progressObj.percent || 0)}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update-status', {
      status: 'downloaded',
      version: info.version,
      message: `Update v${info.version} ready to install! Restart now to apply.`
    });
  });

  // Automated silent check 4 seconds after launch in production
  setTimeout(() => {
    try {
      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(() => {});
      }
    } catch (e) {}
  }, 4000);
}

// Window control handlers
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });

// External URLs
ipcMain.handle('open-url', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

// Settings handlers
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, newSettings) => {
  const saved = saveSettings(newSettings);
  if (saved && downloadManager && newSettings.downloadDir) {
    downloadManager.defaultDownloadDir = newSettings.downloadDir;
  }
  return saved;
});

ipcMain.handle('select-directory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Download Directory'
  });
  if (!res.canceled && res.filePaths.length > 0) {
    return res.filePaths[0];
  }
  return null;
});

// Full Games Index & Scraper Handlers
ipcMain.handle('get-full-index-stats', () => {
  const games = loadFullGamesIndex(app.getPath('userData'));
  const fgCount = games.filter(g => g.hasFitgirl).length || 7975;
  return {
    count: fgCount, // Display total FitGirl repacks as requested
    totalCatalogCount: games.length,
    indexed: games.length > 0
  };
});

ipcMain.handle('sync-full-index', async () => {
  try {
    const res = await syncFullGamesIndex(app.getPath('userData'));
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fetch-games', async (event, page = 1, perPage = 24) => {
  try {
    // Instant response from curated index containing all 7,975+ FitGirl & SteamRIP games
    const searchRes = searchFullIndex('', page, perPage, 'all', app.getPath('userData'));
    if (searchRes && searchRes.games && searchRes.games.length > 0) {
      return { success: true, ...searchRes, fromIndex: true };
    }
    const data = await fetchRecentGames(page, perPage);
    return { success: true, ...data };
  } catch (err) {
    const searchRes = searchFullIndex('', page, perPage, 'all', app.getPath('userData'));
    return { success: true, ...searchRes, fromIndex: true };
  }
});

ipcMain.handle('search-games', async (event, query, page = 1, perPage = 24, category = 'all') => {
  try {
    // Search the full index instantly
    const result = searchFullIndex(query, page, perPage, category, app.getPath('userData'));
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-game-details', async (event, slugOrId) => {
  try {
    const allGames = loadFullGamesIndex(app.getPath('userData'));
    const found = allGames.find(g => 
      g.id === slugOrId || 
      g.slug === slugOrId || 
      (g.name && g.name.toLowerCase() === (slugOrId || '').toLowerCase())
    );

    let details = null;
    let scrapeSlug = null;

    if (found) {
      // If it's GTA V, strictly use GTA V's steamrip slug gta-5-4wi (never grand-theft-auto-v which redirects to vice city)
      if (found.name && found.name.toLowerCase().includes('grand theft auto v')) {
        scrapeSlug = 'gta-5-4wi';
      } else if (found.link && found.link.includes('steamrip.com/')) {
        const m = found.link.match(/steamrip\.com\/([^/]+)/);
        if (m) scrapeSlug = m[1];
      } else if (found.slug && !found.slug.startsWith('fg_')) {
        scrapeSlug = found.slug;
      }
    } else if (!slugOrId?.startsWith('fg_')) {
      scrapeSlug = (slugOrId === 'grand-theft-auto-v' || slugOrId === 'gta-v') ? 'gta-5-4wi' : slugOrId;
    }

    if (scrapeSlug) {
      try {
        const scraped = await fetchGameDetails(scrapeSlug);
        // Verify scraped title doesn't contradict requested game (e.g. Vice City for GTA V)
        if (scraped && scraped.name) {
          const expectedName = (found?.name || slugOrId).toLowerCase();
          const scrapedName = scraped.name.toLowerCase();
          if (expectedName.includes('grand theft auto v') && scrapedName.includes('vice city')) {
            console.warn('[GameDetails] Rejected false Vice City redirect for GTA V');
          } else {
            details = scraped;
          }
        }
      } catch (e) {}
    }

    // Combine with indexed metadata
    if (found) {
      details = Object.assign({
        id: found.id,
        name: found.name,
        slug: found.slug,
        version: found.version || 'Repack',
        online: Boolean(found.online),
        categories: found.categories || ['Action'],
        size: found.size || found.repackSize || 'Repack',
        image: found.image,
        source: found.source || (found.hasFitgirl && found.hasSteamrip ? 'dual' : (found.hasFitgirl ? 'fitgirl' : 'steamrip')),
        hasFitgirl: Boolean(found.hasFitgirl),
        hasSteamrip: Boolean(found.hasSteamrip),
        fitgirlUrl: found.fitgirlUrl,
        link: found.link
      }, details || {});

      // Always guarantee canonical title
      details.name = found.name;
    }

    if (details) {
      // Enhance with Steam screenshots and artwork
      try {
        const media = await getGameMedia(details.name, details.slug, app.getPath('userData'));
        if (media) {
          if (media.headerImage && !details.image) details.image = media.headerImage;
          if (media.screenshots && media.screenshots.length > 0) details.screenshots = media.screenshots;
          if (!details.summary && media.description) details.summary = media.description;
          if (media.genres && media.genres.length > 0) details.categories = media.genres;
          details.developer = media.developer || '';
          details.publisher = media.publisher || '';
          details.releaseDate = media.releaseDate || '';
          if (media.requirements) details.requirements = media.requirements;
        }
      } catch (e) {}
    }
    return { success: Boolean(details), game: details };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Steam Store Media & Artwork Handlers
ipcMain.handle('get-game-media', async (event, gameName, slug) => {
  try {
    const media = await getGameMedia(gameName, slug, app.getPath('userData'));
    return { success: true, media };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('batch-get-game-media', async (event, games) => {
  try {
    const results = await batchGetGameMedia(games, app.getPath('userData'));
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-cached-games', () => {
  return loadCachedGames(app.getPath('userData'));
});

ipcMain.handle('fetch-categories', async () => {
  try {
    const cats = await fetchCategories();
    return { success: true, categories: cats };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Download Manager handlers (Clean serialization guaranteed)
ipcMain.handle('start-download', async (event, downloadParams) => {
  try {
    const settings = loadSettings();
    const task = await downloadManager.startDownload({
      ...downloadParams,
      targetDir: settings.downloadDir,
      autoExtract: settings.autoExtract
    });
    return { success: true, task };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pause-download', (event, id) => {
  return downloadManager.pauseDownload(id);
});

ipcMain.handle('resume-download', async (event, id) => {
  return downloadManager.resumeDownload(id);
});

ipcMain.handle('cancel-download', (event, id) => {
  return downloadManager.cancelDownload(id);
});

ipcMain.handle('delete-download-task', (event, { id, deleteFile }) => {
  return downloadManager.deleteTask(id, deleteFile);
});

ipcMain.handle('retry-download', async (event, id) => {
  return downloadManager.retryDownload(id);
});

ipcMain.handle('clear-download-history', () => {
  return downloadManager.clearHistory();
});

ipcMain.handle('get-active-downloads', () => {
  return downloadManager ? downloadManager.getAllTasks() : [];
});

ipcMain.handle('get-download-history', () => {
  return downloadManager ? downloadManager.getHistory() : [];
});

ipcMain.handle('reveal-download-folder', (event, id) => {
  return downloadManager.revealInFolder(id);
});

ipcMain.handle('get-disk-info', async () => {
  try {
    const settings = loadSettings();
    const dir = settings.downloadDir;
    if (fs.statfs) {
      const stats = await fs.promises.statfs(dir);
      const freeBytes = stats.bavail * stats.bsize;
      const totalBytes = stats.blocks * stats.bsize;
      return { success: true, freeBytes, totalBytes, dir };
    }
  } catch (e) {}
  return { success: false };
});

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { success: false, message: 'Updater not initialized' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) {
    autoUpdater.quitAndInstall(false, true);
    return true;
  }
  return false;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// =========================================================
// Game Dependencies Installer (DirectX, VC++, .NET, OpenAL, XNA)
// =========================================================
const { spawn } = require('child_process');

const GAME_DEPENDENCIES = [
  {
    id: 'dotnet4',
    name: '.NET Framework 4.0',
    desc: 'Required for modern games',
    url: 'https://download.microsoft.com/download/9/5/A/95A9616B-7A37-4AF6-BC21-DAAB98C27C52/dotNetFx40_Full_setup.exe',
    fileName: 'dotNetFx40_Full_setup.exe'
  },
  {
    id: 'directx',
    name: 'DirectX',
    desc: 'Graphics and multimedia',
    url: 'https://download.microsoft.com/download/1/7/1/1718CCC4-6316-4487-951A-114CB810A09A/dxwebsetup.exe',
    fileName: 'dxwebsetup.exe'
  },
  {
    id: 'openal',
    name: 'OpenAL',
    desc: 'Audio processing',
    url: 'https://www.openal.org/downloads/oalinst.zip',
    fileName: 'oalinst.zip',
    isZip: true,
    exeInside: 'oalinst.exe'
  },
  {
    id: 'vcredist',
    name: 'Visual C++ Redistributable',
    desc: 'Runtime components',
    url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
    fileName: 'vc_redist.x64.exe'
  },
  {
    id: 'xna',
    name: 'XNA Framework',
    desc: 'Game development framework',
    url: 'https://download.microsoft.com/download/A/C/2/AC2C903B-5082-497D-BCBF-D49798782970/xnafx40_redist.msi',
    fileName: 'xnafx40_redist.msi',
    isMsi: true
  }
];

function getRedistDir() {
  const dir = path.join(app.getPath('userData'), 'redist');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function downloadRedistFile(url, destPath, onProgress) {
  const axios = require('axios');
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const totalBytes = parseInt(response.headers['content-length'] || 0, 10);
  let receivedBytes = 0;
  const writer = fs.createWriteStream(destPath);

  response.data.on('data', chunk => {
    receivedBytes += chunk.length;
    if (totalBytes > 0 && onProgress) {
      onProgress(Math.round((receivedBytes / totalBytes) * 100));
    }
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function launchInstaller(filePath, isMsi) {
  return new Promise((resolve) => {
    try {
      if (isMsi) {
        const proc = spawn('msiexec', ['/i', filePath, '/passive', '/norestart'], {
          detached: true,
          stdio: 'ignore'
        });
        proc.unref();
        resolve(true);
      } else {
        const proc = spawn(filePath, ['/passive', '/norestart'], {
          detached: true,
          stdio: 'ignore'
        });
        proc.on('error', () => {
          shell.openPath(filePath);
        });
        proc.unref();
        resolve(true);
      }
    } catch (e) {
      shell.openPath(filePath);
      resolve(true);
    }
  });
}

ipcMain.handle('get-dependencies-list', () => {
  const redistDir = getRedistDir();
  return GAME_DEPENDENCIES.map(dep => {
    const filePath = path.join(redistDir, dep.fileName);
    return {
      ...dep,
      downloaded: fs.existsSync(filePath)
    };
  });
});

ipcMain.handle('install-dependency', async (event, depId) => {
  const dep = GAME_DEPENDENCIES.find(d => d.id === depId);
  if (!dep) return { success: false, error: 'Dependency not found' };

  const redistDir = getRedistDir();
  const filePath = path.join(redistDir, dep.fileName);

  try {
    sendToRenderer('dependency-progress', { id: dep.id, status: 'downloading', percent: 0, message: `Downloading ${dep.name}...` });
    if (!fs.existsSync(filePath)) {
      await downloadRedistFile(dep.url, filePath, (percent) => {
        sendToRenderer('dependency-progress', { id: dep.id, status: 'downloading', percent, message: `Downloading ${dep.name}: ${percent}%` });
      });
    }

    sendToRenderer('dependency-progress', { id: dep.id, status: 'installing', percent: 100, message: `Installing ${dep.name}...` });

    let targetExec = filePath;
    if (dep.isZip) {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(filePath);
        zip.extractAllTo(redistDir, true);
        if (dep.exeInside) targetExec = path.join(redistDir, dep.exeInside);
      } catch (e) {}
    }

    await launchInstaller(targetExec, dep.isMsi);
    sendToRenderer('dependency-progress', { id: dep.id, status: 'completed', percent: 100, message: `${dep.name} installed.` });
    return { success: true };
  } catch (err) {
    sendToRenderer('dependency-progress', { id: dep.id, status: 'error', percent: 0, message: `Error: ${err.message}` });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-all-dependencies', async () => {
  const redistDir = getRedistDir();
  for (const dep of GAME_DEPENDENCIES) {
    try {
      const filePath = path.join(redistDir, dep.fileName);
      sendToRenderer('dependency-progress', { id: dep.id, status: 'downloading', percent: 0, message: `Downloading ${dep.name}...` });
      if (!fs.existsSync(filePath)) {
        await downloadRedistFile(dep.url, filePath, (percent) => {
          sendToRenderer('dependency-progress', { id: dep.id, status: 'downloading', percent, message: `Downloading ${dep.name}: ${percent}%` });
        });
      }

      sendToRenderer('dependency-progress', { id: dep.id, status: 'installing', percent: 100, message: `Installing ${dep.name}...` });
      let targetExec = filePath;
      if (dep.isZip) {
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(filePath);
          zip.extractAllTo(redistDir, true);
          if (dep.exeInside) targetExec = path.join(redistDir, dep.exeInside);
        } catch (e) {}
      }
      await launchInstaller(targetExec, dep.isMsi);
      sendToRenderer('dependency-progress', { id: dep.id, status: 'completed', percent: 100, message: `${dep.name} installed.` });
    } catch (err) {
      sendToRenderer('dependency-progress', { id: dep.id, status: 'error', percent: 0, message: `Error: ${err.message}` });
    }
  }
  return { success: true };
});

// =========================================================
// Installed Game Library Manager & Auto-Runner
// =========================================================
function getLibraryPath() {
  return path.join(app.getPath('userData'), 'library.json');
}

function sanitizeAndDeduplicateLibrary(items) {
  if (!Array.isArray(items)) return [];

  // 1. Remove template games and phantom games whose directories do not exist
  let filtered = items.filter(g => {
    if (!g || !g.name) return false;
    const norm = g.name.toLowerCase().trim();
    if (g.id === 'a-way-out-free-download' || g.id === 'dying-light-the-following') return false;
    if (g.slug === 'a-way-out-free-download' || g.slug === 'dying-light-the-following') return false;
    if (norm === 'a way out' || norm.startsWith('dying light the following')) {
      if (!g.installDir || !fs.existsSync(g.installDir)) return false;
    }
    const hasDir = g.installDir && fs.existsSync(g.installDir);
    const hasExe = g.executablePath && fs.existsSync(g.executablePath);
    if (!hasDir && !hasExe) return false;
    return true;
  });

  // 2. Deduplicate by executable path (prevent multiple entries pointing to the same game)
  const byExe = new Map();
  for (const item of filtered) {
    const exeKey = item.executablePath ? path.normalize(item.executablePath).toLowerCase() : item.id;
    if (!byExe.has(exeKey)) {
      byExe.set(exeKey, item);
    } else {
      const existing = byExe.get(exeKey);
      // Prefer entry with longer name (e.g. "MECCHA CHAMELEON" > "Chameleon")
      if ((item.name || '').length > (existing.name || '').length) {
        byExe.set(exeKey, { ...existing, ...item, id: existing.id || item.id });
      }
    }
  }

  // 3. Deduplicate by normalized name
  const result = [];
  const seenNames = new Set();
  for (const item of byExe.values()) {
    const normName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normName && seenNames.has(normName)) continue;
    if (normName) seenNames.add(normName);
    result.push(item);
  }

  return result;
}

function loadLibrary() {
  try {
    const p = getLibraryPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return sanitizeAndDeduplicateLibrary(data);
    }
  } catch (e) {
    console.error('[Library] Load error:', e.message);
  }
  return [];
}

function saveLibrary(items) {
  try {
    const sanitized = sanitizeAndDeduplicateLibrary(items);
    fs.writeFileSync(getLibraryPath(), JSON.stringify(sanitized, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[Library] Save error:', e.message);
    return false;
  }
}

async function syncCompletedDownloadsWithLibrary() {
  let library = loadLibrary();
  let modified = false;

  // Gather history from downloadManager and disk
  let history = [];
  if (downloadManager && Array.isArray(downloadManager.history)) {
    history = [...downloadManager.history];
  }
  const settings = loadSettings();
  const historyFile = path.join(settings.downloadDir, '.xero_downloads.json');
  if (fs.existsSync(historyFile)) {
    try {
      const diskHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (Array.isArray(diskHistory)) {
        for (const dh of diskHistory) {
          if (!history.some(h => h.id === dh.id || (h.filePath && h.filePath === dh.filePath))) {
            history.push(dh);
          }
        }
      }
    } catch (e) {}
  }

  // Check each completed download
  for (const dl of history) {
    if (!dl.gameName) continue;
    const cleanName = dl.gameName.trim();
    const normName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Look for where files are on disk
    let targetDir = null;
    if (dl.extractedPath && fs.existsSync(dl.extractedPath)) {
      targetDir = dl.extractedPath;
    } else if (dl.filePath && fs.existsSync(dl.filePath)) {
      const baseDir = path.dirname(dl.filePath);
      const nameNoExt = dl.fileName ? dl.fileName.replace(/\.(rar|zip|7z|exe)$/i, '') : cleanName;
      const candidates = [
        path.join(baseDir, nameNoExt),
        path.join(baseDir, cleanName),
        path.join(settings.downloadDir, nameNoExt),
        path.join(settings.downloadDir, cleanName),
        baseDir
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
          targetDir = cand;
          break;
        }
      }
    }

    if (!targetDir && dl.filePath && fs.existsSync(dl.filePath)) {
      targetDir = path.dirname(dl.filePath);
    }

    if (!targetDir || !fs.existsSync(targetDir)) continue;

    const bestExe = findBestExecutable(targetDir, cleanName);
    const existing = library.find(g => {
      const gNorm = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sameExe = bestExe && g.executablePath && path.normalize(g.executablePath).toLowerCase() === path.normalize(bestExe.fullPath).toLowerCase();
      return gNorm === normName || sameExe;
    });

    // Resolve real Steam artwork & metadata
    let media = null;
    try {
      media = await getGameMedia(cleanName, cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-'), app.getPath('userData'));
    } catch (e) {}

    const cover = media?.portraitImage || media?.headerImage || media?.screenshots?.[0] || null;
    const banner = media?.screenshots?.[0] || media?.headerImage || null;
    const isRepack = Boolean(dl.isRepack || (bestExe && bestExe.isRepack));

    if (!existing) {
      const newEntry = {
        id: `game_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: cleanName,
        title: cleanName,
        slug: cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        steamAppId: media?.appId ? String(media.appId) : null,
        version: 'Latest',
        size: dl.totalBytes ? (dl.totalBytes > 1024 * 1024 * 1024 ? (dl.totalBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : (dl.totalBytes / (1024 * 1024)).toFixed(0) + ' MB') : 'Installed',
        installDir: targetDir,
        primaryExecutable: bestExe ? bestExe.name : (dl.fileName && dl.fileName.endsWith('.exe') ? dl.fileName : 'Game.exe'),
        executablePath: bestExe ? bestExe.fullPath : (dl.filePath && dl.filePath.endsWith('.exe') ? dl.filePath : ''),
        launchOptions: '',
        coverImage: cover,
        bannerImage: banner,
        isRepack,
        gameType: isRepack ? 'repack' : 'preinstalled',
        isFavorite: false,
        playLater: false,
        isNew: true,
        lastPlayed: null,
        playTimeFormatted: 'Never Played',
        summary: media?.description || `Full installed edition of ${cleanName}.`,
        dateAdded: dl.completedAt || new Date().toISOString()
      };
      library.unshift(newEntry);
      modified = true;
    } else {
      let itemChanged = false;
      if (!existing.coverImage || existing.coverImage.includes('header.jpg') || existing.coverImage.includes('unsplash')) {
        if (cover) {
          existing.coverImage = cover;
          existing.bannerImage = banner;
          itemChanged = true;
        }
      }
      if (!existing.executablePath && bestExe) {
        existing.executablePath = bestExe.fullPath;
        existing.primaryExecutable = bestExe.name;
        itemChanged = true;
      }
      if (itemChanged) modified = true;
    }
  }

  // 2. Scan physical folders in settings.downloadDir to auto-detect extracted / existing games
  if (fs.existsSync(settings.downloadDir)) {
    try {
      const dirEntries = fs.readdirSync(settings.downloadDir, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'parts') continue;

        const folderPath = path.join(settings.downloadDir, entry.name);
        const folderName = entry.name
          .replace(/-SteamRIP\.com$/i, '')
          .replace(/\(FitGirl Repack\)$/i, '')
          .replace(/[_-]/g, ' ')
          .trim();
        const normName = folderName.toLowerCase().replace(/[^a-z0-9]/g, '');

        const bestExe = findBestExecutable(folderPath, folderName);
        if (!bestExe) continue;

        const alreadyInLib = library.some(g => {
          const gNorm = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const sameExe = g.executablePath && path.normalize(g.executablePath).toLowerCase() === path.normalize(bestExe.fullPath).toLowerCase();
          const sameDir = g.installDir && path.normalize(g.installDir).toLowerCase() === path.normalize(folderPath).toLowerCase();
          return gNorm === normName || sameExe || sameDir;
        });

        if (!alreadyInLib) {
          let media = null;
          try {
            media = await getGameMedia(folderName, folderName.toLowerCase().replace(/[^a-z0-9]/g, '-'), app.getPath('userData'));
          } catch (e) {}

          const cover = media?.portraitImage || media?.headerImage || null;
          const banner = media?.screenshots?.[0] || media?.headerImage || null;
          const isRepack = bestExe.name.toLowerCase() === 'setup.exe' || entry.name.toLowerCase().includes('fitgirl');

          library.unshift({
            id: `disc_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name: media?.name || folderName,
            title: media?.name || folderName,
            slug: folderName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            steamAppId: media?.appId ? String(media.appId) : null,
            version: 'Installed',
            size: 'Installed',
            installDir: folderPath,
            primaryExecutable: bestExe.name,
            executablePath: bestExe.fullPath,
            launchOptions: '',
            coverImage: cover,
            bannerImage: banner,
            isRepack,
            gameType: isRepack ? 'repack' : 'preinstalled',
            isFavorite: false,
            playLater: false,
            isNew: true,
            lastPlayed: null,
            playTimeFormatted: 'Never Played',
            summary: media?.description || `Full installed edition of ${folderName}.`,
            dateAdded: new Date().toISOString()
          });
          modified = true;
        }
      }
    } catch (err) {
      console.warn('[Library Auto-Discovery] Folder scan error:', err.message);
    }
  }

  // Verify all items have 600x900 portrait cover art
  for (const g of library) {
    if (!g.coverImage || g.coverImage.includes('header.jpg') || g.coverImage.includes('unsplash') || g.coverImage.includes('239140')) {
      try {
        const m = await getGameMedia(g.name, g.slug, app.getPath('userData'));
        if (m && (m.portraitImage || m.headerImage)) {
          g.coverImage = m.portraitImage || m.headerImage;
          g.bannerImage = m.screenshots?.[0] || m.headerImage;
          g.steamAppId = String(m.appId);
          modified = true;
        }
      } catch (e) {}
    }
  }

  const cleaned = sanitizeAndDeduplicateLibrary(library);
  saveLibrary(cleaned);
  sendToRenderer('library-updated', cleaned);
  return cleaned;
}

function scanForExecutables(dirPath, maxDepth = 4, currentDepth = 0) {
  const results = [];
  if (currentDepth > maxDepth || !fs.existsSync(dirPath)) return results;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nameLower = entry.name.toLowerCase();
        if (['redist', '_redist', 'directx', 'support', 'crashreport', 'unitycrashhandler'].includes(nameLower)) continue;
        results.push(...scanForExecutables(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        const nameLower = entry.name.toLowerCase();
        if (
          nameLower.includes('unins') ||
          nameLower.includes('crash') ||
          nameLower.includes('dxwebsetup') ||
          nameLower.includes('vcredist') ||
          nameLower.includes('dotnet') ||
          nameLower.includes('oalinst') ||
          nameLower.includes('unitycrashhandler')
        ) {
          continue;
        }
        try {
          const stats = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            fullPath,
            size: stats.size,
            depth: currentDepth,
            isRepack: nameLower === 'setup.exe'
          });
        } catch (e) {}
      }
    }
  } catch (e) {}
  return results;
}

function findBestExecutable(dirPath, gameName = '') {
  const exes = scanForExecutables(dirPath);
  if (exes.length === 0) return null;

  const cleanGameName = (gameName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nonSetupExes = exes.filter(e => !e.isRepack);
  const pool = nonSetupExes.length > 0 ? nonSetupExes : exes;

  pool.sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const cleanA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleanGameName && cleanA.includes(cleanGameName)) scoreA += 150;
    if (cleanGameName && cleanB.includes(cleanGameName)) scoreB += 150;

    if (cleanA.includes('shipping')) scoreA += 80;
    if (cleanB.includes('shipping')) scoreB += 80;

    scoreA += Math.max(0, (4 - (a.depth || 0)) * 25);
    scoreB += Math.max(0, (4 - (b.depth || 0)) * 25);

    if (a.size > 2 * 1024 * 1024) scoreA += 40;
    if (b.size > 2 * 1024 * 1024) scoreB += 40;
    scoreA += Math.min(30, Math.floor(a.size / (1024 * 1024)));
    scoreB += Math.min(30, Math.floor(b.size / (1024 * 1024)));

    return scoreB - scoreA;
  });

  return pool[0];
}

ipcMain.handle('get-library', () => {
  return loadLibrary();
});

ipcMain.handle('rescan-installed-games', async () => {
  const updated = await syncCompletedDownloadsWithLibrary();
  return { success: true, count: updated.length, library: updated };
});

ipcMain.handle('save-library-item', (event, item) => {
  const library = loadLibrary();
  const idx = library.findIndex(g => g.id === item.id);
  if (idx !== -1) {
    library[idx] = { ...library[idx], ...item };
  } else {
    library.unshift(item);
  }
  saveLibrary(library);
  sendToRenderer('library-updated', library);
  return { success: true, library };
});

ipcMain.handle('remove-library-item', (event, { id, deleteFiles }) => {
  const library = loadLibrary();
  const item = library.find(g => g.id === id);
  if (item && deleteFiles && item.installDir && fs.existsSync(item.installDir)) {
    try {
      fs.rmSync(item.installDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Library] Failed to delete directory:', e.message);
    }
  }
  const filtered = library.filter(g => g.id !== id);
  saveLibrary(filtered);
  sendToRenderer('library-updated', filtered);
  return { success: true, library: filtered };
});

ipcMain.handle('launch-game', async (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  if (!game) return { success: false, error: 'Game not found in library' };

  let exePath = game.executablePath;
  if (!exePath || !fs.existsSync(exePath)) {
    if (game.installDir && fs.existsSync(game.installDir)) {
      const best = findBestExecutable(game.installDir, game.name);
      if (best) {
        exePath = best.fullPath;
        game.executablePath = best.fullPath;
        game.primaryExecutable = best.name;
        saveLibrary(library);
      }
    }
  }

  if (!exePath || !fs.existsSync(exePath)) {
    // If not found, open file picker to let the user select it directly
    const res = await dialog.showOpenDialog(mainWindow, {
      title: `Select Executable (.exe) for ${game.name}`,
      defaultPath: game.installDir && fs.existsSync(game.installDir) ? game.installDir : undefined,
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      exePath = res.filePaths[0];
      game.executablePath = exePath;
      game.primaryExecutable = path.basename(exePath);
      saveLibrary(library);
    } else {
      return { success: false, error: 'Executable not selected. Please locate the game .exe to play.' };
    }
  }

  try {
    const launchArgs = (game.launchOptions || '').trim().split(/\s+/).filter(Boolean);
    const proc = spawn(exePath, launchArgs, {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    game.lastPlayed = new Date().toISOString();
    game.playCount = (game.playCount || 0) + 1;
    game.isNew = false;
    saveLibrary(library);
    sendToRenderer('library-updated', library);

    // Update Discord Presence
    try {
      discordRpc.setPlayingActivity(game.name, Date.now(), game.coverImage);
    } catch (e) {}

    return { success: true, pid: proc.pid, exeName: path.basename(exePath) };
  } catch (err) {
    return { success: false, error: `Failed to launch executable: ${err.message}` };
  }
});

ipcMain.handle('open-game-directory', (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  if (game && game.installDir && fs.existsSync(game.installDir)) {
    shell.openPath(game.installDir);
    return { success: true };
  }
  if (game && game.executablePath && fs.existsSync(game.executablePath)) {
    shell.showItemInFolder(game.executablePath);
    return { success: true };
  }
  return { success: false, error: 'Game directory does not exist or has not been installed yet.' };
});

ipcMain.handle('select-game-executable', async (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  const defaultPath = game && game.installDir && fs.existsSync(game.installDir) ? game.installDir : undefined;

  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Executable (.exe)',
    defaultPath,
    filters: [{ name: 'Game Executable', extensions: ['exe'] }],
    properties: ['openFile']
  });

  if (!res.canceled && res.filePaths.length > 0) {
    const chosen = res.filePaths[0];
    if (game) {
      game.executablePath = chosen;
      game.primaryExecutable = path.basename(chosen);
      saveLibrary(library);
      sendToRenderer('library-updated', library);
    }
    return { success: true, executablePath: chosen, fileName: path.basename(chosen) };
  }
  return { success: false };
});

ipcMain.handle('select-game-folder-manual', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Folder to Add to Library',
    properties: ['openDirectory']
  });

  if (!res.canceled && res.filePaths.length > 0) {
    const folderPath = res.filePaths[0];
    const folderName = path.basename(folderPath);
    const bestExe = findBestExecutable(folderPath, folderName);

    const library = loadLibrary();
    // Check if already in library
    const normName = folderName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = library.find(g => {
      const gNorm = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sameExe = bestExe && g.executablePath && path.normalize(g.executablePath).toLowerCase() === path.normalize(bestExe.fullPath).toLowerCase();
      const sameDir = g.installDir && path.normalize(g.installDir).toLowerCase() === path.normalize(folderPath).toLowerCase();
      return gNorm === normName || sameExe || sameDir;
    });

    if (existing) {
      return { success: true, game: existing, alreadyExists: true };
    }

    let totalBytes = 0;
    try {
      const files = fs.readdirSync(folderPath);
      for (const f of files) {
        try {
          const s = fs.statSync(path.join(folderPath, f));
          totalBytes += s.size;
        } catch (e) {}
      }
    } catch (e) {}

    const sizeFormatted = totalBytes > 1024 * 1024 * 1024
      ? (totalBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
      : (totalBytes / (1024 * 1024)).toFixed(0) + ' MB';

    // Fetch real Steam media
    let media = null;
    try {
      media = await getGameMedia(folderName, folderName.toLowerCase().replace(/[^a-z0-9]/g, '-'), app.getPath('userData'));
    } catch (e) {}

    const newItem = {
      id: `manual_${Date.now()}`,
      name: media?.name || folderName,
      title: media?.name || folderName,
      slug: folderName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      steamAppId: media?.appId ? String(media.appId) : null,
      version: 'Installed',
      size: sizeFormatted,
      installDir: folderPath,
      primaryExecutable: bestExe ? bestExe.name : 'Game.exe',
      executablePath: bestExe ? bestExe.fullPath : '',
      launchOptions: '',
      coverImage: media?.headerImage || media?.screenshots?.[0] || null,
      bannerImage: media?.screenshots?.[0] || media?.headerImage || null,
      isFavorite: false,
      playLater: false,
      isNew: true,
      lastPlayed: null,
      playTimeFormatted: 'Never Played',
      summary: media?.description || `Full installed edition of ${folderName}.`,
      dateAdded: new Date().toISOString()
    };

    library.unshift(newItem);
    saveLibrary(library);
    sendToRenderer('library-updated', library);
    return { success: true, game: newItem };
  }
  return { success: false };
});

ipcMain.handle('verify-game-files', async (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  if (!game) return { success: false, error: 'Game not found in library' };

  if (!game.installDir || !fs.existsSync(game.installDir)) {
    return { success: false, error: 'Game installation folder does not exist or was moved.' };
  }

  try {
    let fileCount = 0;
    let totalBytes = 0;
    function countDir(d, depth = 0) {
      if (depth > 4) return;
      const list = fs.readdirSync(d, { withFileTypes: true });
      for (const item of list) {
        if (item.isDirectory()) {
          countDir(path.join(d, item.name), depth + 1);
        } else {
          fileCount++;
          try { totalBytes += fs.statSync(path.join(d, item.name)).size; } catch (e) {}
        }
      }
    }
    countDir(game.installDir);

    const hasExe = game.executablePath && fs.existsSync(game.executablePath);
    const sizeStr = (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

    return {
      success: true,
      fileCount,
      sizeFormatted: sizeStr,
      executableValid: Boolean(hasExe),
      executableName: game.primaryExecutable || (hasExe ? path.basename(game.executablePath) : 'Missing')
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('create-desktop-shortcut', async (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  if (!game || !game.executablePath || !fs.existsSync(game.executablePath)) {
    return { success: false, error: 'Game executable not found to create shortcut' };
  }

  try {
    const desktop = app.getPath('desktop');
    const cleanName = game.name.replace(/[^a-zA-Z0-9 _-]/g, '');
    const shortcutPath = path.join(desktop, `${cleanName}.lnk`);

    const psScript = `
$WshShell = New-Object -comObject WScript.Shell;
$Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}");
$Shortcut.TargetPath = "${game.executablePath.replace(/\\/g, '\\\\')}";
$Shortcut.WorkingDirectory = "${path.dirname(game.executablePath).replace(/\\/g, '\\\\')}";
$Shortcut.Save();
`;

    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript]);
    return new Promise((resolve) => {
      proc.on('close', (code) => {
        resolve({ success: code === 0, shortcutPath });
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// =========================================================
// Dual-Source Game Resolution (SteamRIP Buzzheavier + FitGirl Repacks)
// =========================================================
ipcMain.handle('get-game-sources', async (event, gameName, slugOrId) => {
  try {
    const cleanTitle = (gameName || slugOrId || '').replace(/[-_]/g, ' ').trim();
    let steamripDetails = null;
    let fitgirlRepacks = [];

    // Instant lookup in pre-indexed full catalog
    const allGames = loadFullGamesIndex(app.getPath('userData'));
    const indexed = allGames.find(g => 
      (slugOrId && (g.id === slugOrId || g.slug === slugOrId)) ||
      (gameName && g.name.toLowerCase() === gameName.toLowerCase()) ||
      (cleanTitle && g.name.toLowerCase().includes(cleanTitle.toLowerCase()))
    );

    let hasSteamrip = indexed ? Boolean(indexed.hasSteamrip) : true;
    let hasFitgirl = indexed ? Boolean(indexed.hasFitgirl) : false;
    let fitgirlUrl = indexed?.fitgirlUrl || null;

    if (hasFitgirl && fitgirlUrl) {
      fitgirlRepacks.push({
        title: indexed.name,
        cleanName: indexed.name,
        url: fitgirlUrl,
        source: 'fitgirl'
      });
    }

    // 1. Query SteamRIP if hasSteamrip
    if (hasSteamrip) {
      try {
        if (slugOrId && !slugOrId.startsWith('fg_')) {
          steamripDetails = await fetchGameDetails(slugOrId);
        }
        if (!steamripDetails && cleanTitle) {
          const srSearch = searchFullIndex(cleanTitle, 1, 5, 'all', app.getPath('userData'));
          if (srSearch && srSearch.games && srSearch.games.length > 0 && !srSearch.games[0].id.startsWith('fg_')) {
            steamripDetails = await fetchGameDetails(srSearch.games[0].slug || srSearch.games[0].id);
          }
        }
      } catch (e) {}
    }

    // 2. Query FitGirl live scraper only if not pre-indexed
    if (!hasFitgirl && cleanTitle) {
      try {
        fitgirlRepacks = await searchFitgirlRepacks(cleanTitle);
        if (fitgirlRepacks.length > 0) {
          hasFitgirl = true;
          fitgirlUrl = fitgirlRepacks[0].url;
        }
      } catch (e) {}
    }

    return {
      success: true,
      hasSteamrip: Boolean(hasSteamrip && ((steamripDetails?.downloadLinks?.buzzheavier?.length > 0) || indexed?.hasSteamrip)),
      hasFitgirl,
      steamrip: steamripDetails,
      fitgirl: hasFitgirl ? (fitgirlRepacks[0] || { url: fitgirlUrl, title: gameName }) : null,
      fitgirlCandidates: fitgirlRepacks
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// FitGirl Repack Details (Exact Repack Features & Providers)
ipcMain.handle('get-fitgirl-details', async (event, repackUrl) => {
  try {
    const details = await getFitgirlGameDetails(repackUrl);
    return { success: Boolean(details), details };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// In-App Direct Stream Resolver (No browser redirect)
ipcMain.handle('resolve-hoster-stream', async (event, url) => {
  try {
    const resolved = await resolveInAppDirectStream(url);
    return { success: true, ...resolved };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 1-Click JDownloader FlashGot / Click'n'Load integration
ipcMain.handle('send-to-jdownloader', async (event, params) => {
  try {
    const settings = loadSettings();
    return await sendToJDownloader({
      packageName: params.packageName,
      urls: params.urls,
      downloadDir: settings.downloadDir
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-jdownloader-running', async () => {
  return await isJDownloaderRunning();
});

// Multi-Part Link List / Paste Parser
ipcMain.handle('parse-multipart-links', async (event, textOrUrl) => {
  try {
    const parts = await parseMultiPartLinks(textOrUrl);
    return { success: true, parts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start Multi-Part FitGirl Repack Download
ipcMain.handle('start-multipart-download', async (event, params) => {
  try {
    const settings = loadSettings();
    const task = downloadManager.startMultiPartDownload({
      ...params,
      targetDir: settings.downloadDir,
      autoExtract: settings.autoExtract
    });
    return { success: true, task };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start In-App BitTorrent Swarm Download
ipcMain.handle('start-torrent-download', async (event, params) => {
  try {
    const settings = loadSettings();
    const task = downloadManager.startTorrentDownload({
      ...params,
      targetDir: settings.downloadDir,
      autoExtract: settings.autoExtract
    });
    return { success: true, task };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Launch Repack Setup.exe from Library
ipcMain.handle('launch-repack-setup', async (event, gameId) => {
  const library = loadLibrary();
  const game = library.find(g => g.id === gameId);
  if (!game) return { success: false, error: 'Game not found in library' };

  let setupPath = game.executablePath;
  if (!setupPath || !fs.existsSync(setupPath)) {
    if (game.installDir && fs.existsSync(game.installDir)) {
      const exes = scanForExecutables(game.installDir, 3);
      const setup = exes.find(e => e.name.toLowerCase() === 'setup.exe');
      if (setup) setupPath = setup.fullPath;
    }
  }

  if (!setupPath || !fs.existsSync(setupPath)) {
    return { success: false, error: 'setup.exe not found in repack folder' };
  }

  try {
    const proc = spawn(setupPath, [], {
      cwd: path.dirname(setupPath),
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();
    return { success: true, pid: proc.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// System Rig, Steam Price, and Discord RPC IPC handlers
ipcMain.handle('get-system-rig', async () => {
  try {
    return await systemInfoService.getFullSystemRig();
  } catch (e) {
    return { cpu: "Detected CPU", gpu: "Dedicated GPU", ram: "16 GB RAM", os: "Windows 11" };
  }
});

ipcMain.handle('get-steam-price', async (event, { appId, title }) => {
  try {
    return await steamPriceService.getGamePrice(appId, title);
  } catch (e) {
    return { priceCents: 0, priceUSD: "0.00", formatted: "$0.00" };
  }
});

ipcMain.handle('calc-library-savings', async (event, games) => {
  try {
    return await steamPriceService.calculateSavingsForGames(games);
  } catch (e) {
    return { totalCents: 0, totalUSD: "$0.00", totalGames: 0, items: [] };
  }
});

ipcMain.handle('discord-set-activity', (event, activity) => {
  try {
    if (activity) {
      discordRpc.setActivity(activity);
    } else {
      discordRpc.setIdleActivity();
    }
  } catch (e) {}
  return { success: true };
});

// Deep link processing for kyrosphere://
function handleDeepLink(urlStr) {
  if (!urlStr) return;
  console.log('[DeepLink] Dispatching deep link:', urlStr);

  const dispatch = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    try {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
    } catch (e) {}

    try {
      let cleanUrl = String(urlStr).trim().replace(/^["']|["']$/g, '');
      let action = 'game';
      let slug = '';
      let title = '';

      try {
        const parsed = new URL(cleanUrl);
        action = parsed.hostname || 'game';
        slug = (parsed.pathname ? parsed.pathname.replace(/^\/+/, '') : '') || '';
        if (slug === action) slug = '';
        title = parsed.searchParams ? (parsed.searchParams.get('title') || '') : '';
      } catch (e) {
        const match = cleanUrl.match(/kyrosphere:\/\/([^/?#]+)(?:\/([^?#]+))?(?:\?(.*))?/i);
        if (match) {
          action = match[1] || 'game';
          slug = match[2] || '';
        }
      }

      if (!slug && action && action !== 'game' && action !== 'open' && action !== 'launch') {
        slug = action;
        action = 'game';
      }

      const searchQuery = title || (slug ? decodeURIComponent(slug).replace(/[-_]+/g, ' ') : '');

      sendToRenderer('deep-link-received', {
        action,
        slug: slug ? decodeURIComponent(slug) : '',
        title: title ? decodeURIComponent(title) : '',
        query: searchQuery,
        rawUrl: cleanUrl
      });
    } catch (err) {
      console.error('[DeepLink] Error handling deep link:', err);
      sendToRenderer('deep-link-received', { action: 'open', rawUrl: urlStr });
    }
  };

  if (!mainWindow || mainWindow.webContents.isLoading()) {
    setTimeout(dispatch, 1200);
  } else {
    dispatch();
  }
}

// Enforce single instance lock for deep link forwarding
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[App] Secondary instance detected. Quitting to preserve primary instance.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    console.log('[App] Second instance invoked with arguments:', commandLine);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      const deepLinkUrl = commandLine.find(arg => typeof arg === 'string' && arg.toLowerCase().startsWith('kyrosphere://'));
      if (deepLinkUrl) {
        handleDeepLink(deepLinkUrl);
      }
    }
  });

  // macOS open-url handler
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    createWindow();

    // Check cold-start deep link argument in process.argv
    const deepLinkUrl = process.argv.find(arg => typeof arg === 'string' && arg.toLowerCase().startsWith('kyrosphere://'));
    if (deepLinkUrl) {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => handleDeepLink(deepLinkUrl), 800);
      });
    }
  });
}

app.on('will-quit', () => {
  try {
    discordRpc.destroy();
  } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
