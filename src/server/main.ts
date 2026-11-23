import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { closeBrowser } from '../sources/browser.js';
import { buildApp } from './app.js';
import { createAppMetrics } from './appMetrics.js';
import { withCache } from './cache.js';
import { buildSources, readMarketsFile } from './markets.js';

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
  metricsToken: process.env.METRICS_TOKEN || undefined,
  rateLimit: { max: num('RATE_LIMIT_MAX', 20), windowMs: num('RATE_LIMIT_WINDOW_MIN', 60) * 60 * 1000 },
  maxConcurrent: num('MAX_CONCURRENT', 2),
  trustProxy: ['1', 'true'].includes(process.env.TRUST_PROXY ?? ''),
});
await app.register(fastifyStatic, { root: fileURLToPath(new URL('../../web/', import.meta.url)) });

await app.listen({ port: num('PORT', 3000), host: process.env.HOST ?? '127.0.0.1' });
if (!process.env.METRICS_TOKEN) app.log.warn('METRICS_TOKEN não definido: /metrics e /admin/stats estão desativados.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(closeBrowser).then(() => process.exit(0)));
}
