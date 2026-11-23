import { describe, it, expect } from 'vitest';
import { parseList } from './parseList.js';

describe('parseList', () => {
  it('remove vazias, faz trim e deduplica ignorando caixa, mantendo a ordem', () => {
    expect(parseList('Arroz 5kg\n\n  Feijão 1kg  \narroz 5KG')).toEqual(['Arroz 5kg', 'Feijão 1kg']);
  });
  it('string vazia retorna lista vazia', () => {
    expect(parseList('')).toEqual([]);
  });
  it('aceita quebras de linha CRLF', () => {
    expect(parseList('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
  it('só espaços retorna lista vazia', () => {
    expect(parseList('   \n \t ')).toEqual([]);
  });
});
