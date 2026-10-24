import { describe, it, expect, vi } from 'vitest';
import {
  isTrustedHlsUrl,
  channelApiUrl,
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickLowestVariant,
  KickHeadlessRunner,
  curlTextFetcher,
  ACTIVE_WINDOW_MS,
} from '../src/main/kick-headless.js';

describe('isTrustedHlsUrl', () => {
  it('aceita hosts da família IVS/CDN em HTTPS', () => {
    expect(isTrustedHlsUrl('https://fa723fc1.sae11.playlist.live-video.net/v1/x.m3u8?token=abc')).toBe(true);
    expect(isTrustedHlsUrl('https://d1.cloudfront.net/s.ts')).toBe(true);
    expect(isTrustedHlsUrl('https://eve.akamaized.net/a.ts')).toBe(true);
  });

  it('rejeita HTTP, porta fora de 443 e hosts desconhecidos', () => {
    expect(isTrustedHlsUrl('http://live-video.net/a.m3u8')).toBe(false);
    expect(isTrustedHlsUrl('https://live-video.net:8080/a.m3u8')).toBe(false);
    expect(isTrustedHlsUrl('https://evil.com/a.m3u8')).toBe(false);
    expect(isTrustedHlsUrl('https://notlive-video.net/a.m3u8')).toBe(false);
    expect(isTrustedHlsUrl('não é url')).toBe(false);
  });

  it('rejeita truque de userinfo para esconder outro host', () => {
    expect(isTrustedHlsUrl('https://live-video.net@evil.com/a.m3u8')).toBe(false);
    expect(isTrustedHlsUrl('https://user@live-video.net/a.m3u8')).toBe(false);
  });
});

describe('channelApiUrl', () => {
  it('monta a URL da API v2 para slug válido', () => {
    expect(channelApiUrl('canal_x')).toBe('https://kick.com/api/v2/channels/canal_x');
  });

  it('rejeita slug com caracteres inesperados', () => {
    expect(() => channelApiUrl('../admin')).toThrow();
    expect(() => channelApiUrl('a b')).toThrow();
    expect(() => channelApiUrl('')).toThrow();
  });
});

const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="1792837968.34"
#EXT-X-STREAM-INF:BANDWIDTH=3002999,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000
https://cdn.live-video.net/hi.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=270000,RESOLUTION=284x160,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="160p30"
https://cdn.live-video.net/160p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"
https://cdn.live-video.net/audio.m3u8
`;

describe('parseMasterPlaylist', () => {
  it('extrai variantes com bandwidth e resolução, ignorando session-data', () => {
    const variants = parseMasterPlaylist(MASTER_PLAYLIST, 'https://live-video.net/master.m3u8');
    expect(variants).toHaveLength(3);
    expect(variants[0]).toMatchObject({ bandwidth: 3002999, resolution: '1280x720', video: '720p60' });
    expect(variants.every((v) => v.url.startsWith('https://cdn.live-video.net/'))).toBe(true);
  });

  it('resolve URL relativa contra a base e valida o host', () => {
    const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO="160p30"
/rel/160p.m3u8
`;
    const variants = parseMasterPlaylist(text, 'https://sub.live-video.net/path/master.m3u8');
    expect(variants[0].url).toBe('https://sub.live-video.net/rel/160p.m3u8');
  });

  it('rejeita playlist que anuncia variante em host não confiável', () => {
    const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000
https://evil.com/a.m3u8
`;
    expect(() => parseMasterPlaylist(text, 'https://live-video.net/master.m3u8')).toThrow(/não confiável/);
  });

  it('rejeita master sem variantes', () => {
    expect(() => parseMasterPlaylist('#EXTM3U\n', 'https://live-video.net/m.m3u8')).toThrow();
  });
});

describe('pickLowestVariant', () => {
  it('escolhe a menor bandwidth (audio_only vence)', () => {
    const variants = parseMasterPlaylist(MASTER_PLAYLIST, 'https://live-video.net/master.m3u8');
    expect(pickLowestVariant(variants).video).toBe('audio_only');
    expect(pickLowestVariant(variants).bandwidth).toBe(160000);
  });
});

const MEDIA_PLAYLIST = (mediaSequence, segmentUrls) => `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:${mediaSequence}
${segmentUrls.map((url) => `#EXTINF:2.000,live\n${url}`).join('\n')}
`;

describe('parseMediaPlaylist', () => {
  it('extrai segmentos, sequência e duração alvo', () => {
    const media = parseMediaPlaylist(
      MEDIA_PLAYLIST(1365, ['https://cdn.live-video.net/s1.ts']),
      'https://live-video.net/media.m3u8',
    );
    expect(media.segments).toEqual(['https://cdn.live-video.net/s1.ts']);
    expect(media.mediaSequence).toBe(1365);
    expect(media.targetDuration).toBe(2);
    expect(media.endlist).toBe(false);
    expect(media.mapUrl).toBeNull();
  });

  it('captura EXT-X-MAP (init) e valida o host', () => {
    const text = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MAP:URI="https://cdn.live-video.net/init.mp4"
#EXTINF:2.000,live
init.ts
`;
    const media = parseMediaPlaylist(text, 'https://cdn.live-video.net/media.m3u8');
    expect(media.mapUrl).toBe('https://cdn.live-video.net/init.mp4');
    expect(media.segments).toEqual(['https://cdn.live-video.net/init.ts']);
  });

  it('rejeita segmento em host não confiável', () => {
    expect(() => parseMediaPlaylist(
      MEDIA_PLAYLIST(1, ['https://evil.com/s1.ts']),
      'https://live-video.net/media.m3u8',
    )).toThrow(/não confiável/);
  });

  it('detecta ENDLIST (live encerrada)', () => {
    const media = parseMediaPlaylist(
      `${MEDIA_PLAYLIST(1, ['https://cdn.live-video.net/s1.ts'])}#EXT-X-ENDLIST\n`,
      'https://live-video.net/media.m3u8',
    );
    expect(media.endlist).toBe(true);
  });
});

// ── Runner com fetch simulado ────────────────────────────────────────────────

const API_URL = channelApiUrl('testcanal');
const MASTER_URL = 'https://cdn.live-video.net/master.m3u8';
const MEDIA_URL = 'https://cdn.live-video.net/audio.m3u8';
const SEG_A = 'https://cdn.live-video.net/seg-a.ts';
const SEG_B = 'https://cdn.live-video.net/seg-b.ts';
const SEG_C = 'https://cdn.live-video.net/seg-c.ts';
const SEGMENT_BODY = 'x'.repeat(1000);

function textResponse(body, status = 200) {
  return new Response(body, { status });
}

// apiFetcher responde a API (descritor {status, body} ou corpo direto); fetchImpl
// cobre apenas os endpoints HLS (master/media/segmentos).
function makeMockFetch({ api, master, media, segmentBody = SEGMENT_BODY, segmentStatus = 200 }) {
  const calls = { api: 0, master: 0, media: 0, segments: [] };
  const mediaQueue = [...media];
  const apiFetcher = async (url) => {
    if (url !== API_URL) throw new Error(`apiFetcher recebeu URL inesperada: ${url}`);
    const spec = typeof api === 'function' ? api(calls.api) : api;
    calls.api += 1;
    if (spec && typeof spec === 'object' && ('status' in spec || 'body' in spec)) {
      return { status: spec.status ?? 200, text: JSON.stringify(spec.body) };
    }
    return { status: 200, text: JSON.stringify(spec) };
  };
  const fetchImpl = async (url) => {
    if (url === MASTER_URL) {
      return textResponse(typeof master === 'function' ? master(calls.master++) : master);
    }
    if (url === MEDIA_URL) {
      const next = mediaQueue.length > 1 ? mediaQueue.shift() : mediaQueue[0];
      calls.media += 1;
      return textResponse(typeof next === 'function' ? next(calls.media - 1) : next);
    }
    if (url.startsWith('https://cdn.live-video.net/seg-')) {
      calls.segments.push(url);
      return textResponse(segmentBody, segmentStatus);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, apiFetcher, calls };
}

const MASTER_ONE_VARIANT = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"
${MEDIA_URL}
`;

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout aguardando condição'));
      setTimeout(check, 10);
    };
    check();
  });
}

const FAST = { pollMs: 5, offlineMs: 5, errorMs: 5, resolveFailureMs: 5 };

describe('KickHeadlessRunner', () => {
  it('consome apenas segmentos novos (sem backlog) e descarta os bytes contando-os', async () => {
    // 1ª consulta ao media: janela inicial (marcada como vista); 2ª: um segmento novo.
    const first = MEDIA_PLAYLIST(10, [SEG_A, SEG_B]);
    const second = MEDIA_PLAYLIST(11, [SEG_B, SEG_C]);
    const { fetchImpl, apiFetcher, calls } = makeMockFetch({
      api: { playback_url: MASTER_URL, livestream: { viewer_count: 10 } },
      master: MASTER_ONE_VARIANT,
      media: [first, second],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    await waitFor(() => runner.snapshot().segments >= 1);

    const snap = runner.snapshot();
    expect(snap.phase).toBe('playing');
    expect(snap.segments).toBe(1);
    expect(snap.bytes).toBe(SEGMENT_BODY.length);
    expect(snap.bitrate).toBe(160000);
    expect(calls.segments).toEqual([SEG_C]);

    runner.stop();
    await runner.waitStopped();
  });

  it('canal offline fica em fase própria sem erro e não baixa playlist', async () => {
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: { playback_url: MASTER_URL, livestream: null },
      master: MASTER_ONE_VARIANT,
      media: [MEDIA_PLAYLIST(1, [SEG_A])],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    await waitFor(() => runner.snapshot().phase === 'offline');
    const snap = runner.snapshot();
    expect(snap.segments).toBe(0);
    expect(snap.errors).toBe(0);
    expect(snap.active).toBe(false);
    runner.stop();
    await runner.waitStopped();
  });

  it('erro da API é registrado e o ciclo continua (retry)', async () => {
    let failing = true;
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: () => (failing
        ? { status: 500, body: { message: 'nope' } }
        : { body: { playback_url: MASTER_URL, livestream: {} } }),
      master: MASTER_ONE_VARIANT,
      media: [MEDIA_PLAYLIST(1, [SEG_A]), MEDIA_PLAYLIST(2, [SEG_A, SEG_B])],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    await waitFor(() => runner.snapshot().errors >= 1);
    expect(runner.snapshot().phase).toBe('error');
    expect(runner.snapshot().lastError).toBe('HTTP 500');

    failing = false;
    await waitFor(() => runner.snapshot().segments >= 1, 3000);
    runner.stop();
    await runner.waitStopped();
  });

  it('playback_url fora dos hosts confiáveis vira erro, nunca é baixada', async () => {
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: { playback_url: 'https://evil.com/master.m3u8', livestream: {} },
      master: MASTER_ONE_VARIANT,
      media: [MEDIA_PLAYLIST(1, [SEG_A])],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    await waitFor(() => runner.snapshot().errors >= 1);
    expect(runner.snapshot().lastError).toMatch(/hosts confiáveis/);
    runner.stop();
    await runner.waitStopped();
  });

  it('active() só fica verdadeiro com segmento recente', async () => {
    expect(new KickHeadlessRunner('x').active()).toBe(false);
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: { playback_url: MASTER_URL, livestream: {} },
      master: MASTER_ONE_VARIANT,
      media: [MEDIA_PLAYLIST(1, [SEG_A]), MEDIA_PLAYLIST(2, [SEG_A, SEG_B])],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    await waitFor(() => runner.snapshot().segments >= 1);
    expect(runner.active()).toBe(true);
    runner.stop();
    await runner.waitStopped();
  });

  it('log recebe as mensagens de erro registradas', async () => {
    const log = vi.fn();
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: () => ({ status: 403, body: {} }),
      master: MASTER_ONE_VARIANT,
      media: [MEDIA_PLAYLIST(1, [SEG_A])],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST, log });
    runner.start();
    await waitFor(() => runner.snapshot().errors >= 1);
    expect(log).toHaveBeenCalled();
    expect(runner.snapshot().lastError).toContain('403');
    // A anotação de Cloudflare aparece exatamente uma vez (sem duplicar no catch).
    expect(runner.snapshot().lastError.match(/possível bloqueio/g)).toHaveLength(1);
    runner.stop();
    await runner.waitStopped();
  });

  it('stop() aborta downloads de segmento em voo e waitStopped resolve rápido', async () => {
    const first = MEDIA_PLAYLIST(1, [SEG_A]);
    const second = MEDIA_PLAYLIST(2, [SEG_A, SEG_B]);
    const { fetchImpl, apiFetcher } = makeMockFetch({
      api: { playback_url: MASTER_URL, livestream: {} },
      master: MASTER_ONE_VARIANT,
      media: [first, second],
    });
    // Segmentos ficam pendentes até o abort: simula download lento em voo.
    const slowFetch = async (url, init) => {
      if (url.startsWith('https://cdn.live-video.net/seg-')) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(textResponse(SEGMENT_BODY)), 10_000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('abortado'));
          }, { once: true });
        });
      }
      return fetchImpl(url, init);
    };
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl: slowFetch, apiFetcher, ...FAST });
    runner.start();
    // Segundo playlist chega com SEG_B novo e o download fica pendente.
    await waitFor(() => runner.snapshot().phase === 'playing' && runner.snapshot().segments === 0 && runner.snapshot().errors === 0, 3000);
    const t0 = Date.now();
    runner.stop();
    await runner.waitStopped();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(runner.snapshot().phase).toBe('stopped');
  });

  it('live encerrada (ENDLIST) faz voltar à resolução do canal', async () => {
    const ended = `${MEDIA_PLAYLIST(1, [SEG_A])}#EXT-X-ENDLIST\n`;
    const { fetchImpl, apiFetcher, calls } = makeMockFetch({
      api: { playback_url: MASTER_URL, livestream: {} },
      master: MASTER_ONE_VARIANT,
      media: [ended],
    });
    const runner = new KickHeadlessRunner('testcanal', { fetchImpl, apiFetcher, ...FAST });
    runner.start();
    // Depois do ENDLIST o runner pausa e re-resolve a API (2ª chamada).
    await waitFor(() => calls.api >= 2, 3000);
    runner.stop();
    await runner.waitStopped();
  });

  it('ACTIVE_WINDOW_MS cobre segmentos de 2s com folga', () => {
    expect(ACTIVE_WINDOW_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('curlTextFetcher', () => {
  it('rejeita URL fora da API do Kick antes de spawnar processo', async () => {
    await expect(curlTextFetcher('https://live-video.net/master.m3u8')).rejects.toThrow(/apenas para a API/);
    await expect(curlTextFetcher('https://evil.com/api/v2/channels/x')).rejects.toThrow(/apenas para a API/);
  });
});
