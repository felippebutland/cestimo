import { describe, it, expect } from 'vitest';
import { scoreMatch, pickBest, searchTerm, MATCH_THRESHOLD, CERTAIN_THRESHOLD } from './match.js';
import type { Offer } from './types.js';

const o = (title: string, priceBRL: number, source = 's'): Offer => ({ source, title, priceBRL });

describe('scoreMatch', () => {
  it('título mais completo com mesmos termos passa do limiar', () => {
    expect(scoreMatch('Arroz Tio João 5kg', 'Arroz Branco Tio João Tipo 1 5kg')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  it('mesmo tamanho pontua mais que tamanho diferente', () => {
    expect(scoreMatch('Arroz 5kg', 'Arroz Urbano 5kg')).toBeGreaterThan(scoreMatch('Arroz 5kg', 'Arroz Urbano 1kg'));
  });
  it('ignora acentos e caixa', () => {
    expect(scoreMatch('FEIJÃO PRETO', 'feijao preto')).toBe(1);
  });
  it('produto sem relação pontua abaixo do limiar', () => {
    expect(scoreMatch('Arroz 5kg', 'Shampoo Infantil 400ml')).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('pickBest', () => {
  it('lista vazia retorna null', () => {
    expect(pickBest('Arroz 5kg', [])).toBeNull();
  });
  it('só itens irrelevantes retorna null', () => {
    expect(pickBest('Arroz 5kg', [o('Shampoo 400ml', 10)])).toBeNull();
  });
  it('escolhe o de maior score', () => {
    const r = pickBest('Arroz 5kg', [o('Arroz Urbano 1kg', 5), o('Arroz Urbano 5kg', 22)]);
    expect(r?.offer.priceBRL).toBe(22);
  });
  it('empate de score resolve pelo menor preço', () => {
    const r = pickBest('Arroz 5kg', [o('Arroz Urbano 5kg', 25), o('Arroz Urbano 5kg', 21)]);
    expect(r?.offer.priceBRL).toBe(21);
  });
  it('empate de score prefere o título mais curto antes do menor preço', () => {
    const r = pickBest('Arroz 5kg', [o('Arroz Urbano Tipo 1 Premium 5kg', 21), o('Arroz Urbano 5kg', 25)]);
    expect(r?.offer.priceBRL).toBe(25);
  });
});

describe('regressão: tamanho ausente ou embalagem múltipla (review C2)', () => {
  it('consulta com tamanho e título sem tamanho fica abaixo do limiar', () => {
    expect(scoreMatch('Leite integral 1L', 'Leite Integral Italac')).toBeLessThan(MATCH_THRESHOLD);
  });
  it('fardo "12x1L" não casa com consulta de 1L', () => {
    expect(scoreMatch('Leite integral 1L', 'Leite Integral 12x1L')).toBeLessThan(MATCH_THRESHOLD);
  });
  it('mesmo produto e mesmo tamanho é confiável', () => {
    expect(scoreMatch('Leite integral 1L', 'Leite Integral Italac 1L')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('limiar de certeza é maior que o de aceitação', () => {
    expect(CERTAIN_THRESHOLD).toBeGreaterThan(MATCH_THRESHOLD);
  });
});

describe('pickBest com tamanho diferente (preço por unidade)', () => {
  it('sem item do tamanho pedido, usa o mesmo produto de outro tamanho e marca como ajustado', () => {
    const r = pickBest('Arroz Tio João 5kg', [o('Arroz Tio João 1kg', 7)]);
    expect(r?.offer.priceBRL).toBe(7);
    expect(r?.sizeAdjusted).toBe(true);
  });
  it('item do tamanho exato vence o ajustado', () => {
    const r = pickBest('Arroz Tio João 5kg', [o('Arroz Tio João 1kg', 6), o('Arroz Tio João 5kg', 30)]);
    expect(r?.offer.priceBRL).toBe(30);
    expect(r?.sizeAdjusted).toBe(false);
  });
  it('dimensão diferente não é ajustada (un vs kg)', () => {
    expect(pickBest('Ovos 12un', [o('Ovos Brancos 1kg', 9)])).toBeNull();
  });
  it('produto diferente não é ajustado', () => {
    expect(pickBest('Arroz Tio João 5kg', [o('Arroz Camil 1kg', 6)])).toBeNull();
  });
  it('fardo não é ajustado', () => {
    expect(pickBest('Leite integral 1L', [o('Leite Integral 12x500ml', 40)])).toBeNull();
  });
  it('entre ajustados, prefere o menor preço por unidade em empate de termos', () => {
    const r = pickBest('Arroz Tio João 5kg', [o('Arroz Tio João 1kg', 7), o('Arroz Tio João 2kg', 12)]);
    expect(r?.offer.title).toBe('Arroz Tio João 2kg');
  });
});

describe('termos extras no título (review C2)', () => {
  it('variante que muda o produto (orgânico) derruba abaixo da certeza', () => {
    expect(scoreMatch('Feijão preto 2kg', 'Feijão Preto Orgânico Biorgânica 2kg')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('marca extra não derruba a certeza', () => {
    expect(scoreMatch('Feijão preto 1kg', 'Feijão Preto Camil 1kg')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('variante pedida na consulta não é penalizada', () => {
    expect(scoreMatch('Arroz integral 5kg', 'Arroz Integral Camil 5kg')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('palavras de tipo e números soltos não contam como extras', () => {
    expect(scoreMatch('Arroz Tio João 5kg', 'Arroz Tio João Tipo 1 5kg')).toBe(1);
  });
  it('pickBest prefere o título sem variante mesmo sendo mais caro', () => {
    const r = pickBest('Feijão preto 1kg', [o('Feijão Preto Orgânico 1kg', 5), o('Feijão Preto Camil 1kg', 8)]);
    expect(r?.offer.priceBRL).toBe(8);
  });
  it('o ajuste por tamanho também respeita a penalidade', () => {
    expect(pickBest('Feijão preto 2kg', [o('Feijão Preto Orgânico Premium 1kg', 12)])).toBeNull();
  });
});

describe('ovos: palavras de embalagem e contagem (feedback do usuário)', () => {
  it('"bandeja de" na consulta não é exigido no título', () => {
    expect(scoreMatch('Bandeja de ovos 30un', 'Ovos Brancos Sieme com 30 Unidades Grandes')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  it('"C/30" é a contagem de ovos e não um fardo', () => {
    expect(scoreMatch('Bandeja de ovos 30un', 'Bandeja Ovos Branco Grande Avimor C/30')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('contagem diferente (C/20) vira ajustado e não exato', () => {
    const r = pickBest('Bandeja de ovos 30un', [o('Ovos Branco Extra Avimor C/20', 14.99)]);
    expect(r?.sizeAdjusted).toBe(true);
  });
  it('massa com ovos não é a bandeja de ovos', () => {
    expect(pickBest('Bandeja de ovos 30un', [o('Massa Orquidea 500g C/ovos Espaguete', 3.79)])).toBeNull();
  });
  it('ovos de codorna em conserva não é a bandeja de ovos', () => {
    expect(pickBest('Bandeja de ovos 30un', [o('Ovos de Codorna em Conserva Kremer 300g', 19.75)])).toBeNull();
  });
  it('"C/12" junto de tamanho em litros continua sendo fardo', () => {
    expect(scoreMatch('Leite integral 1L', 'Leite Integral 1L C/12')).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('searchTerm', () => {
  it('remove palavras de ligação e de embalagem, mantém o resto', () => {
    expect(searchTerm('Bandeja de ovos 30un')).toBe('ovos');
  });
  it('tira a contagem de unidades (os sites não buscam por "30un") mas mantém kg/L', () => {
    expect(searchTerm('Ovos 30un')).toBe('Ovos');
    expect(searchTerm('Leite integral 1L')).toBe('Leite integral 1L');
  });
  it('não altera consulta sem essas palavras', () => {
    expect(searchTerm('Arroz Tio João 5kg')).toBe('Arroz Tio João 5kg');
  });
  it('se tudo for removido, devolve a consulta original', () => {
    expect(searchTerm('de')).toBe('de');
  });
});

describe('ovos: variantes que não são o produto pedido', () => {
  it('ovos de codorna não são ovos de galinha', () => {
    expect(scoreMatch('Bandeja de ovos 30un', 'Ovos Codorna 30un Embalado')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('ovos caipira são variante', () => {
    expect(scoreMatch('Bandeja de ovos 30un', 'Ovos Caipira Santa Gema C/30')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('porta-ovos (acessório) não é a bandeja de ovos', () => {
    expect(scoreMatch('Bandeja de ovos 30un', 'Porta Ovos 30un Com Tampa Organizador Geladeira')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('quem pede codorna recebe codorna sem penalidade', () => {
    expect(scoreMatch('Ovos de codorna 30un', 'Ovos Codorna 30un Embalado')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('pickBest prefere o ovo de galinha ao de codorna mesmo mais caro', () => {
    const r = pickBest('Bandeja de ovos 30un', [o('Ovos Codorna 30un Embalado', 9.98), o('Ovos Branco Avimor 30un', 18.99)]);
    expect(r?.offer.priceBRL).toBe(18.99);
  });
});

describe('variedades de arroz são outro produto', () => {
  it('carnaroli/arbóreo/basmati não casam com "Arroz Tio João" comum', () => {
    expect(scoreMatch('Arroz Tio João 5kg', 'Arroz Carnaroli Tio Joao 5kg')).toBeLessThan(CERTAIN_THRESHOLD);
    expect(scoreMatch('Arroz Tio João 5kg', 'Arroz Basmati Tio Joao 5kg')).toBeLessThan(CERTAIN_THRESHOLD);
  });
});

