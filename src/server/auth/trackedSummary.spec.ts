import { describe, it, expect } from 'vitest';
import { summarizeTracked } from './trackedSummary.js';

const pt = (day: string, p: number, source = 'Comper') => ({ day, cheapestBRL: p, cheapestSource: source, averageBRL: p + 1, sources: 3 });

describe('summarizeTracked', () => {
  it('sem histórico: tudo vazio', () => {
    expect(summarizeTracked([], '2026-11-01')).toEqual({ latestBRL: null, latestSource: null, latestDay: null, changePct: null, dropPct: null, dropped: false, spark: [] });
  });
  it('um ponto só: mostra o preço, sem variação', () => {
    expect(summarizeTracked([pt('2026-11-10', 10)], '2026-11-01')).toMatchObject({ latestBRL: 10, latestSource: 'Comper', changePct: null, dropped: false, spark: [10] });
  });
  it('variação desde o dia em que começou a acompanhar', () => {
    const s = summarizeTracked([pt('2026-10-01', 20), pt('2026-11-02', 10), pt('2026-11-05', 9)], '2026-11-01');
    expect(s.changePct).toBeCloseTo(-10, 5);
  });
  it('"caiu" quando o último preço é 5% ou mais abaixo do ponto anterior', () => {
    const s = summarizeTracked([pt('2026-11-04', 10), pt('2026-11-05', 9.4)], '2026-11-01');
    expect(s.dropPct).toBeCloseTo(6, 5);
    expect(s.dropped).toBe(true);
  });
  it('queda menor que 5% ou alta não é "caiu"', () => {
    expect(summarizeTracked([pt('2026-11-04', 10), pt('2026-11-05', 9.6)], '2026-11-01').dropped).toBe(false);
    expect(summarizeTracked([pt('2026-11-04', 10), pt('2026-11-05', 11)], '2026-11-01').dropped).toBe(false);
  });
  it('mini gráfico: só o menor preço de cada dia, em ordem', () => {
    expect(summarizeTracked([pt('2026-11-04', 10), pt('2026-11-05', 9)], '2026-11-01').spark).toEqual([10, 9]);
  });

  describe('com o preço de quando começou a acompanhar', () => {
    const baseline = { priceBRL: 10, source: 'Comper' };
    it('sem histórico ainda, o preço inicial é o primeiro preço', () => {
      expect(summarizeTracked([], '2026-11-01', baseline)).toMatchObject({ latestBRL: 10, latestSource: 'Comper', changePct: null, dropped: false, spark: [10] });
    });
    it('a variação é medida contra o preço inicial', () => {
      const s = summarizeTracked([pt('2026-11-05', 8)], '2026-11-01', baseline);
      expect(s.latestBRL).toBe(8);
      expect(s.changePct).toBeCloseTo(-20, 5);
    });
    it('preço igual ao inicial: variação zero', () => {
      expect(summarizeTracked([pt('2026-11-05', 10)], '2026-11-01', baseline).changePct).toBe(0);
    });
    it('"caiu" continua comparando com o ponto anterior (ou o preço inicial, se for o único ponto)', () => {
      expect(summarizeTracked([pt('2026-11-05', 9)], '2026-11-01', baseline)).toMatchObject({ dropped: true });
      expect(summarizeTracked([pt('2026-11-04', 10), pt('2026-11-05', 9.9)], '2026-11-01', baseline).dropped).toBe(false);
    });
  });
});
