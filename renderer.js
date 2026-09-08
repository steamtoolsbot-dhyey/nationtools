const { ipcRenderer } = require('electron');

// State
let currentLibrary = [];
let customDownloadDir = localStorage.getItem('customDownloadDir') || '';
let isLiteMode = localStorage.getItem('liteMode') === 'true';

// Apply lite mode class immediately (synchronous, before particles run)
if (isLiteMode) {
    document.body.classList.add('lite-mode');
}

// ==========================================
// Lite Mode Initialization (async confirmation + toggle handler)
// ==========================================
(async function initLiteMode() {
    // Confirm with main process (source of truth)
    const mainLiteMode = await ipcRenderer.invoke('get-lite-mode');
    if (mainLiteMode !== isLiteMode) {
        isLiteMode = mainLiteMode;
        localStorage.setItem('liteMode', isLiteMode ? 'true' : 'false');
        if (isLiteMode) {
            document.body.classList.add('lite-mode');
        } else {
            document.body.classList.remove('lite-mode');
        }
    }
    // Set toggle checkbox state for both locations
    const toggles = [
        document.getElementById('liteModeToggleSmall'),
        document.getElementById('liteModeToggleSettings')
    ];
    
    toggles.forEach(toggle => {
        if (toggle) {
            toggle.checked = isLiteMode;
            toggle.addEventListener('change', async () => {
                const enabled = toggle.checked;
                localStorage.setItem('liteMode', enabled ? 'true' : 'false');
                await ipcRenderer.invoke('toggle-lite-mode', enabled);
                // Restart the app to apply the frame change
                ipcRenderer.invoke('restart-app');
            });
        }
    });
})();

// ==========================================
// Theme System
// ==========================================
(function initThemeSystem() {
    // Helper: hex color to rgba string
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    const themes = [
        // ── Default (Original) ──
        { id: 'default',    name: 'Default',     bg: '#0a0a0a', panel: '#1a1a1f', accent: '#e9590c', titlebar: '#08080c', header: '#0a0a0a', sidebar: '#0c0c0c' },
        // ── Blues ──
        { id: 'ocean',      name: 'Deep Ocean',  bg: '#060d18', panel: '#0c1828', accent: '#2563eb', titlebar: '#040910', header: '#060d18', sidebar: '#081020' },
        { id: 'midnight',   name: 'Midnight',    bg: '#020410', panel: '#080c1e', accent: '#6366f1', titlebar: '#01020a', header: '#020410', sidebar: '#050816' },
        { id: 'steam',      name: 'Steam',       bg: '#0e1820', panel: '#141e2c', accent: '#66c0f4', titlebar: '#0a1218', header: '#0e1820', sidebar: '#0c1620' },
        { id: 'arctic',     name: 'Arctic',      bg: '#060e16', panel: '#0c1822', accent: '#06b6d4', titlebar: '#040a10', header: '#060e16', sidebar: '#08121c' },
        // ── Greens ──
        { id: 'forest',     name: 'Forest',      bg: '#060e06', panel: '#0c180c', accent: '#16a34a', titlebar: '#040a04', header: '#060e06', sidebar: '#081208' },
        { id: 'neon',       name: 'Neon',        bg: '#030308', panel: '#06061a', accent: '#00ff88', titlebar: '#020206', header: '#030308', sidebar: '#050512' },
        // ── Reds / Warm ──
        { id: 'fire',       name: 'Ember',       bg: '#100604', panel: '#1c0e08', accent: '#dc2626', titlebar: '#0a0402', header: '#100604', sidebar: '#140a06' },
        { id: 'rose',       name: 'Rose',        bg: '#0e060a', panel: '#1a0c14', accent: '#e11d48', titlebar: '#0a0408', header: '#0e060a', sidebar: '#120810' },
        { id: 'cherry',     name: 'Cherry',      bg: '#0c050a', panel: '#180a14', accent: '#ec4899', titlebar: '#08040a', header: '#0c050a', sidebar: '#100810' },
        // ── Purple ──
        { id: 'purple',     name: 'Violet',      bg: '#08050e', panel: '#100a1c', accent: '#8b5cf6', titlebar: '#06040a', header: '#08050e', sidebar: '#0c0816' },
        { id: 'grape',      name: 'Grape',       bg: '#0a0610', panel: '#140c20', accent: '#a855f7', titlebar: '#06040c', header: '#0a0610', sidebar: '#0e0a18' },
        // ── Gold / Bronze ──
        { id: 'gold',       name: 'Gold',        bg: '#0e0c04', panel: '#1a1608', accent: '#ca8a04', titlebar: '#0a0804', header: '#0e0c04', sidebar: '#121006' },
        { id: 'bronze',     name: 'Bronze',      bg: '#0c0a04', panel: '#18140a', accent: '#b45309', titlebar: '#080604', header: '#0c0a04', sidebar: '#100e08' },
        // ── Special ──
        { id: 'cyberpunk',  name: 'Cyberpunk',   bg: '#06060c', panel: '#0c0c1e', accent: '#eab308', titlebar: '#04040a', header: '#06060c', sidebar: '#0a0a16' },
        { id: 'graphite',   name: 'Graphite',    bg: '#0c0c0e', panel: '#16161a', accent: '#71717a', titlebar: '#08080a', header: '#0c0c0e', sidebar: '#101012' },
    ];

    const savedTheme = localStorage.getItem('appTheme') || 'default';

    function applyTheme(themeId) {
        const theme = themes.find(t => t.id === themeId) || themes[0];
        const root = document.documentElement;

        // Core backgrounds
        root.style.setProperty('--bg-color', theme.bg);
        root.style.setProperty('--bg-dark', theme.bg);
        root.style.setProperty('--bg-panel', theme.panel);

        // Accent colors
        root.style.setProperty('--accent', theme.accent);
        root.style.setProperty('--accent-glow', hexToRgba(theme.accent, 0.6));
        root.style.setProperty('--dynamic-glow', theme.accent);
        root.style.setProperty('--dynamic-bg', hexToRgba(theme.accent, 0.05));

        // Titlebar, header, sidebar
        root.style.setProperty('--titlebar-bg', hexToRgba(theme.titlebar, 0.98));
        root.style.setProperty('--header-bg', `linear-gradient(135deg, ${hexToRgba(theme.header, 0.98)} 0%, ${hexToRgba(theme.panel, 0.95)} 100%)`);
        root.style.setProperty('--sidebar-bg', hexToRgba(theme.sidebar, 0.95));

        // Glass
        root.style.setProperty('--glass-bg', hexToRgba(theme.panel, 0.4));
        root.style.setProperty('--glass-border', hexToRgba(theme.accent, 0.08));

        // Body background
        document.body.style.backgroundColor = theme.bg;

        localStorage.setItem('appTheme', themeId);

        // Update active state on cards
        document.querySelectorAll('.theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.theme === themeId);
        });
    }

    function renderThemeCards() {
        const grid = document.getElementById('themeGrid');
        if (!grid) return;
        grid.innerHTML = '';

        themes.forEach(theme => {
            const card = document.createElement('div');
            card.className = 'theme-card' + (theme.id === savedTheme ? ' active' : '');
            card.dataset.theme = theme.id;
            card.innerHTML = `
                <div class="theme-card-preview" style="background: ${theme.bg};">
                    <div class="swatch swatch-sidebar" style="background: ${theme.sidebar};"></div>
                    <div class="swatch swatch-header" style="background: ${theme.panel};"></div>
                    <div class="swatch swatch-accent" style="background: ${theme.accent};"></div>
                </div>
                <div class="theme-card-name">${theme.name}</div>
            `;
            card.addEventListener('click', () => applyTheme(theme.id));
            grid.appendChild(card);
        });
    }

    // Show All Themes toggle
    const btnShowAll = document.getElementById('btnShowAllThemes');
    if (btnShowAll) {
        let expanded = false;
        btnShowAll.addEventListener('click', () => {
            const grid = document.getElementById('themeGrid');
            expanded = !expanded;
            grid.classList.toggle('expanded', expanded);
            btnShowAll.innerHTML = expanded
                ? 'Show less <i class="fa-solid fa-chevron-up" style="margin-left: 6px; font-size: 10px;"></i>'
                : 'Show all themes <i class="fa-solid fa-chevron-down" style="margin-left: 6px; font-size: 10px;"></i>';
        });
    }

    renderThemeCards();
    applyTheme(savedTheme);
})();

// ==========================================
// Particle System
// ==========================================
(function initParticles() {
    // Skip particles entirely in Lite Mode
    if (document.body.classList.contains('lite-mode')) return;
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let particles = [];
    const PARTICLE_COUNT = 40; // Reduced from 70 to improve responsiveness
    const CONNECTION_DIST = 150;
    const CONNECTION_DIST_SQ = CONNECTION_DIST * CONNECTION_DIST;
    const PARTICLE_COLOR = '255, 255, 255';
    
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    
    window.addEventListener('resize', resize);
    resize();
    
    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.vx = (Math.random() - 0.5) * 0.4;
            this.vy = (Math.random() - 0.5) * 0.4;
            this.radius = Math.random() * 1.5 + 0.5;
            this.opacity = Math.random() * 0.4 + 0.1;
        }
        
        update() {
            this.x += this.vx;
            this.y += this.vy;
            
            if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
            if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
        }
        
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${PARTICLE_COLOR}, ${this.opacity})`;
            ctx.fill();
        }
    }
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new Particle());
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distSq = dx * dx + dy * dy;
                
                if (distSq < CONNECTION_DIST_SQ) {
                    const dist = Math.sqrt(distSq);
                    const opacity = (1 - dist / CONNECTION_DIST) * 0.12;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(${PARTICLE_COLOR}, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
        
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        
        requestAnimationFrame(animate);
    }
    
    animate();
})();

// ==========================================
// Navigation & Dynamic Theming
// ==========================================
const TAB_COLORS = {
    'home-view': '#e9590c',        // Project Lightning Orange
    'inject-view': '#a855f7',      // Purple
    'database-view': '#3b82f6',    // Blue
    'fixes-view': '#f59e0b',       // Amber
    'library-view': '#10b981',     // Green
    'onlinefixes-view': '#06b6d4', // Cyan
    'downloads-view': '#ef4444',   // Red
    'settings-view': '#8b5cf6'     // Violet
};

function navigateTo(target) {
    // 1. Update Tab Buttons UI
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const matchingBtn = document.querySelector(`.tab-btn[data-target="${target}"]`);
    if (matchingBtn) matchingBtn.classList.add('active');
    
    // 2. Update Dynamic Glow Color
    const newColor = TAB_COLORS[target] || '#e9590c';
    document.documentElement.style.setProperty('--dynamic-glow', newColor);
    
    // Convert hex to rgba for the background glow
    let r = parseInt(newColor.slice(1, 3), 16);
    let g = parseInt(newColor.slice(3, 5), 16);
    let b = parseInt(newColor.slice(5, 7), 16);
    document.documentElement.style.setProperty('--dynamic-bg', `rgba(${r}, ${g}, ${b}, 0.05)`);

    // 3. View Transitions
    const currentView = document.querySelector('.view.active');
    const targetView = document.getElementById(target);
    
    if (currentView && currentView !== targetView) {
        currentView.classList.remove('active');
        if (targetView) targetView.classList.add('active');
    } else if (!currentView && targetView) {
        targetView.classList.add('active');
    }
}

// Attach to all elements with data-target or data-navigate
document.querySelectorAll('[data-target], [data-navigate]').forEach(el => {
    el.addEventListener('click', () => {
        const target = el.dataset.target || el.dataset.navigate;
        navigateTo(target);
    });
});

// Utility: Show Toast Notification
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-xmark-circle';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Utility: Loading Overlay
function setLoading(isLoading, text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const textEl = document.getElementById('loadingText');
    textEl.innerText = text;
    if (isLoading) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

// Custom Confirm Modal
function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = message;
        
        const btnConfirm = document.getElementById('modalBtnConfirm');
        const btnCancel = document.getElementById('modalBtnCancel');
        
        btnCancel.style.display = '';
        btnConfirm.innerText = 'OK';
        btnConfirm.style.background = '';
        btnConfirm.style.color = '';
        
        // Clean up old event listeners by replacing buttons
        const newBtnConfirm = btnConfirm.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
        
        modal.classList.add('active');
        
        newBtnConfirm.addEventListener('click', () => {
            modal.classList.remove('active');
            resolve(true);
        });
        
        newBtnCancel.addEventListener('click', () => {
            modal.classList.remove('active');
            resolve(false);
        });
    });
}

// Custom Error / Alert Modal
function showErrorModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-circle-exclamation" style="color:var(--danger);margin-right:8px;"></i> ${title}`;
        document.getElementById('modalMessage').innerText = message;
        
        const btnConfirm = document.getElementById('modalBtnConfirm');
        const btnCancel = document.getElementById('modalBtnCancel');
        
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'OK';
        btnConfirm.style.background = 'var(--accent, #e9590c)';
        btnConfirm.style.color = '#fff';
        
        const newBtnConfirm = btnConfirm.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
        
        modal.classList.add('active');
        
        newBtnConfirm.addEventListener('click', () => {
            modal.classList.remove('active');
            btnCancel.style.display = '';
            btnConfirm.style.background = '';
            btnConfirm.style.color = '';
            resolve();
        });
    });
}

let cachedOnlineFixes = [];
let cachedRyuuFixes = [];

// First Launch Check
window.onload = async () => {
    // 1. Fetch Online Fixes cache
    try {
        cachedOnlineFixes = await ipcRenderer.invoke('fetch-online-fixes');
        await loadRyuuFixes(); // Load local fixes.json right away
    } catch (e) {
        console.error(e);
    }

    // Initialization
    try {
        const version = await ipcRenderer.invoke('get-version');
        const watermark = document.getElementById('version-watermark');
        if (watermark) watermark.innerText = `v${version}`;
    } catch(e) {}
    
    // 2. Startup OpenSteamTools Verification & Auto-Install
    const startupScreen = document.getElementById('startupLoadingScreen');
    const startupTitle = document.getElementById('startupTitle');
    const startupDesc = document.getElementById('startupDesc');
    const startupStatusText = document.getElementById('startupStatusText');
    const startupProgressFill = document.getElementById('startupProgressFill');
    const startupIcon = document.getElementById('startupIcon');

    try {
        const isMissing = await ipcRenderer.invoke('check-tools-missing');
        if (isMissing) {
            if (startupTitle) startupTitle.innerText = "Tools Required";
            if (startupDesc) startupDesc.innerText = "OpenSteamTools is required but missing from your Steam directory.";
            if (startupStatusText) startupStatusText.innerText = "Waiting for permission to install...";
            if (startupProgressFill) startupProgressFill.style.width = "50%";
            if (startupIcon) {
                startupIcon.className = "fa-solid fa-triangle-exclamation";
                startupIcon.style.color = "#fbbf24";
            }

            const btnInstall = document.getElementById('btnStartupInstall');
            const actionContainer = document.getElementById('startupActionContainer');
            
            if (btnInstall && actionContainer) {
                actionContainer.style.display = 'block';
                
                await new Promise(resolve => {
                    btnInstall.addEventListener('click', async () => {
                        btnInstall.disabled = true;
                        btnInstall.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="color: #000000;"></i> Installing...';
                        
                        if (startupTitle) startupTitle.innerText = "Installing Tools";
                        if (startupDesc) startupDesc.innerText = "Downloading and installing required files...";
                        if (startupStatusText) startupStatusText.innerText = "Downloading from GitHub...";
                        if (startupIcon) {
                            startupIcon.className = "fa-solid fa-circle-notch fa-spin";
                            startupIcon.style.color = "#ffffff";
                        }

                        const res = await ipcRenderer.invoke('install-tools');
                        if (res.success) {
                            if (startupProgressFill) startupProgressFill.style.width = "100%";
                            if (startupStatusText) startupStatusText.innerText = "Tools installed successfully!";
                            if (startupIcon) {
                                startupIcon.className = "fa-solid fa-circle-check";
                                startupIcon.style.color = "#10b981";
                            }
                            await new Promise(r => setTimeout(r, 650));
                            showToast("Tools installed successfully!", "success");
                        } else {
                            if (startupProgressFill) {
                                startupProgressFill.style.width = "100%";
                                startupProgressFill.style.background = "#ef4444";
                            }
                            if (startupStatusText) startupStatusText.innerText = res.message || "Failed to install tools";
                            if (startupIcon) {
                                startupIcon.className = "fa-solid fa-triangle-exclamation";
                                startupIcon.style.color = "#ef4444";
                            }
                            await new Promise(r => setTimeout(r, 1200));
                            showToast(res.message || "Failed to install tools.", "error");
                        }
                        resolve();
                    });
                });
            }
        } else {
            if (startupProgressFill) startupProgressFill.style.width = "100%";
            if (startupStatusText) startupStatusText.innerText = "OpenSteamTools verified!";
            if (startupIcon) {
                startupIcon.className = "fa-solid fa-circle-check";
                startupIcon.style.color = "#10b981";
            }
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (e) {
        console.error("Startup tool check error:", e);
    } finally {
        if (startupScreen) {
            startupScreen.classList.add('hidden');
            setTimeout(() => { startupScreen.style.display = 'none'; }, 500);
        }
    }

    // 3. Settings UI Init
    const lblDownloadDir = document.getElementById('lblDownloadDir');
    if (lblDownloadDir && customDownloadDir) {
        lblDownloadDir.innerText = customDownloadDir;
    }

    // 4. Layout Preference
    const layout = localStorage.getItem('layoutPref') || 'topbar';
    if (layout === 'topbar') document.querySelector('.app-container').classList.add('navbar-top');
    else document.querySelector('.app-container').classList.remove('navbar-top');
    const layoutSelect = document.getElementById('layoutSelect');
    if (layoutSelect) {
        layoutSelect.value = layout;
        layoutSelect.addEventListener('change', (e) => {
            localStorage.setItem('layoutPref', e.target.value);
            if (e.target.value === 'topbar') {
                document.querySelector('.app-container').classList.add('navbar-top');
            } else {
                document.querySelector('.app-container').classList.remove('navbar-top');
            }
        });
    }

    // 5. Fetch Top Sellers for Games Tab
    fetchTopSellers();
    
    // Default scan library on load
    loadLibrary();
};

async function fetchTopSellers() {
    const grid = document.getElementById('topSellersGrid');
    if (!grid) return;
    
    try {
        const response = await fetch('https://store.steampowered.com/api/featuredcategories/');
        const data = await response.json();
        
        let html = '';
        // Grab top 8 games from top_sellers, excluding hardware
        const games = data.top_sellers.items.filter(g => !g.name.toLowerCase().includes('steam deck') && !g.name.toLowerCase().includes('steam machine')).slice(0, 8);
        for (const game of games) {
            const safeName = game.name.replace(/'/g, "\\'");
            html += `
                <div class="game-card" style="cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 10px 20px rgba(0,0,0,0.5)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" onclick="openGamePage('${game.id}', '${safeName}', '${game.header_image}', null, false)">
                    <img src="${game.header_image}" class="game-img" onerror="this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'">
                    <div class="game-info">
                        <div class="game-title">${game.name}</div>
                        <div class="game-appid" style="color:var(--text-muted); font-size:12px;">App ID: ${game.id}</div>
                        <div class="game-actions" style="margin-top: 10px;">
                            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); fetchRyuu('${game.id}')" title="Inject Lua"><i class="fa-solid fa-syringe"></i> Inject Lua</button>
                        </div>
                    </div>
                </div>
            `;
        }
        grid.innerHTML = html;
    } catch (e) {
        grid.innerHTML = '<div style="color: var(--danger);">Failed to load top sellers.</div>';
    }
}

function renderRyuuFixesGrid(fixesArray) {
    const grid = document.getElementById('ryuuFixesGrid');
    if (!grid) return;
    
    if (!fixesArray || fixesArray.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No fixes available.</div>';
        return;
    }

    let html = '';
    fixesArray.forEach(fix => {
        const safeName = (fix.name || 'fix').replace(/'/g, "\\'");
        const logo = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${fix.appid}/header.jpg`;
        const libGame = typeof currentLibrary !== 'undefined' ? currentLibrary.find(g => g.appid == fix.appid) : null;
        const installPath = libGame ? libGame.installPath.replace(/\\/g, '\\\\') : null;
        const hasLua = libGame ? libGame.hasLua : false;

        html += `
            <div class="fix-card" style="cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 10px 20px rgba(0,0,0,0.5)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" onclick="openGamePage('${fix.appid}', '${safeName}', '${logo}', '${installPath}', ${hasLua})">
                <div class="fix-card-top">
                    <img class="fix-card-banner" src="${logo}" onerror="if (!this.src.includes('cloudflare')) this.src='https://cdn.cloudflare.steamstatic.com/steam/apps/${fix.appid}/header.jpg'; else this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                    <div class="fix-card-info">
                        <div class="fix-card-title">${fix.name}</div>
                        <div class="fix-card-appid">${fix.appid || 'Unknown ID'}</div>
                    </div>
                </div>
                <div class="fix-card-bottom">
                    <div class="fix-card-folder">
                        <i class="fa-solid fa-folder"></i> 1 fix
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); downloadAndInstall('${fix.url}', '${fix.appid}', '${safeName}')">
                            <i class="fa-solid fa-magic"></i> Auto Apply
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); downloadOnly('${fix.url}', '${safeName}')">
                            <i class="fa-solid fa-download"></i> Download
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;
}

const newFixSearchInput = document.getElementById('newFixSearchInput');
if (newFixSearchInput) {
    newFixSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = cachedRyuuFixes.filter(f => (f.name && f.name.toLowerCase().includes(query)) || (f.appid && f.appid.toString().includes(query)));
        renderRyuuFixesGrid(filtered);
    });
}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        
        if (targetId === 'fixes-view') {
            loadRyuuFixes();
        }
    });
});

async function loadRyuuFixes() {
    const grid = document.getElementById('ryuuFixesGrid');
    
    if (cachedRyuuFixes.length > 0) return; // Already loaded
    
    grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching official Ryuu Fixes...</div>';
    
    const res = await ipcRenderer.invoke('fetch-ryuu-fixes');
    
    if (res.success) {
        cachedRyuuFixes = res.fixes;
        grid.style.display = 'grid';
        renderRyuuFixesGrid(cachedRyuuFixes);
    } else {
        // Fallback to PeronDepot if GitHub fetch fails
        cachedRyuuFixes = cachedOnlineFixes;
        grid.style.display = 'grid';
        renderRyuuFixesGrid(cachedRyuuFixes);
    }
}

// ==========================================
// ==========================================
// LUA TOOLS INTEGRATION & DISCORD AUTH
// ==========================================
let cachedLuaFixes = [];
let isLuaAuthenticated = false;

async function checkLuaAuthAndLoad() {
    const loginContainer = document.getElementById('luaLoginContainer');
    const headerPanel = document.getElementById('luaFixesHeaderPanel');
    const grid = document.getElementById('luaFixesGrid');
    const fullPage = document.getElementById('luaFullPageContainer');
    const userBadge = document.getElementById('luaUserBadge');
    const userAvatar = document.getElementById('luaUserAvatar');
    const userName = document.getElementById('luaUserName');

    try {
        const auth = await ipcRenderer.invoke('get-lua-auth-status');
        if (auth && auth.loggedIn) {
            isLuaAuthenticated = true;
            if (loginContainer) loginContainer.style.display = 'none';
            if (headerPanel && (!fullPage || fullPage.style.display !== 'block')) {
                headerPanel.style.display = 'block';
            }
            if (userBadge) {
                userBadge.style.display = 'flex';
                if (userName) userName.textContent = (auth.user && auth.user.name) ? auth.user.name : 'Discord User';
                if (userAvatar) {
                    if (auth.user && auth.user.avatar) {
                        userAvatar.src = auth.user.avatar;
                        userAvatar.style.display = 'block';
                    } else {
                        userAvatar.style.display = 'none';
                    }
                }
            }
            if (!fullPage || fullPage.style.display !== 'block') {
                if (grid) grid.style.display = 'grid';
                loadLuaFixes();
            }
            return true;
        } else {
            isLuaAuthenticated = false;
            showLuaLoginScreen();
            return false;
        }
    } catch (e) {
        console.error("Error checking lua auth:", e);
        showLuaLoginScreen();
        return false;
    }
}

function showLuaLoginScreen() {
    const loginContainer = document.getElementById('luaLoginContainer');
    const headerPanel = document.getElementById('luaFixesHeaderPanel');
    const grid = document.getElementById('luaFixesGrid');
    const fullPage = document.getElementById('luaFullPageContainer');
    if (loginContainer) loginContainer.style.display = 'flex';
    if (headerPanel) headerPanel.style.display = 'none';
    if (grid) grid.style.display = 'none';
    if (fullPage) fullPage.style.display = 'none';
}

async function loadLuaFixes() {
    if (!isLuaAuthenticated) return;
    const grid = document.getElementById('luaFixesGrid');
    
    if (cachedLuaFixes.length > 0) return;
    
    grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching games from lua.tools...</div>';
    
    const games = await ipcRenderer.invoke('fetch-lua-tools-games');
    
    if (games && games.length > 0) {
        cachedLuaFixes = games;
        grid.style.display = 'grid';
        renderLuaFixesGrid(cachedLuaFixes);
    } else {
        grid.innerHTML = '<div style="color: var(--danger); padding: 20px;">Failed to fetch games from lua.tools.</div>';
    }
}

function renderLuaFixesGrid(gamesArray) {
    const grid = document.getElementById('luaFixesGrid');
    grid.innerHTML = '';
    
    if (gamesArray.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No games found.</div>';
        return;
    }
    
    gamesArray.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <img src="${game.imgSrc}" alt="${game.title}">
            <div class="game-info">
                <h3>${game.title}</h3>
                <p style="margin:0;font-size:12px;color:var(--text-muted);">${game.subtitle}</p>
            </div>
            <div class="game-actions" style="margin-top:auto;padding:15px;background:rgba(0,0,0,0.3);border-top:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;color:var(--text-muted);">${game.appId}</span>
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openLuaFixDetails('${game.appId}')">
                    <i class="fa-solid fa-eye"></i> View
                </button>
            </div>
        `;
        card.addEventListener('click', () => {
            openLuaFixDetails(game.appId);
        });
        grid.appendChild(card);
    });
}

// Search for Lua Fixes
const luaFixSearchInput = document.getElementById('luaFixSearchInput');
if (luaFixSearchInput) {
    luaFixSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderLuaFixesGrid(cachedLuaFixes);
            return;
        }
        const filtered = cachedLuaFixes.filter(g => (g.title && g.title.toLowerCase().includes(query)) || (g.appId && g.appId.toString().includes(query)));
        renderLuaFixesGrid(filtered);
    });
}

// Ensure load is called when tab is clicked
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        if (target === 'luafixes-view') {
            checkLuaAuthAndLoad();
            // Reset to grid view if user re-clicks the tab and is authenticated
            const headerPanel = document.getElementById('luaFixesHeaderPanel');
            const fullPage = document.getElementById('luaFullPageContainer');
            const grid = document.getElementById('luaFixesGrid');
            if (isLuaAuthenticated && fullPage && fullPage.style.display === 'block') {
                fullPage.style.display = 'none';
                if (headerPanel) headerPanel.style.display = 'block';
                if (grid) grid.style.display = 'grid';
            }
        } else if (target === 'library-view') {
            loadLibrary();
        }
    });
});

async function openLuaFixDetails(appId) {
    const grid = document.getElementById('luaFixesGrid');
    const container = document.getElementById('luaFullPageContainer');
    const headerPanel = document.getElementById('luaFixesHeaderPanel');
    const titleEl = document.getElementById('luaFullPageTitle');
    const subtitleEl = document.getElementById('luaFullPageAppId');
    const bannerEl = document.getElementById('luaFullPageBanner');
    const releasesContainer = document.getElementById('luaFullPageReleasesContainer');
    
    const gameData = cachedLuaFixes.find(g => String(g.appId) === String(appId));
    const title = gameData ? gameData.title : "Unknown Game";
    
    // Hide grid and header/search panel, show full page
    if (headerPanel) headerPanel.style.display = 'none';
    grid.style.display = 'none';
    container.style.display = 'block';
    
    // Populate Header
    titleEl.textContent = title;
    subtitleEl.textContent = `App ID: ${appId}`;
    bannerEl.src = gameData && gameData.imgSrc ? gameData.imgSrc : `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    
    releasesContainer.innerHTML = '';
    
    let releases = gameData ? gameData.fixes : [];
    
    if (!releases || releases.length === 0) {
        releasesContainer.innerHTML = '<div style="color:var(--text-muted);padding:25px;text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Checking lua.tools for latest fixes...</div>';
        try {
            const updated = await ipcRenderer.invoke('fetch-single-lua-game', appId);
            if (updated && updated.fixes && updated.fixes.length > 0) {
                if (gameData) gameData.fixes = updated.fixes;
                releases = updated.fixes;
            }
        } catch(e) {}
        
        if (!releases || releases.length === 0) {
            releasesContainer.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;background:rgba(0,0,0,0.2);border-radius:8px;">No fixes have been uploaded for this game yet.</div>';
            return;
        }
    }
    
    releasesContainer.innerHTML = '';
    releases.forEach(rel => {
        const div = document.createElement('div');
        div.style = 'background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 1.5rem; transition: background 0.2s;';
        div.onmouseover = () => div.style.background = 'rgba(255,255,255,0.05)';
        div.onmouseout = () => div.style.background = 'rgba(255,255,255,0.03)';
        
        let tagsHtml = (rel.tags || []).map(t => `<span style="font-size:11px;padding:4px 10px;border-radius:12px;background:${t.color || '#3b82f6'}20;color:${t.color || '#93c5fd'};border:1px solid ${t.color || '#3b82f6'}40">${t.name}</span>`).join(' ');
        
        const cleanDesc = rel.description ? rel.description.replace(/\\n/g, '\n') : 'No installation instructions provided for this build.';
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 15px;">
                <div>
                    <h4 style="margin:0 0 8px 0; font-size:1.1rem; color: #f3f4f6;">Build ${rel.title || 'Generic'}</h4>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">${tagsHtml}</div>
                </div>
                <div style="display:flex; gap:8px; flex-direction:row; align-items:flex-start;">
                    <button class="btn btn-sm" onclick="autoApplyLuaFix('${rel.id}', '${appId}', '${(rel.title || 'Generic').replace(/'/g, "\\'")}')" style="font-size:13px;padding:8px 16px;background:var(--accent,#e9590c);color:#fff;border:none;box-shadow:0 0 10px rgba(233,89,12,0.3);cursor:pointer;">
                        <i class="fa-solid fa-bolt"></i> Auto Apply
                    </button>
                    ${rel.hasFix ? `<button class="btn btn-secondary btn-sm" onclick="downloadLuaFixToDownloads('${rel.id}', '${appId}', '${(rel.title || 'Generic').replace(/'/g, "\\'")}')" style="font-size:13px;padding:8px 16px;background:rgba(167,139,250,0.15);color:#a78bfa;border-color:rgba(167,139,250,0.4);"><i class="fa-solid fa-download"></i> Download Fix</button>` : ''}
                </div>
            </div>
            <div style="font-size:13px;color:#9ca3af;background:rgba(0,0,0,0.3);padding:15px;border-radius:6px;overflow-x:auto; line-height: 1.6; white-space: pre-wrap;">${cleanDesc}</div>
        `;
        releasesContainer.appendChild(div);
    });
}

// Set up Lua Fixes event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Back button from Full Page to Grid
    const btnBack = document.getElementById('btnBackToLuaGrid');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            const headerPanel = document.getElementById('luaFixesHeaderPanel');
            if (headerPanel) headerPanel.style.display = 'block';
            document.getElementById('luaFullPageContainer').style.display = 'none';
            document.getElementById('luaFixesGrid').style.display = 'grid';
        });
    }

    // Discord Login button
    const btnDiscord = document.getElementById('btnLuaDiscordLogin');
    const loginStatus = document.getElementById('luaLoginStatus');
    if (btnDiscord) {
        btnDiscord.addEventListener('click', async () => {
            btnDiscord.disabled = true;
            btnDiscord.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to lua.tools...';
            if (loginStatus) {
                loginStatus.style.display = 'block';
                loginStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authorizing with Discord...';
            }

            try {
                const res = await ipcRenderer.invoke('lua-discord-login');
                if (res && res.success) {
                    showToast("Logged in with Discord successfully!", "success");
                    await checkLuaAuthAndLoad();
                } else {
                    showToast(res && res.message ? res.message : "Discord login was not completed.", "warning");
                }
            } catch(e) {
                showToast("Discord login error: " + e.message, "error");
            } finally {
                btnDiscord.disabled = false;
                btnDiscord.innerHTML = '<i class="fa-brands fa-discord"></i> Login with Discord';
                if (loginStatus) loginStatus.style.display = 'none';
            }
        });
    }

    // Logout button
    const btnLogout = document.getElementById('btnLuaLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            const confirmed = await showConfirmModal("Sign Out", "Are you sure you want to sign out of lua.tools?");
            if (confirmed) {
                await ipcRenderer.invoke('lua-logout');
                showToast("Signed out of lua.tools.", "info");
                isLuaAuthenticated = false;
                showLuaLoginScreen();
            }
        });
    }

    // Initial Lua Auth check
    checkLuaAuthAndLoad();
});

async function autoApplyLuaFix(fixId, appId, buildTitle) {
    if (!isLuaAuthenticated) {
        showToast("Please log in with Discord first.", "warning");
        showLuaLoginScreen();
        return;
    }

    // 1. Check if game is installed in Steam library across all drives
    let game = currentLibrary.find(g => String(g.appid).trim() === String(appId).trim());
    if (!game || !game.installPath) {
        // Double-check with main process in real-time
        try {
            const freshApps = await ipcRenderer.invoke('get-installed-apps');
            currentLibrary = freshApps || [];
            game = currentLibrary.find(g => String(g.appid).trim() === String(appId).trim());
        } catch(e) {}
    }

    if (!game || !game.installPath) {
        showToast("Please Install The Game First", "error");
        await showErrorModal("Game Not Installed", "Please Install The Game First");
        return;
    }

    // Verify install directory exists on filesystem
    const folderExists = await ipcRenderer.invoke('check-folder-exists', game.installPath);
    if (!folderExists) {
        showToast("Please Install The Game First", "error");
        await showErrorModal("Game Not Installed", "Please Install The Game First");
        return;
    }

    // 2. Confirm Auto Apply
    const confirmed = await showConfirmModal(
        "Auto Apply Fix", 
        `Auto Apply will download and extract the fix directly into:\n\n${game.installPath}\n\nDo you want to proceed?`
    );
    if (!confirmed) return;

    // 3. Request download link from lua.tools
    showToast("Requesting download link from lua.tools...", "info");
    const res = await ipcRenderer.invoke('get-lua-download-url', fixId, 'fix');

    if (res && res.needLogin) {
        showToast(res.message || "Please log in with Discord to download.", "warning");
        showLuaLoginScreen();
        return;
    }

    if (!res || !res.success || !res.url) {
        showToast(res && res.message ? res.message : "Failed to retrieve download link.", "error");
        return;
    }

    // 4. Switch to Downloads tab and start Auto Apply
    navigateTo('downloads-view');

    const downloadId = 'apply-' + Date.now();
    createDownloadUI(downloadId, `Auto Apply: ${game.name} (${buildTitle || 'Latest'})`);

    const result = await ipcRenderer.invoke('install-online-fix', res.url, game.installPath, downloadId);

    const status = document.getElementById(`dl-status-${downloadId}`);
    if (result && result.success) {
        if (status) {
            status.innerText = "Fix Applied!";
            status.style.color = "var(--success)";
        }
        showToast(`Fix applied successfully to ${game.name}!`, 'success');
    } else {
        if (status) {
            status.innerText = "Failed";
            status.style.color = "var(--danger)";
        }
        showToast(`Failed to apply fix: ${result && result.message ? result.message : 'Unknown error'}`, 'error');
    }
}

async function downloadLuaFixToDownloads(fixId, appId, buildTitle) {
    if (!isLuaAuthenticated) {
        showToast("Please log in with Discord first.", "warning");
        showLuaLoginScreen();
        return;
    }

    const gameData = cachedLuaFixes.find(g => String(g.appId).trim() === String(appId).trim());
    const gameName = gameData ? gameData.title : `Game_${appId}`;

    showToast("Requesting download link from lua.tools...", "info");
    const res = await ipcRenderer.invoke('get-lua-download-url', fixId, 'fix');

    if (res && res.needLogin) {
        showToast(res.message || "Please log in with Discord to download.", "warning");
        showLuaLoginScreen();
        return;
    }

    if (!res || !res.success || !res.url) {
        showToast(res && res.message ? res.message : "Failed to retrieve download link.", "error");
        return;
    }

    // Switch to Downloads tab
    navigateTo('downloads-view');

    const downloadId = 'fix-' + Date.now();
    const cleanGameName = gameName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    const itemTitle = `${cleanGameName} Fix (${buildTitle || 'Latest'})`;

    createDownloadUI(downloadId, itemTitle);

    const dlResult = await ipcRenderer.invoke('download-file', res.url, `${cleanGameName}_Fix`, downloadId, customDownloadDir);

    const status = document.getElementById(`dl-status-${downloadId}`);
    if (dlResult && dlResult.success) {
        if (status) {
            status.innerText = "Completed";
            status.style.color = "var(--success)";
        }
        showToast(`Saved to ${dlResult.path || 'Downloads folder'}`, 'success');
    } else {
        if (status) {
            status.innerText = "Error";
            status.style.color = "var(--danger)";
        }
        showToast(`Download failed: ${dlResult && dlResult.message ? dlResult.message : 'Unknown error'}`, 'error');
    }
}

function downloadLuaFix(fixId, slot) {
    downloadLuaFixToDownloads(fixId, '', 'Fix');
}

// Prompt Restart Steam
async function promptRestart() {
    const confirmed = await showConfirmModal("Success", "Lua added successfully! Restart Steam to apply changes?");
    if (confirmed) {
        ipcRenderer.invoke('restart-steam');
    }
}

// Global Restart Steam Button
const btnRestartSteam = document.getElementById('btnRestartSteam');
if (btnRestartSteam) {
    btnRestartSteam.addEventListener('click', async () => {
        const confirmed = await showConfirmModal("Restart Steam", "Are you sure you want to restart Steam?");
        if (confirmed) {
            ipcRenderer.invoke('restart-steam');
        }
    });
}

// ==========================================
// 1. Manual Injection Logic
// ==========================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const btnInjectManual = document.getElementById('btnInjectManual');
let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    if (!file.name.endsWith('.lua') && !file.name.endsWith('.zip')) {
        showToast("Only .lua and .zip files are supported.", "error");
        selectedFile = null;
        dropZone.querySelector('h3').innerText = "Drag & Drop your .lua or .zip file here";
        return;
    }
    selectedFile = file;
    dropZone.querySelector('h3').innerText = `Selected: ${file.name}`;
    dropZone.querySelector('i').className = 'fa-solid fa-file-circle-check';
}

btnInjectManual.addEventListener('click', async () => {
    if (!selectedFile) return showToast("Please select a file first.", "warning");
    
    setLoading(true, "Injecting Lua...");
    const res = await ipcRenderer.invoke('inject-manual', selectedFile.path);
    setLoading(false);
    
    if (res.success) {
        showToast("Injection successful!");
        selectedFile = null;
        dropZone.querySelector('h3').innerText = "Drag & Drop your .lua or .zip file here";
        dropZone.querySelector('i').className = 'fa-solid fa-cloud-arrow-up';
        promptRestart();
    } else {
        showToast(res.message || "Injection failed.", "error");
    }
});


// ==========================================
// 2. Database (Steam Search + Ryuu Fetch)
// ==========================================
const btnDbSearch = document.getElementById('btnDbSearch');
const dbSearchInput = document.getElementById('dbSearchInput');
const dbResults = document.getElementById('dbResults');

btnDbSearch.addEventListener('click', async () => {
    const query = dbSearchInput.value.trim();
    if (!query) return showToast("Please enter a game name or ID.", "warning");

    dbResults.innerHTML = `
        <div class="game-card"><div class="game-img skeleton"></div><div class="game-info"><div class="skeleton" style="height:20px; width:80%; margin-bottom:10px;"></div></div></div>
        <div class="game-card"><div class="game-img skeleton"></div><div class="game-info"><div class="skeleton" style="height:20px; width:80%; margin-bottom:10px;"></div></div></div>
    `;

    const tsGrid = document.getElementById('topSellersGrid');
    const tsHeader = document.getElementById('topSellersHeader');
    if (tsGrid) tsGrid.style.display = 'none';
    if (tsHeader) tsHeader.style.display = 'none';

    const games = await ipcRenderer.invoke('search-steam-games', query);
    dbResults.innerHTML = '';

    if (!games || games.length === 0) {
        dbResults.innerHTML = '<p style="color:var(--text-muted);">No games found on Steam store.</p>';
        return;
    }

    games.forEach(game => {
        dbResults.innerHTML += `
            <div class="game-card">
                <img class="game-img" src="${game.logo}" onerror="if (!this.src.includes('cloudflare')) this.src='https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg'; else this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                <div class="game-info">
                    <div class="game-title" title="${game.name}">${game.name}</div>
                    <div class="game-appid">App ID: ${game.appid}</div>
                    <div class="game-actions">
                        <button class="btn" onclick="fetchRyuu('${game.appid}')">
                            <i class="fa-solid fa-download"></i> Inject Lua
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
});

window.fetchRyuu = async (gameId, silent = false) => {
    if (!gameId) {
        gameId = document.getElementById('ryuuInput').value.trim();
        if (!gameId) {
            showToast("Please enter a Game Name or App ID.", "error");
            return;
        }
    }

    if (!silent) setLoading(true, "Searching database & downloading...");
    const res = await ipcRenderer.invoke('fetch-ryuu', gameId);
    if (!silent) setLoading(false);

    if (res.success) {
        if (!silent) {
            showToast("Lua injected successfully!", "success");
            loadLibrary();
        }
        return true;
    } else {
        if (!silent) showToast(res.message || "Failed to fetch.", "error");
        return false;
    }
};


// ==========================================
// 3. Library Management
// ==========================================
const btnScanLibrary = document.getElementById('btnScanLibrary');
const libraryList = document.getElementById('libraryList');

btnScanLibrary.addEventListener('click', loadLibrary);

function renderLibraryList() {
    const libraryList = document.getElementById('libraryList');
    if (!libraryList) return;

    libraryList.innerHTML = '';

    if (!currentLibrary || currentLibrary.length === 0) {
        libraryList.innerHTML = '<p style="color:var(--text-muted);">No installed games found. Make sure Steam is installed and you have games in your library.</p>';
        return;
    }

    currentLibrary.forEach(game => {
        const luaBadge = game.hasLua 
            ? `<span style="font-size:11px; background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; margin-left:8px;">Injected</span>` 
            : '';

        const fixMatch = cachedOnlineFixes.find(f => f.appid == game.appid || (f.name && f.name.toLowerCase() === game.name.toLowerCase()));
        const btnOnlineFix = fixMatch 
            ? `<button class="btn" style="background: var(--success); color: #000;" onclick="event.stopPropagation(); installOnlineFix('${fixMatch.url}', '${game.installPath.replace(/\\/g, '\\\\')}', '${game.name.replace(/'/g, "\\'")}')" title="Install Online Fix"><i class="fa-solid fa-cloud-arrow-down"></i></button>` 
            : '';
        const btnDelete = game.hasLua 
            ? `<button class="btn btn-danger" title="Delete Lua" onclick="event.stopPropagation(); deleteLua('${game.appid}')"><i class="fa-solid fa-trash"></i></button>` 
            : '';
        
        const ryuuFix = cachedRyuuFixes.find(f => f.appid == game.appid || (f.name && f.name.toLowerCase() === game.name.toLowerCase()));
        const btnRyuuFix = ryuuFix 
            ? `<button class="btn" style="background: #6366f1; color: white;" title="Install Ryuu Fix" onclick="event.stopPropagation(); downloadAndInstall('${ryuuFix.url}', '${ryuuFix.appid}', '${(ryuuFix.name || 'fix').replace(/'/g, "\\'")}')"><i class="fa-solid fa-wrench"></i></button>`
            : '';

        libraryList.innerHTML += `
            <div class="game-card" style="cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 10px 20px rgba(0,0,0,0.5)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" onclick="openGamePage('${game.appid}', '${game.name.replace(/'/g, "\\'")}', '${game.logo}', '${game.installPath.replace(/\\/g, '\\\\')}', ${game.hasLua})">
                <img class="game-img" src="${game.logo}" onerror="if (!this.src.includes('cloudflare')) this.src='https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg'; else this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                <div class="game-info">
                    <div class="game-title" title="${game.name}">${game.name} ${luaBadge}</div>
                    <div class="game-appid">App ID: ${game.appid}</div>
                    <div class="game-actions">
                        <button class="btn" onclick="event.stopPropagation(); ipcRenderer.invoke('view-folder', '${game.installPath.replace(/\\/g, '\\\\')}')" title="View Install Folder">
                            <i class="fa-solid fa-folder-open"></i>
                        </button>
                        ${btnRyuuFix}
                        ${btnOnlineFix}
                        ${btnDelete}
                        <button class="btn" style="background: var(--danger);" onclick="event.stopPropagation(); ipcRenderer.invoke('uninstall-game', '${game.appid}')" title="Uninstall via Steam">
                            <i class="fa-brands fa-steam"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
}

async function loadLibrary(silent = false) {
    const libraryList = document.getElementById('libraryList');
    if (!silent && libraryList) {
        libraryList.innerHTML = '<div style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Scanning Steam directories...</div>';
    }

    try {
        const apps = await ipcRenderer.invoke('get-installed-apps');
        currentLibrary = apps || [];
        renderLibraryList();
    } catch(e) {
        console.error("Error loading Steam library:", e);
    }
}

// Real-time library change listener from main process
ipcRenderer.on('steam-library-updated', (event, apps) => {
    currentLibrary = apps || [];
    renderLibraryList();
});

// Update library whenever window gains focus
window.addEventListener('focus', () => {
    ipcRenderer.invoke('get-installed-apps').then(apps => {
        if (apps) {
            currentLibrary = apps;
            const libraryView = document.getElementById('library-view');
            if (libraryView && libraryView.classList.contains('active')) {
                renderLibraryList();
            }
        }
    }).catch(() => {});
});

window.deleteLua = async (appId) => {
    const confirmed = await showConfirmModal("Delete Lua", `Are you sure you want to delete the injected Lua for App ID ${appId}?`);
    if (confirmed) {
        const res = await ipcRenderer.invoke('delete-lua', appId);
        if (res.success) {
            showToast("Lua deleted successfully.");
            loadLibrary(); // refresh list
        } else {
            showToast("Error deleting Lua: " + res.message, "error");
        }
    }
};

// ==========================================
// 4. Online Fixes
// ==========================================
window.searchOnlineFixes = () => {
    const query = document.getElementById('fixSearchInput').value.toLowerCase().trim();
    const fixResultsGrid = document.getElementById('fixResultsGrid');
    
    fixResultsGrid.innerHTML = '';
    
    if (!query || query.length < 2) {
        showToast("Please enter at least 2 characters.", "error");
        return;
    }
    
    let results = cachedOnlineFixes.filter(f => 
        (f.name && f.name.toLowerCase().includes(query)) || 
        (f.appid && f.appid.includes(query))
    );
    
    if (results.length === 0) {
        fixResultsGrid.innerHTML = '<p style="color: var(--text-muted);">No online fixes found for this query.</p>';
        return;
    }
    
    // Limit to 50 results to prevent UI lag
    if (results.length > 50) {
        showToast(`Found ${results.length} matches. Showing top 50.`, "info");
        results = results.slice(0, 50);
    }
    
    let html = '';
    results.forEach(fix => {
        const safeName = (fix.name || 'fix').replace(/'/g, "\\'");
        const logo = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${fix.appid}/header.jpg`;
        const libGame = typeof currentLibrary !== 'undefined' ? currentLibrary.find(g => g.appid == fix.appid) : null;
        const installPath = libGame ? libGame.installPath.replace(/\\/g, '\\\\') : null;
        const hasLua = libGame ? libGame.hasLua : false;

        html += `
            <div class="fix-card" style="cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-5px)'; this.style.boxShadow='0 10px 20px rgba(0,0,0,0.5)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" onclick="openGamePage('${fix.appid}', '${safeName}', '${logo}', '${installPath}', ${hasLua})">
                <div class="fix-card-top">
                    <img class="fix-card-banner" src="${logo}" onerror="if (!this.src.includes('cloudflare')) this.src='https://cdn.cloudflare.steamstatic.com/steam/apps/${fix.appid}/header.jpg'; else this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                    <div class="fix-card-info">
                        <div class="fix-card-title">${fix.name}</div>
                        <div class="fix-card-appid">${fix.appid || 'Unknown ID'}</div>
                    </div>
                </div>
                <div class="fix-card-bottom">
                    <div class="fix-card-folder">
                        <i class="fa-solid fa-cloud-arrow-down"></i> Online Fix
                    </div>
                    <div style="display: flex; gap: 5px;">
                        ${fix.appid ? `
                        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); downloadAndInstall('${fix.url}', '${fix.appid}', '${safeName}')">
                            <i class="fa-solid fa-magic"></i> Auto Apply
                        </button>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); downloadOnly('${fix.url}', '${safeName}')">
                            <i class="fa-solid fa-download"></i> Download
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    fixResultsGrid.innerHTML = html;
};

// --- DOWNLOADS TAB LOGIC ---

function createDownloadUI(id, title, type = 'file') {
    const container = document.getElementById('downloadsContainer');
    const noDownloads = document.getElementById('noDownloadsMessage');
    if (noDownloads) noDownloads.style.display = 'none';
    
    const div = document.createElement('div');
    div.className = 'download-item';
    div.id = `dl-${id}`;
    
    const isSteam = type === 'steam';
    
    div.innerHTML = `
        <div class="download-info" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="download-title" style="font-weight: 500;">${title}</span>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="download-status" id="dl-status-${id}" style="font-size: 13px; color: var(--primary-color);">0%</span>
                ${!isSteam ? `
                <div class="dl-controls" style="display: flex; gap: 5px;">
                    <button class="btn btn-sm btn-secondary" id="btn-toggle-${id}" onclick="toggleDownload('${id}')" title="Pause"><i class="fa-solid fa-pause"></i></button>
                    <button class="btn btn-sm btn-secondary" onclick="cancelDownload('${id}')" title="Cancel" style="color: var(--danger);"><i class="fa-solid fa-xmark"></i></button>
                </div>
                ` : ''}
            </div>
        </div>
        <div class="progress-bar-bg" style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div class="progress-bar-fill" id="dl-fill-${id}" style="height: 100%; width: 0%; background: var(--primary-color); transition: width 0.3s ease;"></div>
        </div>
    `;
    container.appendChild(div);
}

// Download Control Functions
window.toggleDownload = async (id) => {
    const btn = document.getElementById(`btn-toggle-${id}`);
    if (!btn) return;
    const icon = btn.querySelector('i');
    const isPaused = icon.classList.contains('fa-play');
    
    if (isPaused) {
        await ipcRenderer.invoke('resume-download', id);
        icon.classList.replace('fa-play', 'fa-pause');
        btn.title = 'Pause';
        const status = document.getElementById(`dl-status-${id}`);
        if (status && !status.innerText.includes('Error') && !status.innerText.includes('Completed')) {
            status.innerText = 'Resuming...';
        }
    } else {
        await ipcRenderer.invoke('pause-download', id);
        icon.classList.replace('fa-pause', 'fa-play');
        btn.title = 'Resume';
        const status = document.getElementById(`dl-status-${id}`);
        if (status && !status.innerText.includes('Error') && !status.innerText.includes('Completed')) {
            status.innerText = 'Paused';
        }
    }
};

window.cancelDownload = async (id) => {
    const success = await ipcRenderer.invoke('cancel-download', id);
    if (success) {
        const el = document.getElementById(`dl-${id}`);
        if (el) el.remove();
        showToast("Download canceled.", "warning");
        
        if (document.querySelectorAll('.download-item').length === 0) {
            document.getElementById('noDownloadsMessage').style.display = 'block';
        }
    }
};

document.getElementById('btnClearDownloads')?.addEventListener('click', () => {
    const container = document.getElementById('downloadsContainer');
    // Find all download items that are complete or failed. Active ones might need explicit cancel.
    // For simplicity, let's just clear the UI and send a cancel to all.
    const items = container.querySelectorAll('.download-item');
    items.forEach(item => {
        const id = item.id.replace('dl-', '');
        ipcRenderer.invoke('cancel-download', id);
        item.remove();
    });
    document.getElementById('noDownloadsMessage').style.display = 'block';
});

ipcRenderer.on('download-progress', (event, data) => {
    const fill = document.getElementById(`dl-fill-${data.id}`);
    const status = document.getElementById(`dl-status-${data.id}`);
    if (fill && status) {
        if (data.type === 'error' || data.progress < 0) {
            status.innerText = 'Error';
            status.style.color = 'var(--danger)';
            fill.style.width = '100%';
            fill.style.background = 'var(--danger)';
        } else if (data.type === 'extracting') {
            status.innerText = 'Extracting...';
            status.style.color = 'var(--success)';
            fill.style.width = '100%';
        } else {
            const progress = Math.round(data.progress);
            fill.style.width = `${progress}%`;
            status.innerText = `${progress}%`;
        }
    }
});

window.downloadOnly = async (url, name) => {
    document.querySelector('.tab-btn[data-target="downloads-view"]').click();
    const id = Date.now().toString();
    createDownloadUI(id, `Downloading ${name}.rar...`);
    
    const res = await ipcRenderer.invoke('download-file', url, name, id, customDownloadDir);
    const status = document.getElementById(`dl-status-${id}`);
    if (status) {
        status.innerText = res.success ? "Completed" : "Error";
        status.style.color = res.success ? "var(--success)" : "var(--danger)";
    }
    if (res.success) {
        showToast(`Saved to ${res.path}`);
    }
};

window.downloadAndInstall = async (url, appId, name) => {
    // 1. Check if game is installed
    const installedGame = currentLibrary.find(g => g.appid == appId);
    
    if (installedGame) {
        // Game is installed, just install fix
        installOnlineFix(url, installedGame.installPath, name);
    } else {
        const confirmed = await showConfirmModal("Game Not Installed", `${name} is not installed in your Steam Library.\n\nDo you want to fetch its license and install it via Steam now?`);
        if (confirmed) {
            // First, secretly fetch the Lua and Manifest
            setLoading(true, `Fetching licenses for ${name}...`);
            const fetchSuccess = await window.fetchRyuu(appId, true);
            
            if (fetchSuccess) {
                setLoading(false);
                showToast("Lua injected successfully! Installing game...", "success");
                window.location.href = `steam://install/${appId}`;
                    
                    // Switch to Downloads Tab and track it
                    document.querySelector('.tab-btn[data-target="downloads-view"]').click();
                    const id = `steam-${appId}`;
                    createDownloadUI(id, `Steam: Downloading ${name}...`, 'steam');
                    
                    // Wait for Steam to finish downloading
                    const res = await ipcRenderer.invoke('track-steam-download', appId, id);
                    
                    const status = document.getElementById(`dl-status-${id}`);
                    if (res.success) {
                        if (status) {
                            status.innerText = "Extracting Fix...";
                            status.style.color = "var(--success)";
                        }
                        // Steam finished, now auto install fix!
                        installOnlineFix(url, res.installPath, name);
                    } else {
                        if (status) {
                            status.innerText = "Tracking Failed";
                            status.style.color = "var(--danger)";
                        }
                        showToast(`Failed to track Steam download: ${res.message}`, "error");
                    }

            } else {
                setLoading(false);
                showToast("Could not fetch licenses. Cannot install game.", "error");
            }
        }
    }
};

window.installOnlineFixFromGrid = async (url, name) => {
    showToast("This feature requires the target Steam game installation directory.", "error");
    // Since we don't know the install path from the grid, it's better to tell the user to use the Library tab
    // Or we could trigger a folder select dialog, but Library tab is easier.
    const confirmed = await showConfirmModal("Manual Install Required", `To install the fix for ${name}, please locate it in your Library tab and click the green cloud button, OR manually download and extract it.`);
};

window.installOnlineFix = async (url, targetPath, appName) => {
    const confirmed = await showConfirmModal("Install Online Fix", `Download and auto-extract the multiplayer fix for ${appName} into its installation directory?\n\nTarget: ${targetPath}`);
    if (confirmed) {
        document.querySelector('.tab-btn[data-target="downloads-view"]').click();
        const id = `fix-${Date.now()}`;
        createDownloadUI(id, `Downloading Fix for ${appName}...`);
        
        const res = await ipcRenderer.invoke('install-online-fix', url, targetPath, id);
        
        const status = document.getElementById(`dl-status-${id}`);
        if (res.success) {
            if (status) {
                status.innerText = "Fix Applied!";
                status.style.color = "var(--success)";
            }
            showToast(`Successfully installed fix for ${appName}!`, 'success');
        } else {
            if (status) {
                status.innerText = "Install Failed";
                status.style.color = "var(--danger)";
            }
            showToast(`Failed to install fix: ${res.message}`, 'error');
        }
    }
};

// ==========================================
// 5. Settings & Tools
// ==========================================
const btnSelectDownloadDir = document.getElementById('btnSelectDownloadDir');
if (btnSelectDownloadDir) {
    btnSelectDownloadDir.addEventListener('click', async () => {
        const dir = await ipcRenderer.invoke('select-directory');
        if (dir) {
            customDownloadDir = dir;
            localStorage.setItem('customDownloadDir', dir);
            document.getElementById('lblDownloadDir').innerText = dir;
            showToast("Download directory updated.");
        }
    });
}

const btnInstallTools = document.getElementById('btnInstallTools');
if (btnInstallTools) {
    btnInstallTools.addEventListener('click', async () => {
        const confirmed = await showConfirmModal("Install Tools", "This will copy OpenSteamTools DLLs into your Steam folder. Continue?");
        if (confirmed) {
            setLoading(true, "Installing Tools...");
            const res = await ipcRenderer.invoke('install-tools');
            setLoading(false);
            if (res.success) {
                showToast("Tools installed successfully!");
            } else {
                showToast("Failed to install tools: " + res.message, "error");
            }
        }
    });
}

// ==========================================
// Custom Titlebar Controls
// ==========================================
document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer.invoke('window-maximize'));
document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.invoke('window-close'));

// ==========================================
// Auto Updater Notifications
// ==========================================
ipcRenderer.on('update-available', (event, version) => {
    showToast(`Update v${version} is available and downloading...`, 'info');
    createDownloadUI('app_update', `Downloading App Update (v${version})`);
});

ipcRenderer.on('update-downloaded', (event, version) => {
    // Show a permanent toast with a restart button
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-success`;
    toast.innerHTML = `
        <i class="fa-solid fa-circle-check"></i>
        <span>Update v${version} is ready to install!</span>
        <button class="btn btn-sm btn-primary" onclick="ipcRenderer.invoke('restart-app')" style="margin-left: 10px;">Restart</button>
    `;
    
    toastContainer.appendChild(toast);
    
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Update the downloads tab UI if it exists
    const status = document.getElementById('dl-status-app_update');
    if (status) {
        status.innerText = "Ready to Install (Restart)";
        status.style.color = "var(--success)";
        document.getElementById('dl-fill-app_update').style.width = '100%';
    }
});

// Custom Portable Updater UI
ipcRenderer.on('manual-update-available', (event, data) => {
    // Show toast and trigger native download UI in downloads tab
    showToast(`Update v${data.version} is available and downloading...`, 'info');
    createDownloadUI('app_update', `Downloading App Update (v${data.version})`);
    
    // Auto start the portable update download silently in the background
    ipcRenderer.invoke('install-manual-update', data.url);
});


function createToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        document.body.appendChild(container);
    }
    return container;
}

// 9. Full Game Page Logic
window.openGamePage = async (appId, name, logo, installPath, hasLua) => {
    // Hide all views and show game details
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('game-details-view').classList.add('active');
    document.getElementById('btnBackToGrid').style.display = 'block';
    
    // Set basic info immediately
    document.getElementById('game-details-title').innerText = name;
    
    // Default optimistic background, will be overwritten if API returns the real one
    document.getElementById('game-details-hero').style.backgroundImage = `url('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/page_bg_generated_v6b.jpg')`;
    
    const logoEl = document.getElementById('game-details-logo');
    // Hide the broken image icon if it fails to load
    logoEl.onerror = function() { this.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; };
    logoEl.src = logo || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    logoEl.style.display = 'block';
    
    document.getElementById('game-details-desc').innerText = 'Loading...';
    document.getElementById('game-details-screenshots').innerHTML = '';
    
    // Check available actions
    const ryuuFix = cachedRyuuFixes.find(f => f.appid == appId || (f.name && f.name.toLowerCase() === name.toLowerCase()));
    const onlineFix = cachedOnlineFixes.find(f => f.appid == appId || (f.name && f.name.toLowerCase() === name.toLowerCase()));
    
    // Generate Actions
    let actionsHtml = '';
    
    // Lua Actions (Available even if not installed)
    if (hasLua === 'true' || hasLua === true) {
        actionsHtml += `<button class="btn btn-danger" style="justify-content:center; box-shadow: 0 0 15px rgba(239,68,68,0.4);" onclick="deleteLua('${appId}')"><i class="fa-solid fa-trash"></i> Delete Lua</button>`;
    } else {
        actionsHtml += `<button class="btn btn-primary" style="justify-content:center; box-shadow: 0 0 15px rgba(99,102,241,0.4);" onclick="fetchRyuu('${appId}')"><i class="fa-solid fa-syringe"></i> Inject Lua</button>`;
    }
    
    // Ryuu Fix
    if (ryuuFix) {
        actionsHtml += `<button class="btn" style="background: #6366f1; color: white; justify-content:center; box-shadow: 0 0 15px rgba(99,102,241,0.4);" onclick="downloadAndInstall('${ryuuFix.url}', '${appId}', '${(ryuuFix.name || 'fix').replace(/'/g, "\\'")}')"><i class="fa-solid fa-wrench"></i> Apply Ryuu Fix</button>`;
    }
    
    // Online Fix
    if (onlineFix) {
        actionsHtml += `<button class="btn" style="background: var(--success); color: #000; justify-content:center; box-shadow: 0 0 15px rgba(34,197,94,0.4);" onclick="downloadAndInstall('${onlineFix.url}', '${appId}', '${name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-cloud-arrow-down"></i> Download & Apply Online Fix</button>`;
    }
    
    // Library Actions
    if (installPath && installPath !== 'undefined' && installPath !== 'null') {
        actionsHtml += `<button class="btn btn-secondary" style="justify-content:center;" onclick="ipcRenderer.invoke('view-folder', '${installPath.replace(/\\/g, '\\\\')}')"><i class="fa-solid fa-folder-open"></i> Browse Files</button>`;
        actionsHtml += `<button class="btn btn-danger" style="justify-content:center;" onclick="ipcRenderer.invoke('uninstall-game', '${appId}')"><i class="fa-brands fa-steam"></i> Uninstall</button>`;
    } else {
        actionsHtml += `<button class="btn btn-secondary" style="justify-content:center;" onclick="window.location.href='steam://install/${appId}'"><i class="fa-brands fa-steam"></i> Install via Steam</button>`;
    }
    
    document.getElementById('game-details-actions').innerHTML = actionsHtml;
    
    // Badges
    let badgesHtml = '';
    if (hasLua === 'true' || hasLua === true) badgesHtml += '<span style="font-size:11px; background:var(--success); color:#fff; padding:3px 8px; border-radius:4px; box-shadow: 0 0 10px var(--success);">LUA INJECTED</span>';
    if (ryuuFix) badgesHtml += '<span style="font-size:11px; background:#6366f1; color:#fff; padding:3px 8px; border-radius:4px; box-shadow: 0 0 10px #6366f1;">RYUU FIX READY</span>';
    if (onlineFix) badgesHtml += '<span style="font-size:11px; background:var(--success); color:#000; padding:3px 8px; border-radius:4px; box-shadow: 0 0 10px var(--success);">ONLINE FIX READY</span>';
    document.getElementById('game-details-badges').innerHTML = badgesHtml;
    
    // Fetch Steam Details
    try {
        const details = await ipcRenderer.invoke('get-steam-game-details', appId);
        if (details.success && details.data) {
            
            // Overwrite background and logo with official API data if available
            if (details.data.background_raw || details.data.background) {
                document.getElementById('game-details-hero').style.backgroundImage = `url('${details.data.background_raw || details.data.background}')`;
            }
            if (details.data.header_image) {
                logoEl.src = details.data.header_image;
            }
            
            document.getElementById('game-details-desc').innerHTML = details.data.short_description || "No description available.";
            
            if (details.data.screenshots && details.data.screenshots.length > 0) {
                let ssHtml = '';
                details.data.screenshots.slice(0, 4).forEach(ss => {
                    ssHtml += `<img src="${ss.path_thumbnail}" style="width:100%; border-radius:8px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">`;
                });
                document.getElementById('game-details-screenshots').innerHTML = ssHtml;
            } else {
                document.getElementById('game-details-screenshots').innerHTML = '<div style="color:var(--text-muted);">No screenshots available.</div>';
            }
        } else {
            document.getElementById('game-details-desc').innerText = "Game details not found on Steam.";
        }
    } catch(e) {
        document.getElementById('game-details-desc').innerText = "Failed to load Steam details.";
    }
};

// ==========================================
// Localization / Language Settings
// ==========================================
const TRANSLATIONS = {
    en: {
        WELCOME_TO: "Welcome To",
        PLAY_AS_YOU_WANT: "Play as you want",
        INJECT_LUA: "Inject Lua",
        RYUU_FIXES: "Ryuu Fixes",
        GAMES_DB: "Games DB",
        MY_LIBRARY: "My Library",
        JOIN_COMMUNITY: "Join the community!",
        JOIN: "Join",
        LANGUAGE_SETTING_TITLE: "Language",
        LANGUAGE_SETTING_DESC: "Select your preferred application language."
    },
    es: {
        WELCOME_TO: "Bienvenido A",
        PLAY_AS_YOU_WANT: "Juega como quieras",
        INJECT_LUA: "Inyectar Lua",
        RYUU_FIXES: "Correcciones Ryuu",
        GAMES_DB: "Base De Juegos",
        MY_LIBRARY: "Mi Biblioteca",
        JOIN_COMMUNITY: "¡Únete a la comunidad!",
        JOIN: "Unirse",
        LANGUAGE_SETTING_TITLE: "Idioma",
        LANGUAGE_SETTING_DESC: "Seleccione su idioma preferido para la aplicación."
    },
    fr: {
        WELCOME_TO: "Bienvenue À",
        PLAY_AS_YOU_WANT: "Jouez comme vous voulez",
        INJECT_LUA: "Injecter Lua",
        RYUU_FIXES: "Corrections Ryuu",
        GAMES_DB: "Base De Jeux",
        MY_LIBRARY: "Ma Bibliothèque",
        JOIN_COMMUNITY: "Rejoignez la communauté!",
        JOIN: "Rejoindre",
        LANGUAGE_SETTING_TITLE: "Langue",
        LANGUAGE_SETTING_DESC: "Sélectionnez la langue préférée de l'application."
    },
    de: {
        WELCOME_TO: "Willkommen Bei",
        PLAY_AS_YOU_WANT: "Spiele wie du willst",
        INJECT_LUA: "Lua Injizieren",
        RYUU_FIXES: "Ryuu Fixes",
        GAMES_DB: "Spiele DB",
        MY_LIBRARY: "Meine Bibliothek",
        JOIN_COMMUNITY: "Tritt der Community bei!",
        JOIN: "Beitreten",
        LANGUAGE_SETTING_TITLE: "Sprache",
        LANGUAGE_SETTING_DESC: "Wählen Sie Ihre bevorzugte Anwendungssprache."
    },
    zh: {
        WELCOME_TO: "欢迎来到",
        PLAY_AS_YOU_WANT: "随心所欲地玩",
        INJECT_LUA: "注入 Lua",
        RYUU_FIXES: "Ryuu 修复",
        GAMES_DB: "游戏数据库",
        MY_LIBRARY: "我的库",
        JOIN_COMMUNITY: "加入社区！",
        JOIN: "加入",
        LANGUAGE_SETTING_TITLE: "语言",
        LANGUAGE_SETTING_DESC: "选择您首选的应用程序语言。"
    },
    ja: {
        WELCOME_TO: "ようこそ",
        PLAY_AS_YOU_WANT: "好きなようにプレイ",
        INJECT_LUA: "Luaを注入",
        RYUU_FIXES: "Ryuu 修正",
        GAMES_DB: "ゲームDB",
        MY_LIBRARY: "マイライブラリ",
        JOIN_COMMUNITY: "コミュニティに参加！",
        JOIN: "参加",
        LANGUAGE_SETTING_TITLE: "言語",
        LANGUAGE_SETTING_DESC: "希望するアプリケーションの言語を選択してください。"
    }
};

let currentLanguage = localStorage.getItem('appLanguage') || 'en';

function applyLanguage(lang) {
    const dict = TRANSLATIONS[lang];
    if (!dict) return;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.innerText = dict[key];
        }
    });
}

// Initial apply
document.addEventListener('DOMContentLoaded', () => {
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        langSelect.value = currentLanguage;
        langSelect.addEventListener('change', (e) => {
            currentLanguage = e.target.value;
            localStorage.setItem('appLanguage', currentLanguage);
            applyLanguage(currentLanguage);
        });
    }
    
    // Default to removing layout-sidebar in case it's lingering
    document.body.classList.remove('layout-sidebar');
    
    applyLanguage(currentLanguage);
});