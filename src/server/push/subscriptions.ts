export const MAX_QUERIES = 10;
const MAX_QUERY_LENGTH = 80;
const MAX_ENDPOINT_LENGTH = 500;
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,200}$/;

/** Serviços de push dos navegadores (Chrome/Edge, Firefox, Safari, Windows). O servidor só chama endereços destes: evita que alguém o use para acessar qualquer URL. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export const isPushEndpoint = (endpoint: unknown): endpoint is string => {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  return PUSH_HOSTS.includes(url.hostname) || PUSH_SUFFIXES.some((s) => url.hostname.endsWith(s));
};

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type SubscribeInput = { subscription: PushSubscription; queries: string[] };
export type Parsed = { ok: true; value: SubscribeInput } | { ok: false };

const normalizeQuery = (q: string): string => q.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_QUERY_LENGTH);

/** Valida só a inscrição do navegador (endereço de um serviço de push conhecido e chaves no formato certo). */
export function parsePushSubscription(v: unknown): PushSubscription | null {
  const sub = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!sub || !isPushEndpoint(sub.endpoint)) return null;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !KEY_FORMAT.test(p256dh) || !KEY_FORMAT.test(auth)) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

export function parseSubscribeBody(body: unknown): Parsed {
  const bad: Parsed = { ok: false };
  if (typeof body !== 'object' || body === null) return bad;
  const { subscription, queries } = body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; queries?: unknown };
  if (!subscription || !isPushEndpoint(subscription.endpoint)) return bad;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !KEY_FORMAT.test(p256dh) || !KEY_FORMAT.test(auth)) return bad;
  if (!Array.isArray(queries) || queries.length === 0 || queries.length > MAX_QUERIES || !queries.every((q) => typeof q === 'string')) return bad;
  const clean = [...new Set((queries as string[]).map(normalizeQuery).filter((q) => q.length > 0))];
  if (clean.length === 0) return bad;
  return { ok: true, value: { subscription: { endpoint: subscription.endpoint, keys: { p256dh, auth } }, queries: clean } };
}

type Entry = { subscription: PushSubscription; queries: string[]; createdAt: number };
export type StoredSubscription = { subscription: PushSubscription; queries: string[] };

/**
 * Aparelhos que pediram aviso de queda, com os produtos que cada um acompanha, e a "referência" de preço de cada produto.
 * Guarda só o endereço do navegador (endpoint), as chaves dele e o texto dos produtos: nada de nome, e-mail ou IP.
 */
export function createSubscriptionStore(opts: { maxSubs?: number; now?: () => number; onChange?: () => void } = {}) {
  const maxSubs = opts.maxSubs ?? 1000;
  const now = opts.now ?? Date.now;
  const subs = new Map<string, Entry>();
  const refs = new Map<string, number>();
  let lastRunDay: string | null = null;
  const changed = (): void => { try { opts.onChange?.(); } catch { /* gravar em disco não pode quebrar o uso */ } };

  return {
    upsert(input: SubscribeInput): boolean {
      const cur = subs.get(input.subscription.endpoint);
      if (!cur && subs.size >= maxSubs) return false;
      subs.set(input.subscription.endpoint, { subscription: input.subscription, queries: [...input.queries], createdAt: cur?.createdAt ?? now() });
      changed();
      return true;
    },
    remove(endpoint: string): boolean {
      const had = subs.delete(endpoint);
      if (had) changed();
      return had;
    },
    size: (): number => subs.size,
    all: (): StoredSubscription[] => [...subs.values()].map((e) => ({ subscription: e.subscription, queries: [...e.queries] })),
    queries: (): string[] => [...new Set([...subs.values()].flatMap((e) => e.queries))],
    getRef: (query: string): number | undefined => refs.get(query),
    setRef(query: string, price: number): void { refs.set(query, price); changed(); },
    pruneRefs(): void {
      const wanted = new Set([...subs.values()].flatMap((e) => e.queries));
      for (const q of refs.keys()) if (!wanted.has(q)) refs.delete(q);
      changed();
    },
    getLastRunDay: (): string | null => lastRunDay,
    setLastRunDay(day: string): void { lastRunDay = day; changed(); },
    snapshot: () => ({ subs: [...subs.values()], refs: Object.fromEntries(refs), lastRunDay }),
    restore(state: unknown): void {
      if (typeof state !== 'object' || state === null) return;
      const s = state as { subs?: unknown; refs?: unknown; lastRunDay?: unknown };
      if (Array.isArray(s.subs)) {
        for (const e of s.subs) {
          const r = parseSubscribeBody({ subscription: (e as Entry)?.subscription, queries: (e as Entry)?.queries });
          if (r.ok) subs.set(r.value.subscription.endpoint, { ...r.value, createdAt: typeof (e as Entry).createdAt === 'number' ? (e as Entry).createdAt : now() });
        }
      }
      if (typeof s.refs === 'object' && s.refs !== null && !Array.isArray(s.refs)) {
        for (const [q, v] of Object.entries(s.refs)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) refs.set(q, v);
      }
      if (typeof s.lastRunDay === 'string') lastRunDay = s.lastRunDay;
    },
  };
}

export type SubscriptionStore = ReturnType<typeof createSubscriptionStore>;
