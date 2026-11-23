import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { compare, type SourceEvent } from '../domain/compare.js';
import { parseList } from '../domain/parseList.js';
import type { PriceSource } from '../domain/types.js';
import { createAppMetrics } from './appMetrics.js';
import { parseClient } from './client.js';
import { basicAuthOk, createGate, createRateLimiter } from './limits.js';
import { createDailyStats, type DailyStats } from './dailyStats.js';
import { createTopList, normalizeQuery, type Metrics } from './metrics.js';

export const MAX_ITEMS = 20;

/** Ações da interface que viram contagem (lista fechada: nada que o usuário digite entra aqui). */
export const UI_EVENTS = ['copy_item', 'copy_store', 'print_item', 'print_store', 'tab_item', 'tab_store', 'pick_store', 'example'] as const;
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
    const ignore = isIgnored(req);
    try {
      if (!ignore) list.forEach((q) => top.record(normalizeQuery(q)));
      const result = await compare(list, deps.sources, { observer });
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
        daily.add('compare');
        daily.add('items', list.length);
        daily.add('savings', Math.round(savings * 100) / 100);
        outcome('ok');
        app.log.info({ event: 'compare', items: list.length, seconds, queries: list.map(normalizeQuery) });
      }
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
