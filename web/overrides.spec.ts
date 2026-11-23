import { describe, it, expect } from 'vitest';
import { applyChoice, mergeRecomputed, toRecomputeBody } from './overrides.js';

const m = (title: string, priceBRL: number, extra: Record<string, unknown> = {}) => ({
  title, priceBRL, equivalentBRL: priceBRL, sizeAdjusted: false, score: 1, uncertain: false, ...extra,
});
const data = () => ({
  products: [
    {
      query: 'Molho de tomate 340g',
      stats: { cheapest: { source: 'A', priceBRL: 3 } },
      sources: [
        { source: 'A', status: 'ok', match: m('Sardinha com molho', 3), alternatives: [m('Molho Fugini 340g', 1.79), m('Molho Quero 300g', 2.5, { sizeAdjusted: true, equivalentBRL: 2.83 })] },
        { source: 'B', status: 'ok', match: m('Molho Pomarola 340g', 4) },
        { source: 'C', status: 'ok', alternatives: [m('Extrato de tomate', 5, { uncertain: true })] },
      ],
    },
  ],
  basket: { totals: { A: 3, B: 4 }, coverage: { A: 1, B: 1 }, total: 1, cheapestSource: 'A' },
});

describe('applyChoice', () => {
  it('troca o item escolhido pela alternativa e marca como escolha da pessoa', () => {
    const next = applyChoice(data(), 0, 'A', 0);
    const a = next.products[0]!.sources[0]!;
    expect(a.match).toMatchObject({ title: 'Molho Fugini 340g', priceBRL: 1.79, uncertain: false, chosenByUser: true });
  });
  it('o item anterior vira alternativa e a escolhida sai da lista', () => {
    const a = applyChoice(data(), 0, 'A', 0).products[0]!.sources[0]!;
    expect(a.alternatives?.map((x: { title: string }) => x.title)).toEqual(['Sardinha com molho', 'Molho Quero 300g']);
  });
  it('escolher uma alternativa incerta a torna válida (a pessoa decidiu)', () => {
    const c = applyChoice(data(), 0, 'C', 0).products[0]!.sources[2]!;
    expect(c.match).toMatchObject({ uncertain: false, chosenByUser: true, title: 'Extrato de tomate' });
  });
  it('"nenhum destes" tira o item e o guarda como alternativa', () => {
    const a = applyChoice(data(), 0, 'A', null).products[0]!.sources[0]!;
    expect(a.match).toBeUndefined();
    expect(a.alternatives?.[0]?.title).toBe('Sardinha com molho');
  });
  it('guarda o item sugerido original para poder voltar', () => {
    const once = applyChoice(data(), 0, 'A', 0);
    const twice = applyChoice(once, 0, 'A', 0);
    expect(twice.products[0]!.sources[0]!.suggested?.title).toBe('Sardinha com molho');
  });
  it('não altera o objeto original nem os outros mercados', () => {
    const original = data();
    const next = applyChoice(original, 0, 'A', 0);
    expect(original.products[0]!.sources[0]!.match?.title).toBe('Sardinha com molho');
    expect(next.products[0]!.sources[1]).toBe(original.products[0]!.sources[1]);
  });
  it('índices ou mercados inexistentes devolvem os dados sem mudança', () => {
    const d = data();
    expect(applyChoice(d, 5, 'A', 0)).toBe(d);
    expect(applyChoice(d, 0, 'Z', 0)).toBe(d);
    expect(applyChoice(d, 0, 'A', 9)).toBe(d);
  });
});

describe('restoreSuggested via applyChoice(..., "suggested")', () => {
  it('volta ao item sugerido originalmente, sem a marca de escolha', () => {
    const swapped = applyChoice(data(), 0, 'A', 0);
    const back = applyChoice(swapped, 0, 'A', 'suggested').products[0]!.sources[0]!;
    expect(back.match?.title).toBe('Sardinha com molho');
    expect(back.match?.chosenByUser).toBeUndefined();
    expect(back.suggested).toBeUndefined();
    expect(back.alternatives?.map((x: { title: string }) => x.title)).toContain('Molho Fugini 340g');
  });
  it('sem item sugerido guardado, não muda nada', () => {
    const d = data();
    expect(applyChoice(d, 0, 'A', 'suggested')).toBe(d);
  });
});

describe('toRecomputeBody', () => {
  it('envia só consulta, mercado, status e item escolhido', () => {
    const body = toRecomputeBody(applyChoice(data(), 0, 'A', 0));
    expect(body.products[0]!.sources[0]).toEqual({
      source: 'A', status: 'ok',
      match: { title: 'Molho Fugini 340g', priceBRL: 1.79, equivalentBRL: 1.79, sizeAdjusted: false, score: 1, uncertain: false, chosenByUser: true },
    });
    expect(Object.keys(body.products[0]!.sources[2]!)).toEqual(['source', 'status']);
  });
});

describe('mergeRecomputed', () => {
  it('troca estatísticas e cesta pelas calculadas no servidor, mantendo os itens', () => {
    const merged = mergeRecomputed(data(), { stats: [{ cheapest: { source: 'A', priceBRL: 1.79 } }], basket: { totals: { A: 1.79 }, coverage: { A: 1 }, total: 1, cheapestSource: 'A' } });
    expect(merged.products[0]!.stats).toEqual({ cheapest: { source: 'A', priceBRL: 1.79 } });
    expect(merged.basket.totals).toEqual({ A: 1.79 });
    expect(merged.products[0]!.sources[0]!.alternatives).toHaveLength(2);
  });
  it('resposta com número de produtos diferente é ignorada', () => {
    const d = data();
    expect(mergeRecomputed(d, { stats: [], basket: d.basket })).toBe(d);
  });
});
