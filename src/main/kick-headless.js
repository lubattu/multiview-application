// Presença headless de stream da Kick sem player: consulta a API pública do canal,
// baixa o playlist HLS da menor variante e descarta os bytes dos segmentos — nada é
// decodificado nem renderizado. Inspirado no transporte de mídia do Moth Controller
// (MOTHblank/pokeidle-addons). Módulo puro de Node (sem Electron): usado pelo processo
// main na integração e pelo harness de PoC em scripts/.
//
// Um download de segmento bem-sucedido é evidência de transferência de mídia na rede,
// não prova de que a Kick creditou audiência — o julgamento final é o contador de bônus
// do próprio jogo.

import { spawn } from 'node:child_process';

const KICK_API_HOSTS = new Set(['kick.com', 'www.kick.com']);

// Playlists da Kick vêm do IVS (Amazon) e de CDNs da mesma família. Nunca buscar
// host anunciado por playlist não confiável.
const HLS_TRUSTED_SUFFIXES = ['live-video.net', 'cloudfront.net', 'akamaized.net', 'kick.com'];

const MAX_PLAYLIST_BYTES = 512 * 1024;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 8_000;
const SEGMENT_TIMEOUT_MS = 15_000;

// Memória de deduplicação de segmentos: janela de playlist (~30) + folga. Sem o
// teto, o conjunto cresce sem limite num processo main de longa duração.
const MAX_SEEN = 256;

// Janela de "canal ao vivo e transferindo" para o snapshot (segmentos de 2 s).
export const ACTIVE_WINDOW_MS = 25_000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://kick.com/',
  'Origin': 'https://kick.com',
  'X-Requested-With': 'XMLHttpRequest',
};

const CODE_MARKER = '\n__KICK_HTTP_CODE__:';

// Linha de config do curl (--config -) que carrega o Cookie sem expô-lo em argv
// (argv aparece em listagens de processo). Valor com quebra de linha é rejeitado:
// quebraria a linha do arquivo de config e injetaria diretivas extras.
export function curlCookieConfig(cookie) {
  if (typeof cookie !== 'string' || !cookie) {
    throw new Error('Cookie ausente');
  }
  if (/[\r\n]/.test(cookie)) {
    throw new Error('Cookie com quebra de linha');
  }
  const escaped = cookie.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `header = "Cookie: ${escaped}"\n`;
}

function rememberSeen(set, url) {
  set.add(url);
  if (set.size > MAX_SEEN) {
    for (const oldest of set) {
      set.delete(oldest);
      break;
    }
  }
}

// A API do kick.com fica atrás do Cloudflare, que bloqueia pelo fingerprint TLS/HTTP:
// o fetch do Node (undici) leva 403 mesmo com headers completos de navegador. O curl
// do sistema (Schannel no Windows) passa — a mesma razão pela qual o Moth Controller
// o usa. Restrito a GET https sem redirect e com teto de tamanho; quando a integração
// precisar anexar cookies de sessão, eles devem ir via `--config -` (stdin), nunca na
// linha de comando. Retorna { status, text }; `signal` aborta matando o processo curl.
export function curlTextFetcher(url, { timeoutMs = PLAYLIST_TIMEOUT_MS, maxBytes = MAX_PLAYLIST_BYTES, headers = {}, cookie = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    // Allowlist explícita: host da API + caminho de canal. Sem isso, uma URL de
    // outro host contendo "/api/v2/channels/" no caminho seria baixada via curl.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('curlTextFetcher recebeu URL inválida'));
      return;
    }
    const host = parsed.hostname.toLowerCase();
    const isApiChannel = parsed.protocol === 'https:'
      && (host === 'kick.com' || host === 'www.kick.com')
      && /^\/api\/v2\/channels\/[a-zA-Z0-9_-]{1,60}$/.test(parsed.pathname);
    if (!isApiChannel) {
      reject(new Error('curlTextFetcher é apenas para a API do Kick'));
      return;
    }
    const usesStdin = typeof cookie === 'string' && cookie.length > 0;
    const args = [
      '--silent', '--show-error',
      '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '--max-filesize', String(maxBytes + 65536),
      '--proto', '=https',
      '--max-redirs', '0',
      '--compressed',
      '--request', 'GET',
      '--write-out', CODE_MARKER + '%{http_code}',
    ];
    if (usesStdin) args.push('--config', '-');
    for (const [key, value] of Object.entries(headers)) {
      // curl não sanitiza CRLF em argv: header dinâmico com quebra permitiria
      // injetar headers na requisição. Hoje só entra dicionário fixo, mas o
      // guard custa uma linha e fecha a porta para chamadores futuros.
      if (/[\r\n]/.test(`${key}${value}`)) {
        reject(new Error('Header HTTP com quebra de linha'));
        return;
      }
      args.push('--header', `${key}: ${value}`);
    }
    args.push(url);
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      windowsHide: true,
      stdio: [usesStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (usesStdin) {
      // Cookie vai pelo arquivo de config na stdin, nunca na linha de comando.
      // curl curto pode fechar a stdin antes do write: sem o handler de 'error',
      // um EPIPE derrubaria o processo main.
      child.stdin.on('error', () => {});
      try {
        child.stdin.end(curlCookieConfig(cookie));
      } catch (error) {
        child.kill();
        reject(error);
        return;
      }
    }
    if (signal) {
      if (signal.aborted) child.kill();
      else signal.addEventListener('abort', () => child.kill(), { once: true });
    }
    const chunks = [];
    let size = 0;
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes + 65536) {
        child.kill();
        reject(new Error('Resposta da API excedeu o teto de tamanho'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error.code === 'ENOENT' ? new Error('curl não disponível no sistema') : error);
    });
    child.on('close', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const markerIndex = raw.lastIndexOf(CODE_MARKER);
      if (markerIndex === -1) {
        reject(new Error(`curl falhou sem status HTTP${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      resolve({ status: Number.parseInt(raw.slice(markerIndex + CODE_MARKER.length), 10) || 0, text: raw.slice(0, markerIndex) });
    });
  });
}

export function channelApiUrl(slug) {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(slug)) throw new Error('Slug de canal inválido');
  return `https://kick.com/api/v2/channels/${slug}`;
}

// https + host confiável + sem userinfo: "https://live-video.net@evil.com/x" tem
// hostname evil.com (o teste de sufixo já rejeita), e "https://user@live-video.net/x"
// é rejeitado explicitamente pelo username.
export function isTrustedHlsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return HLS_TRUSTED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

function trustedJoin(base, reference) {
  let url;
  try {
    url = new URL(reference, base);
  } catch {
    throw new Error('Referência inválida no playlist HLS');
  }
  if (!isTrustedHlsUrl(url.href)) {
    throw new Error(`Playlist HLS aponta para host não confiável: ${url.hostname}`);
  }
  return url.href;
}

// Separa atributos "KEY=VALUE" respeitando valores entre aspas (CODECS contém vírgula).
function parseAttrs(text) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of text.matchAll(re)) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    attrs[key] = value;
  }
  return attrs;
}

// Linha "#EXT-X-STREAM-INF:..." seguida da URL da variante (linha seguinte não-comentário).
export function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttrs(lines[i].slice('#EXT-X-STREAM-INF:'.length));
    let urlLine = '';
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line || line.startsWith('#')) continue;
      urlLine = line;
      i = j;
      break;
    }
    if (!urlLine) continue;
    variants.push({
      url: trustedJoin(baseUrl, urlLine),
      bandwidth: Number.parseInt(attrs.BANDWIDTH, 10) || 0,
      resolution: attrs.RESOLUTION || null,
      video: attrs.VIDEO || null,
    });
  }
  if (!variants.length) throw new Error('Master playlist sem variantes');
  return variants;
}

export function pickLowestVariant(variants) {
  return [...variants].sort((a, b) => a.bandwidth - b.bandwidth)[0];
}

// #EXTINF seguido da URL do segmento; #EXT-X-MAP carrega o init como URI="...".
export function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let targetDuration = null;
  let mediaSequence = 0;
  let endlist = false;
  let mapUrl = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseFloat(line.split(':')[1]) || null;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number.parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      endlist = true;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = parseAttrs(line.slice('#EXT-X-MAP:'.length)).URI;
      if (uri) mapUrl = trustedJoin(baseUrl, uri);
    } else if (line.startsWith('#EXTINF')) {
      let urlLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (!candidate || candidate.startsWith('#')) continue;
        urlLine = candidate;
        i = j;
        break;
      }
      if (urlLine) segments.push(trustedJoin(baseUrl, urlLine));
    }
  }
  if (!segments.length && !mapUrl) throw new Error('Media playlist sem segmentos');
  return { segments, targetDuration, mediaSequence, endlist, mapUrl };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Consome o corpo contando bytes até o teto; nada é armazenado nem decodificado.
async function drain(response, maxBytes) {
  const reader = response.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Resposta excedeu o teto de ${maxBytes} bytes`);
    }
  }
  return total;
}

// Ciclo de presença de um canal: resolve → master → consumo contínuo de segmentos
// novos (o backlog inicial é marcado como visto para não baixar a janela toda).
// Erros são registrados e o ciclo volta para a resolução do canal; canal offline é
// estado normal, não falha.
export class KickHeadlessRunner {
  constructor(slug, {
    fetchImpl = globalThis.fetch,
    apiFetcher = curlTextFetcher, // API do Kick via curl do sistema (Cloudflare)
    cookie = null,        // cookies da sessão do slot (conta certa acumula pontos)
    pollMs = null,        // null = deriva do TARGETDURATION (mínimo 1 s)
    offlineMs = 30_000,
    errorMs = 5_000,
    resolveFailuresBeforeSlowDown = 5,
    resolveFailureMs = 60_000,
    log = () => {},
  } = {}) {
    this.slug = slug;
    this.fetchImpl = fetchImpl;
    this.apiFetcher = apiFetcher;
    this.cookie = cookie;
    this.pollMs = pollMs;
    this.offlineMs = offlineMs;
    this.errorMs = errorMs;
    this.resolveFailuresBeforeSlowDown = resolveFailuresBeforeSlowDown;
    this.resolveFailureMs = resolveFailureMs;
    this.log = log;

    this.stopped = false;
    this.phase = 'idle';
    this.activeControllers = new Set();
    this.bytesIn = 0;
    this.segmentsIn = 0;
    this.errorCount = 0;
    this.lastError = null;
    this.lastSegmentAt = null;
    this.bitrate = null;
    this.variant = null;
    this.startedAt = null;
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
    // Interrompe tudo em voo: requisições fetch e o processo curl da API.
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
    return this;
  }

  // Canal com transferência recente de segmentos.
  active() {
    return this.lastSegmentAt !== null && (Date.now() - this.lastSegmentAt) < ACTIVE_WINDOW_MS;
  }

  snapshot() {
    const elapsedS = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    return {
      slug: this.slug,
      phase: this.stopped && this.phase !== 'stopped' ? `${this.phase} (parado)` : this.phase,
      active: this.active(),
      segments: this.segmentsIn,
      bytes: this.bytesIn,
      elapsedSeconds: Math.round(elapsedS),
      avgKbps: elapsedS > 0 ? Math.round((this.bytesIn * 8) / elapsedS / 1000) : 0,
      bitrate: this.bitrate,
      resolution: this.variant?.resolution ?? null,
      errors: this.errorCount,
      lastError: this.lastError,
      lastSegmentAt: this.lastSegmentAt,
    };
  }

  recordError(message) {
    this.errorCount += 1;
    this.lastError = message;
    this.log(`[kick-headless:${this.slug}] ${message}`);
  }

  async fetchLimited(url, { timeoutMs, maxBytes, headers }) {
    if (!isTrustedHlsUrl(url) && !this.isApiUrl(url)) {
      throw new Error(`URL fora da allowlist: ${url}`);
    }
    this.lastRequestUrl = url;
    const response = await this.openWithTimeout(url, timeoutMs, headers);
    this.assertPlainResponse(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Resposta excedeu o teto de ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }

  // AbortController manual em vez de AbortSignal.timeout: o timer é limpo ao
  // terminar e o stop() cancela as requisições em voo (há 2 downloads de
  // segmento simultâneos, por isso o registro em conjunto e não num slot único).
  async openWithTimeout(url, timeoutMs, headers) {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error(`timeout de ${timeoutMs}ms`)), timeoutMs);
    try {
      return await this.fetchImpl(url, { headers, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    }
  }

  assertPlainResponse(response) {
    if (response.status >= 300 && response.status < 400) {
      response.body?.cancel()?.catch?.(() => {});
      throw new Error(`Redirecionamento inesperado (${response.status})`);
    }
    if (!response.ok) {
      response.body?.cancel()?.catch?.(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
  }

  isApiUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:'
        && !parsed.username && !parsed.password
        && (!parsed.port || parsed.port === '443')
        && KICK_API_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  async runLoop() {
    let resolveFailures = 0;
    while (!this.stopped) {
      try {
        this.phase = 'resolving';
        const apiUrl = channelApiUrl(this.slug);
        this.lastRequestUrl = apiUrl;
        const apiController = new AbortController();
        this.activeControllers.add(apiController);
        let apiResponse;
        try {
          apiResponse = await this.apiFetcher(apiUrl, {
            timeoutMs: PLAYLIST_TIMEOUT_MS,
            maxBytes: MAX_PLAYLIST_BYTES,
            headers: BROWSER_HEADERS,
            cookie: this.cookie,
            signal: apiController.signal,
          });
        } finally {
          this.activeControllers.delete(apiController);
        }
        if (this.stopped) break;
        const { status, text } = apiResponse;
        if (status < 200 || status >= 300) {
          throw new Error(`HTTP ${status}`);
        }
        const channel = JSON.parse(text);
        const playbackUrl = channel?.playback_url;
        if (!playbackUrl || channel?.livestream == null) {
          this.phase = 'offline';
          this.bitrate = null;
          this.variant = null;
          resolveFailures = 0;
          await this.sleepUnlessStopped(this.offlineMs);
          continue;
        }
        if (!isTrustedHlsUrl(playbackUrl)) {
          throw new Error('playback_url fora dos hosts confiáveis');
        }
        const masterText = await this.fetchText(playbackUrl, MAX_PLAYLIST_BYTES);
        if (this.stopped) break;
        const variant = pickLowestVariant(parseMasterPlaylist(masterText, playbackUrl));
        this.variant = variant;
        this.bitrate = variant.bandwidth;
        await this.consumeLoop(variant.url);
        if (this.stopped) break;
        // Live encerrada (ENDLIST): pausa antes de re-resolver — a API pode demorar
        // a refletir o fim, e re-resolver sem pausa viraria loop quente.
        resolveFailures = 0;
        await this.sleepUnlessStopped(this.offlineMs);
      } catch (error) {
        // Abort pós-stop não é falha real: encerra sem registrar nem esperar.
        if (this.stopped) break;
        const message = String(error?.message ?? error);
        if (message.includes('HTTP 403') && this.isApiUrl(this.lastRequestUrl ?? '')) {
          this.recordError(`${message} (possível bloqueio Cloudflare na API)`);
        } else {
          this.recordError(message);
        }
        this.phase = 'error';
        resolveFailures += 1;
        const backoff = resolveFailures >= this.resolveFailuresBeforeSlowDown
          ? this.resolveFailureMs
          : this.errorMs;
        await this.sleepUnlessStopped(backoff);
      }
    }
    this.phase = 'stopped';
  }

  async fetchText(url, maxBytes) {
    return this.fetchLimited(url, {
      timeoutMs: PLAYLIST_TIMEOUT_MS,
      maxBytes,
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Accept': '*/*' },
    });
  }

  // Consome a liveedge: playlist a cada ciclo, segmentos novos em paralelo limitado.
  // Volta quando o playlist traz ENDLIST (live encerrada) — o chamador resolve de
  // novo. Falhas pontuais de playlist (404 na borda da janela, timeout) são
  // toleradas por algumas tentativas antes de derrubar a sessão inteira.
  async consumeLoop(playlistUrl) {
    this.phase = 'playing';
    const seen = new Set();
    let pollMs = this.pollMs;
    let lastMediaSequence = null;
    let playlistFailures = 0;
    while (!this.stopped) {
      let media;
      try {
        const mediaText = await this.fetchText(playlistUrl, MAX_PLAYLIST_BYTES);
        media = parseMediaPlaylist(mediaText, playlistUrl);
      } catch (error) {
        if (this.stopped) return;
        playlistFailures += 1;
        if (playlistFailures >= 3) throw error;
        this.recordError(`playlist: ${String(error?.message ?? error)}`);
        await this.sleepUnlessStopped(this.errorMs);
        continue;
      }
      playlistFailures = 0;
      if (pollMs === null) {
        pollMs = Math.max(1000, ((media.targetDuration ?? 2) / 2) * 1000);
      }
      if (lastMediaSequence === null) {
        // Primeiro snapshot: marca a janela atual como vista — presença segue a
        // liveedge, sem baixar o backlog de ~60 s de uma vez.
        for (const segment of media.segments) rememberSeen(seen, segment);
        if (media.mapUrl) rememberSeen(seen, media.mapUrl);
        lastMediaSequence = media.mediaSequence;
      } else if (media.mediaSequence <= lastMediaSequence && media.segments.every((s) => seen.has(s))) {
        // Nada novo (playlist ainda na mesma janela).
      } else {
        lastMediaSequence = media.mediaSequence;
        const fresh = media.segments.filter((segment) => !seen.has(segment));
        if (media.mapUrl && !seen.has(media.mapUrl)) {
          fresh.unshift(media.mapUrl);
          rememberSeen(seen, media.mapUrl);
        }
        // Download em pares: 2 em voo, descartando os bytes.
        const workers = Array.from({ length: Math.min(2, fresh.length) }, async () => {
          for (;;) {
            const segment = fresh.shift();
            if (segment === undefined || this.stopped) return;
            rememberSeen(seen, segment);
            try {
              await this.drainSegment(segment);
              this.segmentsIn += 1;
              this.lastSegmentAt = Date.now();
            } catch (error) {
              // Segmento expirado/404 é normal na liveedge; registra e segue.
              this.recordError(`segmento: ${String(error?.message ?? error)}`);
            }
          }
        });
        await Promise.all(workers);
      }
      if (media.endlist) return;
      await this.sleepUnlessStopped(pollMs);
    }
  }

  async drainSegment(url) {
    const response = await this.openWithTimeout(
      url,
      SEGMENT_TIMEOUT_MS,
      { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Accept': '*/*' },
    );
    this.assertPlainResponse(response);
    this.bytesIn += await drain(response, MAX_SEGMENT_BYTES);
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
