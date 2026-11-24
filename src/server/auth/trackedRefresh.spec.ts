import { describe, it, expect } from 'vitest';
import { refreshTracked } from './trackedRefresh.js';

type P = { query: string; sources: Array<{ source: string; match: { equivalentBRL: number; uncertain: boolean } | null }> };
const prod = (query: string, price: number | null): P => ({ query, sources: [{ source: 'Comper', match: price === null ? null : { equivalentBRL: price, uncertain: false } }] });

describe('refreshTracked', () => {
  it('consulta o que ainda não tem preço de hoje, em lotes por categoria, e grava o histórico', async () => {
    const searched: Array<[string, string[]]> = [];
    const recorded: Array<[string, string, number]> = [];
    const r = await refreshTracked({
      items: [{ query: 'Leite 1L', category: 'mercados' }, { query: 'Sal 1kg', category: 'mercados' }, { query: 'Arroz 5kg', category: 'mercados' }, { query: 'Dipirona 500mg', category: 'farmacias' }],
      hasToday: (q) => q === 'Sal 1kg',
      search: async (category, queries) => { searched.push([category, queries]); return queries.map((q) => prod(q, 5)) as never; },
      record: (category, p) => { recorded.push([category, p.query, 5]); },
      batchSize: 1,
    });
    expect(searched).toEqual([['mercados', ['Leite 1L']], ['mercados', ['Arroz 5kg']], ['farmacias', ['Dipirona 500mg']]]);
    expect(recorded.map((x) => x[1])).toEqual(['Leite 1L', 'Arroz 5kg', 'Dipirona 500mg']);
    expect(r).toEqual({ refreshed: 3, skipped: 1, failed: 0 });
  });
  it('um lote que falha não derruba os outros', async () => {
    let n = 0;
    const r = await refreshTracked({
      items: [{ query: 'A', category: 'mercados' }, { query: 'B', category: 'mercados' }],
      hasToday: () => false,
      search: async (_c, qs) => { if (n++ === 0) throw new Error('rede'); return qs.map((q) => prod(q, 1)) as never; },
      record: () => {},
      batchSize: 1,
    });
    expect(r).toEqual({ refreshed: 1, skipped: 0, failed: 1 });
  });
  it('lista vazia não faz nada', async () => {
    const r = await refreshTracked({ items: [], hasToday: () => false, search: async () => [], record: () => {} });
    expect(r).toEqual({ refreshed: 0, skipped: 0, failed: 0 });
  });
});
