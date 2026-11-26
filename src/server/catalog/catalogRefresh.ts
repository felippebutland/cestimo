import type { ProductResult } from '../../domain/compare.js';

export type CatalogRefreshResult = {
  collected: number;
  skipped: number;
  failed: number;
  /** Lojas que bloquearam durante a rodada (saíram do resto dela). */
  blocked: string[];
  /** Quantos produtos cada loja devolveu nesta rodada. */
  bySource: Record<string, number>;
  stoppedEarly: boolean;
};

/**
 * Coleta noturna: consulta a lista base nas lojas, em lotes pequenos e com pausa entre eles, e grava o que veio.
 * Uma loja que bloqueia sai do resto da rodada (as outras seguem). Passou do tempo máximo, a rodada para e o resto fica para amanhã.
 */
export async function runCatalogRefresh(p: {
  queries: string[];
  sources: string[];
  hasToday: (query: string) => boolean;
  search: (queries: string[], excluded: ReadonlySet<string>) => Promise<ProductResult[]>;
  record: (product: ProductResult) => void;
  batchSize?: number;
  pauseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<CatalogRefreshResult> {
  const size = Math.max(1, p.batchSize ?? 3);
  const sleep = p.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = p.now ?? Date.now;
  const started = now();
  const todo = p.queries.filter((q) => !p.hasToday(q));
  const blocked = new Set<string>();
  const bySource: Record<string, number> = {};
  const out: CatalogRefreshResult = { collected: 0, skipped: p.queries.length - todo.length, failed: 0, blocked: [], bySource, stoppedEarly: false };

  for (let i = 0; i < todo.length; i += size) {
    if (p.maxMs !== undefined && now() - started > p.maxMs) {
      out.stoppedEarly = true;
      break;
    }
    if (i > 0) await sleep(p.pauseMs ?? 3000);
    const batch = todo.slice(i, i + size);
    let products: ProductResult[];
    try {
      products = await p.search(batch, blocked);
    } catch {
      out.failed += batch.length;
      continue;
    }
    for (const product of products) {
      for (const s of product.sources) {
        if (s.status === 'indisponivel') blocked.add(s.source);
        else if (s.match) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
      }
      try {
        p.record(product);
      } catch {
        // guardar um produto não pode parar a rodada
      }
    }
    out.collected += products.length;
  }
  out.blocked = [...blocked];
  return out;
}
