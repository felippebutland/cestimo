import type { Offer, PriceSource } from '../domain/types.js';

const keyOf = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Decorator: guarda resultados por termo durante `ttlMs`. Falhas não são guardadas. */
export type CacheHooks = { onHit?: (source: string) => void; onMiss?: (source: string) => void };

export function withCache(source: PriceSource, ttlMs: number, now: () => number = Date.now, hooks: CacheHooks = {}): PriceSource {
  const store = new Map<string, { at: number; offers: Offer[] }>();
  return {
    name: source.name,
    async search(query) {
      const key = keyOf(query);
      const hit = store.get(key);
      if (hit && now() - hit.at <= ttlMs) {
        hooks.onHit?.(source.name);
        return hit.offers;
      }
      hooks.onMiss?.(source.name);
      const offers = await source.search(query);
      if (offers.length > 0) store.set(key, { at: now(), offers });
      return offers;
    },
  };
}
