// Executa no mundo da página (contextIsolation off, sandbox on) antes de qualquer script
// da Twitch: desliga WebAuthn para o login nunca abrir o prompt de chave de acesso/passkey
// do Windows, que não funciona dentro do Electron (electron/electron#27355).
try {
  const reject = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
  Object.defineProperty(Navigator.prototype, 'credentials', {
    value: { get: reject, create: reject, store: reject },
    configurable: false,
  });
  window.PublicKeyCredential = undefined;
} catch {}
