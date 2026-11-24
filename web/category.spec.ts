import { describe, it, expect } from 'vitest';
import { CATEGORY_TEXT, normalizeCategory, savedKey, sourcesFor } from './category.js';

const CATEGORIES = [
  { id: 'mercados', label: 'Mercados', sources: ['Comper', 'Royal'] },
  { id: 'farmacias', label: 'Farmácias', sources: ['Pague Menos'] },
];

describe('normalizeCategory', () => {
  it('mantém a categoria se ela existe na configuração', () => {
    expect(normalizeCategory('farmacias', CATEGORIES)).toBe('farmacias');
    expect(normalizeCategory('mercados', CATEGORIES)).toBe('mercados');
  });
  it('valor desconhecido, vazio ou de outro tipo volta para mercados', () => {
    for (const bad of ['padarias', '', null, undefined, 5]) expect(normalizeCategory(bad, CATEGORIES)).toBe('mercados');
  });
  it('categoria que deixou de existir (farmácias removidas da configuração) volta para mercados', () => {
    expect(normalizeCategory('farmacias', [CATEGORIES[0]!])).toBe('mercados');
  });
});

describe('savedKey', () => {
  it('mercados mantém a chave antiga (quem já tem lista salva não perde nada); farmácias tem a sua', () => {
    expect(savedKey('mercados')).toBe('cestimo:ultima');
    expect(savedKey('farmacias')).toBe('cestimo:ultima:farmacias');
  });
});

describe('sourcesFor', () => {
  it('lojas da categoria; categoria desconhecida = lista vazia', () => {
    expect(sourcesFor(CATEGORIES, 'farmacias')).toEqual(['Pague Menos']);
    expect(sourcesFor(CATEGORIES, 'mercados')).toEqual(['Comper', 'Royal']);
    expect(sourcesFor(CATEGORIES, 'x')).toEqual([]);
  });
});

describe('CATEGORY_TEXT', () => {
  it.each(['mercados', 'farmacias'])('%s tem exemplos, dica, mensagem de carregamento e rótulos do filtro', (id) => {
    const t = CATEGORY_TEXT[id as 'mercados' | 'farmacias'];
    expect(t.examples.length).toBeGreaterThanOrEqual(4);
    for (const key of ['placeholder', 'loading', 'filterLabel', 'filterAll', 'tagline'] as const) expect(t[key].length).toBeGreaterThan(3);
  });
  it('os exemplos de farmácia trazem dosagem e quantidade, como a comparação espera', () => {
    expect(CATEGORY_TEXT.farmacias.examples.join(' ')).toMatch(/mg/);
    expect(CATEGORY_TEXT.farmacias.examples.join(' ')).toMatch(/comprimidos/i);
  });
});
