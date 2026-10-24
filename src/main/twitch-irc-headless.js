// Presença headless de chat da Twitch por IRC WebSocket, sem navegador e sem vídeo
// (mesma abordagem do Moth Controller). Login anônimo "justinfan": entra no chat do
// canal e responde aos PINGs — é o que o PoC valida contra o contador de Bônus Twitch
// do jogo. Se o jogo exigir sessão autenticada, o próximo passo é capturar o PASS do
// webview via debugger e usá-lo aqui (memória apenas).
//
// Módulo puro de Node (sem Electron). Um download de mensagem não prova crédito de
// audiência — o julgamento final é o contador de bônus do próprio jogo.

import { normalizeTwitchChannel } from '../shared/config.js';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

// PING do IRC da Twitch chega a cada ~5 min; antes disso alguma mensagem de chat
// costuma chegar. Janela de "conectado e falando".
export const ACTIVE_WINDOW_MS = 5 * 60_000;

// Intervalo entre JOINs de canais distintos (cortesia com o servidor, como no Moth).
const JOIN_GAP_MS = 400;
const RECONNECT_MS = 5_000;

export function normalizeChannelList(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const normalized = [];
  for (const item of list) {
    const login = normalizeTwitchChannel(String(item ?? ''));
    if (!login) throw new Error(`Canal da Twitch inválido: ${item}`);
    if (!normalized.includes(login)) normalized.push(login);
  }
  if (!normalized.length) throw new Error('Nenhum canal informado');
  return normalized;
}

function anonNick() {
  return `justinfan${Math.floor(10_000 + Math.random() * 89_999)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TwitchIrcRunner {
  // `channels`: string única ou lista; `socketFactory`: (url) => WebSocket-like com
  // onopen/onmessage/onclose/onerror, send() e close() — trocável nos testes.
  constructor(channels, {
    socketFactory = (url) => new WebSocket(url),
    nickFactory = anonNick, // injetável para testes determinísticos
    joinGapMs = JOIN_GAP_MS,
    reconnectMs = RECONNECT_MS,
    log = () => {},
  } = {}) {
    this.channels = normalizeChannelList(channels);
    this.socketFactory = socketFactory;
    this.nickFactory = nickFactory;
    this.joinGapMs = joinGapMs;
    this.reconnectMs = reconnectMs;
    this.log = log;

    this.stopped = false;
    this.phase = 'idle';
    this.messages = 0;
    this.joinedCount = 0;
    this.errorCount = 0;
    this.lastError = null;
    this.lastMessageAt = null;
    this.startedAt = null;
    this.socket = null;
  }

  start() {
    if (this.stopped || this.startedAt) return this;
    this.startedAt = Date.now();
    this.loopPromise = this.runLoop().catch((error) => {
      this.phase = 'error';
      this.lastError = String(error?.message ?? error);
    });
    return this;
  }

  async waitStopped() {
    if (this.loopPromise) await this.loopPromise;
  }

  stop() {
    this.stopped = true;
    this.phase = this.phase === 'idle' ? 'stopped' : this.phase;
    try { this.socket?.close(); } catch {}
    return this;
  }

  // Conectado e recebendo tráfego do IRC (chat e/ou PING) há pouco tempo.
  active() {
    return this.lastMessageAt !== null && (Date.now() - this.lastMessageAt) < ACTIVE_WINDOW_MS;
  }

  snapshot() {
    const elapsedS = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    return {
      channels: [...this.channels],
      phase: this.stopped && this.phase !== 'stopped' ? `${this.phase} (parado)` : this.phase,
      active: this.active(),
      joined: this.joinedCount,
      desired: this.channels.length,
      messages: this.messages,
      elapsedSeconds: Math.round(elapsedS),
      errors: this.errorCount,
      lastError: this.lastError,
      lastMessageAt: this.lastMessageAt,
    };
  }

  recordError(message) {
    this.errorCount += 1;
    this.lastError = message;
    this.log(`[twitch-irc:${this.channels.join(',')}] ${message}`);
  }

  async runLoop() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (error) {
        if (this.stopped) break;
        this.recordError(String(error?.message ?? error));
        this.phase = 'error';
      }
      if (this.stopped) break;
      // Fechou sem stop (queda de rede): reconecta com pausa fixa.
      await this.sleepUnlessStopped(this.reconnectMs);
    }
    this.phase = 'stopped';
  }

  // Uma conexão completa: abre, aguarda 001, envia JOINs e só retorna quando o
  // socket fecha (queda, ou stop() — o fechamento por stop encerra o ciclo todo).
  connectOnce() {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = this.socketFactory(IRC_URL);
      } catch (error) {
        reject(error);
        return;
      }
      this.socket = socket;
      this.phase = 'connecting';
      const nick = this.nickFactory();
      const joinedChannels = new Set();
      let settleGuard = false;
      const settle = (fn, value) => {
        if (settleGuard) return;
        settleGuard = true;
        fn(value);
      };

      socket.onopen = () => {
        if (this.stopped) {
          try { socket.close(); } catch {}
          return;
        }
        try {
          socket.send(`NICK ${nick}\r\n`);
        } catch (error) {
          settle(reject, error);
        }
      };

      socket.onmessage = (event) => {
        if (this.stopped) return;
        this.lastMessageAt = Date.now();
        for (const line of String(event.data ?? '').split(/\r?\n/)) {
          if (!line) continue;
          this.messages += 1;
          if (line.startsWith('PING')) {
            // Ecoa o token exato: "PING :x" → "PONG :x".
            try { socket.send(`PONG${line.slice(4)}\r\n`); } catch {}
            continue;
          }
          if (line.includes(' 001 ')) {
            this.phase = 'joining';
            this.joinedCount = 0;
            joinedChannels.clear();
            this.joinAll(socket);
            continue;
          }
          // Confirmação do nosso JOIN: ":<nick>!... JOIN #canal". JOINs de outros
          // usuários têm prefixo diferente e são ignorados.
          const ownJoin = line.startsWith(`:${nick}!`)
            && /^:\S+ JOIN #([a-z0-9_]+)\s*$/i.exec(line);
          if (ownJoin) {
            joinedChannels.add(ownJoin[1].toLowerCase());
            this.joinedCount = joinedChannels.size;
            if (this.joinedCount >= this.channels.length) this.phase = 'joined';
          }
        }
      };

      socket.onclose = () => {
        if (this.stopped) {
          this.phase = 'stopped';
          settle(resolve);
          return;
        }
        this.recordError('conexão IRC fechada; reconectando');
        this.phase = 'error';
        settle(resolve);
      };

      socket.onerror = () => {
        // O close vem junto do erro; registra apenas sem encerrar duplicado.
        if (!this.stopped && !settleGuard) this.recordError('erro de socket IRC');
      };
    });
  }

  async joinAll(socket) {
    for (let i = 0; i < this.channels.length; i++) {
      if (this.stopped) return;
      try {
        socket.send(`JOIN #${this.channels[i]}\r\n`);
      } catch (error) {
        this.recordError(`JOIN ${this.channels[i]}: ${String(error?.message ?? error)}`);
        return;
      }
      if (i < this.channels.length - 1) await sleep(this.joinGapMs);
    }
  }

  async sleepUnlessStopped(ms) {
    const step = 100;
    let waited = 0;
    while (!this.stopped && waited < ms) {
      await sleep(Math.min(step, ms - waited));
      waited += step;
    }
  }
}
