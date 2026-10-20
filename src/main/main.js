import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerSaveBlocker, protocol, net, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeConfig, defaultConfig, LIMITS, isTwitchHost, isKickHost, twitchLoginFromUrl, kickLoginFromUrl } from '../shared/config.js';
import { resolveHuntExtensionDir } from './extensions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_HOSTS = new Set(['pokeidle.io', 'www.pokeidle.io']);
const PERMISSIONS_ALLOWED = new Set(['notifications', 'fullscreen', 'pointerLock']);

const configFilePath = () => path.join(app.getPath('userData'), 'config.json');

// ── Bandeja e energia ────────────────────────────────────────────────────────
let tray = null;
let mainWindow = null;
let currentConfig = defaultConfig();
let powerBlockerId = null;
let appIsQuitting = false;
let trayHintShown = false;

const totalStreamCount = (config) =>
  (config.slots ?? []).reduce((total, slot) => total + (slot.twitchChannels?.length ?? 0) + (slot.kickChannels?.length ?? 0), 0);

// Ícone da bandeja: usa o mesmo .ico gerado para o exe (enviado no pacote) e, na
// falta dele, um quadrado verde (cor da Kick) para não deixar a bandeja sem ícone.
function trayIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'resources', 'icon.ico'));
  if (!image.isEmpty()) return image;
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 0x18; // B
    pixels[i * 4 + 1] = 0xfc; // G
    pixels[i * 4 + 2] = 0x53; // R
    pixels[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('PokeIdle Multiview');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar PokeIdle Multiview', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Encerrar',
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', showMainWindow);
}

function shouldHideToTray() {
  return currentConfig.closeToTray === 'always'
    || (currentConfig.closeToTray === 'streams' && totalStreamCount(currentConfig) > 0);
}

function showTrayHintOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  try {
    tray.displayBalloon({
      icon: trayIcon(),
      title: 'PokeIdle Multiview',
      content: 'O app continua rodando na bandeja com as streams ativas. Use o ícone para restaurar ou encerrar.',
    });
  } catch {}
}

// Mantém o PC acordado enquanto houver streams ativas (bônus para se o Windows dormir).
function updateRuntimeBehaviors(config) {
  currentConfig = config;
  const wantBlock = config.keepAwake && totalStreamCount(config) > 0;
  if (wantBlock && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!wantBlock && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function readConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configFilePath(), 'utf8')));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  const target = configFilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, target);
}

function registerAppProtocol() {
  const roots = {
    bundle: path.join(__dirname, '..', 'renderer'),
    shared: path.join(__dirname, '..', 'shared'),
  };
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const root = roots[url.host];
    if (!root) return new Response('not found', { status: 404 });
    let rel;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    } catch {
      return new Response('bad request', { status: 400 });
    }
    let rootDir = root;
    // URL normalization clamps '../..' at the origin root, so renderer relative imports
    // of shared modules arrive as app://bundle/shared/* and must be served from src/shared.
    if (url.host === 'bundle' && (rel === 'shared' || rel.startsWith('shared/'))) {
      rootDir = roots.shared;
      rel = rel.replace(/^shared\/?/, '');
    }
    const target = path.normalize(path.join(rootDir, rel));
    if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function registerIpc() {
  ipcMain.handle('config:load', () => readConfig());
  ipcMain.handle('config:save', (_event, raw) => {
    const normalized = normalizeConfig(raw);
    writeConfig(normalized);
    updateRuntimeBehaviors(normalized);
    return true;
  });
}

// Passkeys/chaves de acesso (WebAuthn) não funcionam em janelas Electron — o prompt do
// Windows trava o login (electron/electron#27355). Desligamos a API nas páginas da Twitch
// e do Google para o login cair direto no formulário clássico (usuário/senha).
const DISABLE_WEBAUTHN_SCRIPT = `(() => {
  try {
    const reject = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
    window.PublicKeyCredential = undefined;
    Object.defineProperty(Navigator.prototype, 'credentials', {
      value: { get: reject, create: reject, store: reject },
      configurable: true,
    });
  } catch {}
})();`;

// Extensões não persistem entre execuções do Electron: recarregar a cada boot é o que mantém
// o app sempre na versão mais recente que o navegador do usuário instalou.
function loadHuntExtension() {
  const dir = resolveHuntExtensionDir();
  if (!dir) {
    console.log('[hunt] extensão "/hunt for PokeIdle" não encontrada em nenhum navegador instalado.');
    return;
  }
  for (let id = 1; id <= LIMITS.maxSlots; id++) {
    try {
      session.fromPartition(`persist:slot-${id}`).extensions.loadExtension(dir);
    } catch (err) {
      console.error(`[hunt] falha ao carregar a extensão no slot ${id}:`, err);
    }
  }
  console.log('[hunt] extensão "/hunt for PokeIdle" carregada de:', dir);
}

function createWindow(config) {
  const win = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  if (config.window.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    const saveGeometry = () => {
      const { width, height } = win.getBounds();
      const current = readConfig() ?? defaultConfig();
      writeConfig(normalizeConfig({ ...current, window: { width, height, maximized: win.isMaximized() } }));
    };
    // × = bandeja quando há streams ativas (configurável); Encerrar de verdade fica
    // no menu da bandeja. A decisão vem antes da gravação — falha de disco não pode
    // derrubar streams que deveriam continuar na bandeja.
    if (!appIsQuitting && shouldHideToTray()) {
      event.preventDefault();
      try { saveGeometry(); } catch {}
      win.hide();
      showTrayHintOnce();
      return;
    }
    try { saveGeometry(); } catch {}
  });
  mainWindow = win;
  if (process.env.POKE_DEBUG === '1') win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

const isPokeidleHost = (hostname) => ALLOWED_HOSTS.has(hostname);

// Domínios de autenticação do Google usados pelo SSO da Twitch/Kick ("Continuar com Google").
const isGoogleAuthHost = (hostname) =>
  hostname === 'accounts.youtube.com' || hostname === 'google.com' || hostname.endsWith('.google.com');

const STREAM_PLATFORMS = {
  twitch: { isHost: isTwitchHost, loginFromUrl: twitchLoginFromUrl, label: 'Twitch' },
  kick: { isHost: isKickHost, loginFromUrl: kickLoginFromUrl, label: 'Kick' },
};

const platformOfHost = (hostname) => (isTwitchHost(hostname) ? 'twitch' : isKickHost(hostname) ? 'kick' : null);

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function currentHostname(contents) {
  return hostnameOf(contents.getURL());
}

// session.fromPartition devolve o mesmo objeto para a mesma partição, então a
// comparação de identidade identifica de qual slot veio o webContents.
function slotIdFromContents(contents) {
  for (let id = 1; id <= LIMITS.maxSlots; id++) {
    if (contents.session === session.fromPartition(`persist:slot-${id}`)) return id;
  }
  return null;
}

// "Vincular" do jogo navega para o OAuth dentro do webview; aqui abrimos essa
// navegação numa janela própria com a mesma sessão do slot. Ela se fecha sozinha
// pouco depois de voltar para o callback do jogo.
function openOAuthWindow(slotId, platform, url) {
  const isPlatformHost = STREAM_PLATFORMS[platform].isHost;
  const isAllowedHost = (host) => ALLOWED_HOSTS.has(host) || isPlatformHost(host) || isGoogleAuthHost(host);
  const oauthWin = new BrowserWindow({
    width: 520,
    height: 760,
    autoHideMenuBar: true,
    title: `Vincular ${STREAM_PLATFORMS[platform].label}`,
    webPreferences: {
      partition: `persist:slot-${slotId}`,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'webauthn-block.cjs'),
    },
  });
  oauthWin.webContents.on('will-navigate', (event, target) => {
    // O SSO ("Continuar com Google") navega para accounts.google.com e volta.
    if (!isAllowedHost(hostnameOf(target))) event.preventDefault();
  });
  oauthWin.webContents.setWindowOpenHandler((details) => (
    { action: isAllowedHost(hostnameOf(details.url)) ? 'allow' : 'deny' }
  ));
  // Ao voltar para o callback no pokeidle, dá tempo de o handshake da vinculação
  // rodar antes de fechar: o timer reinicia a cada carregamento (redirecionamentos
  // do callback não são interrompidos no meio).
  let closeTimer = null;
  oauthWin.webContents.on('did-finish-load', () => {
    if (!isPokeidleHost(hostnameOf(oauthWin.webContents.getURL()))) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!oauthWin.isDestroyed()) oauthWin.close();
    }, 8000);
  });
  oauthWin.on('closed', () => clearTimeout(closeTimer));
  oauthWin.loadURL(url);
}

// Link de canal oficial clicado dentro do jogo: em vez de janela nova, o canal
// vai para o painel/segundo plano da plataforma no próprio slot.
function routeStreamUrlToSlot(mainWindow, slotId, platform, url) {
  if (STREAM_PLATFORMS[platform].loginFromUrl(url)) {
    mainWindow.webContents.send('slot-open-stream', { slotId, platform, url });
  } else {
    openOAuthWindow(slotId, platform, url);
  }
}

function attachWebContentsGuards(mainWindow) {
  app.on('web-contents-created', (_event, contents) => {
    const patchWebAuthn = () => {
      const host = currentHostname(contents);
      if (!isTwitchHost(host) && !isKickHost(host) && !isGoogleAuthHost(host)) return;
      contents.executeJavaScript(DISABLE_WEBAUTHN_SCRIPT, true).catch(() => {});
    };
    contents.on('dom-ready', patchWebAuthn);
    contents.on('did-navigate', patchWebAuthn);
    contents.on('will-attach-webview', (_e, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      // Sem isso o Chromium pausa timers/vídeo de conteúdo escondido: mataria o stream
      // em segundo plano e o jogo que fica por trás do painel.
      webPreferences.backgroundThrottling = false;
      // Webviews de stream ganham um preload no mundo da página (sandbox ativo, sem
      // acesso a Node) que desliga WebAuthn antes dos scripts dela rodarem.
      const src = params.src ?? '';
      if (src.includes('twitch.tv') || src.includes('kick.com')) {
        webPreferences.contextIsolation = false;
        webPreferences.preload = path.join(__dirname, 'webauthn-block.cjs');
      }
    });
    if (contents.getType() !== 'webview') return;
    contents.on('will-navigate', (event, url) => {
      const host = hostnameOf(url);
      const from = currentHostname(contents);
      // Webview do jogo navegando para Twitch/Kick: "Vincular" (OAuth) abre janela
      // própria; link de canal oficial vai para o painel do slot.
      const targetPlatform = platformOfHost(host);
      if (isPokeidleHost(from) && targetPlatform) {
        event.preventDefault();
        const slotId = slotIdFromContents(contents);
        if (slotId) routeStreamUrlToSlot(mainWindow, slotId, targetPlatform, url);
        return;
      }
      // Cada webview fica preso ao "mundo" da sua URL atual: o do jogo a pokeidle.io,
      // o de stream à sua plataforma (twitch.tv ou kick.com). Contas que só entram pelo
      // Google SSO precisam do triângulo plataforma ↔ accounts.google.com.
      const fromEmpty = !from;
      const fromPlatform = platformOfHost(from);
      const fromGoogle = isGoogleAuthHost(from);
      if (ALLOWED_HOSTS.has(host) && (fromEmpty || isPokeidleHost(from))) return;
      if (targetPlatform && (fromEmpty || fromGoogle || fromPlatform === targetPlatform)) return;
      // O login do Google navega entre páginas dele mesmo (conta → senha → consentimento).
      if (isGoogleAuthHost(host) && (fromEmpty || fromPlatform || fromGoogle)) return;
      event.preventDefault();
    });
    contents.setWindowOpenHandler((details) => {
      // Popups do webview do jogo para Twitch/Kick (links de canais oficiais,
      // target=_blank): em vez de janela solta, alimentam o painel do próprio slot.
      const from = currentHostname(contents);
      const targetPlatform = platformOfHost(hostnameOf(details.url));
      if (isPokeidleHost(from) && targetPlatform) {
        const slotId = slotIdFromContents(contents);
        if (slotId) {
          routeStreamUrlToSlot(mainWindow, slotId, targetPlatform, details.url);
          return { action: 'deny' };
        }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true },
      };
    });
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(PERMISSIONS_ALLOWED.has(permission));
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.shift || input.meta) return;
      const n = Number.parseInt(input.key, 10);
      if (n >= 1 && n <= LIMITS.maxSlots) {
        event.preventDefault();
        mainWindow.webContents.send('slot-focus-hotkey', n);
      }
    });
  });
}

app.on('second-instance', () => showMainWindow());

app.on('before-quit', () => {
  appIsQuitting = true;
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  loadHuntExtension();
  Menu.setApplicationMenu(null);
  const config = readConfig() ?? defaultConfig();
  const win = createWindow(config);
  attachWebContentsGuards(win);
  updateRuntimeBehaviors(config);
  createTray();
  win.loadURL('app://bundle/index.html');
});
