import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { compare, recompute, type SourceEvent } from '../domain/compare.js';
import { parseList } from '../domain/parseList.js';
import type { PriceSource } from '../domain/types.js';
import { createAppMetrics } from './appMetrics.js';
import { parseClient } from './client.js';
import { basicAuthOk, createGate, createRateLimiter } from './limits.js';
import { createDailyStats, type DailyStats } from './dailyStats.js';
import { createTopList, normalizeQuery, type Metrics } from './metrics.js';
import { parseRecomputeBody } from './recomputeInput.js';
import { createHistoryStore, dayKey, type HistoryStore } from './history.js';
import { createShareStore, type ShareStore } from './shares.js';

export const MAX_ITEMS = 20;

/** Ações da interface que viram contagem (lista fechada: nada que o usuário digite entra aqui). */
export const UI_EVENTS = ['copy_item', 'copy_store', 'print_item', 'print_store', 'tab_item', 'tab_store', 'pick_store', 'example', 'swap_match'] as const;
const isUiEvent = (v: unknown): v is (typeof UI_EVENTS)[number] => typeof v === 'string' && (UI_EVENTS as readonly string[]).includes(v);

const ADMIN_DIR = new URL('./admin/', import.meta.url);

export type AppDeps = {
  sources: PriceSource[];
  city?: string;
  /** Nome do produto exibido na interface. */
  name?: string;
  logger?: boolean;
  /** Senha de /metrics e /admin/stats. Sem ela, esses endpoints não existem. */
  metricsToken?: string;
  metrics?: Metrics;
  /** Ranking de termos e contagem por dia; passe os seus para poder gravá-los em disco. */
  top?: ReturnType<typeof createTopList>;
  daily?: DailyStats;
  /** Máximo de comparações por IP na janela. Sem isto, não há limite. */
  rateLimit?: { max: number; windowMs: number };
  /** Histórico de preços (SQLite); sem ele, vale só em memória. */
  history?: HistoryStore;
  /** Fuso para virar o dia do histórico (padrão: -180, Brasília). */
  utcOffsetMinutes?: number;
  /** Limite de consultas ao histórico por IP (padrão: 1200 por hora). */
  historyRateLimit?: { max: number; windowMs: number };
  /** Onde ficam os resultados dos links compartilhados; passe o seu para poder gravá-los em disco. */
  shares?: ShareStore;
  /** Por quanto tempo um link compartilhado vale (padrão: 7 dias). */
  shareTtlMs?: number;
  /** Limite de links criados por IP (padrão: 30 por hora). */
  shareRateLimit?: { max: number; windowMs: number };
  /** Limite do recálculo depois de trocar um item (padrão: 600 por hora por IP). */
  recomputeRateLimit?: { max: number; windowMs: number };
  /** Comparações simultâneas aceitas; as demais recebem 503. */
  maxConcurrent?: number;
  /** true quando o app roda atrás de um proxy (Caddy, Cloudflare…) e o IP real vem do cabeçalho. */
  trustProxy?: boolean;
  /** Por quanto tempo o resultado de uma consulta fica disponível para ser buscado (padrão: 10 min). */
  jobTtlMs?: number;
};

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

/** Log sem IP nem cabeçalhos: só o necessário para operar. */
const PRIVATE_LOGGER = {
  serializers: {
    req: (r: { method: string; url: string }) => ({ method: r.method, url: r.url }),
    res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
  },
};

const IGNORE_COOKIE = 'cestimo_ignorar';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Valor do cookie de opt-out do administrador: '1' = ignorar, '0' = contar de propósito, undefined = não definido. */
const ignoreCookie = (req: FastifyRequest): '0' | '1' | undefined =>
  (new RegExp(`(?:^|;\\s*)${IGNORE_COOKIE}=([01])(?:;|$)`).exec(req.headers.cookie ?? '')?.[1] as '0' | '1' | undefined);
const isIgnored = (req: FastifyRequest): boolean => ignoreCookie(req) === '1';

const setIgnoreCookie = (req: FastifyRequest, reply: FastifyReply, on: boolean): void => {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  reply.header('set-cookie', `${IGNORE_COOKIE}=${on ? 1 : 0}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
};

const resultOf = (e: SourceEvent): string => (e.status !== 'ok' ? e.status : e.matched ? 'found' : 'empty');

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ? PRIVATE_LOGGER : false, trustProxy: deps.trustProxy ?? false, ignoreTrailingSlash: true });
  const metrics = deps.metrics ?? createAppMetrics();
  const top = deps.top ?? createTopList(500);
  const daily = deps.daily ?? createDailyStats();
  const eventLimiter = createRateLimiter({ max: 300, windowMs: 60 * 60 * 1000 });
  const adminHtml = readFileSync(new URL('admin.html', ADMIN_DIR), 'utf8');
  const adminJs = readFileSync(new URL('admin.js', ADMIN_DIR), 'utf8');
  const gate = createGate(deps.maxConcurrent ?? Number.POSITIVE_INFINITY);
  const limiter = deps.rateLimit ? createRateLimiter(deps.rateLimit) : null;
  const history = deps.history ?? createHistoryStore({ path: ':memory:', utcOffsetMinutes: deps.utcOffsetMinutes });
  const historyLimiter = createRateLimiter(deps.historyRateLimit ?? { max: 1200, windowMs: 60 * 60 * 1000 });
  const startedAt = Date.now();
  const outcome = (name: string): void => metrics.inc('compare_requests_total', { outcome: name });

  app.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });

  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && (path === '/' || path === '/index.html') && (reply.statusCode === 200 || reply.statusCode === 304)) {
      if (isIgnored(req)) return;
      const client = parseClient(req.headers['user-agent']);
      if (client.bot) {
        metrics.inc('bot_visits_total');
      } else {
        metrics.inc('page_views_total');
        metrics.inc('visits_by_client_total', { device: client.device, os: client.os, browser: client.browser });
        daily.add('page_view');
      }
    }
  });

  const observer = (e: SourceEvent): void => {
    const result = resultOf(e);
    metrics.inc('source_searches_total', { source: e.source, result });
    metrics.observe('source_search_duration_seconds', e.ms / 1000, { source: e.source });
    app.log.info({ event: 'source_search', source: e.source, result, ms: e.ms, reason: e.reason });
  };

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!deps.metricsToken) return reply.code(404).send({ error: 'not found' });
    if (!basicAuthOk(req.headers.authorization, deps.metricsToken)) {
      reply.header('www-authenticate', 'Basic realm="metricas"');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return undefined;
  };

  app.get('/healthz', () => ({ ok: true }));
  app.get('/api/config', () => ({ name: deps.name ?? 'Cestimo', city: deps.city ?? '', sources: deps.sources.map((s) => s.name) }));

  app.get('/metrics', { preHandler: guard }, (_req, reply) =>
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(metrics.render()));

  const sum = (name: string, label?: [string, string]): number =>
    metrics.counterSummary(name).filter((c) => !label || c.labels[label[0]] === label[1]).reduce((t, c) => t + c.value, 0);

  /** Contagem de visitas por uma tag (dispositivo, sistema ou navegador), da maior para a menor. */
  const breakdown = (label: string): Array<{ name: string; count: number }> => {
    const totals = new Map<string, number>();
    for (const c of metrics.counterSummary('visits_by_client_total')) {
      const name = c.labels[label] ?? 'Outro';
      totals.set(name, (totals.get(name) ?? 0) + c.value);
    }
    return [...totals].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  // Quem abre o painel é o administrador: este navegador passa a ser ignorado nas contagens (pode desligar no painel).
  app.get('/admin', { preHandler: guard }, (req, reply) => {
    if (ignoreCookie(req) === undefined) setIgnoreCookie(req, reply, true);
    return reply.header('content-type', 'text/html; charset=utf-8').send(adminHtml);
  });

  app.post('/admin/ignore', { preHandler: guard }, (req, reply) => {
    const on = (req.body as { on?: unknown } | null)?.on;
    if (typeof on !== 'boolean') return reply.code(400).send({ error: '"on" deve ser true ou false' });
    setIgnoreCookie(req, reply, on);
    return reply.code(204).send();
  });
  app.get('/admin/admin.js', { preHandler: guard }, (_req, reply) => reply.header('content-type', 'application/javascript; charset=utf-8').send(adminJs));

  app.get('/admin/stats', { preHandler: guard }, (req, reply) => {
    // Quem abre este endereço no navegador quer ver o painel, não o JSON (as chamadas de API não pedem text/html).
    if ((req.headers.accept ?? '').includes('text/html')) return reply.redirect('/admin', 302);
    const searches = metrics.counterSummary('source_searches_total');
    const avgMs = new Map(metrics.histogramSummary('source_search_duration_seconds').map((h) => [h.labels.source, Math.round(h.avg * 1000)]));
    const names = [...new Set(searches.map((s) => s.labels.source!))];
    const count = (source: string, result: string): number =>
      searches.find((s) => s.labels.source === source && s.labels.result === result)?.value ?? 0;
    const requests = Object.fromEntries(metrics.counterSummary('compare_requests_total').map((c) => [c.labels.outcome, c.value]));
    const events = Object.fromEntries(metrics.counterSummary('ui_events_total').map((c) => [c.labels.event, c.value]));
    const items = metrics.histogramSummary('compare_items').reduce((t, h) => t + h.sum, 0);
    const durations = metrics.histogramSummary('compare_duration_seconds');
    const durCount = durations.reduce((t, h) => t + h.count, 0);
    const compares = requests.ok ?? 0;
    const copies = (events.copy_item ?? 0) + (events.copy_store ?? 0);
    return {
      ignoredNow: isIgnored(req),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      active: gate.active(),
      requests,
      totals: {
        pageViews: sum('page_views_total'),
        compares,
        items,
        itemsFound: sum('list_items_total', ['result', 'found']),
        itemsMissing: sum('list_items_total', ['result', 'missing']),
        copies,
        prints: (events.print_item ?? 0) + (events.print_store ?? 0),
        savingsBRL: Math.round(sum('savings_brl_total') * 100) / 100,
        avgItemsPerList: compares ? Math.round((items / compares) * 10) / 10 : 0,
        avgSeconds: durCount ? Math.round((durations.reduce((t, h) => t + h.sum, 0) / durCount) * 10) / 10 : 0,
        copyRate: compares ? Math.round((copies / compares) * 1000) / 1000 : 0,
      },
      events,
      clients: {
        device: breakdown('device'),
        os: breakdown('os'),
        browser: breakdown('browser'),
        bots: sum('bot_visits_total'),
      },
      days: daily.series(14),
      sources: names.map((source) => ({
        source, found: count(source, 'found'), empty: count(source, 'empty'), erro: count(source, 'erro'),
        indisponivel: count(source, 'indisponivel'), avgMs: avgMs.get(source) ?? 0,
      })),
      cache: {
        hits: sum('cache_events_total', ['event', 'hit']),
        misses: sum('cache_events_total', ['event', 'miss']),
      },
      top: top.top(20),
    };
  });

  app.post('/api/event', async (req, reply) => {
    if (!eventLimiter.check(req.ip).allowed) return reply.code(429).send();
    const name = (req.body as { name?: unknown } | null)?.name;
    if (!isUiEvent(name)) return reply.code(400).send({ error: 'evento inválido' });
    if (isIgnored(req)) return reply.code(204).send();
    metrics.inc('ui_events_total', { event: name });
    daily.add(name.startsWith('copy') ? 'copy' : name.startsWith('print') ? 'print' : name);
    return reply.code(204).send();
  });

  type Payload = {
    products: Awaited<ReturnType<typeof compare>>['products'];
    basket: Omit<Awaited<ReturnType<typeof compare>>['basket'], 'totals' | 'coverage'> & {
      totals: Record<string, number>;
      coverage: Record<string, number>;
    };
  };

  /** Limite por IP, validação da lista e vaga na fila. Devolve null depois de já ter respondido o erro. */
  const admit = (req: FastifyRequest, reply: FastifyReply): { list: string[]; leave: () => void } | null => {
    if (limiter) {
      const limit = limiter.check(req.ip);
      if (!limit.allowed) {
        const secs = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
        outcome('rate_limited');
        void reply.header('retry-after', String(secs)).code(429).send({ error: `Muitas consultas seguidas. Tente de novo em ${secs}s.`, retryAfterSeconds: secs });
        return null;
      }
    }
    const raw = (req.body as { list?: unknown } | null)?.list;
    const list = typeof raw === 'string' ? parseList(raw) : [];
    if (list.length === 0 || list.length > MAX_ITEMS) {
      outcome('bad_request');
      void reply.code(400).send({ error: list.length === 0 ? 'Informe ao menos um produto.' : `No máximo ${MAX_ITEMS} produtos por vez.` });
      return null;
    }
    const leave = gate.tryEnter();
    if (!leave) {
      outcome('busy');
      void reply.header('retry-after', '30').code(503).send({ error: 'Estamos com muitas consultas no momento. Tente de novo em instantes.' });
      return null;
    }
    return { list, leave };
  };

  /** Guarda o menor preço confiável do dia de cada produto. Falha de disco nunca derruba a comparação. */
  const recordHistory = (products: Awaited<ReturnType<typeof compare>>['products']): void => {
    const day = dayKey(Date.now(), deps.utcOffsetMinutes ?? -180);
    for (const p of products) {
      const rows = p.sources.flatMap((s) => (s.match && !s.match.uncertain ? [{ source: s.source, priceBRL: s.match.equivalentBRL }] : []));
      try {
        history.record(day, p.query, rows);
      } catch (e) {
        app.log.warn({ event: 'history_error', message: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  /** Faz a comparação e registra as métricas (quem tem o cookie de opt-out fica fora do uso). */
  const runCompare = async (list: string[], ignore: boolean, onProgress?: (done: number) => void): Promise<Payload> => {
    const started = Date.now();
    try {
      if (!ignore) list.forEach((q) => top.record(normalizeQuery(q)));
      const result = await compare(list, deps.sources, { observer, onProgress: (done) => onProgress?.(done) });
      const seconds = (Date.now() - started) / 1000;
      if (ignore) {
        outcome('ignored');
      } else {
        metrics.observe('compare_items', list.length);
        metrics.observe('compare_duration_seconds', seconds);
        const found = result.products.filter((p) => p.stats !== null).length;
        const savings = result.products.reduce((t, p) => t + (p.stats ? p.stats.averageBRL - p.stats.cheapest.priceBRL : 0), 0);
        metrics.inc('list_items_total', { result: 'found' }, found);
        metrics.inc('list_items_total', { result: 'missing' }, list.length - found);
        metrics.inc('savings_brl_total', {}, savings);
        recordHistory(result.products);
        daily.add('compare');
        daily.add('items', list.length);
        daily.add('savings', Math.round(savings * 100) / 100);
        outcome('ok');
        app.log.info({ event: 'compare', items: list.length, seconds, queries: list.map(normalizeQuery) });
      }
      const { totals, coverage } = result.basket;
      return { products: result.products, basket: { ...result.basket, totals: Object.fromEntries(totals), coverage: Object.fromEntries(coverage) } };
    } catch (e) {
      outcome('error');
      throw e;
    }
  };

  // Endpoint antigo: uma única conexão espera o resultado (mantido por compatibilidade).
  app.post('/api/compare', async (req, reply) => {
    const admitted = admit(req, reply);
    if (!admitted) return reply;
    try {
      return await runCompare(admitted.list, isIgnored(req));
    } finally {
      admitted.leave();
    }
  });

  // Consulta em duas etapas: o POST responde na hora e o resultado fica guardado, então uma queda de
  // conexão (comum em celular) não perde o trabalho: o navegador volta a perguntar pelo mesmo id.
  type Job = { status: 'running' | 'done' | 'error'; done: number; total: number; result?: Payload; error?: string; finishedAt?: number };
  const jobs = new Map<string, Job>();
  const jobTtlMs = deps.jobTtlMs ?? 10 * 60 * 1000;
  const MAX_JOBS = 500;
  const pollLimiter = createRateLimiter({ max: 2400, windowMs: 60 * 60 * 1000 });

  const sweepJobs = (): void => {
    const now = Date.now();
    for (const [id, job] of jobs) if (job.finishedAt !== undefined && now - job.finishedAt > jobTtlMs) jobs.delete(id);
  };
  setInterval(sweepJobs, 60_000).unref();

  app.post('/api/jobs', async (req, reply) => {
    sweepJobs();
    if (jobs.size >= MAX_JOBS) {
      outcome('busy');
      return reply.header('retry-after', '30').code(503).send({ error: 'Estamos com muitas consultas no momento. Tente de novo em instantes.' });
    }
    const admitted = admit(req, reply);
    if (!admitted) return reply;
    const id = randomUUID();
    const job: Job = { status: 'running', done: 0, total: admitted.list.length };
    jobs.set(id, job);
    runCompare(admitted.list, isIgnored(req), (done) => { job.done = done; })
      .then((result) => { job.status = 'done'; job.done = job.total; job.result = result; })
      .catch(() => { job.status = 'error'; job.error = 'Não foi possível consultar os mercados agora. Tente de novo.'; })
      .finally(() => { job.finishedAt = Date.now(); admitted.leave(); });
    return reply.code(202).send({ id, total: job.total });
  });

  // Link compartilhado: guarda o resultado congelado (já validado e recalculado aqui) atrás de um id aleatório.
  const shares = deps.shares ?? createShareStore({ ttlMs: deps.shareTtlMs });
  const shareLimiter = createRateLimiter(deps.shareRateLimit ?? { max: 30, windowMs: 60 * 60 * 1000 });
  const shareViewLimiter = createRateLimiter({ max: 600, windowMs: 60 * 60 * 1000 });

  app.post('/api/share', { bodyLimit: 200_000 }, async (req, reply) => {
    if (!shareLimiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitos links criados seguidos. Tente de novo mais tarde.' });
    const parsed = parseRecomputeBody(req.body, { display: true });
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { stats, basket } = recompute(parsed.products);
    const result = {
      products: parsed.products.map((p, i) => ({ query: p.query, sources: p.sources, stats: stats[i] })),
      basket: { ...basket, totals: Object.fromEntries(basket.totals), coverage: Object.fromEntries(basket.coverage) },
    };
    const { id, expiresAt } = shares.put(result);
    if (!isIgnored(req)) metrics.inc('ui_events_total', { event: 'share_create' });
    return reply.code(201).send({ id, expiresAt });
  });

  app.get('/api/share/:id', async (req, reply) => {
    if (!shareViewLimiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitas consultas seguidas.' });
    const found = shares.get((req.params as { id: string }).id);
    if (!found) return reply.code(404).send({ error: 'Link não encontrado ou expirado. Peça para gerar outro.' });
    if (!isIgnored(req)) metrics.inc('ui_events_total', { event: 'share_open' });
    return reply.header('cache-control', 'no-store').send(found);
  });

  // Série de preços dos últimos dias de cada produto da lista (para mostrar a tendência).
  app.post('/api/history', async (req, reply) => {
    if (!historyLimiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitas consultas seguidas.' });
    const body = req.body as { queries?: unknown; days?: unknown } | null;
    const queries = body?.queries;
    const days = body?.days === undefined ? 30 : body.days;
    if (!Array.isArray(queries) || queries.length === 0 || queries.length > MAX_ITEMS || !queries.every((q) => typeof q === 'string' && q.trim().length > 0 && q.length <= 120)) {
      return reply.code(400).send({ error: 'Envie de 1 a 20 produtos (texto de até 120 caracteres).' });
    }
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) return reply.code(400).send({ error: 'Número de dias inválido.' });
    const list = queries as string[];
    return reply.header('cache-control', 'no-store').send({ series: list.map((query) => ({ query, points: history.series(query, Math.min(days, 90)) })) });
  });

  // Recalcula médias e cesta com os itens que a pessoa escolheu. Não consulta mercados nem guarda nada.
  const recomputeLimiter = createRateLimiter(deps.recomputeRateLimit ?? { max: 600, windowMs: 60 * 60 * 1000 });
  app.post('/api/recompute', async (req, reply) => {
    if (!recomputeLimiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitas trocas seguidas. Tente de novo em instantes.' });
    const parsed = parseRecomputeBody(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { stats, basket } = recompute(parsed.products);
    return reply.header('cache-control', 'no-store').send({
      stats,
      basket: { ...basket, totals: Object.fromEntries(basket.totals), coverage: Object.fromEntries(basket.coverage) },
    });
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    if (!pollLimiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitas verificações seguidas.' });
    sweepJobs();
    const job = jobs.get((req.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: 'Consulta não encontrada ou expirada. Envie a lista de novo.' });
    return reply.header('cache-control', 'no-store').send(job);
  });
  return app;
}
