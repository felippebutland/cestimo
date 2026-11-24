import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bootstrapUrl, buildSearchPath, isTransientBrowserError, parseVtexProducts, pickRegionId } from './vtex.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

describe('parseVtexProducts', () => {
  it('lê nome e preço de venda de cada produto da busca', () => {
    const offers = parseVtexProducts(fixture('vtex-dipirona.json'), 'Pague Menos');
    expect(offers).toHaveLength(4);
    expect(offers[0]).toEqual({ source: 'Pague Menos', title: 'Dipirona Sódica 50mg/ml 100ml Solução Oral Genérico EMS', priceBRL: 16.79 });
    expect(offers[1]!.priceBRL).toBe(21.79);
  });
  const product = (over: Record<string, unknown> = {}) => ({ productName: 'Dipirona 500mg', priceRange: { sellingPrice: { lowPrice: 9.9 } }, items: [{ sellers: [{ commertialOffer: { AvailableQuantity: 5 } }] }], ...over });
  it('descarta produto sem estoque em todos os vendedores', () => {
    const payload = { products: [product({ items: [{ sellers: [{ commertialOffer: { AvailableQuantity: 0 } }] }] }), product({ productName: 'Outro' })] };
    expect(parseVtexProducts(payload, 'X').map((o) => o.title)).toEqual(['Outro']);
  });
  it('sem informação de estoque, mantém o produto (o filtro de indisponíveis já é feito na busca)', () => {
    expect(parseVtexProducts({ products: [product({ items: undefined })] }, 'X')).toHaveLength(1);
  });
  it('descarta preço ausente, zero, negativo ou que não é número; e nome ausente', () => {
    const payload = { products: [
      product({ priceRange: undefined }), product({ priceRange: { sellingPrice: { lowPrice: 0 } } }),
      product({ priceRange: { sellingPrice: { lowPrice: -1 } } }), product({ priceRange: { sellingPrice: { lowPrice: 'abc' } } }),
      product({ productName: undefined }), product({ productName: '  ' }),
    ] };
    expect(parseVtexProducts(payload, 'X')).toEqual([]);
  });
  it('payload inesperado devolve lista vazia, sem quebrar', () => {
    for (const bad of [null, undefined, 'x', {}, { products: 'x' }, { products: null }]) expect(parseVtexProducts(bad, 'X')).toEqual([]);
  });
});

describe('pickRegionId', () => {
  it('usa o id da primeira região devolvida para o CEP', () => {
    expect(pickRegionId(fixture('vtex-regions.json'))).toMatch(/^v2\./);
  });
  it('CEP sem atendimento (lista vazia ou formato inesperado) = null', () => {
    for (const bad of [[], null, undefined, {}, [{}], [{ id: 5 }]]) expect(pickRegionId(bad)).toBeNull();
  });
});

describe('buildSearchPath', () => {
  it('monta a busca da loja com a região de Chapecó e só produtos disponíveis', () => {
    const p = buildSearchPath('dipirona 500mg', 'v2.ABC');
    expect(p).toContain('/api/io/_v/api/intelligent-search/product_search/?');
    expect(p).toContain('query=dipirona+500mg');
    expect(p).toContain('regionId=v2.ABC');
    expect(p).toContain('hideUnavailableItems=true');
  });
  it('sem região (CEP não atendido), a busca vai sem o parâmetro regionId', () => {
    expect(buildSearchPath('sal', null)).not.toContain('regionId');
  });
  it('caracteres especiais na consulta são escapados', () => {
    expect(buildSearchPath('a&b=c?d', null)).toContain('query=a%26b%3Dc%3Fd');
  });
});

describe('bootstrapUrl', () => {
  it('abre uma página mínima da própria loja (robots.txt) só para chamar a busca no mesmo domínio: a vitrine inteira pesa e chegou a derrubar o navegador', () => {
    expect(bootstrapUrl('https://www.paguemenos.com.br')).toBe('https://www.paguemenos.com.br/robots.txt');
  });
});

describe('isTransientBrowserError (vale repetir uma vez)', () => {
  it.each([['page.evaluate: Target crashed '], ['page.goto: Target closed'], ['Protocol error: Target page, context or browser has been closed']])('%s', (m) => {
    expect(isTransientBrowserError(new Error(m))).toBe(true);
  });
  it.each([['a loja não atende o CEP 89801000'], ['o site respondeu 403 sem a lista de produtos'], ['timeout']])('%s não repete', (m) => {
    expect(isTransientBrowserError(new Error(m))).toBe(false);
  });
  it('valor que não é Error não quebra', () => {
    expect(isTransientBrowserError(undefined)).toBe(false);
  });
});
