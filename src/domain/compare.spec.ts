import { describe, it, expect } from 'vitest';
import { compare, recompute, type SourceResult } from './compare.js';
import { BlockedError, type Offer, type PriceSource } from './types.js';

const src = (name: string, fn: (q: string) => Promise<Offer[]>): PriceSource => ({ name, search: fn });
const offer = (source: string, title: string, priceBRL: number): Offer => ({ source, title, priceBRL });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('compare', () => {
  it('fonte que lança vira erro e as outras seguem', async () => {
    const r = await compare(['Arroz 5kg'], [
      src('a', async () => { throw new Error('boom'); }),
      src('b', async () => [offer('b', 'Arroz Urbano 5kg', 20)]),
    ]);
    const [a, b] = r.products[0]!.sources;
    expect(a).toMatchObject({ source: 'a', status: 'erro' });
    expect(b).toMatchObject({ source: 'b', status: 'ok' });
    expect(r.products[0]!.stats?.cheapest.source).toBe('b');
  });

  it('BlockedError vira indisponivel', async () => {
    const r = await compare(['Arroz 5kg'], [src('ml', async () => { throw new BlockedError('captcha'); })]);
    expect(r.products[0]!.sources[0]!.status).toBe('indisponivel');
  });

  it('fonte lenta estoura o timeout e vira erro', async () => {
    const r = await compare(['Arroz 5kg'], [src('slow', async () => { await sleep(300); return []; })], { timeoutMs: 50 });
    expect(r.products[0]!.sources[0]!.status).toBe('erro');
  });

  it('oferta com preço 0 ou NaN é descartada (ok sem match)', async () => {
    const r = await compare(['Arroz 5kg'], [
      src('a', async () => [offer('a', 'Arroz Urbano 5kg', 0), offer('a', 'Arroz Urbano 5kg', Number.NaN)]),
    ]);
    expect(r.products[0]!.sources[0]).toMatchObject({ status: 'ok' });
    expect(r.products[0]!.sources[0]!.match).toBeUndefined();
    expect(r.products[0]!.stats).toBeNull();
  });

  it('roda fontes em paralelo', async () => {
    const t = Date.now();
    await compare(['Arroz 5kg'], [
      src('a', async () => { await sleep(80); return []; }),
      src('b', async () => { await sleep(80); return []; }),
    ]);
    expect(Date.now() - t).toBeLessThan(150);
  });

  it('calcula a cesta com cobertura por fonte', async () => {
    const r = await compare(['Arroz 5kg', 'Feijão 1kg'], [
      src('a', async (q) => (q.startsWith('Arroz') ? [offer('a', 'Arroz Urbano 5kg', 20)] : [offer('a', 'Feijão Preto 1kg', 8)])),
      src('b', async (q) => (q.startsWith('Arroz') ? [offer('b', 'Arroz Prato Fino 5kg', 22)] : [])),
    ]);
    expect(r.basket.total).toBe(2);
    expect(r.basket.coverage.get('a')).toBe(2);
    expect(r.basket.coverage.get('b')).toBe(1);
    expect(r.basket.cheapestSource).toBe('a');
  });

  it('erro traz o motivo (review I7)', async () => {
    const r = await compare(['Arroz 5kg'], [src('a', async () => { throw new Error('seletor quebrou'); })]);
    expect(r.products[0]!.sources[0]).toMatchObject({ status: 'erro', reason: 'seletor quebrou' });
  });

  it('match incerto aparece marcado e fica fora das estatísticas (review I5)', async () => {
    const r = await compare(['Arroz Tio João 5kg'], [src('a', async () => [offer('a', 'Arroz Tio Pedro 5kg', 10)])]);
    const s = r.products[0]!.sources[0]!;
    expect(s.match?.uncertain).toBe(true);
    expect(r.products[0]!.stats).toBeNull();
    expect(r.basket.coverage.size).toBe(0);
  });

  it('match confiável não é marcado como incerto', async () => {
    const r = await compare(['Arroz 5kg'], [src('a', async () => [offer('a', 'Arroz Urbano 5kg', 20)])]);
    expect(r.products[0]!.sources[0]!.match?.uncertain).toBe(false);
  });

  it('tamanho diferente: compara pelo preço equivalente ao tamanho pedido e informa R$/kg', async () => {
    const r = await compare(['Arroz Urbano 5kg'], [
      src('a', async () => [offer('a', 'Arroz Urbano 5kg', 30)]),
      src('b', async () => [offer('b', 'Arroz Urbano 1kg', 5)]),
    ]);
    const [a, b] = r.products[0]!.sources;
    expect(a!.match).toMatchObject({ sizeAdjusted: false, equivalentBRL: 30, unitPriceBRL: 6, unit: 'kg' });
    expect(b!.match).toMatchObject({ sizeAdjusted: true, equivalentBRL: 25, unitPriceBRL: 5, unit: 'kg' });
    expect(r.products[0]!.stats?.cheapest.source).toBe('b');
    expect(r.products[0]!.stats?.cheapest.priceBRL).toBe(25);
    expect(r.products[0]!.stats?.averageBRL).toBeCloseTo(27.5);
  });

  it('sem tamanho no título ou na consulta não há preço unitário', async () => {
    const r = await compare(['Feijão preto'], [src('a', async () => [offer('a', 'Feijão Preto Camil', 8)])]);
    const m = r.products[0]!.sources[0]!.match!;
    expect(m.equivalentBRL).toBe(8);
    expect(m.unitPriceBRL).toBeUndefined();
  });

  it('oferta de variante (orgânico) fica incerta e não distorce média nem mais barato', async () => {
    const r = await compare(['Feijão preto 2kg'], [
      src('a', async () => [offer('a', 'Feijão Preto Camil 2kg', 14)]),
      src('b', async () => [offer('b', 'Feijão Preto Orgânico Biorgânica 2kg', 58.5)]),
    ]);
    expect(r.products[0]!.sources[1]!.match?.uncertain).toBe(true);
    expect(r.products[0]!.stats?.cheapest.source).toBe('a');
    expect(r.products[0]!.stats?.averageBRL).toBe(14);
  });

  it('envia às fontes o termo simplificado, mas compara com a consulta original', async () => {
    const received: string[] = [];
    const r = await compare(['Bandeja de ovos 30un'], [
      src('a', async (q) => { received.push(q); return [offer('a', 'Ovos Brancos Avimor C/30', 15)]; }),
    ]);
    expect(received).toEqual(['ovos']);
    expect(r.products[0]!.query).toBe('Bandeja de ovos 30un');
    expect(r.products[0]!.sources[0]!.match?.priceBRL).toBe(15);
  });

  it('preço escalado de outro tamanho muito acima do padrão fica incerto e sai das estatísticas', async () => {
    const mk = (name: string, price: number, title = 'Arroz Urbano 5kg') => src(name, async () => [offer(name, title, price)]);
    const r = await compare(['Arroz Urbano 5kg'], [mk('a', 20), mk('b', 21), mk('c', 22), mk('d', 20, 'Arroz Urbano 1kg')]);
    const d = r.products[0]!.sources[3]!;
    expect(d.match).toMatchObject({ sizeAdjusted: true, equivalentBRL: 100, uncertain: true });
    expect(d.reason).toMatch(/fora do padrão/);
    expect(r.products[0]!.stats?.maxBRL).toBe(22);
    expect(r.products[0]!.stats?.averageBRL).toBeCloseTo(21);
  });

  it('com poucas fontes não marca outlier (sem base para comparar)', async () => {
    const mk = (name: string, price: number, title = 'Arroz Urbano 5kg') => src(name, async () => [offer(name, title, price)]);
    const r = await compare(['Arroz Urbano 5kg'], [mk('a', 20), mk('b', 20, 'Arroz Urbano 1kg')]);
    expect(r.products[0]!.sources[1]!.match?.uncertain).toBe(false);
  });

  it('preço escalado muito abaixo do padrão também é suspeito', async () => {
    const mk = (name: string, price: number, title = 'Arroz Urbano 5kg') => src(name, async () => [offer(name, title, price)]);
    const r = await compare(['Arroz Urbano 5kg'], [mk('a', 20), mk('b', 21), mk('c', 22), mk('d', 0.4, 'Arroz Urbano 1kg')]);
    expect(r.products[0]!.sources[3]!.match?.uncertain).toBe(true);
    expect(r.products[0]!.stats?.cheapest.source).toBe('a');
  });

  it('item de tamanho exato e título compatível é confiável mesmo com preço bem diferente (marcas)', async () => {
    const mk = (name: string, price: number) => src(name, async () => [offer(name, 'Arroz Urbano 5kg', price)]);
    const r = await compare(['Arroz Urbano 5kg'], [mk('a', 20), mk('b', 21), mk('c', 22), mk('d', 2), mk('e', 80)]);
    const [, , , d, e] = r.products[0]!.sources;
    expect(d!.match?.uncertain).toBe(false);
    expect(e!.match?.uncertain).toBe(false);
    expect(r.products[0]!.stats?.cheapest.source).toBe('d');
  });

  it('avisa o progresso a cada produto concluído', async () => {
    const calls: Array<[number, number]> = [];
    await compare(['Arroz Urbano 5kg', 'Feijão Preto 1kg', 'Leite Integral 1L'], [src('a', async () => [offer('a', 'Arroz Urbano 5kg', 20)])], {
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('onProgress que lança não derruba a comparação', async () => {
    const r = await compare(['Arroz Urbano 5kg'], [src('a', async () => [offer('a', 'Arroz Urbano 5kg', 20)])], {
      onProgress: () => { throw new Error('boom'); },
    });
    expect(r.products).toHaveLength(1);
  });

  describe('alternativas para a pessoa trocar o item escolhido', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => offer('a', `Arroz Urbano ${i === 0 ? '' : `Marca${i} `}5kg`.replace('  ', ' '), 20 + i));

    it('traz até 4 alternativas da mesma loja, sem repetir o item escolhido', async () => {
      const r = await compare(['Arroz Urbano 5kg'], [src('a', async () => many(7))]);
      const s = r.products[0]!.sources[0]!;
      expect(s.alternatives).toHaveLength(4);
      expect(s.alternatives!.map((m) => m.title)).not.toContain(s.match!.title);
    });

    it('cada alternativa traz preço equivalente, tamanho e se é incerta', async () => {
      const r = await compare(['Arroz Urbano 5kg'], [src('a', async () => [offer('a', 'Arroz Urbano 5kg', 20), offer('a', 'Arroz Urbano 1kg', 5)])]);
      const [alt] = r.products[0]!.sources[0]!.alternatives!;
      expect(alt).toMatchObject({ title: 'Arroz Urbano 1kg', priceBRL: 5, equivalentBRL: 25, sizeAdjusted: true, unit: 'kg' });
      expect(typeof alt!.uncertain).toBe('boolean');
    });

    it('mesmo sem item escolhido, oferece opções (para o caso "sem resultado")', async () => {
      const r = await compare(['Caviar 100g'], [src('a', async () => [offer('a', 'Caviar Preto Premium 50g', 80)])]);
      const s = r.products[0]!.sources[0]!;
      expect(s.match).toBeUndefined();
      expect(s.alternatives).toHaveLength(1);
      expect(s.alternatives![0]!.uncertain).toBe(true);
    });

    it('sem nada relacionado, não há alternativas', async () => {
      const r = await compare(['Arroz Urbano 5kg'], [src('a', async () => [offer('a', 'Shampoo Infantil 400ml', 9)])]);
      expect(r.products[0]!.sources[0]!.alternatives).toBeUndefined();
    });

    it('fonte com erro não traz alternativas', async () => {
      const r = await compare(['Arroz Urbano 5kg'], [src('a', async () => { throw new Error('x'); })]);
      expect(r.products[0]!.sources[0]!.alternatives).toBeUndefined();
    });
  });
});

describe('recompute: estatísticas e cesta a partir dos itens (depois da troca)', () => {
  const m = (priceBRL: number, extra: Partial<NonNullable<SourceResult['match']>> = {}): NonNullable<SourceResult['match']> => ({
    title: 'Item', priceBRL, equivalentBRL: priceBRL, sizeAdjusted: false, score: 1, uncertain: false, ...extra,
  });
  const row = (source: string, match?: ReturnType<typeof m>): SourceResult => ({ source, status: 'ok', ...(match ? { match } : {}) });

  it('calcula mais barato, média e diferença por produto', () => {
    const { stats } = recompute([{ sources: [row('a', m(10)), row('b', m(20))] }]);
    expect(stats[0]).toMatchObject({ averageBRL: 15, diffBRL: 10, cheapest: { source: 'a', priceBRL: 10 } });
  });

  it('item incerto fica de fora; item escolhido pela pessoa entra', () => {
    const { stats } = recompute([
      { sources: [row('a', m(10, { uncertain: true })), row('b', m(20))] },
      { sources: [row('a', m(10, { uncertain: false, chosenByUser: true })), row('b', m(20))] },
    ]);
    expect(stats[0]!.cheapest.source).toBe('b');
    expect(stats[1]!.cheapest.source).toBe('a');
  });

  it('usa o preço equivalente ao tamanho pedido', () => {
    const { stats } = recompute([{ sources: [row('a', m(7, { equivalentBRL: 35, sizeAdjusted: true })), row('b', m(30))] }]);
    expect(stats[0]!.cheapest.source).toBe('b');
  });

  it('produto sem nenhum item vira estatística nula', () => {
    expect(recompute([{ sources: [row('a'), row('b')] }]).stats[0]).toBeNull();
  });

  it('a cesta soma por mercado e informa a cobertura', () => {
    const { basket } = recompute([
      { sources: [row('a', m(10)), row('b', m(12))] },
      { sources: [row('a', m(5)), row('b')] },
    ]);
    expect(basket.totals.get('a')).toBe(15);
    expect(basket.coverage.get('b')).toBe(1);
    expect(basket.total).toBe(2);
    expect(basket.cheapestSource).toBe('a');
  });

  it('dá o mesmo resultado que o compare para os mesmos itens', async () => {
    const sources = [src('a', async () => [offer('a', 'Arroz Urbano 5kg', 20)]), src('b', async () => [offer('b', 'Arroz Urbano 5kg', 25)])];
    const r = await compare(['Arroz Urbano 5kg'], sources);
    const again = recompute(r.products);
    expect(again.stats[0]).toEqual(r.products[0]!.stats);
    expect([...again.basket.totals]).toEqual([...r.basket.totals]);
  });
});

