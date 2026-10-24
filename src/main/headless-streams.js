// Orquestrador das presenças headless por aba: reconcilia o estado desejado
// (listas de canais de segundo plano da config + credenciais capturadas) com os
// runners vivos — Kick = 1 runner por canal; Twitch = 1 runner IRC por aba com
// N canais. Módulo puro de Node (runners injetáveis): o Electron fica no main.js.
//
// Quem decide o estado desejado é o main.js (config + captura de token + cookies
// da partição); aqui só vive a mecânica de conciliação e a saúde agregada.

import { KickHeadlessRunner } from './kick-headless.js';
import { TwitchIrcRunner, normalizeCredentials } from './twitch-irc-headless.js';

// Kick com erros e sem segmentos recentes é problema (403, Cloudflare, cookie velho).
function kickHealthy(runner) {
  const s = runner.snapshot();
  return s.phase !== 'error';
}

function twitchHealthy(runner, authFailed) {
  if (authFailed) return false;
  const s = runner.snapshot();
  return s.phase === 'joined' || s.phase === 'joining' || s.phase === 'connecting';
}

export class HeadlessStreamManager {
  constructor({
    kickRunnerFactory = (slug, opts) => new KickHeadlessRunner(slug, opts),
    twitchRunnerFactory = (channels, opts) => new TwitchIrcRunner(channels, opts),
    onStatus = () => {},
    onTwitchAuthFailed = () => {},
    log = () => {},
  } = {}) {
    this.kickRunnerFactory = kickRunnerFactory;
    this.twitchRunnerFactory = twitchRunnerFactory;
    this.onStatus = onStatus;
    this.onTwitchAuthFailed = onTwitchAuthFailed;
    this.log = log;
    this.slots = new Map(); // slotId → { kick: Map, kickCookies: Map, twitch, twitchChannels, twitchCredKey, twitchAuthFailed }
  }

  // slotStates: [{ slotId, kick: [{ login, cookie? }], twitch: [logins], twitchCredentials? }]
  // Idempotente: só cria/para o que mudou. Slots ausentes da lista são encerrados.
  reconcile(slotStates) {
    const seen = new Set();
    for (const state of slotStates ?? []) {
      const slotId = Number(state?.slotId);
      if (!Number.isInteger(slotId)) continue;
      seen.add(slotId);
      this.#reconcileSlot(slotId, state);
    }
    for (const slotId of [...this.slots.keys()]) {
      if (!seen.has(slotId)) this.#stopSlot(slotId);
    }
    this.#emitStatus();
  }

  stopAll() {
    for (const slotId of [...this.slots.keys()]) this.#stopSlot(slotId);
    this.#emitStatus();
  }

  hasTwitchAuthFailed(slotId) {
    return this.slots.get(slotId)?.twitchAuthFailed ?? false;
  }

  // Saúde por canal para os chips do renderer.
  statusSnapshot() {
    const out = {};
    for (const [slotId, slot] of this.slots) {
      const kick = {};
      for (const [login, runner] of slot.kick) {
        const s = runner.snapshot();
        kick[login] = {
          ok: kickHealthy(runner),
          phase: s.phase,
          detail: s.lastError ?? (s.phase === 'offline' ? 'canal offline' : null),
        };
      }
      let twitch = null;
      if (slot.twitch) {
        const s = slot.twitch.snapshot();
        twitch = {
          ok: twitchHealthy(slot.twitch, slot.twitchAuthFailed),
          phase: slot.twitchAuthFailed ? 'auth-failed' : s.phase,
          joined: s.joined,
          desired: s.desired,
          detail: slot.twitchAuthFailed
            ? 'sessão recusada; recapturando token'
            : s.lastError ?? null,
        };
      }
      out[slotId] = { kick, twitch };
    }
    return out;
  }

  #newSlot(slotId) {
    const slot = {
      slotId,
      kick: new Map(),
      kickCookies: new Map(),
      twitch: null,
      twitchChannels: '',
      twitchCredKey: null,
      twitchAuthFailed: false,
    };
    this.slots.set(slotId, slot);
    return slot;
  }

  #reconcileSlot(slotId, state) {
    const slot = this.slots.get(slotId) ?? this.#newSlot(slotId);

    // ── Kick: 1 runner por canal; cookie mudou → runner novo ──
    const desiredKick = new Map();
    for (const entry of Array.isArray(state.kick) ? state.kick : []) {
      const login = String(entry?.login ?? '');
      if (login) desiredKick.set(login, typeof entry.cookie === 'string' ? entry.cookie : null);
    }
    for (const [login, runner] of [...slot.kick]) {
      const stale = !desiredKick.has(login)
        || (desiredKick.get(login) ?? null) !== (slot.kickCookies.get(login) ?? null);
      if (stale) {
        runner.stop();
        slot.kick.delete(login);
        slot.kickCookies.delete(login);
        this.log(`[light] slot ${slotId}: kick ${login} encerrado`);
      }
    }
    for (const [login, cookie] of desiredKick) {
      if (slot.kick.has(login)) continue;
      const runner = this.kickRunnerFactory(login, {
        cookie,
        log: (message) => this.log(`[light] slot ${slotId}: ${message}`),
      });
      slot.kick.set(login, runner);
      slot.kickCookies.set(login, cookie);
      runner.start();
      this.log(`[light] slot ${slotId}: kick ${login} iniciado (cookie: ${cookie ? 'sim' : 'não'})`);
    }

    // ── Twitch: 1 runner IRC por aba; canais ou credenciais mudaram → novo runner ──
    let credentials = null;
    try {
      credentials = normalizeCredentials(state.twitchCredentials ?? null);
    } catch (error) {
      this.log(`[light] slot ${slotId}: credenciais inválidas ignoradas (${String(error?.message ?? error)})`);
      credentials = null;
    }
    const channels = Array.isArray(state.twitch) ? state.twitch : [];
    const channelsKey = channels.join(',');
    const credKey = credentials ? `${credentials.nick}:${credentials.token}` : null;

    if (!channels.length) {
      if (slot.twitch) {
        slot.twitch.stop();
        slot.twitch = null;
        slot.twitchChannels = '';
        slot.twitchCredKey = null;
        slot.twitchAuthFailed = false;
        this.log(`[light] slot ${slotId}: twitch encerrado (sem canais)`);
      }
    } else if (!slot.twitch || channelsKey !== slot.twitchChannels || credKey !== slot.twitchCredKey) {
      slot.twitch?.stop();
      slot.twitchChannels = channelsKey;
      slot.twitchCredKey = credKey;
      slot.twitchAuthFailed = false;
      slot.twitch = this.twitchRunnerFactory(channels, {
        credentials,
        onAuthFailed: () => this.#handleTwitchAuthFailed(slotId),
        log: (message) => this.log(`[light] slot ${slotId}: ${message}`),
      });
      slot.twitch.start();
      this.log(`[light] slot ${slotId}: twitch iniciado (${channels.length} canal(is), ${credentials ? 'autenticado' : 'anônimo'})`);
    }
  }

  // Token recusado: para o runner (reconectar com token ruim é perda de tempo),
  // marca o estado e devolve ao main, que tenta recapturar ou aciona o fallback.
  #handleTwitchAuthFailed(slotId) {
    const slot = this.slots.get(slotId);
    if (!slot || slot.twitchAuthFailed) return;
    slot.twitchAuthFailed = true;
    slot.twitch?.stop();
    this.log(`[light] slot ${slotId}: token twitch recusado; sinalizando recaptura`);
    this.onTwitchAuthFailed(slotId);
    this.#emitStatus();
  }

  #stopSlot(slotId) {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    for (const runner of slot.kick.values()) runner.stop();
    slot.twitch?.stop();
    this.slots.delete(slotId);
    this.log(`[light] slot ${slotId}: todas as presenças encerradas`);
  }

  #emitStatus() {
    try {
      this.onStatus(this.statusSnapshot());
    } catch {}
  }
}
