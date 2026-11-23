import { describe, it, expect } from 'vitest';
import { basicAuthOk, createGate, createRateLimiter } from './limits.js';

describe('createRateLimiter', () => {
  it('permite até o máximo na janela e bloqueia o resto', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(rl.check('ip').allowed).toBe(true);
    expect(rl.check('ip').allowed).toBe(true);
    const third = rl.check('ip');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(1000);
  });
  it('libera de novo depois da janela', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
    rl.check('ip');
    t = 1001;
    expect(rl.check('ip').allowed).toBe(true);
  });
  it('chaves diferentes não se afetam', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    rl.check('a');
    expect(rl.check('b').allowed).toBe(true);
  });
  it('informa quanto falta para liberar', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
    rl.check('ip');
    t = 400;
    expect(rl.check('ip').retryAfterMs).toBe(600);
  });
  it('descarta chaves antigas (não vaza memória)', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
    rl.check('a'); rl.check('b');
    t = 5000;
    rl.check('c');
    expect(rl.size()).toBe(1);
  });
});

describe('createGate', () => {
  it('limita execuções simultâneas e libera ao sair', () => {
    const gate = createGate(1);
    const leave = gate.tryEnter();
    expect(leave).not.toBeNull();
    expect(gate.tryEnter()).toBeNull();
    leave!();
    expect(gate.tryEnter()).not.toBeNull();
  });
  it('sair duas vezes não abre vaga extra', () => {
    const gate = createGate(1);
    const leave = gate.tryEnter()!;
    leave(); leave();
    expect(gate.tryEnter()).not.toBeNull();
    expect(gate.tryEnter()).toBeNull();
  });
  it('informa quantos estão ativos', () => {
    const gate = createGate(3);
    gate.tryEnter(); gate.tryEnter();
    expect(gate.active()).toBe(2);
  });
});

describe('basicAuthOk', () => {
  const header = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  it('aceita qualquer usuário com a senha certa', () => {
    expect(basicAuthOk(header('admin', 'segredo'), 'segredo')).toBe(true);
    expect(basicAuthOk(header('', 'segredo'), 'segredo')).toBe(true);
  });
  it('rejeita senha errada, cabeçalho ausente ou mal formado', () => {
    expect(basicAuthOk(header('a', 'errada'), 'segredo')).toBe(false);
    expect(basicAuthOk(undefined, 'segredo')).toBe(false);
    expect(basicAuthOk('Bearer x', 'segredo')).toBe(false);
    expect(basicAuthOk('Basic !!!', 'segredo')).toBe(false);
  });
  it('sem senha configurada, nunca autoriza', () => {
    expect(basicAuthOk(header('a', ''), '')).toBe(false);
    expect(basicAuthOk(header('a', 'x'), undefined)).toBe(false);
  });
  it('senha com dois-pontos funciona', () => {
    expect(basicAuthOk(header('u', 'a:b'), 'a:b')).toBe(true);
  });
});
