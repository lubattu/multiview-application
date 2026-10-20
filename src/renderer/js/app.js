import { AUTO_RELOAD_OPTIONS, LIMITS, clampAutoReload, clampZoom, defaultConfig, normalizeConfig, twitchLoginFromUrl, kickLoginFromUrl } from '../../shared/config.js';
import { computeLayout, computeSplitters } from './layout.js';
import { makeDraggable } from './splitter.js';
import { GameSlot } from './gameslot.js';
import { renderChips as renderChipsInto } from './toolbar.js';

const LOGIN_FROM_URL = { twitch: twitchLoginFromUrl, kick: kickLoginFromUrl };
const channelsKey = (platform) => `${platform}Channels`;

const els = {
  addSlot: document.getElementById('add-slot'),
  chips: document.getElementById('chips'),
  zoom: document.getElementById('zoom-controls'),
  zoomOut: document.getElementById('zoom-out'),
  zoomIn: document.getElementById('zoom-in'),
  zoomReset: document.getElementById('zoom-reset'),
  zoomValue: document.getElementById('zoom-value'),
  modeGrid: document.getElementById('mode-grid'),
  modeFocus: document.getElementById('mode-focus'),
  autoReload: document.getElementById('auto-reload'),
  panels: document.getElementById('panels'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsPop: document.getElementById('settings-pop'),
  setKeepAwake: document.getElementById('set-keep-awake'),
  setLowQuality: document.getElementById('set-low-quality'),
  setCloseTray: document.getElementById('set-close-tray'),
};

const state = {
  config: defaultConfig(),
  gameSlots: new Map(),
  saveTimer: null,
  autoReloadTimer: null,
};

const selectedId = () => state.config.layout.focusSlotId;
const slotConfig = (id) => state.config.slots.find((s) => s.id === id);

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    window.poke.saveConfig(state.config).catch(() => {});
  }, 300);
}

function lowestFreeSlotId() {
  const used = new Set(state.config.slots.map((s) => s.id));
  for (let id = 1; id <= LIMITS.maxSlots; id++) {
    if (!used.has(id)) return id;
  }
  return null;
}

function addSlot() {
  const id = lowestFreeSlotId();
  if (id === null) return;
  state.config.slots.push({ id, name: `Conta ${id}`, zoom: 100, muted: false, twitchChannels: [], kickChannels: [] });
  state.config.layout.focusSlotId = id;
  syncSlots();
  renderAll();
  scheduleSave();
}

function closeSlot(id) {
  state.config.slots = state.config.slots.filter((s) => s.id !== id);
  if (selectedId() === id) {
    state.config.layout.focusSlotId = state.config.slots[0]?.id ?? 1;
  }
  syncSlots();
  renderAll();
  scheduleSave();
}

function selectSlot(id) {
  if (!slotConfig(id)) return;
  state.config.layout.focusSlotId = id;
  renderAll();
  scheduleSave();
}

function renameSlot(id, rawName) {
  const slot = slotConfig(id);
  if (!slot) return;
  const name = rawName.trim().slice(0, 40);
  slot.name = name || `Conta ${id}`;
  renderChips();
  scheduleSave();
}

function toggleMute(id) {
  const slot = slotConfig(id);
  if (!slot) return;
  slot.muted = !slot.muted;
  state.gameSlots.get(id)?.setMuted(slot.muted);
  renderChips();
  scheduleSave();
}

// Botões 📺/🟩: abrem/fecham o painel de stream da plataforma (login / conferência).
// As streams em segundo plano são gerenciadas pelo painel e pelos links dentro do jogo.
function togglePanel(id, platform) {
  const gameSlot = state.gameSlots.get(id);
  if (!gameSlot || !slotConfig(id)) return;
  if (gameSlot.isPanelOpen(platform)) gameSlot.closePanel();
  else gameSlot.openPanel(platform);
  renderChips();
}

function sendPanelToBackground(id) {
  const slot = slotConfig(id);
  const gameSlot = state.gameSlots.get(id);
  if (!slot || !gameSlot) return;
  const result = gameSlot.sendPanelToBackground();
  if (result?.login) {
    const key = channelsKey(result.platform);
    const list = slot[key];
    if (!list.includes(result.login) && list.length < LIMITS.maxStreams) list.push(result.login);
    scheduleSave();
  }
  renderChips();
}

function closePanel(id) {
  state.gameSlots.get(id)?.closePanel();
  renderChips();
}

function removeStream(id, platform, login) {
  const slot = slotConfig(id);
  const gameSlot = state.gameSlots.get(id);
  if (!slot || !gameSlot) return;
  gameSlot.closeStream(platform, login);
  const key = channelsKey(platform);
  slot[key] = slot[key].filter((c) => c !== login);
  renderChips();
  scheduleSave();
}

// "Fechar todas" da faixa do painel encerra as streams de segundo plano de todas
// as plataformas da aba.
function closeAllStreams(id) {
  const slot = slotConfig(id);
  const gameSlot = state.gameSlots.get(id);
  if (!slot || !gameSlot) return;
  for (const platform of ['twitch', 'kick']) {
    gameSlot.closeAllStreams(platform);
    slot[channelsKey(platform)] = [];
  }
  renderChips();
  scheduleSave();
}

// Clique no nome da pílula: traz a stream de volta ao painel visível (ex.: resgatar
// pontos na Kick). Enquanto está no painel, ela sai da lista de segundo plano —
// sendPanelToBackground a devolve quando o usuário terminar.
function showStreamInPanel(id, platform, login) {
  const slot = slotConfig(id);
  const gameSlot = state.gameSlots.get(id);
  if (!slot || !gameSlot) return;
  gameSlot.openStreamInPanel(platform, login);
  const key = channelsKey(platform);
  slot[key] = slot[key].filter((c) => c !== login);
  renderChips();
  scheduleSave();
}

// Link de canal oficial clicado dentro do jogo (roteado pelo processo principal):
// adiciona uma stream em segundo plano à aba. No primeiro uso da plataforma na aba,
// abre o painel para conferir o login antes de o usuário enviar ao segundo plano.
function openStreamFromGame(slotId, platform, url) {
  const slot = slotConfig(slotId);
  const gameSlot = state.gameSlots.get(slotId);
  if (!slot || !gameSlot) return;
  const login = LOGIN_FROM_URL[platform]?.(url);
  if (!login || gameSlot.hasStream(platform, login)) return;
  const key = channelsKey(platform);
  const firstUse = slot[key].length === 0 && gameSlot.panelPlatform !== platform;
  if (firstUse) {
    gameSlot.openPanel(platform, url);
  } else if (gameSlot.openStream(platform, login)) {
    slot[key].push(login);
    scheduleSave();
  }
  renderChips();
}

function syncSlots() {
  const configIds = new Set(state.config.slots.map((s) => s.id));
  for (const [id, gameSlot] of state.gameSlots) {
    if (!configIds.has(id)) {
      gameSlot.unmount();
      state.gameSlots.delete(id);
    }
  }
  for (const slot of state.config.slots) {
    if (!state.gameSlots.has(slot.id)) {
      const gameSlot = new GameSlot(slot, {
        onStateChange: renderChips,
        onPanelBackground: sendPanelToBackground,
        onPanelClose: closePanel,
        onStreamRemove: removeStream,
        onStreamsCloseAll: closeAllStreams,
        onStreamShow: showStreamInPanel,
      });
      els.panels.appendChild(gameSlot.root);
      state.gameSlots.set(slot.id, gameSlot);
    }
  }
}

function renderPanels() {
  const ids = state.config.slots.map((s) => s.id);
  const layout = state.config.layout;
  const rects = computeLayout(ids, layout.mode, layout.focusSlotId, layout.gridSplit, layout.focusSplit);
  for (const [id, r] of rects) {
    const el = state.gameSlots.get(id)?.root;
    if (!el) continue;
    el.style.left = `${r.x}%`;
    el.style.top = `${r.y}%`;
    el.style.width = `${r.w}%`;
    el.style.height = `${r.h}%`;
  }
}

const SPLIT_KEYS = {
  'gridSplit.v': (layout) => layout.gridSplit.v,
  'gridSplit.h': (layout) => layout.gridSplit.h,
  focusSplit: (layout) => layout.focusSplit,
};

const SET_SPLIT = {
  'gridSplit.v': (layout, v) => { layout.gridSplit.v = v; },
  'gridSplit.h': (layout, v) => { layout.gridSplit.h = v; },
  focusSplit: (layout, v) => { layout.focusSplit = v; },
};

function setSplit(key, pct) {
  const v = Math.min(LIMITS.maxSplit, Math.max(LIMITS.minSplit, pct));
  SET_SPLIT[key](state.config.layout, v);
  renderPanels();
}

function renderSplitters() {
  els.panels.querySelectorAll('.splitter').forEach((el) => el.remove());
  const layout = state.config.layout;
  const ids = state.config.slots.map((s) => s.id);
  for (const s of computeSplitters(ids, layout.mode, layout.focusSlotId, layout.gridSplit, layout.focusSplit)) {
    const el = document.createElement('div');
    el.className = `splitter splitter-${s.axis}`;
    const position = () => {
      el.style.left = `${s.axis === 'x' ? SPLIT_KEYS[s.key](layout) : 0}%`;
      el.style.top = `${s.axis === 'y' ? SPLIT_KEYS[s.key](layout) : 0}%`;
      if (s.axis === 'x') el.style.height = `${s.height}%`;
      else el.style.width = `${s.width}%`;
    };
    position();
    makeDraggable(el, {
      axis: s.axis,
      getBounds: () => els.panels.getBoundingClientRect(),
      onMove: (pct) => {
        setSplit(s.key, pct);
        position();
      },
      onEnd: scheduleSave,
    });
    els.panels.appendChild(el);
  }
}

function renderChips() {
  const chips = state.config.slots.map((s) => {
    const gameSlot = state.gameSlots.get(s.id);
    const broken = gameSlot?.brokenStreams() ?? [];
    const namesFor = (platform) => broken.filter((b) => b.platform === platform).map((b) => b.login);
    return {
      id: s.id,
      name: s.name,
      muted: s.muted,
      loading: gameSlot?.isLoading() ?? false,
      selected: s.id === selectedId(),
      twitchStreams: s.twitchChannels.length,
      kickStreams: s.kickChannels.length,
      twitchBroken: namesFor('twitch'),
      kickBroken: namesFor('kick'),
      twitchPanel: gameSlot?.isPanelOpen('twitch') ?? false,
      kickPanel: gameSlot?.isPanelOpen('kick') ?? false,
    };
  });
  renderChipsInto(els.chips, chips, {
    onSelect: selectSlot,
    onClose: closeSlot,
    onToggleMute: toggleMute,
    onReload: (id) => state.gameSlots.get(id)?.reload(),
    onRename: renameSlot,
    onToggleTwitch: (id) => togglePanel(id, 'twitch'),
    onToggleKick: (id) => togglePanel(id, 'kick'),
  });
  els.addSlot.disabled = state.config.slots.length >= LIMITS.maxSlots;
}

function renderEmptyState() {
  const existing = els.panels.querySelector('.empty-state');
  if (state.config.slots.length > 0) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const div = document.createElement('div');
  div.className = 'empty-state';
  const p = document.createElement('p');
  p.textContent = 'Nenhum slot aberto. Adicione até 4 contas.';
  const b = document.createElement('button');
  b.textContent = '+ Slot';
  b.addEventListener('click', addSlot);
  div.append(p, b);
  els.panels.appendChild(div);
}

function updateZoomControls() {
  const slot = slotConfig(selectedId());
  els.zoom.classList.toggle('hidden', !slot);
  if (!slot) return;
  els.zoomValue.textContent = `${slot.zoom}%`;
  els.zoomOut.disabled = slot.zoom <= LIMITS.minZoom;
  els.zoomIn.disabled = slot.zoom >= LIMITS.maxZoom;
}

function setSelectedZoom(pct) {
  const slot = slotConfig(selectedId());
  if (!slot) return;
  slot.zoom = clampZoom(pct);
  state.gameSlots.get(slot.id)?.setZoom(slot.zoom);
  updateZoomControls();
  scheduleSave();
}

function setMode(mode) {
  state.config.layout.mode = mode;
  els.modeGrid.classList.toggle('active', mode === 'grid');
  els.modeFocus.classList.toggle('active', mode === 'focus');
  renderAll();
  scheduleSave();
}

function reloadAllSlots() {
  for (const gameSlot of state.gameSlots.values()) {
    if (!gameSlot.isLoading()) gameSlot.reload();
  }
  armAutoReload();
}

function armAutoReload() {
  clearTimeout(state.autoReloadTimer);
  const ms = state.config.autoReloadMinutes * 60_000;
  if (ms > 0) state.autoReloadTimer = setTimeout(reloadAllSlots, ms);
}

function populateAutoReloadOptions() {
  for (const { minutes, label } of AUTO_RELOAD_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(minutes);
    opt.textContent = label;
    els.autoReload.appendChild(opt);
  }
}

function renderAll() {
  renderPanels();
  renderSplitters();
  renderChips();
  renderEmptyState();
  updateZoomControls();
}

// Propaga a preferência de qualidade mínima para os slots já abertos.
function applyLowQuality() {
  for (const gameSlot of state.gameSlots.values()) gameSlot.lowQuality = state.config.lowQuality;
}

function syncSettingsControls() {
  els.setKeepAwake.checked = state.config.keepAwake;
  els.setLowQuality.checked = state.config.lowQuality;
  els.setCloseTray.value = state.config.closeToTray;
}

function boot() {
  els.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.settingsPop.classList.toggle('hidden');
  });
  els.settingsPop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!els.settingsPop.contains(e.target) && e.target !== els.settingsBtn) {
      els.settingsPop.classList.add('hidden');
    }
  });
  els.setKeepAwake.addEventListener('change', () => {
    state.config.keepAwake = els.setKeepAwake.checked;
    scheduleSave();
  });
  els.setLowQuality.addEventListener('change', () => {
    state.config.lowQuality = els.setLowQuality.checked;
    applyLowQuality();
    scheduleSave();
  });
  els.setCloseTray.addEventListener('change', () => {
    state.config.closeToTray = els.setCloseTray.value;
    scheduleSave();
  });
  els.addSlot.addEventListener('click', addSlot);
  els.zoomOut.addEventListener('click', () => {
    const slot = slotConfig(selectedId());
    if (slot) setSelectedZoom(slot.zoom - LIMITS.zoomStep);
  });
  els.zoomIn.addEventListener('click', () => {
    const slot = slotConfig(selectedId());
    if (slot) setSelectedZoom(slot.zoom + LIMITS.zoomStep);
  });
  els.zoomReset.addEventListener('click', () => setSelectedZoom(100));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= LIMITS.maxSlots) selectSlot(n);
    }
  });
  window.addEventListener('beforeunload', () => {
    clearTimeout(state.saveTimer);
    clearTimeout(state.autoReloadTimer);
  });
  els.modeGrid.addEventListener('click', () => setMode('grid'));
  els.modeFocus.addEventListener('click', () => setMode('focus'));
  populateAutoReloadOptions();
  els.autoReload.addEventListener('change', () => {
    state.config.autoReloadMinutes = clampAutoReload(Number(els.autoReload.value));
    armAutoReload();
    clearTimeout(state.saveTimer);
    window.poke.saveConfig(state.config).catch(() => {});
  });
  window.poke.onSlotHotkey((id) => selectSlot(id));
  window.poke.onSlotOpenStream(({ slotId, platform, url }) => openStreamFromGame(slotId, platform, url));
}

async function start() {
  const loaded = await window.poke.loadConfig();
  state.config = normalizeConfig(loaded ?? defaultConfig());
  boot();
  syncSlots();
  applyLowQuality();
  syncSettingsControls();
  renderAll();
  els.modeGrid.classList.toggle('active', state.config.layout.mode === 'grid');
  els.modeFocus.classList.toggle('active', state.config.layout.mode === 'focus');
  els.autoReload.value = String(state.config.autoReloadMinutes);
  armAutoReload();
}

start();
