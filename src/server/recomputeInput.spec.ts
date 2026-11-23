import { describe, it, expect } from 'vitest';
import { parseRecomputeBody } from './recomputeInput.js';

const match = (over: Record<string, unknown> = {}) => ({
  title: 'Item', priceBRL: 10, equivalentBRL: 10, sizeAdjusted: false, score: 1, uncertain: false, ...over,
});
const body = (sources: unknown[], extra: Record<string, unknown> = {}) => ({ products: [{ query: 'Arroz 5kg', sources, ...extra }] });
const ok = (status = 'ok', m?: unknown) => ({ source: 'A', status, ...(m ? { match: m } : {}) });

describe('parseRecomputeBody', () => {
  it('aceita itens válidos e devolve só o que o cálculo usa', () => {
    const r = parseRecomputeBody(body([ok('ok', { ...match(), lixo: 'x', url: 'http://a' })]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.products[0]!.sources[0]).toEqual({
        source: 'A', status: 'ok',
        match: { title: 'Item', priceBRL: 10, equivalentBRL: 10, sizeAdjusted: false, score: 1, uncertain: false },
      });
    }
  });
  it('mercado sem item escolhido é válido', () => {
    expect(parseRecomputeBody(body([ok('ok')])).ok).toBe(true);
  });
  it('preserva a marca de escolha da pessoa', () => {
    const r = parseRecomputeBody(body([ok('ok', match({ chosenByUser: true }))]));
    expect(r.ok && r.products[0]!.sources[0]!.match?.chosenByUser).toBe(true);
  });
  it.each([
    ['sem products', {}],
    ['products não é lista', { products: 'x' }],
    ['lista vazia', { products: [] }],
    ['corpo nulo', null],
    ['mais de 20 produtos', { products: Array.from({ length: 21 }, () => ({ query: 'a', sources: [ok()] })) }],
    ['mais de 12 mercados', body(Array.from({ length: 13 }, () => ok()))],
    ['produto sem mercados', body([])],
    ['mercado sem nome', body([{ status: 'ok' }])],
    ['status inválido', body([ok('hack')])],
    ['preço negativo', body([ok('ok', match({ equivalentBRL: -1 }))])],
    ['preço não numérico', body([ok('ok', match({ equivalentBRL: '10' }))])],
    ['preço infinito', body([ok('ok', match({ equivalentBRL: Number.POSITIVE_INFINITY }))])],
    ['incerto não booleano', body([ok('ok', match({ uncertain: 'não' }))])],
    ['título enorme', body([ok('ok', match({ title: 'x'.repeat(500) }))])],
  ])('rejeita: %s', (_nome, input) => {
    const r = parseRecomputeBody(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
  });
});

describe('parseRecomputeBody em modo exibição (link compartilhado)', () => {
  const full = (over: Record<string, unknown> = {}) => match({ unitPriceBRL: 4.5, unit: 'kg', url: 'https://loja.com/p/1', ...over });
  const parse = (m: unknown, query: unknown = 'Arroz 5kg') =>
    parseRecomputeBody({ products: [{ query, sources: [ok('ok', m)] }] }, { display: true });

  it('mantém consulta, link, preço por unidade e unidade', () => {
    const r = parse(full());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.products[0]!.query).toBe('Arroz 5kg');
      expect(r.products[0]!.sources[0]!.match).toMatchObject({ unitPriceBRL: 4.5, unit: 'kg', url: 'https://loja.com/p/1' });
    }
  });
  it('sem o modo, link e unidade continuam sendo descartados', () => {
    const r = parseRecomputeBody({ products: [{ query: 'a', sources: [ok('ok', full())] }] });
    expect(r.ok && r.products[0]!.sources[0]!.match).toEqual(match());
  });
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>1</script>'],
    ['//evil.com/x'],
    ['ftp://x.com/a'],
    ['https://' + 'a'.repeat(600)],
  ])('rejeita link %s', (url) => {
    expect(parse(full({ url })).ok).toBe(false);
  });
  it('rejeita unidade fora de kg/L/un e preço por unidade inválido', () => {
    expect(parse(full({ unit: 'tonelada' })).ok).toBe(false);
    expect(parse(full({ unitPriceBRL: -2 })).ok).toBe(false);
  });
  it('rejeita consulta ausente, vazia ou enorme', () => {
    expect(parse(full(), null).ok).toBe(false);
    expect(parse(full(), '  ').ok).toBe(false);
    expect(parse(full(), 'x'.repeat(200)).ok).toBe(false);
  });
});

