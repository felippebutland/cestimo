import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { createAbuseGuard } from './abuseGuard.js';
import type { PriceSource } from '../domain/types.js';

const calls: string[] = [];
const fake: PriceSource = { name: 'fake', search: async (q) => { calls.push(q); return [{ source: 'fake', title: 'Arroz Urbano 5kg', priceBRL: 21.79 }]; } };
const mk = () => { calls.length = 0; return buildApp({ sources: [fake], abuse: createAbuseGuard({ maxStrikes: 2, blockMs: 60_000 }) }); };
const post = (app: ReturnType<typeof buildApp>, list: string, ip = '1.1.1.1', headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/compare', payload: { list }, remoteAddress: ip, headers });

describe('busca que não é produto', () => {
  it('só texto inválido: 400, nenhuma loja é consultada', async () => {
    const app = mk();
    const res = await post(app, 'quicksort in c language');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/produto/i);
    expect(calls).toEqual([]);
  });
  it('lista mista: ignora a linha inválida e compara o resto', async () => {
    const app = mk();
    const res = await post(app, 'Arroz 5kg\nquicksort in c language');
    expect(res.statusCode).toBe(200);
    expect(res.json().products.map((p: { query: string }) => p.query)).toEqual(['Arroz 5kg']);
    expect(calls).toEqual(['Arroz 5kg']);
  });
  it('3ª tentativa inválida do mesmo IP bloqueia (403) e depois nada do IP passa, nem busca válida', async () => {
    const app = mk();
    expect((await post(app, 'quicksort in c language')).statusCode).toBe(400);
    expect((await post(app, 'how to cook rice')).statusCode).toBe(400);
    const third = await post(app, 'write a python function');
    expect(third.statusCode).toBe(403);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await post(app, 'Arroz 5kg')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/config', remoteAddress: '1.1.1.1' })).statusCode).toBe(403);
  });
  it('outro IP não é afetado', async () => {
    const app = mk();
    for (let i = 0; i < 3; i++) await post(app, 'quicksort in c language');
    expect((await post(app, 'Arroz 5kg', '2.2.2.2')).statusCode).toBe(200);
  });
  it('busca válida não gera advertência', async () => {
    const app = mk();
    for (let i = 0; i < 5; i++) expect((await post(app, 'Arroz 5kg')).statusCode).toBe(200);
  });
  it('quem tem o cookie de administrador (opt-out) não é advertido nem bloqueado', async () => {
    const app = mk();
    for (let i = 0; i < 5; i++) expect((await post(app, 'quicksort in c language', '1.1.1.1', { cookie: 'cestimo_ignorar=1' })).statusCode).toBe(400);
    expect((await post(app, 'Arroz 5kg', '1.1.1.1', { cookie: 'cestimo_ignorar=1' })).statusCode).toBe(200);
  });
  it('a página inicial continua abrindo para um IP bloqueado (só a API fecha)', async () => {
    const app = mk();
    for (let i = 0; i < 3; i++) await post(app, 'quicksort in c language');
    expect((await app.inject({ method: 'GET', url: '/healthz', remoteAddress: '1.1.1.1' })).statusCode).toBe(200);
  });
});
