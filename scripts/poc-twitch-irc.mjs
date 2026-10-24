// Harness do PoC de presença headless na Twitch via IRC: conecta no chat do(s)
// canal(is) anônimo(s) e imprime métricas periódicas. Canal offline não rende bônus
// nenhum, então antes de conectar o harness aguarda algum canal ficar ao vivo — a
// duração pedida só começa a contar quando o IRC realmente entra no canal.
// Uso: node scripts/poc-twitch-irc.mjs <canal[,canal2,...]> [minutos=30]
//
// Este script não faz parte do app; valida o conceito antes da integração. O
// julgamento final é o contador de Bônus Twitch dentro do jogo.

import process from 'node:process';
import { TwitchIrcRunner, normalizeChannelList } from '../src/main/twitch-irc-headless.js';

const [channelsArg, minutesArg] = process.argv.slice(2);
if (!channelsArg) {
  console.error('Uso: node scripts/poc-twitch-irc.mjs <canal[,canal2,...]> [minutos=30]');
  process.exit(2);
}
let channels;
try {
  channels = normalizeChannelList(channelsArg.split(','));
} catch (error) {
  console.error(String(error.message));
  process.exit(2);
}
const durationMs = Math.max(1, Number.parseInt(minutesArg ?? '30', 10) || 30) * 60_000;

// Status ao vivo direto do HTML da página do canal (mesma página que o navegador
// abre; contém "isLiveBroadcast":true|false). Retorna:
//   true/false — sinal presente na página;
//   null       — não deu para determinar (rede, HTML sem o sinal): conecta mesmo assim.
// (Uma versão anterior usava a GQL com client-id público; a Twitch passou a rejeitá-lo
// e o parser tratava o erro como "offline" — checagem pouco confiável, substituída.)
async function isTwitchLive(login) {
  try {
    const response = await fetch(`https://www.twitch.tv/${login}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const signal = html.match(/"isLiveBroadcast":(true|false)/);
    return signal ? signal[1] === 'true' : null;
  } catch {
    return null;
  }
}

console.log(`[poc] canais: ${channels.join(', ')} — duração: ${Math.round(durationMs / 60_000)} min (após ao vivo)`);
console.log('[poc] presença anônima por IRC (sem vídeo, sem login)');

let interrupted = false;
const onWaitInterrupt = () => { interrupted = true; };
process.on('SIGINT', onWaitInterrupt);

// Aguarda algum canal ficar ao vivo antes de conectar o IRC. Bônus só existe com
// canal online — conectar antes seria tempo de teste jogado fora.
async function waitForAnyLive() {
  for (;;) {
    const statuses = await Promise.all(channels.map(async (login) => [login, await isTwitchLive(login)]));
    const live = statuses.filter(([, isLive]) => isLive === true).map(([login]) => login);
    if (live.length > 0) {
      console.log(`[poc] ao vivo agora: ${live.join(', ')} — conectando o IRC`);
      return;
    }
    const unknown = statuses.filter(([, isLive]) => isLive === null).map(([login]) => login);
    if (unknown.length === channels.length) {
      console.log('[poc] não consegui consultar o status dos canais (rede?); vou conectar mesmo assim');
      return;
    }
    console.log(`[poc] todos offline (${new Date().toLocaleTimeString()}); verificando de novo em 60 s... (Ctrl+C encerra)`);
    for (let waited = 0; waited < 60_000 && !interrupted; waited += 1000) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (interrupted) {
      console.log('[poc] encerrado enquanto aguardava canal ao vivo');
      process.exit(0);
    }
  }
}

await waitForAnyLive();

const runner = new TwitchIrcRunner(channels, {
  log: (message) => console.log(`[poc] ${message}`),
});
runner.start();

const startedAt = Date.now();
const report = setInterval(() => {
  const s = runner.snapshot();
  const mem = process.memoryUsage();
  const rss = (mem.rss / (1024 * 1024)).toFixed(1);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[poc ${String(elapsed).padStart(4)}s] fase=${s.phase} ativo=${s.active} `
    + `joins=${s.joined}/${s.desired} mensagens=${s.messages} erros=${s.errors} rss=${rss}MB`
    + (s.lastError ? ` último-erro="${s.lastError}"` : ''),
  );
}, 10_000);

const finish = async (reason) => {
  clearInterval(report);
  runner.stop();
  await runner.waitStopped().catch(() => {});
  const s = runner.snapshot();
  const totalMin = (Date.now() - startedAt) / 60_000;
  console.log('\n[poc] ─── resumo ───');
  console.log(`[poc] motivo do fim: ${reason}`);
  console.log(`[poc] fase final: ${s.phase} | ativo no fim: ${s.active}`);
  console.log(`[poc] canais com JOIN confirmado: ${s.joined}/${s.desired}`);
  console.log(`[poc] mensagens IRC recebidas: ${s.messages}`);
  console.log(`[poc] erros: ${s.errors}${s.lastError ? ` (último: ${s.lastError})` : ''}`);
  console.log(`[poc] duração real: ${totalMin.toFixed(1)} min`);

  const saudavel = s.joined > 0 && s.messages > 0 && (s.active || s.phase === 'stopped');
  if (saudavel) {
    console.log('[poc] VEREDITO: saudável — presença de chat mantida sem vídeo nem login.');
  } else {
    console.log('[poc] VEREDITO: insalubre — sem JOIN confirmado ou sem tráfego; verifique os erros.');
    process.exitCode = 1;
  }
};

const timer = setTimeout(() => finish('tempo esgotado'), durationMs);
process.removeListener('SIGINT', onWaitInterrupt);
process.on('SIGINT', () => {
  clearTimeout(timer);
  finish('Ctrl+C');
});
