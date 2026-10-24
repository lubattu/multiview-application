// Máquina de estados da captura do token Twitch por aba — extraída do main.js para
// ser testável sem Electron. Controla tentativas, captura em voo e fallback
// (twitch da aba volta a webview quando a captura/recusa esgota).
//
// Contagem de rodadas: captura sem resultado E recusa de autenticação contam as
// duas — token recusado recapturado é o MESMO token, e sem contar recusa o par
// capturar↔recusar não termina nunca.

export function createCaptureCoordinator({
  maxAttempts = 2,
  onFallback = () => {},
  onRecovery = () => {},
} = {}) {
  const slots = new Map(); // slotId → { attempts, inFlight, fallback }

  const entry = (slotId) => {
    let s = slots.get(slotId);
    if (!s) {
      s = { attempts: 0, inFlight: false, fallback: false };
      slots.set(slotId, s);
    }
    return s;
  };

  const declareFallback = (slotId) => {
    const s = entry(slotId);
    if (!s.fallback) {
      s.fallback = true;
      onFallback(slotId);
    }
  };

  return {
    // Deve uma captura começar agora? Canais da twitch presentes, sem credencial
    // válida, sem fallback, sem captura em voo e com rodadas restantes.
    shouldCapture(slotId, { hasCredential, hasChannels }) {
      if (!hasChannels || hasCredential) return false;
      const s = entry(slotId);
      if (s.fallback || s.inFlight) return false;
      if (s.attempts >= maxAttempts) {
        declareFallback(slotId);
        return false;
      }
      return true;
    },

    begin(slotId) {
      entry(slotId).inFlight = true;
    },

    // Fim de uma captura iniciada. ok = credencial obtida — MAS não zera tentativas:
    // token capturado ainda pode ser recusado, e zerar aqui faria o par
    // capturar↔recusar recomeçar do zero para sempre. O reset só acontece quando a
    // sessão se renova de verdade (reportExternalCredential, webview do usuário).
    end(slotId, { ok }) {
      const s = entry(slotId);
      s.inFlight = false;
      if (!ok) {
        s.attempts += 1;
        if (s.attempts >= maxAttempts) declareFallback(slotId);
      }
    },

    // O runner IRC foi recusado pela Twitch usando a credencial vigente.
    reportAuthRefused(slotId) {
      const s = entry(slotId);
      if (s.fallback) return;
      s.attempts += 1;
      if (s.attempts >= maxAttempts) declareFallback(slotId);
    },

    // Credencial chegou de fora (webview aberto pelo usuário). Limpa fallback:
    // se o token for recusado, a contagem reconverge para o fallback de novo.
    reportExternalCredential(slotId) {
      const s = entry(slotId);
      const wasFallback = s.fallback;
      s.attempts = 0;
      s.fallback = false;
      if (wasFallback) onRecovery(slotId);
      return wasFallback;
    },

    isFallback(slotId) {
      return entry(slotId).fallback;
    },

    capturingSlots() {
      return [...slots.entries()].filter(([, s]) => s.inFlight).map(([id]) => id);
    },

    fallbackSlots() {
      return [...slots.entries()].filter(([, s]) => s.fallback).map(([id]) => id);
    },

    resetAll() {
      slots.clear();
    },
  };
}
