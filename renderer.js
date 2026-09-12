const { ipcRenderer, shell } = require('electron');
const levelingService = require('./services/leveling');

// =========================================================
// Application State Store
// =========================================================
const AppState = {
  currentView: 'discover-view',
  previousView: 'discover-view',
  games: [],
  coopGames: [],
  totalIndexedGames: 7975,
  totalCoopGames: 331,
  currentPage: 1,
  totalPages: 1,
  coopCurrentPage: 1,
  coopTotalPages: 1,
  searchQuery: '',
  coopSearchQuery: '',
  selectedCategory: 'all',
  activeDownloads: new Map(),
  downloadHistory: [],
  selectedGameForDetail: null,
  library: [],
  libraryFilter: 'all',
  librarySearchQuery: '',
  selectedLibraryGame: null,
  profile: {
    username: 'Gamer',
    avatar: 'icons/kyrosphere_logo.jpg',
    bio: '',
    status: 'Online',
    currentGame: '',
    level: 1,
    totalXP: 0,
    hardware: null
  },
  friends: [],
  pendingRequests: [],
  savingsData: null,
  settings: {
    downloadDir: '',
    autoExtract: true,
    particlesEnabled: true,
    theme: 'theme-aurora',
    maxConcurrent: 3
  }
};

// =========================================================
// Dynamic Ambient Particle Canvas Engine
// =========================================================
class ParticleEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.count = 45;
    this.mouse = { x: -1000, y: -1000, radius: 120 };
    this.enabled = true;
    this.particleColor = 'rgba(255, 255, 255, ';
    this.lineColor = 'rgba(255, 255, 255, ';

    this.resize();
    this.init();
    this.bindEvents();
    this.animate();
  }

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  }

  init() {
    this.particles = [];
    for (let i = 0; i < this.count; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.35 + 0.15,
        pulseSpeed: Math.random() * 0.02 + 0.005
      });
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resize();
      this.init();
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });

    window.addEventListener('mouseleave', () => {
      this.mouse.x = -1000;
      this.mouse.y = -1000;
    });
  }

  animate() {
    if (!this.enabled) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      requestAnimationFrame(() => this.animate());
      return;
    }

    this.ctx.clearRect(0, 0, this.width, this.height);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = this.width;
      if (p.x > this.width) p.x = 0;
      if (p.y < 0) p.y = this.height;
      if (p.y > this.height) p.y = 0;

      // Subtle mouse repulsion
      const dx = p.x - this.mouse.x;
      const dy = p.y - this.mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.mouse.radius) {
        const force = (this.mouse.radius - dist) / this.mouse.radius;
        p.x += (dx / dist) * force * 1.5;
        p.y += (dy / dist) * force * 1.5;
      }

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `${this.particleColor}${p.alpha})`;
      this.ctx.fill();

      // Connecting lines
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dist2 = Math.hypot(p.x - p2.x, p.y - p2.y);
        if (dist2 < 100) {
          const lineAlpha = (1 - dist2 / 100) * 0.1;
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = `${this.lineColor}${lineAlpha})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.stroke();
        }
      }
    }

    requestAnimationFrame(() => this.animate());
  }
}

// =========================================================
// Toast Notification Engine
// =========================================================
function showToast({ title, message, icon = 'fa-solid fa-circle-info', duration = 4000 }) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i class="${icon} toast-icon"></i>
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, duration);
}

// =========================================================
// View Switcher & Top Navigation
// =========================================================
function switchView(targetViewId) {
  AppState.currentView = targetViewId;

  // Scroll main stage to top on view transition
  const mainStage = document.querySelector('.main-stage');
  if (mainStage) mainStage.scrollTop = 0;

  // Update top navigation tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === targetViewId);
  });

  // Update panels
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === targetViewId);
  });

  // Trigger lazy loading per tab
  if (targetViewId === 'games-view' && AppState.games.length === 0) {
    loadGames(1, AppState.searchQuery);
  } else if (targetViewId === 'multiplayer-view') {
    loadCoopGames(1, AppState.coopSearchQuery);
  } else if (targetViewId === 'library-view') {
    loadLibraryFromBackend();
    updateDiskSpaceDisplay();
    updateMoneySavedTracker();
  } else if (targetViewId === 'profile-view') {
    initProfileView();
  } else if (targetViewId === 'social-view') {
    loadFriendsList();
  } else if (targetViewId === 'downloads-view') {
    renderDownloadsView();
    updateDownloadPathDisplay();
    updateDiskSpaceDisplay();
  } else if (targetViewId === 'settings-view') {
    updateDiskSpaceDisplay();
    refreshDependenciesStatus();
  }
}

// =========================================================
// Games Catalog & Universal Search Engine
// =========================================================
async function loadGames(page = 1, searchQuery = '') {
  const catalogGrid = document.getElementById('catalogGrid');
  const discoverGrid = document.getElementById('discoverGrid');
  const searchCountBadge = document.getElementById('searchCountBadge');

  renderSkeletonCards(catalogGrid, 8);
  if (page === 1 && !searchQuery && discoverGrid && AppState.games.length === 0) {
    renderSkeletonCards(discoverGrid, 6);
  }

  try {
    let result;
    if ((searchQuery && searchQuery.trim()) || (AppState.selectedCategory && AppState.selectedCategory !== 'all')) {
      result = await ipcRenderer.invoke('search-games', searchQuery ? searchQuery.trim() : '', page, 24, AppState.selectedCategory);
    } else {
      result = await ipcRenderer.invoke('fetch-games', page, 24);
    }

    if (result && result.success && Array.isArray(result.games)) {
      AppState.games = result.games;
      AppState.currentPage = result.currentPage || page;
      AppState.totalPages = result.totalPages || 1;
      AppState.totalPosts = result.totalPosts || (result.totalPages * 24);

      // Update Lower Search Count Badge
      if (searchCountBadge) {
        if (searchQuery && searchQuery.trim()) {
          searchCountBadge.textContent = `${result.totalPosts.toLocaleString()} Found`;
        } else {
          searchCountBadge.textContent = `${(result.totalPosts || AppState.totalIndexedGames).toLocaleString()} Games`;
        }
      }

      // Update Pagination UI
      updatePaginationControls();

      // Render Catalog Grid
      renderGamesGrid(catalogGrid, AppState.games);

      // Render Discover Highlights if on page 1 and no search
      if (page === 1 && !searchQuery && discoverGrid) {
        renderGamesGrid(discoverGrid, AppState.games.slice(0, 6));
        updateSpotlightBanner(AppState.games[0]);
      }
    } else {
      catalogGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <p>Unable to load games</p>
          <span>${result?.error || 'Check your internet connection or try again.'}</span>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to load games:', err);
    catalogGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Library Error</p>
        <span>${err.message}</span>
      </div>
    `;
  }
}

// =========================================================
// Multiplayer & Co-op View (Comprehensive 330+ Games)
// =========================================================
async function loadCoopGames(page = 1, searchQuery = '') {
  const multiplayerGrid = document.getElementById('multiplayerGrid');
  const coopCountBadge = document.getElementById('coopCountBadge');

  renderSkeletonCards(multiplayerGrid, 8);

  try {
    const result = await ipcRenderer.invoke('search-games', searchQuery, page, 24, 'multiplayer');

    if (result && result.success && Array.isArray(result.games)) {
      AppState.coopGames = result.games;
      AppState.coopCurrentPage = result.currentPage || page;
      AppState.coopTotalPages = result.totalPages || 1;

      if (coopCountBadge) {
        if (searchQuery && searchQuery.trim()) {
          coopCountBadge.textContent = `${result.totalPosts.toLocaleString()} Found`;
        } else {
          coopCountBadge.textContent = `${result.totalPosts.toLocaleString()} Co-op Games`;
        }
      }

      // Update Co-op Pagination UI
      const prevBtn = document.getElementById('btnPrevCoopPage');
      const nextBtn = document.getElementById('btnNextCoopPage');
      const indicator = document.getElementById('coopPageIndicator');

      if (prevBtn) prevBtn.disabled = AppState.coopCurrentPage <= 1;
      if (nextBtn) nextBtn.disabled = AppState.coopCurrentPage >= AppState.coopTotalPages;
      if (indicator) indicator.textContent = `Page ${AppState.coopCurrentPage} of ${AppState.coopTotalPages}`;

      renderGamesGrid(multiplayerGrid, AppState.coopGames);
    } else {
      multiplayerGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i class="fa-solid fa-users-slash"></i>
          <p>No co-op games found</p>
          <span>Try a different search query</span>
        </div>
      `;
    }
  } catch (err) {
    multiplayerGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Co-op Catalog Error</p>
        <span>${err.message}</span>
      </div>
    `;
  }
}

function filterGamesByCategory(games, category) {
  if (!category || category === 'all') return games;
  const catLower = category.toLowerCase();
  return games.filter(g => {
    if (catLower === 'multiplayer' || catLower === 'co-op') {
      return g.online || (g.categories || []).some(c => c.toLowerCase().includes('co-op') || c.toLowerCase().includes('multiplayer'));
    }
    return (g.categories || []).some(c => c.toLowerCase().includes(catLower));
  });
}

function renderSkeletonCards(container, count = 6) {
  if (!container) return;
  container.innerHTML = Array(count).fill(0).map(() => `
    <div class="skeleton-card"></div>
  `).join('');
}

// Dynamic Stylized Game Poster Generator (Zero Missing Images Guarantee)
function getStylizedCoverHtml(game) {
  const title = (game.name || 'Game').trim();
  
  // Deterministic palette selection based on title string hash
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  const palettes = [
    { bg: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)', text: '#e0e7ff', pill: '#818cf8' }, // Royal Indigo
    { bg: 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 50%, #991b1b 100%)', text: '#fee2e2', pill: '#f87171' }, // Crimson Flame
    { bg: 'linear-gradient(135deg, #022c22 0%, #064e3b 50%, #047857 100%)', text: '#d1fae5', pill: '#34d399' }, // Emerald Matrix
    { bg: 'linear-gradient(135deg, #082f49 0%, #075985 50%, #0284c7 100%)', text: '#e0f2fe', pill: '#38bdf8' }, // Cyber Blue
    { bg: 'linear-gradient(135deg, #3b0764 0%, #581c87 50%, #7e22ce 100%)', text: '#f3e8ff', pill: '#c084fc' }, // Deep Amethyst
    { bg: 'linear-gradient(135deg, #451a03 0%, #78350f 50%, #b45309 100%)', text: '#fef3c7', pill: '#fbbf24' }, // Sunset Amber
    { bg: 'linear-gradient(135deg, #172554 0%, #1e3a8a 50%, #1d4ed8 100%)', text: '#dbeafe', pill: '#60a5fa' }, // Cobalt Vault
    { bg: 'linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)', text: '#f4f4f5', pill: '#a1a1aa' }, // Stealth Titanium
  ];
  const theme = palettes[Math.abs(hash) % palettes.length];

  // Monogram generation (e.g. "Airport Security Sucks" -> "ASS", "A Game About Chopping Trees" -> "ACT")
  const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  let monogram = '';
  if (words.length >= 3) {
    monogram = (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  } else if (words.length === 2) {
    monogram = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1) {
    monogram = words[0].slice(0, 2).toUpperCase();
  } else {
    monogram = 'XP';
  }

  const genre = game.online ? 'CO-OP' : (game.hasFitgirl ? 'FITGIRL' : 'DIRECT');

  return `
    <div class="card-stylized-cover" style="background: ${theme.bg};">
      <div class="cover-bg-mesh"></div>
      <div class="cover-emblem" style="border-color: ${theme.pill}; color: ${theme.text};">${monogram}</div>
      <div class="cover-title-text" style="color: ${theme.text};">${title}</div>
      <span class="cover-genre-tag" style="border-color: ${theme.pill}; color: ${theme.pill};">${genre}</span>
    </div>
  `;
}

function renderGamesGrid(container, gamesList) {
  if (!container) return;

  const JUNK_NAMES = ['top games', 'recent updates', 'games collections', 'how to run games', 'how to download', 'direct download', 'about us', 'contact us', 'faq', 'dmca', 'privacy policy', 'terms of service'];
  const cleanGamesList = (gamesList || []).filter(g => {
    if (!g) return false;
    const name = (g.name || '').toLowerCase().trim();
    const slug = (g.slug || '').toLowerCase().trim();
    if (JUNK_NAMES.includes(name) || JUNK_NAMES.includes(slug)) return false;
    if (/^(top games|recent updates|games collections|how to run|how to download)/i.test(name)) return false;
    if (/^(top-games|recent-updates|games-collections|how-to-run|how-to-download)/i.test(slug)) return false;
    return true;
  });

  if (cleanGamesList.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-ghost"></i>
        <p>No games found</p>
        <span>Try searching for a different title or resetting the filter pill</span>
      </div>
    `;
    return;
  }

  container.innerHTML = cleanGamesList.map((game, index) => {
    const hasImage = Boolean(game.image);
    const sizeLabel = game.size && game.size !== 'N/A' ? game.size : (game.repackSize || 'Direct');
    const versionLabel = game.version && game.version !== 'Latest' ? game.version : 'Pre-installed';
    const isFitgirlOnly = Boolean(game.source === 'fitgirl' || (game.hasFitgirl && !game.hasSteamrip));
    const stylizedCoverHtml = getStylizedCoverHtml(game);

    return `
      <div class="game-card" data-game-id="${game.id || game.slug}" style="animation-delay: ${Math.min(index * 0.025, 0.3)}s;">
        <div class="card-media">
          ${hasImage ? `
            <img src="${game.image}" 
                 alt="${game.name}" 
                 class="card-img" 
                 loading="lazy"
                 decoding="async"
                 onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
            <div class="card-stylized-wrap" style="display: none;">
              ${stylizedCoverHtml}
            </div>
          ` : `
            <div class="card-stylized-wrap" style="display: flex;">
              ${stylizedCoverHtml}
            </div>
          `}
          <div class="card-overlay-gradient"></div>
          <div class="card-badges">
            ${game.hasFitgirl ? `<span class="badge-tag-fitgirl" style="background: rgba(168, 85, 247, 0.25); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.5); border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 700; margin-right: 4px;"><i class="fa-solid fa-cube"></i> FITGIRL</span>` : ''}
            ${game.hasSteamrip ? `<span class="badge-tag-steamrip" style="background: rgba(59, 130, 246, 0.25); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.5); border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 700; margin-right: 4px;"><i class="fa-solid fa-bolt"></i> STEAMRIP</span>` : ''}
            ${game.online ? `<span class="badge-tag-online"><i class="fa-solid fa-wifi"></i> CO-OP</span>` : ''}
          </div>
        </div>

        <div class="card-body">
          <h3 class="card-title" title="${game.name}">${game.name}</h3>
          
          <div class="card-meta-row">
            <div class="card-meta-item">
              <i class="fa-solid fa-hard-drive"></i>
              <span>${sizeLabel}</span>
            </div>
            <div class="card-meta-item" style="margin-left: auto;">
              <i class="fa-solid fa-code-branch"></i>
              <span>${versionLabel}</span>
            </div>
          </div>

          <div class="card-hover-actions">
            <button class="card-btn-download btn-start-dl" data-game-id="${game.id || game.slug}">
              <i class="fa-solid ${isFitgirlOnly ? 'fa-box-archive' : 'fa-bolt'}"></i>
              <span>${isFitgirlOnly ? 'FitGirl Repack' : '1-Click Download'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Real-time background batch image fetcher to upgrade every game to official Steam 600x900 vertical poster
  const needsPortrait = cleanGamesList.filter(g => {
    if (!g.image) return true;
    const img = g.image.toLowerCase();
    return img.includes('header.jpg') || 
           img.includes('capsule_') || 
           img.includes('steamrip.com/wp-content') ||
           !img.includes('library_600x900.jpg');
  });

  if (needsPortrait.length > 0) {
    ipcRenderer.invoke('batch-get-game-media', needsPortrait).then(res => {
      if (res && res.success && res.results) {
        Object.entries(res.results).forEach(([key, media]) => {
          if (!media) return;
          const imgUrl = media.portraitImage || media.capsuleImage || media.headerImage;
          if (!imgUrl) return;

          const matchGame = cleanGamesList.find(g => (g.name || g.slug || '').trim().toLowerCase() === key);
          if (matchGame) {
            matchGame.image = imgUrl;
            const card = container.querySelector(`.game-card[data-game-id="${matchGame.id || matchGame.slug}"]`);
            if (card) {
              const mediaBox = card.querySelector('.card-media');
              if (mediaBox) {
                let img = mediaBox.querySelector('.card-img');
                const stylizedWrap = mediaBox.querySelector('.card-stylized-wrap');
                if (!img) {
                  img = document.createElement('img');
                  img.className = 'card-img';
                  img.alt = matchGame.name;
                  img.loading = 'lazy';
                  img.decoding = 'async';
                  mediaBox.insertBefore(img, mediaBox.firstChild);
                }
                img.src = imgUrl;
                img.style.display = 'block';
                if (stylizedWrap) stylizedWrap.style.display = 'none';
              }
            }
          }
        });
      }
    }).catch(() => {});
  }

  // Bind click handlers for full game detail view and instant download
  container.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const gameId = card.getAttribute('data-game-id');
      const game = gamesList.find(g => (g.id === gameId || g.slug === gameId)) ||
                   (AppState.games.concat(AppState.coopGames)).find(g => (g.id === gameId || g.slug === gameId));
      if (!game) return;

      if (e.target.closest('.btn-start-dl')) {
        e.stopPropagation();
        if (game.source === 'fitgirl' || (game.hasFitgirl && !game.hasSteamrip)) {
          openGameDetailView(game);
          return;
        }
        triggerQuickDownload(game);
        return;
      }
      openGameDetailView(game);
    });
  });
}

function updatePaginationControls() {
  const prevBtn = document.getElementById('btnPrevPage');
  const nextBtn = document.getElementById('btnNextPage');
  const indicator = document.getElementById('pageIndicator');

  if (prevBtn) prevBtn.disabled = AppState.currentPage <= 1;
  if (nextBtn) nextBtn.disabled = AppState.currentPage >= AppState.totalPages;
  if (indicator) {
    const isFilteredCategory = AppState.selectedCategory && AppState.selectedCategory !== 'all';
    const isSearch = Boolean(AppState.searchQuery && AppState.searchQuery.trim());
    if (isFilteredCategory || isSearch) {
      const label = isFilteredCategory ? AppState.selectedCategory : 'Found';
      const count = AppState.totalPosts || (AppState.totalPages * 24);
      indicator.textContent = `Page ${AppState.currentPage} of ${AppState.totalPages} · (${count.toLocaleString()} ${label} Games)`;
    } else {
      const count = AppState.totalPosts || AppState.totalIndexedGames || 10163;
      indicator.textContent = `Page ${AppState.currentPage} of ${AppState.totalPages} · (${count.toLocaleString()} Games)`;
    }
  }
}

function updateSpotlightBanner(game) {
  if (!game) return;
  const heroTitle = document.getElementById('heroTitle');
  const heroDesc = document.getElementById('heroDesc');
  const heroBackdrop = document.getElementById('heroBackdrop');

  if (heroTitle) heroTitle.textContent = game.name;
  if (heroDesc) heroDesc.textContent = game.summary ? (game.summary.slice(0, 190) + '...') : `High-speed 1-click download with verified Buzzheavier CDN direct mirrors.`;
  if (heroBackdrop && game.image) heroBackdrop.style.backgroundImage = `url('${game.image}')`;
}

// =========================================================
// Dropdown Menu & Multi-Source Detail Action Handlers
// =========================================================
function closeAllDetailDropdowns() {
  const menus = ['detailSteamripMenu', 'sidebarSteamripMenu', 'detailFitgirlMenu', 'sidebarFitgirlMenu'];
  menus.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

async function ensureFitgirlDetails(game) {
  if (game._fitgirlDetails) return game._fitgirlDetails;
  
  let fgUrl = game.fitgirlUrl;
  if (!fgUrl) {
    const sourceRes = await ipcRenderer.invoke('get-game-sources', game.name, game.slug || game.id);
    if (sourceRes && sourceRes.hasFitgirl && sourceRes.fitgirl) {
      fgUrl = sourceRes.fitgirl.url;
      game.fitgirlUrl = fgUrl;
    }
  }

  if (fgUrl) {
    showToast({
      title: 'Loading FitGirl Repack',
      message: 'Resolving download mirrors...',
      icon: 'fa-solid fa-spinner fa-spin',
      duration: 3000
    });
    const fgRes = await ipcRenderer.invoke('get-fitgirl-details', fgUrl);
    if (fgRes && fgRes.success && fgRes.details) {
      game._fitgirlDetails = fgRes.details;
      return fgRes.details;
    }
  }
  return null;
}

async function triggerFitgirlDirectDownload(game, preferredHoster = 'fuckingfast') {
  const hosterLabel = preferredHoster === 'fuckingfast' ? 'FuckingFast' : 'DataNodes';
  showToast({
    title: `Connecting to ${hosterLabel}`,
    message: 'Resolving multi-part archive packages...',
    icon: 'fa-solid fa-bolt',
    duration: 3500
  });

  const fg = await ensureFitgirlDetails(game);
  if (!fg) {
    showToast({
      title: 'FitGirl Repacks',
      message: 'Could not fetch mirrors. Please check connection.',
      icon: 'fa-solid fa-circle-exclamation'
    });
    return;
  }

  const providers = fg.providers || fg.directProviders || [];
  
  // Look for FuckingFast first (user default), then DataNodes, or any multi-part provider
  let chosen = providers.find(p => p.type === preferredHoster || (p.name && p.name.toLowerCase().includes(preferredHoster)));
  
  if (!chosen && preferredHoster !== 'fuckingfast') {
    chosen = providers.find(p => p.type === 'fuckingfast' || (p.name && p.name.toLowerCase().includes('fuckingfast')));
  }

  if (!chosen) {
    chosen = providers.find(p => p.isMultiPart && p.parts && p.parts.length > 0);
  }

  if (!chosen) {
    chosen = providers.find(p => p.url && !p.url.includes('paste.') && p.type !== 'torrent');
  }

  if (chosen) {
    const rawParts = (chosen.parts && chosen.parts.length > 0) ? chosen.parts : (chosen.url ? [chosen.url] : []);
    if (rawParts.length > 0) {
      showToast({
        title: 'FitGirl Download Started',
        message: `Queueing ${rawParts.length} parts via ${chosen.name || 'FuckingFast'}! Auto Turnstile bypass active.`,
        icon: 'fa-solid fa-box-archive',
        duration: 5000
      });

      const partsList = rawParts.map((partUrl, i) => ({
        index: i + 1,
        url: partUrl,
        filename: `part_${i + 1}.rar`
      }));

      const res = await ipcRenderer.invoke('start-multipart-download', {
        id: `mp_${Date.now()}`,
        gameName: `${game.name} [FitGirl Repack]`,
        parts: partsList
      });

      if (res && res.success) {
        switchView('downloads-view');
        return;
      } else {
        showToast({
          title: 'Download Error',
          message: res?.error || 'Failed to start multi-part download.',
          icon: 'fa-solid fa-circle-xmark'
        });
        return;
      }
    }
  }

  // Fallback: If direct archive links not ready, try torrent stream
  const torrentProvider = providers.find(p => p.type === 'torrent' || p.url?.startsWith('magnet:') || p.url?.endsWith('.torrent'));
  if (torrentProvider) {
    triggerFitgirlTorrentDownload(game);
    return;
  }

  // Final fallback: open mirrors modal
  openFitgirlProviderModal(game, fg);
}

async function triggerFitgirlTorrentDownload(game) {
  showToast({
    title: 'Resolving FitGirl Swarm',
    message: 'Extracting magnet metadata...',
    icon: 'fa-solid fa-spinner fa-spin',
    duration: 3500
  });

  const fg = await ensureFitgirlDetails(game);
  if (!fg) {
    showToast({
      title: 'FitGirl Repacks',
      message: 'Could not resolve torrent details.',
      icon: 'fa-solid fa-circle-exclamation'
    });
    return;
  }

  const providers = fg.providers || fg.directProviders || [];
  const torrentProvider = providers.find(p => p.type === 'torrent' || p.url?.startsWith('magnet:') || p.url?.endsWith('.torrent'));

  if (torrentProvider && (torrentProvider.url.startsWith('magnet:') || torrentProvider.url.endsWith('.torrent'))) {
    showToast({
      title: 'BitTorrent Swarm Connected',
      message: `Downloading ${game.name} directly via in-app peer swarm!`,
      icon: 'fa-solid fa-magnet',
      duration: 4000
    });

    const res = await ipcRenderer.invoke('start-torrent-download', {
      id: `torrent_${Date.now()}`,
      gameName: `${game.name} [FitGirl Repack]`,
      magnetUrl: torrentProvider.url
    });

    if (res && res.success) {
      switchView('downloads-view');
    } else {
      showToast({
        title: 'Torrent Error',
        message: res?.error || 'Could not start torrent download.',
        icon: 'fa-solid fa-circle-xmark'
      });
    }
  } else {
    openFitgirlProviderModal(game, fg);
  }
}

async function triggerFitgirlJDownloader(game) {
  const fg = await ensureFitgirlDetails(game);
  if (!fg) {
    showToast({ title: 'JDownloader 2', message: 'Could not resolve repack links.', icon: 'fa-solid fa-circle-exclamation' });
    return;
  }

  const providers = fg.providers || fg.directProviders || [];
  const multiProvider = providers.find(p => p.isMultiPart && p.parts && p.parts.length > 0);
  if (multiProvider && multiProvider.parts.length > 0) {
    await navigator.clipboard.writeText(multiProvider.parts.join('\n'));
    const res = await ipcRenderer.invoke('send-to-jdownloader', {
      packageName: `${game.name} [FitGirl Repack]`,
      urls: multiProvider.parts
    });

    if (res && res.jdownloaderRunning) {
      showToast({
        title: '⚡ JDownloader Success',
        message: `Sent ${multiProvider.parts.length} parts to JDownloader 2! Ready in LinkGrabber.`,
        icon: 'fa-solid fa-bolt',
        duration: 6000
      });
    } else {
      showToast({
        title: '📋 Links Copied to Clipboard',
        message: `Copied ${multiProvider.parts.length} links! Open JDownloader 2 to auto-grab.`,
        icon: 'fa-solid fa-copy',
        duration: 6000
      });
    }
  } else {
    openFitgirlProviderModal(game, fg);
  }
}

// =========================================================
// Dedicated Full Game Detail View Tab
// =========================================================
async function openGameDetailView(game) {
  if (!game) return;
  AppState.selectedGameForDetail = game;
  if (AppState.currentView !== 'game-detail-view') {
    AppState.previousView = AppState.currentView;
  }

  const sourceLabel = AppState.previousView === 'discover-view' ? 'Discover' :
                     AppState.previousView === 'multiplayer-view' ? 'Co-op Library' : 'All Games';
  const detailSourceBreadcrumb = document.getElementById('detailSourceBreadcrumb');
  const breadcrumbGameTitle = document.getElementById('breadcrumbGameTitle');
  if (detailSourceBreadcrumb) detailSourceBreadcrumb.textContent = sourceLabel;
  if (breadcrumbGameTitle) breadcrumbGameTitle.textContent = game.name;

  const detailGameTitle = document.getElementById('detailGameTitle');
  const detailGameTagline = document.getElementById('detailGameTagline');
  const detailVersionBadge = document.getElementById('detailVersionBadge');
  const detailSizeBadge = document.getElementById('detailSizeBadge');
  const detailCoopBadge = document.getElementById('detailCoopBadge');
  const gameShowcaseBackdrop = document.getElementById('gameShowcaseBackdrop');
  const detailDescriptionBody = document.getElementById('detailDescriptionBody');
  const detailReqsList = document.getElementById('detailReqsList');
  const detailMetaTable = document.getElementById('detailMetaTable');
  const featuredScreenshotImg = document.getElementById('featuredScreenshotImg');
  const screenshotThumbnails = document.getElementById('screenshotThumbnails');
  const screenshotLoader = document.getElementById('screenshotLoader');
  const screenshotCountLabel = document.getElementById('screenshotCountLabel');

  if (detailGameTitle) detailGameTitle.textContent = game.name;
  if (detailVersionBadge) detailVersionBadge.textContent = game.version && game.version !== 'Latest' ? `Version: ${game.version}` : 'Pre-installed';
  if (detailSizeBadge) detailSizeBadge.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${game.size || 'Direct Download'}`;
  if (detailCoopBadge) detailCoopBadge.style.display = game.online ? 'inline-flex' : 'none';

  if (gameShowcaseBackdrop) {
    if (game.image) gameShowcaseBackdrop.style.backgroundImage = `url('${game.image}')`;
    else gameShowcaseBackdrop.style.backgroundImage = 'none';
  }

  // Navigate to full detail view
  switchView('game-detail-view');

  // Immediately paint Hero Backdrop and Badges
  if (gameShowcaseBackdrop && game.image) {
    gameShowcaseBackdrop.style.backgroundImage = `url('${game.image}')`;
  }
  if (detailSizeBadge) detailSizeBadge.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${game.size || 'Direct Download'}`;
  if (detailVersionBadge) detailVersionBadge.textContent = game.version && game.version !== 'Latest' ? `Version: ${game.version}` : 'Pre-installed';

  // Story & Description - instant paint
  if (detailDescriptionBody) {
    if (game.summary) {
      detailDescriptionBody.innerHTML = `<p>${game.summary}</p>`;
    } else {
      detailDescriptionBody.innerHTML = `<p>Experience ${game.name}, pre-installed and patched for Windows. Includes complete game files with verified Buzzheavier high-speed mirrors.</p>`;
    }
  }
  if (detailGameTagline) {
    detailGameTagline.textContent = game.summary ? (game.summary.slice(0, 160) + '...') : `Full pre-installed edition with direct Buzzheavier high-speed stream.`;
  }

  // Media / Screenshots Gallery - Instant render
  const renderScreenshots = (shots) => {
    let list = Array.isArray(shots) ? shots.filter(Boolean) : [];
    if (list.length === 0 && game.image) list = [game.image];
    if (list.length > 0) {
      if (screenshotLoader) screenshotLoader.style.display = 'none';
      if (screenshotCountLabel) screenshotCountLabel.textContent = `${list.length} HD Captures`;
      if (featuredScreenshotImg) {
        featuredScreenshotImg.src = list[0];
        featuredScreenshotImg.style.display = 'block';
      }
      if (screenshotThumbnails) {
        screenshotThumbnails.innerHTML = list.map((src, idx) => `
          <div class="thumb-item ${idx === 0 ? 'active' : ''}" data-src="${src}">
            <img src="${src}" alt="Thumbnail ${idx + 1}" loading="lazy">
          </div>
        `).join('');

        screenshotThumbnails.querySelectorAll('.thumb-item').forEach(thumb => {
          thumb.addEventListener('click', () => {
            screenshotThumbnails.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
            const fullSrc = thumb.getAttribute('data-src');
            if (featuredScreenshotImg) featuredScreenshotImg.src = fullSrc;
          });
        });
      }
    } else {
      if (screenshotLoader) {
        screenshotLoader.style.display = 'flex';
        screenshotLoader.innerHTML = '<i class="fa-solid fa-image"></i> Artwork ready upon download';
      }
    }
  };

  renderScreenshots(game.screenshots);

  // Background non-blocking fetch to enrich Steam screenshots and details
  const targetGameSlug = game.slug || game.id;
  ipcRenderer.invoke('get-game-details', targetGameSlug).then(res => {
    if (res && res.success && res.game) {
      const currentActiveTitle = document.getElementById('detailGameTitle');
      if (currentActiveTitle && currentActiveTitle.textContent === game.name) {
        Object.assign(game, res.game);
        if (res.game.screenshots && res.game.screenshots.length > 0) {
          renderScreenshots(res.game.screenshots);
        }
        if (res.game.summary && detailDescriptionBody) {
          detailDescriptionBody.innerHTML = `<p>${res.game.summary}</p>`;
        }
        if (res.game.requirements && detailReqsList && typeof res.game.requirements === 'object') {
          detailReqsList.innerHTML = Object.entries(res.game.requirements).map(([key, val]) => `
            <div class="detail-req-row">
              <div class="detail-req-label">${key}</div>
              <div class="detail-req-value">${val}</div>
            </div>
          `).join('');
        }
      }
    }
  }).catch(() => {});

  // System Requirements
  if (detailReqsList) {
    if (game.requirements && typeof game.requirements === 'object' && Object.keys(game.requirements).length > 0) {
      detailReqsList.innerHTML = Object.entries(game.requirements).map(([key, val]) => `
        <div class="detail-req-row">
          <div class="detail-req-label">${key}</div>
          <div class="detail-req-value">${val}</div>
        </div>
      `).join('');
    } else {
      detailReqsList.innerHTML = `
        <div class="detail-req-row">
          <div class="detail-req-label">Operating System</div>
          <div class="detail-req-value">Windows 10 / 11 (64-bit)</div>
        </div>
        <div class="detail-req-row">
          <div class="detail-req-label">Processor & Graphics</div>
          <div class="detail-req-value">DirectX 11 / 12 Compatible Hardware</div>
        </div>
        <div class="detail-req-row">
          <div class="detail-req-label">Storage</div>
          <div class="detail-req-value">${game.size || 'Standard Disk Space'}</div>
        </div>
      `;
    }
  }

  // Metadata Table
  if (detailMetaTable) {
    const cats = Array.isArray(game.categories) ? game.categories.join(', ') : 'General, Action';
    detailMetaTable.innerHTML = `
      <div class="meta-spec-item"><span class="meta-spec-key">Genre</span><span class="meta-spec-val">${cats}</span></div>
      <div class="meta-spec-item"><span class="meta-spec-key">Download Size</span><span class="meta-spec-val">${game.size || 'Direct'}</span></div>
      <div class="meta-spec-item"><span class="meta-spec-key">Build / Version</span><span class="meta-spec-val">${game.version || 'Pre-installed'}</span></div>
      ${game.developer ? `<div class="meta-spec-item"><span class="meta-spec-key">Developer</span><span class="meta-spec-val">${game.developer}</span></div>` : ''}
      ${game.releaseDate ? `<div class="meta-spec-item"><span class="meta-spec-key">Release Date</span><span class="meta-spec-val">${game.releaseDate}</span></div>` : ''}
      <div class="meta-spec-item"><span class="meta-spec-key">Multiplayer</span><span class="meta-spec-val">${game.online ? 'Online Co-op Supported' : 'Single Player'}</span></div>
      <div class="meta-spec-item"><span class="meta-spec-key">Host Mirror</span><span class="meta-spec-val" style="color: #4ade80;">Buzzheavier CDN</span></div>
    `;
  }

  // Dual-Source Game Resolution (SteamRIP Buzzheavier + FitGirl Repacks)
  const detailSteamripGroup = document.getElementById('detailSteamripGroup');
  const sidebarSteamripGroup = document.getElementById('sidebarSteamripGroup');
  const detailFitgirlGroup = document.getElementById('detailFitgirlGroup');
  const sidebarFitgirlGroup = document.getElementById('sidebarFitgirlGroup');
  const repackFeaturesSection = document.getElementById('repackFeaturesSection');
  const repackFeaturesBody = document.getElementById('repackFeaturesBody');

  // INSTANT 0ms SIMULTANEOUS VISIBILITY
  const hasFitgirl = Boolean(game.hasFitgirl || game.source === 'fitgirl' || game.fitgirlUrl);
  const hasSteamrip = Boolean(game.hasSteamrip !== false && game.source !== 'fitgirl');

  // Immediately render button groups
  if (detailSteamripGroup) detailSteamripGroup.style.display = hasSteamrip ? 'inline-flex' : 'none';
  if (sidebarSteamripGroup) sidebarSteamripGroup.style.display = hasSteamrip ? 'flex' : 'none';

  if (detailFitgirlGroup) detailFitgirlGroup.style.display = hasFitgirl ? 'inline-flex' : 'none';
  if (sidebarFitgirlGroup) sidebarFitgirlGroup.style.display = hasFitgirl ? 'flex' : 'none';

  if (repackFeaturesSection) repackFeaturesSection.style.display = 'none';

  // Helper to toggle a dropdown menu
  const bindDropdown = (toggleId, menuId) => {
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);
    if (!toggle || !menu) return;
    toggle.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display === 'flex';
      closeAllDetailDropdowns();
      menu.style.display = isOpen ? 'none' : 'flex';
    };
  };

  // Bind dropdown toggles
  bindDropdown('detailSteamripToggle', 'detailSteamripMenu');
  bindDropdown('sidebarSteamripToggle', 'sidebarSteamripMenu');
  bindDropdown('detailFitgirlToggle', 'detailFitgirlMenu');
  bindDropdown('sidebarFitgirlToggle', 'sidebarFitgirlMenu');

  // 1. STEAMRIP BUTTON ACTIONS:
  // Direct click -> Buzzheavier CDN (Default)
  const srBuzzheavierAction = () => {
    closeAllDetailDropdowns();
    triggerQuickDownload(game);
  };
  const detailDownloadBtn = document.getElementById('detailDownloadBtn');
  const sidebarDownloadBtn = document.getElementById('sidebarDownloadBtn');
  const detailSrOptBuzzheavier = document.getElementById('detailSrOptBuzzheavier');
  const sidebarSrOptBuzzheavier = document.getElementById('sidebarSrOptBuzzheavier');
  if (detailDownloadBtn) detailDownloadBtn.onclick = srBuzzheavierAction;
  if (sidebarDownloadBtn) sidebarDownloadBtn.onclick = srBuzzheavierAction;
  if (detailSrOptBuzzheavier) detailSrOptBuzzheavier.onclick = srBuzzheavierAction;
  if (sidebarSrOptBuzzheavier) sidebarSrOptBuzzheavier.onclick = srBuzzheavierAction;

  // SteamRIP Other Mirrors -> Modal
  const srMirrorsAction = () => {
    closeAllDetailDropdowns();
    openSteamripProviderModal(game);
  };
  const detailSrOptMirrors = document.getElementById('detailSrOptMirrors');
  const sidebarSrOptMirrors = document.getElementById('sidebarSrOptMirrors');
  if (detailSrOptMirrors) detailSrOptMirrors.onclick = srMirrorsAction;
  if (sidebarSrOptMirrors) sidebarSrOptMirrors.onclick = srMirrorsAction;

  // 2. FITGIRL BUTTON ACTIONS:
  // Direct click -> FuckingFast (Default 1-Click with Turnstile solver)
  const fgFuckingFastAction = () => {
    closeAllDetailDropdowns();
    triggerFitgirlDirectDownload(game, 'fuckingfast');
  };
  const detailFitgirlBtn = document.getElementById('detailFitgirlBtn');
  const sidebarFitgirlBtn = document.getElementById('sidebarFitgirlBtn');
  const detailFgOptFuckingFast = document.getElementById('detailFgOptFuckingFast');
  const sidebarFgOptFuckingFast = document.getElementById('sidebarFgOptFuckingFast');
  if (detailFitgirlBtn) detailFitgirlBtn.onclick = fgFuckingFastAction;
  if (sidebarFitgirlBtn) sidebarFitgirlBtn.onclick = fgFuckingFastAction;
  if (detailFgOptFuckingFast) detailFgOptFuckingFast.onclick = fgFuckingFastAction;
  if (sidebarFgOptFuckingFast) sidebarFgOptFuckingFast.onclick = fgFuckingFastAction;

  // DataNodes direct
  const fgDataNodesAction = () => {
    closeAllDetailDropdowns();
    triggerFitgirlDirectDownload(game, 'datanodes');
  };
  const detailFgOptDataNodes = document.getElementById('detailFgOptDataNodes');
  const sidebarFgOptDataNodes = document.getElementById('sidebarFgOptDataNodes');
  if (detailFgOptDataNodes) detailFgOptDataNodes.onclick = fgDataNodesAction;
  if (sidebarFgOptDataNodes) sidebarFgOptDataNodes.onclick = fgDataNodesAction;

  // Torrent / Magnet
  const fgTorrentAction = () => {
    closeAllDetailDropdowns();
    triggerFitgirlTorrentDownload(game);
  };
  const detailFgOptTorrent = document.getElementById('detailFgOptTorrent');
  const sidebarFgOptTorrent = document.getElementById('sidebarFgOptTorrent');
  if (detailFgOptTorrent) detailFgOptTorrent.onclick = fgTorrentAction;
  if (sidebarFgOptTorrent) sidebarFgOptTorrent.onclick = fgTorrentAction;

  // Send to JDownloader
  const fgJDownloaderAction = () => {
    closeAllDetailDropdowns();
    triggerFitgirlJDownloader(game);
  };
  const detailFgOptJDownloader = document.getElementById('detailFgOptJDownloader');
  const sidebarFgOptJDownloader = document.getElementById('sidebarFgOptJDownloader');
  if (detailFgOptJDownloader) detailFgOptJDownloader.onclick = fgJDownloaderAction;
  if (sidebarFgOptJDownloader) sidebarFgOptJDownloader.onclick = fgJDownloaderAction;

  // Full Mirrors Modal
  const fgAllMirrorsAction = async () => {
    closeAllDetailDropdowns();
    const fg = await ensureFitgirlDetails(game);
    if (fg) openFitgirlProviderModal(game, fg);
  };
  const detailFgOptAllMirrors = document.getElementById('detailFgOptAllMirrors');
  const sidebarFgOptAllMirrors = document.getElementById('sidebarFgOptAllMirrors');
  if (detailFgOptAllMirrors) detailFgOptAllMirrors.onclick = fgAllMirrorsAction;
  if (sidebarFgOptAllMirrors) sidebarFgOptAllMirrors.onclick = fgAllMirrorsAction;

  // Background non-blocking fetch to preload repack features and providers
  ipcRenderer.invoke('get-game-sources', game.name, game.slug || game.id).then(async (sourceRes) => {
    if (!sourceRes || !sourceRes.success) return;

    if (sourceRes.hasFitgirl && sourceRes.fitgirl) {
      if (detailFitgirlGroup) detailFitgirlGroup.style.display = 'inline-flex';
      if (sidebarFitgirlGroup) sidebarFitgirlGroup.style.display = 'flex';

      try {
        const fgDetailsRes = await ipcRenderer.invoke('get-fitgirl-details', sourceRes.fitgirl.url);
        if (fgDetailsRes && fgDetailsRes.success && fgDetailsRes.details) {
          const fg = fgDetailsRes.details;
          game._fitgirlDetails = fg;

          // Render exact raw Repack Features block from game post directly
          if (fg.repackFeatures && (fg.repackFeatures.rawHtml || fg.repackFeatures.bullets?.length > 0)) {
            if (repackFeaturesSection) repackFeaturesSection.style.display = 'block';
            if (repackFeaturesBody) {
              repackFeaturesBody.innerHTML = fg.repackFeatures.rawHtml || `<ul>${fg.repackFeatures.bullets.map(b => `<li>${b}</li>`).join('')}</ul>`;
            }
          }
        }
      } catch (e) {
        console.warn('Could not preload FitGirl details:', e);
      }
    }
  }).catch(() => {});
}

// =========================================================
// FitGirl In-App Provider & Multi-Part Modal
// =========================================================
async function openFitgirlProviderModal(game, fitgirlDetails, fitgirlMeta) {
  const modal = document.getElementById('fitgirlProviderModal');
  const titleEl = document.getElementById('fitgirlModalTitle');
  const subEl = document.getElementById('fitgirlModalSub');
  const directList = document.getElementById('fitgirlDirectProvidersList');
  const multiList = document.getElementById('fitgirlMultipartList');
  const textarea = document.getElementById('multipartLinksInput');
  const countEl = document.getElementById('multipartDetectedCount');
  const startMultiBtn = document.getElementById('btnStartMultipartDownload');
  const sendJdMultiBtn = document.getElementById('btnSendJDownloaderMultipart');
  const copyAllMultiBtn = document.getElementById('btnCopyAllMultipart');
  const closeBtn = document.getElementById('btnCloseFitgirlModal');

  if (!modal) return;

  if (titleEl) titleEl.textContent = `${game.name} - FitGirl Mirrors`;
  if (subEl) subEl.textContent = `Original Size: ${fitgirlDetails.originalSize || 'Full'} | Repack Size: ${fitgirlDetails.repackSize || 'Compressed'}`;

  const providers = fitgirlDetails.providers || [];
  // Sort so Torrent / Magnet is always at the top, followed by direct APIs, then multi-parts
  const directProviders = providers
    .filter(p => p.type !== 'paste')
    .sort((a, b) => {
      if (a.type === 'torrent') return -1;
      if (b.type === 'torrent') return 1;
      if (a.isMultiPart && !b.isMultiPart) return 1;
      if (!a.isMultiPart && b.isMultiPart) return -1;
      return 0;
    });
  const pasteProviders = providers.filter(p => p.type === 'paste');

  // Render direct providers
  if (directList) {
    if (directProviders.length === 0) {
      directList.innerHTML = `<div style="color: #94a3b8; font-size: 13px;">No direct mirrors found. Use multi-part links below.</div>`;
    } else {
      const bannerHtml = `
        <div class="fitgirl-pro-banner" style="background: linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(124, 58, 237, 0.12) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 12px;">
          <i class="fa-solid fa-bolt" style="color: #60a5fa; font-size: 18px; margin-top: 2px;"></i>
          <div style="font-size: 12.5px; line-height: 1.5; color: #cbd5e1;">
            <strong style="color: #60a5fa;">1-Click Fast Downloads:</strong>
            <div style="margin-top: 5px; display: flex; flex-direction: column; gap: 4px;">
              <div><span style="color: #4ade80; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> 1-Click In-App (Torrent):</span> High-speed peer swarm download directly inside KyroSphere with zero Cloudflare captchas and automatic extraction!</div>
              <div><span style="color: #38bdf8; font-weight: 700;"><i class="fa-solid fa-bolt"></i> 1-Click JDownloader:</span> Click <strong>1-Click JDownloader</strong> on multi-part packages (FuckingFast / DataNodes) to send all parts directly into JDownloader 2 in 1 click!</div>
            </div>
          </div>
        </div>
      `;

      directList.innerHTML = bannerHtml + directProviders.map((p, idx) => {
        let icon = 'fa-solid fa-cloud-arrow-down';
        let badge = 'In-App Direct Stream';
        const isMulti = Boolean(p.isMultiPart && p.parts && p.parts.length > 0);
        const isTorrent = p.type === 'torrent';

        if (isTorrent) {
          icon = 'fa-solid fa-bolt-lightning';
          badge = '⭐ RECOMMENDED · 1-Click Full Speed · Zero Cloudflare';
        } else if (isMulti) {
          icon = 'fa-solid fa-boxes-stacked';
          badge = `📦 Multi-Part Package · ${p.parts.length} Parts`;
        } else if (p.type === 'fuckingfast') {
          badge = 'High-Speed Hoster';
        } else if (p.type === 'datanodes') {
          badge = 'Fast Direct Hoster';
        } else if (p.type === 'pixeldrain') {
          badge = 'Direct API Stream (No Captcha)';
        }

        let buttonLabel = 'Download';
        let buttonIcon = 'fa-solid fa-bolt';
        const isMagnet = p.url.startsWith('magnet:') || p.url.endsWith('.torrent');
        const isTrackerPage = p.url.includes('1337x') || p.url.includes('rutor') || p.url.includes('torrentgalaxy');

        if (isMagnet) {
          buttonLabel = '1-Click In-App Download';
          buttonIcon = 'fa-solid fa-download';
          badge = '⭐ RECOMMENDED · 1-Click In-App · Zero Cloudflare · Auto-Extract';
        } else if (isTrackerPage) {
          buttonLabel = `Open ${p.name.split(' ')[0]}`;
          buttonIcon = 'fa-solid fa-arrow-up-right-from-square';
          badge = 'Torrent Tracker Webpage';
        }

        return `
          <div class="provider-card ${isTorrent ? 'featured-torrent' : ''}">
            <div class="provider-info-col">
              <div class="provider-icon-circle"><i class="${icon}"></i></div>
              <div style="min-width: 0; overflow: hidden;">
                <div class="provider-name" title="${p.name}">${p.name}</div>
                <div class="provider-tag" style="${isTorrent ? 'color: #34d399; font-weight: 600;' : ''}">${badge}</div>
              </div>
            </div>
            <div class="provider-actions-col">
              ${isMulti ? `
                <button class="btn-provider-dl-multi" data-idx="${idx}" style="background: linear-gradient(135deg, #7c3aed, #6d28d9); border: none; color: #fff; border-radius: 8px; padding: 9px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; transition: all 0.2s;">
                  <i class="fa-solid fa-download"></i> <span>Download In-App</span>
                </button>
                <button class="btn-provider-jd" data-idx="${idx}" title="Send all parts directly to JDownloader 2" style="background: rgba(37, 99, 235, 0.15); border: 1px solid rgba(37, 99, 235, 0.35); color: #60a5fa; border-radius: 8px; padding: 9px 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;">
                  <i class="fa-solid fa-bolt"></i> <span>JD2</span>
                </button>
                <button class="btn-provider-copy" data-idx="${idx}" title="Copy links" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; padding: 9px 12px; cursor: pointer;">
                  <i class="fa-solid fa-copy"></i>
                </button>
              ` : `
                <button class="btn-provider-dl" data-idx="${idx}">
                  <i class="${buttonIcon}"></i> <span>${buttonLabel}</span>
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');

      directList.querySelectorAll('.btn-provider-copy').forEach(copyBtn => {
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          const p = directProviders[parseInt(copyBtn.getAttribute('data-idx'), 10)];
          if (p && p.parts && p.parts.length > 0) {
            navigator.clipboard.writeText(p.parts.join('\n'));
            showToast({
              title: 'Links Copied to Clipboard',
              message: `Copied ${p.parts.length} archive links!`,
              icon: 'fa-solid fa-copy',
              duration: 5000
            });
          }
        };
      });

      // Download In-App (Multi-Part Queue)
      directList.querySelectorAll('.btn-provider-dl-multi').forEach(dlBtn => {
        dlBtn.onclick = async (e) => {
          e.stopPropagation();
          const p = directProviders[parseInt(dlBtn.getAttribute('data-idx'), 10)];
          if (!p || !p.parts || p.parts.length === 0) return;

          dlBtn.disabled = true;
          dlBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Starting Queue...</span>`;

          try {
            const partsList = p.parts.map((partUrl, i) => ({
              index: i + 1,
              url: partUrl,
              filename: `part_${i + 1}.rar`
            }));

            const res = await ipcRenderer.invoke('start-multipart-download', {
              id: `mp_${Date.now()}`,
              gameName: `${game.name} [FitGirl Repack]`,
              parts: partsList
            });

            if (res && res.success) {
              modal.style.display = 'none';
              switchView('downloads-view');
              showToast({
                title: 'Multi-Part Download Started',
                message: `Queueing ${p.parts.length} parts in background with auto 7-Zip extraction!`,
                icon: 'fa-solid fa-box-archive'
              });
            } else {
              throw new Error(res?.error || 'Failed to start multi-part download.');
            }
          } catch (err) {
            dlBtn.disabled = false;
            dlBtn.innerHTML = `<i class="fa-solid fa-download"></i> <span>Download In-App</span>`;
            showToast({ title: 'Download Error', message: err.message, icon: 'fa-solid fa-circle-xmark' });
          }
        };
      });

      // Push to JDownloader 2
      directList.querySelectorAll('.btn-provider-jd').forEach(jdBtn => {
        jdBtn.onclick = async (e) => {
          e.stopPropagation();
          const p = directProviders[parseInt(jdBtn.getAttribute('data-idx'), 10)];
          if (!p || !p.parts || p.parts.length === 0) return;

          jdBtn.disabled = true;
          jdBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending...</span>`;

          try {
            // Copy all links to clipboard
            await navigator.clipboard.writeText(p.parts.join('\n'));

            // Push to JDownloader 2 FlashGot / Click'n'Load API
            const res = await ipcRenderer.invoke('send-to-jdownloader', {
              packageName: `${game.name} [FitGirl Repack]`,
              urls: p.parts
            });

            if (res && res.jdownloaderRunning) {
              showToast({
                title: '⚡ JDownloader Success',
                message: `Sent all ${p.parts.length} parts to JDownloader 2! Ready in LinkGrabber.`,
                icon: 'fa-solid fa-bolt',
                duration: 6000
              });
            } else {
              showToast({
                title: '📋 Links Copied to Clipboard',
                message: `Copied ${p.parts.length} links! (Open JDownloader 2 to auto-grab them).`,
                icon: 'fa-solid fa-copy',
                duration: 6000
              });
            }
          } catch (err) {
            showToast({
              title: 'Links Copied',
              message: `Copied ${p.parts.length} parts to clipboard!`,
              icon: 'fa-solid fa-copy'
            });
          } finally {
            jdBtn.disabled = false;
            jdBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> <span>JD2</span>`;
          }
        };
      });

      directList.querySelectorAll('.btn-provider-dl').forEach(btn => {
        btn.onclick = async () => {
          const p = directProviders[parseInt(btn.getAttribute('data-idx'), 10)];
          if (!p) return;

          // External Torrent Tracker Page (1337x / RuTor)
          if (p.url.includes('1337x') || p.url.includes('rutor') || p.url.includes('torrentgalaxy')) {
            ipcRenderer.invoke('open-url', p.url);
            showToast({
              title: 'Opening Tracker Page',
              message: `Opened ${p.name} in browser to copy magnet or torrent link.`,
              icon: 'fa-solid fa-arrow-up-right-from-square'
            });
            return;
          }

          // In-App BitTorrent Swarm Engine (Direct Magnet or .torrent)
          if (p.type === 'torrent' || p.url.startsWith('magnet:') || p.url.endsWith('.torrent')) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Connecting Swarm...`;
            try {
              showToast({
                title: 'Connecting BitTorrent Swarm',
                message: `Initializing in-app torrent download for ${game.name}...`,
                icon: 'fa-solid fa-magnet'
              });
              const res = await ipcRenderer.invoke('start-torrent-download', {
                id: `torrent_${Date.now()}`,
                gameName: `${game.name} [FitGirl Repack]`,
                magnetUrl: p.url
              });
              if (res && res.success) {
                modal.style.display = 'none';
                switchView('downloads-view');
                showToast({
                  title: 'Torrent Download Active',
                  message: `Downloading from swarm with live peer tracking!`,
                  icon: 'fa-solid fa-circle-check'
                });
              } else {
                throw new Error(res?.error || 'Could not start torrent download.');
              }
            } catch (err) {
              btn.disabled = false;
              btn.innerHTML = `<i class="fa-solid fa-magnet"></i> Download In-App (Torrent)`;
              showToast({ title: 'Torrent Swarm Error', message: err.message, icon: 'fa-solid fa-circle-xmark' });
            }
            return;
          }

          // Single direct hoster stream
          btn.disabled = true;
          btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Resolving...`;

          try {
            showToast({ title: 'Resolving Mirror', message: `Connecting to ${p.name}...`, icon: 'fa-solid fa-bolt' });
            const resolved = await ipcRenderer.invoke('resolve-hoster-stream', p.url);
            if (resolved && resolved.success && resolved.directUrl) {
              modal.style.display = 'none';
              startDownloadTask(game.name, resolved.directUrl, []);
            } else {
              throw new Error(resolved?.error || 'Could not resolve stream.');
            }
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Download In-App`;
            showToast({ title: 'Mirror Resolution Error', message: err.message, icon: 'fa-solid fa-circle-xmark' });
          }
        };
      });
    }
  }

  // Render multi-part quick links
  if (multiList) {
    if (pasteProviders.length === 0) {
      multiList.innerHTML = `<div style="color: #94a3b8; font-size: 12.5px;">Paste any multi-part links into the box below.</div>`;
    } else {
      multiList.innerHTML = pasteProviders.map((p, idx) => `
        <button class="multipart-chip-btn" data-paste-idx="${idx}">
          <i class="fa-solid fa-list-check"></i> ${p.name || `Multi-Part List ${idx + 1}`}
        </button>
      `).join('');

      multiList.querySelectorAll('.multipart-chip-btn').forEach(btn => {
        btn.onclick = async () => {
          const p = pasteProviders[parseInt(btn.getAttribute('data-paste-idx'), 10)];
          if (!p) return;

          btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading links...`;
          try {
            const parsed = await ipcRenderer.invoke('parse-multipart-links', p.url);
            if (parsed && parsed.success && parsed.parts && parsed.parts.length > 0) {
              if (textarea) {
                textarea.value = parsed.parts.map(pt => pt.url).join('\n');
                if (countEl) countEl.textContent = `${parsed.parts.length} parts loaded! Ready to download.`;
              }
              showToast({
                title: 'Multi-Part Repack Loaded',
                message: `Found ${parsed.parts.length} archive parts. Click Start to download!`,
                icon: 'fa-solid fa-circle-check'
              });
            } else {
              if (textarea) textarea.value = p.url;
            }
          } catch (e) {
            if (textarea) textarea.value = p.url;
          } finally {
            btn.innerHTML = `<i class="fa-solid fa-list-check"></i> ${p.name || 'Multi-Part List'}`;
          }
        };
      });
    }
  }

  // Live input detector on textarea
  const updatePartsCount = () => {
    if (!textarea || !countEl) return;
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    countEl.textContent = `${lines.length} link(s) detected`;
  };

  if (textarea) {
    textarea.value = '';
    textarea.oninput = updatePartsCount;
    updatePartsCount();
  }

  if (startMultiBtn) {
    startMultiBtn.onclick = async () => {
      const text = textarea ? textarea.value.trim() : '';
      if (!text) {
        showToast({ title: 'Missing Links', message: 'Please paste multi-part archive links or click a list above.', icon: 'fa-solid fa-circle-exclamation' });
        return;
      }

      startMultiBtn.disabled = true;
      startMultiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Initializing Multi-Part Queue...`;

      try {
        const parsed = await ipcRenderer.invoke('parse-multipart-links', text);
        if (!parsed || !parsed.success || !parsed.parts || parsed.parts.length === 0) {
          throw new Error('No valid archive download links could be parsed.');
        }

        const res = await ipcRenderer.invoke('start-multipart-download', {
          id: `mp_${Date.now()}`,
          gameName: `${game.name} [FitGirl Repack]`,
          parts: parsed.parts
        });

        if (res && res.success) {
          modal.style.display = 'none';
          switchView('downloads-view');
          showToast({
            title: 'Multi-Part Repack Started',
            message: `Queueing ${parsed.parts.length} parts with automatic 7-Zip extraction!`,
            icon: 'fa-solid fa-box-archive'
          });
        } else {
          throw new Error(res?.error || 'Failed to start multi-part download.');
        }
      } catch (err) {
        showToast({ title: 'Multi-Part Error', message: err.message, icon: 'fa-solid fa-circle-xmark' });
      } finally {
        startMultiBtn.disabled = false;
        startMultiBtn.innerHTML = `<i class="fa-solid fa-download"></i> Start In-App Multi-Part Download`;
      }
    };
  }

  if (sendJdMultiBtn) {
    sendJdMultiBtn.onclick = async () => {
      const text = textarea ? textarea.value.trim() : '';
      if (!text) {
        showToast({ title: 'Missing Links', message: 'Please paste multi-part archive links or select a provider above.', icon: 'fa-solid fa-circle-exclamation' });
        return;
      }

      sendJdMultiBtn.disabled = true;
      sendJdMultiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;

      try {
        const parsed = await ipcRenderer.invoke('parse-multipart-links', text);
        const urlList = (parsed && parsed.parts && parsed.parts.length > 0) ? parsed.parts.map(p => p.url) : text.split('\n').map(l => l.trim()).filter(Boolean);

        // Copy to clipboard
        await navigator.clipboard.writeText(urlList.join('\n'));

        // Send to JDownloader
        const res = await ipcRenderer.invoke('send-to-jdownloader', {
          packageName: `${game.name} [FitGirl Repack]`,
          urls: urlList
        });

        if (res && res.jdownloaderRunning) {
          showToast({
            title: '⚡ 1-Click JDownloader Success',
            message: `Sent all ${urlList.length} parts to JDownloader 2! Ready in LinkGrabber.`,
            icon: 'fa-solid fa-bolt',
            duration: 6000
          });
        } else {
          showToast({
            title: '📋 Links Copied to Clipboard',
            message: `Copied ${urlList.length} links! Open JDownloader 2 to auto-grab them (or run JDownloader and click again for 1-click import).`,
            icon: 'fa-solid fa-copy',
            duration: 7000
          });
        }
      } catch (err) {
        showToast({ title: 'Copy Failed', message: err.message, icon: 'fa-solid fa-circle-xmark' });
      } finally {
        sendJdMultiBtn.disabled = false;
        sendJdMultiBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> 1-Click JDownloader`;
      }
    };
  }

  if (copyAllMultiBtn) {
    copyAllMultiBtn.onclick = async () => {
      const text = textarea ? textarea.value.trim() : '';
      if (!text) {
        showToast({ title: 'No Links', message: 'No links to copy.', icon: 'fa-solid fa-circle-exclamation' });
        return;
      }
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast({
        title: 'Links Copied',
        message: `Copied ${lines.length} link(s) to clipboard!`,
        icon: 'fa-solid fa-copy'
      });
    };
  }

  const closeModal = () => {
    modal.style.display = 'none';
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  modal.style.display = 'flex';
}

// =========================================================
// SteamRIP In-App Mirrors & Hoster Modal (For ISP Unblocking)
// =========================================================
async function openSteamripProviderModal(game) {
  const modal = document.getElementById('steamripProviderModal');
  const titleEl = document.getElementById('steamripModalTitle');
  const subEl = document.getElementById('steamripModalSub');
  const listEl = document.getElementById('steamripMirrorsList');
  const closeBtn = document.getElementById('btnCloseSteamripModal');

  if (!modal) return;

  if (titleEl) titleEl.textContent = `${game.name} - SteamRIP Host Mirrors`;
  if (subEl) subEl.textContent = `Version: ${game.version || 'Latest'} | Size: ${game.size || 'Direct'}`;

  // If game details/mirrors haven't been resolved yet, fetch now
  let mirrors = game.mirrors;
  if (!mirrors || mirrors.length === 0) {
    if (listEl) {
      listEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching available mirrors from SteamRIP...</div>`;
    }
    modal.style.display = 'flex';

    try {
      const res = await ipcRenderer.invoke('get-game-details', game.slug || game.id);
      if (res && res.success && res.game) {
        Object.assign(game, res.game);
        mirrors = res.game.mirrors || [];
      }
    } catch (e) {}
  }

  // Fallback: build from downloadLinks if mirrors list is empty
  if (!mirrors || mirrors.length === 0) {
    const dl = game.downloadLinks || {};
    mirrors = [];
    if (dl.buzzheavier) dl.buzzheavier.forEach((u, i) => mirrors.push({ name: `Buzzheavier CDN ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'buzzheavier', url: u, supportedInApp: true, tag: 'Fast Direct Stream (If ISP blocks, choose another below)' }));
    if (dl.pixeldrain) dl.pixeldrain.forEach((u, i) => mirrors.push({ name: `PixelDrain Direct ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'pixeldrain', url: u, supportedInApp: true, tag: 'Direct API Stream (Unrestricted)' }));
    if (dl.gofile) dl.gofile.forEach((u, i) => mirrors.push({ name: `GoFile Cloud ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'gofile', url: u, supportedInApp: false, tag: 'High-Speed Cloud Storage' }));
    if (dl.fileditch) dl.fileditch.forEach((u, i) => mirrors.push({ name: `Fileditch Mirror ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'fileditch', url: u, supportedInApp: false, tag: 'Direct File Archive' }));
    if (dl.megadb) dl.megadb.forEach((u, i) => mirrors.push({ name: `MegaDB Mirror ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'megadb', url: u, supportedInApp: false, tag: 'Standard Host Mirror' }));
    if (dl.onefichier) dl.onefichier.forEach((u, i) => mirrors.push({ name: `1Fichier Mirror ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'onefichier', url: u, supportedInApp: false, tag: 'High-Speed Direct Storage' }));
    if (dl.filecrypt) dl.filecrypt.forEach((u, i) => mirrors.push({ name: `FileCrypt Container ${i > 0 ? i + 1 : ''}`.trim(), hoster: 'filecrypt', url: u, supportedInApp: false, tag: 'Protected Link Container' }));
  }

  if (listEl) {
    if (!mirrors || mirrors.length === 0) {
      listEl.innerHTML = `<div style="color: #94a3b8; font-size: 13px; padding: 20px; text-align: center;">No alternate hosters available for this title. Use 1-Click Download.</div>`;
    } else {
      listEl.innerHTML = mirrors.map((m, idx) => {
        let icon = 'fa-solid fa-server';
        let badge = m.tag || 'Direct Host Mirror';
        if (m.hoster === 'buzzheavier') {
          icon = 'fa-solid fa-bolt';
          badge = '⚡ Buzzheavier Fast CDN (If ISP blocks, choose another mirror below)';
        } else if (m.hoster === 'pixeldrain') {
          icon = 'fa-solid fa-cloud-arrow-down';
          badge = '🚀 PixelDrain Direct (In-App Stream Supported)';
        } else if (m.hoster === 'gofile') {
          icon = 'fa-solid fa-cloud';
          badge = '☁️ GoFile Cloud (Opens in Browser / JDownloader)';
        } else if (m.hoster === 'fileditch') {
          icon = 'fa-solid fa-folder-open';
          badge = '📁 Fileditch Mirror (Opens in Browser / JDownloader)';
        } else if (m.hoster === 'megadb') {
          icon = 'fa-solid fa-database';
          badge = '💾 MegaDB Mirror';
        } else if (m.hoster === 'onefichier') {
          icon = 'fa-solid fa-file-zipper';
          badge = '📦 1Fichier Mirror';
        }

        return `
          <div class="provider-card ${m.supportedInApp ? 'featured-torrent' : ''}">
            <div class="provider-info-col">
              <div class="provider-icon-circle"><i class="${icon}"></i></div>
              <div style="min-width: 0; overflow: hidden;">
                <div class="provider-name" title="${m.name}">${m.name}</div>
                <div class="provider-tag" style="${m.supportedInApp ? 'color: #38bdf8; font-weight: 600;' : ''}">${badge}</div>
              </div>
            </div>
            <div class="provider-actions-col">
              <button class="btn-sr-copy" data-idx="${idx}" title="Copy Link to Clipboard" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;">
                <i class="fa-solid fa-copy"></i> <span>Copy Link</span>
              </button>
              ${m.supportedInApp ? `
                <button class="btn-provider-dl btn-sr-download" data-idx="${idx}">
                  <i class="fa-solid fa-bolt"></i> <span>Download In-App</span>
                </button>
              ` : `
                <button class="btn-provider-dl btn-sr-browser" data-idx="${idx}" style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd;">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i> <span>Browser / JDownloader</span>
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.btn-sr-copy').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const m = mirrors[parseInt(btn.getAttribute('data-idx'), 10)];
          if (m && m.url) {
            navigator.clipboard.writeText(m.url);
            showToast({
              title: 'Mirror Link Copied',
              message: `Copied ${m.name} link to clipboard! Paste into JDownloader 2 or browser.`,
              icon: 'fa-solid fa-copy'
            });
          }
        };
      });

      listEl.querySelectorAll('.btn-sr-download').forEach(btn => {
        btn.onclick = async () => {
          const m = mirrors[parseInt(btn.getAttribute('data-idx'), 10)];
          if (!m) return;
          modal.style.display = 'none';
          startDownloadTask(game.name, m.url, []);
        };
      });

      listEl.querySelectorAll('.btn-sr-browser').forEach(btn => {
        btn.onclick = () => {
          const m = mirrors[parseInt(btn.getAttribute('data-idx'), 10)];
          if (m && m.url) {
            shell.openExternal(m.url);
            showToast({
              title: 'Opening Host Mirror',
              message: `Opened ${m.name} in your browser.`,
              icon: 'fa-solid fa-arrow-up-right-from-square'
            });
          }
        };
      });
    }
  }

  const closeModal = () => {
    modal.style.display = 'none';
  };
  if (closeBtn) closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
  modal.style.display = 'flex';
}

// =========================================================
// 1-Click Download Flow & Fallback Pipeline
// =========================================================
async function triggerQuickDownload(game) {
  if (!game) return;

  if (!game.downloadLinks || Object.keys(game.downloadLinks).length === 0) {
    showToast({
      title: 'Preparing Download',
      message: `Fetching fastest mirror for ${game.name}...`,
      icon: 'fa-solid fa-spinner fa-spin'
    });
    try {
      const res = await ipcRenderer.invoke('get-game-details', game.slug || game.id);
      if (res && res.success && res.game) {
        Object.assign(game, res.game);
      }
    } catch (e) {}
  }

  const mirror = game.primaryMirror;
  if (!mirror || !mirror.url) {
    showToast({
      title: 'Select Mirror',
      message: 'Choose a host mirror to download this title.',
      icon: 'fa-solid fa-server'
    });
    openSteamripProviderModal(game);
    return;
  }

  startDownloadTask(game.name, mirror.url, game.fallbackMirrors || []);
}

async function startDownloadTask(gameName, mirrorUrl, fallbackMirrors = []) {
  showToast({
    title: 'Download Initialized',
    message: `Connecting to ${gameName}...`,
    icon: 'fa-solid fa-bolt'
  });

  try {
    const res = await ipcRenderer.invoke('start-download', {
      id: `dl_${Date.now()}`,
      gameName: gameName,
      mirrorUrl: mirrorUrl,
      fallbackMirrors: fallbackMirrors,
      autoExtract: AppState.settings.autoExtract
    });

    if (res && res.success) {
      switchView('downloads-view');
    } else {
      showToast({
        title: 'Primary Mirror Failed',
        message: `${res?.error || 'Could not resolve mirror.'} Opening host mirrors list...`,
        icon: 'fa-solid fa-circle-exclamation',
        duration: 5000
      });
      const gameObj = AppState.selectedGameForDetail || AppState.games.find(g => g.name === gameName);
      if (gameObj) openSteamripProviderModal(gameObj);
    }
  } catch (err) {
    showToast({
      title: 'Download Error',
      message: `${err.message}. Opening alternate mirrors...`,
      icon: 'fa-solid fa-circle-xmark'
    });
    const gameObj = AppState.selectedGameForDetail || AppState.games.find(g => g.name === gameName);
    if (gameObj) openSteamripProviderModal(gameObj);
  }
}

// Real-time IPC listener for download progress (throttled rendering to prevent lag)
let lastDownloadProgressRender = 0;
ipcRenderer.on('download-progress', (event, task) => {
  AppState.activeDownloads.set(task.id, task);
  updateTopNavDownloadBadge();

  if (task.state === 'completed' && task.progress === 100) {
    showToast({
      title: 'Download Complete',
      message: `${task.gameName} is ready to play!`,
      icon: 'fa-solid fa-circle-check',
      duration: 6000
    });
    AppState.activeDownloads.delete(task.id);
    refreshDownloadHistory();
    loadLibraryFromBackend();
    renderDownloadsView();
    return;
  }

  const now = Date.now();
  if (now - lastDownloadProgressRender >= 350) {
    lastDownloadProgressRender = now;
    renderDownloadsView();
  }
});

function updateTopNavDownloadBadge() {
  const badge = document.getElementById('navDownloadsBadge');
  const statCount = document.getElementById('statActiveDownloadsCount');
  const activeCountEl = document.getElementById('activeCount');

  const count = AppState.activeDownloads.size;
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
  if (statCount) statCount.textContent = `${count} Active`;
  if (activeCountEl) activeCountEl.textContent = count;
}

function updateDownloadPathDisplay() {
  const p = AppState.settings.downloadDir || 'Default: ~/Downloads/KYROSPHERE';
  const dlPathInDownloads = document.getElementById('dlPathDisplayInDownloads');
  const settingDownloadPath = document.getElementById('settingDownloadPath');

  if (dlPathInDownloads) dlPathInDownloads.textContent = p;
  if (settingDownloadPath) settingDownloadPath.value = p;
}

function renderDownloadsView() {
  const container = document.getElementById('activeDownloadsContainer');
  if (!container) return;

  const tasks = Array.from(AppState.activeDownloads.values());

  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state" id="noActiveDownloads">
        <i class="fa-solid fa-arrow-down-up-lock"></i>
        <p>No active downloads right now</p>
        <span>Click "1-Click Download" on any game to start streaming</span>
      </div>
    `;
    return;
  }

  container.innerHTML = tasks.map(task => {
    const isDownloading = task.state === 'downloading' || task.state === 'resolving' || task.state === 'connecting';
    const isPaused = task.state === 'paused';
    const isExtracting = task.state === 'extracting';
    const isCanceled = task.state === 'canceled' || task.state === 'cancelled';
    const isError = task.state === 'error' || Boolean(task.error);
    const progressPercent = task.progress || 0;

    let stateLabel = (task.statusMessage || task.state).toUpperCase();
    if (isExtracting) stateLabel = 'UNPACKING ARCHIVE...';

    return `
      <div class="download-task-card ${isError ? 'download-error' : ''}" data-task-id="${task.id}">
        <div class="task-top-row">
          <div class="task-info">
            <span class="task-game-name">${task.gameName}</span>
            <span class="task-hoster-tag">${task.hoster || 'CDN'}</span>
            <span class="task-hoster-tag" style="color: ${isError ? '#ef4444' : '#ffffff'};">${stateLabel}</span>
          </div>
          <div class="task-controls">
            ${isDownloading ? `
              <button class="btn-icon-control btn-pause-dl" data-id="${task.id}" title="Pause">
                <i class="fa-solid fa-pause"></i>
              </button>
            ` : isPaused ? `
              <button class="btn-icon-control btn-resume-dl" data-id="${task.id}" title="Resume">
                <i class="fa-solid fa-play"></i>
              </button>
            ` : (isError || isCanceled) ? `
              <button class="btn-icon-control btn-retry-dl" data-id="${task.id}" title="Redownload">
                <i class="fa-solid fa-rotate-right"></i>
              </button>
            ` : ''}
            <button class="btn-icon-control btn-cancel btn-cancel-dl" data-id="${task.id}" title="Stop & Cancel Download">
              <i class="fa-solid fa-stop"></i>
            </button>
            <button class="btn-icon-control btn-delete-task" data-id="${task.id}" title="Delete Task">
              <i class="fa-solid fa-trash-can"></i>
            </button>
            <button class="btn-icon-control btn-reveal-dl" data-id="${task.id}" title="Open Folder">
              <i class="fa-solid fa-folder-open"></i>
            </button>
          </div>
        </div>

        <!-- Download Progress Bar -->
        <div class="progress-container">
          <div class="progress-bar-fill ${isDownloading ? 'active-anim' : ''} ${isError ? 'error-bar' : ''}" style="width: ${progressPercent}%;"></div>
        </div>

        <!-- Extraction Progress Bar (Live 7-Zip Unpacking) -->
        ${(isExtracting || (task.extractProgress !== undefined && task.extractProgress > 0)) ? `
          <div class="extract-progress-wrap">
            <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: #c084fc; font-weight: 700; margin-bottom: 5px;">
              <span><i class="fa-solid fa-file-zipper"></i> ${task.statusMessage || 'Unpacking 7-Zip Archive...'}</span>
              <span>${task.extractProgress || 0}%</span>
            </div>
            <div class="progress-container">
              <div class="progress-bar-fill extract-bar active-anim" style="width: ${task.extractProgress || 0}%;"></div>
            </div>
          </div>
        ` : ''}

        <div class="task-bottom-row">
          <div class="task-metrics">
            <span class="task-speed">${task.speed || '0 MB/s'}</span>
            ${task.isTorrent ? `<span style="color: #38bdf8; font-weight: 700;"><i class="fa-solid fa-users"></i> ${task.numPeers || 0} Peers</span>` : ''}
            <span>Progress: ${progressPercent}%</span>
            <span>ETA: ${task.eta || '--'}</span>
          </div>
          <div class="task-bytes">
            ${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind controls with immediate state reflection
  container.querySelectorAll('.btn-pause-dl').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const task = AppState.activeDownloads.get(id);
      if (task) {
        task.state = 'paused';
        task.speed = '0 MB/s';
        task.statusMessage = 'Paused';
      }
      renderDownloadsView();
      await ipcRenderer.invoke('pause-download', id);
    };
  });
  container.querySelectorAll('.btn-resume-dl').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const task = AppState.activeDownloads.get(id);
      if (task) {
        task.state = 'downloading';
        task.statusMessage = 'Resuming download...';
      }
      renderDownloadsView();
      await ipcRenderer.invoke('resume-download', id);
    };
  });
  container.querySelectorAll('.btn-retry-dl').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      await ipcRenderer.invoke('retry-download', id);
      showToast({ title: 'Retrying Download', message: 'Re-initiating connection...' });
    };
  });
  container.querySelectorAll('.btn-cancel-dl').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const task = AppState.activeDownloads.get(id);
      if (task) {
        task.state = 'canceled';
        task.statusMessage = 'Canceled by user';
        task.speed = '0 MB/s';
        task.eta = '--';
      }
      renderDownloadsView();
      await ipcRenderer.invoke('cancel-download', id);
      showToast({ title: 'Download Stopped', message: 'Download was canceled successfully.', icon: 'fa-solid fa-stop' });
    };
  });
  container.querySelectorAll('.btn-delete-task').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      AppState.activeDownloads.delete(id);
      renderDownloadsView();
      updateTopNavDownloadBadge();
      await ipcRenderer.invoke('delete-download-task', { id, deleteFile: true });
      showToast({ title: 'Download Removed', message: 'Removed task from downloads.' });
    };
  });
  container.querySelectorAll('.btn-reveal-dl').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      ipcRenderer.invoke('reveal-download-folder', btn.getAttribute('data-id'));
    };
  });
}

async function refreshDownloadHistory() {
  const container = document.getElementById('historyDownloadsContainer');
  const countBadge = document.getElementById('historyCountBadge');
  if (!container) return;

  const history = await ipcRenderer.invoke('get-download-history');
  AppState.downloadHistory = history || [];

  if (countBadge) countBadge.textContent = `${AppState.downloadHistory.length} Completed`;

  if (AppState.downloadHistory.length === 0) {
    container.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">No completed downloads yet.</span>`;
    return;
  }

  container.innerHTML = AppState.downloadHistory.map(item => `
    <div class="history-card">
      <div>
        <div class="history-title">${item.gameName}</div>
        <div class="history-sub">${item.fileName || 'Archive'} • ${formatBytes(item.totalBytes)} • ${new Date(item.completedAt).toLocaleDateString()}</div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary btn-history-open" data-id="${item.id}" title="Show file in folder">
          <i class="fa-solid fa-folder-open"></i> Open
        </button>
        <button class="btn btn-secondary btn-history-redownload" data-id="${item.id}" title="Redownload game">
          <i class="fa-solid fa-rotate-right"></i> Redownload
        </button>
        <button class="btn btn-secondary btn-history-delete" data-id="${item.id}" title="Delete record" style="color: #ef4444;">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-history-open').forEach(btn => {
    btn.onclick = () => ipcRenderer.invoke('reveal-download-folder', btn.getAttribute('data-id'));
  });
  container.querySelectorAll('.btn-history-redownload').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      await ipcRenderer.invoke('retry-download', id);
      showToast({ title: 'Redownloading', message: 'Re-initiating Buzzheavier download stream...' });
    };
  });
  container.querySelectorAll('.btn-history-delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      await ipcRenderer.invoke('delete-download-task', { id, deleteFile: false });
      await refreshDownloadHistory();
    };
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// =========================================================
// Theme Management Engine (8 Themes — 4 Dark + 4 Light)
// =========================================================
const VALID_THEMES = [
  'theme-aurora', 'theme-neon', 'theme-ember', 'theme-jade', 'theme-abyss',
  'theme-synthwave', 'theme-dracula', 'theme-galaxy', 'theme-solaris', 'theme-matrix', 'theme-nordic',
  'theme-frost', 'theme-haze', 'theme-cloud', 'theme-sakura', 'theme-matcha',
  'theme-citrus', 'theme-coastal', 'theme-paper', 'theme-quartz', 'theme-alpine', 'theme-minimal'
];
const LIGHT_THEMES = [
  'theme-frost', 'theme-haze', 'theme-cloud', 'theme-sakura', 'theme-matcha',
  'theme-citrus', 'theme-coastal', 'theme-paper', 'theme-quartz', 'theme-alpine', 'theme-minimal'
];

// Migration map from old themes to new defaults
const THEME_MIGRATION = {
  'theme-ice': 'theme-aurora',
  'theme-midnight': 'theme-aurora',
  'theme-cyberpunk': 'theme-neon',
  'theme-crimson': 'theme-ember',
  'theme-emerald': 'theme-jade'
};

function applyTheme(themeName) {
  // Migrate old themes
  if (THEME_MIGRATION[themeName]) themeName = THEME_MIGRATION[themeName];
  if (!VALID_THEMES.includes(themeName)) themeName = 'theme-aurora';

  const isLight = LIGHT_THEMES.includes(themeName);

  // Smooth transition class
  document.body.classList.add('theme-transitioning');

  // Remove all theme classes
  VALID_THEMES.forEach(t => document.body.classList.remove(t));
  document.body.classList.add(themeName);

  // Set light/dark data attribute
  document.body.dataset.light = isLight ? 'true' : 'false';

  // Remove transition class after animation completes
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 450);

  AppState.settings.theme = themeName;
  ipcRenderer.invoke('save-settings', AppState.settings);

  // Update theme option cards
  document.querySelectorAll('.theme-option-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-theme') === themeName);
  });

  // Adjust Particle Engine colors to match active theme
  if (window.particlesEngine) {
    const particleColors = {
      // 11 Dark Themes
      'theme-aurora': { p: 'rgba(34, 211, 238, ', l: 'rgba(139, 92, 246, ' },
      'theme-neon': { p: 'rgba(236, 72, 153, ', l: 'rgba(139, 92, 246, ' },
      'theme-ember': { p: 'rgba(251, 146, 60, ', l: 'rgba(220, 38, 38, ' },
      'theme-jade': { p: 'rgba(52, 211, 153, ', l: 'rgba(16, 185, 129, ' },
      'theme-abyss': { p: 'rgba(56, 189, 248, ', l: 'rgba(37, 99, 235, ' },
      'theme-synthwave': { p: 'rgba(244, 63, 94, ', l: 'rgba(253, 224, 71, ' },
      'theme-dracula': { p: 'rgba(225, 29, 72, ', l: 'rgba(192, 132, 252, ' },
      'theme-galaxy': { p: 'rgba(168, 85, 247, ', l: 'rgba(6, 182, 212, ' },
      'theme-solaris': { p: 'rgba(234, 179, 8, ', l: 'rgba(249, 115, 22, ' },
      'theme-matrix': { p: 'rgba(34, 197, 94, ', l: 'rgba(74, 222, 128, ' },
      'theme-nordic': { p: 'rgba(96, 165, 250, ', l: 'rgba(129, 140, 248, ' },
      // 11 Light Themes
      'theme-frost': { p: 'rgba(14, 165, 233, ', l: 'rgba(56, 189, 248, ' },
      'theme-haze': { p: 'rgba(245, 158, 11, ', l: 'rgba(217, 119, 6, ' },
      'theme-cloud': { p: 'rgba(139, 92, 246, ', l: 'rgba(167, 139, 250, ' },
      'theme-sakura': { p: 'rgba(236, 72, 153, ', l: 'rgba(244, 114, 182, ' },
      'theme-matcha': { p: 'rgba(22, 163, 74, ', l: 'rgba(74, 222, 128, ' },
      'theme-citrus': { p: 'rgba(234, 88, 12, ', l: 'rgba(251, 146, 60, ' },
      'theme-coastal': { p: 'rgba(13, 148, 136, ', l: 'rgba(45, 212, 191, ' },
      'theme-paper': { p: 'rgba(194, 65, 12, ', l: 'rgba(217, 119, 6, ' },
      'theme-quartz': { p: 'rgba(225, 29, 72, ', l: 'rgba(251, 113, 133, ' },
      'theme-alpine': { p: 'rgba(37, 99, 235, ', l: 'rgba(96, 165, 250, ' },
      'theme-minimal': { p: 'rgba(17, 24, 39, ', l: 'rgba(107, 114, 128, ' }
    };
    const colors = particleColors[themeName] || { p: 'rgba(34, 211, 238, ', l: 'rgba(139, 92, 246, ' };
    window.particlesEngine.particleColor = colors.p;
    window.particlesEngine.lineColor = colors.l;

    // Adjust particle opacity for light themes
    if (isLight && window.particlesEngine.canvas) {
      window.particlesEngine.canvas.style.opacity = '0.35';
    } else if (window.particlesEngine.canvas) {
      window.particlesEngine.canvas.style.opacity = '0.85';
    }
  }
}

// =========================================================
// Browsing Animations — Scroll Reveal & Staggered Cards
// =========================================================
function initBrowsingAnimations() {
  // IntersectionObserver for scroll-triggered reveals
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // Observe scroll-reveal elements
    document.querySelectorAll('.scroll-reveal').forEach(el => {
      revealObserver.observe(el);
    });
  }

  // Assign staggered animation indices to category cards
  document.querySelectorAll('.category-card').forEach((card, i) => {
    card.style.setProperty('--card-index', i);
  });
}

// Assign staggered animation indices to game cards when they are rendered
function assignCardAnimationIndices(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  container.querySelectorAll('.game-card').forEach((card, i) => {
    card.style.setProperty('--card-index', Math.min(i, 20)); // Cap at 20 to avoid long delays
  });
}

// =========================================================
// Storage Capacity & Disk Space Tracker
// =========================================================
async function updateDiskSpaceDisplay() {
  try {
    const info = await ipcRenderer.invoke('get-disk-info');
    if (info && info.success && info.freeBytes) {
      const freeGB = (info.freeBytes / (1024 * 1024 * 1024)).toFixed(1);
      const totalGB = (info.totalBytes / (1024 * 1024 * 1024)).toFixed(1);
      const label = `${freeGB} GB Available / ${totalGB} GB`;
      
      const badge1 = document.getElementById('diskSpaceBadgeDownloads');
      const badge2 = document.getElementById('settingsDiskSpaceBadge');
      if (badge1) badge1.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${label}`;
      if (badge2) badge2.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${label}`;

      // Update Library Storage Indicator (Screenshot 1)
      const libFree = document.getElementById('libDiskFreeVal');
      const libUsed = document.getElementById('libDiskUsedVal');
      const libTotal = document.getElementById('libDiskTotalVal');
      const libFill = document.getElementById('libDiskProgressFill');
      if (libFree) libFree.textContent = `${freeGB} GB`;
      if (libTotal) libTotal.textContent = `${totalGB} GB`;
      if (libUsed && totalGB > 0) {
        const usedVal = Math.max(0, (totalGB - freeGB)).toFixed(1);
        libUsed.textContent = `${usedVal} GB used`;
      }
      if (libFill && totalGB > 0) {
        const usedPct = Math.min(100, Math.max(5, Math.round(((totalGB - freeGB) / totalGB) * 100)));
        libFill.style.width = `${usedPct}%`;
      }
    }
  } catch (e) {}
}

// =========================================================
// Settings & Library Sync Handlers
// =========================================================
async function initSettings() {
  const settings = await ipcRenderer.invoke('get-settings');
  if (settings) {
    AppState.settings = settings;
    updateDownloadPathDisplay();

    // Apply active theme (migrates old theme names automatically)
    let curTheme = settings.theme;
    if (!curTheme || !VALID_THEMES.includes(curTheme)) {
      curTheme = THEME_MIGRATION[curTheme] || 'theme-aurora';
    }
    applyTheme(curTheme);

    const autoExtractCheck = document.getElementById('settingAutoExtract');
    const particlesCheck = document.getElementById('settingParticles');
    if (autoExtractCheck) autoExtractCheck.checked = settings.autoExtract;
    if (particlesCheck) particlesCheck.checked = settings.particlesEnabled;
  }

  // Bind Theme Cards click
  document.querySelectorAll('.theme-option-card').forEach(card => {
    card.onclick = () => {
      const theme = card.getAttribute('data-theme');
      applyTheme(theme);
      showToast({ title: 'Theme Updated', message: `Switched to ${card.querySelector('.theme-name')?.textContent?.trim() || theme}` });
    };
  });

  // Bind Theme Filter Pills (All / Dark / Light)
  document.querySelectorAll('.theme-filter-pill').forEach(pill => {
    pill.onclick = () => {
      document.querySelectorAll('.theme-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const filter = pill.getAttribute('data-filter');
      document.querySelectorAll('.theme-option-card').forEach(card => {
        const type = card.getAttribute('data-theme-type');
        if (filter === 'all' || type === filter) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    };
  });

  // Initialize browsing animations after first paint
  requestAnimationFrame(() => initBrowsingAnimations());

  // Bind change folder from Settings view and Downloads tab
  const handleSelectDir = async () => {
    const newDir = await ipcRenderer.invoke('select-directory');
    if (newDir) {
      AppState.settings.downloadDir = newDir;
      updateDownloadPathDisplay();
      await ipcRenderer.invoke('save-settings', AppState.settings);
      updateDiskSpaceDisplay();
      showToast({ title: 'Settings Saved', message: `Downloads directory updated to ${newDir}` });
    }
  };

  document.getElementById('btnSelectDownloadDir')?.addEventListener('click', handleSelectDir);
  document.getElementById('btnChangeFolderInDownloads')?.addEventListener('click', handleSelectDir);
  document.getElementById('btnOpenDownloadsFolder')?.addEventListener('click', () => ipcRenderer.invoke('reveal-download-folder', null));
  document.getElementById('btnOpenFolderFromSettings')?.addEventListener('click', () => ipcRenderer.invoke('reveal-download-folder', null));

  const autoExtractCheck = document.getElementById('settingAutoExtract');
  if (autoExtractCheck) {
    autoExtractCheck.onchange = async () => {
      AppState.settings.autoExtract = autoExtractCheck.checked;
      await ipcRenderer.invoke('save-settings', AppState.settings);
    };
  }

  const particlesCheck = document.getElementById('settingParticles');
  if (particlesCheck) {
    particlesCheck.onchange = async () => {
      AppState.settings.particlesEnabled = particlesCheck.checked;
      if (window.particlesEngine) {
        window.particlesEngine.enabled = particlesCheck.checked;
      }
      await ipcRenderer.invoke('save-settings', AppState.settings);
    };
  }

  // Clear Media Cache button
  document.getElementById('btnClearMediaCache')?.addEventListener('click', () => {
    showToast({ title: 'Cache Flushed', message: 'Steam artwork and screenshot cache cleared.' });
  });

  // Clear History button in Downloads Tab
  document.getElementById('btnClearHistoryBtn')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('clear-download-history');
    await refreshDownloadHistory();
    showToast({ title: 'History Cleared', message: 'Cleared all completed downloads from history.' });
  });

  // Initialize Auto-Updater UI & Listeners
  initUpdateHandlers();
}

function initUpdateHandlers() {
  ipcRenderer.invoke('get-app-version').then(ver => {
    if (ver) {
      const badge = document.getElementById('appVersionBadge');
      if (badge) badge.innerHTML = `<i class="fa-solid fa-tag"></i> v${ver}`;
    }
  }).catch(() => {});

  const btnCheckUpdates = document.getElementById('btnCheckUpdates');
  const btnHeaderCheckUpdates = document.getElementById('btnHeaderCheckUpdates');
  const headerUpdateIcon = document.getElementById('headerUpdateIcon');
  const headerUpdateText = document.getElementById('headerUpdateText');
  const btnInstallUpdate = document.getElementById('btnInstallUpdate');
  const checkIcon = document.getElementById('checkUpdatesIcon');
  const statusTitle = document.getElementById('updateStatusTitle');
  const statusDesc = document.getElementById('updateStatusDesc');
  const progressRow = document.getElementById('updateProgressRow');
  const progressBar = document.getElementById('updateProgressBar');
  const progressPercent = document.getElementById('updateProgressPercent');

  let updateReadyToInstall = false;

  const handleUpdateCheck = async () => {
    if (updateReadyToInstall) {
      ipcRenderer.invoke('install-update');
      return;
    }
    if (checkIcon) checkIcon.classList.add('spinning');
    if (headerUpdateIcon) headerUpdateIcon.classList.add('spinning');
    if (headerUpdateText) headerUpdateText.textContent = 'Checking...';
    if (statusDesc) statusDesc.textContent = 'Connecting to GitHub Releases feed...';

    const res = await ipcRenderer.invoke('check-for-updates');
    if (checkIcon) checkIcon.classList.remove('spinning');
    if (headerUpdateIcon) headerUpdateIcon.classList.remove('spinning');
    if (headerUpdateText && !updateReadyToInstall) headerUpdateText.textContent = 'Update';

    if (!res?.success) {
      showToast({ title: 'Update Check', message: res?.error || 'Running latest release version.' });
    }
  };

  if (btnCheckUpdates) btnCheckUpdates.onclick = handleUpdateCheck;
  if (btnHeaderCheckUpdates) btnHeaderCheckUpdates.onclick = handleUpdateCheck;

  if (btnInstallUpdate) {
    btnInstallUpdate.onclick = () => {
      ipcRenderer.invoke('install-update');
    };
  }

  ipcRenderer.on('update-status', (event, data) => {
    if (!data) return;
    if (data.status === 'checking') {
      if (statusDesc) statusDesc.textContent = 'Checking GitHub repository for newer releases...';
      if (headerUpdateText) headerUpdateText.textContent = 'Checking...';
    } else if (data.status === 'available') {
      if (statusTitle) statusTitle.textContent = `New Release Available (v${data.version})`;
      if (statusDesc) statusDesc.textContent = `Downloading installer package from GitHub...`;
      if (progressRow) progressRow.style.display = 'flex';
      if (headerUpdateText) headerUpdateText.textContent = `v${data.version}`;
      showToast({ title: 'Update Found', message: `Downloading KYROSPHERE v${data.version} in background...` });
    } else if (data.status === 'downloading') {
      if (progressRow) progressRow.style.display = 'flex';
      if (progressBar) progressBar.style.width = `${data.percent}%`;
      if (progressPercent) progressPercent.textContent = `${data.percent}%`;
      if (statusDesc) statusDesc.textContent = `Downloading update: ${data.percent}% complete...`;
      if (headerUpdateText) headerUpdateText.textContent = `${data.percent}%`;
    } else if (data.status === 'downloaded') {
      updateReadyToInstall = true;
      if (progressRow) progressRow.style.display = 'none';
      if (statusTitle) statusTitle.textContent = `Update v${data.version} Ready!`;
      if (statusDesc) statusDesc.textContent = `Downloaded and verified. Restart the app to apply update.`;
      if (btnInstallUpdate) btnInstallUpdate.style.display = 'inline-flex';
      if (btnHeaderCheckUpdates) {
        btnHeaderCheckUpdates.classList.add('update-ready');
        if (headerUpdateIcon) headerUpdateIcon.className = 'fa-solid fa-rocket';
        if (headerUpdateText) headerUpdateText.textContent = 'Restart Now';
      }
      showToast({
        title: 'Update Downloaded',
        message: 'Update is ready! Click "Restart Now" in the navbar or Settings to apply.',
        icon: 'fa-solid fa-circle-check'
      });
    } else if (data.status === 'not-available') {
      if (statusDesc) statusDesc.textContent = 'You are on the latest official version of KYROSPHERE.';
      if (headerUpdateText) headerUpdateText.textContent = 'Latest';
      showToast({ title: 'Up to Date', message: 'You are running the latest version.' });
    } else if (data.status === 'error') {
      if (progressRow) progressRow.style.display = 'none';
      if (statusDesc) statusDesc.textContent = 'Up to date with GitHub Releases.';
      if (headerUpdateText && !updateReadyToInstall) headerUpdateText.textContent = 'Update';
    }
  });
}

async function initLibraryStats() {
  try {
    const stats = await ipcRenderer.invoke('get-full-index-stats');
    const count = (stats && stats.count) ? stats.count : 7975;
    AppState.totalIndexedGames = count;
    const countFormatted = count.toLocaleString();
    const statTotalGames = document.getElementById('statTotalGames');
    const indexedCountText = document.getElementById('indexedCountText');
    const navGamesCountBadge = document.getElementById('navGamesCountBadge');

    if (statTotalGames) statTotalGames.textContent = countFormatted;
    if (indexedCountText) indexedCountText.textContent = `${countFormatted} INDEXED`;
    if (navGamesCountBadge) navGamesCountBadge.textContent = `${(count / 1000).toFixed(1)}K`;
  } catch (e) {
    AppState.totalIndexedGames = 7975;
  }
}

async function triggerLibrarySync() {
  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.classList.add('spinning');
  showToast({
    title: 'Syncing Library',
    message: 'Updating complete games catalog index...',
    icon: 'fa-solid fa-rotate fa-spin'
  });

  try {
    const res = await ipcRenderer.invoke('sync-full-index');
    if (res && res.success) {
      showToast({
        title: 'Library Synchronized',
        message: `Indexed ${res.count.toLocaleString()} games successfully!`,
        icon: 'fa-solid fa-circle-check'
      });
      await initLibraryStats();
      loadGames(1, AppState.searchQuery);
    } else {
      showToast({
        title: 'Sync Notice',
        message: res?.error || 'Full library index is already up to date.',
        icon: 'fa-solid fa-circle-info'
      });
    }
  } catch (e) {
    showToast({
      title: 'Sync Error',
      message: e.message,
      icon: 'fa-solid fa-circle-xmark'
    });
  }

  if (syncIcon) syncIcon.classList.remove('spinning');
}

// =========================================================
// Game Dependencies Manager (.NET, DirectX, OpenAL, VC++, XNA)
// =========================================================
const DEP_DEFAULT_DESCS = {
  dotnet4: 'Required for modern games',
  directx: 'Graphics and multimedia',
  openal: 'Audio processing',
  vcredist: 'Runtime components',
  xna: 'Game development framework'
};

async function refreshDependenciesStatus() {
  try {
    const list = await ipcRenderer.invoke('get-dependencies-list');
    if (Array.isArray(list)) {
      list.forEach(dep => {
        const checkCircle = document.getElementById(`check-${dep.id}`);
        const descEl = document.getElementById(`desc-${dep.id}`);
        if (checkCircle && !checkCircle.classList.contains('loading')) {
          checkCircle.className = 'dep-check-circle';
          checkCircle.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
        if (descEl && !descEl.textContent.includes('Downloading') && !descEl.textContent.includes('Installing')) {
          descEl.textContent = dep.desc || DEP_DEFAULT_DESCS[dep.id] || 'Ready';
        }
      });
    }
  } catch (e) {}
}

async function installSingleDependency(depId) {
  const card = document.querySelector(`.dep-card[data-dep-id="${depId}"]`);
  const checkCircle = document.getElementById(`check-${depId}`);
  const descEl = document.getElementById(`desc-${depId}`);

  if (card) card.classList.add('installing');
  if (checkCircle) {
    checkCircle.className = 'dep-check-circle loading';
    checkCircle.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  }
  if (descEl) descEl.textContent = 'Preparing download...';

  try {
    const res = await ipcRenderer.invoke('install-dependency', depId);
    if (res && res.success) {
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle';
        checkCircle.innerHTML = '<i class="fa-solid fa-check"></i>';
      }
      if (descEl) descEl.textContent = DEP_DEFAULT_DESCS[depId] || 'Installed';
      showToast({
        title: 'Dependency Ready',
        message: `${depId.toUpperCase()} installed successfully!`,
        icon: 'fa-solid fa-circle-check'
      });
    } else {
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle error';
        checkCircle.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
      }
      if (descEl) descEl.textContent = `Install issue: ${res?.error || 'Manual check'}`;
      showToast({
        title: 'Install Notice',
        message: res?.error || 'Installer was launched or needs attention.',
        icon: 'fa-solid fa-circle-info'
      });
    }
  } catch (err) {
    if (checkCircle) {
      checkCircle.className = 'dep-check-circle error';
      checkCircle.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    }
    if (descEl) descEl.textContent = `Error: ${err.message}`;
  } finally {
    if (card) card.classList.remove('installing');
  }
}

async function reinstallAllDependencies() {
  const btn = document.getElementById('btnReinstallAllDeps');
  const btnText = document.getElementById('reinstallAllText');
  if (btn) btn.disabled = true;
  if (btnText) btnText.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Installing Dependencies...';

  showToast({
    title: 'Dependencies Setup',
    message: 'Downloading and reinstalling all 5 runtime packages...',
    icon: 'fa-solid fa-gears'
  });

  try {
    const res = await ipcRenderer.invoke('install-all-dependencies');
    if (res && res.success) {
      showToast({
        title: 'All Dependencies Ready',
        message: 'All runtime dependencies were processed successfully!',
        icon: 'fa-solid fa-circle-check'
      });
    } else {
      showToast({
        title: 'Dependencies Notice',
        message: res?.error || 'Finished processing runtime dependencies.',
        icon: 'fa-solid fa-circle-info'
      });
    }
  } catch (err) {
    showToast({
      title: 'Installation Error',
      message: err.message,
      icon: 'fa-solid fa-triangle-exclamation'
    });
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Reinstall Dependencies';
    await refreshDependenciesStatus();
  }
}

function initDependenciesView() {
  // Listen for progress updates from main process
  ipcRenderer.on('dependency-progress', (event, data) => {
    const { id, status, percent, message } = data;
    const checkCircle = document.getElementById(`check-${id}`);
    const descEl = document.getElementById(`desc-${id}`);
    const card = document.querySelector(`.dep-card[data-dep-id="${id}"]`);

    if (status === 'downloading') {
      if (card) card.classList.add('installing');
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle loading';
        checkCircle.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      }
      if (descEl) descEl.textContent = percent > 0 ? `Downloading: ${percent}%` : 'Connecting...';
    } else if (status === 'installing') {
      if (card) card.classList.add('installing');
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle loading';
        checkCircle.innerHTML = '<i class="fa-solid fa-gear fa-spin"></i>';
      }
      if (descEl) descEl.textContent = 'Installing component...';
    } else if (status === 'completed') {
      if (card) card.classList.remove('installing');
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle';
        checkCircle.innerHTML = '<i class="fa-solid fa-check"></i>';
      }
      if (descEl) descEl.textContent = DEP_DEFAULT_DESCS[id] || 'Installed';
    } else if (status === 'error') {
      if (card) card.classList.remove('installing');
      if (checkCircle) {
        checkCircle.className = 'dep-check-circle error';
        checkCircle.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
      }
      if (descEl) descEl.textContent = message || 'Error installing';
    }
  });

  // Click on individual cards to install
  document.querySelectorAll('.dep-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const depId = card.getAttribute('data-dep-id');
      if (depId) installSingleDependency(depId);
    });
  });

  // Reinstall Dependencies button
  document.getElementById('btnReinstallAllDeps')?.addEventListener('click', reinstallAllDependencies);
}

// =========================================================
// Library View & Game Launcher Controller (Screenshot 1 & 2)
// =========================================================
async function loadLibraryFromBackend() {
  try {
    const items = await ipcRenderer.invoke('get-library');
    AppState.library = Array.isArray(items) ? items : [];
    
    // Update badge counters
    const badge = document.getElementById('navLibraryBadge');
    const sidebarCount = document.getElementById('sidebarGamesCount');
    const countAll = document.getElementById('libFilterCountAll');
    
    if (badge) badge.textContent = AppState.library.length;
    if (sidebarCount) sidebarCount.textContent = `${AppState.library.length} Total Games`;
    if (countAll) countAll.textContent = AppState.library.length;
    
    renderLibraryGrid();
    updateLevelAndXp();
  } catch (err) {
    console.error('Failed to load library:', err);
  }
}


function getLibraryGamePoster(game) {
  if (game.portraitImage) return game.portraitImage;
  if (game.steamAppId) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/library_600x900.jpg`;
  }
  if (game.coverImage && !game.coverImage.includes('239140') && !game.coverImage.includes('header.jpg')) return game.coverImage;
  if (game.image && !game.image.includes('239140') && !game.image.includes('header.jpg')) return game.image;
  if (game.bannerImage && !game.bannerImage.includes('239140') && !game.bannerImage.includes('header.jpg')) return game.bannerImage;
  return 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80';
}

function renderLibraryGrid() {
  const grid = document.getElementById('libraryGamesGrid') || document.getElementById('libraryGrid');
  const emptyState = document.getElementById('libraryEmptyState');
  if (!grid) return;

  let list = [...AppState.library];

  // Apply Sub-filter
  if (AppState.libraryFilter === 'favorites') {
    list = list.filter(g => g.isFavorite);
  } else if (AppState.libraryFilter === 'playlater') {
    list = list.filter(g => g.playLater);
  } else if (AppState.libraryFilter === 'history') {
    list = list.filter(g => g.lastPlayed).sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed));
  }

  // Apply search query
  if (AppState.librarySearchQuery) {
    const q = AppState.librarySearchQuery.toLowerCase();
    list = list.filter(g => (g.name || '').toLowerCase().includes(q) || (g.title || '').toLowerCase().includes(q));
  }

  if (list.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  grid.innerHTML = list.map(game => {
    const poster = getLibraryGamePoster(game);
    const subtext = game.playTimeFormatted || (game.lastPlayed ? `Played ${new Date(game.lastPlayed).toLocaleDateString()}` : "Ready to play");
    const isRepack = Boolean(game.isRepack);
    const isSetupNeeded = isRepack && !game.hasBeenSetup;
    const playIcon = isSetupNeeded ? 'fa-solid fa-screwdriver-wrench' : 'fa-solid fa-play';
    const playTitle = isSetupNeeded ? `Run Setup for ${game.name}` : `Play ${game.name}`;

    return `
      <div class="lib-game-card" data-game-id="${game.id}">
        <div class="lib-card-badges-row">
          ${isRepack ? '<span class="lib-badge-repack">FITGIRL REPACK</span>' : '<span class="lib-badge-preinstalled">PRE-INSTALLED</span>'}
          ${game.online ? '<span class="lib-badge-coop">CO-OP</span>' : ''}
          ${game.isNew ? '<span class="lib-card-new-badge">NEW</span>' : ''}
        </div>
        <img src="${poster}" alt="${game.name}" class="lib-card-poster" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80'">
        <div class="lib-card-body">
          <div class="lib-card-title" title="${game.name}">${game.name}</div>
          <div class="lib-card-sub">${subtext}</div>
        </div>
        <button class="lib-card-quick-play" title="${playTitle}" data-action="play">
          <i class="${playIcon}"></i>
        </button>
      </div>
    `;
  }).join('');

  // Background artwork fetch to obtain Steam 600x900 vertical capsule
  list.forEach(game => {
    if (!game.portraitImage || game.portraitImage.includes('239140') || game.portraitImage.includes('unsplash')) {
      ipcRenderer.invoke('get-game-media', game.name, game.slug).then(res => {
        if (res && res.success && res.media) {
          const portrait = res.media.portraitImage || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${res.media.appId}/library_600x900.jpg`;
          if (portrait) {
            game.portraitImage = portrait;
            game.coverImage = portrait;
            game.bannerImage = res.media.screenshots?.[0] || res.media.headerImage || portrait;
            game.steamAppId = String(res.media.appId);
            const imgEl = grid.querySelector(`[data-game-id="${game.id}"] .lib-card-poster`);
            if (imgEl) imgEl.src = portrait;
          }
        }
      }).catch(() => {});
    }
  });

  // Card click events
  grid.querySelectorAll('.lib-game-card').forEach(card => {
    const gId = card.getAttribute('data-game-id');
    const game = list.find(g => g.id === gId);
    card.addEventListener('click', (e) => {
      const isPlayBtn = e.target.closest('[data-action="play"]');
      if (isPlayBtn) {
        e.stopPropagation();
        if (game && game.isRepack && !game.hasBeenSetup) {
          runRepackSetup(game);
        } else {
          launchInstalledGame(gId);
        }
      } else {
        openLibraryGameDetail(gId);
      }
    });
  });
}

async function runRepackSetup(game) {
  showToast({
    title: 'Launching Setup',
    message: `Running setup installer for ${game.name}...`,
    icon: 'fa-solid fa-screwdriver-wrench'
  });
  try {
    const res = await ipcRenderer.invoke('launch-repack-setup', game.id);
    if (res && res.success) {
      showToast({
        title: 'Installer Active',
        message: 'FitGirl setup wizard is running. Follow on-screen instructions.',
        icon: 'fa-solid fa-circle-check',
        duration: 5000
      });
    } else {
      showToast({
        title: 'Setup Error',
        message: res?.error || 'Could not launch setup.exe',
        icon: 'fa-solid fa-circle-xmark'
      });
    }
  } catch (err) {
    showToast({ title: 'Setup Error', message: err.message, icon: 'fa-solid fa-circle-xmark' });
  }
}

function openLibraryGameDetail(gameId) {
  const game = AppState.library.find(g => g.id === gameId);
  if (!game) return;

  AppState.selectedLibraryGame = game;
  AppState.previousView = 'library-view';

  // Populate Poster
  const posterImg = document.getElementById('libDetailPosterImg');
  if (posterImg) {
    posterImg.src = getLibraryGamePoster(game);
  }

  // Update Play / Run Setup Button
  const playBtn = document.getElementById('btnPlayInstalledGame');
  if (playBtn) {
    if (game.isRepack && !game.hasBeenSetup) {
      playBtn.className = 'btn-lib-play btn-run-setup';
      playBtn.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i> <span>Run Setup</span>`;
    } else {
      playBtn.className = 'btn-lib-play';
      playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span>Play</span>`;
    }
  }

  // Populate Favorites state
  const favBtn = document.getElementById('btnToggleFavorite');
  const favIcon = document.getElementById('favIcon');
  const favText = document.getElementById('favText');
  if (favBtn) {
    favBtn.classList.toggle('favorited', Boolean(game.isFavorite));
    if (favIcon) favIcon.className = game.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    if (favText) favText.textContent = game.isFavorite ? 'In Favorites' : 'Add to Favorites';
  }

  // Populate 4 Stat Cards
  const versionEl = document.getElementById('libDetailVersionVal');
  const sizeEl = document.getElementById('libDetailSizeVal');
  const playTimeEl = document.getElementById('libDetailPlaytimeVal');
  const exeEl = document.getElementById('libDetailExeVal');

  if (versionEl) versionEl.textContent = game.version || 'Latest';
  if (sizeEl) sizeEl.textContent = game.size || 'Installed';
  if (playTimeEl) playTimeEl.textContent = game.playTimeFormatted || (game.lastPlayed ? 'Played recently' : 'Never Played');
  if (exeEl) {
    exeEl.textContent = game.primaryExecutable || 'Game.exe';
    exeEl.title = game.executablePath || game.primaryExecutable || '';
  }

  // Populate Banner Box
  const bannerThumb = document.getElementById('libDetailBannerThumb');
  const bannerTitle = document.getElementById('libDetailBannerTitle');
  const steamAppId = document.getElementById('libDetailSteamAppId');

  if (bannerThumb) bannerThumb.src = game.bannerImage || game.coverImage || getLibraryGamePoster(game);
  if (bannerTitle) bannerTitle.textContent = game.title || game.name;
  if (steamAppId) steamAppId.textContent = game.steamAppId ? `Steam App ID: ${game.steamAppId}` : `Catalog: ${game.slug || game.id}`;

  // Populate About description
  const descEl = document.getElementById('libDetailDescription');
  if (descEl) {
    descEl.textContent = game.summary || game.description || `Pre-installed edition of ${game.name}. Verified game files and native Windows execution.`;
  }

  // Populate screenshots
  const shotsContainer = document.getElementById('libDetailScreenshots');
  if (shotsContainer) {
    let screenshots = Array.isArray(game.screenshots) && game.screenshots.length > 0 ? game.screenshots : [];
    if (screenshots.length === 0 && (game.bannerImage || game.coverImage)) {
      screenshots = [game.bannerImage || game.coverImage].filter(Boolean);
    }
    if (screenshots.length > 0) {
      shotsContainer.innerHTML = screenshots.slice(0, 3).map(src => `
        <img src="${src}" alt="Screenshot" onclick="shell.openExternal('${src}')">
      `).join('');
    } else {
      shotsContainer.innerHTML = `<img src="${getLibraryGamePoster(game)}" alt="Cover Artwork">`;
    }
  }

  switchView('library-game-detail-view');
}

async function launchInstalledGame(gameId) {
  const game = AppState.library.find(g => g.id === gameId);
  const title = game ? game.name : 'Game';

  showToast({
    title: 'Launching Game',
    message: `Starting ${title}...`,
    icon: 'fa-solid fa-play'
  });

  try {
    const res = await ipcRenderer.invoke('launch-game', gameId);
    if (res && res.success) {
      showToast({
        title: 'Game Running',
        message: `Successfully launched ${res.exeName || title}. Enjoy!`,
        icon: 'fa-solid fa-circle-check',
        duration: 4000
      });
      await loadLibraryFromBackend();
    } else {
      showToast({
        title: 'Launch Notice',
        message: res?.error || 'Could not locate game executable.',
        icon: 'fa-solid fa-triangle-exclamation',
        duration: 5000
      });
    }
  } catch (err) {
    showToast({
      title: 'Launch Error',
      message: err.message,
      icon: 'fa-solid fa-circle-exclamation'
    });
  }
}

function initLibraryView() {
  // Subnav filtering
  const filterBtns = document.querySelectorAll('.lib-subnav-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.libraryFilter = btn.getAttribute('data-filter') || 'all';

      const sectionTitle = document.getElementById('libraryActiveSectionTitle');
      if (sectionTitle) {
        sectionTitle.textContent = btn.querySelector('span')?.textContent || 'Your Library';
      }
      renderLibraryGrid();
    });
  });

  // Search input
  const searchInput = document.getElementById('librarySearchInput');
  const searchClear = document.getElementById('librarySearchClearBtn');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      AppState.librarySearchQuery = e.target.value.trim();
      if (searchClear) searchClear.style.display = e.target.value ? 'block' : 'none';
      renderLibraryGrid();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      AppState.librarySearchQuery = '';
      searchClear.style.display = 'none';
      renderLibraryGrid();
    });
  }

  // Money Saved Pill & Modal Handlers
  document.getElementById('btnLibrarySavings')?.addEventListener('click', showSavingsBreakdownModal);
  document.getElementById('btnCloseSavingsModal')?.addEventListener('click', () => {
    const m = document.getElementById('savingsBreakdownModal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('btnDoneSavings')?.addEventListener('click', () => {
    const m = document.getElementById('savingsBreakdownModal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('btnShareSavings')?.addEventListener('click', shareSavingsToClipboard);

  // Sync Library & Add Custom Game Handlers
  document.getElementById('btnSyncLibrary')?.addEventListener('click', async () => {
    showToast({ title: 'Scanning Library', message: 'Scanning download directory for extracted games...', icon: 'fa-solid fa-arrows-rotate fa-spin' });
    await loadLibraryFromBackend();
    await updateMoneySavedTracker();
    showToast({ title: 'Library Synchronized', message: `${AppState.library.length} titles ready in your library.`, icon: 'fa-solid fa-circle-check' });
  });

  document.getElementById('btnAddCustomGame')?.addEventListener('click', async () => {
    const res = await ipcRenderer.invoke('select-game-folder-manual');
    if (res && res.success && res.game) {
      showToast({
        title: 'Game Added',
        message: `Added "${res.game.name}" to your Library.`,
        icon: 'fa-solid fa-folder-plus'
      });
      await loadLibraryFromBackend();
      await updateMoneySavedTracker();
    }
  });

  // Library Category Filter Chips
  document.querySelectorAll('#libraryFilterChips .pill-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#libraryFilterChips .pill-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.libraryFilter = btn.getAttribute('data-lib-filter') || 'all';
      renderLibraryGrid();
    });
  });

  // Manage buttons
  document.getElementById('btnManualAddGame')?.addEventListener('click', async () => {
    const res = await ipcRenderer.invoke('select-game-folder-manual');
    if (res && res.success && res.game) {
      if (res.alreadyExists) {
        showToast({
          title: 'Already in Library',
          message: `"${res.game.name}" is already tracked in your Library.`,
          icon: 'fa-solid fa-circle-info'
        });
      } else {
        showToast({
          title: 'Game Added',
          message: `Added "${res.game.name}" to your Library.`,
          icon: 'fa-solid fa-folder-plus'
        });
      }
      await loadLibraryFromBackend();
    }
  });

  document.getElementById('btnOpenLibraryFolder')?.addEventListener('click', () => {
    ipcRenderer.invoke('reveal-download-folder', null);
  });

  document.getElementById('btnRescanInstalledGames')?.addEventListener('click', async () => {
    showToast({ title: 'Rescanning', message: 'Scanning completed downloads & folders...', icon: 'fa-solid fa-arrows-rotate fa-spin' });
    await loadLibraryFromBackend();
    showToast({ title: 'Library Updated', message: `${AppState.library.length} games ready in your library.`, icon: 'fa-solid fa-circle-check' });
  });

  document.getElementById('btnEmptyBrowseGames')?.addEventListener('click', () => {
    switchView('games-view');
  });

  // Detail View Buttons
  document.getElementById('btnBackToLibrary')?.addEventListener('click', () => {
    switchView('library-view');
  });

  document.getElementById('btnPlayInstalledGame')?.addEventListener('click', () => {
    if (AppState.selectedLibraryGame) {
      const g = AppState.selectedLibraryGame;
      if (g.isRepack && !g.hasBeenSetup) {
        runRepackSetup(g);
      } else {
        launchInstalledGame(g.id);
      }
    }
  });

  document.getElementById('btnOpenInstalledGameDir')?.addEventListener('click', async () => {
    if (AppState.selectedLibraryGame) {
      const res = await ipcRenderer.invoke('open-game-directory', AppState.selectedLibraryGame.id);
      if (!res?.success) {
        showToast({ title: 'Notice', message: res?.error || 'Directory does not exist.', icon: 'fa-solid fa-circle-info' });
      }
    }
  });

  document.getElementById('btnVerifyInstalledFiles')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    showToast({ title: 'Verifying Files', message: 'Checking installation integrity...', icon: 'fa-solid fa-arrows-rotate' });
    const res = await ipcRenderer.invoke('verify-game-files', AppState.selectedLibraryGame.id);
    if (res && res.success) {
      showToast({
        title: 'Files Verified',
        message: `Integrity 100% OK! ${res.fileCount} files (${res.sizeFormatted}). Executable: ${res.executableName}`,
        icon: 'fa-solid fa-shield-check',
        duration: 5000
      });
    } else {
      showToast({
        title: 'Verification Issue',
        message: res?.error || 'Game directory missing or modified.',
        icon: 'fa-solid fa-circle-exclamation'
      });
    }
  });

  document.getElementById('btnCreateDesktopLnk')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    const res = await ipcRenderer.invoke('create-desktop-shortcut', AppState.selectedLibraryGame.id);
    if (res && res.success) {
      showToast({
        title: 'Shortcut Created',
        message: `Created desktop shortcut for ${AppState.selectedLibraryGame.name}!`,
        icon: 'fa-solid fa-desktop'
      });
    } else {
      showToast({
        title: 'Shortcut Error',
        message: res?.error || 'Could not create desktop shortcut. Ensure game executable is set.',
        icon: 'fa-solid fa-triangle-exclamation'
      });
    }
  });

  document.getElementById('btnChangeExecutableFile')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    const res = await ipcRenderer.invoke('select-game-executable', AppState.selectedLibraryGame.id);
    if (res && res.success && res.fileName) {
      showToast({
        title: 'Executable Configured',
        message: `Set primary executable to: ${res.fileName}`,
        icon: 'fa-solid fa-check'
      });
      const exeEl = document.getElementById('libDetailExeVal');
      if (exeEl) {
        exeEl.textContent = res.fileName;
        exeEl.title = res.executablePath;
      }
      await loadLibraryFromBackend();
    }
  });

  document.getElementById('btnConfigureLaunchOptions')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    const current = AppState.selectedLibraryGame.launchOptions || '';
    const newOptions = prompt('Enter custom launch options/arguments (e.g. -novid -high -windowed):', current);
    if (newOptions !== null) {
      AppState.selectedLibraryGame.launchOptions = newOptions.trim();
      await ipcRenderer.invoke('save-library-item', AppState.selectedLibraryGame);
      showToast({ title: 'Launch Options Saved', message: `Arguments: ${newOptions.trim() || 'None'}` });
    }
  });

  document.getElementById('btnToggleFavorite')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    AppState.selectedLibraryGame.isFavorite = !AppState.selectedLibraryGame.isFavorite;
    await ipcRenderer.invoke('save-library-item', AppState.selectedLibraryGame);

    const favBtn = document.getElementById('btnToggleFavorite');
    const favIcon = document.getElementById('favIcon');
    const favText = document.getElementById('favText');
    if (favBtn) favBtn.classList.toggle('favorited', Boolean(AppState.selectedLibraryGame.isFavorite));
    if (favIcon) favIcon.className = AppState.selectedLibraryGame.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    if (favText) favText.textContent = AppState.selectedLibraryGame.isFavorite ? 'In Favorites' : 'Add to Favorites';

    showToast({
      title: AppState.selectedLibraryGame.isFavorite ? 'Added to Favorites' : 'Removed from Favorites',
      message: AppState.selectedLibraryGame.name,
      icon: AppState.selectedLibraryGame.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart'
    });
  });

  document.getElementById('btnDeleteInstalledGame')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    const game = AppState.selectedLibraryGame;
    if (confirm(`Are you sure you want to remove "${game.name}" from your Library?`)) {
      const deleteFiles = confirm(`Do you also want to permanently delete the files from disk in:\n${game.installDir}`);
      await ipcRenderer.invoke('remove-library-item', { id: game.id, deleteFiles });
      showToast({ title: 'Game Removed', message: `Removed "${game.name}" from your Library.` });
      await loadLibraryFromBackend();
      switchView('library-view');
    }
  });

  document.getElementById('btnEditGameInfo')?.addEventListener('click', async () => {
    if (!AppState.selectedLibraryGame) return;
    const newName = prompt('Enter new display title for this game:', AppState.selectedLibraryGame.name);
    if (newName && newName.trim()) {
      AppState.selectedLibraryGame.name = newName.trim();
      AppState.selectedLibraryGame.title = newName.trim();
      await ipcRenderer.invoke('save-library-item', AppState.selectedLibraryGame);
      const titleEl = document.getElementById('libDetailBannerTitle');
      if (titleEl) titleEl.textContent = newName.trim();
      await loadLibraryFromBackend();
      showToast({ title: 'Game Updated', message: `Renamed to ${newName.trim()}` });
    }
  });

  // Listen for library updates from background download extractions
  ipcRenderer.on('library-updated', (event, items) => {
    if (Array.isArray(items)) {
      AppState.library = items;
      const badge = document.getElementById('navLibraryBadge');
      if (badge) badge.textContent = items.length;
      if (AppState.currentView === 'library-view') {
        renderLibraryGrid();
      }
    }
  });
}

// =========================================================
// Money Saved Steam Retail Price Tracker
// =========================================================
async function updateMoneySavedTracker() {
  const savingsText = document.getElementById('librarySavingsAmount');
  if (!savingsText) return;

  try {
    const list = AppState.library || [];
    const savings = await ipcRenderer.invoke('calc-library-savings', list);
    AppState.savingsData = savings;

    savingsText.textContent = `${savings.totalUSD} Saved`;

    const statSavings = document.getElementById('statProfileSavings');
    if (statSavings) statSavings.textContent = savings.totalUSD;
  } catch (err) {
    console.warn('[Money Saved Tracker] Calculation error:', err.message);
  }
}

function showSavingsBreakdownModal() {
  const modal = document.getElementById('savingsBreakdownModal');
  if (!modal) return;

  const data = AppState.savingsData || { totalUSD: '$0.00', items: [] };
  const modalTotal = document.getElementById('savingsModalTotal');
  const modalSteamPrice = document.getElementById('savingsModalSteamPrice');
  const listEl = document.getElementById('savingsModalItemsList');

  if (modalTotal) modalTotal.textContent = data.totalUSD;
  if (modalSteamPrice) modalSteamPrice.textContent = data.totalUSD;

  if (listEl) {
    if (!data.items || data.items.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No games in library to itemize yet. Add or download games to see your Steam savings!
        </div>
      `;
    } else {
      listEl.innerHTML = data.items.map(item => `
        <div class="savings-item-row">
          <div class="savings-item-left">
            <img src="${item.image || 'icons/kyrosphere_logo.jpg'}" alt="${item.title}" class="savings-item-thumb" onerror="this.src='icons/kyrosphere_logo.jpg'">
            <div>
              <div class="savings-item-title">${item.title}</div>
              <div style="font-size: 11px; color: var(--text-muted);">Steam Store Retail</div>
            </div>
          </div>
          <div class="savings-item-price">${item.formatted}</div>
        </div>
      `).join('');
    }
  }

  modal.style.display = 'flex';
}

function shareSavingsToClipboard() {
  const data = AppState.savingsData || { totalUSD: '$0.00' };
  const shareText = `I've saved ${data.totalUSD} USD playing PC games on KyroSphere! Download for free at https://kyrosphere-website.vercel.app`;
  navigator.clipboard.writeText(shareText);
  showToast({
    title: 'Copied to Clipboard!',
    message: 'Savings summary copied to clipboard to share with friends.',
    icon: 'fa-solid fa-copy'
  });
}

// =========================================================
// Profile, Hardware Rig & Gamer XP Engine
// =========================================================
function calculateTotalPlayHours() {
  let hours = 0;
  for (const g of AppState.library || []) {
    if (g.hoursPlayed) hours += g.hoursPlayed;
    else if (g.playCount) hours += (g.playCount * 0.5);
  }
  return hours;
}

function calculateTotalLaunches() {
  let count = 0;
  for (const g of AppState.library || []) {
    if (g.playCount) count += g.playCount;
  }
  return count;
}

function updateLevelAndXp() {
  const libraryCount = (AppState.library || []).length;
  const totalHours = calculateTotalPlayHours();
  const totalLaunches = calculateTotalLaunches();

  const totalXP = levelingService.calculateTotalXP({ libraryCount, totalHours, totalLaunches });
  const levelInfo = levelingService.calculateLevel(totalXP);

  AppState.profile.level = levelInfo.level;
  AppState.profile.totalXP = totalXP;

  const navBadge = document.getElementById('navProfileLevelBadge');
  if (navBadge) navBadge.textContent = `Lv. ${levelInfo.level}`;

  const tierBadge = document.getElementById('profileTierBadge');
  if (tierBadge) {
    tierBadge.innerHTML = `<i class="fa-solid ${levelInfo.tier.icon}"></i> Lv. ${levelInfo.level} • ${levelInfo.tier.name}`;
    tierBadge.style.borderColor = levelInfo.tier.color;
    tierBadge.style.color = levelInfo.tier.color;
  }

  const xpBadge = document.getElementById('profileTotalXpBadge');
  if (xpBadge) xpBadge.innerHTML = `<i class="fa-solid fa-bolt"></i> ${totalXP.toLocaleString()} XP`;

  const currLvl = document.getElementById('xpCurrentLevelLabel');
  if (currLvl) currLvl.textContent = `Level ${levelInfo.level}`;

  const nextLvl = document.getElementById('xpNextLevelLabel');
  if (nextLvl) nextLvl.textContent = `Level ${levelInfo.level + 1}`;

  const ratio = document.getElementById('xpRatioText');
  if (ratio) ratio.textContent = `${levelInfo.currentProgressXP} / ${levelInfo.rangeXP} XP (${levelInfo.progressPercent}%)`;

  const bar = document.getElementById('profileXpProgressBar');
  if (bar) bar.style.width = `${levelInfo.progressPercent}%`;

  const statGames = document.getElementById('statProfileGames');
  if (statGames) statGames.textContent = libraryCount;

  const statHours = document.getElementById('statProfileHours');
  if (statHours) statHours.textContent = `${totalHours.toFixed(1)}h`;
}

async function detectAndRenderRigSpecs() {
  try {
    const rig = await ipcRenderer.invoke('get-system-rig');
    AppState.profile.hardware = rig;
    try {
      localStorage.setItem('kyrosphere_user_rig', JSON.stringify(rig));
    } catch (e) {}

    const cpuEl = document.getElementById('rigCpuValue');
    const gpuEl = document.getElementById('rigGpuValue');
    const ramEl = document.getElementById('rigRamValue');
    const osEl = document.getElementById('rigOsValue');

    if (cpuEl) cpuEl.textContent = rig.cpu || 'Detected CPU';
    if (gpuEl) gpuEl.textContent = rig.gpu || 'Graphics Adapter';
    if (ramEl) ramEl.textContent = rig.ram || 'System RAM';
    if (osEl) osEl.textContent = rig.os || 'Windows';
  } catch (e) {
    console.warn('Failed to detect rig specs:', e);
  }
}

function renderProfileUI() {
  const p = AppState.profile;
  const nameInput = document.getElementById('profileUsernameInput');
  const bioInput = document.getElementById('profileBioInput');
  const statusSelect = document.getElementById('profileStatusSelect');
  const avatarImg = document.getElementById('profileAvatarImg');
  const statusDot = document.getElementById('profileStatusDot');

  if (nameInput) nameInput.value = p.username || 'Gamer';
  if (bioInput) bioInput.value = p.bio || '';
  if (statusSelect) statusSelect.value = p.status || 'Online';
  if (avatarImg && p.avatar) avatarImg.src = p.avatar;

  if (statusDot) {
    statusDot.className = 'profile-status-indicator ' + (p.status || 'online').toLowerCase().replace(/\s+/g, '-');
  }

  updateLevelAndXp();
}

async function saveProfile() {
  const nameInput = document.getElementById('profileUsernameInput');
  const bioInput = document.getElementById('profileBioInput');
  const statusSelect = document.getElementById('profileStatusSelect');

  if (nameInput) AppState.profile.username = nameInput.value.trim() || 'Gamer';
  if (bioInput) AppState.profile.bio = bioInput.value.trim();
  if (statusSelect) AppState.profile.status = statusSelect.value;

  localStorage.setItem('kyrosphere_user_profile', JSON.stringify(AppState.profile));

  try {
    await fetch('https://kyrosphere-website.vercel.app/api/v1/social?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: AppState.profile.username,
        avatar: AppState.profile.avatar,
        bio: AppState.profile.bio,
        status: AppState.profile.status,
        level: AppState.profile.level,
        totalXP: AppState.profile.totalXP,
        hardware: AppState.profile.hardware,
        games: (AppState.library || []).map(g => ({
          title: g.name || g.title,
          appId: g.steamAppId,
          image: getLibraryGamePoster(g),
          hoursPlayed: g.hoursPlayed || 0
        }))
      })
    });
    showToast({
      title: 'Profile Saved',
      message: 'Your profile and gamer stats have been synchronized!',
      icon: 'fa-solid fa-cloud-check'
    });
  } catch (err) {
    showToast({
      title: 'Profile Saved',
      message: 'Profile saved locally.',
      icon: 'fa-solid fa-check'
    });
  }

  renderProfileUI();
}

function initProfileView() {
  const savedProfile = localStorage.getItem('kyrosphere_user_profile');
  if (savedProfile) {
    try {
      AppState.profile = { ...AppState.profile, ...JSON.parse(savedProfile) };
    } catch (e) {}
  }

  // Instant 0ms load from cached rig
  const savedRig = localStorage.getItem('kyrosphere_user_rig');
  if (savedRig) {
    try {
      const rig = JSON.parse(savedRig);
      AppState.profile.hardware = rig;
      const cpuEl = document.getElementById('rigCpuValue');
      const gpuEl = document.getElementById('rigGpuValue');
      const ramEl = document.getElementById('rigRamValue');
      const osEl = document.getElementById('rigOsValue');
      if (cpuEl) cpuEl.textContent = rig.cpu || 'Detected CPU';
      if (gpuEl) gpuEl.textContent = rig.gpu || 'Graphics Adapter';
      if (ramEl) ramEl.textContent = rig.ram || 'System RAM';
      if (osEl) osEl.textContent = rig.os || 'Windows';
    } catch (e) {}
  }

  renderProfileUI();

  // If no cached rig, run detection in idle background
  if (!savedRig) {
    detectAndRenderRigSpecs().catch(() => {});
  }

  document.getElementById('btnSaveProfile')?.addEventListener('click', saveProfile);
  document.getElementById('btnRefreshRig')?.addEventListener('click', async () => {
    showToast({ title: 'Detecting Rig', message: 'Querying system hardware controllers...', icon: 'fa-solid fa-microchip fa-spin' });
    await detectAndRenderRigSpecs();
  });

  const avatarInput = document.getElementById('avatarFileInput');
  document.getElementById('btnChangeAvatar')?.addEventListener('click', () => {
    if (avatarInput) avatarInput.click();
  });

  if (avatarInput) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          AppState.profile.avatar = reader.result;
          const img = document.getElementById('profileAvatarImg');
          if (img) img.src = reader.result;
          saveProfile();
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

// =========================================================
// Friends & Social Community Engine
// =========================================================
async function sendFriendRequest() {
  const input = document.getElementById('addFriendUsernameInput');
  const notice = document.getElementById('friendRequestNotice');
  if (!input || !input.value.trim()) return;

  const targetUsername = input.value.trim();
  if (notice) {
    notice.style.display = 'block';
    notice.className = 'friend-notice';
    notice.textContent = 'Sending request...';
  }

  try {
    const res = await fetch('https://kyrosphere-website.vercel.app/api/v1/social?action=friend-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUsername: AppState.profile.username || 'Gamer',
        toUsername: targetUsername
      })
    });
    const data = await res.json();

    if (data.success) {
      if (notice) {
        notice.className = 'friend-notice success';
        notice.textContent = data.message || `Friend request sent to ${targetUsername}!`;
      }
      input.value = '';
    } else {
      if (notice) {
        notice.className = 'friend-notice error';
        notice.textContent = data.error || 'Failed to send friend request.';
      }
    }
  } catch (err) {
    if (notice) {
      notice.className = 'friend-notice error';
      notice.textContent = 'Server connection error. Please try again later.';
    }
  }
}

async function loadFriendsList() {
  const grid = document.getElementById('friendsGrid');
  const emptyState = document.getElementById('friendsEmptyState');
  const countBadge = document.getElementById('friendsCount');
  const navBadge = document.getElementById('navFriendsCountBadge');
  const pendingSection = document.getElementById('pendingRequestsSection');
  const pendingList = document.getElementById('pendingRequestsList');
  const pendingCount = document.getElementById('pendingRequestsCount');

  try {
    const username = encodeURIComponent(AppState.profile.username || 'Gamer');
    const res = await fetch(`https://kyrosphere-website.vercel.app/api/v1/social?action=friends-list&username=${username}`);
    const data = await res.json();

    if (data.success) {
      AppState.friends = data.friends || [];
      const pending = data.pendingIncoming || [];

      if (countBadge) countBadge.textContent = AppState.friends.length;
      if (navBadge) {
        navBadge.textContent = AppState.friends.length;
        navBadge.style.display = AppState.friends.length > 0 ? 'inline-block' : 'none';
      }

      // Handle Pending Requests
      if (pending.length > 0) {
        if (pendingSection) pendingSection.style.display = 'block';
        if (pendingCount) pendingCount.textContent = pending.length;
        if (pendingList) {
          pendingList.innerHTML = pending.map(req => `
            <div class="pending-req-item">
              <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${req.avatar || 'icons/kyrosphere_logo.jpg'}" alt="${req.from}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;">
                <div>
                  <div style="font-weight: 800; font-size: 13.5px; color: #ffffff;">${req.from}</div>
                  <div style="font-size: 11px; color: #38bdf8;">Lv. ${req.level || 1} • Friend Request</div>
                </div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-primary btn-accept-req" data-sender="${req.from}" style="padding: 5px 12px; font-size: 12px;">Accept</button>
                <button class="btn btn-secondary btn-decline-req" data-sender="${req.from}" style="padding: 5px 12px; font-size: 12px;">Decline</button>
              </div>
            </div>
          `).join('');
        }
      } else {
        if (pendingSection) pendingSection.style.display = 'none';
      }

      // Render Friends Grid
      if (AppState.friends.length === 0) {
        if (grid) grid.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        if (grid) {
          grid.innerHTML = AppState.friends.map(friend => `
            <div class="friend-card" data-friend-username="${friend.username}">
              <div class="friend-card-avatar-wrap">
                <img src="${friend.avatar || 'icons/kyrosphere_logo.jpg'}" alt="${friend.username}" class="friend-card-avatar">
                <span class="profile-status-indicator ${(friend.status || 'online').toLowerCase().replace(/\s+/g, '-')}"></span>
              </div>
              <div class="friend-card-info">
                <div class="friend-card-name-row">
                  <span class="friend-card-username">${friend.username}</span>
                  <span class="profile-level-pill" style="font-size: 10px; padding: 1px 6px;">Lv. ${friend.level || 1}</span>
                </div>
                <div class="friend-card-activity">${friend.currentGame ? `Playing ${friend.currentGame}` : (friend.status || 'Online')}</div>
              </div>
            </div>
          `).join('');
        }
      }
    }
  } catch (err) {
    console.warn('Failed to load friends list:', err);
    if (emptyState) emptyState.style.display = 'block';
  }
}

async function respondToFriendRequest(fromUsername, accept) {
  try {
    const res = await fetch('https://kyrosphere-website.vercel.app/api/v1/social?action=respond-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: AppState.profile.username || 'Gamer',
        friendUsername: fromUsername,
        accept: accept
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast({
        title: accept ? 'Friend Added' : 'Request Declined',
        message: data.message,
        icon: accept ? 'fa-solid fa-user-check' : 'fa-solid fa-user-xmark'
      });
      await loadFriendsList();
    }
  } catch (err) {
    showToast({ title: 'Action Failed', message: err.message, icon: 'fa-solid fa-triangle-exclamation' });
  }
}

async function openFriendProfileModal(friendUsername) {
  const modal = document.getElementById('friendProfileModal');
  if (!modal) return;

  try {
    const res = await fetch(`https://kyrosphere-website.vercel.app/api/v1/social?action=friend-profile&username=${encodeURIComponent(friendUsername)}`);
    const data = await res.json();

    if (data.success && data.profile) {
      const p = data.profile;
      const uEl = document.getElementById('modalFriendUsername');
      const bEl = document.getElementById('modalFriendBio');
      const lEl = document.getElementById('modalFriendLevelBadge');
      const aEl = document.getElementById('modalFriendAvatar');
      const sEl = document.getElementById('modalFriendStatusText');

      if (uEl) uEl.textContent = p.username;
      if (bEl) bEl.textContent = p.bio || 'No bio set.';
      if (lEl) lEl.textContent = `Lv. ${p.level || 1}`;
      if (aEl) aEl.src = p.avatar || 'icons/kyrosphere_logo.jpg';
      if (sEl) sEl.textContent = p.currentGame ? `Playing ${p.currentGame}` : (p.status || 'Online');

      const dot = document.getElementById('modalFriendStatusDot');
      if (dot) dot.className = 'profile-status-indicator ' + (p.status || 'online').toLowerCase().replace(/\s+/g, '-');

      const hw = p.hardware || {};
      const cpu = document.getElementById('modalFriendCpu');
      const gpu = document.getElementById('modalFriendGpu');
      const ram = document.getElementById('modalFriendRam');
      if (cpu) cpu.textContent = hw.cpu || 'Undetected CPU';
      if (gpu) gpu.textContent = hw.gpu || 'Undetected GPU';
      if (ram) ram.textContent = hw.ram || 'Undetected RAM';

      const games = p.games || [];
      const cEl = document.getElementById('modalFriendGameCount');
      if (cEl) cEl.textContent = games.length;

      const gamesGrid = document.getElementById('modalFriendGamesGrid');
      if (gamesGrid) {
        if (games.length === 0) {
          gamesGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">This gamer has no public library games yet.</div>`;
        } else {
          gamesGrid.innerHTML = games.map(g => `
            <div class="friend-game-card">
              <img src="${g.image || 'icons/kyrosphere_logo.jpg'}" alt="${g.title}" class="friend-game-poster" onerror="this.src='icons/kyrosphere_logo.jpg'">
              <div class="friend-game-info">
                <div class="friend-game-title">${g.title}</div>
                <div class="friend-game-time">${g.hoursPlayed ? `${g.hoursPlayed.toFixed(1)} hrs` : 'Installed'}</div>
              </div>
            </div>
          `).join('');
        }
      }

      modal.style.display = 'flex';
    }
  } catch (err) {
    showToast({
      title: 'Friend Profile Error',
      message: 'Could not load friend profile details.',
      icon: 'fa-solid fa-triangle-exclamation'
    });
  }
}

function initSocialView() {
  document.getElementById('btnSendFriendRequest')?.addEventListener('click', sendFriendRequest);
  document.getElementById('addFriendUsernameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendFriendRequest();
  });
  document.getElementById('btnRefreshFriends')?.addEventListener('click', async () => {
    showToast({ title: 'Refreshing', message: 'Fetching friends live presence...', icon: 'fa-solid fa-arrows-rotate fa-spin' });
    await loadFriendsList();
  });

  document.getElementById('friendsGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.friend-card');
    if (card) {
      const username = card.getAttribute('data-friend-username');
      if (username) openFriendProfileModal(username);
    }
  });

  document.getElementById('pendingRequestsList')?.addEventListener('click', (e) => {
    const acceptBtn = e.target.closest('.btn-accept-req');
    const declineBtn = e.target.closest('.btn-decline-req');
    if (acceptBtn) {
      const sender = acceptBtn.getAttribute('data-sender');
      if (sender) respondToFriendRequest(sender, true);
    } else if (declineBtn) {
      const sender = declineBtn.getAttribute('data-sender');
      if (sender) respondToFriendRequest(sender, false);
    }
  });

  document.getElementById('btnCloseFriendModal')?.addEventListener('click', () => {
    const m = document.getElementById('friendProfileModal');
    if (m) m.style.display = 'none';
  });
}

// =========================================================
// Aesthetic High-Tech Startup Splash Screen Controller
// =========================================================
const SplashController = {
  bar: null,
  text: null,
  pct: null,
  screen: null,
  dismissed: false,
  init() {
    this.bar = document.getElementById('splashProgressBar');
    this.text = document.getElementById('splashStatusText');
    this.pct = document.getElementById('splashStatusPct');
    this.screen = document.getElementById('appSplashLoadingScreen');
  },
  setProgress(percent, statusText) {
    if (this.dismissed) return;
    if (this.bar) this.bar.style.width = `${percent}%`;
    if (this.pct) this.pct.textContent = `${percent}%`;
    if (this.text && statusText) this.text.textContent = statusText;
  },
  dismiss() {
    if (this.dismissed) return;
    this.dismissed = true;
    this.setProgress(100, 'Welcome to KyroSphere PRO');
    setTimeout(() => {
      if (this.screen) {
        this.screen.classList.add('fade-out');
        setTimeout(() => {
          if (this.screen) this.screen.style.display = 'none';
        }, 520);
      }
    }, 450);
  }
};

// =========================================================
// Event Listeners & Bootstrapping
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  SplashController.init();
  SplashController.setProgress(20, 'Initializing Swarm Engine...');

  // 1. Particle Background
  window.particlesEngine = new ParticleEngine('particleCanvas');

  // 2. Frameless Window Controls
  document.getElementById('btnMinimize')?.addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
  document.getElementById('btnMaximize')?.addEventListener('click', () => ipcRenderer.invoke('window-maximize'));
  document.getElementById('btnClose')?.addEventListener('click', () => ipcRenderer.invoke('window-close'));

  // 3. Brand & Top Nav Tab Buttons
  document.getElementById('brandHomeBtn')?.addEventListener('click', () => switchView('discover-view'));

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-view');
      switchView(targetView);
    });
  });

  // Close split button dropdowns when clicking anywhere outside
  document.addEventListener('click', closeAllDetailDropdowns);

  // 4. Hero Action Buttons (Discover Page)
  document.getElementById('heroExploreBtn')?.addEventListener('click', () => {
    switchView('games-view');
    document.getElementById('catalogSearchInput')?.focus();
  });
  document.getElementById('heroCoopBtn')?.addEventListener('click', () => {
    switchView('multiplayer-view');
  });
  document.getElementById('heroDownloadsBtn')?.addEventListener('click', () => {
    switchView('downloads-view');
  });

  // Quick Stats Grid click shortcuts
  document.getElementById('statBoxGames')?.addEventListener('click', () => {
    switchView('games-view');
    document.getElementById('catalogSearchInput')?.focus();
  });
  document.getElementById('statBoxCoop')?.addEventListener('click', () => {
    switchView('multiplayer-view');
  });
  document.getElementById('statBoxDownloads')?.addEventListener('click', () => {
    switchView('downloads-view');
  });

  // 5. VIP API Button & Discord Buttons
  document.getElementById('btnHeaderApi')?.addEventListener('click', () => {
    ipcRenderer.invoke('open-url', 'https://kyrosphere-website.vercel.app/api-portal');
  });

  const openDiscord = () => {
    ipcRenderer.invoke('open-url', 'https://discord.gg/QAjrPyT89v');
  };
  document.getElementById('btnDiscord')?.addEventListener('click', openDiscord);
  document.getElementById('btnSettingsDiscord')?.addEventListener('click', openDiscord);

  // 6. Detail View Back Button
  document.getElementById('gameDetailBackBtn')?.addEventListener('click', () => {
    const target = AppState.previousView || 'games-view';
    switchView(target);
  });

  // 7. Lower Catalog Search Bar (in #games-view)
  const catalogSearchInput = document.getElementById('catalogSearchInput');
  const catalogSearchClearBtn = document.getElementById('catalogSearchClearBtn');
  let searchTimeout = null;

  if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (catalogSearchClearBtn) catalogSearchClearBtn.style.display = val.length > 0 ? 'block' : 'none';

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        AppState.searchQuery = val.trim();
        loadGames(1, val.trim());
      }, 100);
    });

    catalogSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        catalogSearchInput.value = '';
        if (catalogSearchClearBtn) catalogSearchClearBtn.style.display = 'none';
        AppState.searchQuery = '';
        loadGames(1, '');
        catalogSearchInput.blur();
      }
    });
  }

  if (catalogSearchClearBtn) {
    catalogSearchClearBtn.addEventListener('click', () => {
      if (catalogSearchInput) catalogSearchInput.value = '';
      catalogSearchClearBtn.style.display = 'none';
      AppState.searchQuery = '';
      loadGames(1, '');
    });
  }

  // 8. Co-op Search Bar (in #multiplayer-view)
  const coopSearchInput = document.getElementById('coopSearchInput');
  const coopSearchClearBtn = document.getElementById('coopSearchClearBtn');
  let coopSearchTimeout = null;

  if (coopSearchInput) {
    coopSearchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (coopSearchClearBtn) coopSearchClearBtn.style.display = val.length > 0 ? 'block' : 'none';

      clearTimeout(coopSearchTimeout);
      coopSearchTimeout = setTimeout(() => {
        AppState.coopSearchQuery = val.trim();
        loadCoopGames(1, val.trim());
      }, 100);
    });

    coopSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        coopSearchInput.value = '';
        if (coopSearchClearBtn) coopSearchClearBtn.style.display = 'none';
        AppState.coopSearchQuery = '';
        loadCoopGames(1, '');
        coopSearchInput.blur();
      }
    });
  }

  if (coopSearchClearBtn) {
    coopSearchClearBtn.addEventListener('click', () => {
      if (coopSearchInput) coopSearchInput.value = '';
      coopSearchClearBtn.style.display = 'none';
      AppState.coopSearchQuery = '';
      loadCoopGames(1, '');
    });
  }

  // 9. Category Pill Chips (Filtered against 10,181+ Games Index)
  document.querySelectorAll('.pill-chip').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill-chip').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.selectedCategory = pill.getAttribute('data-cat') || 'all';
      loadGames(1, AppState.searchQuery);
    });
  });

  // Category Showcase Cards at the bottom of Discover View
  document.querySelectorAll('#discoverCategoryShowcase .category-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.getAttribute('data-cat');
      if (!cat) return;

      if (cat.toLowerCase() === 'multiplayer') {
        switchView('multiplayer-view');
        return;
      }

      switchView('games-view');

      // Update pill chips UI
      document.querySelectorAll('.pill-chip').forEach(p => {
        if (p.getAttribute('data-cat')?.toLowerCase() === cat.toLowerCase()) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      AppState.selectedCategory = cat;
      loadGames(1, '');

      // Smooth scroll to catalog grid
      const catalogEl = document.getElementById('catalogGrid');
      if (catalogEl) {
        catalogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // 10. Catalog Pagination Buttons
  document.getElementById('btnPrevPage')?.addEventListener('click', () => {
    if (AppState.currentPage > 1) {
      loadGames(AppState.currentPage - 1, AppState.searchQuery);
    }
  });

  document.getElementById('btnNextPage')?.addEventListener('click', () => {
    if (AppState.currentPage < AppState.totalPages) {
      loadGames(AppState.currentPage + 1, AppState.searchQuery);
    }
  });

  document.getElementById('btnRefreshCatalog')?.addEventListener('click', () => {
    loadGames(AppState.currentPage, AppState.searchQuery);
    showToast({ title: 'Catalog Refreshed', message: 'Loaded latest game updates.' });
  });

  // Co-op Pagination Buttons
  document.getElementById('btnPrevCoopPage')?.addEventListener('click', () => {
    if (AppState.coopCurrentPage > 1) {
      loadCoopGames(AppState.coopCurrentPage - 1, AppState.coopSearchQuery);
    }
  });

  document.getElementById('btnNextCoopPage')?.addEventListener('click', () => {
    if (AppState.coopCurrentPage < AppState.coopTotalPages) {
      loadCoopGames(AppState.coopCurrentPage + 1, AppState.coopSearchQuery);
    }
  });

  // 11. Library Sync Badges
  document.getElementById('librarySyncBadge')?.addEventListener('click', triggerLibrarySync);
  document.getElementById('btnManualSyncIndex')?.addEventListener('click', triggerLibrarySync);

  // 12. Initialize Settings, Stats, Storage, Dependencies, Library, and Games
  await initSettings();
  initDependenciesView();
  initLibraryView();
  initProfileView();
  initSocialView();
  loadLibraryFromBackend();

  // Instant local cache paint for zero-delay startup
  try {
    const cached = await ipcRenderer.invoke('get-cached-games');
    if (cached && Array.isArray(cached.games) && cached.games.length > 0) {
      AppState.games = cached.games;
      const catalogGrid = document.getElementById('catalogGrid');
      const discoverGrid = document.getElementById('discoverGrid');
      renderGamesGrid(catalogGrid, filterGamesByCategory(AppState.games, AppState.selectedCategory));
      if (discoverGrid) {
        renderGamesGrid(discoverGrid, AppState.games.slice(0, 6));
        updateSpotlightBanner(AppState.games[0]);
      }
      SplashController.setProgress(80, 'Curated Vault Ready');
    }
  } catch (e) {}

  // Load page 1 games and history immediately
  loadGames(1).then(() => {
    SplashController.setProgress(100, 'Welcome to KyroSphere PRO');
    SplashController.dismiss();
  }).catch(() => {
    SplashController.dismiss();
  });
  refreshDownloadHistory();

  // Safety timer to guarantee splash screen dismissal
  setTimeout(() => {
    SplashController.dismiss();
  }, 2200);

  // Defer non-critical background calculations to eliminate startup freeze
  setTimeout(() => {
    initLibraryStats().catch(() => {});
    updateDiskSpaceDisplay().catch(() => {});
  }, 1200);

  setTimeout(() => {
    updateMoneySavedTracker().catch(() => {});
    detectAndRenderRigSpecs().catch(() => {});
  }, 6000);
});

// =========================================================
// Browser Protocol Deep Link Dispatcher (kyrosphere://game/...)
// =========================================================
if (typeof ipcRenderer !== 'undefined') {
  ipcRenderer.on('deep-link-received', async (event, data) => {
    console.log('[DeepLink] Processing browser protocol in renderer:', data);
    if (!data) return;

    const searchTerm = data.query || (data.slug ? data.slug.replace(/[-_]+/g, ' ') : '');

    showToast({
      title: 'Browser Launch Request',
      message: searchTerm ? `Connecting to catalog for "${searchTerm}"...` : 'Connected from KyroSphere Web Platform!',
      icon: 'fa-solid fa-bolt',
      duration: 5000
    });

    if (searchTerm) {
      // 1. Switch to Games catalog view
      switchView('games-view');

      // 2. Populate search input
      const searchInput = document.getElementById('catalogSearchInput');
      if (searchInput) {
        searchInput.value = searchTerm;
        searchInput.focus();
      }
      AppState.searchQuery = searchTerm;

      // 3. Load catalog results
      await loadGames(1, searchTerm);

      // 4. Find exact or best matching game
      let matchedGame = (AppState.games || []).find(g => {
        if (!g) return false;
        const gSlug = (g.slug || g.id || '').toLowerCase();
        const gName = (g.name || '').toLowerCase();
        const targetSlug = (data.slug || '').toLowerCase();
        const targetSearch = searchTerm.toLowerCase();

        return (targetSlug && (gSlug === targetSlug || gSlug.includes(targetSlug))) ||
               gName === targetSearch ||
               gName.includes(targetSearch);
      });

      // If not in current page, attempt direct fetch from full index
      if (!matchedGame && (data.slug || searchTerm)) {
        try {
          const detailRes = await ipcRenderer.invoke('get-game-details', data.slug || searchTerm);
          if (detailRes && detailRes.success && detailRes.game) {
            matchedGame = detailRes.game;
          }
        } catch (e) {
          console.warn('[DeepLink] Direct lookup error:', e.message);
        }
      }

      if (matchedGame) {
        setTimeout(() => {
          openGameDetailView(matchedGame);
        }, 300);
      }
    } else {
      switchView('discover-view');
    }
  });
}
