'use strict';

// ═══ CONFIG ══════════════════════════════════════════════════════════
function getApiUrl() { return (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || ''; }

// ═══ API LAYER ═══════════════════════════════════════════════════════
const API = {
  async request(action, params = {}) {
    const base = getApiUrl();
    if (!base) throw new Error('API no configurada. Revisa config.js');
    const qs = new URLSearchParams({ action });
    Object.entries(params).forEach(([k, v]) => qs.set(k, v));
    const res = await fetch(`${base}?${qs}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error API');
    return json.data;
  },
  async getAll() { return this.request('getAll'); },
  async savePlayer(p) { return this.request('savePlayer', { data: encodeURIComponent(JSON.stringify(p)) }); },
  async deletePlayer(id) { return this.request('deletePlayer', { id }); },
  async deleteJornada(id) { return this.request('deleteJornada', { id }); },
  async saveJornada(j) { return this.request('saveJornada', { data: encodeURIComponent(JSON.stringify(j)) }); },
  async savePartido(p) { return this.request('savePartido', { data: encodeURIComponent(JSON.stringify(p)) }); },
  async savePartidos(ps) { return this.request('savePartidos', { data: encodeURIComponent(JSON.stringify(ps)) }); },
  async saveTorneo(t) { return this.request('saveTorneo', { data: encodeURIComponent(JSON.stringify(t)) }); },
  async deleteTorneo(id) { return this.request('deleteTorneo', { id }); },
};

// ═══ CACHE (localStorage como respaldo offline) ═══════════════════════
const CACHE = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
const CK = { PLAYERS: 'rp_players', HISTORY: 'rp_history', SESSION: 'rp_session', TORNEOS: 'rp_torneos', ACTIVE_TORNEO: 'rp_active_torneo' };

// ═══ STATE ════════════════════════════════════════════════════════════
let state = { currentTab: 'play', players: [], history: [], torneos: [], activeTorneo: null, session: null, syncStatus: 'idle' };

// ═══ UTILS ════════════════════════════════════════════════════════════
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#84cc16', '#a855f7', '#0ea5e9'];
function colorFor(i) { return COLORS[i % COLORS.length]; }
function initials(n) { return (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join(''); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function playerById(id) { return state.players.find(p => p.id === id); }
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ═══ SYNC STATUS ══════════════════════════════════════════════════════
function setSyncStatus(s) {
  state.syncStatus = s;
  const el = document.getElementById('sync-indicator'); if (!el) return;
  const M = { idle: { cls: 'sync-idle', txt: '☁️', t: 'Sincronizado' }, syncing: { cls: 'sync-syncing', txt: '↻', t: 'Sincronizando…' }, error: { cls: 'sync-error', txt: '⚠️', t: 'Error de sync' }, offline: { cls: 'sync-offline', txt: '📵', t: 'Sin conexión' } };
  const c = M[s] || M.idle; el.className = `sync-indicator ${c.cls}`; el.title = c.t; el.textContent = c.txt;
}

// ═══ LOADING OVERLAY ══════════════════════════════════════════════════
function showLoading(txt) { const ov = document.getElementById('loading-overlay'); const tx = document.getElementById('loading-text'); if (ov) ov.classList.remove('hidden'); if (tx && txt) tx.textContent = txt; }
function hideLoading() { const ov = document.getElementById('loading-overlay'); if (ov) ov.classList.add('hidden'); }

// ═══ TOAST ════════════════════════════════════════════════════════════
let _tt = null;
function showToast(msg, ms = 2500) { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg; el.classList.remove('hidden'); clearTimeout(_tt); _tt = setTimeout(() => el.classList.add('hidden'), ms); }

// ═══ MODAL ════════════════════════════════════════════════════════════
function openModal(html) { document.getElementById('modal-inner').innerHTML = html; document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

// ═══ DATA TRANSFORMATION (API → app state) ════════════════════════════
function transformApiData({ torneos = [], jugadores = [], jornadas = [], partidos = [] }) {
  const parsedTorneos = torneos.map(t => ({ id: String(t.id), name: String(t.nombre) }));
  const players = jugadores.map(j => ({ id: String(j.id), name: String(j.nombre), color: String(j.color || '#3b82f6') }));
  const history = jornadas.map(j => {
    let att = []; try { att = typeof j.attendees === 'string' ? JSON.parse(j.attendees) : (j.attendees || []); } catch { }

    // Fallback date: extraemos el timestamp del ID de la jornada
    let rawDate = j.fecha || j.date || j.created_at;
    if (!rawDate || rawDate === 'undefined' || isNaN(new Date(rawDate).getTime())) {
      const ts = parseInt(String(j.id).slice(0, -5), 36);
      if (!isNaN(ts) && ts > 1600000000000) {
        rawDate = new Date(ts).toISOString();
      } else {
        rawDate = new Date().toISOString();
      }
    }

    const jMatches = partidos.filter(p => String(p.id_jornada) === String(j.id)).map(p => ({
      id: String(p.id), team1: [String(p.team1_p1), String(p.team1_p2)], team2: [String(p.team2_p1), String(p.team2_p2)],
      score1: parseInt(p.score1) || 0, score2: parseInt(p.score2) || 0,
      skipped: p.skipped === true || String(p.skipped).toUpperCase() === 'TRUE',
      matchIndex: parseInt(p.match_index) || 0,
    }));

    // Infer attendees if empty
    if (!att || att.length === 0) {
      const set = new Set();
      jMatches.forEach(m => {
        if (!m.skipped) {
          m.team1.forEach(id => set.add(id));
          m.team2.forEach(id => set.add(id));
        }
      });
      att = [...set];
    }

    let fmt = parseInt(j.games_format) || 4;
    let maxScore = 4;
    jMatches.forEach(m => {
      if (m.score1 > maxScore) maxScore = m.score1;
      if (m.score2 > maxScore) maxScore = m.score2;
    });
    
    // Si el backend falló en leer games_format, inferimos a partir de los puntajes jugados.
    const finalFmt = Math.max(fmt, maxScore);

    return {
      id: String(j.id), id_torneo: String(j.id_torneo || 'torneo_inicial'), date: String(rawDate), gamesFormat: finalFmt,
      attendees: att.map(String),
      matches: jMatches,
    };
  });
  return { parsedTorneos, players, history };
}

// ═══ LOAD STATE ════════════════════════════════════════════════════════
async function loadState() {
  state.session = CACHE.get(CK.SESSION, null);
  if (!getApiUrl()) {
    state.torneos = CACHE.get(CK.TORNEOS, []);
    state.activeTorneo = CACHE.get(CK.ACTIVE_TORNEO, null);
    state.players = CACHE.get(CK.PLAYERS, []);
    state.history = CACHE.get(CK.HISTORY, []);
    setSyncStatus('offline');
    showToast('⚠️ Modo local — configura config.js para Google Sheets', 5000);
    return;
  }
  try {
    setSyncStatus('syncing');
    const { parsedTorneos, players, history } = transformApiData(await API.getAll());
    state.torneos = parsedTorneos; state.players = players; state.history = history;

    // Set active torneo if not set or invalid
    let active = CACHE.get(CK.ACTIVE_TORNEO, null);
    if (!active || !state.torneos.find(t => t.id === active)) {
      active = state.torneos.length > 0 ? state.torneos[0].id : null;
    }
    state.activeTorneo = active;

    CACHE.set(CK.TORNEOS, parsedTorneos); CACHE.set(CK.PLAYERS, players); CACHE.set(CK.HISTORY, history); CACHE.set(CK.ACTIVE_TORNEO, active);
    setSyncStatus('idle');
  } catch (err) {
    console.warn('API no disponible:', err.message);
    state.torneos = CACHE.get(CK.TORNEOS, []);
    state.activeTorneo = CACHE.get(CK.ACTIVE_TORNEO, null);
    state.players = CACHE.get(CK.PLAYERS, []);
    state.history = CACHE.get(CK.HISTORY, []);
    setSyncStatus(navigator.onLine ? 'error' : 'offline');
    showToast('📵 Sin conexión — usando datos locales', 3500);
  }
}

// ═══ TORNEOS ════════════════════════════════════════════════════════════
function openTorneoModal() {
  const list = state.torneos.map(t => `
    <div style="display:flex; gap:8px;">
      <button class="btn btn-ghost" style="flex:1; justify-content:flex-start; text-align:left; font-weight:${t.id === state.activeTorneo ? '800' : '500'}; color:${t.id === state.activeTorneo ? 'var(--accent)' : 'inherit'}" onclick="changeTorneo('${t.id}')">
        ${t.id === state.activeTorneo ? '✓ ' : ''}${escHtml(t.name)}
      </button>
      <button class="btn btn-icon btn-ghost" onclick="openEditTorneoModal('${t.id}')" title="Editar Torneo">⚙️</button>
    </div>
  `).join('');

  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">🏆 Seleccionar Torneo</p>
    <div class="gap-8" style="margin-bottom:20px; max-height:200px; overflow-y:auto;">
      ${list}
    </div>
    <div class="input-group">
      <input type="text" id="new-torneo-name" class="input" placeholder="Nombre nuevo torneo..." />
    </div>
    <button class="btn btn-primary btn-full" style="margin-top:8px;" onclick="createTorneo()">➕ Crear Torneo</button>
  `);
}

function changeTorneo(id) {
  state.activeTorneo = id;
  CACHE.set(CK.ACTIVE_TORNEO, id);
  closeModal();
  renderPage();
  showToast('Torneo cambiado');
}

async function createTorneo() {
  const name = document.getElementById('new-torneo-name')?.value.trim();
  if (!name) { showToast('⚠️ Ingresa un nombre'); return; }
  const id = uid();
  const torneo = { id, nombre: name, created_at: new Date().toISOString() };

  const { ok } = await withSync(() => API.saveTorneo(torneo));
  if (ok) {
    state.torneos.push({ id, name });
    CACHE.set(CK.TORNEOS, state.torneos);
    changeTorneo(id);
  }
}

function openEditTorneoModal(id) {
  const t = state.torneos.find(x => x.id === id); if (!t) return;
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">⚙️ Editar Torneo</p>
    <div class="input-group" style="margin-bottom:16px;">
      <input type="text" id="edit-torneo-name" class="input" value="${escHtml(t.name)}" />
    </div>
    <div class="gap-8">
      <button class="btn btn-primary btn-full" onclick="renameTorneo('${id}')">✓ Guardar Nombre</button>
      <button class="btn btn-red btn-full" onclick="confirmDeleteTorneo('${id}')" ${id === 'torneo_inicial' ? 'disabled' : ''}>🗑 Eliminar Torneo</button>
      <button class="btn btn-ghost btn-full" onclick="openTorneoModal()">Volver</button>
    </div>
  `);
}

async function renameTorneo(id) {
  const t = state.torneos.find(x => x.id === id); if (!t) return;
  const name = document.getElementById('edit-torneo-name')?.value.trim();
  if (!name || name === t.name) { openTorneoModal(); return; }

  const btn = event.target;
  const oldHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Guardando…';

  const { ok } = await withSync(() => API.saveTorneo({ id, nombre: name }));
  if (ok) {
    t.name = name;
    CACHE.set(CK.TORNEOS, state.torneos);
    renderPage();
    openTorneoModal();
    showToast('✅ Nombre actualizado');
  } else {
    btn.disabled = false; btn.innerHTML = oldHtml;
  }
}

function confirmDeleteTorneo(id) {
  if (id === 'torneo_inicial') { showToast('⚠️ El Torneo Inicial no se puede borrar'); return; }
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">🗑 Eliminar Torneo</p>
    <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">¿Estás seguro de eliminar este torneo? <strong>No se borrarán los partidos (quedarán huérfanos)</strong>, pero el torneo desaparecerá.</p>
    <div class="gap-8">
      <button class="btn btn-red btn-full" onclick="executeDeleteTorneo('${id}')">🗑 Sí, eliminar</button>
      <button class="btn btn-ghost btn-full" onclick="openEditTorneoModal('${id}')">Cancelar</button>
    </div>
  `);
}

async function executeDeleteTorneo(id) {
  const btn = event.target;
  const oldHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Eliminando…';

  const { ok } = await withSync(() => API.deleteTorneo(id));
  if (ok) {
    state.torneos = state.torneos.filter(x => x.id !== id);
    if (state.activeTorneo === id) {
      state.activeTorneo = state.torneos.length > 0 ? state.torneos[0].id : null;
      CACHE.set(CK.ACTIVE_TORNEO, state.activeTorneo);
    }
    CACHE.set(CK.TORNEOS, state.torneos);
    closeModal(); renderPage(); showToast('🗑 Torneo eliminado');
  } else {
    btn.disabled = false; btn.innerHTML = oldHtml;
  }
}

// ═══ SYNC WRAPPER ══════════════════════════════════════════════════════
async function withSync(fn) {
  setSyncStatus('syncing');
  try { const result = await fn(); setSyncStatus('idle'); return { ok: true, result }; }
  catch (err) { setSyncStatus(navigator.onLine ? 'error' : 'offline'); showToast(`⚠️ Error: ${err.message}`, 4000); return { ok: false, error: err }; }
}

// ═══ NAVIGATION ════════════════════════════════════════════════════════
function navigate(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderPage();
}

// ═══ HEADER ════════════════════════════════════════════════════════════
function updateHeader() {
  const actions = document.getElementById('header-actions'); actions.innerHTML = '';
  const title = document.getElementById('header-title');

  if (state.currentTab === 'play') {
    const tName = state.torneos.find(t => t.id === state.activeTorneo)?.name || 'RotaPádel';
    title.innerHTML = `<span style="cursor:pointer; display:flex; align-items:center; gap:4px;" onclick="openTorneoModal()">${escHtml(tName)} <span style="font-size:0.7rem; opacity:0.7">▼</span></span>`;

    // Novedades Button
    const btnNov = document.createElement('button'); btnNov.className = 'btn btn-sm btn-ghost btn-icon'; btnNov.innerHTML = '🔔'; btnNov.title = 'Novedades v2.0'; btnNov.style.cssText = 'padding:7px;font-size:1.1rem;'; btnNov.onclick = openNovedadesModal; actions.appendChild(btnNov);

    const rld = document.createElement('button'); rld.className = 'btn btn-sm btn-ghost btn-icon'; rld.innerHTML = '🔄'; rld.title = 'Recargar desde Sheets'; rld.style.cssText = 'padding:7px 9px;font-size:0.9rem;'; rld.onclick = reloadFromApi; actions.appendChild(rld);
    if (state.session && !state.session.finished) { const btn = document.createElement('button'); btn.className = 'btn btn-sm btn-red'; btn.innerHTML = '✕ Jornada'; btn.style.cssText = 'font-size:0.75rem;padding:7px 10px;'; btn.onclick = confirmCancelSession; actions.appendChild(btn); }
  } else if (state.currentTab === 'history') {
    title.textContent = 'Jornadas';
  } else if (state.currentTab === 'players') {
    title.textContent = 'Jugadores';
    const btn = document.createElement('button'); btn.className = 'btn btn-sm btn-primary'; btn.innerHTML = '+ Añadir'; btn.style.cssText = 'font-size:0.82rem;padding:8px 12px;'; btn.onclick = openAddPlayerModal; actions.appendChild(btn);
  } else { title.textContent = 'Estadísticas'; }
}

function openNovedadesModal() {
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">🎉 Novedades v2.0</p>
    <div style="max-height: 55dvh; overflow-y:auto; padding-right:6px; font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">
      
      <div class="card" style="margin-bottom:12px; padding:12px; border-left:4px solid var(--accent);">
        <strong style="color:var(--text-primary); font-size:0.95rem;">🏆 Torneos Multiples</strong><br>
        Ahora puedes jugar distintos torneos. Las jornadas pasadas están en tu <strong>Torneo Inicial</strong>. Toca el título en la pantalla principal para cambiar de torneo.
      </div>
      
      <div class="card" style="margin-bottom:12px; padding:12px; border-left:4px solid var(--amber);">
        <strong style="color:var(--text-primary); font-size:0.95rem;">🏅 Ranking TrueSkill</strong><br>
        Las estadísticas usan <strong>TrueSkill</strong>, un sistema bayesiano que modela tu habilidad (μ) e incertidumbre (σ). A más partidos, más preciso. <em>Además se penaliza la inasistencia</em>.
      </div>
      
      <div class="card" style="margin-bottom:12px; padding:12px; border-left:4px solid var(--green);">
        <strong style="color:var(--text-primary); font-size:0.95rem;">🚀 Generador de Fixtures</strong><br>
        Al crear la jornada, puedes decir cuántos partidos se jugarán en total. La app generará todos los partidos de antemano optimizando los cruces, ¡e incluso puedes editarlos manualmente antes de empezar!
      </div>
      
    </div>
    <button class="btn btn-primary btn-full" style="margin-top:16px;" onclick="closeModal()">¡Entendido!</button>
  `);
}

async function reloadFromApi() {
  showLoading('Actualizando…'); await loadState(); hideLoading(); renderPage();
  if (state.syncStatus === 'idle') showToast('✅ Datos actualizados');
}

// ═══ RENDER DISPATCHER ═════════════════════════════════════════════════
function renderPage() {
  const c = document.getElementById('page-container'); c.innerHTML = '';
  const p = document.createElement('div'); p.className = 'page';
  if (state.currentTab === 'play') renderPlayPage(p);
  else if (state.currentTab === 'history') renderHistoryPage(p);
  else if (state.currentTab === 'players') renderPlayersPage(p);
  else renderStatsPage(p);
  c.appendChild(p); updateHeader();
}

// ═══ PLAY PAGE ═════════════════════════════════════════════════════════
function renderPlayPage(page) {
  page.innerHTML = '<div class="page-padding gap-12"></div>';
  const c = page.querySelector('.gap-12');
  if (state.syncStatus === 'error' || state.syncStatus === 'offline') {
    c.innerHTML += `<div class="sync-banner"><span class="sync-banner-icon">📵</span><span class="sync-banner-text">Sin conexión — datos locales</span><button class="sync-banner-btn" onclick="reloadFromApi()">Reintentar</button></div>`;
  }
  if (!state.session) renderNoSession(c);
  else if (state.session.finished) renderSessionEnd(c);
  else renderActiveSession(c);
}

function renderNoSession(c) {
  // Hero Section
  c.innerHTML += `
    <div class="card" style="background: linear-gradient(135deg, var(--accent), var(--cyan)); border:none; padding: 28px 20px; text-align: center; color: white; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: 0 10px 25px rgba(59,130,246,0.3); position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; font-size: 8rem; opacity: 0.1; transform: rotate(15deg); pointer-events: none;">🎾</div>
      <div style="font-size: 0.8rem; font-weight: 800; background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 20px; letter-spacing: 1px;">ROTA-PÁDEL v2.0</div>
      <div>
        <h2 style="font-size: 1.8rem; font-weight: 900; margin-bottom: 6px;">¡Bienvenido!</h2>
        <p style="font-size: 0.9rem; color: rgba(255,255,255,0.9); line-height: 1.5; max-width: 280px;">Crea fixtures instantáneos, anota resultados en cualquier orden y compite en el sistema de Ranking TrueSkill.</p>
      </div>
      <button class="btn" onclick="startSetupFlow()" style="background: white; color: var(--accent); width: 100%; max-width: 240px; margin-top: 12px; border-radius: 999px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: 1.05rem; font-weight: 800; padding: 14px;">⚡ Iniciar Nueva Jornada</button>
    </div>
  `;

  // Torneos Quick Access
  const torneosActivos = state.torneos.slice(-2).reverse();
  const torneosHtml = torneosActivos.map(t => `
    <button class="btn btn-ghost" onclick="changeTorneo('${t.id}')" style="flex:1; display:flex; flex-direction:column; align-items:center; padding:12px; border:1px solid ${state.activeTorneo === t.id ? 'var(--accent)' : 'var(--border)'}; background:${state.activeTorneo === t.id ? 'rgba(59,130,246,0.05)' : 'var(--bg-card)'};">
      <span style="font-size:1.2rem; margin-bottom:4px;">🏆</span>
      <span style="font-size:0.75rem; font-weight:700; color:${state.activeTorneo === t.id ? 'var(--accent)' : 'var(--text-primary)'}">${escHtml(t.name)}</span>
    </button>
  `).join('');

  c.innerHTML += `
    <div style="margin-top:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <p class="section-title" style="margin:0;">Tus Torneos</p>
        <button class="btn btn-icon btn-ghost btn-sm" onclick="openTorneoModal()" style="font-size:0.75rem; color:var(--accent);">Ver todos →</button>
      </div>
      <div style="display:flex; gap:10px;">
        ${torneosHtml}
      </div>
    </div>
  `;
  c.innerHTML += `
    <div class="card" style="margin-top:24px; padding:16px; border-left:4px solid var(--amber);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.4rem;">🏅</span>
          <h3 style="font-size:1rem; font-weight:800; margin:0;">Sistema de Rating</h3>
        </div>
      </div>
      <p style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5; margin-bottom:8px;">
        El ranking se calcula por torneo usando el <strong>Método Nuco Flocco</strong>, basado en TrueSkill bayesiano con penalización por inasistencia y margen de victoria.
      </p>
      <p style="font-size:0.78rem; color:var(--text-muted); font-style:italic; margin-bottom:12px;">
        Diseñado por el matemático <strong>Nuco Flocco</strong> para RotaPádel.
      </p>
      <button class="btn btn-ghost btn-full" onclick="navigate('stats')" style="font-size:0.85rem; color:var(--amber); background:rgba(245,158,11,0.1);">Ver Ranking del Torneo 🏆</button>
    </div>
  `;
}

function renderPodium(player, position, medalClass, height) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const bg = { gold: 'linear-gradient(180deg, #fbbf24, #b45309)', silver: 'linear-gradient(180deg, #94a3b8, #475569)', bronze: 'linear-gradient(180deg, #cd7f32, #78350f)' };

  return `
    <div style="display:flex; flex-direction:column; align-items:center; flex:1;">
      <div class="stat-avatar" style="background:${player.color}; border:2px solid var(--bg-card); z-index:2; margin-bottom:-10px;">${initials(player.name)}</div>
      <div style="background: ${bg[medalClass]}; width: 100%; max-width: 58px; height: ${height}; border-radius: 8px 8px 0 0; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding-top:12px; position:relative; box-shadow: inset 0 2px 5px rgba(255,255,255,0.2);">
        <span style="font-size:1.15rem; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));">${medals[position]}</span>
        <span style="font-weight:900; color:white; font-size:0.75rem; margin-top:4px;">${Math.round(player.elo)} Pts</span>
      </div>
      <div style="font-size:0.72rem; font-weight:700; color:var(--text-secondary); margin-top:8px; text-transform:uppercase; max-width:60px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(player.name)}</div>
    </div>
  `;
}

// ═══ SETUP FLOW ════════════════════════════════════════════════════════
function startSetupFlow() {
  if (state.players.length < 4) { showToast('⚠️ Necesitas al menos 4 jugadores'); return; }
  openAttendanceModal();
}

function openAttendanceModal() {
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">👥 ¿Quién viene hoy?</p>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px">Selecciona al menos 4 jugadores</p>
    <div id="attendance-list" class="gap-8" style="margin-bottom:16px">
      ${state.players.map(p => `<div class="check-item" id="chk-${p.id}" onclick="toggleAttendee('${p.id}')"><div class="check-box" id="chkbox-${p.id}"></div><div class="player-avatar" style="background:${p.color}">${initials(p.name)}</div><span class="check-name">${escHtml(p.name)}</span></div>`).join('')}
    </div>
    <div id="attend-msg" style="font-size:0.82rem;color:var(--amber);margin-bottom:10px;min-height:18px"></div>
    <button class="btn btn-primary btn-full" onclick="proceedToConfig()" id="btn-proceed-config" disabled style="opacity:0.5">🚀 Generar Fixture</button>`);
  window._attendees = new Set(); updateAttendanceBtn();
}

function toggleAttendee(id) {
  if (!window._attendees) window._attendees = new Set();
  if (window._attendees.has(id)) { window._attendees.delete(id); document.getElementById('chk-' + id)?.classList.remove('selected'); document.getElementById('chkbox-' + id).textContent = ''; }
  else { window._attendees.add(id); document.getElementById('chk-' + id)?.classList.add('selected'); document.getElementById('chkbox-' + id).textContent = '✓'; }
  updateAttendanceBtn();
}

function updateAttendanceBtn() {
  const n = window._attendees?.size || 0; const msg = document.getElementById('attend-msg'); const btn = document.getElementById('btn-proceed-config');
  if (!msg || !btn) return;
  if (n < 4) { msg.style.color = 'var(--amber)'; msg.textContent = `Selecciona ${4 - n} más`; btn.disabled = true; btn.style.opacity = '0.5'; }
  else { msg.style.color = 'var(--green)'; msg.textContent = `✓ ${n} jugadores seleccionados`; btn.disabled = false; btn.style.opacity = '1'; }
}

function proceedToConfig() {
  const attendees = [...window._attendees]; if (attendees.length < 4) return;
  previewFixture(attendees);
}

function previewFixture(attendees) {
  const count = 10; // Fijo 10 partidos por defecto

  // Randomize start to add variety to first match
  const sh = [...attendees].sort(() => Math.random() - 0.5);

  const stats = computeGlobalStats();
  const rankings = stats.ranking.reduce((acc, r) => { acc[r.id] = r; return acc; }, {});

  let fixture = [];
  for (let i = 0; i < count; i++) {
    const next = generateNextMatch(sh, fixture, rankings);
    next.matchIndex = i + 1;
    next.score1 = 0; next.score2 = 0; next.skipped = false;
    fixture.push(next);
  }

  window._tempFixture = fixture;
  window._tempAtt = sh;

  renderFixturePreview();
}

function renderFixturePreview() {
  const fixture = window._tempFixture;

  const list = fixture.map((m, i) => {
    const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
    const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';
    return `
      <div class="card" style="padding:12px; margin-bottom:8px;">
        <div style="font-size:0.75rem; color:var(--accent); font-weight:700; margin-bottom:6px;">Partido ${i + 1}</div>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight:600;">
          <div style="flex:1; text-align:right;">${escHtml(t1p1)} <br> ${escHtml(t1p2)}</div>
          <div style="margin:0 12px; color:var(--text-muted); display:flex; align-items:center;">vs</div>
          <div style="flex:1; text-align:left;">${escHtml(t2p1)} <br> ${escHtml(t2p2)}</div>
        </div>
        <div style="display:flex; justify-content:center; margin-top:8px;">
          <button class="btn btn-ghost btn-sm" onclick="shuffleMatch(${i})" style="font-size:0.7rem; padding:4px 8px;">🔄 Cambiar Parejas</button>
        </div>
      </div>
    `;
  }).join('');

  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">📋 Fixture Propuesto</p>
    <div style="max-height: 55dvh; overflow-y:auto; margin-bottom:16px;">
      ${list}
    </div>
    <div class="gap-8">
      <button class="btn btn-green btn-full" onclick="launchSession()">🚀 Confirmar y Empezar</button>
      <button class="btn btn-ghost btn-full" onclick="openAttendanceModal()">Volver a selección</button>
    </div>
  `);
}

function shuffleMatch(idx) {
  const fixture = window._tempFixture;
  const m = fixture[idx];
  const pool = [...m.team1, ...m.team2];
  const splits = getTeamSplits(pool);
  
  let currentIdx = 0;
  for (let i=0; i<splits.length; i++) {
    const s1 = [...splits[i][0]].sort().join('_');
    const mt1 = [...m.team1].sort().join('_');
    if (s1 === mt1 || s1 === [...m.team2].sort().join('_')) { currentIdx = i; break; }
  }
  
  const nextIdx = (currentIdx + 1) % splits.length;
  m.team1 = splits[nextIdx][0];
  m.team2 = splits[nextIdx][1];
  renderFixturePreview();
}

function launchSession() {
  const fixture = window._tempFixture;
  const attendees = window._tempAtt;

  state.session = {
    id: uid(),
    date: new Date().toISOString(),
    attendees,
    gamesFormat: 0, // Ya no se usa
    matches: [],
    fixture: fixture,
    currentMatch: fixture[0],
    matchIndex: 1,
    finished: false
  };
  CACHE.set(CK.SESSION, state.session);
  closeModal();
  renderPage();
  showToast('🎾 ¡Jornada iniciada!');
}

// ═══ ACTIVE SESSION ════════════════════════════════════════════════════
function renderActiveSession(c) {
  const s = state.session;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <p class="section-title" style="margin:0">Tablero de Fixture</p>
    <span class="badge badge-amber">${s.fixture.length} Partidos</span>
  </div>`;

  html += `<div style="margin-bottom:16px;">
    <p style="font-size:0.85rem; color:var(--text-secondary); line-height:1.4;">Ingresa los resultados a medida que terminan los partidos en las distintas canchas. Usa "Saltar" para omitir un partido.</p>
  </div>`;

  const fh = s.fixture.map((m, i) => {
    const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
    const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';

    return `
    <div class="card" style="padding:14px; margin-bottom:12px; position:relative; opacity: ${m.skipped ? '0.5' : '1'}; transition: opacity 0.2s;">
      <div style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:0.75rem;">
        <strong style="color:var(--accent)">Partido ${i + 1}</strong>
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
          <input type="checkbox" onchange="toggleFixtureSkip(${i})" ${m.skipped ? 'checked' : ''}>
          <span>Saltar</span>
        </label>
      </div>
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.9rem; font-weight:700; line-height:1.3; color:var(--text-primary); text-align:left;">${escHtml(t1p1)}<br>${escHtml(t1p2)}</div>
          <div style="display:flex; align-items:center; background:var(--bg-input); border-radius:8px; overflow:hidden; border:1px solid var(--border); ${m.skipped ? 'opacity:0.5; pointer-events:none;' : ''}">
            <button class="btn-ghost" style="padding:8px 16px; font-size:1.4rem; font-weight:800; border-right:1px solid var(--border);" onclick="changeFixtureScore(${i}, 1, -1)">-</button>
            <div id="fs-${i}-1" style="width:40px; text-align:center; font-size:1.3rem; font-weight:900;">${m.score1 || 0}</div>
            <button class="btn-ghost" style="padding:8px 16px; font-size:1.4rem; font-weight:800; border-left:1px solid var(--border);" onclick="changeFixtureScore(${i}, 1, 1)">+</button>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.9rem; font-weight:700; line-height:1.3; color:var(--text-primary); text-align:left;">${escHtml(t2p1)}<br>${escHtml(t2p2)}</div>
          <div style="display:flex; align-items:center; background:var(--bg-input); border-radius:8px; overflow:hidden; border:1px solid var(--border); ${m.skipped ? 'opacity:0.5; pointer-events:none;' : ''}">
            <button class="btn-ghost" style="padding:8px 16px; font-size:1.4rem; font-weight:800; border-right:1px solid var(--border);" onclick="changeFixtureScore(${i}, 2, -1)">-</button>
            <div id="fs-${i}-2" style="width:40px; text-align:center; font-size:1.3rem; font-weight:900;">${m.score2 || 0}</div>
            <button class="btn-ghost" style="padding:8px 16px; font-size:1.4rem; font-weight:800; border-left:1px solid var(--border);" onclick="changeFixtureScore(${i}, 2, 1)">+</button>
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:center; margin-top:12px;">
        <button class="btn btn-ghost btn-sm" onclick="openUpcomingMatchEditor(${i})" style="font-size:0.75rem; padding:4px 8px;">✏️ Editar Jugadores</button>
      </div>
    </div>`;
  }).join('');

  html += fh;

  html += `
  <div style="margin-top:12px; display:flex; justify-content:center;">
    <button class="btn btn-ghost btn-sm" onclick="addMatchToFixture()" style="font-size:0.8rem; border:1px dashed var(--border); padding:8px 16px;">➕ Añadir otro partido</button>
  </div>`;

  html += `
  <div style="margin-top:24px; margin-bottom: 24px;">
    <button class="btn btn-green btn-full" onclick="promptFinishSession()" style="padding:16px; font-size:1.1rem; font-weight:900; box-shadow:0 6px 20px rgba(16,185,129,0.3);">✅ Guardar y Calcular Rating</button>
    <button class="btn btn-ghost btn-full" onclick="confirmCancelSession()" style="margin-top:8px; color:var(--red);">Cancelar Jornada</button>
  </div>`;

  c.innerHTML = html;
}

function addMatchToFixture() {
  const s = state.session;
  if (!s) return;
  const stats = computeGlobalStats();
  const rankings = stats.ranking.reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  
  const next = generateNextMatch(s.attendees, s.fixture, rankings);
  next.matchIndex = s.fixture.length + 1;
  next.score1 = 0; next.score2 = 0; next.skipped = false;
  s.fixture.push(next);
  CACHE.set(CK.SESSION, s);
  renderPage();
  showToast('🎾 Nuevo partido añadido al tablero');
}

function updateFixtureScore(idx, team, val) {
  const v = parseInt(val) || 0;
  if (state.session && state.session.fixture[idx]) {
    if (team === 1) state.session.fixture[idx].score1 = v;
    else state.session.fixture[idx].score2 = v;
    CACHE.set(CK.SESSION, state.session);
  }
}

function changeFixtureScore(idx, team, delta) {
  const s = state.session;
  if (!s || !s.fixture[idx] || s.fixture[idx].skipped) return;
  const m = s.fixture[idx];
  let v = (team === 1 ? m.score1 : m.score2) || 0;
  v = Math.max(0, v + delta);
  if (team === 1) m.score1 = v; else m.score2 = v;
  CACHE.set(CK.SESSION, s);
  const el = document.getElementById(`fs-${idx}-${team}`);
  if (el) el.textContent = v;
}

function toggleFixtureSkip(idx) {
  if (state.session && state.session.fixture[idx]) {
    state.session.fixture[idx].skipped = !state.session.fixture[idx].skipped;
    CACHE.set(CK.SESSION, state.session);
    renderPage();
  }
}

function openUpcomingMatchEditor(idx) {
  const s = state.session;
  if (!s || !s.fixture || !s.fixture[idx]) return;
  const m = s.fixture[idx];

  // Guardar en variable global temporal para edición
  window._editFixtureIdx = idx;

  const pool = [...s.attendees];

  const renderSelect = (id) => `<select class="input" style="padding:6px; font-size:0.85rem;" onchange="updateUpcomingPreview()">
    ${pool.map(p => `<option value="${p}" ${p === id ? 'selected' : ''}>${escHtml(playerById(p)?.name)}</option>`).join('')}
  </select>`;

  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">✏️ Modificar Partido #${idx + 1}</p>
    <div class="gap-12" id="upcoming-edit-container">
        <div style="display:flex; gap:12px;">
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
          ${renderSelect(m.team1[0])}
          ${renderSelect(m.team1[1])}
        </div>
        <div style="display:flex; align-items:center; color:var(--text-muted)">VS</div>
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
          ${renderSelect(m.team2[0])}
          ${renderSelect(m.team2[1])}
        </div>
      </div>
      <button class="btn btn-primary btn-full" onclick="saveUpcomingMatch()">Guardar</button>
      <button class="btn btn-ghost btn-full" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function updateUpcomingPreview() { }

function saveUpcomingMatch() {
  const s = state.session;
  const idx = window._editFixtureIdx;
  if (!s || !s.fixture || idx === undefined || !s.fixture[idx]) return;

  const selects = document.querySelectorAll('#upcoming-edit-container select');
  if (selects.length !== 4) return;

  const vals = Array.from(selects).map(s => s.value);
  const unique = new Set(vals);
  if (unique.size !== 4) {
    showToast('⚠️ No puedes repetir jugadores en el mismo partido');
    return;
  }

  s.fixture[idx].team1 = [vals[0], vals[1]];
  s.fixture[idx].team2 = [vals[2], vals[3]];

  CACHE.set(CK.SESSION, s);
  closeModal();
  renderPage();
  showToast('✅ Partido actualizado');
}

function renderPlayCountBar(s) {
  const counts = {}; for (const id of s.attendees) counts[id] = 0;
  for (const m of s.matches) { if (!m.skipped) { for (const id of [...m.team1, ...m.team2]) counts[id]++; } }
  const max = Math.max(...Object.values(counts), 1);
  const items = s.attendees.map(id => { const p = playerById(id); const n = counts[id]; return `<div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:50%;background:${p?.color};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:#fff;flex-shrink:0">${initials(p?.name || '?')}</div><div style="flex:1;min-width:0"><div style="font-size:0.75rem;font-weight:600;color:var(--text-secondary);margin-bottom:3px">${escHtml(p?.name || '?')} <span style="color:var(--accent-bright)">${n}</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${Math.round((n / max) * 100)}%"></div></div></div></div>`; }).join('');
  return `<div class="card"><p class="section-title" style="margin-bottom:10px">Partidos jugados</p><div class="gap-8" style="max-height: 200px; overflow-y: auto; padding-right: 6px;">${items}</div></div>`;
}



function promptFinishSession() {
  const played = state.session.fixture.filter(m => !m.skipped && (m.score1 > 0 || m.score2 > 0));
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">🏁 ¿Terminar la jornada?</p>
    <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">Se registrarán <strong>${played.length} partidos</strong> en tu historial.</p>
    <div class="gap-8">
      <button class="btn btn-green btn-full" id="btn-confirm-finish" onclick="finishSession()">🏆 Sí, Guardar Todo</button>
      <button class="btn btn-ghost btn-full" onclick="closeModal()">Seguir editando</button>
    </div>
  `);
}

async function finishSession() {
  const btn = document.getElementById('btn-confirm-finish');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Finalizando…'; }
  const s = state.session;

  // Procesar partidos del fixture
  s.matches = [];
  let index = 1;
  const played = s.fixture.filter(m => !m.skipped && (m.score1 > 0 || m.score2 > 0));

  for (const m of played) {
    const partido = {
      id: uid(),
      id_jornada: s.id,
      team1_p1: m.team1[0], team1_p2: m.team1[1],
      team2_p1: m.team2[0], team2_p2: m.team2[1],
      score1: m.score1, score2: m.score2,
      skipped: false,
      match_index: index++,
      team1: m.team1, team2: m.team2
    };
    s.matches.push(partido);
  }

  setSyncStatus('syncing');
  try {
    await API.savePartidos(s.matches);

    await API.saveJornada({ id: s.id, id_torneo: state.activeTorneo, fecha: s.date, games_format: s.gamesFormat, attendees: s.attendees, finished: true });
    setSyncStatus('idle');
  } catch (err) {
    setSyncStatus('error');
    showToast('⚠️ Datos guardados localmente (Error: ' + err.message + ')', 4000);
  }

  state.history.push({ id: s.id, id_torneo: state.activeTorneo || 'torneo_inicial', date: s.date, gamesFormat: s.gamesFormat, attendees: s.attendees, matches: s.matches });
  CACHE.set(CK.HISTORY, state.history);
  s.finished = true; CACHE.set(CK.SESSION, s);

  closeModal();
  renderPage();
  showToast('🏆 ¡Jornada finalizada y Rating calculado!');
}

function renderSessionEnd(c) {
  const s = state.session;
  const ps = {}, pairs = {};
  for (const id of s.attendees) ps[id] = { wins: 0, games: 0 };

  for (const m of s.matches) {
    if (m.skipped) continue;
    const t1w = m.score1 > m.score2, t2w = m.score2 > m.score1;
    for (const id of m.team1) { ps[id].wins += t1w ? 1 : 0; ps[id].games += m.score1; }
    for (const id of m.team2) { ps[id].wins += t2w ? 1 : 0; ps[id].games += m.score2; }

    const proc = (team, won) => {
      const [a, b] = [...team].sort(); const k = a + '_' + b;
      if (!pairs[k]) { pairs[k] = { wins: 0, games: 0, names: [playerById(a)?.name || '?', playerById(b)?.name || '?'].join(' & ') } }
      if (won) pairs[k].wins++;
      pairs[k].games += (team === m.team1 ? m.score1 : m.score2);
    };
    proc(m.team1, t1w); proc(m.team2, t2w);
  }

  const deltas = getSessionEloDeltas(s.id);
  const mvp = deltas.length > 0 ? deltas[0] : null;

  const htmlRanking = deltas.map(r => {
    const isPos = r.delta > 0;
    const isNeg = r.delta < 0;
    const sign = isPos ? '+' : '';
    const color = isPos ? 'var(--green)' : (isNeg ? 'var(--red)' : 'var(--text-muted)');
    return `
    <div class="stat-row" style="padding:10px 0;border-bottom:1px dashed var(--border)">
      <div class="stat-avatar" style="background:${r.color || '#888'};width:32px;height:32px;font-size:0.75rem">${initials(r.name)}</div>
      <div style="flex:1;min-width:0;margin-left:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span class="stat-name" style="font-size:0.9rem">${escHtml(r.name || '?')}</span>
          <div style="display:flex; flex-direction:column; align-items:flex-end;">
            <span style="font-weight:900;color:${color};font-size:0.95rem">${sign}${Math.round(r.delta)} pts</span>
            <span style="font-size:0.7rem;color:var(--text-muted)">${Math.round(r.eloAfter)} total</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const pairsHtml = bestPairs.length > 0 ? `<p class="section-title" style="margin-top:24px;margin-bottom:12px">👥 Mejores Parejas</p>` + bestPairs.map(pair => `<div class="pair-card" style="margin-bottom:8px; padding:12px;"><div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); margin-bottom:6px;">${escHtml(pair.names)}</div><div style="display:flex; gap:16px; font-size:0.8rem; color:var(--text-secondary);"><div>Victorias: <strong style="color:var(--text-primary)">${pair.wins}</strong></div><div>Games ganados: <strong style="color:var(--text-primary)">${pair.games}</strong></div></div></div>`).join('') : '';

  c.innerHTML = `
    <div class="end-card" style="margin-bottom:20px;">
      <div class="end-icon">🏆</div>
      <div class="end-title">¡Jornada Terminada!</div>
      <div class="end-sub">${s.matches.length} partidos · ${s.attendees.length} jugadores</div>
      ${mvp && mvp.delta > 0 ? `<div class="badge" style="margin:0 auto;font-size:0.85rem;padding:6px 16px; background:rgba(59,130,246,0.1); color:var(--accent); border: 1px solid rgba(59,130,246,0.3); font-weight:800; box-shadow:0 4px 12px rgba(59,130,246,0.15)">🌟 Batacazo: ${escHtml(mvp.name)} (+${Math.round(mvp.delta)})</div>` : ''}
    </div>
    
    <div class="card" style="margin-bottom:20px; padding:20px 16px;">
      <p class="section-title" style="margin-bottom:12px">📈 Evolución ELO en el día</p>
      <div>${htmlRanking}</div>
      
      ${pairsHtml}
    </div>
    
    <button class="btn btn-full" onclick="shareSessionWhatsApp('${s.id}')" style="background:#25D366; color:#fff; font-weight:800; font-size:1rem; margin-bottom:24px; display:flex; justify-content:center; align-items:center; gap:8px;">
      <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.487-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
      Compartir Resultados
    </button>
    
    <div class="gap-8">
      <button class="btn btn-primary btn-full" onclick="clearSession();startSetupFlow()">⚡ Nueva Jornada</button>
      <button class="btn btn-ghost btn-full" onclick="clearSession()" style="font-size:0.85rem">Volver al Inicio</button>
    </div>`;
}

function shareSessionWhatsApp(id) {
  const j = state.history.find(x => x.id === id);
  if (!j) return;
  const deltas = getSessionEloDeltas(id);
  const mvp = deltas.length > 0 ? deltas[0] : null;
  
  let txt = `🏆 ¡Jornada Finalizada! 🏆\\n\\n`;
  if (mvp && mvp.delta > 0) {
    txt += `🌟 Batacazo del día: ${mvp.name} (+${Math.round(mvp.delta)} pts)\\n\\n`;
  }
  txt += `📈 Evolución del ELO:\\n`;
  deltas.forEach((d, i) => {
    const sign = d.delta > 0 ? '+' : '';
    txt += `${i+1}. ${d.name}: ${Math.round(d.eloAfter)} pts (${sign}${Math.round(d.delta)})\\n`;
  });
  txt += `\\n🔗 RotaPádel`;

  const encoded = encodeURIComponent(txt);
  
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt).catch(()=>{});
  }
  
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
  showToast('Abriendo WhatsApp...');
}

function clearSession() { state.session = null; CACHE.del(CK.SESSION); renderPage(); }
function confirmCancelSession() {
  openModal(`<div class="modal-handle"></div><p class="modal-title">⚠️ ¿Cancelar jornada?</p><p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">Se perderán los datos no guardados.</p><div class="gap-8"><button class="btn btn-red btn-full" onclick="clearSession();closeModal()">🗑 Sí, cancelar</button><button class="btn btn-ghost btn-full" onclick="closeModal()">Volver</button></div>`);
}

// ═══ PLAYERS PAGE ══════════════════════════════════════════════════════
function renderPlayersPage(page) {
  const c = document.createElement('div'); c.className = 'page-padding gap-12';
  if (state.players.length === 0) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">Sin jugadores todavía</div><div class="empty-sub">Añade jugadores para comenzar.</div><button class="btn btn-primary" onclick="openAddPlayerModal()" style="margin-top:8px">+ Añadir</button></div>`;
  } else {
    c.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span class="badge badge-blue">${state.players.length} jugadores</span>${state.players.length >= 4 ? '<span class="badge badge-green">✓ Listo para jugar</span>' : `<span class="badge badge-amber">Necesitas ${4 - state.players.length} más</span>`}</div>`;
    const list = document.createElement('div'); list.className = 'gap-8';
    list.innerHTML = state.players.map(p => renderPlayerItem(p)).join(''); c.appendChild(list);
  }
  page.appendChild(c);
}

function renderPlayerItem(p) {
  const s = getPlayerStatsQuick(p.id);
  return `<div class="player-item"><div class="player-avatar" style="background:${p.color}">${initials(p.name)}</div><div style="flex:1;min-width:0"><div class="player-name">${escHtml(p.name)}</div><div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${s.matches} partidos · ${s.wins} victorias · ${s.sessions} jornadas</div></div><div class="player-actions"><button class="btn btn-icon btn-ghost btn-sm" onclick="openEditPlayerModal('${p.id}')">✏️</button><button class="btn btn-icon btn-ghost btn-sm" onclick="confirmDeletePlayer('${p.id}')">🗑</button></div></div>`;
}

function getPlayerStatsQuick(id) {
  let matches = 0, wins = 0, sessions = 0;
  for (const session of getActiveHistory()) {
    if (!session.attendees.includes(id)) continue; sessions++;
    for (const m of session.matches) {
      if (m.skipped) continue;
      const t1 = m.team1.includes(id), t2 = m.team2.includes(id); if (!t1 && !t2) continue;
      matches++; if (t1 && m.score1 > m.score2) wins++; if (t2 && m.score2 > m.score1) wins++;
    }
  }
  return { matches, wins, sessions };
}

function openAddPlayerModal() {
  openModal(`<div class="modal-handle"></div><p class="modal-title">➕ Nuevo Jugador</p><div class="gap-12"><div class="input-group"><label class="input-label">Nombre</label><input class="input" type="text" id="new-player-name" placeholder="Ej: Carlos García" maxlength="30" onkeydown="if(event.key==='Enter')addPlayer()"/></div><button class="btn btn-primary btn-full" id="btn-add-player" onclick="addPlayer()">✓ Añadir</button><button class="btn btn-ghost btn-full" onclick="closeModal()">Cancelar</button></div>`);
  setTimeout(() => document.getElementById('new-player-name')?.focus(), 100);
}

async function addPlayer() {
  const input = document.getElementById('new-player-name'); const name = input?.value.trim();
  if (!name) { showToast('⚠️ Ingresa un nombre'); return; }
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { showToast('⚠️ Ya existe ese jugador'); return; }
  const btn = document.getElementById('btn-add-player'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Guardando…'; }
  const player = { id: uid(), name, color: colorFor(state.players.length) };
  const { ok } = await withSync(() => API.savePlayer(player));
  if (ok) { state.players.push(player); CACHE.set(CK.PLAYERS, state.players); closeModal(); renderPage(); showToast(`✅ ${name} añadido`); }
  else if (btn) { btn.disabled = false; btn.innerHTML = '✓ Añadir'; }
}

function openEditPlayerModal(id) {
  const p = playerById(id); if (!p) return;
  openModal(`<div class="modal-handle"></div><p class="modal-title">✏️ Editar Jugador</p><div class="gap-12"><div class="input-group"><label class="input-label">Nombre</label><input class="input" type="text" id="edit-player-name" value="${escHtml(p.name)}" maxlength="30" onkeydown="if(event.key==='Enter')editPlayer('${id}')"/></div><button class="btn btn-primary btn-full" id="btn-edit-player" onclick="editPlayer('${id}')">✓ Guardar</button><button class="btn btn-ghost btn-full" onclick="closeModal()">Cancelar</button></div>`);
  setTimeout(() => { const i = document.getElementById('edit-player-name'); if (i) { i.focus(); i.select(); } }, 100);
}

async function editPlayer(id) {
  const name = document.getElementById('edit-player-name')?.value.trim(); if (!name) { showToast('⚠️ Ingresa un nombre'); return; }
  const p = playerById(id); if (!p) return;
  const btn = document.getElementById('btn-edit-player'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Guardando…'; }
  const updated = { ...p, name };
  const { ok } = await withSync(() => API.savePlayer(updated));
  if (ok) { p.name = name; CACHE.set(CK.PLAYERS, state.players); closeModal(); renderPage(); showToast('✅ Nombre actualizado'); }
  else if (btn) { btn.disabled = false; btn.innerHTML = '✓ Guardar'; }
}

function confirmDeletePlayer(id) {
  const p = playerById(id);
  openModal(`<div class="modal-handle"></div><p class="modal-title">🗑 Eliminar Jugador</p><p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">¿Eliminar a <strong>${escHtml(p?.name || '?')}</strong>?</p><div class="gap-8"><button class="btn btn-red btn-full" id="btn-delete-player" onclick="deletePlayer('${id}')">🗑 Eliminar</button><button class="btn btn-ghost btn-full" onclick="closeModal()">Cancelar</button></div>`);
}

async function deletePlayer(id) {
  const btn = document.getElementById('btn-delete-player'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Eliminando…'; }
  const { ok } = await withSync(() => API.deletePlayer(id));
  if (ok) { state.players = state.players.filter(p => p.id !== id); CACHE.set(CK.PLAYERS, state.players); closeModal(); renderPage(); showToast('Jugador eliminado'); }
  else if (btn) { btn.disabled = false; btn.innerHTML = '🗑 Eliminar'; }
}

// ═══ HISTORY PAGE ══════════════════════════════════════════════════════
function getSessionEloDeltas(id) {
  const j = state.history.find(x => x.id === id);
  if (!j) return [];
  const stats = computeGlobalStats();
  
  const tHistory = state.history.filter(x => (state.activeTorneo ? x.id_torneo === state.activeTorneo : x.id_torneo === 'torneo_inicial'))
                .sort((a,b) => new Date(a.date) - new Date(b.date));
  const jIdx = tHistory.findIndex(x => x.id === id);
  if (jIdx === -1) return [];
  const histIdx = jIdx + 1; // eloHistory[0] is 'Inicio'

  const deltas = j.attendees.map(pid => {
    const pRank = stats.ranking.find(r => r.id === pid);
    if (!pRank || !pRank.eloHistory || pRank.eloHistory.length <= histIdx) return null;
    const eloAfter = pRank.eloHistory[histIdx].elo;
    const eloBefore = pRank.eloHistory[histIdx - 1].elo;
    const delta = eloAfter - eloBefore;
    return { id: pid, name: pRank.name, color: pRank.color, delta, eloAfter, eloBefore };
  }).filter(Boolean).sort((a, b) => b.delta - a.delta);

  return deltas;
}

function renderHistoryPage(page) {
  const c = document.createElement('div'); c.className = 'page-padding gap-12';
  const history = getActiveHistory();
  if (history.length === 0) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓</div><div class="empty-title">Sin jornadas jugadas</div><div class="empty-sub">El historial de fechas y resultados aparecerá aquí.</div></div>`;
  } else {
    const list = history.slice().reverse().map(j => {
      const date = new Date(j.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      const names = j.attendees.map(id => playerById(id)?.name || '?').join(', ');
      
      const deltas = getSessionEloDeltas(j.id);
      let mvpBadge = '';
      if (deltas.length > 0 && deltas[0].delta > 0) {
        mvpBadge = `<div style="margin-top:8px; font-size:0.75rem; font-weight:700; color:var(--accent); background:rgba(59,130,246,0.1); padding:4px 8px; border-radius:12px; display:inline-block;">🌟 MVP: ${escHtml(deltas[0].name)} (+${Math.round(deltas[0].delta)} pts)</div>`;
      }

      return `<div class="card" onclick="openJornadaDetails('${j.id}')" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-size:0.95rem;font-weight:800;text-transform:capitalize;margin-bottom:4px;color:var(--text-primary)">${date}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">${j.matches.length} partidos · ${j.attendees.length} jugadores</div>
            <div style="font-size:0.75rem;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${names}</div>
            ${mvpBadge}
          </div>
          <button class="btn btn-icon btn-ghost btn-sm" style="flex-shrink:0">👁</button>
        </div>
      </div>`;
    }).join('');
    c.innerHTML = `<div class="gap-12">${list}</div>`;
  }
  page.appendChild(c);
}

function openJornadaDetails(id) {
  const j = state.history.find(x => x.id === id); if (!j) return;
  const date = new Date(j.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  // — Calcular stats de esta jornada —
  const ps = {}, pairs = {};
  for (const id2 of j.attendees) ps[id2] = { wins: 0, games: 0 };
  const realMatches = j.matches.filter(m => !m.skipped);
  for (const m of realMatches) {
    const t1w = m.score1 > m.score2, t2w = m.score2 > m.score1;
    for (const pid of m.team1) { if (!ps[pid]) ps[pid] = { wins: 0, games: 0 }; ps[pid].wins += t1w ? 1 : 0; ps[pid].games += m.score1; }
    for (const pid of m.team2) { if (!ps[pid]) ps[pid] = { wins: 0, games: 0 }; ps[pid].wins += t2w ? 1 : 0; ps[pid].games += m.score2; }
    const proc = (team, won) => {
      const [a, b] = [...team].sort(); const k = a + '_' + b;
      if (!pairs[k]) pairs[k] = { wins: 0, games: 0, names: [playerById(a)?.name || '?', playerById(b)?.name || '?'].join(' & ') };
      if (won) pairs[k].wins++;
      pairs[k].games += (team === m.team1 ? m.score1 : m.score2);
    };
    proc(m.team1, t1w); proc(m.team2, t2w);
  }

  const deltas = getSessionEloDeltas(id);
  const mvp = deltas.length > 0 ? deltas[0] : null;
  const bestPairs = Object.values(pairs).sort((a, b) => b.wins - a.wins || b.games - a.games).slice(0, 2);

  const htmlRanking = deltas.map(r => {
    const isPos = r.delta > 0;
    const isNeg = r.delta < 0;
    const sign = isPos ? '+' : '';
    const color = isPos ? 'var(--green)' : (isNeg ? 'var(--red)' : 'var(--text-muted)');
    return `
    <div class="stat-row" style="padding:10px 0;border-bottom:1px dashed var(--border)">
      <div class="stat-avatar" style="background:${r.color || '#888'};width:32px;height:32px;font-size:0.75rem">${initials(r.name)}</div>
      <div style="flex:1;min-width:0;margin-left:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span class="stat-name" style="font-size:0.9rem">${escHtml(r.name || '?')}</span>
          <div style="display:flex; flex-direction:column; align-items:flex-end;">
            <span style="font-weight:900;color:${color};font-size:0.95rem">${sign}${Math.round(r.delta)} pts</span>
            <span style="font-size:0.7rem;color:var(--text-muted)">${Math.round(r.eloAfter)} total</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const pairsHtml = bestPairs.length > 0
    ? `<p class="section-title" style="margin-top:20px;margin-bottom:10px">👥 Mejor Pareja</p>` +
    bestPairs.map(pair => `
        <div class="pair-card" style="margin-bottom:8px;padding:12px">
          <div style="font-size:0.9rem;font-weight:800;color:var(--text-primary);margin-bottom:6px">${escHtml(pair.names)}</div>
          <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-secondary)">
            <div>Victorias: <strong style="color:var(--text-primary)">${pair.wins}</strong></div>
            <div>Games: <strong style="color:var(--text-primary)">${pair.games}</strong></div>
          </div>
        </div>`).join('')
    : '';

  openModal(`
    <div class="modal-handle"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <p class="modal-title" style="margin:0;text-transform:capitalize">${date}</p>
      <div>
        <button class="btn btn-icon btn-ghost btn-sm" onclick="confirmDeleteJornada('${id}')" style="margin-right:8px;color:var(--red)" title="Eliminar Jornada">🗑</button>
        <button class="btn btn-icon btn-ghost btn-sm" onclick="closeModal()">✕</button>
      </div>
    </div>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px">${realMatches.length} partidos · ${j.attendees.length} jugadores</p>

    ${mvp && mvp.delta > 0 ? `
    <div style="background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(59,130,246,0.04));border:1px solid rgba(59,130,246,0.25);border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div class="stat-avatar" style="background:${mvp.color || '#888'};width:44px;height:44px;font-size:1rem;flex-shrink:0">${initials(mvp.name)}</div>
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">🌟 Batacazo de la Jornada</div>
        <div style="font-size:1rem;font-weight:900;color:var(--text-primary)">${escHtml(mvp.name || '?')}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Rating final: ${Math.round(mvp.eloAfter)} <span style="color:var(--green);font-weight:700">(+${Math.round(mvp.delta)})</span></div>
      </div>
    </div>` : ''}

    <div style="max-height:55dvh;overflow-y:auto;padding-right:4px">
      <p class="section-title" style="margin-bottom:10px">📈 Evolución ELO en el día</p>
      <div class="card" style="padding:12px 16px;margin-bottom:4px">${htmlRanking}</div>
      ${pairsHtml}
      <button class="btn btn-ghost btn-full" onclick="openJornadaMatchList('${id}')" style="font-size:0.78rem;color:var(--text-muted);margin-top:16px">Ver partidos detallados →</button>
    </div>
  `);
}

function openJornadaMatchList(id) {
  const j = state.history.find(x => x.id === id); if (!j) return;
  const date = new Date(j.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const matchesHtml = j.matches.filter(m => !m.skipped).map((m, idx) => {
    const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
    const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';
    return `<div class="card" style="padding:14px;margin-bottom:10px;background:var(--bg-input)">
      <div style="font-size:0.75rem;color:var(--accent);margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Partido #${idx + 1}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="flex:1;text-align:right">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:2px">${escHtml(t1p1)}</div>
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary)">${escHtml(t1p2)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;background:var(--bg-card);padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:1.2rem;font-weight:900;color:var(--text-primary)">${m.score1}</div>
          <div style="font-size:0.9rem;color:var(--text-muted)">-</div>
          <div style="font-size:1.2rem;font-weight:900;color:var(--text-primary)">${m.score2}</div>
        </div>
        <div style="flex:1;text-align:left">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:2px">${escHtml(t2p1)}</div>
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary)">${escHtml(t2p2)}</div>
        </div>
      </div>
      <div style="margin-top:14px;text-align:center;border-top:1px solid var(--border);padding-top:10px">
        <button class="btn btn-ghost btn-sm" onclick="editMatchScore('${j.id}','${m.id}')" style="font-size:0.75rem;padding:6px 12px">✏️ Modificar</button>
      </div>
    </div>`;
  }).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn btn-icon btn-ghost btn-sm" onclick="openJornadaDetails('${id}')">←</button>
      <p class="modal-title" style="margin:0;text-transform:capitalize;font-size:1rem">${date}</p>
    </div>
    <div style="max-height:65dvh;overflow-y:auto;padding-right:4px">${matchesHtml}</div>
  `);
}

function confirmDeleteJornada(id) {
  const j = state.history.find(x => x.id === id); if (!j) return;
  const date = new Date(j.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">🗑 Eliminar Jornada</p>
    <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">¿Estás seguro de eliminar la jornada del <strong>${date}</strong> y sus ${j.matches.length} partidos? Los datos se borrarán para siempre.</p>
    <div class="gap-8">
      <button class="btn btn-red btn-full" id="btn-delete-jornada" onclick="executeDeleteJornada('${id}')">🗑 Sí, eliminar jornada</button>
      <button class="btn btn-ghost btn-full" onclick="openJornadaDetails('${id}')">Cancelar</button>
    </div>
  `);
}

async function executeDeleteJornada(id) {
  const btn = document.getElementById('btn-delete-jornada'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Eliminando…'; }
  const { ok } = await withSync(() => API.deleteJornada(id));
  if (ok) {
    state.history = state.history.filter(x => x.id !== id);
    CACHE.set(CK.HISTORY, state.history);
    closeModal();
    renderPage();
    showToast('🗑 Jornada eliminada correctamente');
  } else {
    if (btn) { btn.disabled = false; btn.innerHTML = '🗑 Sí, eliminar jornada'; }
  }
}

function editMatchScore(jId, mId) {
  const j = state.history.find(x => x.id === jId); if (!j) return;
  const m = j.matches.find(x => x.id === mId); if (!m) return;

  const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
  const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';

  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">✏️ Modificar Resultado</p>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:24px">Estás editando un partido del registro histórico.</p>
    
    <div class="score-row" style="margin-bottom:30px">
      <div>
        <div class="score-team" style="margin-bottom:12px">${escHtml(t1p1)}<br>& ${escHtml(t1p2)}</div>
        <div style="display:flex; align-items:center; justify-content:center; background:var(--bg-input); border-radius:8px; overflow:hidden; border:1px solid var(--border); margin:0 auto; max-width:140px;">
          <button class="btn-ghost" style="padding:10px 16px; font-size:1.5rem; font-weight:bold; border-right:1px solid var(--border);" onclick="changeEditScore(1, -1)">-</button>
          <div id="edit-score1" style="width:50px; text-align:center; font-size:1.6rem; font-weight:900;">${m.score1}</div>
          <button class="btn-ghost" style="padding:10px 16px; font-size:1.5rem; font-weight:bold; border-left:1px solid var(--border);" onclick="changeEditScore(1, 1)">+</button>
        </div>
      </div>
      <div class="score-vs" style="margin-top:20px">VS</div>
      <div>
        <div class="score-team" style="margin-bottom:12px">${escHtml(t2p1)}<br>& ${escHtml(t2p2)}</div>
        <div style="display:flex; align-items:center; justify-content:center; background:var(--bg-input); border-radius:8px; overflow:hidden; border:1px solid var(--border); margin:0 auto; max-width:140px;">
          <button class="btn-ghost" style="padding:10px 16px; font-size:1.5rem; font-weight:bold; border-right:1px solid var(--border);" onclick="changeEditScore(2, -1)">-</button>
          <div id="edit-score2" style="width:50px; text-align:center; font-size:1.6rem; font-weight:900;">${m.score2}</div>
          <button class="btn-ghost" style="padding:10px 16px; font-size:1.5rem; font-weight:bold; border-left:1px solid var(--border);" onclick="changeEditScore(2, 1)">+</button>
        </div>
      </div>
    </div>
    
    <div class="gap-8">
      <button class="btn btn-primary btn-full" id="btn-save-edit-match" onclick="saveEditedMatch('${jId}','${mId}')">✓ Guardar Cambios</button>
      <button class="btn btn-ghost btn-full" onclick="openJornadaDetails('${jId}')">Cancelar</button>
    </div>
  `);
}

function changeEditScore(team, delta) {
  const el = document.getElementById(`edit-score${team}`);
  if (!el) return;
  let v = parseInt(el.textContent) || 0;
  v = Math.max(0, v + delta);
  el.textContent = v;
}

async function saveEditedMatch(jId, mId) {
  const s1 = parseInt(document.getElementById('edit-score1').textContent) || 0;
  const s2 = parseInt(document.getElementById('edit-score2').textContent) || 0;

  const j = state.history.find(x => x.id === jId); if (!j) return;
  const m = j.matches.find(x => x.id === mId); if (!m) return;

  const btn = document.getElementById('btn-save-edit-match'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Guardando…'; }

  const updatedMatch = { ...m, score1: s1, score2: s2, id_jornada: jId };

  const { ok } = await withSync(() => API.savePartido(updatedMatch));
  if (ok) {
    m.score1 = s1; m.score2 = s2;
    CACHE.set(CK.HISTORY, state.history);
    renderPage();
    openJornadaDetails(jId);
    showToast('✅ Partido modificado correctamente');
  } else {
    if (btn) { btn.disabled = false; btn.innerHTML = '✓ Guardar Cambios'; }
  }
}

// ═══ STATS PAGE ════════════════════════════════════════════════════════
function renderStatsPage(page) {
  const c = document.createElement('div'); c.className = 'page-padding gap-12';
  const history = getActiveHistory();
  if (history.length === 0) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Sin datos todavía</div><div class="empty-sub">Completa tu primera jornada para ver estadísticas.</div></div>`;
    page.appendChild(c); return;
  }
  const stats = computeGlobalStats(); const total = history.reduce((s, h) => s + h.matches.length, 0);
  const tName = state.torneos.find(t => t.id === state.activeTorneo)?.name || 'General';
  c.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
      <span class="badge badge-blue" style="font-size:0.75rem;">🏆 ${escHtml(tName)}</span>
    </div>
    <div class="tab-selector" style="flex-wrap:wrap; gap:4px;">
      <button class="tab-opt active" onclick="switchStatTab('ranking',this)">🏆 Ranking</button>
      <button class="tab-opt" onclick="switchStatTab('chart',this)">📈 Evolución</button>
      <button class="tab-opt" onclick="switchStatTab('games',this)">🎾 Games</button>
      <button class="tab-opt" onclick="switchStatTab('attend',this)">📅 Asistencia</button>
      <button class="tab-opt" onclick="switchStatTab('pairs',this)">👥 Parejas</button>
      <button class="tab-opt" onclick="switchStatTab('formula',this)">📐 Fórmula</button>
    </div>
    <div class="hero-grid"><div class="hero-stat"><div class="icon">🗓</div><div class="value">${history.length}</div><div class="label">Jornadas</div></div><div class="hero-stat"><div class="icon">🎾</div><div class="value">${total}</div><div class="label">Partidos</div></div></div>`;
  const tc = document.createElement('div'); tc.id = 'stats-tab-content'; c.appendChild(tc);
  renderStatTab(tc, 'ranking', stats); page.appendChild(c);
}

function switchStatTab(tab, btn) {
  document.querySelectorAll('.tab-opt').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  const c = document.getElementById('stats-tab-content'); if (c) renderStatTab(c, tab, computeGlobalStats());
}

function renderStatTab(c, tab, stats) {
  c.innerHTML = ''; c.className = 'gap-12';
  if (tab === 'ranking') {
    c.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <p class="section-title" style="margin:0;">🏆 Ranking Método Nuco Flocco</p>
        <button class="btn btn-ghost btn-sm" onclick="copyRankingToClipboard()" style="font-size:0.75rem; padding:4px 10px; color:var(--green); border: 1px solid var(--border); background: var(--bg-card);">
          <span style="margin-right:4px;">💬</span>Copiar para WA
        </button>
      </div>
      <div class="card">${stats.ranking.map((r, i) => {
      const rankInfo = getEloRankInfo(r.elo);
      const penaltyHtml = r.penalty < -1 ? `<span style="font-size:0.65rem; color:var(--red); margin-left:4px;">📉 ${r.penalty} por faltas</span>` : '';
      return `<div class="stat-row"><div class="stat-pos ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div style="font-size:0.75rem; color:${rankInfo.color}; margin-top:4px; font-weight:700;">${rankInfo.badge} - ${Math.round(r.elo)} Pts${penaltyHtml}</div></div><div style="text-align:right"><div class="stat-val" style="font-size:1.1rem">${r.wins} v</div><div class="stat-unit" style="font-size:0.75rem">en ${r.matches} pj</div></div></div>`;
    }).join('')}</div>`;
  } else if (tab === 'games') {
    const max = stats.gamesRanking[0]?.games || 1;
    c.innerHTML = `<p class="section-title">🎾 Games Ganados</p><div class="card">${stats.gamesRanking.map((r, i) => `<div class="stat-row"><div class="stat-pos ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div class="stat-bar-wrap" style="max-width:120px"><div class="stat-bar" style="width:${Math.round((r.games / max) * 100)}%;background:linear-gradient(90deg,var(--green),var(--cyan))"></div></div></div><div style="text-align:right"><div class="stat-val">${r.games}</div><div class="stat-unit">games</div></div></div>`).join('')}</div>`;
  } else if (tab === 'attend') {
    c.innerHTML = `<p class="section-title">📅 Asistencia</p><div class="card">${stats.attendance.map((r, i) => { const pct = r.possible > 0 ? Math.round((r.sessions / r.possible) * 100) : 0; return `<div class="stat-row"><div class="stat-pos">${i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div class="stat-bar-wrap" style="max-width:120px"><div class="stat-bar" style="width:${pct}%;background:linear-gradient(90deg,var(--amber),var(--red))"></div></div></div><div style="text-align:right"><div class="stat-val">${r.sessions}</div><div class="stat-unit">de ${r.possible} (${pct}%)</div></div></div>`; }).join('')}</div>`;
  } else if (tab === 'formula') {
    c.innerHTML = `
      <div class="card" style="padding:20px; border-left:4px solid var(--accent);">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
          <span style="font-size:1.6rem;">📐</span>
          <div>
            <p style="font-size:1.1rem; font-weight:900; color:var(--text-primary); margin:0;">Método Nuco Flocco</p>
            <p style="font-size:0.75rem; color:var(--text-muted); margin:0; font-style:italic;">Sistema de ranking diseñado por el matemático Nuco Flocco para RotaPádel</p>
          </div>
        </div>
        
        <div style="font-size:0.82rem; color:var(--text-secondary); line-height:1.6;">
          <p style="margin-bottom:12px;">El método se basa en <strong style="color:var(--text-primary);">TrueSkill</strong> (sistema bayesiano de Microsoft) con dos modificaciones originales: <em>penalización por inasistencia</em> y <em>ponderación por margen de victoria</em>.</p>
          <p style="margin-bottom:12px;">Cada ranking es <strong style="color:var(--text-primary);">independiente por torneo</strong>. Al cambiar de torneo, se recalcula el ranking solo con las jornadas de ese torneo.</p>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">1. Modelo del Jugador</p>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm); font-family:monospace; font-size:0.78rem; line-height:1.8; margin-bottom:8px;">
Cada jugador se modela como:
  <strong>Habilidad ~ N(μ, σ²)</strong>

  μ = habilidad estimada (inicia en 25)
  σ = incertidumbre — se deriva de tus propios partidos:

  <strong>σ(n) = √(σ₀² / (n+1) + τ²)</strong>

  n=0  → σ ≈ 8.33 (nuevo, baja confianza)
  n=10 → σ ≈ 2.56 (más estable)
  n→∞  → σ → τ = 0.50 (piso mínimo)

  Cada jugador tiene su σ independiente.
  Editar partidos ajenos NO afecta tu σ.
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">2. Actualización por Partido (2v2)</p>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm); font-family:monospace; font-size:0.78rem; line-height:1.8; margin-bottom:8px;">
Para un partido Equipo A vs Equipo B:

  σ_jugador = σ(partidos_propios)  ← aislado
  μ_equipo = μ_j1 + μ_j2
  σ²_equipo = σ²_j1 + σ²_j2

  c = √(σ²_A + σ²_B + 2β²)
  t = (μ_ganador − μ_perdedor) / c

  <strong>Funciones de corrección:</strong>
  v(t) = φ(t) / Φ(t)    ← ratio Mills
  w(t) = v(t) × (v(t) + t)

  <strong>Solo se actualiza μ (no σ):</strong>
  Δμ = ±(σ² / c) × v(t) × M
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">3. Margen de Victoria (M)</p>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm); font-family:monospace; font-size:0.78rem; line-height:1.8; margin-bottom:8px;">
  <strong>M = 1 + 0.15 × ln(|score₁ − score₂| + 1)</strong>

  Ejemplos:
  · Gana 6-5 (diff=1) → M = 1.10
  · Gana 6-3 (diff=3) → M = 1.21
  · Gana 6-0 (diff=6) → M = 1.29

  Amplifica el update de μ sin
  desbalancear la escala.
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">4. Penalización por Inasistencia</p>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm); font-family:monospace; font-size:0.78rem; line-height:1.8; margin-bottom:8px;">
  <strong>Rating = μ + (k/N − 1) × σ</strong>

  k = jornadas a las que asistió
  N = total de jornadas del torneo

  · Asiste a todas (k/N=1) → Rating = μ
  · Asiste al 50% (k/N=0.5) → Rating = μ − σ/2
  · No asistió nunca (k/N=0) → Rating = μ − σ

  A mayor incertidumbre (σ), mayor
  la penalización por no venir.
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">5. Parámetros</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); text-align:center;">
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">μ₀ (Media inicial)</div>
              <div style="font-size:1.1rem; font-weight:900; color:var(--text-primary);">25</div>
            </div>
            <div style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); text-align:center;">
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">σ₀ (Incertidumbre)</div>
              <div style="font-size:1.1rem; font-weight:900; color:var(--text-primary);">8.33</div>
            </div>
            <div style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); text-align:center;">
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">β (Ruido perf.)</div>
              <div style="font-size:1.1rem; font-weight:900; color:var(--text-primary);">4.17</div>
            </div>
            <div style="background:var(--bg-input); padding:10px; border-radius:var(--radius-sm); text-align:center;">
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">τ (Factor dinámico)</div>
              <div style="font-size:1.1rem; font-weight:900; color:var(--text-primary);">0.50</div>
            </div>
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
          <p style="font-size:0.9rem; font-weight:800; color:var(--accent); margin-bottom:12px;">6. Escala de Visualización</p>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm); font-family:monospace; font-size:0.78rem; line-height:1.8; margin-bottom:8px;">
  <strong>Pts = (μ_ajustado / 50) × 1000 + 500</strong>

  μ=25 (inicio) → 1000 Pts
  μ=35 (bueno)  → 1200 Pts
  μ=15 (bajo)   →  800 Pts
          </div>
        </div>

        <div style="margin-top:20px; padding:14px; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.15); border-radius:var(--radius-sm);">
          <p style="font-size:0.8rem; color:var(--text-secondary); line-height:1.5; margin:0;">
            <strong style="color:var(--text-primary);">Nota:</strong> El ranking se recalcula completamente desde el historial cada vez que se abre la app. No se persisten valores de μ/σ. Cada torneo tiene su propio ranking independiente.
          </p>
        </div>
      </div>
    `;
  } else if (tab === 'pairs') {
    if (!stats.pairs.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Sin datos de parejas</div></div>'; return; }
    c.innerHTML = `<p class="section-title">👥 Mejores Parejas</p>` + stats.pairs.slice(0, 10).map((pair, i) => `<div class="pair-card"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div class="pair-names">${escHtml(pair.names)}</div>${i === 0 ? '<span class="badge badge-purple">🏆 Mejor Pareja</span>' : ''}</div><div class="pair-stats-row"><div class="pair-stat">Juntos: <strong>${pair.total}</strong></div><div class="pair-stat">Victorias: <strong>${pair.wins}</strong></div><div class="pair-stat">Win rate: <strong>${pair.total > 0 ? Math.round((pair.wins / pair.total) * 100) : 0}%</strong></div></div><div class="progress-wrap" style="margin-top:8px"><div class="progress-bar" style="width:${pair.total > 0 ? Math.round((pair.wins / pair.total) * 100) : 0}%;background:linear-gradient(90deg,var(--purple),var(--accent))"></div></div></div>`).join('');
  } else if (tab === 'chart') {
    state.chartFilter = state.chartFilter || 'all';
    state.chartHidden = state.chartHidden || {};

    let topPlayers = stats.ranking;
    if (state.chartFilter === 'top5') topPlayers = topPlayers.slice(0, 5);
    else if (state.chartFilter === 'top3') topPlayers = topPlayers.slice(0, 3);

    if (topPlayers.length === 0 || !topPlayers[0].eloHistory) {
      c.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-title">No hay historial suficiente</div></div>'; return;
    }

    // Construir línea de tiempo global del torneo activo
    const tHistory = state.history.filter(j => (state.activeTorneo ? j.id_torneo === state.activeTorneo : j.id_torneo === 'torneo_inicial')).sort((a, b) => new Date(a.date) - new Date(b.date));
    const timeline = ['Inicio', ...tHistory.map(j => j.date)];
    const maxIdx = Math.max(1, timeline.length - 1);

    let maxElo = 1000, minElo = 1000;
    let hasVisible = false;
    topPlayers.forEach(p => {
      if (state.chartHidden[p.id]) return;
      hasVisible = true;
      p.eloHistory.forEach(h => {
        if (h.elo > maxElo) maxElo = h.elo;
        if (h.elo < minElo) minElo = h.elo;
      });
    });

    if (!hasVisible) { maxElo = 1010; minElo = 990; }
    maxElo = Math.ceil(maxElo + 20); minElo = Math.floor(minElo - 20);
    const range = maxElo - minElo;

    const w = 300, h = 180;

    const lines = topPlayers.map(p => {
      if (state.chartHidden[p.id] || p.eloHistory.length <= 1) return '';
      
      const points = p.eloHistory.map(hist => {
        let idx = timeline.indexOf(hist.date);
        if (idx === -1) idx = 0;
        const x = (idx / maxIdx) * w;
        const y = h - (((hist.elo - minElo) / range) * h);
        return `${x},${y}`;
      }).join(' ');

      const lastHist = p.eloHistory[p.eloHistory.length - 1];
      let lastIdx = timeline.indexOf(lastHist.date);
      if (lastIdx === -1) lastIdx = 0;
      const lastX = (lastIdx / maxIdx) * w;
      const lastY = h - (((lastHist.elo - minElo) / range) * h);

      return `
        <polyline points="${points}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastX}" cy="${lastY}" r="4" fill="${p.color}" stroke="#fff" stroke-width="1.5" />
      `;
    }).join('');

    const legend = topPlayers.map(p => `
      <div onclick="toggleChartPlayer('${p.id}')" style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--text-secondary); cursor:pointer; opacity:${state.chartHidden[p.id] ? '0.4' : '1'}; transition:0.2s;">
        <div style="width:10px; height:10px; border-radius:50%; background:${p.color};"></div>
        ${escHtml(p.name)}
      </div>
    `).join('');

    const btnStyle = (mode) => `font-size:0.75rem; padding:4px 8px; border-radius:4px; cursor:pointer; border:1px solid var(--border); background:${state.chartFilter === mode ? 'var(--accent)' : 'var(--bg-card)'}; color:${state.chartFilter === mode ? 'white' : 'var(--text-primary)'};`;

    c.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <p class="section-title" style="margin:0;">📈 Evolución Rating</p>
        <div style="display:flex; gap:6px;">
          <button style="${btnStyle('all')}" onclick="setChartFilter('all')">Todos</button>
          <button style="${btnStyle('top5')}" onclick="setChartFilter('top5')">Top 5</button>
          <button style="${btnStyle('top3')}" onclick="setChartFilter('top3')">Top 3</button>
        </div>
      </div>
      <div class="card" style="padding: 16px 16px 16px 8px; overflow-x: auto; margin-top:8px;">
        <svg viewBox="-30 -10 ${w + 40} ${h + 35}" style="width:100%; height:auto; overflow:visible;">
          <!-- Grid Lines -->
          <line x1="0" y1="0" x2="${w}" y2="0" stroke="var(--border)" stroke-dasharray="4" />
          <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="var(--border)" stroke-dasharray="4" />
          <line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="var(--border)" stroke-dasharray="4" />
          
          <!-- Y-Axis Labels -->
          <text x="-8" y="4" font-size="10" fill="var(--text-muted)" text-anchor="end" font-weight="600">${maxElo}</text>
          <text x="-8" y="${h / 2 + 4}" font-size="10" fill="var(--text-muted)" text-anchor="end" font-weight="600">${Math.round((maxElo + minElo) / 2)}</text>
          <text x="-8" y="${h + 4}" font-size="10" fill="var(--text-muted)" text-anchor="end" font-weight="600">${minElo}</text>
          
          <!-- X-Axis Labels (Dates) -->
          ${timeline.map((dateStr, idx) => {
            if (idx === 0 || idx === maxIdx || maxIdx < 4 || (idx % Math.floor(maxIdx / 3) === 0)) {
              const x = (idx / maxIdx) * w;
              let dLabel = 'Inicio';
              if (dateStr !== 'Inicio') {
                const d = new Date(dateStr);
                dLabel = `${d.getDate()}/${d.getMonth() + 1}`;
              }
              return `<text x="${x}" y="${h + 18}" font-size="9" fill="var(--text-muted)" text-anchor="middle" font-weight="600">${dLabel}</text>`;
            }
            return '';
          }).join('')}
          
          ${lines}
        </svg>
        <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; justify-content:center; padding-top:12px; border-top:1px dashed var(--border);">
          ${legend}
        </div>
      </div>
    `;
  }
}

function setChartFilter(mode) {
  state.chartFilter = mode;
  state.chartHidden = {};
  const c = document.getElementById('stats-tab-content');
  if (c) renderStatTab(c, 'chart', computeGlobalStats());
}

function toggleChartPlayer(id) {
  state.chartHidden[id] = !state.chartHidden[id];
  const c = document.getElementById('stats-tab-content');
  if (c) renderStatTab(c, 'chart', computeGlobalStats());
}
function copyRankingToClipboard() {
  const stats = computeGlobalStats();
  const tName = state.torneos.find(t => t.id === state.activeTorneo)?.name || 'General';
  let text = `🏆 *Ranking RotaPádel - ${tName}* 🏆\n\n`;
  stats.ranking.forEach((r, i) => {
    const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const rankInfo = getEloRankInfo(r.elo);
    const badge = rankInfo.badge.split(' ')[0];
    text += `${pos} *${r.name}* - ${Math.round(r.elo)} pts (${badge})\n`;
  });
  text += '\nGenerado por RotaPádel Método Nuco Flocco';

  navigator.clipboard.writeText(text).then(() => {
    if(typeof showToast === 'function') showToast('✅ Ranking copiado al portapapeles');
    else alert('✅ Ranking copiado al portapapeles');
  }).catch(() => {
    if(typeof showToast === 'function') showToast('❌ Error al copiar (Intenta desde https)');
    else alert('❌ Error al copiar');
  });
}

function getActiveHistory() {
  if (!state.activeTorneo) return state.history;
  return state.history.filter(h => h.id_torneo === state.activeTorneo || (!h.id_torneo && state.activeTorneo === 'torneo_inicial'));
}

// ═══ TRUESKILL MATH HELPERS ═══════════════════════════════════════════
const TS = { MU0: 25, SIGMA0: 25 / 3, BETA: 25 / 6, TAU: 0.5 };

function normalPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function normalCdf(x) {
  // Abramowitz & Stegun approximation (precision ~1.5e-7)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

function tsVFunction(t) {
  // v(t) = N(t) / Φ(t) — truncated Gaussian correction for mean
  const denom = normalCdf(t);
  if (denom < 1e-15) return -t; // Numerical stability for very negative t
  return normalPdf(t) / denom;
}

function tsWFunction(t) {
  // w(t) = v(t) * (v(t) + t) — truncated Gaussian correction for variance
  const v = tsVFunction(t);
  return v * (v + t);
}

function tsScaleToDisplay(mu) {
  // Escalar μ (escala TrueSkill ~0-50) a display ~500-1500 centrado en 1000
  return (mu / 50) * 1000 + 500;
}

function sigmaFromMatches(n) {
  // σ se deriva SOLO de los partidos jugados por ESE jugador.
  // Esto evita el efecto cascada: editar un partido ajeno no cambia tu σ.
  // Con n=0: σ ≈ SIGMA0. Con n→∞: σ converge a TAU.
  return Math.sqrt((TS.SIGMA0 * TS.SIGMA0) / (n + 1) + TS.TAU * TS.TAU);
}

function computeGlobalStats() {
  const ps = {}, pairs = {};

  state.players.forEach(p => {
    ps[p.id] = { wins: 0, matches: 0, games: 0, sessions: 0, mu: TS.MU0, eloHistory: [{ date: 'Inicio', elo: tsScaleToDisplay(TS.MU0) }] };
  });

  const history = getActiveHistory().sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalSessions = history.length;

  for (const session of history) {
    let att = session.attendees;
    if (!att || att.length === 0) {
      const attSet = new Set();
      session.matches.forEach(m => {
        if (!m.skipped) {
          m.team1.forEach(id => attSet.add(id));
          m.team2.forEach(id => attSet.add(id));
        }
      });
      att = [...attSet];
    }
    for (const id of att) {
      if (!ps[id]) ps[id] = { wins: 0, matches: 0, games: 0, sessions: 0, mu: TS.MU0, eloHistory: [{ date: 'Inicio', elo: tsScaleToDisplay(TS.MU0) }] };
      ps[id].sessions++;
    }
    // ── Snapshot de μ y n_partidos al INICIO de la jornada ──────────────────
    // Todos los partidos de esta jornada calculan su delta con los mismos valores
    // de arranque. Así el orden de los partidos no importa y editar un partido
    // solo afecta a los jugadores de ESE partido.
    const muSnap = {}, matchSnap = {};
    Object.keys(ps).forEach(id => { muSnap[id] = ps[id].mu; matchSnap[id] = ps[id].matches; });

    // Acumulador de deltas de μ para esta jornada (se aplican al final)
    const deltaMu = {};
    Object.keys(ps).forEach(id => { deltaMu[id] = 0; });

    const matches = [...session.matches].sort((a, b) => a.matchIndex - b.matchIndex);

    for (const m of matches) {
      if (m.skipped) continue;

      const t1 = m.team1.filter(id => ps[id]);
      const t2 = m.team2.filter(id => ps[id]);
      if (t1.length === 0 || t2.length === 0) continue;

      // σ derivado del snapshot de partidos al inicio de la jornada
      const sigFor = id => sigmaFromMatches(matchSnap[id] !== undefined ? matchSnap[id] : ps[id].matches);

      // μ de equipo usando valores al INICIO de la jornada (no los acumulados)
      const muTeam1 = t1.reduce((s, id) => s + (muSnap[id] !== undefined ? muSnap[id] : ps[id].mu), 0);
      const muTeam2 = t2.reduce((s, id) => s + (muSnap[id] !== undefined ? muSnap[id] : ps[id].mu), 0);
      const sigSqTeam1 = t1.reduce((s, id) => { const sg = sigFor(id); return s + sg * sg; }, 0);
      const sigSqTeam2 = t2.reduce((s, id) => { const sg = sigFor(id); return s + sg * sg; }, 0);

      // c² = σ²_team1 + σ²_team2 + 2β²
      const cSq = sigSqTeam1 + sigSqTeam2 + 2 * TS.BETA * TS.BETA;
      const c = Math.sqrt(cSq);

      const t1w = m.score1 > m.score2, t2w = m.score2 > m.score1;
      const isDraw = m.score1 === m.score2;

      // Factor de margen de victoria
      const scoreDiff = Math.abs(m.score1 - m.score2);
      const marginFactor = 1 + 0.15 * Math.log(scoreDiff + 1);

      if (!isDraw) {
        const muW = t1w ? muTeam1 : muTeam2;
        const muL = t1w ? muTeam2 : muTeam1;
        const tVal = (muW - muL) / c;

        const v = tsVFunction(tVal);

        const winners = t1w ? t1 : t2;
        const losers  = t1w ? t2 : t1;

        // Acumular deltas — NO modificar ps[id].mu todavía
        for (const id of winners) {
          const sigSq = sigFor(id) * sigFor(id);
          if (deltaMu[id] === undefined) deltaMu[id] = 0;
          deltaMu[id] += (sigSq / c) * v * marginFactor;
        }
        for (const id of losers) {
          const sigSq = sigFor(id) * sigFor(id);
          if (deltaMu[id] === undefined) deltaMu[id] = 0;
          deltaMu[id] -= (sigSq / c) * v * marginFactor;
        }
      }
      // En empate no actualizamos (en pádel prácticamente no ocurre)

      // Stats de partidos/victorias/games (se acumulan durante la jornada, OK)
      for (const id of m.team1) {
        if (ps[id]) { ps[id].matches++; if (t1w) ps[id].wins++; ps[id].games += m.score1; }
      }
      for (const id of m.team2) {
        if (ps[id]) { ps[id].matches++; if (t2w) ps[id].wins++; ps[id].games += m.score2; }
      }

      const proc = (team, won) => {
        const [a, b] = [...team].sort(); const key = a + '_' + b;
        if (!pairs[key]) { const pa = playerById(a), pb = playerById(b); pairs[key] = { ids: [a, b], wins: 0, total: 0, names: [pa?.name || '?', pb?.name || '?'].join(' & ') }; }
        pairs[key].total++; if (won) pairs[key].wins++;
      };
      proc(m.team1, t1w); proc(m.team2, t2w);
    }

    // ── Aplicar todos los Δμ de la jornada de una sola vez ───────────────────
    // Solo aquí se actualiza ps[id].mu. Cada partido contribuyó con su delta
    // calculado desde el mismo punto de partida (muSnap), sin interferencias.
    Object.keys(ps).forEach(id => {
      ps[id].mu = (muSnap[id] !== undefined ? muSnap[id] : ps[id].mu) + (deltaMu[id] || 0);
      ps[id].eloHistory.push({ date: session.date, elo: tsScaleToDisplay(ps[id].mu) });
    });
  }

  const ids = [...new Set([...state.players.map(p => p.id), ...Object.keys(ps)])];
  const row = id => {
    const p = playerById(id);
    const s = ps[id] || { wins: 0, matches: 0, games: 0, sessions: 0, mu: TS.MU0, sigma: TS.SIGMA0, eloHistory: [] };
    let createdAt = 0;
    if (id && id.length > 5) { const ts = parseInt(id.slice(0, -5), 36); if (!isNaN(ts) && ts > 1600000000000) createdAt = ts - 86400000; }
    let possible = 0; for (const j of history) { if (new Date(j.date).getTime() >= createdAt) possible++; }

    // Penalización por asistencia: rating = μ + (k/N - 1) · σ
    const k = s.sessions;
    const N = totalSessions > 0 ? totalSessions : 1;
    const attendanceRatio = k / N; // 0..1
    // σ siempre se deriva de partidos propios (no acumulado cross-player)
    const finalSigma = sigmaFromMatches(s.matches);
    const muAdjusted = s.mu + (attendanceRatio - 1) * finalSigma;
    const elo = tsScaleToDisplay(muAdjusted);
    const eloPure = tsScaleToDisplay(s.mu); // Sin penalización, para info
    const penalty = Math.round(elo - eloPure); // Negativo si falta asistencia

    return { id, name: p?.name || '(Eliminado)', color: p?.color || '#888', possible, eloHistory: s.eloHistory || [], elo, eloPure, mu: s.mu, sigma: finalSigma, penalty, attendanceRatio, ...s };
  };

  return {
    ranking: ids.map(row).filter(r => r.sessions > 0).sort((a, b) => b.elo - a.elo),
    gamesRanking: ids.map(row).filter(r => r.sessions > 0).sort((a, b) => b.games - a.games),
    attendance: ids.map(row).filter(r => r.sessions > 0).sort((a, b) => { const pctA = a.possible > 0 ? a.sessions / a.possible : 0; const pctB = b.possible > 0 ? b.sessions / b.possible : 0; return pctB - pctA || b.sessions - a.sessions; }),
    pairs: Object.values(pairs).sort((a, b) => { const rA = a.total > 0 ? a.wins / a.total : 0; const rB = b.total > 0 ? b.wins / b.total : 0; return rB - rA || b.total - a.total; }),
  };
}

function getEloRankInfo(elo) {
  if (elo >= 1200) return { badge: 'Diamante 💎', color: 'var(--cyan)', bg: 'rgba(6, 182, 212, 0.1)' };
  if (elo >= 1000) return { badge: 'Oro 🏆', color: 'var(--amber)', bg: 'rgba(245, 158, 11, 0.1)' };
  if (elo >= 900) return { badge: 'Plata 🥈', color: 'var(--text-primary)', bg: 'rgba(148, 163, 184, 0.1)' };
  if (elo >= 800) return { badge: 'Bronce 🥉', color: 'var(--orange)', bg: 'rgba(249, 115, 22, 0.1)' };
  return { badge: 'Hierro ⛓️', color: 'var(--text-muted)', bg: 'var(--bg-input)' };
}

// ═══ ROTATION ALGORITHM ════════════════════════════════════════════════
function generateNextMatch(attendees, played, rankings = {}) {
  const pc = {}, partC = {}, rivC = {};
  for (const id of attendees) pc[id] = 0;
  for (const m of played) {
    if (!m.skipped) {
      for (const id of [...m.team1, ...m.team2]) pc[id] = (pc[id] || 0) + 1;
    }
    for (const t of [m.team1, m.team2]) { const k = [...t].sort().join('_'); partC[k] = (partC[k] || 0) + 1; }
    for (const a of m.team1) for (const b of m.team2) { const k = [a, b].sort().join('_'); rivC[k] = (rivC[k] || 0) + 1; }
  }
  let best = Infinity, match = null;
  for (const g of combinations(attendees, 4)) {
    const rest = attendees.filter(id => !g.includes(id));
    const maxRest = rest.length > 0 ? Math.max(...rest.map(id => pc[id] || 0)) : 0;
    for (const [t1, t2] of getTeamSplits(g)) {
      let score = 0; const gpc = g.map(id => pc[id] || 0);
      if (rest.length > 0 && maxRest < Math.min(...gpc)) score += 1000 * (Math.min(...gpc) - maxRest);
      score += gpc.reduce((s, c) => s + c, 0) * 2;
      score += (partC[[...t1].sort().join('_')] || 0) * 40 + (partC[[...t2].sort().join('_')] || 0) * 40;
      for (const a of t1) for (const b of t2) score += (rivC[[a, b].sort().join('_')] || 0) * 15;
      
      // ELO balance calculation
      const mu1 = t1.reduce((s, id) => s + (rankings[id]?.mu || 25), 0);
      const mu2 = t2.reduce((s, id) => s + (rankings[id]?.mu || 25), 0);
      const diff = Math.abs(mu1 - mu2);
      
      // Penalizamos desbalance (ej: diff=5 pts de mu suma 25 al score)
      score += diff * 5;

      if (score < best) { best = score; match = { id: uid(), team1: t1, team2: t2 }; }
    }
  }
  return match;
}

function combinations(arr, k) {
  if (k === 0) return [[]]; if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combinations(rest, k - 1).map(c => [first, ...c]), ...combinations(rest, k)];
}
function getTeamSplits([a, b, c, d]) { return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]]; }

// ═══ BOOT ══════════════════════════════════════════════════════════════
async function boot() {
  await new Promise(r => setTimeout(r, 1200));
  const splash = document.getElementById('splash'); splash.classList.add('fade-out');
  await new Promise(r => setTimeout(r, 500));
  splash.style.display = 'none';
  document.getElementById('main-app').classList.remove('hidden');
  showLoading('Conectando base de datos…');
  await loadState();
  hideLoading();
  renderPage();
}

document.addEventListener('DOMContentLoaded', boot);
window.addEventListener('online', () => { setSyncStatus('idle'); showToast('🟢 Conexión restaurada'); });
window.addEventListener('offline', () => { setSyncStatus('offline'); showToast('📵 Sin conexión — modo local'); });
