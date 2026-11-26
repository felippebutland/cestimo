import { describe, it, expect } from 'vitest';
import type { ProductResult } from '../../domain/compare.js';
import { runCatalogRefresh } from './catalogRefresh.js';

const ok = (source: string, title: string, price: number, uncertain = false) => ({ source, status: 'ok' as const, match: { title, priceBRL: price, equivalentBRL: price, sizeAdjusted: false, score: 1, uncertain } });
const blocked = (source: string) => ({ source, status: 'indisponivel' as const });
const product = (query: string, sources: ProductResult['sources']): ProductResult => ({ query, sources, stats: null });

const base = (over: Partial<Parameters<typeof runCatalogRefresh>[0]> = {}) => {
  const calls: Array<{ queries: string[]; exclude: string[] }> = [];
  const recorded: string[] = [];
  const sleeps: number[] = [];
  const args: Parameters<typeof runCatalogRefresh>[0] = {
    queries: ['a', 'b', 'c', 'd'],
    sources: ['Comper', 'Royal'],
    hasToday: () => false,
    search: async (queries, exclude) => {
      calls.push({ queries, exclude: [...exclude] });
      return queries.map((q) => product(q, [ok('Comper', `${q} Comper`, 5), ok('Royal', `${q} Royal`, 6)].filter((s) => !exclude.has(s.source))));
    },
    record: (p) => { recorded.push(p.query); },
    pauseMs: 1000,
    sleep: async (ms) => { sleeps.push(ms); },
    ...over,
  };
  return { args, calls, recorded, sleeps };
};

describe('runCatalogRefresh', () => {
  it('consulta em lotes (padrão 3), grava cada produto e conta por loja', async () => {
    const { args, calls, recorded } = base();
    const r = await runCatalogRefresh(args);
    expect(calls.map((c) => c.queries)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(recorded).toEqual(['a', 'b', 'c', 'd']);
    expect(r).toMatchObject({ collected: 4, skipped: 0, failed: 0, blocked: [], bySource: { Comper: 4, Royal: 4 } });
  });
  it('pula o que já tem preço de hoje', async () => {
    const { args, recorded } = base({ hasToday: (q) => q === 'b' });
    const r = await runCatalogRefresh(args);
    expect(recorded).toEqual(['a', 'c', 'd']);
    expect(r.skipped).toBe(1);
  });
  it('espera entre os lotes, mas não depois do último', async () => {
    const { args, sleeps } = base();
    await runCatalogRefresh(args);
    expect(sleeps).toEqual([1000]);
  });
  it('uma loja que bloqueia sai do resto da rodada; as outras seguem', async () => {
    const { args, calls } = base({
      search: async (queries, exclude) => {
        calls.push({ queries, exclude: [...exclude] });
        return queries.map((q) => product(q, [ok('Comper', `${q} C`, 5), exclude.has('Royal') ? undefined : blocked('Royal')].filter((s): s is NonNullable<typeof s> => s !== undefined)));
      },
    });
    const r = await runCatalogRefresh(args);
    expect(r.blocked).toEqual(['Royal']);
    expect(calls[0]!.exclude).toEqual([]);
    expect(calls[1]!.exclude).toEqual(['Royal']);
    expect(r.bySource).toEqual({ Comper: 4 });
  });
  it('erro em um lote conta como falha e a rodada continua', async () => {
    let n = 0;
    const { args, recorded } = base({ search: async (queries) => { if (n++ === 0) throw new Error('caiu'); return queries.map((q) => product(q, [ok('Comper', q, 5)])); } });
    const r = await runCatalogRefresh(args);
    expect(r).toMatchObject({ failed: 3, collected: 1 });
    expect(recorded).toEqual(['d']);
  });
  it('erro ao gravar um produto não para a rodada', async () => {
    const { args } = base({ record: (p) => { if (p.query === 'a') throw new Error('disco'); } });
    const r = await runCatalogRefresh(args);
    expect(r.collected).toBe(4);
  });
  it('lista vazia não faz nada', async () => {
    const { args, calls } = base({ queries: [] });
    expect(await runCatalogRefresh(args)).toMatchObject({ collected: 0, skipped: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
  it('um limite de tempo para a rodada: passou, para e deixa o resto para amanhã', async () => {
    let t = 0;
    const { args, recorded } = base({ now: () => (t += 100), maxMs: 150 });
    const r = await runCatalogRefresh(args);
    expect(r.stoppedEarly).toBe(true);
    expect(recorded.length).toBeLessThan(4);
  });
});
