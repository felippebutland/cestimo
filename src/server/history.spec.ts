import { describe, it, expect } from 'vitest';
import { createHistoryStore, dayKey, productKey } from './history.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-23T15:00:00Z');

describe('productKey', () => {
  it('ignora caixa, acentos e espaços repetidos', () => {
    expect(productKey('  Feijão   PRETO 1kg ')).toBe('feijao preto 1kg');
  });
  it('limita o tamanho', () => {
    expect(productKey('a'.repeat(300)).length).toBe(80);
  });
});

describe('dayKey', () => {
  it('usa o fuso configurado (Brasil, -180 min)', () => {
    expect(dayKey(Date.parse('2026-11-24T02:30:00Z'), -180)).toBe('2026-11-23');
    expect(dayKey(Date.parse('2026-11-24T03:00:00Z'), -180)).toBe('2026-11-24');
  });
});

describe('createHistoryStore', () => {
  const mk = (now = T0) => {
    let t = now;
    const store = createHistoryStore({ path: ':memory:', now: () => t });
    return { store, advance: (ms: number) => { t += ms; } };
  };

  it('guarda o menor preço do dia e devolve a série em ordem de data', () => {
    const { store } = mk();
    store.record('2026-11-21', 'Arroz 5kg', [{ source: 'A', priceBRL: 25 }, { source: 'B', priceBRL: 30 }]);
    store.record('2026-11-22', 'arroz 5KG', [{ source: 'A', priceBRL: 27 }, { source: 'B', priceBRL: 22 }]);
    expect(store.series('Arroz 5kg', 30)).toEqual([
      { day: '2026-11-21', cheapestBRL: 25, cheapestSource: 'A', averageBRL: 27.5, sources: 2 },
      { day: '2026-11-22', cheapestBRL: 22, cheapestSource: 'B', averageBRL: 24.5, sources: 2 },
    ]);
  });
  it('consultar de novo no mesmo dia substitui o valor (vale o mais recente)', () => {
    const { store } = mk();
    store.record('2026-11-23', 'Leite 1L', [{ source: 'A', priceBRL: 5 }]);
    store.record('2026-11-23', 'Leite 1L', [{ source: 'A', priceBRL: 4.5 }]);
    expect(store.series('Leite 1L', 30)).toMatchObject([{ cheapestBRL: 4.5, sources: 1 }]);
  });
  it('só devolve os últimos N dias', () => {
    const { store } = mk();
    store.record('2026-10-01', 'Café', [{ source: 'A', priceBRL: 20 }]);
    store.record('2026-11-20', 'Café', [{ source: 'A', priceBRL: 21 }]);
    expect(store.series('Café', 30).map((p) => p.day)).toEqual(['2026-11-20']);
  });
  it('produto sem histórico devolve lista vazia', () => {
    expect(mk().store.series('nada', 30)).toEqual([]);
  });
  it('ignora preços inválidos', () => {
    const { store } = mk();
    store.record('2026-11-23', 'Sal', [{ source: 'A', priceBRL: -1 }, { source: 'B', priceBRL: Number.NaN }, { source: 'C', priceBRL: 3 }]);
    expect(store.series('Sal', 30)).toMatchObject([{ cheapestBRL: 3, sources: 1 }]);
  });
  it('purge remove o que passou do prazo de retenção', () => {
    let t = T0;
    const store = createHistoryStore({ path: ':memory:', now: () => t, keepDays: 10 });
    store.record('2026-11-01', 'Açúcar', [{ source: 'A', priceBRL: 5 }]);
    store.record('2026-11-22', 'Açúcar', [{ source: 'A', priceBRL: 6 }]);
    expect(store.purge()).toBe(1);
    expect(store.series('Açúcar', 365).map((p) => p.day)).toEqual(['2026-11-22']);
    t += 20 * DAY;
  });
  it('é seguro contra texto malicioso (SQL)', () => {
    const { store } = mk();
    store.record('2026-11-23', "x'); DROP TABLE prices;--", [{ source: 'A', priceBRL: 1 }]);
    expect(store.series("x'); DROP TABLE prices;--", 30)).toHaveLength(1);
    expect(store.series('Arroz', 30)).toEqual([]);
  });
});

describe('observações (o que a loja tinha, com o título que casou)', () => {
  const T = Date.parse('2026-11-26T12:00:00Z');
  const mk = () => { let t = T; return { store: createHistoryStore({ path: ':memory:', now: () => t, keepDays: 30 }), advance: (ms: number) => { t += ms; } }; };
  const row = (extra: Record<string, unknown> = {}) => ({ source: 'Comper', title: 'Óleo de Soja Liza 900ml', priceBRL: 7.59, unitPriceBRL: 8.43, uncertain: false, ...extra });

  it('guarda título, preço, preço por unidade e se foi incerto', () => {
    const { store } = mk();
    store.recordObservations('2026-11-26', 'Óleo de soja 900ml', [row(), row({ source: 'Royal', title: 'Oleo liza algodao 900ml', priceBRL: 20.99, unitPriceBRL: 23.32, uncertain: true })]);
    expect(store.observationsOn('2026-11-26', 'óleo de soja 900ml')).toEqual([
      { source: 'Comper', title: 'Óleo de Soja Liza 900ml', priceBRL: 7.59, unitPriceBRL: 8.43, uncertain: false },
      { source: 'Royal', title: 'Oleo liza algodao 900ml', priceBRL: 20.99, unitPriceBRL: 23.32, uncertain: true },
    ]);
  });
  it('a segunda gravação do mesmo dia, produto e loja substitui a primeira', () => {
    const { store } = mk();
    store.recordObservations('2026-11-26', 'arroz 5kg', [row({ title: 'A', priceBRL: 20 })]);
    store.recordObservations('2026-11-26', 'arroz 5kg', [row({ title: 'B', priceBRL: 19 })]);
    expect(store.observationsOn('2026-11-26', 'arroz 5kg')).toHaveLength(1);
    expect(store.observationsOn('2026-11-26', 'arroz 5kg')[0]).toMatchObject({ title: 'B', priceBRL: 19 });
  });
  it('preço inválido, título vazio ou loja vazia não entram; unidade é opcional', () => {
    const { store } = mk();
    store.recordObservations('2026-11-26', 'sal 1kg', [row({ priceBRL: 0 }), row({ priceBRL: NaN }), row({ title: '' }), row({ source: '' }), row({ unitPriceBRL: undefined, source: 'Brasão' })]);
    const out = store.observationsOn('2026-11-26', 'sal 1kg');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'Brasão' });
    expect(out[0]).not.toHaveProperty('unitPriceBRL');
  });
  it('corta título muito longo em 200 caracteres', () => {
    const { store } = mk();
    store.recordObservations('2026-11-26', 'sal 1kg', [row({ title: 'x'.repeat(500) })]);
    expect(store.observationsOn('2026-11-26', 'sal 1kg')[0]!.title).toHaveLength(200);
  });
  it('quantos produtos cada loja tem no dia (para medir a cobertura da coleta)', () => {
    const { store } = mk();
    store.recordObservations('2026-11-26', 'a', [row(), row({ source: 'Royal' })]);
    store.recordObservations('2026-11-26', 'b', [row()]);
    expect(store.coverageOn('2026-11-26')).toEqual({ Comper: 2, Royal: 1 });
  });
  it('o purge também apaga as observações antigas', () => {
    const { store, advance } = mk();
    store.recordObservations('2026-11-26', 'a', [row()]);
    advance(40 * 24 * 60 * 60 * 1000);
    store.purge();
    expect(store.observationsOn('2026-11-26', 'a')).toEqual([]);
  });
});
