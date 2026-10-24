import { describe, it, expect } from 'vitest';
import {
  IrcCredentialCollector,
  isIrcWebSocketUrl,
} from '../src/main/twitch-capture.js';

describe('isIrcWebSocketUrl', () => {
  it('aceita apenas o websocket do IRC da Twitch', () => {
    expect(isIrcWebSocketUrl('wss://irc-ws.chat.twitch.tv:443/')).toBe(true);
    expect(isIrcWebSocketUrl('wss://irc-ws.chat.twitch.tv/')).toBe(true);
    expect(isIrcWebSocketUrl('wss://evil.chat.twitch.tv.example.com/')).toBe(false);
    expect(isIrcWebSocketUrl('wss://websockets.kick.com/x')).toBe(false);
    expect(isIrcWebSocketUrl('não é url')).toBe(false);
  });
});

describe('IrcCredentialCollector', () => {
  it('extrai PASS e NICK do frame único de handshake', () => {
    const c = new IrcCredentialCollector();
    const cred = c.push('PASS oauth:abc123def456\r\nNICK Guaxilol1\r\nCAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    expect(cred).toEqual({ nick: 'guaxilol1', token: 'abc123def456' });
  });

  it('monta a credencial a partir de frames separados', () => {
    const c = new IrcCredentialCollector();
    expect(c.push('CAP REQ :twitch.tv/tags\r\n')).toBeNull();
    expect(c.push('PASS oauth:xyz987654321\r\n')).toBeNull();
    const cred = c.push('NICK faturetosl\r\n');
    expect(cred).toEqual({ nick: 'faturetosl', token: 'xyz987654321' });
  });

  it('nicks anônimos (justinfan) não viram credencial', () => {
    const c = new IrcCredentialCollector();
    expect(c.push('NICK justinfan12345\r\n')).toBeNull();
    expect(c.push('PASS oauth:abc123def456\r\n')).toBeNull();
  });

  it('mantém o último PASS visto (renovação durante a captura)', () => {
    const c = new IrcCredentialCollector();
    c.push('PASS oauth:velho123456789\r\nNICK guaxilol1\r\n');
    const cred = c.push('PASS oauth:novo123456789\r\n');
    expect(cred).toEqual({ nick: 'guaxilol1', token: 'novo123456789' });
  });

  it('frame vazio/lixo não quebra o acumulador', () => {
    const c = new IrcCredentialCollector();
    expect(c.push('')).toBeNull();
    expect(c.push(null)).toBeNull();
    expect(c.push('PRIVMSG #canal :oi')).toBeNull();
  });
});
