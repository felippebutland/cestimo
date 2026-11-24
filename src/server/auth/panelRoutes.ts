import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { recompute } from '../../domain/compare.js';
import { parseRecomputeBody } from '../recomputeInput.js';
import { looksLikeProduct } from '../../domain/looksLikeProduct.js';
import { parseList } from '../../domain/parseList.js';
import { dayKey, productKey, type HistoryStore } from '../history.js';
import { serializeCookie } from './cookies.js';
import { createRateLimiter } from '../limits.js';
import type { Metrics } from '../metrics.js';
import { createPanelStore, type PanelCategory, type SavedList } from './panelStore.js';
import { SESSION_COOKIE, userFromRequest, type AuthDeps } from './routes.js';
import { summarizeTracked } from './trackedSummary.js';

const MAX_NAME = 40;
const MAX_ITEMS = 20;
const MAX_BODY = 2000;
const MAX_QUERY = 80;
const SPARK_DAYS = 30;

const asCategory = (v: unknown): PanelCategory | null => (v === 'mercados' || v === 'farmacias' ? v : null);
const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const name = v.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
};
const asId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Rotas do painel de quem está logado: listas salvas, produtos acompanhados e exclusão da conta. */
export function registerPanelRoutes(
  app: FastifyInstance,
  opts: { auth: AuthDeps | undefined; history: HistoryStore; historyKey: (query: string, category: PanelCategory) => string; utcOffsetMinutes: number; metrics?: Metrics },
) {
  const event = (name: string): void => opts.metrics?.inc('panel_events_total', { event: name });
  const { auth, history, historyKey } = opts;
  if (!auth) return undefined;
  const panel = createPanelStore(auth.store.db, auth.now);
  // cada produto novo pode gerar uma busca nas lojas: limite por conta
  const instantSearch = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000, now: auth.now });

  const needUser = (req: FastifyRequest, reply: FastifyReply) => {
    const user = userFromRequest(auth, req);
    if (!user) void reply.code(401).send({ error: 'Entre com o Google para usar isto.' });
    return user;
  };
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

  type Products = ReturnType<typeof parseRecomputeBody> extends infer R ? (R extends { ok: true; products: infer P } ? P : never) : never;
  const pricesOf = (products: Products): Record<string, number> => {
    const { stats } = recompute(products);
    return Object.fromEntries(products.flatMap((p, i) => (stats[i] && p.query ? [[productKey(p.query), stats[i]!.cheapest.priceBRL] as const] : [])));
  };
  /** Resultado vindo do navegador: validado como no link compartilhado e conferido contra os itens da lista. */
  const parseResult = (raw: unknown, items: string[]): { ok: true; products: Products } | { ok: false; error: string } => {
    const parsed = parseRecomputeBody(raw, { display: true });
    if (!parsed.ok) return parsed;
    const wanted = new Set(items.map(productKey));
    if (!parsed.products.every((p) => p.query && wanted.has(productKey(p.query)))) return { ok: false, error: 'O resultado não corresponde à lista.' };
    return { ok: true, products: parsed.products };
  };
  const parseJson = <T,>(raw: string | null, fallback: T): T => { try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } };
  /** Como a lista sai para a tela: texto, resultado recalculado (com a data), preços anteriores e itens marcados. */
  const view = (l: SavedList) => {
    const products = parseJson<Products | null>(l.snapshot, null);
    let result = null;
    if (products && products.length > 0) {
      const { stats, basket } = recompute(products);
      result = {
        at: l.snapshotAt,
        products: products.map((p, i) => ({ query: p.query, sources: p.sources, stats: stats[i] })),
        basket: { ...basket, totals: Object.fromEntries(basket.totals), coverage: Object.fromEntries(basket.coverage) },
      };
    }
    return {
      id: l.id, name: l.name, category: l.category, list: l.body, updatedAt: l.updatedAt, result,
      prev: parseJson<{ at: number; prices: Record<string, number> } | null>(l.prev, null),
      checked: parseJson<string[]>(l.checked, []),
    };
  };

  app.get('/api/me/lists', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    return noStore(reply).send({ lists: panel.lists(user.id).map(view) });
  });

  app.post('/api/me/lists', { bodyLimit: 200_000 }, async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as { name?: unknown; category?: unknown; list?: unknown; result?: unknown };
    const name = cleanName(b.name);
    const category = asCategory(b.category);
    if (!name) return bad(reply, `Dê um nome à lista (até ${MAX_NAME} letras).`);
    if (!category) return bad(reply, 'Categoria inválida.');
    const items = typeof b.list === 'string' && b.list.length <= MAX_BODY ? parseList(b.list) : [];
    if (items.length === 0 || items.length > MAX_ITEMS) return bad(reply, `A lista precisa ter de 1 a ${MAX_ITEMS} produtos.`);
    if (!items.every(looksLikeProduct)) return bad(reply, 'Isso não parece uma lista de produtos.');
    let snapshot: string | undefined;
    let prev: string | null = null;
    if (b.result !== undefined && b.result !== null) {
      const parsed = parseResult(b.result, items);
      if (!parsed.ok) return bad(reply, parsed.error);
      snapshot = JSON.stringify(parsed.products);
      const old = panel.listByName(user.id, name, category);
      const oldProducts = parseJson<Products | null>(old?.snapshot ?? null, null);
      if (old && oldProducts && old.snapshotAt) prev = JSON.stringify({ at: old.snapshotAt, prices: pricesOf(oldProducts) });
    }
    const r = panel.saveList(user.id, { name, category, body: items.join('\n'), ...(snapshot !== undefined ? { snapshot, prev } : {}) });
    if (!r.ok) return reply.code(409).send({ error: 'Você já tem o máximo de listas salvas. Apague uma para salvar outra.' });
    event('list_saved');
    return reply.code(204).send();
  });

  // "Atualizar preços": o resultado novo substitui o salvo; os preços do anterior ficam para mostrar a variação.
  app.put('/api/me/lists/:id/prices', { bodyLimit: 200_000 }, async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const id = asId((req.params as { id?: unknown }).id);
    const list = id ? panel.list(user.id, id) : null;
    if (!id || !list) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const parsed = parseResult((req.body as { result?: unknown } | null)?.result, parseList(list.body));
    if (!parsed.ok) return bad(reply, parsed.error);
    const oldProducts = parseJson<Products | null>(list.snapshot, null);
    const prev = oldProducts && list.snapshotAt ? JSON.stringify({ at: list.snapshotAt, prices: pricesOf(oldProducts) }) : null;
    panel.setSnapshot(user.id, id, JSON.stringify(parsed.products), prev);
    event('list_refreshed');
    return noStore(reply).send({ list: view(panel.list(user.id, id)!) });
  });

  // Itens marcados como comprados (ficam na conta: valem em qualquer aparelho).
  app.put('/api/me/lists/:id/checked', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const id = asId((req.params as { id?: unknown }).id);
    const list = id ? panel.list(user.id, id) : null;
    if (!id || !list) return reply.code(404).send({ error: 'Lista não encontrada.' });
    const raw = (req.body as { checked?: unknown } | null)?.checked;
    if (!Array.isArray(raw) || raw.length > MAX_ITEMS || !raw.every((k) => typeof k === 'string' && k.length <= MAX_QUERY)) return bad(reply, 'Itens marcados inválidos.');
    const valid = new Set(parseList(list.body).map(productKey));
    const checked = [...new Set((raw as string[]).map(productKey))].filter((k) => valid.has(k));
    panel.setChecked(user.id, id, checked);
    return reply.code(204).send();
  });

  app.patch('/api/me/lists/:id', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const id = asId((req.params as { id?: unknown }).id);
    const name = cleanName((req.body as { name?: unknown } | null)?.name);
    if (!id || !name) return bad(reply, `Dê um nome à lista (até ${MAX_NAME} letras).`);
    return panel.renameList(user.id, id, name) ? reply.code(204).send() : reply.code(404).send({ error: 'Lista não encontrada, ou você já tem outra com esse nome.' });
  });

  app.delete('/api/me/lists/:id', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const id = asId((req.params as { id?: unknown }).id);
    if (id && panel.deleteList(user.id, id)) { event('list_deleted'); return reply.code(204).send(); }
    return reply.code(404).send({ error: 'Lista não encontrada.' });
  });

  app.get('/api/me/tracked', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const items = panel.tracked(user.id).map((t) => ({
      id: t.id,
      query: t.query,
      category: t.category,
      summary: summarizeTracked(history.series(historyKey(t.query, t.category), SPARK_DAYS), dayKey(t.createdAt, opts.utcOffsetMinutes), t.startPrice !== null && t.startSource ? { priceBRL: t.startPrice, source: t.startSource } : null),
    }));
    return noStore(reply).send({ items });
  });

  app.post('/api/me/tracked', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as { query?: unknown; category?: unknown; priceBRL?: unknown; source?: unknown };
    const category = asCategory(b.category);
    const query = typeof b.query === 'string' ? b.query.trim().replace(/\s+/g, ' ') : '';
    if (!category) return bad(reply, 'Categoria inválida.');
    if (query.length === 0 || query.length > MAX_QUERY || !looksLikeProduct(query)) return bad(reply, 'Isso não parece um produto.');
    // preço que a pessoa viu ao acompanhar (só serve para o painel dela; o histórico geral nunca usa dado do navegador)
    const price = typeof b.priceBRL === 'number' && Number.isFinite(b.priceBRL) && b.priceBRL > 0 && b.priceBRL < 100_000 ? Math.round(b.priceBRL * 100) / 100 : undefined;
    const source = typeof b.source === 'string' && b.source.length > 0 && b.source.length <= 60 ? b.source : undefined;
    const r = panel.track(user.id, { query, category, ...(price !== undefined && source ? { startPrice: price, startSource: source } : {}) });
    if (r.ok && r.added) event('track_added');
    if (r.ok && r.added && auth.onTrack && instantSearch.check(`u${user.id}`).allowed) {
      try { auth.onTrack(query, category); } catch { /* a rotina diária cobre */ }
    }
    if (!r.ok) return reply.code(409).send({ error: 'Você já acompanha o máximo de produtos. Remova um para acompanhar outro.' });
    return reply.code(204).send();
  });

  app.delete('/api/me/tracked/:id', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const id = asId((req.params as { id?: unknown }).id);
    if (id && panel.untrack(user.id, id)) { event('track_removed'); return reply.code(204).send(); }
    return reply.code(404).send({ error: 'Produto não encontrado.' });
  });

  app.delete('/api/me', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    auth.store.deleteUser(user.id);
    opts.metrics?.inc('auth_events_total', { event: 'account_deleted' });
    const secure = auth.publicUrl.startsWith('https://');
    return reply.header('set-cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure })).code(204).send();
  });

  return panel;
}
