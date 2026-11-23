import { describe, it, expect } from 'vitest';
import { compare } from './compare.js';
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
});

