// Captura passiva das credenciais IRC da Twitch a partir do próprio webview da
// sessão do slot — o mesmo truque do Moth Controller: o navegador já se autentica
// no chat (PASS oauth:... + NICK) quando abre uma página com chat; aqui a gente
// observa esse tráfego via webContents.debugger (Chrome DevTools Protocol) e
// reaproveita as credenciais para a conexão headless.
//
// O token vive só em memória do processo main: nunca persistido, nunca logado.

const IRC_WS_HOST = 'irc-ws.chat.twitch.tv';

export function isIrcWebSocketUrl(url) {
  try {
    return new URL(url).hostname === IRC_WS_HOST;
  } catch {
    return false;
  }
}

// Frames do IRC chegam "PASS oauth:abc\r\nNICK nick\r\n..." (às vezes separados,
// às vezes com CAP antes). O acumulador guarda o último PASS/NICK vistos até ter
// os dois. Nicks anônimos (justinfan) não são credenciais; token com menos de 10
// caracteres é fragmento de frame e continua acumulando (mesmo piso do
// normalizeCredentials — evita cachear credencial inútil).
export class IrcCredentialCollector {
  push(frame) {
    const text = String(frame ?? '');
    if (!text) return null;
    const pass = /PASS\s+:?oauth:([A-Za-z0-9]+)/i.exec(text);
    if (pass && pass[1].length >= 10) this.token = pass[1];
    const nick = /^NICK\s+([A-Za-z0-9_]+)/im.exec(text);
    if (nick) this.nick = nick[1];
    if (this.token && this.nick && !/^justinfan/i.test(this.nick)) {
      return { nick: this.nick.toLowerCase(), token: this.token };
    }
    return null;
  }
}

// Anexa a escuta a um webContents já existente (painéis que o usuário abrir).
// Devolve a função de desanexo. Debugger é exclusivo por webContents: se o
// DevTools estiver aberto, o attach falha — registrador apenas segue sem captura.
export function attachIrcCapture(contents, { onCredentials, log = () => {} } = {}) {
  let detached = false;
  const collector = new IrcCredentialCollector();
  const socketUrls = new Map(); // requestId → url
  let credentialsSeen = null;

  const detach = () => {
    if (detached) return;
    detached = true;
    try {
      contents.debugger.sendCommand('Network.disable').catch(() => {});
      contents.debugger.detach();
    } catch {}
  };

  const onMessage = (_event, method, params) => {
    if (detached) return;
    try {
      if (method === 'Network.webSocketCreated' && params?.url) {
        socketUrls.set(params.requestId, params.url);
        return;
      }
      if (method === 'Network.webSocketFrameSent' && isIrcWebSocketUrl(socketUrls.get(params?.requestId))) {
        const cred = collector.push(params.response?.payloadData);
        if (cred && !credentialsSeen) {
          credentialsSeen = cred;
          detach();
          onCredentials(cred);
        }
      }
    } catch (error) {
      log(`captura IRC: ${String(error?.message ?? error)}`);
    }
  };

  try {
    contents.debugger.attach('1.3');
  } catch (error) {
    log(`captura IRC indisponível neste webContents: ${String(error?.message ?? error)}`);
    return detach;
  }
  contents.debugger.on('message', onMessage);
  contents.debugger.on('detach', detach);
  contents.debugger.sendCommand('Network.enable').catch(() => {});
  return detach;
}

// Fluxo completo por slot: janela oculta com o chat do primeiro canal da aba,
// mesma sessão (persist:slot-N) — o chat conecta o IRC com a sessão já logada.
// `deps` recebe { BrowserWindow } para testes/colmagem futura. Resolve null em
// timeout ou se a sessão não estiver logada (chat conecta anônimo, sem PASS).
export function captureViaHiddenWindow({
  channel,
  partition,
  deps,
  timeoutMs = 25_000,
  onWebContents,
  log = () => {},
}) {
  return new Promise((resolve) => {
    let settled = false;
    let captureDetach = null;
    let timeout = null;
    const win = new deps.BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      captureDetach?.();
      try { win.destroy(); } catch {}
      resolve(value);
    };

    captureDetach = attachIrcCapture(win.webContents, {
      log,
      onCredentials: (cred) => {
        log(`token IRC capturado para a partição ${partition} (nick ${cred.nick})`);
        finish(cred);
      },
    });
    if (onWebContents) onWebContents(win.webContents, captureDetach);

    timeout = setTimeout(() => finish(null), timeoutMs);
    win.webContents.once('destroyed', () => finish(null));
    win.loadURL(`https://www.twitch.tv/popout/${channel}/chat`).catch(() => finish(null));
  });
}
