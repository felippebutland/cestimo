import { describe, it, expect } from 'vitest';
import { cmedText, cmedTitle } from './cmed.js';

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

describe('cmedText', () => {
  it('faixa: do menor ao maior teto', () => {
    expect(cmedText({ minBRL: 15.06, maxBRL: 22.79, n: 3, listDate: '2026-11-09', generic: false }, brl)).toBe('Teto oficial (CMED): R$ 15,06 a R$ 22,79');
  });
  it('um só valor: "até"', () => {
    expect(cmedText({ minBRL: 24.64, maxBRL: 24.64, n: 1, listDate: null, generic: false }, brl)).toBe('Teto oficial (CMED): até R$ 24,64');
  });
  it('de genérico: diz que o teto é do genérico', () => {
    expect(cmedText({ minBRL: 16.4, maxBRL: 21, n: 2, listDate: null, generic: true }, brl)).toBe('Teto oficial do genérico (CMED): R$ 16,40 a R$ 21,00');
  });
  it('sem dado ou valor inválido: null (nada a mostrar)', () => {
    for (const bad of [undefined, null, {}, { minBRL: 'x', maxBRL: 1 }, { minBRL: 1, maxBRL: Number.NaN }]) expect(cmedText(bad as never, brl)).toBeNull();
  });
});

describe('cmedTitle', () => {
  it('explica o que é o teto e a data da lista, em dia/mês/ano', () => {
    const t = cmedTitle({ minBRL: 1, maxBRL: 2, n: 4, listDate: '2026-11-09' });
    expect(t).toContain('09/11/2026');
    expect(t).toMatch(/preço máximo/i);
    expect(t).toContain('4 apresentações');
  });
  it('sem data da lista, não inventa uma', () => {
    expect(cmedTitle({ minBRL: 1, maxBRL: 2, n: 1, listDate: null })).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(cmedTitle({ minBRL: 1, maxBRL: 2, n: 1, listDate: null })).toContain('1 apresentação');
  });
});
