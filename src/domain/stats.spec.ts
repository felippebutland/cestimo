import { describe, it, expect } from 'vitest';
import { computeStats, basketTotals } from './stats.js';

describe('computeStats', () => {
  it('lista vazia retorna null', () => {
    expect(computeStats([])).toBeNull();
  });
  it('uma fonte: média = preço e diferença 0', () => {
    const s = computeStats([{ source: 'a', priceBRL: 20 }])!;
    expect(s.averageBRL).toBe(20);
    expect(s.diffBRL).toBe(0);
    expect(s.diffPct).toBe(0);
    expect(s.cheapest.source).toBe('a');
  });
  it('várias fontes', () => {
    const s = computeStats([
      { source: 'a', priceBRL: 20 },
      { source: 'b', priceBRL: 25 },
      { source: 'c', priceBRL: 21 },
    ])!;
    expect(s.cheapest.source).toBe('a');
    expect(s.averageBRL).toBeCloseTo(22);
    expect(s.maxBRL).toBe(25);
    expect(s.diffBRL).toBe(5);
    expect(s.diffPct).toBeCloseTo(25);
  });
});

describe('basketTotals', () => {
  it('sem preços retorna vazio e nenhuma fonte mais barata', () => {
    const r = basketTotals([[], []]);
    expect(r.totals.size).toBe(0);
    expect(r.coverage.size).toBe(0);
    expect(r.cheapestSource).toBeNull();
    expect(r.total).toBe(2);
  });
  it('soma por fonte só dos produtos que ela cobre, com cobertura por fonte', () => {
    const r = basketTotals([
      [{ source: 'a', priceBRL: 10 }, { source: 'b', priceBRL: 12 }],
      [{ source: 'a', priceBRL: 5 }],
      [{ source: 'a', priceBRL: 8 }, { source: 'b', priceBRL: 6 }],
    ]);
    expect(r.totals.get('a')).toBe(23);
    expect(r.totals.get('b')).toBe(18);
    expect(r.coverage.get('a')).toBe(3);
    expect(r.coverage.get('b')).toBe(2);
    expect(r.total).toBe(3);
  });
  it('mais barata é escolhida entre as de maior cobertura (não pelo menor total parcial)', () => {
    const r = basketTotals([
      [{ source: 'a', priceBRL: 10 }, { source: 'b', priceBRL: 12 }],
      [{ source: 'a', priceBRL: 5 }],
      [{ source: 'a', priceBRL: 8 }, { source: 'b', priceBRL: 6 }],
    ]);
    expect(r.cheapestSource).toBe('a');
  });
  it('empate de cobertura resolve pelo menor total', () => {
    const r = basketTotals([[{ source: 'a', priceBRL: 10 }, { source: 'b', priceBRL: 9 }]]);
    expect(r.cheapestSource).toBe('b');
  });
});
