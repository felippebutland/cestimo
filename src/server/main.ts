import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { closeBrowser } from '../sources/browser.js';
import { buildApp } from './app.js';
import { createAppMetrics } from './appMetrics.js';
import { withCache } from './cache.js';
import { createDailyStats } from './dailyStats.js';
import { buildSources, readMarketsFile } from './markets.js';
import { createTopList } from './metrics.js';
import { createStateFile, startAutosave } from './persistence.js';
import { createHistoryStore } from './history.js';
import { createShareStore } from './shares.js';

const num = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const TEN_MINUTES = 10 * 60 * 1000;
const marketsPath = process.env.MARKETS_FILE ?? fileURLToPath(new URL('../../config/markets.json', import.meta.url));

let markets;
try {
  markets = readMarketsFile(marketsPath);
} catch (e) {
  console.error(`\nNão foi possível carregar os mercados.\n${(e as Error).message}\n`);
  process.exit(1);
}

const metrics = createAppMetrics();
const top = createTopList(500);
const daily = createDailyStats({ utcOffsetMinutes: Number(process.env.TZ_OFFSET_MIN ?? -180) });

// Números em disco: sobrevivem a reinícios e novas versões (use um volume no Docker).
const stateFile = createStateFile(join(process.env.DATA_DIR ?? './data', 'stats.json'));
const saved = stateFile.load() as { metrics?: unknown; top?: unknown; daily?: unknown } | null;
if (saved) {
  metrics.restore(saved.metrics);
  top.restore(saved.top);
  daily.restore(saved.daily);
}
const saveState = (): void => {
  stateFile.save({ savedAt: new Date().toISOString(), metrics: metrics.snapshot(), top: top.snapshot(), daily: daily.snapshot() });
};
const sharesFile = createStateFile(join(process.env.DATA_DIR ?? './data', 'shares.json'));
// Grava na hora a cada link criado: quem acabou de compartilhar não pode perder o link num reinício.
const shares = createShareStore({ ttlMs: num('SHARE_TTL_DAYS', 7) * 24 * 60 * 60 * 1000, onPut: () => { sharesFile.save(shares.snapshot()); } });
shares.restore(sharesFile.load());
const saveShares = (): void => { sharesFile.save(shares.snapshot()); };
const stopStatsAutosave = startAutosave(saveState, num('SAVE_EVERY_SECONDS', 30) * 1000);
const stopSharesAutosave = startAutosave(saveShares, num('SAVE_EVERY_SECONDS', 30) * 1000);
const stopAutosave = (): void => { stopStatsAutosave(); stopSharesAutosave(); };

const utcOffsetMinutes = Number(process.env.TZ_OFFSET_MIN ?? -180);
const history = createHistoryStore({ path: join(process.env.DATA_DIR ?? './data', 'history.db'), utcOffsetMinutes, keepDays: num('HISTORY_KEEP_DAYS', 365) });
history.purge();
setInterval(() => { try { history.purge(); } catch { /* limpeza é só higiene */ } }, 24 * 60 * 60 * 1000).unref();

const sources = buildSources(markets).map((s) =>
  withCache(s, TEN_MINUTES, Date.now, {
    onHit: (source) => metrics.inc('cache_events_total', { source, event: 'hit' }),
    onMiss: (source) => metrics.inc('cache_events_total', { source, event: 'miss' }),
  }),
);

const app = buildApp({
  sources,
  city: markets.city,
  name: process.env.APP_NAME || 'Cestimo',
  logger: true,
  metrics,
  top,
  daily,
  shares,
  history,
  utcOffsetMinutes,
  metricsToken: process.env.METRICS_TOKEN || undefined,
  rateLimit: { max: num('RATE_LIMIT_MAX', 20), windowMs: num('RATE_LIMIT_WINDOW_MIN', 60) * 60 * 1000 },
  maxConcurrent: num('MAX_CONCURRENT', 2),
  trustProxy: ['1', 'true'].includes(process.env.TRUST_PROXY ?? ''),
});
// maxAge 0: o navegador revalida a cada acesso (ETag): quem já tem o arquivo não baixa de novo, e atualizações chegam na hora.
await app.register(fastifyStatic, { root: fileURLToPath(new URL('../../web/', import.meta.url)), maxAge: 0 });

await app.listen({ port: num('PORT', 3000), host: process.env.HOST ?? '127.0.0.1' });
if (!process.env.METRICS_TOKEN) app.log.warn('METRICS_TOKEN não definido: /admin, /metrics e /admin/stats estão desativados.');
if (saved) app.log.info('Números anteriores restaurados do disco.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopAutosave();
    try { history.close(); } catch { /* já fechado */ }
    void app.close().then(closeBrowser).then(() => process.exit(0));
  });
}
