import { describe, it, expect } from 'vitest';
import { ageLabel, changeLabel, changesSince, isStale, itemKey, progress, toggleChecked, changeBadge, defaultListName, listLabel, sparkPoints } from './panel.js';

const base = { latestBRL: 10, latestSource: 'Comper', latestDay: '2026-11-24', changePct: null, dropPct: null, dropped: false, spark: [10] };

describe('changeBadge', () => {
  it('sem preço ainda', () => {
    expect(changeBadge({ ...base, latestBRL: null })).toEqual({ kind: 'none', text: 'Aguardando o primeiro preço' });
  });
  it('queda de 5% ou mais destaca "Caiu"', () => {
    expect(changeBadge({ ...base, dropped: true, dropPct: 6.04 })).toEqual({ kind: 'drop', text: 'Caiu 6%' });
    expect(changeBadge({ ...base, dropped: true, dropPct: 12.5 }).text).toBe('Caiu 12,5%');
  });
  it('sem histórico suficiente: só "Acompanhando"', () => {
    expect(changeBadge(base)).toEqual({ kind: 'flat', text: 'Acompanhando' });
  });
  it('variação desde o início', () => {
    expect(changeBadge({ ...base, changePct: -8 })).toEqual({ kind: 'down', text: '8% mais barato desde que você começou' });
    expect(changeBadge({ ...base, changePct: 3.2 })).toEqual({ kind: 'up', text: '3,2% mais caro desde que você começou' });
    expect(changeBadge({ ...base, changePct: 0.2 })).toEqual({ kind: 'flat', text: 'Preço estável' });
  });
});

describe('listLabel', () => {
  it('conta itens e diz a categoria', () => {
    expect(listLabel({ list: 'A\nB\nC', category: 'mercados' })).toBe('3 itens · Mercados');
    expect(listLabel({ list: 'A', category: 'farmacias' })).toBe('1 item · Farmácias');
  });
});

describe('defaultListName', () => {
  it('"Lista de dd/mm"', () => {
    expect(defaultListName(new Date(2026, 10, 4))).toBe('Lista de 04/11');
  });
});

describe('sparkPoints', () => {
  it('adapta os preços para o gráfico de tendência', () => {
    expect(sparkPoints([5, 4])).toEqual([{ cheapestBRL: 5 }, { cheapestBRL: 4 }]);
  });
});

const result = (arroz: number | null, leite: number | null) => ({
  products: [
    { query: 'Arroz 5kg', stats: arroz === null ? null : { cheapest: { priceBRL: arroz, source: 'Comper' } } },
    { query: 'Leite 1L', stats: leite === null ? null : { cheapest: { priceBRL: leite, source: 'Royal' } } },
  ],
});

describe('itemKey', () => {
  it('mesma chave do servidor: sem acento, caixa e espaços repetidos', () => {
    expect(itemKey('  Feijão  PRETO 1kg ')).toBe('feijao preto 1kg');
  });
});

describe('changesSince (variação em relação à lista salva antes)', () => {
  const prev = { at: 1, prices: { 'arroz 5kg': 30, 'leite 1l': 5 } };
  it('por item e no total, só dos itens presentes nos dois', () => {
    const c = changesSince(result(28.5, 5.5), prev);
    expect(c.items.get('arroz 5kg')).toMatchObject({ fromBRL: 30, toBRL: 28.5, diffBRL: -1.5, kind: 'down' });
    expect(c.items.get('arroz 5kg')!.pct).toBeCloseTo(-5, 5);
    expect(c.items.get('leite 1l')).toMatchObject({ diffBRL: 0.5, kind: 'up' });
    expect(c.total).toMatchObject({ fromBRL: 35, toBRL: 34, diffBRL: -1, kind: 'down' });
  });
  it('preço igual', () => {
    expect(changesSince(result(30, 5), prev).total?.kind).toBe('same');
  });
  it('item sem preço agora ou antes não entra na comparação', () => {
    const c = changesSince(result(null, 6), prev);
    expect(c.items.has('arroz 5kg')).toBe(false);
    expect(c.total).toMatchObject({ fromBRL: 5, toBRL: 6, kind: 'up' });
  });
  it('sem preços anteriores: nada a mostrar', () => {
    expect(changesSince(result(30, 5), null)).toEqual({ items: new Map(), total: null });
    expect(changesSince(result(null, null), prev).total).toBeNull();
  });
});

describe('changeLabel', () => {
  it('seta, valor e percentual', () => {
    expect(changeLabel({ fromBRL: 30, toBRL: 28.5, diffBRL: -1.5, pct: -5, kind: 'down' })).toBe('↓ R$ 1,50 (5%)');
    expect(changeLabel({ fromBRL: 5, toBRL: 5.5, diffBRL: 0.5, pct: 10, kind: 'up' })).toBe('↑ R$ 0,50 (10%)');
    expect(changeLabel({ fromBRL: 5, toBRL: 5, diffBRL: 0, pct: 0, kind: 'same' })).toBe('igual');
  });
});

describe('progress', () => {
  it('conta só marcados que ainda são itens da lista', () => {
    expect(progress(['a', 'b', 'c'], ['a', 'x'])).toEqual({ done: 1, total: 3, label: '1 de 3' });
    expect(progress([], [])).toEqual({ done: 0, total: 0, label: '0 de 0' });
  });
});

describe('toggleChecked', () => {
  it('marca e desmarca, sem mexer no original', () => {
    const base = ['a'];
    expect(toggleChecked(base, 'b')).toEqual(['a', 'b']);
    expect(toggleChecked(base, 'a')).toEqual([]);
    expect(base).toEqual(['a']);
  });
});

describe('ageLabel e isStale', () => {
  const at = new Date(2026, 10, 24, 10, 30).getTime();
  it('"preços de dd/mm às hh:mm"', () => {
    expect(ageLabel(at)).toBe('preços de 24/11 às 10:30');
  });
  it('fica velho depois de 3 dias', () => {
    expect(isStale(at, at + 2 * 86_400_000)).toBe(false);
    expect(isStale(at, at + 3 * 86_400_000 + 1)).toBe(true);
  });
});
