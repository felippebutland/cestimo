import { describe, it, expect } from 'vitest';
import { withCache } from './cache.js';
import type { Offer, PriceSource } from '../domain/types.js';

const counting = (): { source: PriceSource; calls: () => number } => {
  let n = 0;
  return {
    source: { name: 's', search: async (q) => { n++; return [{ source: 's', title: q, priceBRL: 1 } satisfies Offer]; } },
    calls: () => n,
  };
};

describe('withCache', () => {
  it('não repete a busca igual dentro do TTL', async () => {
    const c = counting();
    const cached = withCache(c.source, 1000, () => 0);
    await cached.search('arroz'); await cached.search('arroz');
    expect(c.calls()).toBe(1);
  });
  it('ignora caixa e espaços extras na chave', async () => {
    const c = counting();
    const cached = withCache(c.source, 1000, () => 0);
    await cached.search('Arroz 5kg'); await cached.search('  arroz 5KG ');
    expect(c.calls()).toBe(1);
  });
  it('busca de novo depois do TTL', async () => {
    const c = counting(); let t = 0;
    const cached = withCache(c.source, 1000, () => t);
    await cached.search('arroz'); t = 1001; await cached.search('arroz');
    expect(c.calls()).toBe(2);
  });
  it('não guarda falhas', async () => {
    let n = 0;
    const flaky: PriceSource = { name: 'f', search: async () => { if (n++ === 0) throw new Error('x'); return []; } };
    const cached = withCache(flaky, 1000, () => 0);
    await expect(cached.search('a')).rejects.toThrow();
    await expect(cached.search('a')).resolves.toEqual([]);
    expect(n).toBe(2);
  });
  it('mantém o nome da fonte', () => {
    expect(withCache(counting().source, 1, () => 0).name).toBe('s');
  });
  it('não guarda lista vazia (pode ser falha silenciosa, review I6)', async () => {
    let n = 0;
    const empty: PriceSource = { name: 'e', search: async () => { n++; return []; } };
    const cached = withCache(empty, 1000, () => 0);
    await cached.search('a'); await cached.search('a');
    expect(n).toBe(2);
  });

  it('avisa acertos e erros do cache (métricas)', async () => {
    const calls: string[] = [];
    const c = counting();
    const cached = withCache(c.source, 1000, () => 0, { onHit: (n) => calls.push(`hit:${n}`), onMiss: (n) => calls.push(`miss:${n}`) });
    await cached.search('arroz'); await cached.search('arroz');
    expect(calls).toEqual(['miss:s', 'hit:s']);
  });
});
