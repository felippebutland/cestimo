import { describe, it, expect } from 'vitest';
import type { PriceSource } from '../domain/types.js';
import { runProbe } from './probe.js';

const src = (name: string, fn: () => Promise<Array<{ source: string; title: string; priceBRL: number }>>): PriceSource => ({ name, search: fn });
const offer = (s: string) => ({ source: s, title: 'Leite', priceBRL: 5 });

describe('runProbe', () => {
  it('registra ok para a loja que devolve produtos e falha para vazia ou com erro', async () => {
    const seen: Array<[string, string]> = [];
    await runProbe(
      [src('A', async () => [offer('A')]), src('B', async () => []), src('C', async () => { throw new Error('bloqueada'); })],
      'leite 1L',
      (source, result) => seen.push([source, result]),
    );
    expect(seen).toEqual([['A', 'ok'], ['B', 'falha'], ['C', 'falha']]);
  });
  it('busca uma loja de cada vez (não sobrecarrega o navegador)', async () => {
    let running = 0; let peak = 0;
    const slow = (n: string) => src(n, async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return [offer(n)]; });
    await runProbe([slow('A'), slow('B'), slow('C')], 'leite', () => {});
    expect(peak).toBe(1);
  });
  it('uma loja que trava não impede as demais (tempo limite)', async () => {
    const seen: Array<[string, string]> = [];
    await runProbe([src('trava', () => new Promise(() => {})), src('B', async () => [offer('B')])], 'leite', (s, r) => seen.push([s, r]), 20);
    expect(seen).toEqual([['trava', 'falha'], ['B', 'ok']]);
  });
});
