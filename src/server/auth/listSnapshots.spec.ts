import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { createAuthStore } from './users.js';
import type { PriceSource } from '../../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [] };
let now = Date.UTC(2026, 10, 24, 15);

function mk() {
  const store = createAuthStore({ path: ':memory:', now: () => now });
  const app = buildApp({ sources: [fake], auth: { store, publicUrl: 'https://x.test', google: { clientId: 'c', clientSecret: 's' }, now: () => now } });
  const login = (sub: string) => `cestimo_sid=${store.createSession(store.upsertUser({ sub, email: `${sub}@x.com`, name: sub }).id)}`;
  return { app, ana: login('ana'), bia: login('bia') };
}
const m = (title: string, price: number) => ({ title, priceBRL: price, equivalentBRL: price, sizeAdjusted: false, score: 0.9, uncertain: false });
const src = (source: string, title: string, price: number) => ({ source, status: 'ok', match: m(title, price) });
const result = (arroz: [number, number], leite: [number, number]) => ({
  products: [
    { query: 'Arroz 5kg', sources: [src('Comper', 'Arroz Tio João', arroz[0]), src('Royal', 'Arroz Camil', arroz[1])] },
    { query: 'Leite 1L', sources: [src('Comper', 'Leite Aurora', leite[0]), src('Royal', 'Leite Piracanjuba', leite[1])] },
  ],
});
const call = (app: ReturnType<typeof buildApp>, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } });
const save = (app: ReturnType<typeof buildApp>, cookie: string, extra: object = {}) =>
  call(app, 'POST', '/api/me/lists', cookie, { name: 'Mês', category: 'mercados', list: 'Arroz 5kg\nLeite 1L', ...extra });
const first = async (app: ReturnType<typeof buildApp>, cookie: string) => (await call(app, 'GET', '/api/me/lists', cookie)).json().lists[0];

describe('lista salva com o resultado', () => {
  it('guarda os preços retornados e devolve o resultado recalculado, com a data', async () => {
    const { app, ana } = mk();
    expect((await save(app, ana, { result: result([30, 32], [5, 4.5]) })).statusCode).toBe(204);
    const l = await first(app, ana);
    expect(l.result.at).toBe(now);
    expect(l.result.products.map((p: { query: string }) => p.query)).toEqual(['Arroz 5kg', 'Leite 1L']);
    expect(l.result.products[0].stats.cheapest).toMatchObject({ source: 'Comper', priceBRL: 30 });
    expect(l.result.products[1].stats.cheapest).toMatchObject({ source: 'Royal', priceBRL: 4.5 });
    expect(l.result.basket.totals).toBeDefined();
    expect(l.checked).toEqual([]);
    expect(l.prev).toBeNull();
  });
  it('sem resultado, salva só o texto (como antes)', async () => {
    const { app, ana } = mk();
    await save(app, ana);
    expect((await first(app, ana)).result).toBeNull();
  });
  it('recusa resultado que não corresponde à lista, ou malformado', async () => {
    const { app, ana } = mk();
    const wrong = { products: [{ query: 'Sal 1kg', sources: [src('Comper', 'Sal', 3)] }] };
    expect((await save(app, ana, { result: wrong })).statusCode).toBe(400);
    expect((await save(app, ana, { result: { products: 'x' } })).statusCode).toBe(400);
    expect((await save(app, ana, { result: { products: [{ query: 'Arroz 5kg', sources: [{ source: 'C', status: 'ok', match: { title: 't', priceBRL: -1 } }] }] } })).statusCode).toBe(400);
  });
  it('uma conta não lê o resultado da outra', async () => {
    const { app, ana, bia } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    expect((await call(app, 'GET', '/api/me/lists', bia)).json().lists).toEqual([]);
  });
});

describe('marcar como comprado (na conta)', () => {
  it('guarda os itens marcados e devolve na próxima leitura', async () => {
    const { app, ana } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    const { id } = await first(app, ana);
    expect((await call(app, 'PUT', `/api/me/lists/${id}/checked`, ana, { checked: ['Arroz 5kg'] })).statusCode).toBe(204);
    expect((await first(app, ana)).checked).toEqual(['arroz 5kg']);
    await call(app, 'PUT', `/api/me/lists/${id}/checked`, ana, { checked: [] });
    expect((await first(app, ana)).checked).toEqual([]);
  });
  it('ignora o que não é item da lista, repetidos, e recusa corpo inválido', async () => {
    const { app, ana } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    const { id } = await first(app, ana);
    await call(app, 'PUT', `/api/me/lists/${id}/checked`, ana, { checked: ['arroz 5kg', 'ARROZ 5kg', 'coisa de fora'] });
    expect((await first(app, ana)).checked).toEqual(['arroz 5kg']);
    expect((await call(app, 'PUT', `/api/me/lists/${id}/checked`, ana, { checked: 'x' })).statusCode).toBe(400);
  });
  it('só o dono marca; sem login, 401', async () => {
    const { app, ana, bia } = mk();
    await save(app, ana);
    const { id } = await first(app, ana);
    expect((await call(app, 'PUT', `/api/me/lists/${id}/checked`, bia, { checked: [] })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/me/lists/${id}/checked`, payload: { checked: [] } })).statusCode).toBe(401);
  });
});

describe('atualizar preços', () => {
  it('substitui o resultado, guarda os preços anteriores para mostrar a variação e mantém as marcações', async () => {
    const { app, ana } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    const { id } = await first(app, ana);
    await call(app, 'PUT', `/api/me/lists/${id}/checked`, ana, { checked: ['Leite 1L'] });
    const before = now;
    now += 2 * 24 * 60 * 60 * 1000;
    const res = await call(app, 'PUT', `/api/me/lists/${id}/prices`, ana, { result: result([28, 32], [5, 4.9]) });
    expect(res.statusCode).toBe(200);
    const l = await first(app, ana);
    expect(l.result.at).toBe(now);
    expect(l.result.products[0].stats.cheapest.priceBRL).toBe(28);
    expect(l.prev).toEqual({ at: before, prices: { 'arroz 5kg': 30, 'leite 1l': 4.5 } });
    expect(l.checked).toEqual(['leite 1l']);
    expect(res.json().list.id).toBe(id);
  });
  it('atualizar de novo troca os anteriores pelos da última foto', async () => {
    const { app, ana } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    const { id } = await first(app, ana);
    await call(app, 'PUT', `/api/me/lists/${id}/prices`, ana, { result: result([28, 32], [5, 4.9]) });
    await call(app, 'PUT', `/api/me/lists/${id}/prices`, ana, { result: result([29, 32], [5, 4.9]) });
    expect((await first(app, ana)).prev.prices['arroz 5kg']).toBe(28);
  });
  it('lista salva só com texto ganha o primeiro resultado (sem anteriores)', async () => {
    const { app, ana } = mk();
    await save(app, ana);
    const { id } = await first(app, ana);
    await call(app, 'PUT', `/api/me/lists/${id}/prices`, ana, { result: result([30, 32], [5, 4.5]) });
    const l = await first(app, ana);
    expect(l.result).not.toBeNull();
    expect(l.prev).toBeNull();
  });
  it('recusa resultado que não é desta lista; só o dono atualiza', async () => {
    const { app, ana, bia } = mk();
    await save(app, ana);
    const { id } = await first(app, ana);
    expect((await call(app, 'PUT', `/api/me/lists/${id}/prices`, ana, { result: { products: [{ query: 'Sal', sources: [src('C', 'Sal', 3)] }] } })).statusCode).toBe(400);
    expect((await call(app, 'PUT', `/api/me/lists/${id}/prices`, bia, { result: result([30, 32], [5, 4.5]) })).statusCode).toBe(404);
  });
  it('salvar de novo com o mesmo nome e um resultado novo também troca o resultado e guarda os anteriores', async () => {
    const { app, ana } = mk();
    await save(app, ana, { result: result([30, 32], [5, 4.5]) });
    now += 1000;
    await save(app, ana, { result: result([27, 32], [5, 4.5]) });
    const l = await first(app, ana);
    expect(l.result.products[0].stats.cheapest.priceBRL).toBe(27);
    expect(l.prev.prices['arroz 5kg']).toBe(30);
  });
});
