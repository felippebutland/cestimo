import type { ProductResult } from '../../domain/compare.js';
import type { PanelCategory } from './panelStore.js';

type Item = { query: string; category: PanelCategory };

/**
 * Rotina diária dos produtos acompanhados: consulta nas lojas o que ainda não tem preço de hoje e grava no histórico.
 * Produtos iguais de contas diferentes chegam aqui uma vez só. Em lotes pequenos, para não competir com quem usa o app.
 */
export async function refreshTracked(p: {
  items: Item[];
  hasToday: (query: string, category: PanelCategory) => boolean;
  search: (category: PanelCategory, queries: string[]) => Promise<ProductResult[]>;
  record: (category: PanelCategory, product: ProductResult) => void;
  batchSize?: number;
}): Promise<{ refreshed: number; skipped: number; failed: number }> {
  const size = Math.max(1, p.batchSize ?? 3);
  const todo = p.items.filter((i) => !p.hasToday(i.query, i.category));
  const out = { refreshed: 0, skipped: p.items.length - todo.length, failed: 0 };
  for (const category of ['mercados', 'farmacias'] as const) {
    const queries = todo.filter((i) => i.category === category).map((i) => i.query);
    for (let i = 0; i < queries.length; i += size) {
      const batch = queries.slice(i, i + size);
      try {
        const products = await p.search(category, batch);
        for (const prod of products) {
          try { p.record(category, prod); } catch { /* guardar histórico não pode parar a rotina */ }
        }
        out.refreshed += batch.length;
      } catch {
        out.failed += batch.length;
      }
    }
  }
  return out;
}
