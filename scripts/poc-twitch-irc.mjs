// Harness do PoC de presença headless na Twitch via IRC: conecta no chat do(s)
// canal(is) anônimo(s) por N minutos e imprime métricas periódicas.
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

console.log(`[poc] canais: ${channels.join(', ')} — duração: ${Math.round(durationMs / 60_000)} min`);
console.log('[poc] presença anônima por IRC (sem vídeo, sem login)');

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
process.on('SIGINT', () => {
  clearTimeout(timer);
  finish('Ctrl+C');
});
