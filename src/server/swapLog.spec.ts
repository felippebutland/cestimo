import { describe, it, expect } from 'vitest';
import { createSwapLog, parseSwapDetail } from './swapLog.js';

const valid = { source: 'Comper', query: 'Feijão preto 1kg', category: 'mercados', from: 'Feijão Preto Camil 1kg', to: 'Feijão Preto Kicaldo 1kg' };

describe('parseSwapDetail', () => {
  it('aceita o detalhe completo e devolve só os campos conhecidos', () => {
    expect(parseSwapDetail({ ...valid, extra: 'x' }, ['Comper'])).toEqual(valid);
  });
  it('"from" e "to" são opcionais (clique em "Não é esse?" só abre as opções)', () => {
    expect(parseSwapDetail({ source: 'Comper', query: 'arroz', category: 'mercados' }, ['Comper'])).toEqual({ source: 'Comper', query: 'arroz', category: 'mercados' });
  });
  it('recusa loja que não existe (evita lixo e nomes inventados)', () => {
    expect(parseSwapDetail({ ...valid, source: 'Inventada' }, ['Comper'])).toBeNull();
  });
  it('recusa categoria desconhecida, busca vazia e tipos errados', () => {
    expect(parseSwapDetail({ ...valid, category: 'carros' }, ['Comper'])).toBeNull();
    expect(parseSwapDetail({ ...valid, query: '   ' }, ['Comper'])).toBeNull();
    expect(parseSwapDetail({ ...valid, query: 42 }, ['Comper'])).toBeNull();
    expect(parseSwapDetail(null, ['Comper'])).toBeNull();
    expect(parseSwapDetail('x', ['Comper'])).toBeNull();
  });
  it('limpa espaços e caracteres de controle e corta textos longos em 120', () => {
    const out = parseSwapDetail({ ...valid, query: '  arroz\n\t5kg  ', from: 'a'.repeat(500) }, ['Comper']);
    expect(out?.query).toBe('arroz 5kg');
    expect(out?.from).toHaveLength(120);
  });
});

describe('createSwapLog', () => {
  const detail = { source: 'Comper', query: 'arroz', category: 'mercados' as const };
  it('guarda as mais recentes primeiro e respeita o limite', () => {
    let t = 0;
    const log = createSwapLog({ max: 2, now: () => ++t });
    log.add('open', { ...detail, query: 'a' });
    log.add('swap', { ...detail, query: 'b' });
    log.add('open', { ...detail, query: 'c' });
    expect(log.recent(10).map((e) => e.query)).toEqual(['c', 'b']);
  });
  it('resume cliques e trocas por loja, mesmo depois de a lista cortar entradas antigas', () => {
    const log = createSwapLog({ max: 1 });
    log.add('open', detail);
    log.add('open', { ...detail, source: 'Giassi' });
    log.add('swap', detail);
    expect(log.summary().bySource).toEqual([
      { source: 'Comper', opens: 1, swaps: 1 },
      { source: 'Giassi', opens: 1, swaps: 0 },
    ]);
    expect(log.summary()).toMatchObject({ opens: 2, swaps: 1 });
  });
  it('lista os produtos mais trocados (busca + o que apareceu + o que ficou)', () => {
    const log = createSwapLog();
    log.add('swap', { ...detail, from: 'A', to: 'B' });
    log.add('swap', { ...detail, from: 'A', to: 'B' });
    log.add('swap', { ...detail, query: 'leite', from: 'C', to: 'D' });
    log.add('open', { ...detail, query: 'leite' });
    expect(log.summary().topSwaps[0]).toEqual({ query: 'arroz', from: 'A', to: 'B', count: 2 });
    expect(log.summary().topSwaps).toHaveLength(2);
  });
  it('snapshot e restore preservam tudo e ignoram lixo', () => {
    const log = createSwapLog();
    log.add('swap', { ...detail, from: 'A', to: 'B' });
    const copy = createSwapLog();
    copy.restore(JSON.parse(JSON.stringify(log.snapshot())));
    expect(copy.recent(5)).toEqual(log.recent(5));
    expect(copy.summary()).toEqual(log.summary());
    const bad = createSwapLog();
    bad.restore({ nada: 1 });
    bad.restore('x');
    expect(bad.recent(5)).toEqual([]);
  });
});
