import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import type { PriceSource } from '../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [{ source: 'fake', title: 'Arroz Urbano 5kg', priceBRL: 21.79 }] };
const post = (app: ReturnType<typeof buildApp>, payload: unknown) => app.inject({ method: 'POST', url: '/api/compare', payload: payload as object });

describe('POST /api/compare', () => {
  it('lista válida retorna 200 com produtos e cesta', async () => {
    const res = await post(buildApp({ sources: [fake] }), { list: 'Arroz 5kg' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.products[0].query).toBe('Arroz 5kg');
    expect(body.products[0].stats.cheapest.source).toBe('fake');
    expect(body.basket.coverage).toEqual({ fake: 1 });
    expect(body.basket.total).toBe(1);
  });
  it('lista vazia retorna 400', async () => {
    expect((await post(buildApp({ sources: [fake] }), { list: '  \n ' })).statusCode).toBe(400);
  });
  it('corpo sem list retorna 400', async () => {
    expect((await post(buildApp({ sources: [fake] }), {})).statusCode).toBe(400);
  });
  it('mais de 20 itens retorna 400', async () => {
    const list = Array.from({ length: 21 }, (_, i) => `produto ${i}`).join('\n');
    expect((await post(buildApp({ sources: [fake] }), { list })).statusCode).toBe(400);
  });
  it('a cesta serializa os totais por fonte como objeto', async () => {
    const body = (await post(buildApp({ sources: [fake] }), { list: 'Arroz 5kg' })).json();
    expect(body.basket.totals).toEqual({ fake: 21.79 });
  });

  it('GET /api/config devolve a cidade e os nomes das fontes', async () => {
    const app = buildApp({ sources: [fake], city: 'Chapecó, SC', name: 'Cestimo' });
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Cestimo', city: 'Chapecó, SC', sources: ['fake'] });
  });
});

describe('produção: segurança, limites e métricas', () => {
  const basic = (pass: string) => ({ authorization: `Basic ${Buffer.from(`admin:${pass}`).toString('base64')}` });
  const post = (app: ReturnType<typeof buildApp>, list = 'Arroz 5kg') => app.inject({ method: 'POST', url: '/api/compare', payload: { list } });

  it('envia cabeçalhos de segurança', async () => {
    const res = await buildApp({ sources: [fake] }).inject({ method: 'GET', url: '/api/config' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('GET /healthz responde ok', async () => {
    const res = await buildApp({ sources: [fake] }).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('/metrics e /admin/stats não existem sem token configurado', async () => {
    const app = buildApp({ sources: [fake] });
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/admin/stats' })).statusCode).toBe(404);
  });

  it('com token, exige senha (401 com desafio Basic)', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'segredo' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect((await app.inject({ method: 'GET', url: '/metrics', headers: basic('errada') })).statusCode).toBe(401);
  });

  it('/metrics mostra buscas por mercado/status e requisições', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'segredo' });
    await post(app);
    const res = await app.inject({ method: 'GET', url: '/metrics', headers: basic('segredo') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('source_searches_total{result="found",source="fake"} 1');
    expect(res.body).toContain('compare_requests_total{outcome="ok"} 1');
    expect(res.body).toContain('source_search_duration_seconds_count{source="fake"} 1');
  });

  it('/admin/stats resume mercados, requisições e produtos mais buscados', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'segredo' });
    await post(app, 'Arroz 5kg\nOvos 30un');
    await post(app, 'arroz 5KG');
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic('segredo') })).json();
    expect(stats.requests).toMatchObject({ ok: 2 });
    expect(stats.sources[0]).toMatchObject({ source: 'fake', found: 2, empty: 1 });
    expect(stats.top[0]).toEqual({ term: 'arroz 5kg', count: 2 });
    expect(typeof stats.uptimeSeconds).toBe('number');
  });

  it('limita requisições por IP e responde 429 com Retry-After', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'x', rateLimit: { max: 2, windowMs: 60_000 } });
    expect((await post(app)).statusCode).toBe(200);
    expect((await post(app)).statusCode).toBe(200);
    const blocked = await post(app);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic('x') })).json();
    expect(stats.requests).toMatchObject({ ok: 2, rate_limited: 1 });
  });

  it('recusa com 503 quando há comparações demais ao mesmo tempo', async () => {
    const releases: Array<() => void> = [];
    const slow: PriceSource = { name: 'slow', search: () => new Promise((r) => { releases.push(() => r([])); }) };
    const app = buildApp({ sources: [slow], maxConcurrent: 1 });
    const first = post(app);
    await new Promise((r) => setTimeout(r, 30));
    const second = await post(app);
    expect(second.statusCode).toBe(503);
    expect(second.headers['retry-after']).toBeDefined();
    releases.splice(0).forEach((release) => release());
    expect((await first).statusCode).toBe(200);
    const third = post(app);
    await new Promise((r) => setTimeout(r, 30));
    releases.splice(0).forEach((release) => release());
    expect((await third).statusCode).toBe(200);
  });

  it('pedido inválido conta como bad_request', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    await post(app, '  ');
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic('x') })).json();
    expect(stats.requests).toMatchObject({ bad_request: 1 });
  });

  it('sem nome configurado, usa Cestimo', async () => {
    const res = await buildApp({ sources: [fake] }).inject({ method: 'GET', url: '/api/config' });
    expect(res.json().name).toBe('Cestimo');
  });
});

describe('números de uso (painel)', () => {
  const basic = { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` };
  const offer = (source: string, priceBRL: number) => ({ source, title: 'Arroz Urbano 5kg', priceBRL });
  const two: PriceSource[] = [
    { name: 'A', search: async () => [offer('A', 10)] },
    { name: 'B', search: async () => [offer('B', 20)] },
  ];
  const stats = async (app: ReturnType<typeof buildApp>) => (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
  const event = (app: ReturnType<typeof buildApp>, name: unknown) => app.inject({ method: 'POST', url: '/api/event', payload: { name } as object });

  it('POST /api/event conta cópias e impressões e responde 204', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    expect((await event(app, 'copy_store')).statusCode).toBe(204);
    await event(app, 'copy_item');
    await event(app, 'print_item');
    const s = await stats(app);
    expect(s.totals).toMatchObject({ copies: 2, prints: 1 });
    expect(s.events).toMatchObject({ copy_store: 1, copy_item: 1, print_item: 1 });
  });

  it('evento desconhecido ou sem nome é rejeitado (não vira métrica)', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    expect((await event(app, 'hack<script>')).statusCode).toBe(400);
    expect((await event(app, undefined)).statusCode).toBe(400);
    expect((await stats(app)).events).toEqual({});
  });

  it('totais: comparações, itens, itens encontrados e economia', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    await app.inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz Urbano 5kg\nCaviar 100g' } });
    const t = (await stats(app)).totals;
    expect(t.compares).toBe(1);
    expect(t.items).toBe(2);
    expect(t.itemsFound).toBe(1);
    expect(t.itemsMissing).toBe(1);
    expect(t.avgItemsPerList).toBe(2);
    expect(t.savingsBRL).toBe(5);
  });

  it('taxa de cópia = cópias / comparações', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    await app.inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz Urbano 5kg' } });
    await app.inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz Urbano 5kg' } });
    await event(app, 'copy_store');
    expect((await stats(app)).totals.copyRate).toBe(0.5);
  });

  it('conta visitas da página inicial (não das APIs)', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    app.get('/', () => 'ok');
    await app.inject({ method: 'GET', url: '/' });
    await app.inject({ method: 'GET', url: '/api/config' });
    expect((await stats(app)).totals.pageViews).toBe(1);
  });

  it('série por dia traz 14 dias com o movimento de hoje', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    await app.inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz Urbano 5kg' } });
    await event(app, 'copy_item');
    const days = (await stats(app)).days;
    expect(days).toHaveLength(14);
    expect(days[13].values).toMatchObject({ compare: 1, items: 1, copy: 1 });
  });

  it('sem comparações, as taxas são zero (sem divisão por zero)', async () => {
    const t = (await stats(buildApp({ sources: two, metricsToken: 'x' }))).totals;
    expect(t).toMatchObject({ compares: 0, copyRate: 0, avgItemsPerList: 0, avgSeconds: 0 });
  });

  it('o painel /admin exige senha e entrega HTML e script', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    expect((await app.inject({ method: 'GET', url: '/admin' })).statusCode).toBe(401);
    const page = await app.inject({ method: 'GET', url: '/admin', headers: basic });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const js = await app.inject({ method: 'GET', url: '/admin/admin.js', headers: basic });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
  });

  it('navegador em /admin/stats é levado ao painel visual; chamadas de API continuam recebendo JSON', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    const browser = await app.inject({ method: 'GET', url: '/admin/stats', headers: { ...basic, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    expect(browser.statusCode).toBe(302);
    expect(browser.headers.location).toBe('/admin');
    const api = await app.inject({ method: 'GET', url: '/admin/stats', headers: { ...basic, accept: '*/*' } });
    expect(api.statusCode).toBe(200);
    expect(api.headers['content-type']).toContain('application/json');
    const fetchJson = await app.inject({ method: 'GET', url: '/admin/stats', headers: { ...basic, accept: 'application/json' } });
    expect(fetchJson.statusCode).toBe(200);
  });

  it('/admin/ (com barra no final) também abre o painel', async () => {
    const app = buildApp({ sources: two, metricsToken: 'x' });
    const res = await app.inject({ method: 'GET', url: '/admin/', headers: basic });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

