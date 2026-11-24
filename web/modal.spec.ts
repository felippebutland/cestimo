import { describe, it, expect } from 'vitest';
import { validateName } from './modal.js';

describe('validateName', () => {
  it('aceita nome comum e tira espaços das pontas e repetidos', () => {
    expect(validateName('  Compras   do mês ', 40)).toEqual({ ok: true, value: 'Compras do mês' });
  });
  it('recusa vazio ou só espaços', () => {
    expect(validateName('', 40)).toEqual({ ok: false, error: 'Digite um nome.' });
    expect(validateName('   ', 40)).toEqual({ ok: false, error: 'Digite um nome.' });
  });
  it('recusa acima do limite, dizendo o limite', () => {
    expect(validateName('x'.repeat(41), 40)).toEqual({ ok: false, error: 'Use até 40 letras.' });
    expect(validateName('x'.repeat(40), 40).ok).toBe(true);
  });
});
