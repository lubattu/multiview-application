export const GAME_URL = 'https://pokeidle.io';
export const TWITCH_HOME_URL = 'https://www.twitch.tv/';
export const KICK_HOME_URL = 'https://kick.com/';
// Player de embed oficial do Kick (domínio próprio, sem chat nem UI do site).
export const KICK_PLAYER_URL = 'https://player.kick.com/';

// Player leve para streams em segundo plano: popout da Twitch e embed do Kick — sem
// chat nem interface do site, que são a maior parte do custo de uma página inteira.
// A página completa fica apenas para o painel visível.
const STREAM_PLAYERS = {
  twitch: (login) => `${TWITCH_HOME_URL}popout/${login}/player`,
  kick: (login) => `${KICK_PLAYER_URL}${login}`,
};

export function streamPlayerUrl(platform, login) {
  return STREAM_PLAYERS[platform]?.(login) ?? null;
}

export const LIMITS = Object.freeze({
  maxSlots: 4,
  maxStreams: 8,
  minZoom: 50,
  maxZoom: 200,
  zoomStep: 10,
  minSplit: 15,
  maxSplit: 85,
});

export const AUTO_RELOAD_OPTIONS = Object.freeze([
  { minutes: 0, label: 'Off' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 180, label: '3 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 720, label: '12 h' },
  { minutes: 1440, label: '24 h' },
]);

const DEFAULT_SLOT_NAMES = ['Conta 1', 'Conta 2', 'Conta 3', 'Conta 4'];

export function clampZoom(raw) {
  if (!Number.isFinite(raw)) return 100;
  const snapped = Math.round(raw / LIMITS.zoomStep) * LIMITS.zoomStep;
  return Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, snapped));
}

export function clampSplit(raw, fallback) {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(LIMITS.maxSplit, Math.max(LIMITS.minSplit, raw));
}

export function clampAutoReload(raw) {
  if (!Number.isFinite(raw)) return 0;
  return AUTO_RELOAD_OPTIONS.some((o) => o.minutes === raw) ? raw : 0;
}

// Logins da Twitch: 4–25 caracteres de [a-z0-9_].
const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{4,25}$/;

export function isTwitchHost(hostname) {
  return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv');
}

export function isKickHost(hostname) {
  return hostname === 'kick.com' || hostname.endsWith('.kick.com');
}

const TWITCH_RESERVED_PATHS = new Set([
  'directory', 'videos', 'settings', 'search', 'downloads', 'p', 'team', 'store',
  'turbo', 'jobs', 'security', 'broadcast', 'dashboard', 'moderator', 'u', 'chat',
  'embed', 'popout', 'signup', 'login', 'logout', 'subscriptions', 'wallet',
  'inventory', 'drops', 'terms', 'privacy', 'dmca', 'legal', 'help',
  'about', 'sitemap', 'redeem', 'payments', 'campfires',
]);

export function normalizeTwitchChannel(raw) {
  if (typeof raw !== 'string') return '';
  const login = raw.trim().toLowerCase();
  return TWITCH_LOGIN_PATTERN.test(login) ? login : '';
}

// Logins da Kick: 3–25 caracteres de [a-z0-9_-].
const KICK_LOGIN_PATTERN = /^[a-z0-9_-]{3,25}$/;

const KICK_RESERVED_PATHS = new Set([
  'browse', 'categories', 'search', 'dashboard', 'terms-of-service', 'privacy-policy',
  'support', 'community-guidelines', 'dmca', 'newsroom', 'careers', 'apps', 'help',
  'login', 'signup', 'security', 'api', 'videos', 'clips', 'leaderboard', 'faq',
  'rules', 'transparency', 'report', 'welcome', 'store', 'merch', 'account',
]);

export function normalizeKickChannel(raw) {
  if (typeof raw !== 'string') return '';
  const login = raw.trim().toLowerCase();
  return KICK_LOGIN_PATTERN.test(login) ? login : '';
}

export function twitchLoginFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'twitch.tv' && host !== 'www.twitch.tv' && host !== 'm.twitch.tv') return '';
  const segments = url.pathname.split('/').filter(Boolean);
  // Player de popout (/popout/<canal>/player): o canal é o segundo segmento.
  const first = (segments[0] === 'popout' ? segments[1] ?? '' : segments[0] ?? '').toLowerCase();
  if (!first || TWITCH_RESERVED_PATHS.has(first)) return '';
  return normalizeTwitchChannel(first);
}

export function kickLoginFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase();
  // player.kick.com: player de embed, o canal é o primeiro segmento do caminho.
  if (host !== 'kick.com' && host !== 'www.kick.com' && host !== 'player.kick.com') return '';
  const first = (url.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  if (!first || KICK_RESERVED_PATHS.has(first)) return '';
  return normalizeKickChannel(first);
}

export const CLOSE_TRAY_OPTIONS = Object.freeze(['streams', 'always', 'never']);

export function defaultConfig() {
  return {
    version: 1,
    autoReloadMinutes: 0,
    closeToTray: 'streams',
    keepAwake: true,
    lowQuality: true,
    lightMode: false,
    slots: [{ id: 1, name: 'Conta 1', zoom: 100, muted: false, twitchChannels: [], kickChannels: [] }],
    layout: { mode: 'grid', focusSlotId: 1, gridSplit: { v: 50, h: 50 }, focusSplit: 70 },
    window: { width: 1600, height: 900, maximized: false },
  };
}

function normalizeChannelList(raw, normalizeLogin) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const login = normalizeLogin(item);
    if (login && !out.includes(login)) out.push(login);
    if (out.length >= LIMITS.maxStreams) break;
  }
  return out;
}

// Migra o formato v1.2 (canal único + flag ativa) para a lista de canais.
function normalizeTwitchChannels(raw, legacyRaw) {
  const list = Array.isArray(raw) ? raw.slice() : [];
  if (!Array.isArray(raw) && legacyRaw?.twitchActive) list.push(legacyRaw.twitchChannel);
  return normalizeChannelList(list, normalizeTwitchChannel);
}

function normalizeSlot(raw, index) {
  const id = Number.isInteger(raw?.id) && raw.id >= 1 && raw.id <= LIMITS.maxSlots ? raw.id : index + 1;
  const name = typeof raw?.name === 'string' && raw.name.trim()
    ? raw.name.trim().slice(0, 40)
    : DEFAULT_SLOT_NAMES[id - 1];
  return {
    id,
    name,
    zoom: clampZoom(raw?.zoom),
    muted: Boolean(raw?.muted),
    twitchChannels: normalizeTwitchChannels(raw?.twitchChannels, raw),
    kickChannels: normalizeChannelList(raw?.kickChannels, normalizeKickChannel),
  };
}

function normalizeSlots(raw) {
  if (!Array.isArray(raw)) return defaultConfig().slots;
  const seen = new Set();
  const slots = [];
  for (const item of raw.slice(0, LIMITS.maxSlots)) {
    const slot = normalizeSlot(item, slots.length);
    if (seen.has(slot.id)) continue;
    seen.add(slot.id);
    slots.push(slot);
  }
  return slots.sort((a, b) => a.id - b.id);
}

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const slots = normalizeSlots(raw.slots);
  const layout = raw.layout ?? {};
  const grid = layout.gridSplit ?? {};
  const win = raw.window ?? {};
  return {
    version: 1,
    autoReloadMinutes: clampAutoReload(raw.autoReloadMinutes),
    closeToTray: CLOSE_TRAY_OPTIONS.includes(raw.closeToTray) ? raw.closeToTray : 'streams',
    keepAwake: raw.keepAwake !== false,
    lowQuality: raw.lowQuality !== false,
    // Opt-in: streams de segundo plano viram presença headless no processo main.
    lightMode: raw.lightMode === true,
    slots,
    layout: {
      mode: layout.mode === 'focus' ? 'focus' : 'grid',
      focusSlotId: slots.some((s) => s.id === layout.focusSlotId) ? layout.focusSlotId : (slots[0]?.id ?? 1),
      gridSplit: { v: clampSplit(grid.v, 50), h: clampSplit(grid.h, 50) },
      focusSplit: clampSplit(layout.focusSplit, 70),
    },
    window: {
      width: Number.isFinite(win.width) && win.width >= 400 ? Math.round(win.width) : base.window.width,
      height: Number.isFinite(win.height) && win.height >= 300 ? Math.round(win.height) : base.window.height,
      maximized: Boolean(win.maximized),
    },
  };
}
