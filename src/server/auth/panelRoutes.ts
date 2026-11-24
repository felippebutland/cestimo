import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { looksLikeProduct } from '../../domain/looksLikeProduct.js';
import { parseList } from '../../domain/parseList.js';
import { dayKey, type HistoryStore } from '../history.js';
import { serializeCookie } from './cookies.js';
import { createRateLimiter } from '../limits.js';
import type { Metrics } from '../metrics.js';
import { createPanelStore, type PanelCategory } from './panelStore.js';
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

  app.get('/api/me/lists', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    return noStore(reply).send({ lists: panel.lists(user.id).map((l) => ({ id: l.id, name: l.name, category: l.category, list: l.body, updatedAt: l.updatedAt })) });
  });

  app.post('/api/me/lists', async (req, reply) => {
    const user = needUser(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as { name?: unknown; category?: unknown; list?: unknown };
    const name = cleanName(b.name);
    const category = asCategory(b.category);
    if (!name) return bad(reply, `Dê um nome à lista (até ${MAX_NAME} letras).`);
    if (!category) return bad(reply, 'Categoria inválida.');
    const items = typeof b.list === 'string' && b.list.length <= MAX_BODY ? parseList(b.list) : [];
    if (items.length === 0 || items.length > MAX_ITEMS) return bad(reply, `A lista precisa ter de 1 a ${MAX_ITEMS} produtos.`);
    if (!items.every(looksLikeProduct)) return bad(reply, 'Isso não parece uma lista de produtos.');
    const r = panel.saveList(user.id, { name, category, body: items.join('\n') });
    if (!r.ok) return reply.code(409).send({ error: 'Você já tem o máximo de listas salvas. Apague uma para salvar outra.' });
    event('list_saved');
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
