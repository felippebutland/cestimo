import { compare, type ProductResult } from '../../domain/compare.js';
import type { MatchContext } from '../../domain/match.js';
import type { PriceSource } from '../../domain/types.js';
import type { FindPrices, FoundPrice } from './dailyCheck.js';

/** Consultas de farmácia guardam o prefixo da chave do histórico ("farmacias: dipirona 500mg"); sem prefixo, são de mercado. */
export const PHARMACY_PREFIX = 'farmacias: ';
export const isPharmacyQuery = (q: string): boolean => q.startsWith(PHARMACY_PREFIX);
export const stripPharmacyPrefix = (q: string): string => (isPharmacyQuery(q) ? q.slice(PHARMACY_PREFIX.length) : q);

/**
 * Busca os produtos nas lojas (mesmo caminho de uma comparação normal) e devolve o menor preço confiável de cada um.
 * Consultas com o prefixo "farmacias: " vão às farmácias. Faz em lotes pequenos para não competir com quem está usando o app.
 */
export function createFindPrices(
  sources: PriceSource[],
  opts: {
    batchSize?: number;
    pharmacySources?: PriceSource[];
    matchContext?: (query: string) => MatchContext | undefined;
    onProducts?: (products: ProductResult[], category: 'mercados' | 'farmacias') => void;
  } = {},
): FindPrices {
  const batchSize = Math.max(1, opts.batchSize ?? 3);
  return async (queries) => {
    const out = new Map<string, FoundPrice | null>();
    const groups: Array<{ category: 'mercados' | 'farmacias'; list: PriceSource[]; queries: string[] }> = [
      { category: 'mercados', list: sources, queries: queries.filter((q) => !isPharmacyQuery(q)) },
      { category: 'farmacias', list: opts.pharmacySources ?? [], queries: queries.filter(isPharmacyQuery) },
    ];
    for (const g of groups) {
      if (g.list.length === 0) { for (const q of g.queries) out.set(q, null); continue; }
      for (let i = 0; i < g.queries.length; i += batchSize) {
        const batch = g.queries.slice(i, i + batchSize);
        const { products } = await compare(batch.map(stripPharmacyPrefix), g.list, g.category === 'farmacias' && opts.matchContext ? { matchContext: opts.matchContext } : {});
        try { opts.onProducts?.(products, g.category); } catch { /* guardar histórico não pode parar a rotina */ }
        // a chave de volta é a consulta original (com prefixo), na mesma ordem do lote
        products.forEach((p, idx) => out.set(batch[idx]!, p.stats ? { priceBRL: p.stats.cheapest.priceBRL, source: p.stats.cheapest.source } : null));
      }
    }
    return out;
  };
}
