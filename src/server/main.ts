import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { closeBrowser } from '../sources/browser.js';
import { buildApp } from './app.js';
import { createAppMetrics } from './appMetrics.js';
import { withCache } from './cache.js';
import { createDailyStats } from './dailyStats.js';
import { createSwapLog } from './swapLog.js';
import { buildPharmacySources, buildSources, readMarketsFile } from './markets.js';
import { createTopList } from './metrics.js';
import { createStateFile, startAutosave } from './persistence.js';
import { createHistoryStore, dayKey, historyKey } from './history.js';
import { createAuthStore } from './auth/users.js';
import { createPanelStore } from './auth/panelStore.js';
import { refreshTracked } from './auth/trackedRefresh.js';
import { notifyTrackedDrops } from './auth/trackedNotify.js';
import { compare } from '../domain/compare.js';
import { runBackup } from './backup.js';
import { loadCmedFile, pharmacyMatchContext } from './cmed.js';
import { runProbe } from './probe.js';
import { withConcurrency } from '../sources/concurrency.js';
import * as webpush from 'web-push';
import { createSubscriptionStore } from './push/subscriptions.js';
import { createSender, loadOrCreateVapid } from './push/sender.js';
import { runDailyCheck } from './push/dailyCheck.js';
import { createFindPrices } from './push/findPrices.js';
import { dueToday } from './push/schedule.js';
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
const swaps = createSwapLog();
const daily = createDailyStats({ utcOffsetMinutes: Number(process.env.TZ_OFFSET_MIN ?? -180) });

// Números em disco: sobrevivem a reinícios e novas versões (use um volume no Docker).
const stateFile = createStateFile(join(process.env.DATA_DIR ?? './data', 'stats.json'));
const saved = stateFile.load() as { metrics?: unknown; top?: unknown; daily?: unknown; swaps?: unknown } | null;
if (saved) {
  metrics.restore(saved.metrics);
  top.restore(saved.top);
  daily.restore(saved.daily);
  swaps.restore(saved.swaps);
}
const saveState = (): void => {
  stateFile.save({ savedAt: new Date().toISOString(), metrics: metrics.snapshot(), top: top.snapshot(), daily: daily.snapshot(), swaps: swaps.snapshot() });
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

// Login com Google: só liga com GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e PUBLIC_URL. Contas e sessões em DATA_DIR/auth.db.
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
const publicUrl = process.env.PUBLIC_URL;
const authStore = googleId && googleSecret && publicUrl ? createAuthStore({ path: join(process.env.DATA_DIR ?? './data', 'auth.db') }) : null;
if (authStore) {
  authStore.purgeExpired();
  setInterval(() => { try { authStore.purgeExpired(); } catch { /* limpeza é só higiene */ } }, 6 * 60 * 60 * 1000).unref();
}

// Avisos de queda de preço (Web Push): inscrições e referências de preço em DATA_DIR/push.json (gravadas na hora).
const pushFile = createStateFile(join(process.env.DATA_DIR ?? './data', 'push.json'));
const pushStore = createSubscriptionStore({ maxSubs: num('PUSH_MAX_SUBSCRIPTIONS', 1000), onChange: () => { pushFile.save(pushStore.snapshot()); } });
pushStore.restore(pushFile.load());
const vapid = loadOrCreateVapid(process.env.DATA_DIR ?? './data', () => webpush.generateVAPIDKeys(), process.env.PUSH_SUBJECT || 'https://cestimo.butland.sbs');
const sendPush = createSender(vapid, (subscription, payload, options) => webpush.sendNotification(subscription, payload, options));

const rawSources = buildSources(markets);
const rawPharmacies = buildPharmacySources(markets);
/** Cada loja: no máximo N buscas simultâneas e resultados guardados por 10 min. */
const wrap = (s: (typeof rawSources)[number]) =>
  withCache(withConcurrency(s, num('SOURCE_CONCURRENCY', 3)), TEN_MINUTES, Date.now, {
    onHit: (source) => metrics.inc('cache_events_total', { source, event: 'hit' }),
    onMiss: (source) => metrics.inc('cache_events_total', { source, event: 'miss' }),
  });
const sources = rawSources.map(wrap);
const pharmacySources = rawPharmacies.map(wrap);

// Backup diário (histórico, estatísticas e links) em DATA_DIR/backups; o scripts/backup.sh leva uma cópia para fora do volume.
const dataDir = process.env.DATA_DIR ?? './data';
const backupNow = (): void => {
  try {
    const { dir } = runBackup({ dataDir, history, ...(authStore ? { auth: authStore } : {}), now: Date.now, utcOffsetMinutes, keep: num('BACKUP_KEEP_DAYS', 14) });
    app.log.info({ event: 'backup', dir });
  } catch (e) {
    app.log.warn({ event: 'backup_error', message: e instanceof Error ? e.message : String(e) });
  }
};

// Lista oficial de preços máximos (CMED): gerada por `npm run cmed:build`. Sem o arquivo, só não mostra o teto.
const cmed = loadCmedFile(process.env.CMED_FILE ?? fileURLToPath(new URL('../../config/cmed-pmc.json.gz', import.meta.url)));

/** Busca nas lojas os produtos acompanhados que ainda não têm preço de hoje e grava no histórico. */
const refreshTrackedItems = (items: Array<{ query: string; category: 'mercados' | 'farmacias' }>) => {
  const day = dayKey(Date.now(), utcOffsetMinutes);
  return refreshTracked({
    items,
    hasToday: (query, category) => history.series(historyKey(query, category), 1).some((pt) => pt.day === day),
    search: async (category, queries) => (await compare(queries, category === 'farmacias' ? pharmacySources : sources, category === 'farmacias' && cmed ? { matchContext: pharmacyMatchContext(cmed) } : {})).products,
    record: (category, p) => {
      const rows = p.sources.flatMap((s) => (s.match && !s.match.uncertain ? [{ source: s.source, priceBRL: s.match.equivalentBRL }] : []));
      history.record(day, historyKey(p.query, category), rows);
    },
  }).then((r) => {
    metrics.inc('tracked_refresh_total', { result: 'refreshed' }, r.refreshed);
    metrics.inc('tracked_refresh_total', { result: 'skipped' }, r.skipped);
    metrics.inc('tracked_refresh_total', { result: 'failed' }, r.failed);
    return r;
  });
};

const app = buildApp({
  sources,
  pharmacySources,
  cmed,
  city: markets.city,
  name: process.env.APP_NAME || 'Cestimo',
  logger: true,
  metrics,
  top,
  daily,
  swaps,
  shares,
  history,
  auth: authStore && googleId && googleSecret && publicUrl ? { store: authStore, publicUrl, google: { clientId: googleId, clientSecret: googleSecret }, onTrack: (query, category) => { void refreshTrackedItems([{ query, category }]).catch(() => {}); } } : undefined,
  push: { publicKey: vapid.publicKey, store: pushStore },
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

backupNow();
setInterval(backupNow, 24 * 60 * 60 * 1000).unref();

// Rotina diária dos avisos: busca uma vez cada produto acompanhado, compara com a referência e avisa quem pediu.
const findPrices = createFindPrices(sources, {
  pharmacySources,
  ...(cmed ? { matchContext: pharmacyMatchContext(cmed) } : {}),
  onProducts: (products, category) => {
    const day = dayKey(Date.now(), utcOffsetMinutes);
    for (const p of products) {
      const rows = p.sources.flatMap((s) => (s.match && !s.match.uncertain ? [{ source: s.source, priceBRL: s.match.equivalentBRL }] : []));
      history.record(day, historyKey(p.query, category), rows);
    }
  },
});
const pushCheck = async (): Promise<void> => {
  const { due, day } = dueToday({ now: Date.now(), utcOffsetMinutes, hour: num('PUSH_CHECK_HOUR', 8), lastRunDay: pushStore.getLastRunDay() });
  if (!due || pushStore.size() === 0) return;
  pushStore.setLastRunDay(day);
  try {
    const r = await runDailyCheck({ store: pushStore, find: findPrices, send: sendPush });
    metrics.inc('push_events_total', { event: 'drop' }, r.drops);
    metrics.inc('push_events_total', { event: 'sent' }, r.sent);
    metrics.inc('push_events_total', { event: 'gone' }, r.removed);
    metrics.inc('push_events_total', { event: 'failed' }, r.failed);
    app.log.info({ event: 'push_check', ...r });
  } catch (e) {
    app.log.warn({ event: 'push_check_error', message: e instanceof Error ? e.message : String(e) });
  }
};
setTimeout(() => void pushCheck(), 5 * 60 * 1000).unref();
setInterval(() => void pushCheck(), 60 * 60 * 1000).unref();

// Produtos acompanhados por quem tem conta: uma busca por dia de cada produto (iguais de contas diferentes contam uma vez), para o painel mostrar preço fresco.
if (authStore) {
  const panel = createPanelStore(authStore.db);
  let lastTrackedDay: string | null = null;
  const trackedRefresh = async (): Promise<void> => {
    const { due, day } = dueToday({ now: Date.now(), utcOffsetMinutes, hour: num('TRACK_REFRESH_HOUR', 7), lastRunDay: lastTrackedDay });
    if (!due) return;
    lastTrackedDay = day;
    try {
      app.log.info({ event: 'tracked_refresh', ...(await refreshTrackedItems(panel.distinctTracked())) });
    } catch (e) {
      app.log.warn({ event: 'tracked_refresh_error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  // Aviso de queda no celular: depois da rotina e a cada hora (quem ainda não foi avisado hoje, e só quando o preço de hoje caiu).
  const trackedNotify = async (): Promise<void> => {
    const day = dayKey(Date.now(), utcOffsetMinutes);
    if (dueToday({ now: Date.now(), utcOffsetMinutes, hour: num('TRACK_REFRESH_HOUR', 7), lastRunDay: null }).due === false) return;
    try {
      const r = await notifyTrackedDrops({
        day,
        items: panel.trackedForNotify(),
        devicesOf: (userId) => panel.devices(userId),
        seriesOf: (query, category) => history.series(historyKey(query, category), 3),
        send: sendPush,
        markNotified: (id) => panel.markNotified(id, day),
        removeDevice: (endpoint) => { panel.removeDevice(endpoint); },
      });
      metrics.inc('push_events_total', { event: 'account_drop' }, r.drops);
      metrics.inc('push_events_total', { event: 'account_sent' }, r.sent);
      metrics.inc('push_events_total', { event: 'account_gone' }, r.gone);
      metrics.inc('push_events_total', { event: 'account_failed' }, r.failed);
      if (r.users > 0) app.log.info({ event: 'tracked_notify', ...r });
    } catch (e) {
      app.log.warn({ event: 'tracked_notify_error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  const tick = async (): Promise<void> => { await trackedRefresh(); await trackedNotify(); };
  setTimeout(() => void tick(), 10 * 60 * 1000).unref();
  setInterval(() => void tick(), 60 * 60 * 1000).unref();
}

// Teste automático: uma busca fixa em cada mercado a cada hora (sem cache), para notar site que mudou mesmo sem ninguém usando.
const probeEveryMin = num('PROBE_EVERY_MIN', 60);
if (probeEveryMin > 0) {
  const term = process.env.PROBE_TERM || 'leite integral 1L';
  const pharmacyTerm = process.env.PROBE_PHARMACY_TERM || 'dipirona 500mg';
  const record = (source: string, result: 'ok' | 'falha'): void => {
    metrics.inc('source_probe_total', { source, result });
    app.log.info({ event: 'source_probe', source, result });
  };
  const probe = (): void => {
    // uma lista depois da outra: nunca duas buscas de teste ao mesmo tempo
    void runProbe(rawSources, term, record).then(() => runProbe(rawPharmacies, pharmacyTerm, record));
  };
  setTimeout(probe, 2 * 60 * 1000).unref();
  setInterval(probe, probeEveryMin * 60 * 1000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopAutosave();
    void app.close().then(closeBrowser).then(() => {
      try { history.close(); } catch { /* já fechado */ }
      try { authStore?.close(); } catch { /* já fechado */ }
      process.exit(0);
    });
  });
}
