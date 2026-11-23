import { describe, it, expect } from 'vitest';
import { scoreMatch, pickBest, rankCandidates, searchTerm, MATCH_THRESHOLD, CERTAIN_THRESHOLD } from './match.js';
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

describe('produto derivado não é o produto pedido (molho de tomate x sardinha em molho de tomate)', () => {
  const Q = 'Molho de tomate 340g';
  it('sardinha/atum em molho de tomate ficam abaixo da certeza', () => {
    expect(scoreMatch(Q, 'Sardinha 88 com Molho de Tomate 125g')).toBeLessThan(CERTAIN_THRESHOLD);
    expect(scoreMatch(Q, 'Atum 88 Ralado Molho Tomate 140g')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('sem outro candidato, a sardinha não vira "molho de tomate" (melhor sem resultado do que errado)', () => {
    expect(pickBest(Q, [o('Sardinha 88 com Molho de Tomate 125g', 8.99)])).toBeNull();
  });
  it('entre sardinha e molhos de outro tamanho, escolhe o molho', () => {
    const r = pickBest(Q, [
      o('Sardinha 88 com Molho de Tomate 125g', 8.99),
      o('Molho de Tomate Heinz Tradicional 240g', 5.49),
      o('Molho tomate etti tradicional 300gr 300GR', 1.89),
    ]);
    expect(r?.offer.priceBRL).toBe(1.89);
    expect(r?.sizeAdjusted).toBe(true);
  });
  it('creme de leite e achocolatado não são "leite"', () => {
    expect(scoreMatch('Leite 1L', 'Achocolatado Leite 1L')).toBeLessThan(CERTAIN_THRESHOLD);
    expect(scoreMatch('Leite integral 1L', 'Creme de Leite Integral 1L')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('quem pede o derivado o recebe normalmente', () => {
    expect(scoreMatch('Sardinha em molho de tomate 125g', 'Sardinha 88 com Molho de Tomate 125g')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
    expect(scoreMatch('Creme de leite 200g', 'Creme de Leite Piracanjuba 200g')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
});

describe('outro tamanho: prefere o mais próximo do pedido', () => {
  it('300g vence 1kg quando o pedido é 340g, mesmo sendo o 1kg mais barato por unidade', () => {
    const r = pickBest('Molho de Tomate 340g', [o('Molho de Tomate Marca 1kg', 4), o('Molho de Tomate Marca 300g', 3)]);
    expect(r?.offer.title).toContain('300g');
  });
  it('notas quase iguais (uma marca a mais) não impedem de escolher o tamanho mais próximo', () => {
    const r = pickBest('Molho de Tomate 340g', [o('Molho de Tomate Heinz 240g', 5), o('Molho de Tomate Heinz Tradicional 300g', 6)]);
    expect(r?.offer.title).toContain('300g');
  });
  it('nota claramente melhor continua valendo mais que o tamanho', () => {
    const r = pickBest('Arroz Tio João 5kg', [o('Arroz Tio João 1kg', 7), o('Arroz Premium Importado Tio João 4kg', 30)]);
    expect(r?.offer.title).toBe('Arroz Tio João 1kg');
  });
});

describe('outros produtos que citam o item (bala de café, café solúvel, ração)', () => {
  it('bala sabor café não é café', () => {
    expect(scoreMatch('Café 500g', 'Bala pocket cafe 500gr')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('café em cápsula e café solúvel são outra apresentação', () => {
    expect(scoreMatch('Café 500g', 'Café solúvel Nescafé 500g')).toBeLessThan(CERTAIN_THRESHOLD);
    expect(scoreMatch('Café 500g', 'Café em cápsulas Nespresso 500g')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('ração para cães não é carne', () => {
    expect(scoreMatch('Carne 1kg', 'Ração para cães sabor carne 1kg')).toBeLessThan(CERTAIN_THRESHOLD);
  });
  it('o café comum continua confiável', () => {
    expect(scoreMatch('Café 500g', 'Café Melitta Tradicional 500g')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
});

describe('rankCandidates: opções para a pessoa escolher', () => {
  const Q = 'Molho de tomate 340g';
  it('ordena do mais ao menos relevante, inclusive o que o pickBest rejeitaria', () => {
    const ranked = rankCandidates(Q, [
      o('Sardinha 88 com Molho de Tomate 125g', 8.99),
      o('Molho de Tomate Heinz Tradicional 240g', 5.49),
      o('Molho tomate etti tradicional 300gr', 1.89),
    ]);
    expect(ranked.map((c) => c.offer.title)).toEqual([
      'Molho tomate etti tradicional 300gr',
      'Molho de Tomate Heinz Tradicional 240g',
      'Sardinha 88 com Molho de Tomate 125g',
    ]);
  });
  it('marca o que é de outro tamanho', () => {
    const [first] = rankCandidates(Q, [o('Molho de Tomate Marca 300g', 3)]);
    expect(first).toMatchObject({ sizeAdjusted: true });
  });
  it('tamanho exato vem antes do mesmo produto em outro tamanho', () => {
    const ranked = rankCandidates('Arroz Tio João 5kg', [o('Arroz Tio João 1kg', 7), o('Arroz Tio João 5kg', 30)]);
    expect(ranked[0]!.offer.title).toBe('Arroz Tio João 5kg');
    expect(ranked[0]!.sizeAdjusted).toBe(false);
  });
  it('respeita o limite e descarta o que não tem relação (abaixo do piso)', () => {
    const offers = [o('Molho de Tomate A 300g', 1), o('Molho de Tomate B 300g', 2), o('Molho de Tomate C 300g', 3), o('Shampoo Infantil 400ml', 9)];
    expect(rankCandidates(Q, offers, 2)).toHaveLength(2);
    expect(rankCandidates(Q, offers).map((c) => c.offer.title)).not.toContain('Shampoo Infantil 400ml');
  });
  it('lista vazia e consulta sem termos não geram candidatos', () => {
    expect(rankCandidates(Q, [])).toEqual([]);
    expect(rankCandidates('', [o('Molho', 1)])).toEqual([]);
  });
  it('não repete títulos iguais', () => {
    const ranked = rankCandidates(Q, [o('Molho de Tomate Marca 300g', 3), o('Molho de Tomate Marca 300g', 3)]);
    expect(ranked).toHaveLength(1);
  });
});

describe('singular e plural valem igual', () => {
  const tray = 'Bandeja Ovos Branco Grande Avimor C/30';
  it('"Ovo 30un" casa com a bandeja de "Ovos" com certeza', () => {
    expect(scoreMatch('Ovo 30un', tray)).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('e "Ovos 30un" com título no singular', () => {
    expect(scoreMatch('Ovos 30un', 'Ovo Branco Avimor C/30')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
  });
  it('não confunde palavras diferentes', () => {
    expect(scoreMatch('Arroz 5kg', 'Arroz Tio João 5kg')).toBeGreaterThanOrEqual(CERTAIN_THRESHOLD);
    expect(scoreMatch('Gás 13kg', 'Gás de cozinha 13kg')).toBeGreaterThan(0);
  });
  it('variantes no plural continuam penalizando (balas, cápsulas)', () => {
    expect(scoreMatch('Café 500g', 'Balas pocket sabor café 500g')).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('ovo de chocolate não é ovo de galinha', () => {
  const kinder = { source: 'x', title: 'Ovo Meninas C/2 Kinder 40g', priceBRL: 23.99 };
  const tray = { source: 'x', title: 'Bandeja de Ovos Vermelho Bento C/30', priceBRL: 22.99 };
  it.each(['Ovo 30un', 'Ovos 30un'])('"%s": sozinho, o Kinder não é escolhido', (q) => {
    expect(pickBest(q, [kinder])).toBeNull();
  });
  it.each(['Ovo 30un', 'Ovos 30un'])('"%s": com a bandeja na lista, ela vence', (q) => {
    expect(pickBest(q, [kinder, tray])?.offer.title).toBe(tray.title);
  });
  it('mesmo com Kinder Joy, Páscoa e Surpresa', () => {
    for (const title of ['Ovo Joy Surpresa Kinder C/2 Und 40g', 'Ovo de Páscoa 150g', 'Ovo Kinder Joy T1 20g']) {
      expect(pickBest('Ovos 30un', [{ source: 'x', title, priceBRL: 9 }])).toBeNull();
    }
  });
});

describe('searchTerm: palavra única no singular que as lojas só indexam no plural', () => {
  it('"Ovo" e "Ovo 30un" viram "ovos"', () => {
    expect(searchTerm('Ovo')).toBe('ovos');
    expect(searchTerm('Ovo 30un')).toBe('ovos');
    expect(searchTerm('Bandeja de ovo 30un')).toBe('ovos');
  });
  it('não mexe em consulta com mais palavras nem em outros produtos', () => {
    expect(searchTerm('Ovo de codorna')).toBe('Ovo codorna');
    expect(searchTerm('Arroz 5kg')).toBe('Arroz 5kg');
  });
});

