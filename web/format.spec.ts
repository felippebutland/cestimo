import { describe, it, expect } from 'vitest';
import { formatBRL, formatPct } from './format.js';

describe('formatBRL', () => {
  it('formata em reais com vírgula', () => {
    expect(formatBRL(21.79)).toBe('R$ 21,79');
  });
  it('usa separador de milhar', () => {
    expect(formatBRL(1299.9)).toBe('R$ 1.299,90');
  });
  it('zero', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
  });
});

describe('formatPct', () => {
  it('uma casa decimal', () => {
    expect(formatPct(25)).toBe('25,0%');
    expect(formatPct(12.345)).toBe('12,3%');
  });
});
