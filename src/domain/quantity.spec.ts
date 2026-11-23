import { describe, it, expect } from 'vitest';
import { extractQuantity, unitPrice, unitLabel } from './quantity.js';

describe('extractQuantity', () => {
  it.each([
    ['Arroz Urbano 5kg Tipo 1', { value: 5000, dim: 'mass' }],
    ['Leite 1L', { value: 1000, dim: 'volume' }],
    ['Refri 350ml', { value: 350, dim: 'volume' }],
    ['Ovos 12un', { value: 12, dim: 'count' }],
    ['Feijão 500 g', { value: 500, dim: 'mass' }],
    ['Açúcar 2,5kg', { value: 2500, dim: 'mass' }],
  ])('%s', (text, expected) => {
    expect(extractQuantity(text)).toEqual(expected);
  });
  it('sem quantidade retorna null', () => {
    expect(extractQuantity('Sabão')).toBeNull();
  });
  it('não confunde "Tipo 1" ou "Pacote com 5" com quantidade', () => {
    expect(extractQuantity('Arroz Tipo 1')).toBeNull();
  });
});

describe('extractQuantity: contagem de unidades (ovos)', () => {
  it.each([
    ['Ovos Brancos Sieme com 30 Unidades Grandes', { value: 30, dim: 'count' }],
    ['Bandeja Ovos Branco Grande Avimor C/30', { value: 30, dim: 'count' }],
    ['OVOS VERMELHOS BENTO BDJ C/ 30', { value: 30, dim: 'count' }],
    ['Ovos Caipira Santa Gema Com 20un', { value: 20, dim: 'count' }],
    ['ovos galinha granja santa gema vermelho c20 0', { value: 20, dim: 'count' }],
    ['Ovos galinha caipira com 10 unidades 0', { value: 10, dim: 'count' }],
    ['Arroz com 5kg', { value: 5000, dim: 'mass' }],
    ['Leite 1L c/12', { value: 1000, dim: 'volume' }],
    ['Massa com ovos 500g', { value: 500, dim: 'mass' }],
  ])('%s', (text, expected) => {
    expect(extractQuantity(text)).toEqual(expected);
  });
});

describe('unitPrice', () => {
  it('R$ por kg', () => {
    expect(unitPrice(20, { value: 5000, dim: 'mass' })).toBeCloseTo(4);
  });
  it('R$ por litro', () => {
    expect(unitPrice(6, { value: 500, dim: 'volume' })).toBeCloseTo(12);
  });
  it('R$ por unidade', () => {
    expect(unitPrice(12, { value: 12, dim: 'count' })).toBeCloseTo(1);
  });
});

describe('unitLabel', () => {
  it('rótulo da unidade de comparação por dimensão', () => {
    expect(unitLabel('mass')).toBe('kg');
    expect(unitLabel('volume')).toBe('L');
    expect(unitLabel('count')).toBe('un');
  });
});
