import { describe, it, expect } from 'vitest';
import { buildShoppingList, buildSingleStoreList, toText } from './shoppingList.js';

const src = (source: string, title: string, priceBRL: number, extra: Record<string, unknown> = {}) => ({
  source,
  status: 'ok',
  match: { title, priceBRL, equivalentBRL: priceBRL, sizeAdjusted: false, uncertain: false, ...extra },
});
const none = (source: string) => ({ source, status: 'ok' });

const data = {
  products: [
    {
      query: 'Ovos 30un',
      stats: { cheapest: { source: 'Brasão', priceBRL: 14.99 } },
      sources: [src('Comper', 'Ovos Sieme 30', 16.98), src('Brasão', 'Bandeja Ovos Avimor C/30', 14.99)],
    },
    {
      query: 'Leite integral 1L',
      stats: { cheapest: { source: 'Brasão', priceBRL: 4.99 } },
      sources: [src('Comper', 'Leite Tirol 1L', 5.98), src('Brasão', 'Leite Aurora 1L', 4.99)],
    },
    {
      query: 'Feijão preto 1kg',
      stats: { cheapest: { source: 'Comper', priceBRL: 6.98 } },
      sources: [src('Comper', 'Feijão Urbano 1kg', 6.98), src('Brasão', 'Feijão Azulão 1kg', 7.99)],
    },
    { query: 'Caviar 100g', stats: null, sources: [none('Comper'), none('Brasão')] },
  ],
};

describe('buildShoppingList', () => {
  it('agrupa cada produto no mercado mais barato dele', () => {
    const list = buildShoppingList(data);
    const brasao = list.stores.find((s) => s.source === 'Brasão')!;
    expect(brasao.items.map((i) => i.query)).toEqual(['Ovos 30un', 'Leite integral 1L']);
    expect(list.stores.find((s) => s.source === 'Comper')!.items.map((i) => i.query)).toEqual(['Feijão preto 1kg']);
  });
  it('calcula subtotal por mercado e total geral', () => {
    const list = buildShoppingList(data);
    expect(list.stores.find((s) => s.source === 'Brasão')!.subtotalBRL).toBeCloseTo(19.98);
    expect(list.totalBRL).toBeCloseTo(26.96);
  });
  it('mercado com mais itens vem primeiro', () => {
    expect(buildShoppingList(data).stores.map((s) => s.source)).toEqual(['Brasão', 'Comper']);
  });
  it('produto sem preço confiável vai para "não encontrados"', () => {
    expect(buildShoppingList(data).missing).toEqual(['Caviar 100g']);
  });
  it('usa o preço real do item (não o equivalente) e guarda o link', () => {
    const list = buildShoppingList({
      products: [{ query: 'Arroz 5kg', stats: { cheapest: { source: 'A', priceBRL: 35 } }, sources: [src('A', 'Arroz 1kg', 7, { equivalentBRL: 35, sizeAdjusted: true })] }],
    });
    expect(list.stores[0]!.items[0]).toMatchObject({ priceBRL: 7, sizeAdjusted: true });
  });
  it('resultado vazio gera lista vazia', () => {
    expect(buildShoppingList({ products: [] })).toEqual({ stores: [], missing: [], totalBRL: 0 });
  });
});

describe('toText', () => {
  const text = toText(buildShoppingList(data));
  it('tem título, mercados com subtotal e itens com preço', () => {
    expect(text).toContain('Lista de compras');
    expect(text).toContain('*Brasão* (R$ 19,98)');
    expect(text).toContain('• Ovos 30un: Bandeja Ovos Avimor C/30 — R$ 14,99');
  });
  it('mostra o total e os não encontrados', () => {
    expect(text).toContain('Total: R$ 26,96');
    expect(text).toContain('Não encontrados: Caviar 100g');
  });
  it('avisa quando o tamanho é diferente do pedido', () => {
    const t = toText({
      stores: [{ source: 'A', subtotalBRL: 7, items: [{ query: 'Arroz 5kg', title: 'Arroz 1kg', priceBRL: 7, sizeAdjusted: true }] }],
      missing: [],
      totalBRL: 7,
    });
    expect(t).toContain('(tamanho diferente do pedido)');
  });
  it('lista vazia gera texto curto sem erro', () => {
    expect(toText({ stores: [], missing: [], totalBRL: 0 })).toContain('Nenhum item');
  });
});

describe('buildSingleStoreList (um mercado só)', () => {
  const prod = (query: string, sources: unknown[]) => ({ query, stats: null, sources });
  const full = {
    products: [
      prod('Ovos 30un', [src('A', 'Ovos A', 15), src('B', 'Ovos B', 14), src('C', 'Ovos C', 10)]),
      prod('Leite 1L', [src('A', 'Leite A', 5), src('B', 'Leite B', 6), none('C')]),
      prod('Feijão 1kg', [src('A', 'Feijão A', 8), src('B', 'Feijão B', 7), src('C', 'Feijão C', 6, { uncertain: true })]),
    ],
  };

  it('escolhe o mais barato entre os mercados que têm todos os itens', () => {
    const list = buildSingleStoreList(full);
    expect(list.complete).toBe(true);
    expect(list.stores.map((s) => s.source)).toEqual(['B']);
    expect(list.totalBRL).toBe(27);
    expect(list.stores[0]!.items.map((i) => i.query)).toEqual(['Ovos 30un', 'Leite 1L', 'Feijão 1kg']);
  });
  it('ignora mercado sem match ou só com match incerto em algum item (C não tem tudo)', () => {
    expect(buildSingleStoreList(full).ranking.map((r) => r.source)).toEqual(['B', 'A']);
  });
  it('ranking traz o total de cada mercado completo, do mais barato ao mais caro', () => {
    expect(buildSingleStoreList(full).ranking).toEqual([
      { source: 'B', totalBRL: 27, covered: 3 },
      { source: 'A', totalBRL: 28, covered: 3 },
    ]);
  });
  it('compara pelo preço equivalente ao tamanho pedido, mas mostra o preço real', () => {
    const list = buildSingleStoreList({
      products: [
        prod('Arroz 5kg', [
          src('A', 'Arroz 1kg', 7, { equivalentBRL: 35, sizeAdjusted: true }),
          src('B', 'Arroz 5kg', 30),
        ]),
      ],
    });
    expect(list.stores[0]!.source).toBe('B');
  });
  it('produto que nenhum mercado tem não impede a escolha: vai para "não encontrados"', () => {
    const list = buildSingleStoreList({
      products: [
        prod('Ovos', [src('A', 'Ovos A', 15), src('B', 'Ovos B', 14)]),
        prod('Leite', [src('A', 'Leite A', 5), src('B', 'Leite B', 4)]),
        prod('Caviar', [none('A'), none('B')]),
      ],
    });
    expect(list.complete).toBe(true);
    expect(list.stores[0]!.source).toBe('B');
    expect(list.missing).toEqual(['Caviar']);
  });
  it('sem mercado completo, usa o de maior cobertura (menor total em empate) e lista o que falta', () => {
    const list = buildSingleStoreList({
      products: [
        prod('Ovos', [src('A', 'Ovos A', 15), src('B', 'Ovos B', 14)]),
        prod('Leite', [src('A', 'Leite A', 5), none('B')]),
        prod('Feijão', [none('A'), src('B', 'Feijão B', 7)]),
      ],
    });
    expect(list.complete).toBe(false);
    expect(list.stores[0]!.source).toBe('A');
    expect(list.missing).toEqual(['Feijão']);
    expect(list.ranking).toEqual([]);
  });
  it('resultado vazio gera lista vazia', () => {
    expect(buildSingleStoreList({ products: [] })).toMatchObject({ stores: [], missing: [], totalBRL: 0 });
  });
});

describe('buildSingleStoreList: escolha do mercado', () => {
  const prod = (query: string, sources: unknown[]) => ({ query, stats: null, sources });
  const data = {
    products: [
      prod('Ovos 30un', [src('A', 'Ovos A', 15), src('B', 'Ovos B', 14), src('C', 'Ovos C', 10)]),
      prod('Leite 1L', [src('A', 'Leite A', 5), src('B', 'Leite B', 6), none('C')]),
      prod('Feijão 1kg', [src('A', 'Feijão A', 8), src('B', 'Feijão B', 7), src('C', 'Feijão C', 6, { uncertain: true })]),
    ],
  };

  it('lista as opções: completos do mais barato ao mais caro, depois os incompletos', () => {
    const { options } = buildSingleStoreList(data);
    expect(options.map((o) => o.source)).toEqual(['B', 'A', 'C']);
    expect(options[0]).toEqual({ source: 'B', totalBRL: 27, realBRL: 27, adjusted: 0, covered: 3, findable: 3, complete: true });
    expect(options[2]).toEqual({ source: 'C', totalBRL: 10, realBRL: 10, adjusted: 0, covered: 1, findable: 3, complete: false });
  });
  it('sem escolha, recomenda o mais barato completo', () => {
    const list = buildSingleStoreList(data);
    expect(list.recommended).toBe('B');
    expect(list.stores[0]!.source).toBe('B');
  });
  it('com escolha, mostra o mercado escolhido e mantém a recomendação', () => {
    const list = buildSingleStoreList(data, 'A');
    expect(list.stores[0]!.source).toBe('A');
    expect(list.totalBRL).toBe(28);
    expect(list.complete).toBe(true);
    expect(list.recommended).toBe('B');
  });
  it('mercado escolhido sem todos os itens: lista só o que ele tem e o que falta', () => {
    const list = buildSingleStoreList(data, 'C');
    expect(list.stores[0]!.items.map((i) => i.query)).toEqual(['Ovos 30un']);
    expect(list.missing).toEqual(['Leite 1L', 'Feijão 1kg']);
    expect(list.complete).toBe(false);
  });
  it('escolha desconhecida volta para o recomendado', () => {
    expect(buildSingleStoreList(data, 'Z').stores[0]!.source).toBe('B');
  });
  it('sem nenhum mercado, não há opções nem recomendação', () => {
    const list = buildSingleStoreList({ products: [] });
    expect(list.options).toEqual([]);
    expect(list.recommended).toBeNull();
  });

  it('opções comparam pelo preço equivalente e informam o preço real e quantos itens têm tamanho diferente', () => {
    const sized = {
      products: [
        prod('Arroz 5kg', [src('A', 'Arroz 1kg', 7, { equivalentBRL: 35, sizeAdjusted: true }), src('B', 'Arroz 5kg', 30)]),
      ],
    };
    const list = buildSingleStoreList(sized, 'A');
    expect(list.options.map((o) => o.source)).toEqual(['B', 'A']);
    expect(list.options[1]).toMatchObject({ source: 'A', totalBRL: 35, realBRL: 7, adjusted: 1 });
    expect(list.totalBRL).toBe(7);
    expect(list.equivalentBRL).toBe(35);
  });
});

