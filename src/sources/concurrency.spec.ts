import { describe, it, expect } from 'vitest';
import type { PriceSource } from '../domain/types.js';
import { withConcurrency } from './concurrency.js';

const slow = (name: string, ms = 5): { source: PriceSource; peak: () => number } => {
  let running = 0; let peak = 0;
  return {
    peak: () => peak,
    source: { name, search: async (q) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, ms)); running--; return [{ source: name, title: q, priceBRL: 1 }]; } },
  };
};

describe('withConcurrency', () => {
  it('uma loja nunca recebe mais buscas simultâneas que o limite (não sobrecarrega o site dela)', async () => {
    const s = slow('A');
    const limited = withConcurrency(s.source, 2);
    await Promise.all(Array.from({ length: 10 }, (_, i) => limited.search(`p${i}`)));
    expect(s.peak()).toBe(2);
  });
  it('mantém o nome e devolve o mesmo resultado', async () => {
    const limited = withConcurrency(slow('Comper').source, 3);
    expect(limited.name).toBe('Comper');
    expect(await limited.search('sal')).toEqual([{ source: 'Comper', title: 'sal', priceBRL: 1 }]);
  });
  it('lojas diferentes têm limites separados (uma lenta não segura as outras)', async () => {
    const a = slow('A', 30); const b = slow('B', 1);
    const la = withConcurrency(a.source, 1); const lb = withConcurrency(b.source, 1);
    const t0 = Date.now();
    await Promise.all([la.search('x'), la.search('y'), lb.search('x'), lb.search('y'), lb.search('z')]);
    expect(a.peak()).toBe(1);
    expect(b.peak()).toBe(1);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('erro de uma busca libera a vaga para as próximas', async () => {
    let n = 0;
    const flaky: PriceSource = { name: 'F', search: async () => { n++; if (n === 1) throw new Error('x'); return []; } };
    const limited = withConcurrency(flaky, 1);
    await expect(limited.search('a')).rejects.toThrow('x');
    await expect(limited.search('b')).resolves.toEqual([]);
  });
  it('limite inválido (0, negativo, NaN) vira 1 em vez de travar tudo', async () => {
    for (const bad of [0, -3, Number.NaN]) {
      const limited = withConcurrency(slow('A').source, bad);
      await expect(limited.search('x')).resolves.toHaveLength(1);
    }
  });
});
