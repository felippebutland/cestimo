import { describe, it, expect } from 'vitest';
import { JobExpiredError, submitJob, waitForJob } from './jobs.js';

type Res = { ok: boolean; status: number; headers: { get: (k: string) => string | null }; json: () => Promise<unknown> };
const res = (status: number, body: unknown, headers: Record<string, string> = {}): Res => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});
const sequence = (...steps: Array<Res | Error>) => {
  const queue = [...steps];
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    const next = queue.shift();
    if (!next) throw new Error('sem mais respostas no teste');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn: fetchFn as never, calls };
};
const sleeps = () => {
  const waited: number[] = [];
  return { sleep: (async (ms: number) => { waited.push(ms); }) as never, waited };
};

describe('submitJob', () => {
  it('envia a lista e devolve id e total', async () => {
    let sent: { url: string; init: { method: string; body: string } } | undefined;
    const fetchFn = (async (url: string, init: { method: string; body: string }) => { sent = { url, init }; return res(202, { id: 'abc', total: 3 }); }) as never;
    expect(await submitJob('Ovos 30un', { fetchFn })).toEqual({ id: 'abc', total: 3 });
    expect(sent!.url).toBe('/api/jobs');
    expect(sent!.init.method).toBe('POST');
    expect(JSON.parse(sent!.init.body)).toEqual({ list: 'Ovos 30un' });
  });
  it('envia a categoria quando informada (farmácias)', async () => {
    let body = '';
    const fetchFn = (async (_url: string, init: { body: string }) => { body = init.body; return res(202, { id: 'abc', total: 1 }); }) as never;
    await submitJob('Dipirona 500mg', { fetchFn, category: 'farmacias' });
    expect(JSON.parse(body)).toEqual({ list: 'Dipirona 500mg', category: 'farmacias' });
  });
  it.each([
    [400, { error: 'Informe ao menos um produto.' }, /Informe ao menos/],
    [429, { error: 'Muitas consultas seguidas. Tente de novo em 30s.' }, /Muitas consultas/],
    [503, { error: 'Estamos com muitas consultas no momento.' }, /muitas consultas/],
  ])('repassa a mensagem do servidor (%i)', async (status, body, pattern) => {
    const { fetchFn } = sequence(res(status, body));
    await expect(submitJob('x', { fetchFn })).rejects.toThrow(pattern);
  });
  it('queda de conexão no envio vira mensagem clara', async () => {
    const { fetchFn } = sequence(new TypeError('Load failed'));
    await expect(submitJob('x', { fetchFn })).rejects.toThrow(/conexão/i);
  });
});

describe('waitForJob', () => {
  const running = (done: number, total = 3) => res(200, { status: 'running', done, total });

  it('acompanha até terminar e devolve o resultado', async () => {
    const { fetchFn, calls } = sequence(running(0), running(2), res(200, { status: 'done', done: 3, total: 3, result: { products: [1, 2, 3] } }));
    const { sleep, waited } = sleeps();
    const progress: Array<[number, number]> = [];
    const result = await waitForJob('abc', { fetchFn, sleep, pollMs: 1500, onProgress: (d, t) => progress.push([d, t]) });
    expect(result).toEqual({ products: [1, 2, 3] });
    expect(calls).toEqual(['/api/jobs/abc', '/api/jobs/abc', '/api/jobs/abc']);
    expect(progress).toEqual([[0, 3], [2, 3], [3, 3]]);
    expect(waited).toEqual([1500, 1500]);
  });

  it('queda de rede no meio: tenta de novo com espera crescente e continua do mesmo ponto', async () => {
    const { fetchFn } = sequence(running(1), new TypeError('Load failed'), new TypeError('Load failed'), running(2), res(200, { status: 'done', done: 3, total: 3, result: 'ok' }));
    const { sleep, waited } = sleeps();
    const reconnecting: number[] = [];
    const result = await waitForJob('abc', { fetchFn, sleep, pollMs: 1500, onReconnecting: (n) => reconnecting.push(n) });
    expect(result).toBe('ok');
    expect(reconnecting).toEqual([1, 2, 0]);
    expect(waited).toEqual([1500, 1000, 2000, 1500]);
  });

  it('a espera depois de quedas tem teto de 5 s', async () => {
    const errors = Array.from({ length: 7 }, () => new TypeError('Load failed'));
    const { fetchFn } = sequence(...errors, res(200, { status: 'done', done: 1, total: 1, result: 'ok' }));
    const { sleep, waited } = sleeps();
    await waitForJob('abc', { fetchFn, sleep });
    expect(Math.max(...waited)).toBe(5000);
  });

  it('desiste depois de muitas quedas seguidas, com mensagem clara', async () => {
    const { fetchFn } = sequence(...Array.from({ length: 4 }, () => new TypeError('Load failed')));
    const { sleep } = sleeps();
    await expect(waitForJob('abc', { fetchFn, sleep, maxNetworkFailures: 3 })).rejects.toThrow(/sem conexão/i);
  });

  it('consulta inexistente ou expirada: erro específico', async () => {
    const { fetchFn } = sequence(res(404, { error: 'Consulta não encontrada ou expirada.' }));
    await expect(waitForJob('abc', { fetchFn, sleep: sleeps().sleep })).rejects.toBeInstanceOf(JobExpiredError);
  });

  it('respeita o Retry-After quando o servidor pede calma (429)', async () => {
    const { fetchFn } = sequence(res(429, { error: 'calma' }, { 'retry-after': '3' }), res(200, { status: 'done', done: 1, total: 1, result: 'ok' }));
    const { sleep, waited } = sleeps();
    expect(await waitForJob('abc', { fetchFn, sleep })).toBe('ok');
    expect(waited).toEqual([3000]);
  });

  it('o servidor informa que a consulta falhou', async () => {
    const { fetchFn } = sequence(res(200, { status: 'error', done: 0, total: 1, error: 'Não foi possível consultar os mercados agora.' }));
    await expect(waitForJob('abc', { fetchFn, sleep: sleeps().sleep })).rejects.toThrow(/Não foi possível consultar/);
  });

  it('erro inesperado do servidor mostra o status', async () => {
    const { fetchFn } = sequence(res(500, null));
    await expect(waitForJob('abc', { fetchFn, sleep: sleeps().sleep })).rejects.toThrow(/500/);
  });
});
