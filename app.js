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
    return {
      id: String(j.id), id_torneo: String(j.id_torneo || 'torneo_inicial'), date: String(j.fecha), gamesFormat: parseInt(j.games_format) || 4,
      attendees: att.map(String),
      matches: partidos.filter(p => String(p.id_jornada) === String(j.id)).map(p => ({
        id: String(p.id), team1: [String(p.team1_p1), String(p.team1_p2)], team2: [String(p.team2_p1), String(p.team2_p2)],
        score1: parseInt(p.score1) || 0, score2: parseInt(p.score2) || 0,
        skipped: p.skipped === true || String(p.skipped).toUpperCase() === 'TRUE',
        matchIndex: parseInt(p.match_index) || 0,
      })),
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
    <button class="btn btn-ghost btn-full" style="justify-content:flex-start; text-align:left; font-weight:${t.id === state.activeTorneo ? '800' : '500'}; color:${t.id === state.activeTorneo ? 'var(--accent)' : 'inherit'}" onclick="changeTorneo('${t.id}')">
      ${t.id === state.activeTorneo ? '✓ ' : ''}${escHtml(t.name)}
    </button>
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
        <strong style="color:var(--text-primary); font-size:0.95rem;">🏅 Ranking ELO</strong><br>
        Las estadísticas ahora usan un sistema de Elo competitivo (como en ajedrez). Comienzas en 1000 puntos y subes o bajas dependiendo de contra quién ganes o pierdas, y <em>también afecta la diferencia de games</em>.
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
  // Banner 1: New Session Action
  c.innerHTML += `
    <div class="card" style="background: linear-gradient(135deg, var(--accent), var(--accent-dim)); border:none; padding: 24px 20px; text-align: center; color: white; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: 0 10px 25px rgba(59,130,246,0.25);">
      <div style="font-size: 2.8rem; line-height: 1;">🎾</div>
      <div>
        <h2 style="font-size: 1.4rem; font-weight: 900; margin-bottom: 4px;">Nueva Jornada</h2>
        <p style="font-size: 0.85rem; color: rgba(255,255,255,0.85); line-height: 1.4;">Elige a los jugadores de hoy y el motor armará los cruces.</p>
      </div>
      <button class="btn" onclick="startSetupFlow()" style="background: white; color: var(--accent-dim); width: 100%; max-width: 240px; margin-top: 8px; border-radius: 999px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">⚡ Iniciar ahora</button>
    </div>

    <div class="card" style="margin-top: 16px; padding: 16px; text-align: center; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
      <div style="font-size: 1.5rem; margin-bottom: 8px;">🏅</div>
      <p style="font-size: 0.9rem; font-weight: 600; color: var(--amber);">Mencion honorífica a Meme que devolvió un saque dificil y no le correspondía - 25/04/2026</p>
    </div>
  `;

  const history = getActiveHistory();
  if (history.length > 0) {
    // Mini-Ranking (Top 3)
    const stats = computeGlobalStats();
    const top3 = stats.ranking.slice(0, 3);

    if (top3.length > 0 && top3[0].matches > 0) {
      c.innerHTML += `
        <div style="margin-top: 10px;">
          <p class="section-title">🔥 Mejores Rachas</p>
          <div class="card" style="display:flex; justify-content:space-around; align-items:flex-end; padding: 24px 16px 20px;">
            ${top3[1] ? renderPodium(top3[1], 2, 'silver', '60px') : '<div style="flex:1"></div>'}
            ${renderPodium(top3[0], 1, 'gold', '85px')}
            ${top3[2] ? renderPodium(top3[2], 3, 'bronze', '45px') : '<div style="flex:1"></div>'}
          </div>
        </div>
      `;
    }

    // Ultima Jornada
    const last = history[history.length - 1];
    const date = new Date(last.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const names = last.attendees.map(id => playerById(id)?.name || '?').join(', ');
    c.innerHTML += `<div style="margin-top: 10px;"><p class="section-title">⏱ Última Jornada</p><div class="card" onclick="openJornadaDetails('${last.id}')" style="cursor:pointer; transition: all 0.2s;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><div style="font-size:0.85rem;font-weight:700;text-transform:capitalize">${date}</div><div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${last.matches.length} partidos · ${last.attendees.length} jugadores</div><div style="font-size:0.78rem;color:var(--text-secondary);margin-top:5px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${names}</div></div><span class="badge badge-blue">👁 Ver</span></div></div></div>`;
  }
}

function renderPodium(player, position, medalClass, height) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const bg = { gold: 'linear-gradient(180deg, #fbbf24, #b45309)', silver: 'linear-gradient(180deg, #94a3b8, #475569)', bronze: 'linear-gradient(180deg, #cd7f32, #78350f)' };

  return `
    <div style="display:flex; flex-direction:column; align-items:center; flex:1;">
      <div class="stat-avatar" style="background:${player.color}; border:2px solid var(--bg-card); z-index:2; margin-bottom:-10px;">${initials(player.name)}</div>
      <div style="background: ${bg[medalClass]}; width: 100%; max-width: 58px; height: ${height}; border-radius: 8px 8px 0 0; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding-top:12px; position:relative; box-shadow: inset 0 2px 5px rgba(255,255,255,0.2);">
        <span style="font-size:1.15rem; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));">${medals[position]}</span>
        <span style="font-weight:900; color:white; font-size:0.75rem; margin-top:4px;">${Math.round(player.elo)} ELO</span>
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
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px">Selecciona entre 4 y 8 jugadores</p>
    <div id="attendance-list" class="gap-8" style="margin-bottom:16px">
      ${state.players.map(p => `<div class="check-item" id="chk-${p.id}" onclick="toggleAttendee('${p.id}')"><div class="check-box" id="chkbox-${p.id}"></div><div class="player-avatar" style="background:${p.color}">${initials(p.name)}</div><span class="check-name">${escHtml(p.name)}</span></div>`).join('')}
    </div>
    <div id="attend-msg" style="font-size:0.82rem;color:var(--amber);margin-bottom:10px;min-height:18px"></div>
    <button class="btn btn-primary btn-full" onclick="proceedToConfig()" id="btn-proceed-config" disabled style="opacity:0.5">⚙️ Configurar Formato</button>`);
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
  else if (n > 8) { msg.style.color = 'var(--red)'; msg.textContent = 'Máximo 8 jugadores'; btn.disabled = true; btn.style.opacity = '0.5'; }
  else { msg.style.color = 'var(--green)'; msg.textContent = `✓ ${n} jugadores seleccionados`; btn.disabled = false; btn.style.opacity = '1'; }
}

function proceedToConfig() {
  const attendees = [...window._attendees]; if (attendees.length < 4 || attendees.length > 8) return;
  const defMatches = attendees.length > 4 ? attendees.length : 3;
  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">⚙️ Formato de Jornada</p>
    <div class="gap-12">
      <div class="input-group">
        <label class="input-label">Games por partido: <strong id="games-val" style="color:var(--accent)">4</strong></label>
        <input type="range" id="games-range" min="2" max="13" value="4" step="1" oninput="updateGamesRange(this.value)" style="margin-top:8px"/>
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-top:4px"><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span><span>13</span></div>
      </div>
      <div class="input-group">
        <label class="input-label">Total de partidos a jugar: <strong id="matches-val" style="color:var(--accent)">${defMatches}</strong></label>
        <input type="range" id="matches-range" min="1" max="15" value="${defMatches}" step="1" oninput="updateMatchesRange(this.value)" style="margin-top:8px"/>
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-top:4px"><span>1</span><span>5</span><span>10</span><span>15</span></div>
      </div>
      <div class="card" style="background:rgba(59,130,246,0.06);border-color:rgba(59,130,246,0.2)">
        <p style="font-size:0.82rem;color:var(--text-secondary)">🔄 El motor rotará a los <strong style="color:var(--text-primary)">${attendees.length} jugadores</strong> para maximizar equidad.</p>
      </div>
      <button class="btn btn-green btn-full" onclick="previewFixture(${JSON.stringify(attendees).replace(/"/g, "'")})">⚙️ Generar Fixture</button>
    </div>`);
  setTimeout(() => { updateGamesRange(4); updateMatchesRange(defMatches); }, 50);
}

function updateGamesRange(val) {
  const v = parseInt(val); const el = document.getElementById('games-val'); if (el) el.textContent = v;
  const r = document.getElementById('games-range'); if (r) { const pct = ((v - 2) / (13 - 2)) * 100; r.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--border) ${pct}%)`; }
}
function updateMatchesRange(val) {
  const v = parseInt(val); const el = document.getElementById('matches-val'); if (el) el.textContent = v;
  const r = document.getElementById('matches-range'); if (r) { const pct = ((v - 1) / (15 - 1)) * 100; r.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--border) ${pct}%)`; }
}

function previewFixture(attendees) {
  const fmt = parseInt(document.getElementById('games-range')?.value) || 4;
  const count = parseInt(document.getElementById('matches-range')?.value) || 3;
  
  // Randomize start to add variety to first match
  const sh = [...attendees].sort(() => Math.random() - 0.5);
  
  let fixture = [];
  for (let i = 0; i < count; i++) {
    const next = generateNextMatch(sh, fixture);
    next.matchIndex = i + 1;
    next.score1 = 0; next.score2 = 0; next.skipped = false;
    fixture.push(next);
  }
  
  window._tempFixture = fixture;
  window._tempFmt = fmt;
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
        <div style="font-size:0.75rem; color:var(--accent); font-weight:700; margin-bottom:6px;">Partido ${i+1}</div>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight:600;">
          <div style="flex:1; text-align:right;">${escHtml(t1p1)} <br> ${escHtml(t1p2)}</div>
          <div style="margin:0 12px; color:var(--text-muted); display:flex; align-items:center;">vs</div>
          <div style="flex:1; text-align:left;">${escHtml(t2p1)} <br> ${escHtml(t2p2)}</div>
        </div>
        <div style="display:flex; justify-content:center; margin-top:8px;">
          <button class="btn btn-ghost btn-sm" onclick="shuffleMatch(${i})" style="font-size:0.7rem; padding:4px 8px;">🔀 Re-armar cruce</button>
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
      <button class="btn btn-ghost btn-full" onclick="proceedToConfig()">Volver atrás</button>
    </div>
  `);
}

function shuffleMatch(idx) {
  const fixture = window._tempFixture;
  const m = fixture[idx];
  const pool = [...m.team1, ...m.team2].sort(() => Math.random() - 0.5);
  m.team1 = [pool[0], pool[1]];
  m.team2 = [pool[2], pool[3]];
  renderFixturePreview();
}

function launchSession() {
  const fixture = window._tempFixture;
  const fmt = window._tempFmt;
  const attendees = window._tempAtt;
  
  state.session = { 
    id: uid(), 
    date: new Date().toISOString(), 
    attendees, 
    gamesFormat: fmt, 
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
  const m = s.currentMatch; window._score1 = 0; window._score2 = 0;
  const t1p1 = playerById(m.team1[0])?.name, t1p2 = playerById(m.team1[1])?.name, t2p1 = playerById(m.team2[0])?.name, t2p2 = playerById(m.team2[1])?.name;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><p class="section-title" style="margin:0">Jornada Activa</p><span class="badge badge-amber">Partido ${s.matchIndex}</span></div>`;

  html += `
  <div class="card" style="padding:20px 16px; margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
      <div style="flex:1;text-align:center">
        <div class="score-team">${escHtml(t1p1)}<br>& ${escHtml(t1p2)}</div>
        <div class="score-num" style="display:flex;align-items:center;justify-content:center;gap:6px; margin-top:12px;">
          <button class="btn btn-icon btn-ghost" onclick="changeScore(1,-1)" style="width:32px;height:32px;font-size:1.3rem; background:var(--bg-input)">−</button>
          <div id="score1" style="font-size:2.8rem;font-weight:900;width:40px;line-height:1;color:var(--text-primary)">0</div>
          <button class="btn btn-icon btn-ghost" onclick="changeScore(1,1)" style="width:32px;height:32px;font-size:1.3rem;color:var(--green); background:var(--bg-input)">+</button>
        </div>
      </div>
      <div class="score-vs" style="margin:0 4px; opacity:0.5; font-size:0.8rem;">VS</div>
      <div style="flex:1;text-align:center">
        <div class="score-team">${escHtml(t2p1)}<br>& ${escHtml(t2p2)}</div>
        <div class="score-num" style="display:flex;align-items:center;justify-content:center;gap:6px; margin-top:12px;">
          <button class="btn btn-icon btn-ghost" onclick="changeScore(2,-1)" style="width:32px;height:32px;font-size:1.3rem; background:var(--bg-input)">−</button>
          <div id="score2" style="font-size:2.8rem;font-weight:900;width:40px;line-height:1;color:var(--text-primary)">0</div>
          <button class="btn btn-icon btn-ghost" onclick="changeScore(2,1)" style="width:32px;height:32px;font-size:1.3rem;color:var(--green); background:var(--bg-input)">+</button>
        </div>
      </div>
    </div>
    
    <div class="gap-8">
      <button class="btn btn-green btn-full" id="btn-save-match" onclick="saveMatchResult()" style="padding:14px; font-size:1rem; box-shadow:0 4px 12px rgba(16,185,129,0.25);">✅ Siguiente Partido</button>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-full" onclick="skipMatch()" style="font-size:0.85rem">⏭ Saltar (banco)</button>
        <button class="btn btn-ghost btn-full" onclick="promptFinishSession()" style="font-size:0.85rem;color:var(--amber)">🏁 Terminar</button>
      </div>
    </div>
  </div>`;

  html += renderPlayCountBar(s);

  const playedMatches = s.matches.filter(mx => !mx.skipped);
  if (playedMatches.length > 0) {
    const rh = playedMatches.slice(-3).reverse().map(mx => {
      const won1 = mx.score1 > mx.score2;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.8rem">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span style="${won1 ? 'font-weight:800;color:var(--text-primary)' : 'color:var(--text-secondary)'}">${playerById(mx.team1[0])?.name} & ${playerById(mx.team1[1])?.name}</span> 
          <span style="${!won1 ? 'font-weight:800;color:var(--text-primary)' : 'color:var(--text-secondary)'}">${playerById(mx.team2[0])?.name} & ${playerById(mx.team2[1])?.name}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="font-weight:900; font-size:1.1rem; background:var(--bg-input); padding:4px 10px; border-radius:6px; letter-spacing:2px; color:var(--accent-bright)">${mx.score1}-${mx.score2}</div>
          <button class="btn btn-icon btn-ghost btn-sm" onclick="editActiveMatchScore('${mx.id}')" style="font-size:0.9rem; margin-left:4px;">✏️</button>
        </div>
      </div>`;
    }).join('');
    html += `<div class="card" style="margin-top:16px; padding:16px;"><p class="section-title" style="margin-bottom:12px; font-size:0.8rem;">⏱ Últimos Resultados</p>${rh}</div>`;
  }

  if (s.fixture && s.fixture.length > s.matchIndex) {
    const upcoming = s.fixture.slice(s.matchIndex, s.matchIndex + 3);
    const uh = upcoming.map((m, i) => {
      const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
      const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.8rem">
        <div style="font-weight:700; color:var(--accent); min-width:30px;">#${m.matchIndex}</div>
        <div style="flex:1; text-align:right;">${escHtml(t1p1)}<br>${escHtml(t1p2)}</div>
        <div style="margin:0 10px; font-size:0.7rem; color:var(--text-muted)">vs</div>
        <div style="flex:1; text-align:left;">${escHtml(t2p1)}<br>${escHtml(t2p2)}</div>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openUpcomingMatchEditor(${m.matchIndex - 1})" title="Editar cruce">✏️</button>
      </div>`;
    }).join('');
    
    html += `<div class="card" style="margin-top:16px; padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <p class="section-title" style="margin:0; font-size:0.8rem;">📅 Próximos Partidos</p>
        <span class="badge badge-blue" style="font-size:0.65rem">${s.fixture.length - s.matchIndex} restantes</span>
      </div>
      ${uh}
    </div>`;
  }

  c.innerHTML = html;
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

function updateUpcomingPreview() {}

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

function changeScore(team, delta) {
  const maxScore = state.session?.gamesFormat || 99;
  let s1 = window._score1 || 0;
  let s2 = window._score2 || 0;
  if (team === 1) {
    const n = s1 + delta; if (n >= 0 && n + s2 <= maxScore) s1 = n;
  } else {
    const n = s2 + delta; if (n >= 0 && s1 + n <= maxScore) s2 = n;
  }
  window._score1 = s1; window._score2 = s2;
  const e1 = document.getElementById('score1'); if (e1) e1.textContent = s1;
  const e2 = document.getElementById('score2'); if (e2) e2.textContent = s2;
}

async function saveMatchResult() {
  const s1 = window._score1 || 0, s2 = window._score2 || 0;
  if (s1 === 0 && s2 === 0) { showToast('⚠️ Ingresa al menos un resultado'); return; }
  const s = state.session; const m = s.currentMatch;
  const btn = document.getElementById('btn-save-match');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Procesando…'; }
  const partido = { id: uid(), id_jornada: s.id, team1_p1: m.team1[0], team1_p2: m.team1[1], team2_p1: m.team2[0], team2_p2: m.team2[1], score1: s1, score2: s2, skipped: false, match_index: s.matchIndex, team1: m.team1, team2: m.team2 };
  
  s.matches.push(partido); 
  
  // Update Fixture progression
  s.fixture = s.fixture || [];
  if (s.fixture.length > s.matchIndex) {
    s.currentMatch = s.fixture[s.matchIndex];
  } else {
    // Si se pasan de la cantidad generada, generamos uno on the fly
    s.currentMatch = generateNextMatch(s.attendees, s.matches);
    s.currentMatch.matchIndex = s.matchIndex + 1;
  }
  s.matchIndex++;
  
  CACHE.set(CK.SESSION, s);
  withSync(() => API.savePartido(partido)); // fire-and-forget
  renderPage(); showToast('✅ Partido guardado. ¡Al siguiente!');
}

function skipMatch() {
  const s = state.session; const m = s.currentMatch;
  const partido = { id: uid(), id_jornada: s.id, team1_p1: m.team1[0], team1_p2: m.team1[1], team2_p1: m.team2[0], team2_p2: m.team2[1], score1: 0, score2: 0, skipped: true, match_index: s.matchIndex, team1: m.team1, team2: m.team2 };
  s.matches.push(partido); 
  
  s.fixture = s.fixture || [];
  if (s.fixture.length > s.matchIndex) {
    s.currentMatch = s.fixture[s.matchIndex];
  } else {
    s.currentMatch = generateNextMatch(s.attendees, s.matches);
    s.currentMatch.matchIndex = s.matchIndex + 1;
  }
  s.matchIndex++;
  
  CACHE.set(CK.SESSION, s);
  renderPage(); showToast('⏭ Partido saltado');
}

function editActiveMatchScore(mId) {
  const s = state.session; if (!s) return;
  const m = s.matches.find(x => x.id === mId); if (!m) return;

  const t1p1 = playerById(m.team1[0])?.name || '?', t1p2 = playerById(m.team1[1])?.name || '?';
  const t2p1 = playerById(m.team2[0])?.name || '?', t2p2 = playerById(m.team2[1])?.name || '?';

  openModal(`
    <div class="modal-handle"></div>
    <p class="modal-title">✏️ Modificar Resultado</p>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:24px">Corrigiendo el partido de la jornada activa.</p>
    
    <div class="score-row" style="margin-bottom:30px">
      <div>
        <div class="score-team" style="margin-bottom:12px">${escHtml(t1p1)}<br>& ${escHtml(t1p2)}</div>
        <div class="score-num">
          <input type="number" id="edit-active-score1" class="input" style="width:70px;text-align:center;font-size:1.6rem;font-weight:900" value="${m.score1}" min="0" max="${s.gamesFormat || 99}">
        </div>
      </div>
      <div class="score-vs" style="margin-top:20px">VS</div>
      <div>
        <div class="score-team" style="margin-bottom:12px">${escHtml(t2p1)}<br>& ${escHtml(t2p2)}</div>
        <div class="score-num">
          <input type="number" id="edit-active-score2" class="input" style="width:70px;text-align:center;font-size:1.6rem;font-weight:900" value="${m.score2}" min="0" max="${s.gamesFormat || 99}">
        </div>
      </div>
    </div>
    
    <div class="gap-8">
      <button class="btn btn-primary btn-full" id="btn-save-active-edit" onclick="saveActiveMatchScore('${mId}')">✓ Guardar Cambios</button>
      <button class="btn btn-ghost btn-full" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveActiveMatchScore(mId) {
  const s1 = parseInt(document.getElementById('edit-active-score1').value) || 0;
  const s2 = parseInt(document.getElementById('edit-active-score2').value) || 0;

  const s = state.session; if (!s) return;
  const m = s.matches.find(x => x.id === mId); if (!m) return;

  const btn = document.getElementById('btn-save-active-edit'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Guardando…'; }

  const updatedMatch = { ...m, score1: s1, score2: s2 };

  m.score1 = s1; m.score2 = s2;
  CACHE.set(CK.SESSION, s);
  
  withSync(() => API.savePartido(updatedMatch));
  
  closeModal();
  renderPage();
  showToast('✅ Partido actualizado');
}

function promptFinishSession() {
  openModal(`<div class="modal-handle"></div><p class="modal-title">🏁 ¿Terminar la jornada?</p><p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:20px">Se registrarán ${state.session.matches.length} partidos en el archivo histórico.</p><div class="gap-8"><button class="btn btn-amber btn-full" id="btn-confirm-finish" onclick="finishSession()">🏆 Sí, terminar</button><button class="btn btn-ghost btn-full" onclick="closeModal()">Seguir jugando</button></div>`);
}

async function finishSession() {
  const btn = document.getElementById('btn-confirm-finish');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Finalizando…'; }
  const s = state.session;
  setSyncStatus('syncing');
  try { await API.saveJornada({ id: s.id, id_torneo: state.activeTorneo, fecha: s.date, games_format: s.gamesFormat, attendees: s.attendees, finished: true }); setSyncStatus('idle'); }
  catch (err) { setSyncStatus('error'); showToast('⚠️ Error al guardar: ' + err.message, 4000); }
  state.history.push({ id: s.id, id_torneo: state.activeTorneo || 'torneo_inicial', date: s.date, gamesFormat: s.gamesFormat, attendees: s.attendees, matches: s.matches });
  CACHE.set(CK.HISTORY, state.history);
  s.finished = true; CACHE.set(CK.SESSION, s);
  closeModal(); renderPage(); showToast('🏆 ¡Jornada terminada!');
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

  const playersData = s.attendees.map(id => ({ id, p: playerById(id), ...ps[id] }));
  const rankWins = [...playersData].sort((a, b) => b.wins - a.wins || b.games - a.games);
  const maxWins = Math.max(...playersData.map(x => x.wins), 1);
  const rankGames = [...playersData].sort((a, b) => b.games - a.games || b.wins - a.wins);
  const bestPairs = Object.values(pairs).sort((a, b) => b.wins - a.wins || b.games - a.games).slice(0, 2);

  const mvp = rankWins[0];

  const htmlWins = rankWins.map((r, i) => `<div class="stat-row" style="padding: 10px 0; border-bottom: 1px dashed var(--border);"><div class="stat-avatar" style="background:${r.p?.color}; width:32px; height:32px; font-size:0.75rem;">${initials(r.p?.name)}</div><div style="flex:1;min-width:0; margin-left:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span class="stat-name" style="font-size:0.9rem;">${escHtml(r.p?.name)}</span><span style="font-weight:900; color:var(--accent-bright); font-size:0.9rem;">${r.wins} v</span></div><div class="stat-bar-wrap" style="height:6px; max-width:100%"><div class="stat-bar" style="width:${Math.round((r.wins / maxWins) * 100)}%;background:linear-gradient(90deg,var(--accent),var(--cyan))"></div></div></div></div>`).join('');

  const htmlGames = rankGames.slice(0, 3).map((r, i) => `<div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0;"><div style="display:flex; align-items:center; gap:8px;"><span class="stat-pos ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}" style="font-size:0.85rem; min-width:16px;">${i + 1}</span><span style="font-size:0.85rem; font-weight:600; color:var(--text-primary);">${escHtml(r.p?.name)}</span></div><div><span style="font-weight:900; color:var(--green); font-size:1rem;">${r.games}</span> <span style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">GAMES</span></div></div>`).join('');

  const pairsHtml = bestPairs.length > 0 ? `<p class="section-title" style="margin-top:24px;margin-bottom:12px">👥 Mejores Parejas</p>` + bestPairs.map(pair => `<div class="pair-card" style="margin-bottom:8px; padding:12px;"><div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); margin-bottom:6px;">${escHtml(pair.names)}</div><div style="display:flex; gap:16px; font-size:0.8rem; color:var(--text-secondary);"><div>Victorias: <strong style="color:var(--text-primary)">${pair.wins}</strong></div><div>Games ganados: <strong style="color:var(--text-primary)">${pair.games}</strong></div></div></div>`).join('') : '';

  c.innerHTML = `
    <div class="end-card" style="margin-bottom:20px;">
      <div class="end-icon">🏆</div>
      <div class="end-title">¡Jornada Terminada!</div>
      <div class="end-sub">${s.matches.length} partidos · ${s.attendees.length} jugadores</div>
      ${mvp ? `<div class="badge badge-amber" style="margin:0 auto;font-size:0.85rem;padding:6px 16px; box-shadow:0 4px 12px rgba(245,158,11,0.2)">👑 MVP: ${escHtml(mvp.p?.name)} (${mvp.wins}v)</div>` : ''}
    </div>
    
    <div class="card" style="margin-bottom:20px; padding:20px 16px;">
      <p class="section-title" style="margin-bottom:12px">📊 Ranking de Victorias</p>
      <div>${htmlWins}</div>
      
      <p class="section-title" style="margin-top:28px; margin-bottom:12px">🎾 Top Games Ganados</p>
      <div style="background: rgba(16,185,129,0.04); border: 1px solid rgba(16,185,129,0.15); border-radius: var(--radius-sm); padding:12px;">
        ${htmlGames}
      </div>
      
      ${pairsHtml}
    </div>
    
    <div class="gap-8">
      <button class="btn btn-primary btn-full" onclick="clearSession();startSetupFlow()">⚡ Nueva Jornada</button>
      <button class="btn btn-ghost btn-full" onclick="clearSession()" style="font-size:0.85rem">Volver al Inicio</button>
    </div>`;
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
function renderHistoryPage(page) {
  const c = document.createElement('div'); c.className = 'page-padding gap-12';
  const history = getActiveHistory();
  if (history.length === 0) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓</div><div class="empty-title">Sin jornadas jugadas</div><div class="empty-sub">El historial de fechas y resultados aparecerá aquí.</div></div>`;
  } else {
    const list = history.slice().reverse().map(j => {
      const date = new Date(j.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      const names = j.attendees.map(id => playerById(id)?.name || '?').join(', ');
      return `<div class="card" onclick="openJornadaDetails('${j.id}')" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-size:0.95rem;font-weight:800;text-transform:capitalize;margin-bottom:4px;color:var(--text-primary)">${date}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">${j.matches.length} partidos · ${j.attendees.length} jugadores</div>
            <div style="font-size:0.75rem;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${names}</div>
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

  const playersData = j.attendees.map(pid => ({ pid, p: playerById(pid), ...(ps[pid] || { wins: 0, games: 0 }) }));
  const rankWins = [...playersData].sort((a, b) => b.wins - a.wins || b.games - a.games);
  const maxWins = Math.max(...rankWins.map(x => x.wins), 1);
  const mvp = rankWins[0];
  const bestPairs = Object.values(pairs).sort((a, b) => b.wins - a.wins || b.games - a.games).slice(0, 2);

  const htmlRanking = rankWins.map(r => `
    <div class="stat-row" style="padding:10px 0;border-bottom:1px dashed var(--border)">
      <div class="stat-avatar" style="background:${r.p?.color || '#888'};width:32px;height:32px;font-size:0.75rem">${initials(r.p?.name)}</div>
      <div style="flex:1;min-width:0;margin-left:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span class="stat-name" style="font-size:0.9rem">${escHtml(r.p?.name || '?')}</span>
          <span style="font-weight:900;color:var(--accent-bright);font-size:0.9rem">${r.wins} v</span>
        </div>
        <div class="stat-bar-wrap" style="height:6px;max-width:100%">
          <div class="stat-bar" style="width:${Math.round((r.wins / maxWins) * 100)}%;background:linear-gradient(90deg,var(--accent),var(--cyan))"></div>
        </div>
      </div>
    </div>`).join('');

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

    ${mvp && mvp.wins > 0 ? `
    <div style="background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.04));border:1px solid rgba(245,158,11,0.25);border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div class="stat-avatar" style="background:${mvp.p?.color || '#888'};width:44px;height:44px;font-size:1rem;flex-shrink:0">${initials(mvp.p?.name)}</div>
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">👑 MVP de la jornada</div>
        <div style="font-size:1rem;font-weight:900;color:var(--text-primary)">${escHtml(mvp.p?.name || '?')}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${mvp.wins} victorias · ${mvp.games} games</div>
      </div>
    </div>` : ''}

    <div style="max-height:55dvh;overflow-y:auto;padding-right:4px">
      <p class="section-title" style="margin-bottom:10px">📊 Ranking de la jornada</p>
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
        <div class="score-num">
          <input type="number" id="edit-score1" class="input" style="width:70px;text-align:center;font-size:1.6rem;font-weight:900" value="${m.score1}" min="0" max="${j.gamesFormat || 99}">
        </div>
      </div>
      <div class="score-vs" style="margin-top:20px">VS</div>
      <div>
        <div class="score-team" style="margin-bottom:12px">${escHtml(t2p1)}<br>& ${escHtml(t2p2)}</div>
        <div class="score-num">
          <input type="number" id="edit-score2" class="input" style="width:70px;text-align:center;font-size:1.6rem;font-weight:900" value="${m.score2}" min="0" max="${j.gamesFormat || 99}">
        </div>
      </div>
    </div>
    
    <div class="gap-8">
      <button class="btn btn-primary btn-full" id="btn-save-edit-match" onclick="saveEditedMatch('${jId}','${mId}')">✓ Guardar Cambios</button>
      <button class="btn btn-ghost btn-full" onclick="openJornadaDetails('${jId}')">Cancelar</button>
    </div>
  `);
}

async function saveEditedMatch(jId, mId) {
  const s1 = parseInt(document.getElementById('edit-score1').value) || 0;
  const s2 = parseInt(document.getElementById('edit-score2').value) || 0;

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
  c.innerHTML = `
    <div class="tab-selector"><button class="tab-opt active" onclick="switchStatTab('ranking',this)">🏆 Ranking</button><button class="tab-opt" onclick="switchStatTab('games',this)">🎾 Games</button><button class="tab-opt" onclick="switchStatTab('attend',this)">📅 Asistencia</button><button class="tab-opt" onclick="switchStatTab('pairs',this)">👥 Parejas</button></div>
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
    c.innerHTML = `<p class="section-title">🏆 Ranking Elo</p><div class="card">${stats.ranking.map((r, i) => {
      const rankInfo = getEloRankInfo(r.elo);
      return `<div class="stat-row"><div class="stat-pos ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div style="font-size:0.75rem; color:${rankInfo.color}; margin-top:4px; font-weight:700;">${rankInfo.badge} - ${Math.round(r.elo)} Pts</div></div><div style="text-align:right"><div class="stat-val" style="font-size:1.1rem">${r.wins} v</div><div class="stat-unit" style="font-size:0.75rem">en ${r.matches} pj</div></div></div>`;
    }).join('')}</div>`;
  } else if (tab === 'games') {
    const max = stats.gamesRanking[0]?.games || 1;
    c.innerHTML = `<p class="section-title">🎾 Games Ganados</p><div class="card">${stats.gamesRanking.map((r, i) => `<div class="stat-row"><div class="stat-pos ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div class="stat-bar-wrap" style="max-width:120px"><div class="stat-bar" style="width:${Math.round((r.games / max) * 100)}%;background:linear-gradient(90deg,var(--green),var(--cyan))"></div></div></div><div style="text-align:right"><div class="stat-val">${r.games}</div><div class="stat-unit">games</div></div></div>`).join('')}</div>`;
  } else if (tab === 'attend') {
    c.innerHTML = `<p class="section-title">📅 Asistencia</p><div class="card">${stats.attendance.map((r, i) => { const pct = r.possible > 0 ? Math.round((r.sessions / r.possible) * 100) : 0; return `<div class="stat-row"><div class="stat-pos">${i + 1}</div><div class="stat-avatar" style="background:${r.color}">${initials(r.name)}</div><div style="flex:1;min-width:0"><div class="stat-name">${escHtml(r.name)}</div><div class="stat-bar-wrap" style="max-width:120px"><div class="stat-bar" style="width:${pct}%;background:linear-gradient(90deg,var(--amber),var(--red))"></div></div></div><div style="text-align:right"><div class="stat-val">${r.sessions}</div><div class="stat-unit">de ${r.possible} (${pct}%)</div></div></div>`; }).join('')}</div>`;
  } else if (tab === 'pairs') {
    if (!stats.pairs.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Sin datos de parejas</div></div>'; return; }
    c.innerHTML = `<p class="section-title">👥 Mejores Parejas</p>` + stats.pairs.slice(0, 10).map((pair, i) => `<div class="pair-card"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div class="pair-names">${escHtml(pair.names)}</div>${i === 0 ? '<span class="badge badge-purple">🏆 Mejor Pareja</span>' : ''}</div><div class="pair-stats-row"><div class="pair-stat">Juntos: <strong>${pair.total}</strong></div><div class="pair-stat">Victorias: <strong>${pair.wins}</strong></div><div class="pair-stat">Win rate: <strong>${pair.total > 0 ? Math.round((pair.wins / pair.total) * 100) : 0}%</strong></div></div><div class="progress-wrap" style="margin-top:8px"><div class="progress-bar" style="width:${pair.total > 0 ? Math.round((pair.wins / pair.total) * 100) : 0}%;background:linear-gradient(90deg,var(--purple),var(--accent))"></div></div></div>`).join('');
  }
}

function getActiveHistory() {
  return state.history.filter(h => h.id_torneo === state.activeTorneo);
}

function computeGlobalStats() {
  const ps = {}, pairs = {};
  
  state.players.forEach(p => {
    ps[p.id] = { wins: 0, matches: 0, games: 0, sessions: 0, elo: 1000 };
  });

  const history = getActiveHistory().sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const session of history) {
    for (const id of session.attendees) { if (!ps[id]) ps[id] = { wins: 0, matches: 0, games: 0, sessions: 0, elo: 1000 }; ps[id].sessions++; }
    const matches = [...session.matches].sort((a, b) => a.matchIndex - b.matchIndex);
    
    for (const m of matches) {
      if (m.skipped) continue;
      
      const t1 = m.team1.filter(id => ps[id]);
      const t2 = m.team2.filter(id => ps[id]);
      if (t1.length === 0 || t2.length === 0) continue;

      const elo1 = t1.reduce((sum, id) => sum + ps[id].elo, 0) / t1.length;
      const elo2 = t2.reduce((sum, id) => sum + ps[id].elo, 0) / t2.length;

      const r1 = Math.pow(10, elo1 / 400);
      const r2 = Math.pow(10, elo2 / 400);
      const e1 = r1 / (r1 + r2);
      const e2 = r2 / (r1 + r2);

      let s1 = 0.5, s2 = 0.5;
      if (m.score1 > m.score2) { s1 = 1; s2 = 0; }
      else if (m.score2 > m.score1) { s1 = 0; s2 = 1; }

      const diff = Math.abs(m.score1 - m.score2);
      const mov = Math.log(diff + 1) + 1;
      const K = 32;

      const delta1 = K * mov * (s1 - e1);
      const delta2 = K * mov * (s2 - e2);

      const t1w = m.score1 > m.score2, t2w = m.score2 > m.score1;
      
      for (const id of m.team1) { 
        if (ps[id]) { ps[id].matches++; if (t1w) ps[id].wins++; ps[id].games += m.score1; ps[id].elo += delta1; }
      }
      for (const id of m.team2) { 
        if (ps[id]) { ps[id].matches++; if (t2w) ps[id].wins++; ps[id].games += m.score2; ps[id].elo += delta2; }
      }
      
      const proc = (team, won) => { 
        const [a, b] = [...team].sort(); const key = a + '_' + b; 
        if (!pairs[key]) { const pa = playerById(a), pb = playerById(b); pairs[key] = { wins: 0, total: 0, names: [pa?.name || '?', pb?.name || '?'].join(' & ') }; } 
        pairs[key].total++; if (won) pairs[key].wins++; 
      };
      proc(m.team1, t1w); proc(m.team2, t2w);
    }
  }
  
  const ids = [...new Set([...state.players.map(p => p.id), ...Object.keys(ps)])];
  const row = id => { 
    const p = playerById(id); 
    const s = ps[id] || { wins: 0, matches: 0, games: 0, sessions: 0, elo: 1000 }; 
    let createdAt = 0;
    if (id && id.length > 5) { const ts = parseInt(id.slice(0, -5), 36); if (!isNaN(ts) && ts > 1600000000000) createdAt = ts - 86400000; }
    let possible = 0; for (const j of history) { if (new Date(j.date).getTime() >= createdAt) possible++; }
    return { id, name: p?.name || '(Eliminado)', color: p?.color || '#888', possible, ...s }; 
  };
  
  return {
    ranking: ids.map(row).sort((a, b) => b.elo - a.elo),
    gamesRanking: ids.map(row).sort((a, b) => b.games - a.games),
    attendance: ids.map(row).sort((a, b) => { const pctA = a.possible > 0 ? a.sessions / a.possible : 0; const pctB = b.possible > 0 ? b.sessions / b.possible : 0; return pctB - pctA || b.sessions - a.sessions; }),
    pairs: Object.values(pairs).sort((a, b) => { const rA = a.total > 0 ? a.wins / a.total : 0; const rB = b.total > 0 ? b.wins / b.total : 0; return rB - rA || b.total - a.total; }),
  };
}

function getEloRankInfo(elo) {
  if (elo >= 1200) return { badge: 'Oro 🏆', color: 'var(--amber)', bg: 'rgba(245, 158, 11, 0.1)' };
  if (elo >= 1100) return { badge: 'Plata 🥈', color: 'var(--text-primary)', bg: 'rgba(148, 163, 184, 0.1)' };
  if (elo >= 1000) return { badge: 'Bronce 🥉', color: 'var(--orange)', bg: 'rgba(249, 115, 22, 0.1)' };
  return { badge: 'Hierro ⛓️', color: 'var(--text-muted)', bg: 'var(--bg-input)' };
}

// ═══ ROTATION ALGORITHM ════════════════════════════════════════════════
function generateNextMatch(attendees, played) {
  const pc = {}, partC = {}, rivC = {};
  for (const id of attendees) pc[id] = 0;
  for (const m of played) {
    // pc (play count) ignora skips → no afecta quién tiene que jugar más
    if (!m.skipped) {
      for (const id of [...m.team1, ...m.team2]) pc[id] = (pc[id] || 0) + 1;
    }
    // partC y rivC SÍ cuentan los skips → evita repetir la misma pareja/cruce skipeado
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
