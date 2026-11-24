import { describe, it, expect } from 'vitest';
import { normalizeMarket, visibleMarkets } from './marketFilter.js';

const NAMES = ['Comper', 'Royal', 'Brasão'];

describe('visibleMarkets', () => {
  it('sem filtro (null) mostra todos os mercados, na ordem original', () => {
    expect(visibleMarkets(NAMES, null)).toEqual(NAMES);
  });
  it('com um mercado escolhido mostra só ele', () => {
    expect(visibleMarkets(NAMES, 'Royal')).toEqual(['Royal']);
  });
  it('mercado que não existe mais (nova consulta) volta a mostrar todos', () => {
    expect(visibleMarkets(NAMES, 'Amazon')).toEqual(NAMES);
  });
});

describe('normalizeMarket', () => {
  it('mantém o mercado se ele ainda está na lista e limpa se não está', () => {
    expect(normalizeMarket(NAMES, 'Royal')).toBe('Royal');
    expect(normalizeMarket(NAMES, 'Amazon')).toBeNull();
    expect(normalizeMarket(NAMES, null)).toBeNull();
    expect(normalizeMarket([], 'Royal')).toBeNull();
  });
});
