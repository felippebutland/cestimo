import { describe, it, expect } from 'vitest';
import { changeBadge, defaultListName, listLabel, sparkPoints } from './panel.js';

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
