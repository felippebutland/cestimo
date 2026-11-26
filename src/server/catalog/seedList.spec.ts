import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSeedList, readSeedList, MAX_SEED } from './seedList.js';

describe('parseSeedList', () => {
  it('aceita a lista de produtos e limpa espaços', () => {
    expect(parseSeedList({ products: ['  Arroz 5kg ', 'Feijão preto 1kg'] })).toEqual(['Arroz 5kg', 'Feijão preto 1kg']);
  });
  it('tira repetidos ignorando caixa e acento, mantendo a primeira grafia', () => {
    expect(parseSeedList({ products: ['Feijão preto 1kg', 'feijao PRETO  1kg', 'Arroz 5kg'] })).toEqual(['Feijão preto 1kg', 'Arroz 5kg']);
  });
  it('recusa o que não é objeto com a lista "products"', () => {
    expect(() => parseSeedList(null)).toThrow(/products/);
    expect(() => parseSeedList({ products: 'arroz' })).toThrow(/products/);
  });
  it('recusa item que não é texto, vazio ou longo demais, dizendo qual é', () => {
    expect(() => parseSeedList({ products: ['Arroz', 5] })).toThrow(/item 2/);
    expect(() => parseSeedList({ products: ['Arroz', '   '] })).toThrow(/item 2/);
    expect(() => parseSeedList({ products: ['a'.repeat(121)] })).toThrow(/item 1/);
  });
  it('recusa o que não é produto (palavrão, código)', () => {
    expect(() => parseSeedList({ products: ['Arroz', 'DROP TABLE x;'] })).toThrow(/item 2/);
  });
  it('limita o tamanho da lista', () => {
    expect(() => parseSeedList({ products: Array.from({ length: MAX_SEED + 1 }, (_, i) => `Produto ${i}`) })).toThrow(/no máximo/);
  });
});

describe('readSeedList', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-'));
  it('arquivo que não existe vale lista vazia (a coleta fica desligada)', () => {
    expect(readSeedList(join(dir, 'nao-existe.json'))).toEqual([]);
  });
  it('JSON inválido dá erro claro', () => {
    const p = join(dir, 'ruim.json');
    writeFileSync(p, '{ não é json');
    expect(() => readSeedList(p)).toThrow(/JSON inválido/);
  });
  it('lê o config/seed-products.json do projeto', () => {
    const list = readSeedList(join(process.cwd(), 'config', 'seed-products.json'));
    expect(list.length).toBeGreaterThanOrEqual(100);
    expect(list.length).toBeLessThanOrEqual(MAX_SEED);
  });
});
