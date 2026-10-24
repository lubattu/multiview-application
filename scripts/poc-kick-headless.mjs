// Harness do PoC de presença headless da Kick: roda um canal por N minutos e
// imprime métricas periódicas (segmentos, MB descartados, kbps médio, memória).
// Uso: node scripts/poc-kick-headless.mjs <canal> [minutos=5]
//
// Este script não faz parte do app; existe para validar estabilidade e consumo
// antes da integração no processo main.

import process from 'node:process';
import { KickHeadlessRunner, channelApiUrl } from '../src/main/kick-headless.js';

const [slug, minutesArg] = process.argv.slice(2);
if (!slug || !/^[a-zA-Z0-9_-]{1,60}$/.test(slug)) {
  console.error('Uso: node scripts/poc-kick-headless.mjs <canal> [minutos=5]');
  process.exit(2);
}
const durationMs = Math.max(1, Number.parseInt(minutesArg ?? '5', 10) || 5) * 60_000;

console.log(`[poc] canal: ${slug} — duração: ${Math.round(durationMs / 60_000)} min`);
console.log(`[poc] API: ${channelApiUrl(slug)}`);

const runner = new KickHeadlessRunner(slug, {
  log: (message) => console.log(`[poc] ${message}`),
});
runner.start();

const startedAt = Date.now();
const reportEveryMs = 10_000;
const report = setInterval(() => {
  const s = runner.snapshot();
  const mem = process.memoryUsage();
  const mb = (s.bytes / (1024 * 1024)).toFixed(2);
  const rss = (mem.rss / (1024 * 1024)).toFixed(1);
  const heap = (mem.heapUsed / (1024 * 1024)).toFixed(1);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[poc ${String(elapsed).padStart(4)}s] fase=${s.phase} ativo=${s.active} `
    + `segmentos=${s.segments} bytes=${mb}MB média=${s.avgKbps}kbps `
    + `variante=${s.bitrate ?? '-'}${s.resolution ? `@${s.resolution}` : ''} `
    + `erros=${s.errors} rss=${rss}MB heap=${heap}MB`
    + (s.lastError ? ` último-erro="${s.lastError}"` : ''),
  );
}, reportEveryMs);

const finish = async (reason) => {
  clearInterval(report);
  runner.stop();
  await runner.waitStopped().catch(() => {});
  const s = runner.snapshot();
  const totalMin = (Date.now() - startedAt) / 60_000;
  console.log('\n[poc] ─── resumo ───');
  console.log(`[poc] motivo do fim: ${reason}`);
  console.log(`[poc] fase final: ${s.phase} | ativo no fim: ${s.active}`);
  console.log(`[poc] segmentos consumidos: ${s.segments} (${(s.bytes / (1024 * 1024)).toFixed(2)} MB descartados)`);
  console.log(`[poc] kbps médio: ${s.avgKbps} (bitrate da variante: ${s.bitrate ?? '-'})`);
  console.log(`[poc] erros: ${s.errors}${s.lastError ? ` (último: ${s.lastError})` : ''}`);
  console.log(`[poc] duração real: ${totalMin.toFixed(1)} min`);

  const saudavel = s.segments > 0 && (s.active || s.phase === 'offline' || s.phase === 'stopped');
  if (saudavel) {
    console.log('[poc] VEREDITO: saudável — transferência de mídia funcionou sem decodificação.');
  } else if (s.phase === 'offline') {
    console.log('[poc] VEREDITO: canal offline durante todo o teste — rode com um canal ao vivo.');
    process.exitCode = 1;
  } else {
    console.log('[poc] VEREDITO: insalubre — nenhum segmento consumido; verifique os erros.');
    process.exitCode = 1;
  }
};

const timer = setTimeout(() => finish('tempo esgotado'), durationMs);
process.on('SIGINT', () => {
  clearTimeout(timer);
  finish('Ctrl+C');
});
