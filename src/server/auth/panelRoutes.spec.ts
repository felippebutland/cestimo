import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { createAuthStore } from './users.js';
import { createHistoryStore } from '../history.js';
import type { PriceSource } from '../../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [] };
const NOW = Date.UTC(2026, 10, 24, 15);

function mk() {
  const store = createAuthStore({ path: ':memory:', now: () => NOW });
  const history = createHistoryStore({ path: ':memory:', now: () => NOW });
  const app = buildApp({ sources: [fake], history, auth: { store, publicUrl: 'https://x.test', google: { clientId: 'c', clientSecret: 's' }, now: () => NOW } });
  const login = (sub: string) => `cestimo_sid=${store.createSession(store.upsertUser({ sub, email: `${sub}@x.com`, name: sub }).id)}`;
  return { app, store, history, ana: login('ana'), bia: login('bia') };
}
const call = (app: ReturnType<typeof buildApp>, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

describe('painel: acesso', () => {
  it('sem login, tudo do painel responde 401', async () => {
    const { app } = mk();
    for (const [m, u] of [['GET', '/api/me/lists'], ['POST', '/api/me/lists'], ['GET', '/api/me/tracked'], ['POST', '/api/me/tracked'], ['DELETE', '/api/me']] as const) {
      expect((await call(app, m, u)).statusCode).toBe(401);
    }
  });
  it('sem login configurado no servidor, as rotas do painel não existem (404)', async () => {
    const app = buildApp({ sources: [fake] });
    expect((await call(app, 'GET', '/api/me/lists')).statusCode).toBe(404);
  });
});

describe('painel: listas', () => {
  it('salva, lista, renomeia e apaga', async () => {
    const { app, ana } = mk();
    expect((await call(app, 'POST', '/api/me/lists', ana, { name: 'Mês', category: 'mercados', list: 'Arroz 5kg\nLeite 1L' })).statusCode).toBe(204);
    const lists = (await call(app, 'GET', '/api/me/lists', ana)).json().lists;
    expect(lists).toMatchObject([{ name: 'Mês', category: 'mercados', list: 'Arroz 5kg\nLeite 1L' }]);
    expect((await call(app, 'PATCH', `/api/me/lists/${lists[0].id}`, ana, { name: 'Semana' })).statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/me/lists', ana)).json().lists[0].name).toBe('Semana');
    expect((await call(app, 'DELETE', `/api/me/lists/${lists[0].id}`, ana)).statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/me/lists', ana)).json().lists).toEqual([]);
  });
  it('uma conta não vê nem apaga a lista da outra', async () => {
    const { app, ana, bia } = mk();
    await call(app, 'POST', '/api/me/lists', ana, { name: 'Mês', category: 'mercados', list: 'Arroz 5kg' });
    const id = (await call(app, 'GET', '/api/me/lists', ana)).json().lists[0].id;
    expect((await call(app, 'GET', '/api/me/lists', bia)).json().lists).toEqual([]);
    expect((await call(app, 'DELETE', `/api/me/lists/${id}`, bia)).statusCode).toBe(404);
  });
  it('recusa nome vazio ou longo, categoria inválida, lista vazia e texto que não é produto', async () => {
    const { app, ana } = mk();
    for (const body of [
      { name: '', category: 'mercados', list: 'Arroz' }, { name: 'x'.repeat(41), category: 'mercados', list: 'Arroz' },
      { name: 'A', category: 'outra', list: 'Arroz' }, { name: 'A', category: 'mercados', list: '  ' },
      { name: 'A', category: 'mercados', list: 'quicksort in c language' }, { name: 'A', category: 'mercados' },
    ]) expect((await call(app, 'POST', '/api/me/lists', ana, body)).statusCode).toBe(400);
  });
  it('limite de listas: 409', async () => {
    const { app, ana } = mk();
    for (let i = 0; i < 10; i++) await call(app, 'POST', '/api/me/lists', ana, { name: `L${i}`, category: 'mercados', list: 'Arroz' });
    expect((await call(app, 'POST', '/api/me/lists', ana, { name: 'extra', category: 'mercados', list: 'Arroz' })).statusCode).toBe(409);
  });
});

describe('painel: acompanhados', () => {
  it('acompanha um produto e mostra o preço mais recente do histórico, com a queda', async () => {
    const { app, ana, history } = mk();
    history.record('2026-11-23', 'Leite 1L', [{ source: 'Comper', priceBRL: 5 }]);
    history.record('2026-11-24', 'Leite 1L', [{ source: 'Royal', priceBRL: 4.5 }]);
    expect((await call(app, 'POST', '/api/me/tracked', ana, { query: 'Leite 1L', category: 'mercados' })).statusCode).toBe(204);
    const [item] = (await call(app, 'GET', '/api/me/tracked', ana)).json().items;
    expect(item).toMatchObject({ query: 'Leite 1L', category: 'mercados', summary: { latestBRL: 4.5, latestSource: 'Royal', dropped: true } });
  });
  it('farmácias usam o histórico separado de farmácias', async () => {
    const { app, ana, history } = mk();
    history.record('2026-11-24', 'farmacias: Dipirona 500mg', [{ source: 'São João', priceBRL: 8 }]);
    await call(app, 'POST', '/api/me/tracked', ana, { query: 'Dipirona 500mg', category: 'farmacias' });
    expect((await call(app, 'GET', '/api/me/tracked', ana)).json().items[0].summary.latestBRL).toBe(8);
  });
  it('sem histórico ainda, o produto aparece sem preço', async () => {
    const { app, ana } = mk();
    await call(app, 'POST', '/api/me/tracked', ana, { query: 'Sal 1kg', category: 'mercados' });
    expect((await call(app, 'GET', '/api/me/tracked', ana)).json().items[0].summary.latestBRL).toBeNull();
  });
  it('remove só o próprio; recusa texto que não é produto; limite 409', async () => {
    const { app, ana, bia } = mk();
    await call(app, 'POST', '/api/me/tracked', ana, { query: 'Sal 1kg', category: 'mercados' });
    const id = (await call(app, 'GET', '/api/me/tracked', ana)).json().items[0].id;
    expect((await call(app, 'DELETE', `/api/me/tracked/${id}`, bia)).statusCode).toBe(404);
    expect((await call(app, 'DELETE', `/api/me/tracked/${id}`, ana)).statusCode).toBe(204);
    expect((await call(app, 'POST', '/api/me/tracked', ana, { query: 'how to cook rice', category: 'mercados' })).statusCode).toBe(400);
    for (let i = 0; i < 20; i++) await call(app, 'POST', '/api/me/tracked', ana, { query: `produto ${i}`, category: 'mercados' });
    expect((await call(app, 'POST', '/api/me/tracked', ana, { query: 'a mais', category: 'mercados' })).statusCode).toBe(409);
  });
});

describe('painel: primeiro preço ao acompanhar', () => {
  it('sem histórico, mostra o preço que a pessoa viu ao acompanhar', async () => {
    const { app, ana } = mk();
    expect((await call(app, 'POST', '/api/me/tracked', ana, { query: 'Café 500g', category: 'mercados', priceBRL: 18.9, source: 'Royal' })).statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/me/tracked', ana)).json().items[0].summary).toMatchObject({ latestBRL: 18.9, latestSource: 'Royal' });
  });
  it('preço ou loja inválidos são ignorados (o produto é acompanhado do mesmo jeito)', async () => {
    const { app, ana } = mk();
    for (const body of [{ priceBRL: -1, source: 'x' }, { priceBRL: 'abc', source: 'x' }, { priceBRL: 5, source: 'y'.repeat(61) }, { priceBRL: 1e9, source: 'x' }]) {
      expect((await call(app, 'POST', '/api/me/tracked', ana, { query: `Café ${Math.random()}`, category: 'mercados', ...body })).statusCode).toBe(204);
    }
    expect((await call(app, 'GET', '/api/me/tracked', ana)).json().items.every((i: { summary: { latestBRL: number | null } }) => i.summary.latestBRL === null)).toBe(true);
  });
  it('produto novo dispara a busca na hora; repetir não dispara de novo', async () => {
    const asked: Array<[string, string]> = [];
    const store = createAuthStore({ path: ':memory:', now: () => NOW });
    const app = buildApp({ sources: [fake], auth: { store, publicUrl: 'https://x.test', google: { clientId: 'c', clientSecret: 's' }, now: () => NOW, onTrack: (q, c) => { asked.push([q, c]); } } });
    const cookie = `cestimo_sid=${store.createSession(store.upsertUser({ sub: 'z', email: 'z@x.com', name: 'z' }).id)}`;
    await call(app, 'POST', '/api/me/tracked', cookie, { query: 'Sal 1kg', category: 'mercados' });
    await call(app, 'POST', '/api/me/tracked', cookie, { query: 'sal 1kg', category: 'mercados' });
    expect(asked).toEqual([['Sal 1kg', 'mercados']]);
  });
});

describe('painel: excluir conta', () => {
  it('apaga tudo, tira o cookie e a sessão deixa de valer', async () => {
    const { app, ana } = mk();
    await call(app, 'POST', '/api/me/lists', ana, { name: 'A', category: 'mercados', list: 'Arroz' });
    const res = await call(app, 'DELETE', '/api/me', ana);
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await call(app, 'GET', '/api/me', ana)).json()).toEqual({ user: null });
  });
});
