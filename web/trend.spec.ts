import { describe, it, expect } from 'vitest';
import { sparklinePath, summarize } from './trend.js';

const pt = (day: string, cheapestBRL: number) => ({ day, cheapestBRL, cheapestSource: 'A', averageBRL: cheapestBRL + 1, sources: 2 });

describe('summarize', () => {
  it('menos de 2 dias de dados: ainda não há tendência', () => {
    expect(summarize([])).toBeNull();
    expect(summarize([pt('2026-11-23', 5)])).toBeNull();
  });
  it('resume mínimo, máximo, último e quantidade de dias', () => {
    const s = summarize([pt('2026-11-20', 5), pt('2026-11-21', 4), pt('2026-11-22', 6), pt('2026-11-23', 4.5)]);
    expect(s).toMatchObject({ minBRL: 4, maxBRL: 6, lastBRL: 4.5, days: 4 });
  });
  it('hoje no menor preço do período', () => {
    expect(summarize([pt('a', 6), pt('b', 5), pt('c', 4)])).toMatchObject({ atMin: true, aboveMinPct: 0 });
  });
  it('hoje acima do menor: diz quanto', () => {
    expect(summarize([pt('a', 4), pt('b', 5)])).toMatchObject({ atMin: false, aboveMinPct: 25 });
  });
});

describe('sparklinePath', () => {
  it('sem 2 pontos não desenha', () => {
    expect(sparklinePath([pt('a', 5)], 80, 20)).toBeNull();
  });
  it('mais barato fica embaixo (y maior) e mais caro em cima (y menor)', () => {
    const d = sparklinePath([pt('a', 10), pt('b', 5)], 80, 20, 2)!;
    expect(d).toBe('M2.00 2.00 L78.00 18.00');
  });
  it('série constante vira linha reta no meio, sem NaN', () => {
    const d = sparklinePath([pt('a', 5), pt('b', 5), pt('c', 5)], 80, 20, 2)!;
    expect(d).not.toContain('NaN');
    expect(d).toBe('M2.00 10.00 L40.00 10.00 L78.00 10.00');
  });
});
