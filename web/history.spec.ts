import { describe, it, expect } from 'vitest';
import { formatDay, normalizeKey, parseSaved, snapshot, variations } from './history.js';

const product = (query: string, price?: number, source = 'A') => ({
  query,
  stats: price === undefined ? null : { cheapest: { source, priceBRL: price } },
});
const NOW = new Date('2026-11-23T12:00:00Z');

describe('normalizeKey', () => {
  it('ignora caixa, acentos e espaços repetidos', () => {
    expect(normalizeKey('  Feijão   PRETO 1kg ')).toBe('feijao preto 1kg');
  });
});

describe('snapshot', () => {
  it('guarda o menor preço de cada produto que teve resultado', () => {
    const s = snapshot({ products: [product('Arroz 5kg', 25.9, 'Comper'), product('Ovos 30un')] }, NOW);
    expect(s).toEqual({ at: '2026-11-23T12:00:00.000Z', prices: { 'arroz 5kg': { priceBRL: 25.9, source: 'Comper' } } });
  });
});

describe('variations', () => {
  const prev = snapshot({ products: [product('Arroz 5kg', 20), product('Leite 1L', 5), product('Café 500g', 10)] }, new Date('2026-11-10T12:00:00Z'));
  const now = { products: [product('arroz 5KG', 25), product('Leite 1L', 4), product('Café 500g', 10), product('Ovos 30un', 15), product('Sal 1kg')] };
  const v = variations(prev, now);

  it('sobe: diferença em reais e em %', () => {
    expect(v[0]).toMatchObject({ direction: 'up', deltaBRL: 5, pct: 25, previousBRL: 20 });
  });
  it('desce', () => {
    expect(v[1]).toMatchObject({ direction: 'down', deltaBRL: -1, pct: -20 });
  });
  it('igual', () => {
    expect(v[2]).toMatchObject({ direction: 'same', deltaBRL: 0 });
  });
  it('produto novo ou sem resultado agora: sem variação', () => {
    expect(v[3]).toBeNull();
    expect(v[4]).toBeNull();
  });
  it('sem consulta anterior: tudo nulo', () => {
    expect(variations(null, now)).toEqual([null, null, null, null, null]);
  });
});

describe('parseSaved', () => {
  it('aceita o que foi salvo', () => {
    const saved = { list: 'Arroz 5kg', snapshot: snapshot({ products: [product('Arroz 5kg', 20)] }, NOW) };
    expect(parseSaved(JSON.stringify(saved))).toEqual(saved);
  });
  it('lista sem snapshot é válida', () => {
    expect(parseSaved(JSON.stringify({ list: 'Leite' }))).toEqual({ list: 'Leite' });
  });
  it.each([null, '', 'nao-json', '[]', '{"list":5}', '{"list":"x","snapshot":{"at":1,"prices":{}}}', '{"list":"x","snapshot":{"at":"d","prices":{"a":{"priceBRL":-1,"source":"A"}}}}'])(
    'entrada inválida %j vira null',
    (raw) => expect(parseSaved(raw as string | null)).toBeNull(),
  );
  it('lista gigante é descartada', () => {
    expect(parseSaved(JSON.stringify({ list: 'x'.repeat(20000) }))).toBeNull();
  });
});

describe('formatDay', () => {
  it('dia/mês', () => {
    expect(formatDay('2026-11-10T12:00:00Z')).toBe('10/11');
  });
});
