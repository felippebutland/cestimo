import { compare, type ProductResult } from '../../domain/compare.js';
import type { PriceSource } from '../../domain/types.js';
import type { FindPrices } from './dailyCheck.js';

/**
 * Busca os produtos nas lojas (mesmo caminho de uma comparação normal) e devolve o menor preço confiável de cada um.
 * Faz em lotes pequenos para não competir com quem está usando o app.
 */
export function createFindPrices(sources: PriceSource[], opts: { batchSize?: number; onProducts?: (products: ProductResult[]) => void } = {}): FindPrices {
  const batchSize = Math.max(1, opts.batchSize ?? 3);
  return async (queries) => {
    const out = new Map<string, { priceBRL: number; source: string } | null>();
    for (let i = 0; i < queries.length; i += batchSize) {
      const { products } = await compare(queries.slice(i, i + batchSize), sources);
      try { opts.onProducts?.(products); } catch { /* guardar histórico não pode parar a rotina */ }
      for (const p of products) out.set(p.query, p.stats ? { priceBRL: p.stats.cheapest.priceBRL, source: p.stats.cheapest.source } : null);
    }
    return out;
  };
}
