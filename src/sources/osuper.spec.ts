import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOsuperHits } from './osuper.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

describe('parseOsuperHits', () => {
  it('extrai título e preço da fixture do Comper', () => {
    const offers = parseOsuperHits(fixture('comper.json'), 'Comper');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]).toMatchObject({ source: 'Comper', title: 'Arroz Urbano 5kg Tipo 1', priceBRL: 21.79 });
  });
  it('usa o preço promocional quando há promoção', () => {
    const json = { hits: [{ name: 'Arroz X 5kg', pricing: { price: 20, promotion: true, promotionalPrice: 15 } }] };
    expect(parseOsuperHits(json, 'S')[0]!.priceBRL).toBe(15);
  });
  it('acrescenta o conteúdo ao título quando o nome não traz tamanho', () => {
    const json = { hits: [{ name: 'Arroz Au Au', content: 5, contentUnit: 'KG', pricing: { price: 19.99, promotion: false } }] };
    expect(parseOsuperHits(json, 'S')[0]!.title).toBe('Arroz Au Au 5KG');
  });
  it('descarta hit sem preço válido', () => {
    const json = { hits: [{ name: 'A', pricing: { price: 0 } }, { name: 'B' }, { name: 'C', pricing: { price: 'abc' } }] };
    expect(parseOsuperHits(json, 'S')).toEqual([]);
  });
  it('JSON inesperado retorna lista vazia', () => {
    expect(parseOsuperHits(null, 'S')).toEqual([]);
    expect(parseOsuperHits({ foo: 1 }, 'S')).toEqual([]);
    expect(parseOsuperHits('x', 'S')).toEqual([]);
  });
  it('lê a fixture da Royal', () => {
    const offers = parseOsuperHits(fixture('royal.json'), 'Royal');
    expect(offers.some((o) => o.title.toLowerCase().includes('arroz') && o.priceBRL > 0)).toBe(true);
  });
});
