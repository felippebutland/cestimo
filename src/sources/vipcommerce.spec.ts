import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVipProducts } from './vipcommerce.js';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/passarela-1.json', import.meta.url), 'utf8'));
const wrap = (produtos: unknown[]) => ({ success: true, data: { produtos } });

describe('parseVipProducts', () => {
  it('lê descrição e preço (string) da fixture', () => {
    const offers = parseVipProducts(fixture, 'Passarela', 'https://www.passarelaemcasa.com.br');
    expect(offers[0]).toMatchObject({ source: 'Passarela', title: 'Arroz Parboilizado Tio Joao 5kg', priceBRL: 33.9 });
  });
  it('usa o preço de oferta quando o produto está em oferta', () => {
    const json = wrap([{ descricao: 'Arroz X 5kg', preco: '19.95', disponivel: true, em_oferta: true, oferta: { preco_oferta: '16.99' } }]);
    expect(parseVipProducts(json, 'P', 'https://x')[0]!.priceBRL).toBe(16.99);
  });
  it('descarta produto indisponível ou sem preço válido', () => {
    const json = wrap([
      { descricao: 'A', preco: '10.00', disponivel: false },
      { descricao: 'B', preco: '0.00', disponivel: true },
      { descricao: 'C', preco: 'x', disponivel: true },
    ]);
    expect(parseVipProducts(json, 'P', 'https://x')).toEqual([]);
  });
  it('monta a url do produto a partir do link', () => {
    const json = wrap([{ descricao: 'A', preco: '1.50', disponivel: true, link: 'arroz-a' }]);
    expect(parseVipProducts(json, 'P', 'https://x')[0]!.url).toBe('https://x/produto/arroz-a');
  });
  it('payload inesperado retorna lista vazia', () => {
    expect(parseVipProducts(null, 'P', 'https://x')).toEqual([]);
    expect(parseVipProducts({ data: {} }, 'P', 'https://x')).toEqual([]);
  });
});
