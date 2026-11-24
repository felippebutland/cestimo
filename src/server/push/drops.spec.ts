import { describe, it, expect } from 'vitest';
import { evaluateDrop, dropMessage } from './drops.js';

describe('evaluateDrop (queda de 5% ou mais)', () => {
  it('primeira vez que vê o produto: só guarda a referência, sem avisar', () => {
    expect(evaluateDrop(undefined, 10)).toEqual({ action: 'seed', ref: 10 });
  });
  it('caiu 5% ou mais: avisa e a nova referência é o preço atual', () => {
    expect(evaluateDrop(10, 9.5)).toEqual({ action: 'notify', ref: 9.5, pct: 5 });
    expect(evaluateDrop(10, 8)).toEqual({ action: 'notify', ref: 8, pct: 20 });
  });
  it('caiu menos de 5%: não avisa e mantém a referência (quedas pequenas somam até chegar em 5%)', () => {
    expect(evaluateDrop(10, 9.6)).toEqual({ action: 'keep', ref: 10 });
    expect(evaluateDrop(10, 9.6).action).toBe('keep');
    expect(evaluateDrop(10, 9.4).action).toBe('notify');
  });
  it('subiu: a referência acompanha (queda só conta a partir do preço mais alto recente)', () => {
    expect(evaluateDrop(10, 12)).toEqual({ action: 'follow', ref: 12 });
  });
  it('preço igual: nada muda', () => {
    expect(evaluateDrop(10, 10)).toEqual({ action: 'keep', ref: 10 });
  });
  it('referência ou preço inválido (zero, NaN): ignora sem avisar', () => {
    expect(evaluateDrop(0, 5)).toEqual({ action: 'seed', ref: 5 });
    expect(evaluateDrop(10, Number.NaN).action).toBe('keep');
  });
});

describe('dropMessage', () => {
  it('diz o produto, o percentual, o mercado e o preço', () => {
    const m = dropMessage({ query: 'leite integral 1l', source: 'Comper', priceBRL: 4.59, previousBRL: 4.99, pct: 8 });
    expect(m.title).toBe('Baixou 8%: leite integral 1l');
    expect(m.body).toBe('R$ 4,59 no Comper (antes R$ 4,99)');
  });
});
