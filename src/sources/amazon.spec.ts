import { describe, it, expect } from 'vitest';
import { parseAmazonItems, isAmazonBlocked } from './amazon.js';
import { blockedSource } from './blocked.js';
import { BlockedError } from '../domain/types.js';

describe('parseAmazonItems', () => {
  it('converte "R$ 34,99" em número e mantém o título', () => {
    const offers = parseAmazonItems([{ title: 'Arroz Branco Tio João - 5Kg', price: 'R$ 34,99', href: '/dp/B0X' }], 'Amazon');
    expect(offers).toEqual([{ source: 'Amazon', title: 'Arroz Branco Tio João - 5Kg', priceBRL: 34.99 }]);
  });
  it('aceita separador de milhar com espaço não separável', () => {
    expect(parseAmazonItems([{ title: 'TV', price: 'R$ 1.299,90' }], 'A')[0]!.priceBRL).toBe(1299.9);
  });
  it('descarta item sem título ou sem preço', () => {
    expect(parseAmazonItems([{ title: '', price: 'R$ 5,00' }, { title: 'X' }, { title: 'Y', price: 'sem preço' }], 'A')).toEqual([]);
  });
});

describe('isAmazonBlocked', () => {
  it('detecta página de CAPTCHA', () => {
    expect(isAmazonBlocked('Digite os caracteres que você vê abaixo')).toBe(true);
    expect(isAmazonBlocked('Amazon.com.br : arroz 5kg')).toBe(false);
  });
});

describe('blockedSource', () => {
  it('sempre rejeita com BlockedError', async () => {
    await expect(blockedSource('Mercado Livre', '403').search('x')).rejects.toBeInstanceOf(BlockedError);
  });
});
