import { describe, it, expect } from 'vitest';
import { retryOnTransient } from './retry.js';

const transient = (e: unknown) => /ocupado/.test((e as Error).message);
const noWait = async () => {};

describe('retryOnTransient', () => {
  it('sucesso na primeira tentativa: não repete nem espera', async () => {
    let calls = 0; const waits: number[] = [];
    const r = await retryOnTransient(async () => { calls++; return 'ok'; }, { isTransient: transient, sleep: async (ms) => { waits.push(ms); } });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });
  it('erro passageiro: espera e tenta de novo uma vez', async () => {
    let calls = 0; const waits: number[] = [];
    const r = await retryOnTransient(async () => { calls++; if (calls === 1) throw new Error('site ocupado'); return 'ok'; }, { isTransient: transient, delayMs: 2500, sleep: async (ms) => { waits.push(ms); } });
    expect(r).toBe('ok');
    expect(calls).toBe(2);
    expect(waits).toEqual([2500]);
  });
  it('erro que não é passageiro: falha na hora, sem repetir (bloqueio, página mudou…)', async () => {
    let calls = 0;
    await expect(retryOnTransient(async () => { calls++; throw new Error('captcha'); }, { isTransient: transient, sleep: noWait })).rejects.toThrow('captcha');
    expect(calls).toBe(1);
  });
  it('continua passageiro na segunda tentativa: devolve o erro (só uma repetição, não insiste)', async () => {
    let calls = 0;
    await expect(retryOnTransient(async () => { calls++; throw new Error('site ocupado'); }, { isTransient: transient, sleep: noWait })).rejects.toThrow('site ocupado');
    expect(calls).toBe(2);
  });
});
