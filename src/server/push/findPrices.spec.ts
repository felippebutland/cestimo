import { describe, it, expect } from 'vitest';
import type { PriceSource } from '../../domain/types.js';
import { createFindPrices } from './findPrices.js';

const store = (name: string, offers: Record<string, number>): PriceSource => ({
  name,
  search: async (q) => (offers[q] ? [{ source: name, title: `${q} marca`, priceBRL: offers[q]! }] : []),
});

describe('createFindPrices', () => {
  it('devolve o menor preço confiável e o mercado de cada produto; sem preço = null', async () => {
    const find = createFindPrices([store('A', { 'sal 1kg': 5 }), store('B', { 'sal 1kg': 4 })]);
    const r = await find(['sal 1kg', 'produto inexistente xyz']);
    expect(r.get('sal 1kg')).toEqual({ priceBRL: 4, source: 'B' });
    expect(r.get('produto inexistente xyz')).toBeNull();
  });
  it('entrega os produtos buscados para quem quiser guardar (histórico)', async () => {
    const seen: string[] = [];
    const find = createFindPrices([store('A', { 'sal 1kg': 5 })], { onProducts: (p) => p.forEach((x) => seen.push(x.query)) });
    await find(['sal 1kg']);
    expect(seen).toEqual(['sal 1kg']);
  });
  it('busca em lotes pequenos (não abre dezenas de buscas ao mesmo tempo)', async () => {
    let running = 0; let peak = 0;
    const slow: PriceSource = { name: 'S', search: async (q) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return [{ source: 'S', title: q, priceBRL: 3 }]; } };
    const queries = Array.from({ length: 12 }, (_, i) => `produto ${i}`);
    await createFindPrices([slow], { batchSize: 3 })(queries);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it('falha numa loja não derruba a rotina', async () => {
    const quebrada: PriceSource = { name: 'Q', search: async () => { throw new Error('x'); } };
    const r = await createFindPrices([quebrada, store('B', { 'sal 1kg': 4 })])(['sal 1kg']);
    expect(r.get('sal 1kg')).toEqual({ priceBRL: 4, source: 'B' });
  });

  describe('farmácias (consulta com o prefixo "farmacias: ")', () => {
    it('busca nas farmácias, devolve com a mesma chave e não mistura com os mercados', async () => {
      const find = createFindPrices([store('Mercado', { 'dipirona 500mg': 1 })], { pharmacySources: [store('Farm', { 'dipirona 500mg': 6 })] });
      const r = await find(['farmacias: dipirona 500mg', 'dipirona 500mg']);
      expect(r.get('farmacias: dipirona 500mg')).toEqual({ priceBRL: 6, source: 'Farm' });
      expect(r.get('dipirona 500mg')).toEqual({ priceBRL: 1, source: 'Mercado' });
    });
    it('sem farmácias configuradas, a consulta de farmácia fica sem preço (null)', async () => {
      const r = await createFindPrices([store('Mercado', {})])(['farmacias: dipirona 500mg']);
      expect(r.get('farmacias: dipirona 500mg')).toBeNull();
    });
    it('entrega os produtos com a categoria, para o histórico gravar no lugar certo', async () => {
      const seen: Array<[string, string]> = [];
      const find = createFindPrices([store('M', { sal: 2 })], { pharmacySources: [store('F', { dipirona: 6 })], onProducts: (p, cat) => p.forEach((x) => seen.push([cat, x.query])) });
      await find(['farmacias: dipirona', 'sal']);
      expect(seen.sort()).toEqual([['farmacias', 'dipirona'], ['mercados', 'sal']]);
    });
  });
});
