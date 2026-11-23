import { describe, it, expect } from 'vitest';
import { createLimiter } from './limiter.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createLimiter', () => {
  it('limita a concorrência', async () => {
    const run = createLimiter(2);
    let active = 0, peak = 0;
    const task = async () => { active++; peak = Math.max(peak, active); await sleep(20); active--; };
    await Promise.all(Array.from({ length: 5 }, () => run(task)));
    expect(peak).toBe(2);
  });

  it('libera a vaga quando a tarefa lança (review I1)', async () => {
    const run = createLimiter(1);
    await expect(run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });

  it('o timeout só conta depois de conseguir a vaga (review C1)', async () => {
    const run = createLimiter(1);
    const slow = run(async () => { await sleep(120); return 'a'; });
    const queued = run(async () => { await sleep(20); return 'b'; }, 60);
    await expect(queued).resolves.toBe('b');
    await slow;
  });

  it('estoura o timeout da tarefa em execução e libera a vaga', async () => {
    const run = createLimiter(1);
    await expect(run(async () => { await sleep(200); }, 30)).rejects.toThrow(/timeout/);
    await expect(run(async () => 'depois')).resolves.toBe('depois');
  });
});
