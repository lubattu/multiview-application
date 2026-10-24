import { describe, it, expect } from 'vitest';
import {
  TwitchIrcRunner,
  normalizeChannelList,
  ACTIVE_WINDOW_MS,
} from '../src/main/twitch-irc-headless.js';

// WebSocket simulado com a mesma superfície usada pelo runner
// (onopen/onmessage/onclose/onerror, send, close).
class MockWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  // helpers de teste:
  open() { this.readyState = 1; this.onopen?.(); }
  emit(line) { this.onmessage?.({ data: line }); }
}

function freshMockFactory() {
  MockWebSocket.instances = [];
  return (url) => new MockWebSocket(url);
}

function lastSocket() {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// Simula o handshake: abre o socket e entrega o 001 do servidor.
function handshake(socket) {
  socket.open();
  socket.emit(`:tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!\r\n`);
}

const FAST = { joinGapMs: 5, reconnectMs: 5, nickFactory: () => 'justinfan12345' };

describe('normalizeChannelList', () => {
  it('normaliza para minúsculas e remove duplicatas', () => {
    expect(normalizeChannelList(['Guaxilol1', 'guaxilol1', 'Faturetosl'])).toEqual(['guaxilol1', 'faturetosl']);
  });

  it('rejeita canal inválido ou lista vazia', () => {
    expect(() => normalizeChannelList(['canal com espaço'])).toThrow(/inválido/);
    expect(() => normalizeChannelList([])).toThrow(/Nenhum canal/);
    expect(() => normalizeChannelList('')).toThrow(/inválido/);
  });
});

describe('TwitchIrcRunner', () => {
  it('envia NICK anônimo ao abrir e JOIN após o 001', async () => {
    const runner = new TwitchIrcRunner('Guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    const socket = lastSocket();
    expect(socket.url).toBe('wss://irc-ws.chat.twitch.tv:443');
    socket.open();
    expect(socket.sent[0]).toMatch(/^NICK justinfan\d+\r\n$/);
    handshake(socket);
    expect(socket.sent.some((m) => m === 'JOIN #guaxilol1\r\n')).toBe(true);
    socket.emit(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #guaxilol1\r\n');
    expect(runner.snapshot().phase).toBe('joined');
    runner.stop();
    await runner.waitStopped();
  });

  it('responde PING com PONG ecoando o token', async () => {
    const runner = new TwitchIrcRunner('guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    const socket = lastSocket();
    socket.open();
    socket.emit('PING :ABC123\r\n');
    expect(socket.sent[socket.sent.length - 1]).toBe('PONG :ABC123\r\n');
    runner.stop();
    await runner.waitStopped();
  });

  it('conta mensagens e fica ativo após tráfego do chat', async () => {
    const runner = new TwitchIrcRunner('guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    const socket = lastSocket();
    expect(runner.snapshot().active).toBe(false);
    handshake(socket);
    socket.emit(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #guaxilol1\r\n');
    socket.emit(':alguem!alguem@alguem.tmi.twitch.tv PRIVMSG #guaxilol1 :oi\r\n');
    const snap = runner.snapshot();
    expect(snap.messages).toBeGreaterThanOrEqual(2); // 001 + PRIVMSG
    expect(snap.active).toBe(true);
    expect(snap.joined).toBe(1);
    runner.stop();
    await runner.waitStopped();
  });

  it('ignora JOIN de outros usuários na contagem do próprio JOIN', async () => {
    const runner = new TwitchIrcRunner('guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    const socket = lastSocket();
    socket.open();
    socket.emit(':tmi.twitch.tv 001 justinfan99999 :Welcome\r\n');
    socket.emit(':outro!outro@outro.tmi.twitch.tv JOIN #guaxilol1\r\n');
    expect(runner.snapshot().joined).toBe(0);
    expect(runner.snapshot().phase).toBe('joining');
    runner.stop();
    await runner.waitStopped();
  });

  it('envia JOINs de vários canais espaçados e confirma um a um', async () => {
    const runner = new TwitchIrcRunner(['guaxilol1', 'faturetosl'], { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    const socket = lastSocket();
    handshake(socket);
    await new Promise((r) => setTimeout(r, 30));
    expect(socket.sent.filter((m) => m.startsWith('JOIN '))).toEqual(['JOIN #guaxilol1\r\n', 'JOIN #faturetosl\r\n']);
    socket.emit(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #guaxilol1\r\n');
    expect(runner.snapshot().joined).toBe(1);
    expect(runner.snapshot().phase).toBe('joining');
    socket.emit(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #faturetosl\r\n');
    expect(runner.snapshot()).toMatchObject({ joined: 2, phase: 'joined' });
    runner.stop();
    await runner.waitStopped();
  });

  it('queda de conexão reconecta e refaz o JOIN', async () => {
    const runner = new TwitchIrcRunner('guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    lastSocket().open();
    lastSocket().close();
    await new Promise((r) => setTimeout(r, 30));
    expect(MockWebSocket.instances.length).toBe(2);
    const second = lastSocket();
    handshake(second);
    expect(second.sent.some((m) => m === 'JOIN #guaxilol1\r\n')).toBe(true);
    expect(runner.snapshot().errors).toBeGreaterThanOrEqual(1);
    runner.stop();
    await runner.waitStopped();
  });

  it('stop() fecha o socket e não reconecta mais', async () => {
    const runner = new TwitchIrcRunner('guaxilol1', { socketFactory: freshMockFactory(), ...FAST });
    runner.start();
    await new Promise((r) => setTimeout(r, 10));
    lastSocket().open();
    runner.stop();
    lastSocket().close();
    await runner.waitStopped();
    await new Promise((r) => setTimeout(r, 30));
    expect(MockWebSocket.instances.length).toBe(1);
    expect(runner.snapshot().phase).toBe('stopped');
  });

  it('canal inválido falha antes de abrir socket', () => {
    expect(() => new TwitchIrcRunner('canal com espaço', { socketFactory: freshMockFactory() })).toThrow(/inválido/);
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it('ACTIVE_WINDOW_MS cobre o cadência de PING do IRC (~5 min)', () => {
    expect(ACTIVE_WINDOW_MS).toBeGreaterThanOrEqual(4 * 60_000);
  });
});
