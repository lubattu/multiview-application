import { describe, it, expect } from 'vitest';
import {
  defaultConfig,
  normalizeConfig,
  clampZoom,
  clampSplit,
  clampAutoReload,
  normalizeTwitchChannel,
  normalizeKickChannel,
  twitchLoginFromUrl,
  kickLoginFromUrl,
  streamPlayerUrl,
} from '../src/shared/config.js';

describe('defaultConfig', () => {
  it('retorna 1 slot "Conta 1" em grade 2x2', () => {
    expect(defaultConfig()).toEqual({
      version: 1,
      autoReloadMinutes: 0,
      closeToTray: 'streams',
      keepAwake: true,
      lowQuality: true,
      lightMode: false,
      slots: [{ id: 1, name: 'Conta 1', zoom: 100, muted: false, twitchChannels: [], kickChannels: [] }],
      layout: { mode: 'grid', focusSlotId: 1, gridSplit: { v: 50, h: 50 }, focusSplit: 70 },
      window: { width: 1600, height: 900, maximized: false },
    });
  });
});

describe('normalizeConfig', () => {
  it('entrada nula ou lixo cai no default', () => {
    expect(normalizeConfig(null)).toEqual(defaultConfig());
    expect(normalizeConfig('lixo')).toEqual(defaultConfig());
    expect(normalizeConfig(42)).toEqual(defaultConfig());
  });

  it('config válida não é alterada', () => {
    const cfg = defaultConfig();
    cfg.slots.push({ id: 2, name: 'Meu nome', zoom: 130, muted: true, twitchChannels: ['canal_x'], kickChannels: ['canal_kick'] });
    cfg.layout.mode = 'focus';
    cfg.layout.focusSplit = 80;
    cfg.autoReloadMinutes = 360;
    expect(normalizeConfig(cfg)).toEqual(cfg);
  });

  it('autoReloadMinutes inválido cai em 0 (off)', () => {
    expect(normalizeConfig({}).autoReloadMinutes).toBe(0);
    expect(normalizeConfig({ autoReloadMinutes: 45 }).autoReloadMinutes).toBe(0);
    expect(normalizeConfig({ autoReloadMinutes: '1 h' }).autoReloadMinutes).toBe(0);
    expect(normalizeConfig({ autoReloadMinutes: null }).autoReloadMinutes).toBe(0);
    expect(normalizeConfig({ autoReloadMinutes: 1440 }).autoReloadMinutes).toBe(1440);
  });

  it('bandeja/suspensão/qualidade: defaults ligados e valores inválidos descartados', () => {
    expect(normalizeConfig({}).closeToTray).toBe('streams');
    expect(normalizeConfig({}).keepAwake).toBe(true);
    expect(normalizeConfig({}).lowQuality).toBe(true);
    expect(normalizeConfig({ closeToTray: 'sempre' }).closeToTray).toBe('streams');
    expect(normalizeConfig({ closeToTray: 'never' }).closeToTray).toBe('never');
    expect(normalizeConfig({ keepAwake: false }).keepAwake).toBe(false);
    expect(normalizeConfig({ keepAwake: 'sim' }).keepAwake).toBe(true);
    expect(normalizeConfig({ lowQuality: false }).lowQuality).toBe(false);
  });

  it('modo leve é opt-in: só booleano true liga', () => {
    expect(normalizeConfig({}).lightMode).toBe(false);
    expect(normalizeConfig({ lightMode: true }).lightMode).toBe(true);
    expect(normalizeConfig({ lightMode: 'sim' }).lightMode).toBe(false);
    expect(normalizeConfig({ lightMode: 1 }).lightMode).toBe(false);
  });

  it('zoom fora de faixa é clampado e ajustado ao passo de 10', () => {
    const cfg = normalizeConfig({ slots: [{ id: 1, zoom: 999 }, { id: 2, zoom: 10 }, { id: 3, zoom: 87 }] });
    expect(cfg.slots.map((s) => s.zoom)).toEqual([200, 50, 90]);
  });

  it('mais de 4 slots mantém só os 4 primeiros', () => {
    const cfg = normalizeConfig({ slots: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 4 }] });
    expect(cfg.slots).toHaveLength(4);
  });

  it('ids duplicados: a segunda ocorrência é descartada', () => {
    const cfg = normalizeConfig({ slots: [{ id: 2, name: 'A' }, { id: 2, name: 'B' }] });
    expect(cfg.slots).toHaveLength(1);
    expect(cfg.slots[0].name).toBe('A');
  });

  it('id inválido cai no índice + 1', () => {
    const cfg = normalizeConfig({ slots: [{ id: 99 }] });
    expect(cfg.slots[0].id).toBe(1);
  });

  it('slots ficam ordenados por id', () => {
    const cfg = normalizeConfig({ slots: [{ id: 3 }, { id: 1 }] });
    expect(cfg.slots.map((s) => s.id)).toEqual([1, 3]);
  });

  it('focusSlotId inexistente cai no menor id existente', () => {
    const cfg = normalizeConfig({ slots: [{ id: 2 }], layout: { focusSlotId: 3 } });
    expect(cfg.layout.focusSlotId).toBe(2);
  });

  it('sem slots, focusSlotId permanece 1', () => {
    const cfg = normalizeConfig({ slots: [], layout: {} });
    expect(cfg.slots).toEqual([]);
    expect(cfg.layout.focusSlotId).toBe(1);
  });

  it('modo inválido vira grid', () => {
    expect(normalizeConfig({ layout: { mode: 'caos' } }).layout.mode).toBe('grid');
    expect(normalizeConfig({ layout: { mode: 'focus' } }).layout.mode).toBe('focus');
  });

  it('splitters clampados a 15–85; não numéricos caem no fallback', () => {
    const cfg = normalizeConfig({ layout: { gridSplit: { v: 95, h: 5 }, focusSplit: 90 } });
    expect(cfg.layout.gridSplit).toEqual({ v: 85, h: 15 });
    expect(cfg.layout.focusSplit).toBe(85);
    const cfg2 = normalizeConfig({ layout: { gridSplit: { v: 'x' }, focusSplit: null } });
    expect(cfg2.layout.gridSplit.v).toBe(50);
    expect(cfg2.layout.focusSplit).toBe(70);
  });

  it('janela fora de faixa cai no default', () => {
    expect(normalizeConfig({ window: { width: 100, height: 50 } }).window)
      .toEqual({ width: 1600, height: 900, maximized: false });
  });

  it('nome vazio vira "Conta N"; nomes são truncados em 40 caracteres', () => {
    const cfg = normalizeConfig({ slots: [{ id: 2, name: '   ' }, { id: 3, name: 'x'.repeat(50) }] });
    expect(cfg.slots[0].name).toBe('Conta 2');
    expect(cfg.slots[1].name).toBe('x'.repeat(40));
  });

  it('muted truthy vira true', () => {
    expect(normalizeConfig({ slots: [{ id: 1, muted: 1 }] }).slots[0].muted).toBe(true);
    expect(normalizeConfig({ slots: [{ id: 1 }] }).slots[0].muted).toBe(false);
  });

  it('twitchChannels e kickChannels ganham lista vazia em slots novos e antigos', () => {
    const cfg = normalizeConfig({ slots: [{ id: 1 }] });
    expect(cfg.slots[0].twitchChannels).toEqual([]);
    expect(cfg.slots[0].kickChannels).toEqual([]);
  });

  it('twitchChannels normaliza cada login, deduplica e descarta inválidos', () => {
    const cfg = normalizeConfig({
      slots: [{ id: 1, twitchChannels: ['  Canal_X  ', 'canal_x', 'abc', 42, 'Outro_Canal', null] }],
    });
    expect(cfg.slots[0].twitchChannels).toEqual(['canal_x', 'outro_canal']);
  });

  it('kickChannels normaliza, deduplica, descarta inválidos e limita a 8 por plataforma', () => {
    const cfg = normalizeConfig({
      slots: [{ id: 1, kickChannels: [' Canal_Kick ', 'canal_kick', 'ab', 7, 'Outro_Kick'] }],
    });
    expect(cfg.slots[0].kickChannels).toEqual(['canal_kick', 'outro_kick']);
    const many = Array.from({ length: 12 }, (_, i) => `kanal${i}`);
    const capped = normalizeConfig({ slots: [{ id: 1, kickChannels: many }] });
    expect(capped.slots[0].kickChannels).toHaveLength(8);
  });

  it('twitchChannels migra o formato antigo (twitchChannel + twitchActive)', () => {
    const ativo = normalizeConfig({ slots: [{ id: 1, twitchChannel: 'canal_x', twitchActive: true }] });
    expect(ativo.slots[0].twitchChannels).toEqual(['canal_x']);
    const inativo = normalizeConfig({ slots: [{ id: 1, twitchChannel: 'canal_x', twitchActive: false }] });
    expect(inativo.slots[0].twitchChannels).toEqual([]);
    const formatoNovoVence = normalizeConfig({
      slots: [{ id: 1, twitchChannel: 'antigo', twitchActive: true, twitchChannels: ['novo'] }],
    });
    expect(formatoNovoVence.slots[0].twitchChannels).toEqual(['novo']);
  });

  it('twitchChannels limita a 8 canais por slot', () => {
    const many = Array.from({ length: 12 }, (_, i) => `canal${i}`);
    const cfg = normalizeConfig({ slots: [{ id: 1, twitchChannels: many }] });
    expect(cfg.slots[0].twitchChannels).toHaveLength(8);
  });
});

describe('normalizeTwitchChannel / twitchLoginFromUrl', () => {
  it('normalizeTwitchChannel aceita apenas logins válidos', () => {
    expect(normalizeTwitchChannel(' SomeChan_99 ')).toBe('somechan_99');
    expect(normalizeTwitchChannel('abc')).toBe('');
    expect(normalizeTwitchChannel('tem espaço')).toBe('');
    expect(normalizeTwitchChannel(null)).toBe('');
    expect(normalizeTwitchChannel(42)).toBe('');
  });

  it('twitchLoginFromUrl extrai o login do canal em twitch.tv, www e m.', () => {
    expect(twitchLoginFromUrl('https://www.twitch.tv/somechan')).toBe('somechan');
    expect(twitchLoginFromUrl('https://twitch.tv/Canal_X/')).toBe('canal_x');
    expect(twitchLoginFromUrl('https://m.twitch.tv/chan123/home')).toBe('chan123');
  });

  it('twitchLoginFromUrl ignora rotas reservadas e páginas que não são de canal', () => {
    expect(twitchLoginFromUrl('https://www.twitch.tv/')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/directory/category/just-chatting')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/videos/123456')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/Videos/123456')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/Directory')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/settings/profile')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/downloads')).toBe('');
  });

  it('twitchLoginFromUrl extrai o canal do player de popout', () => {
    expect(twitchLoginFromUrl('https://www.twitch.tv/popout/somechan/player')).toBe('somechan');
    expect(twitchLoginFromUrl('https://twitch.tv/popout/Canal_X/player')).toBe('canal_x');
    expect(twitchLoginFromUrl('https://www.twitch.tv/popout/somechan/chat')).toBe('somechan');
    expect(twitchLoginFromUrl('https://www.twitch.tv/popout/directory/player')).toBe('');
    expect(twitchLoginFromUrl('https://www.twitch.tv/popout')).toBe('');
  });

  it('twitchLoginFromUrl retorna vazio para hosts externos e entradas inválidas', () => {
    expect(twitchLoginFromUrl('https://youtube.com/somechan')).toBe('');
    expect(twitchLoginFromUrl('https://evil.com/twitch.tv/somechan')).toBe('');
    expect(twitchLoginFromUrl('não é URL')).toBe('');
    expect(twitchLoginFromUrl('')).toBe('');
    expect(twitchLoginFromUrl(null)).toBe('');
  });
});

describe('normalizeKickChannel / kickLoginFromUrl', () => {
  it('normalizeKickChannel aceita logins válidos (3–25, [a-z0-9_-])', () => {
    expect(normalizeKickChannel(' Canal_Kick ')).toBe('canal_kick');
    expect(normalizeKickChannel('ab')).toBe('');
    expect(normalizeKickChannel('tem espaço')).toBe('');
    expect(normalizeKickChannel(null)).toBe('');
  });

  it('kickLoginFromUrl extrai o login em kick.com e www.kick.com', () => {
    expect(kickLoginFromUrl('https://kick.com/canalkick')).toBe('canalkick');
    expect(kickLoginFromUrl('https://www.kick.com/Outro_Kick/')).toBe('outro_kick');
  });

  it('kickLoginFromUrl ignora rotas reservadas e páginas que não são de canal', () => {
    expect(kickLoginFromUrl('https://kick.com/')).toBe('');
    expect(kickLoginFromUrl('https://kick.com/browse')).toBe('');
    expect(kickLoginFromUrl('https://kick.com/categories/irl')).toBe('');
    expect(kickLoginFromUrl('https://kick.com/dashboard')).toBe('');
    expect(kickLoginFromUrl('https://kick.com/terms-of-service')).toBe('');
  });

  it('kickLoginFromUrl extrai o canal do player de embed (player.kick.com)', () => {
    expect(kickLoginFromUrl('https://player.kick.com/canalkick')).toBe('canalkick');
    expect(kickLoginFromUrl('https://player.kick.com/Canal_Kick/')).toBe('canal_kick');
    expect(kickLoginFromUrl('https://player.kick.com/browse')).toBe('');
  });

  it('kickLoginFromUrl retorna vazio para hosts externos e entradas inválidas', () => {
    expect(kickLoginFromUrl('https://twitch.tv/somechan')).toBe('');
    expect(kickLoginFromUrl('https://evil.com/kick.com/chan')).toBe('');
    expect(kickLoginFromUrl('não é URL')).toBe('');
    expect(kickLoginFromUrl(null)).toBe('');
  });
});

describe('streamPlayerUrl', () => {
  it('monta o player leve de cada plataforma e rejeita plataforma desconhecida', () => {
    expect(streamPlayerUrl('twitch', 'somechan')).toBe('https://www.twitch.tv/popout/somechan/player');
    expect(streamPlayerUrl('kick', 'canal_kick')).toBe('https://player.kick.com/canal_kick');
    expect(streamPlayerUrl('youtube', 'somechan')).toBe(null);
  });

  it('as URLs leves são reconhecidas pelos parsers de login', () => {
    expect(twitchLoginFromUrl(streamPlayerUrl('twitch', 'somechan'))).toBe('somechan');
    expect(kickLoginFromUrl(streamPlayerUrl('kick', 'canal_kick'))).toBe('canal_kick');
  });
});

describe('clampZoom / clampSplit', () => {
  it('clampZoom', () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(49)).toBe(50);
    expect(clampZoom(205)).toBe(200);
    expect(clampZoom(87)).toBe(90);
    expect(clampZoom('x')).toBe(100);
  });
  it('clampSplit', () => {
    expect(clampSplit(95, 50)).toBe(85);
    expect(clampSplit(3, 50)).toBe(15);
    expect(clampSplit('x', 70)).toBe(70);
    expect(clampSplit(null, 70)).toBe(70);
  });
  it('clampAutoReload só aceita os intervalos oferecidos na UI', () => {
    expect(clampAutoReload(0)).toBe(0);
    expect(clampAutoReload(60)).toBe(60);
    expect(clampAutoReload(1440)).toBe(1440);
    expect(clampAutoReload(45)).toBe(0);
    expect(clampAutoReload(-15)).toBe(0);
    expect(clampAutoReload('x')).toBe(0);
    expect(clampAutoReload(NaN)).toBe(0);
  });
});
