import {
  GAME_URL,
  TWITCH_HOME_URL,
  KICK_HOME_URL,
  LIMITS,
  isTwitchHost,
  isKickHost,
  streamPlayerUrl,
  twitchLoginFromUrl,
  kickLoginFromUrl,
} from '../../shared/config.js';

// Painel: webview de stream (Twitch ou Kick) visível no lugar do jogo, com uma faixa
// de controles própria no topo — nada é sobreposto à página. Um painel aberto por vez.
// Streams: um webview escondido, mudo e tocando por canal de cada plataforma (bônus
// de XP); todos compartilham a partição do slot, logo o mesmo login da plataforma.

const PLATFORMS = {
  twitch: { home: TWITCH_HOME_URL, label: 'Twitch', icon: '📺', loginFromUrl: twitchLoginFromUrl },
  kick: { home: KICK_HOME_URL, label: 'Kick', icon: '🟩', loginFromUrl: kickLoginFromUrl },
};

// Reinícios automáticos seguidos após crash do renderer; ao esgotar, a stream é
// marcada como problema (⚠ no chip) e uma nova rodada é agendada em 60 s.
const STREAM_RELOAD_LIMIT = 3;
const STREAM_RETRY_BACKOFF_MS = 60_000;

// Na retomada, cada stream de fundo só começa a carregar depois da anterior: spawnar
// todos os renderers de uma vez travava a inicialização para quem tem vários canais.
const STREAM_BOOT_STAGGER_MS = 400;

// Best-effort: abre as configurações do player, entra em "Qualidade" e escolhe a
// opção mais baixa (menor número "NNNp"). Seletor por texto — se a Twitch/Kick
// mudar o DOM, a injeção apenas não faz nada.
const LOW_QUALITY_SCRIPT = `(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('data-tip-text') || el.textContent || '').trim().toLowerCase();
  const candidates = () => [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="menuitemradio"], li, label')];
  const findByText = (words) => candidates().find((el) => words.some((w) => textOf(el).includes(w)));
  const press = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return (async () => {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      try {
        const gear = findByText(['settings', 'configura', 'defini']);
        if (!gear) { await sleep(2000); continue; }
        press(gear);
        await sleep(700);
        const itemQualidade = findByText(['qualidade', 'quality']);
        if (!itemQualidade) { press(gear); await sleep(500); continue; }
        press(itemQualidade);
        await sleep(700);
        const opcoes = [...document.querySelectorAll('[role="menuitemradio"], li, button, label')]
          .map((el) => ({ el, qualidade: Number(((textOf(el).match(/(\\d{3,4})p/) ?? [])[1] ?? NaN) || NaN) }))
          .filter((opcao) => Number.isFinite(opcao.qualidade))
          .sort((a, b) => a.qualidade - b.qualidade);
        if (!opcoes.length) { press(gear); await sleep(500); continue; }
        press(opcoes[0].el);
        return true;
      } catch {
        await sleep(1500);
      }
    }
    return false;
  })();
})()`;

export class GameSlot {
  constructor(slot, {
    onStateChange = () => {},
    onPanelBackground = () => {},
    onPanelClose = () => {},
    onStreamRemove = () => {},
    onStreamsCloseAll = () => {},
    onStreamShow = () => {},
    // Modo leve POR plataforma: { twitch: bool, kick: bool }. No fallback da Twitch,
    // só ela volta a webview — o Kick da mesma aba continua headless.
    lightPlatforms = { twitch: false, kick: false },
  } = {}) {
    this.id = slot.id;
    this.slot = slot;
    this.lightPlatforms = { twitch: Boolean(lightPlatforms.twitch), kick: Boolean(lightPlatforms.kick) };
    this.zoomPct = slot.zoom;
    this.muted = slot.muted;
    this.onStateChange = onStateChange;
    this.onPanelBackground = onPanelBackground;
    this.onPanelClose = onPanelClose;
    this.onStreamRemove = onStreamRemove;
    this.onStreamsCloseAll = onStreamsCloseAll;
    this.onStreamShow = onStreamShow;

    this.root = document.createElement('div');
    this.root.className = 'slot';
    this.root.dataset.slotId = String(slot.id);

    this.webview = document.createElement('webview');
    this.webview.className = 'webview-game';
    this.webview.setAttribute('src', GAME_URL);
    this.webview.setAttribute('partition', `persist:slot-${slot.id}`);
    this.webview.setAttribute('allowpopups', '');
    this.root.appendChild(this.webview);

    this.overlay = document.createElement('div');
    this.overlay.className = 'slot-overlay hidden';
    const msg = document.createElement('p');
    msg.textContent = 'O jogo parou de responder.';
    const btn = document.createElement('button');
    btn.textContent = 'Recarregar';
    btn.addEventListener('click', () => this.reload());
    this.overlay.append(msg, btn);
    this.root.appendChild(this.overlay);

    this.panelWebview = null;
    this.panelPlatform = null;
    this.streamWrap = null;
    this.streamHeaderLabel = null;
    this.streamsBar = null;
    this.streams = { twitch: new Map(), kick: new Map() }; // login → webview, por plataforma
    this.pendingStreams = new Set(); // "platform:login" agendados na retomada, ainda sem webview
    this.bootQueue = [];
    this.bootTimer = null;
    this.reloadAttempts = new WeakMap();
    this.broken = new Set(); // "platform:login" com crash persistente
    this.retryTimers = new WeakMap();
    this.lowQuality = true;

    // Retomada no boot: partição persiste o login, então os canais voltam direto em
    // segundo plano — criados em fila (STREAM_BOOT_STAGGER_MS entre cada um).
    // Plataformas em modo leve não nascem com webview: a presença é do processo
    // main (headless) e as pills são virtuais, alimentadas pelas listas da config.
    for (const platform of Object.keys(PLATFORMS)) {
      if (this.isLight(platform)) continue;
      for (const login of slot[`${platform}Channels`] ?? []) {
        this.pendingStreams.add(`${platform}:${login}`);
        this.bootQueue.push({ platform, login });
      }
    }
    this.pumpBootQueue();

    this.webview.addEventListener('dom-ready', () => {
      this.webview.setZoomFactor(this.zoomPct / 100);
      this.webview.setAudioMuted(this.muted);
    });
    this.webview.addEventListener('did-start-loading', () => this.onStateChange());
    this.webview.addEventListener('did-stop-loading', () => this.onStateChange());
    this.webview.addEventListener('render-process-gone', () => this.overlay.classList.remove('hidden'));
  }

  isLoading() {
    try { return this.webview.isLoading(); } catch { return false; }
  }

  setZoom(pct) {
    this.zoomPct = pct;
    try { this.webview.setZoomFactor(pct / 100); } catch {}
  }

  setMuted(muted) {
    this.muted = muted;
    try { this.webview.setAudioMuted(muted); } catch {}
  }

  reload() {
    this.overlay.classList.add('hidden');
    try {
      this.webview.reload();
    } catch {
      this.webview.setAttribute('src', GAME_URL);
    }
  }

  isPanelOpen(platform = null) {
    return Boolean(this.panelWebview) && (platform === null || this.panelPlatform === platform);
  }

  // Modo leve da plataforma nesta aba (o fallback da Twitch pode desligá-la sozinho).
  isLight(platform) {
    return Boolean(this.lightPlatforms?.[platform]);
  }

  hasStream(platform, login) {
    if (this.isLight(platform)) {
      // Modo leve: a verdade é a lista persistida da aba (presença no main).
      return (this.slot[`${platform}Channels`] ?? []).includes(login);
    }
    if (this.streams[platform]?.has(login)) return true;
    return this.pendingStreams.has(`${platform}:${login}`);
  }

  // Streams de segundo plano com crash persistente (exibidas como ⚠ no chip).
  brokenStreams() {
    return [...this.broken].map((key) => {
      const [platform, login] = key.split(':');
      return { platform, login };
    });
  }

  // ── Painel de stream ──────────────────────────────────────────────────────

  openPanel(platform, url) {
    if (!PLATFORMS[platform]) return;
    if (!this.streamWrap) this.createStreamUi();
    if (this.panelWebview && this.panelPlatform !== platform) {
      // Troca de plataforma: o painel anterior é encerrado.
      this.panelWebview.remove();
      this.panelWebview = null;
    }
    this.panelPlatform = platform;
    if (!this.panelWebview) {
      this.createPanelWebview(platform, url || PLATFORMS[platform].home);
    } else if (url) {
      try { this.panelWebview.loadURL(url); } catch { this.panelWebview.setAttribute('src', url); }
    }
    this.applyPanelState();
  }

  closePanel() {
    if (this.panelWebview) this.clearRetryTimer(this.panelWebview);
    this.panelWebview?.remove();
    this.panelWebview = null;
    this.panelPlatform = null;
    this.applyPanelState();
  }

  // Traz uma stream de segundo plano de volta ao painel visível (ex.: resgatar pontos
  // na Kick). Ela sai da lista de segundo plano enquanto estiver no painel; o botão
  // "Segundo plano" a devolve.
  openStreamInPanel(platform, login) {
    if (this.isLight(platform)) {
      // Sem webview escondido para trazer de volta: o painel nasce agora, com a
      // página completa (chat/points visíveis). O main para a presença headless
      // desse canal quando ele sai da lista da config.
      if (!PLATFORMS[platform]) return;
      if (this.panelWebview && this.panelPlatform !== platform) {
        this.panelWebview.remove();
        this.panelWebview = null;
      }
      this.panelPlatform = platform;
      if (!this.panelWebview) {
        this.createPanelWebview(platform, `${PLATFORMS[platform].home}${login}`);
      } else {
        this.navigateToFullChannel(login);
      }
      this.applyPanelState();
      this.onStateChange();
      return;
    }
    const wv = this.streams[platform]?.get(login);
    if (!wv) return;
    if (this.panelWebview && this.panelWebview !== wv) this.panelWebview.remove();
    this.clearRetryTimer(wv);
    this.streams[platform].delete(login);
    this.broken.delete(`${platform}:${login}`);
    wv.classList.remove('hidden');
    this.panelWebview = wv;
    this.panelPlatform = platform;
    this.streamWrap.appendChild(wv);
    this.updateStreamsBar();
    // O fundo roda no player leve (sem chat nem pontos); visível, o canal volta à
    // página completa. A recarga é aceitável aqui — é ação explícita do usuário — e a
    // volta ao fundo compara a URL, não recarregando à toa.
    try {
      if ((wv.getURL() ?? '') !== `${PLATFORMS[platform].home}${login}`) wv.loadURL(`${PLATFORMS[platform].home}${login}`);
    } catch {
      wv.setAttribute('src', `${PLATFORMS[platform].home}${login}`);
    }
    this.applyPanelState();
    this.onStateChange();
  }

  // Converte o canal aberto no painel em stream de segundo plano; devolve { platform, login }.
  sendPanelToBackground() {
    if (!this.panelWebview) return null;
    const platform = this.panelPlatform;
    const login = PLATFORMS[platform].loginFromUrl(this.panelUrl());
    const wv = this.panelWebview;
    this.panelWebview = null;
    this.panelPlatform = null;
    if (this.isLight(platform)) {
      // O webview do painel morre aqui; quem assume o segundo plano é a presença
      // headless do main (a lista da config é atualizada pelo app.js).
      wv.remove();
      this.applyPanelState();
      return { platform, login };
    }
    // Move para fora do painel: vira stream escondida que continua tocando.
    wv.classList.add('hidden');
    this.root.appendChild(wv);
    if (!login || !this.registerStream(platform, login, wv)) {
      // Sem canal identificado (ou já assistido): o painel é descartado.
      wv.remove();
    } else {
      // O painel usava a página completa: navega ao player leve para o fundo não
      // carregar chat/UI à toa. O did-finish-load do novo load aplica a qualidade mínima.
      this.navigateToLightPlayer(wv, platform, login);
    }
    this.applyPanelState();
    return { platform, login };
  }

  applyPanelState() {
    const open = Boolean(this.panelWebview);
    this.webview.classList.toggle('hidden', open);
    this.streamWrap?.classList.toggle('hidden', !open);
    if (open) this.updateStreamHeaderLabel();
    this.onStateChange();
  }

  updateStreamHeaderLabel() {
    if (!this.streamHeaderLabel || !this.panelWebview) return;
    const meta = PLATFORMS[this.panelPlatform];
    const login = meta.loginFromUrl(this.panelUrl());
    this.streamHeaderLabel.textContent = login ? `${meta.label} · ${login}` : meta.label;
  }

  panelUrl() {
    try { return this.panelWebview.getURL() ?? ''; } catch { return ''; }
  }

  createPanelWebview(platform, url) {
    const wv = document.createElement('webview');
    wv.className = 'webview-twitch';
    wv.setAttribute('src', url);
    wv.setAttribute('partition', `persist:slot-${this.id}`);
    wv.setAttribute('allowpopups', '');
    this.attachStreamListeners(wv);
    this.panelWebview = wv;
    this.streamWrap.appendChild(wv);
  }

  // Faixa de controles do painel, no topo da aba — a página fica abaixo dela.
  createStreamUi() {
    if (this.streamWrap) return;
    const wrap = document.createElement('div');
    wrap.className = 'twitch-wrap hidden';

    const header = document.createElement('div');
    header.className = 'twitch-header';
    this.streamsBar = document.createElement('div');
    this.streamsBar.className = 'twitch-streams';
    this.streamHeaderLabel = document.createElement('span');
    this.streamHeaderLabel.className = 'twitch-header-label';
    const toBackground = document.createElement('button');
    toBackground.className = 'twitch-header-btn';
    toBackground.textContent = 'Segundo plano';
    toBackground.title = 'Este canal continua tocando escondido (bônus de XP)';
    toBackground.addEventListener('click', () => this.onPanelBackground(this.id));
    const close = document.createElement('button');
    close.className = 'twitch-header-btn';
    close.textContent = 'Fechar';
    close.title = 'Fechar o painel (as streams em segundo plano continuam)';
    close.addEventListener('click', () => this.onPanelClose(this.id));
    header.append(this.streamsBar, this.streamHeaderLabel, toBackground, close);

    wrap.appendChild(header);
    this.streamWrap = wrap;
    this.root.appendChild(wrap);
    this.updateStreamsBar();
  }

  // ── Streams em segundo plano ──────────────────────────────────────────────

  // Consome a fila da retomada: cria a próxima stream e agenda a seguinte.
  // Itens que o usuário fechou enquanto esperavam já saíram da fila.
  pumpBootQueue() {
    const next = this.bootQueue.shift();
    if (!next) return;
    this.pendingStreams.delete(`${next.platform}:${next.login}`);
    try {
      this.createStreamWebview(next.platform, next.login);
    } catch {}
    if (this.bootQueue.length > 0) {
      this.bootTimer = setTimeout(() => this.pumpBootQueue(), STREAM_BOOT_STAGGER_MS);
    }
  }

  openStream(platform, login) {
    // Modo leve: não nasce webview — a presença fica no main e a lista da config
    // (atualizada pelo app.js) é o registro do segundo plano.
    if (this.isLight(platform)) return true;
    return this.createStreamWebview(platform, login);
  }

  createStreamWebview(platform, login) {
    if (!PLATFORMS[platform]) return false;
    if (this.streams[platform].has(login) || this.pendingStreams.has(`${platform}:${login}`) || this.streams[platform].size >= LIMITS.maxStreams) return false;
    const wv = document.createElement('webview');
    wv.className = 'webview-twitch hidden';
    // Player leve (sem chat nem UI do site): a página completa só roda no painel visível.
    wv.setAttribute('src', streamPlayerUrl(platform, login));
    wv.setAttribute('partition', `persist:slot-${this.id}`);
    wv.setAttribute('allowpopups', '');
    this.attachStreamListeners(wv);
    this.root.appendChild(wv);
    return this.registerStream(platform, login, wv);
  }

  registerStream(platform, login, wv) {
    const map = this.streams[platform];
    if (!map || !login || map.has(login) || map.size >= LIMITS.maxStreams) return false;
    wv.dataset.streamPlatform = platform;
    wv.dataset.streamLogin = login;
    map.set(login, wv);
    this.updateStreamsBar();
    return true;
  }

  clearRetryTimer(wv) {
    const timer = this.retryTimers.get(wv);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(wv);
  }

  closeStream(platform, login) {
    this.pendingStreams.delete(`${platform}:${login}`);
    this.bootQueue = this.bootQueue.filter((e) => e.platform !== platform || e.login !== login);
    const wv = this.streams[platform]?.get(login);
    if (wv) {
      this.clearRetryTimer(wv);
      wv.remove();
    }
    this.streams[platform]?.delete(login);
    this.broken.delete(`${platform}:${login}`);
    this.updateStreamsBar();
  }

  closeAllStreams(platform) {
    for (const key of [...this.pendingStreams]) {
      if (key.startsWith(`${platform}:`)) this.pendingStreams.delete(key);
    }
    this.bootQueue = this.bootQueue.filter((e) => e.platform !== platform);
    for (const wv of this.streams[platform]?.values() ?? []) {
      this.clearRetryTimer(wv);
      wv.remove();
    }
    this.streams[platform]?.clear();
    for (const key of [...this.broken]) {
      if (key.startsWith(`${platform}:`)) this.broken.delete(key);
    }
    this.updateStreamsBar();
  }

  updateStreamsBar() {
    if (!this.streamsBar) return;
    this.streamsBar.replaceChildren();
    // Por plataforma: modo leve → pills virtuais da lista persistida; normal →
    // pills das streams (webviews) registradas.
    const sources = Object.keys(PLATFORMS).map((platform) => [
      platform,
      this.isLight(platform) ? (this.slot[`${platform}Channels`] ?? []) : [...this.streams[platform]?.keys() ?? []],
    ]);
    for (const [platform, logins] of sources) {
      for (const login of logins) {
        const pill = document.createElement('span');
        pill.className = 'twitch-stream-pill';
        const name = document.createElement('button');
        name.className = 'twitch-stream-name';
        name.textContent = `${PLATFORMS[platform].icon} ${login}`;
        name.title = `Mostrar ${login} no painel (o canal sai do segundo plano até você devolvê-lo)`;
        name.addEventListener('click', () => this.onStreamShow(this.id, platform, login));
        const remove = document.createElement('button');
        remove.textContent = '×';
        remove.title = `Parar de assistir ${login}`;
        remove.addEventListener('click', () => this.onStreamRemove(this.id, platform, login));
        pill.append(name, remove);
        this.streamsBar.appendChild(pill);
      }
    }
    if (this.streamsBar.children.length > 0) {
      const closeAll = document.createElement('button');
      closeAll.className = 'twitch-stream-close-all';
      closeAll.textContent = 'Fechar todas';
      closeAll.title = `Parar todas as streams em segundo plano desta aba`;
      closeAll.addEventListener('click', () => this.onStreamsCloseAll(this.id));
      this.streamsBar.appendChild(closeAll);
    }
  }

  // ── Comum aos webviews de stream ──────────────────────────────────────────

  attachStreamListeners(wv) {
    wv.addEventListener('dom-ready', () => {
      // Streams em segundo plano são sempre mudas.
      try { wv.setAudioMuted(true); } catch {}
    });
    wv.addEventListener('did-finish-load', () => {
      this.reloadAttempts.set(wv, 0);
      const key = wv.dataset.streamPlatform ? `${wv.dataset.streamPlatform}:${wv.dataset.streamLogin}` : null;
      if (key && this.broken.delete(key)) this.onStateChange();
      if (wv.dataset.streamPlatform) this.injectLowQuality(wv);
    });
    wv.addEventListener('did-navigate', () => {
      if (wv === this.panelWebview) this.updateStreamHeaderLabel();
    });
    // Twitch e Kick navegam por pushState (SPA); sem isso o label do canal fica velho.
    wv.addEventListener('did-navigate-in-page', () => {
      if (wv === this.panelWebview) this.updateStreamHeaderLabel();
    });
    wv.addEventListener('render-process-gone', () => this.handleStreamCrash(wv));
  }

  // Navega ao player leve, a menos que o webview já esteja nele (stream trazida do
  // fundo para o painel e devolvida de volta não deve recarregar à toa).
  navigateToLightPlayer(wv, platform, login) {
    const light = streamPlayerUrl(platform, login);
    if (!light) return;
    let current = '';
    try {
      current = wv.getURL() ?? '';
    } catch {}
    if (current === light) return;
    try {
      wv.loadURL(light);
    } catch {
      wv.setAttribute('src', light);
    }
  }

  // No modo leve o painel nasce na página completa do canal; este helper só evita
  // recarregar quando já estamos nela.
  navigateToFullChannel(login) {
    const target = `${PLATFORMS[this.panelPlatform].home}${login}`;
    let current = '';
    try {
      current = this.panelWebview?.getURL() ?? '';
    } catch {}
    if (current === target) return;
    try {
      this.panelWebview.loadURL(target);
    } catch {
      this.panelWebview.setAttribute('src', target);
    }
  }

  // Força a qualidade mais baixa nas streams escondidas (economia de CPU/GPU).
  injectLowQuality(wv) {
    if (!this.lowQuality) return;
    setTimeout(() => {
      try {
        if (!wv.isConnected || wv.dataset.streamPlatform === undefined) return;
        wv.executeJavaScript(LOW_QUALITY_SCRIPT, true).catch(() => {});
      } catch {}
    }, 3000);
  }

  handleStreamCrash(wv) {
    const platform = wv.dataset.streamPlatform;
    const inUse = wv === this.panelWebview || this.streams[platform]?.has(wv.dataset.streamLogin);
    if (!inUse) return;
    const attempts = this.reloadAttempts.get(wv) ?? 0;
    if (attempts >= STREAM_RELOAD_LIMIT) {
      // Esgotou o ciclo imediato: marca como problema e agenda nova rodada (backoff).
      const key = platform ? `${platform}:${wv.dataset.streamLogin}` : null;
      if (key && !this.broken.has(key)) {
        this.broken.add(key);
        this.onStateChange();
      }
      if (!this.retryTimers.has(wv)) {
        this.retryTimers.set(wv, setTimeout(() => {
          this.retryTimers.delete(wv);
          const stillInUse = wv === this.panelWebview || this.streams[wv.dataset.streamPlatform]?.has(wv.dataset.streamLogin);
          if (stillInUse) {
            this.reloadAttempts.set(wv, 0);
            try { wv.reload(); } catch {}
          }
        }, STREAM_RETRY_BACKOFF_MS));
      }
      return;
    }
    this.reloadAttempts.set(wv, attempts + 1);
    try {
      wv.reload();
    } catch {
      const fallback = this.streamReloadUrl(wv);
      if (fallback) wv.setAttribute('src', fallback);
    }
  }

  // URL para religar o webview após crash: mantém o canal sempre que possível.
  // Sem plataforma conhecida (painel sem dataset), devolve null e não recarrega.
  streamReloadUrl(wv) {
    try {
      const url = wv.getURL();
      const host = url ? new URL(url).hostname : '';
      if (url?.startsWith('https://') && (isTwitchHost(host) || isKickHost(host))) return url;
    } catch {}
    const platform = wv.dataset.streamPlatform ?? (wv === this.panelWebview ? this.panelPlatform : null);
    if (!platform || !PLATFORMS[platform]) return null;
    const login = wv.dataset.streamLogin ?? '';
    // Sem URL válida: stream de fundo religa no player leve; painel cai na home.
    return login ? streamPlayerUrl(platform, login) : PLATFORMS[platform].home;
  }

  unmount() {
    clearTimeout(this.bootTimer);
    this.bootQueue = [];
    this.pendingStreams.clear();
    this.webview.remove();
    if (this.panelWebview) this.clearRetryTimer(this.panelWebview);
    this.panelWebview?.remove();
    this.streamWrap?.remove();
    for (const map of Object.values(this.streams)) {
      for (const wv of map.values()) {
        this.clearRetryTimer(wv);
        wv.remove();
      }
    }
    this.root.remove();
  }
}
