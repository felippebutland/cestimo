import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { compare, type SourceEvent } from '../domain/compare.js';
import { parseList } from '../domain/parseList.js';
import type { PriceSource } from '../domain/types.js';
import { createAppMetrics } from './appMetrics.js';
import { basicAuthOk, createGate, createRateLimiter } from './limits.js';
import { createTopList, normalizeQuery, type Metrics } from './metrics.js';

export const MAX_ITEMS = 20;

export type AppDeps = {
  sources: PriceSource[];
  city?: string;
  /** Nome do produto exibido na interface. */
  name?: string;
  logger?: boolean;
  /** Senha de /metrics e /admin/stats. Sem ela, esses endpoints não existem. */
  metricsToken?: string;
  metrics?: Metrics;
  /** Máximo de comparações por IP na janela. Sem isto, não há limite. */
  rateLimit?: { max: number; windowMs: number };
  /** Comparações simultâneas aceitas; as demais recebem 503. */
  maxConcurrent?: number;
  /** true quando o app roda atrás de um proxy (Caddy, Cloudflare…) e o IP real vem do cabeçalho. */
  trustProxy?: boolean;
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

const resultOf = (e: SourceEvent): string => (e.status !== 'ok' ? e.status : e.matched ? 'found' : 'empty');

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ? PRIVATE_LOGGER : false, trustProxy: deps.trustProxy ?? false });
  const metrics = deps.metrics ?? createAppMetrics();
  const top = createTopList(500);
  const gate = createGate(deps.maxConcurrent ?? Number.POSITIVE_INFINITY);
  const limiter = deps.rateLimit ? createRateLimiter(deps.rateLimit) : null;
  const startedAt = Date.now();
  const outcome = (name: string): void => metrics.inc('compare_requests_total', { outcome: name });

  app.addHook('onSend', async (_req, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
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

  app.get('/admin/stats', { preHandler: guard }, () => {
    const searches = metrics.counterSummary('source_searches_total');
    const avgMs = new Map(metrics.histogramSummary('source_search_duration_seconds').map((h) => [h.labels.source, Math.round(h.avg * 1000)]));
    const names = [...new Set(searches.map((s) => s.labels.source!))];
    const count = (source: string, result: string): number =>
      searches.find((s) => s.labels.source === source && s.labels.result === result)?.value ?? 0;
    const cache = metrics.counterSummary('cache_events_total');
    const cacheTotal = (event: string): number => cache.filter((c) => c.labels.event === event).reduce((sum, c) => sum + c.value, 0);
    return {
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      active: gate.active(),
      requests: Object.fromEntries(metrics.counterSummary('compare_requests_total').map((c) => [c.labels.outcome, c.value])),
      sources: names.map((source) => ({
        source, found: count(source, 'found'), empty: count(source, 'empty'), erro: count(source, 'erro'),
        indisponivel: count(source, 'indisponivel'), avgMs: avgMs.get(source) ?? 0,
      })),
      cache: { hits: cacheTotal('hit'), misses: cacheTotal('miss') },
      top: top.top(20),
    };
  });

  app.post('/api/compare', async (req, reply) => {
    if (limiter) {
      const limit = limiter.check(req.ip);
      if (!limit.allowed) {
        const secs = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
        outcome('rate_limited');
        return reply.header('retry-after', String(secs)).code(429).send({ error: `Muitas consultas seguidas. Tente de novo em ${secs}s.`, retryAfterSeconds: secs });
      }
    }
    const raw = (req.body as { list?: unknown } | null)?.list;
    const list = typeof raw === 'string' ? parseList(raw) : [];
    if (list.length === 0) {
      outcome('bad_request');
      return reply.code(400).send({ error: 'Informe ao menos um produto.' });
    }
    if (list.length > MAX_ITEMS) {
      outcome('bad_request');
      return reply.code(400).send({ error: `No máximo ${MAX_ITEMS} produtos por vez.` });
    }
    const leave = gate.tryEnter();
    if (!leave) {
      outcome('busy');
      return reply.header('retry-after', '30').code(503).send({ error: 'Estamos com muitas consultas no momento. Tente de novo em instantes.' });
    }
    const started = Date.now();
    try {
      list.forEach((q) => top.record(normalizeQuery(q)));
      const result = await compare(list, deps.sources, { observer });
      const seconds = (Date.now() - started) / 1000;
      metrics.observe('compare_items', list.length);
      metrics.observe('compare_duration_seconds', seconds);
      outcome('ok');
      app.log.info({ event: 'compare', items: list.length, seconds, queries: list.map(normalizeQuery) });
      const { totals, coverage } = result.basket;
      return {
        products: result.products,
        basket: { ...result.basket, totals: Object.fromEntries(totals), coverage: Object.fromEntries(coverage) },
      };
    } catch (e) {
      outcome('error');
      throw e;
    } finally {
      leave();
    }
  });
  return app;
}
