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

  describe('quem acessa: dispositivo, sistema, navegador e robôs', () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const visit = (app: ReturnType<typeof buildApp>, ua: string) => app.inject({ method: 'GET', url: '/', headers: { 'user-agent': ua } });
    const home = () => {
      const app = buildApp({ sources: two, metricsToken: 'x' });
      app.get('/', () => 'ok');
      return app;
    };

    it('conta cada visita por dispositivo, sistema e navegador', async () => {
      const app = home();
      await visit(app, IPHONE); await visit(app, IPHONE); await visit(app, WIN_CHROME);
      const { clients, totals } = await stats(app);
      expect(totals.pageViews).toBe(3);
      expect(clients.device).toEqual([{ name: 'celular', count: 2 }, { name: 'computador', count: 1 }]);
      expect(clients.os).toEqual([{ name: 'iOS', count: 2 }, { name: 'Windows', count: 1 }]);
      expect(clients.browser).toEqual([{ name: 'Safari', count: 2 }, { name: 'Chrome', count: 1 }]);
      expect(clients.bots).toBe(0);
    });

    it('robôs não entram nas visitas: são contados à parte', async () => {
      const app = home();
      await visit(app, IPHONE);
      await visit(app, 'curl/8.4.0');
      await visit(app, 'Mozilla/5.0 (compatible; UptimeRobot/2.0)');
      const { clients, totals } = await stats(app);
      expect(totals.pageViews).toBe(1);
      expect(clients.bots).toBe(2);
      expect(clients.device).toEqual([{ name: 'celular', count: 1 }]);
    });

    it('/metrics expõe as contagens com tags, sem o User-Agent', async () => {
      const app = home();
      await visit(app, IPHONE);
      await visit(app, 'curl/8.4.0');
      const body = (await app.inject({ method: 'GET', url: '/metrics', headers: basic })).body;
      expect(body).toContain('visits_by_client_total{browser="Safari",device="celular",os="iOS"} 1');
      expect(body).toContain('bot_visits_total 1');
      expect(body).not.toContain('Mozilla');
      expect(body).not.toContain('iPhone OS');
    });

    it('sem visitas, as listas vêm vazias', async () => {
      const { clients } = await stats(home());
      expect(clients).toEqual({ device: [], os: [], browser: [], bots: 0 });
    });
  });

  describe('ignorar as próprias visitas (cookie de opt-out do administrador)', () => {
    const IGNORE = { cookie: 'cestimo_ignorar=1' };
    const mk = () => {
      const app = buildApp({ sources: two, metricsToken: 'x' });
      app.get('/', () => 'ok');
      return app;
    };

    it('abrir /admin autenticado marca o navegador como "ignorar" (cookie HttpOnly)', async () => {
      const res = await mk().inject({ method: 'GET', url: '/admin', headers: basic });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toContain('cestimo_ignorar=1');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).toMatch(/Max-Age=\d+/);
    });

    it('quem escolheu voltar a ser contado não é marcado de novo', async () => {
      const res = await mk().inject({ method: 'GET', url: '/admin', headers: { ...basic, cookie: 'cestimo_ignorar=0' } });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('/admin sem senha não define cookie nenhum', async () => {
      const res = await mk().inject({ method: 'GET', url: '/admin' });
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('cookie com Secure quando o acesso é por HTTPS atrás de proxy', async () => {
      const app = buildApp({ sources: two, metricsToken: 'x', trustProxy: true });
      const res = await app.inject({ method: 'GET', url: '/admin', headers: { ...basic, 'x-forwarded-proto': 'https' } });
      expect(String(res.headers['set-cookie'])).toContain('Secure');
    });

    const postEvent = (app: ReturnType<typeof buildApp>, name: string, headers: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/api/event', payload: { name } as object, headers });
    const compareList = (app: ReturnType<typeof buildApp>, headers: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz Urbano 5kg' } as object, headers });

    it('visita de quem é ignorado não conta', async () => {
      const app = mk();
      await app.inject({ method: 'GET', url: '/', headers: IGNORE });
      const s = await stats(app);
      expect(s.totals.pageViews).toBe(0);
      expect(s.clients.device).toEqual([]);
    });

    it('ações de quem é ignorado respondem 204, mas não contam', async () => {
      const app = mk();
      expect((await postEvent(app, 'copy_store', IGNORE)).statusCode).toBe(204);
      const s = await stats(app);
      expect(s.events).toEqual({});
      expect(s.totals.copies).toBe(0);
    });

    it('comparação de quem é ignorado funciona normalmente, mas fica fora do uso', async () => {
      const app = mk();
      const res = await compareList(app, IGNORE);
      expect(res.statusCode).toBe(200);
      expect(res.json().products).toHaveLength(1);
      const s = await stats(app);
      expect(s.totals).toMatchObject({ compares: 0, items: 0, itemsFound: 0, savingsBRL: 0 });
      expect(s.requests).toMatchObject({ ignored: 1 });
      expect(s.top).toEqual([]);
      expect(s.days[13].values).toEqual({});
    });

    it('cookie "0" (quem voltou a ser contado) conta normalmente', async () => {
      const app = mk();
      await compareList(app, { cookie: 'cestimo_ignorar=0' });
      expect((await stats(app)).totals.compares).toBe(1);
    });

    it('reconhece o cookie entre outros', async () => {
      const app = mk();
      await compareList(app, { cookie: 'a=b; cestimo_ignorar=1; c=d' });
      expect((await stats(app)).totals.compares).toBe(0);
    });

    it('POST /admin/ignore liga e desliga (exige senha)', async () => {
      const app = mk();
      expect((await app.inject({ method: 'POST', url: '/admin/ignore', payload: { on: true } as object })).statusCode).toBe(401);
      const off = await app.inject({ method: 'POST', url: '/admin/ignore', payload: { on: false } as object, headers: basic });
      expect(off.statusCode).toBe(204);
      expect(String(off.headers['set-cookie'])).toContain('cestimo_ignorar=0');
      const on = await app.inject({ method: 'POST', url: '/admin/ignore', payload: { on: true } as object, headers: basic });
      expect(String(on.headers['set-cookie'])).toContain('cestimo_ignorar=1');
      expect((await app.inject({ method: 'POST', url: '/admin/ignore', payload: { on: 'sim' } as object, headers: basic })).statusCode).toBe(400);
    });

    it('/admin/stats informa se este navegador está sendo ignorado', async () => {
      const app = mk();
      expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: { ...basic, cookie: 'cestimo_ignorar=1' } })).json().ignoredNow).toBe(true);
      expect((await stats(app)).ignoredNow).toBe(false);
    });
  });
});

describe('consulta em duas etapas (/api/jobs): resiste a queda de conexão', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const basic = { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` };
  const submit = (app: ReturnType<typeof buildApp>, list = 'Arroz 5kg', headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/jobs', payload: { list } as object, headers });
  const poll = (app: ReturnType<typeof buildApp>, id: string) => app.inject({ method: 'GET', url: `/api/jobs/${id}` });
  const untilDone = async (app: ReturnType<typeof buildApp>, id: string) => {
    for (let i = 0; i < 100; i++) {
      const body = (await poll(app, id)).json();
      if (body.status !== 'running') return body;
      await wait(10);
    }
    throw new Error('job não terminou');
  };

  it('POST responde na hora com 202 e o id; o resultado vem pelo acompanhamento', async () => {
    const app = buildApp({ sources: [fake] });
    const res = await submit(app, 'Arroz 5kg\nOvos 30un');
    expect(res.statusCode).toBe(202);
    const { id, total } = res.json();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(20);
    expect(total).toBe(2);
    const done = await untilDone(app, id);
    expect(done.status).toBe('done');
    expect(done).toMatchObject({ done: 2, total: 2 });
    expect(done.result.products).toHaveLength(2);
    expect(done.result.basket.coverage).toEqual({ fake: 1 });
  });

  it('o resultado fica disponível para ser buscado de novo (retomada após queda)', async () => {
    const app = buildApp({ sources: [fake] });
    const { id } = (await submit(app)).json();
    await untilDone(app, id);
    const again = (await poll(app, id)).json();
    expect(again.status).toBe('done');
    expect(again.result.products[0].query).toBe('Arroz 5kg');
  });

  it('mostra o progresso enquanto roda', async () => {
    const releases: Array<() => void> = [];
    const slow: PriceSource = { name: 'slow', search: (q) => new Promise((r) => { releases.push(() => r(q === 'a' ? [] : [])); }) };
    const app = buildApp({ sources: [slow] });
    const { id } = (await submit(app, 'a\nb')).json();
    await wait(30);
    const running = (await poll(app, id)).json();
    expect(running).toMatchObject({ status: 'running', done: 0, total: 2 });
    expect(running.result).toBeUndefined();
    releases.splice(0).forEach((release) => release());
    expect((await untilDone(app, id)).status).toBe('done');
  });

  it('valida a lista como o endpoint antigo', async () => {
    const app = buildApp({ sources: [fake] });
    expect((await submit(app, '  ')).statusCode).toBe(400);
    expect((await submit(app, Array.from({ length: 21 }, (_, i) => `p${i}`).join('\n'))).statusCode).toBe(400);
  });

  it('id desconhecido responde 404', async () => {
    expect((await poll(buildApp({ sources: [fake] }), 'nao-existe')).statusCode).toBe(404);
  });

  it('o resultado expira depois do prazo', async () => {
    const app = buildApp({ sources: [fake], jobTtlMs: 40 });
    const { id } = (await submit(app)).json();
    await untilDone(app, id);
    await wait(80);
    expect((await poll(app, id)).statusCode).toBe(404);
  });

  it('aplica o limite por IP no envio', async () => {
    const app = buildApp({ sources: [fake], rateLimit: { max: 1, windowMs: 60_000 } });
    expect((await submit(app)).statusCode).toBe(202);
    const blocked = await submit(app);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('recusa com 503 quando já há consultas demais rodando e libera a vaga ao terminar', async () => {
    const releases: Array<() => void> = [];
    const slow: PriceSource = { name: 'slow', search: () => new Promise((r) => { releases.push(() => r([])); }) };
    const app = buildApp({ sources: [slow], maxConcurrent: 1 });
    const first = (await submit(app)).json();
    await wait(20);
    const busy = await submit(app);
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBeDefined();
    releases.splice(0).forEach((release) => release());
    await untilDone(app, first.id);
    const third = await submit(app);
    expect(third.statusCode).toBe(202);
    await wait(20);
    releases.splice(0).forEach((release) => release());
    await untilDone(app, third.json().id);
  });

  it('conta nas métricas como as comparações normais', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    await untilDone(app, (await submit(app, 'Arroz 5kg\nOvos 30un')).json().id);
    const s = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(s.requests).toMatchObject({ ok: 1 });
    expect(s.totals).toMatchObject({ compares: 1, items: 2 });
    expect(s.top.map((t: { term: string }) => t.term).sort()).toEqual(['arroz 5kg', 'ovos 30un']);
  });

  it('quem está com o cookie de opt-out roda normalmente, mas fica fora do uso', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    const { id } = (await submit(app, 'Arroz 5kg', { cookie: 'cestimo_ignorar=1' })).json();
    expect((await untilDone(app, id)).status).toBe('done');
    const s = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(s.requests).toMatchObject({ ignored: 1 });
    expect(s.totals.compares).toBe(0);
    expect(s.top).toEqual([]);
  });

  it('o endpoint antigo /api/compare continua funcionando (compatibilidade)', async () => {
    const res = await buildApp({ sources: [fake] }).inject({ method: 'POST', url: '/api/compare', payload: { list: 'Arroz 5kg' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().products).toHaveLength(1);
  });
});

describe('POST /api/recompute (depois que a pessoa troca um item)', () => {
  const basic = { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` };
  const m = (priceBRL: number, extra: Record<string, unknown> = {}) => ({
    title: 'Item', priceBRL, equivalentBRL: priceBRL, sizeAdjusted: false, score: 1, uncertain: false, ...extra,
  });
  const row = (source: string, match?: ReturnType<typeof m>) => ({ source, status: 'ok', ...(match ? { match } : {}) });
  const post = (app: ReturnType<typeof buildApp>, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/recompute', payload: payload as object });

  it('recalcula o mais barato, a média e a cesta com os itens enviados', async () => {
    const app = buildApp({ sources: [fake] });
    const res = await post(app, { products: [{ query: 'a', sources: [row('A', m(10)), row('B', m(20))] }, { query: 'b', sources: [row('A', m(5)), row('B')] }] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats[0]).toMatchObject({ averageBRL: 15, cheapest: { source: 'A', priceBRL: 10 } });
    expect(body.basket.totals).toEqual({ A: 15, B: 20 });
    expect(body.basket.coverage).toEqual({ A: 2, B: 1 });
    expect(body.basket.total).toBe(2);
    expect(body.basket.cheapestSource).toBe('A');
  });

  it('item escolhido pela pessoa entra no cálculo mesmo sendo incerto', async () => {
    const res = await post(buildApp({ sources: [fake] }), {
      products: [{ query: 'a', sources: [row('A', m(10, { uncertain: false, chosenByUser: true })), row('B', m(20))] }],
    });
    expect(res.json().stats[0].cheapest.source).toBe('A');
  });

  it('dados inválidos respondem 400 com a explicação', async () => {
    const res = await post(buildApp({ sources: [fake] }), { products: [{ query: 'a', sources: [row('A', m(-5))] }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('não depende de senha e não consulta nenhum mercado', async () => {
    let calls = 0;
    const counting: PriceSource = { name: 'c', search: async () => { calls++; return []; } };
    const res = await post(buildApp({ sources: [counting] }), { products: [{ query: 'a', sources: [row('A', m(10))] }] });
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(0);
  });

  it('tem limite de uso por IP', async () => {
    const app = buildApp({ sources: [fake], recomputeRateLimit: { max: 2, windowMs: 60_000 } });
    const payload = { products: [{ query: 'a', sources: [row('A', m(10))] }] };
    expect((await post(app, payload)).statusCode).toBe(200);
    expect((await post(app, payload)).statusCode).toBe(200);
    expect((await post(app, payload)).statusCode).toBe(429);
  });

  it.each(['pwa_open', 'pwa_install', 'install_click'])('o evento anônimo "%s" do app instalado é aceito e contado', async (name) => {
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    expect((await app.inject({ method: 'POST', url: '/api/event', payload: { name } })).statusCode).toBe(204);
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` } })).json();
    expect(stats.events).toMatchObject({ [name]: 1 });
  });
  it('a troca vira um evento anônimo "swap_match" (contagem)', async () => {
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    expect((await app.inject({ method: 'POST', url: '/api/event', payload: { name: 'swap_match' } })).statusCode).toBe(204);
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(stats.events).toMatchObject({ swap_match: 1 });
  });
});

describe('links compartilhados (resultado congelado)', () => {
  const m = (priceBRL: number, extra: Record<string, unknown> = {}) => ({
    title: 'Item', priceBRL, equivalentBRL: priceBRL, sizeAdjusted: false, score: 1, uncertain: false, ...extra,
  });
  const row = (source: string, match?: ReturnType<typeof m>) => ({ source, status: 'ok', ...(match ? { match } : {}) });
  const body = (extra: Record<string, unknown> = {}) => ({
    products: [{ query: 'Arroz 5kg', sources: [row('A', m(10, { unitPriceBRL: 2, unit: 'kg' })), row('B', m(20))] }],
    ...extra,
  });
  const share = (app: ReturnType<typeof buildApp>, payload: unknown) => app.inject({ method: 'POST', url: '/api/share', payload: payload as object });

  it('cria o link e devolve o resultado com estatísticas recalculadas no servidor', async () => {
    const app = buildApp({ sources: [fake] });
    const created = await share(app, { ...body(), stats: [{ cheapest: { source: 'B', priceBRL: 1 } }] });
    expect(created.statusCode).toBe(201);
    const { id, expiresAt } = created.json();
    expect(id).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    const got = await app.inject({ method: 'GET', url: `/api/share/${id}` });
    expect(got.statusCode).toBe(200);
    const { result } = got.json();
    expect(result.products[0].stats.cheapest).toEqual({ source: 'A', priceBRL: 10 });
    expect(result.basket.totals).toEqual({ A: 10, B: 20 });
  });
  it('link desconhecido responde 404', async () => {
    expect((await buildApp({ sources: [fake] }).inject({ method: 'GET', url: '/api/share/naoexiste1234' })).statusCode).toBe(404);
  });
  it('link vencido responde 404', async () => {
    const app = buildApp({ sources: [fake], shareTtlMs: 1 });
    const { id } = (await share(app, body())).json();
    await new Promise((r) => setTimeout(r, 5));
    expect((await app.inject({ method: 'GET', url: `/api/share/${id}` })).statusCode).toBe(404);
  });
  it('dados inválidos respondem 400 e nada é guardado', async () => {
    const app = buildApp({ sources: [fake] });
    const evil = { products: [{ query: 'a', sources: [row('A', m(-5))] }] };
    expect((await share(app, evil)).statusCode).toBe(400);
    expect((await share(app, { products: [] })).statusCode).toBe(400);
  });
  it('corpo grande demais responde 413', async () => {
    const huge = { products: Array.from({ length: 20 }, () => ({ query: 'a', sources: [row('A', m(1, { title: 'x'.repeat(250) }))], pad: 'y'.repeat(20000) })) };
    expect((await share(buildApp({ sources: [fake] }), huge)).statusCode).toBe(413);
  });
  it('tem limite de criação por IP', async () => {
    const app = buildApp({ sources: [fake], shareRateLimit: { max: 2, windowMs: 60_000 } });
    expect((await share(app, body())).statusCode).toBe(201);
    expect((await share(app, body())).statusCode).toBe(201);
    expect((await share(app, body())).statusCode).toBe(429);
  });
  it('criação e abertura viram eventos anônimos no painel', async () => {
    const basic = { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` };
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    const { id } = (await share(app, body())).json();
    await app.inject({ method: 'GET', url: `/api/share/${id}` });
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(stats.events).toMatchObject({ share_create: 1, share_open: 1 });
  });
  it('quem tem o cookie de opt-out não entra na contagem', async () => {
    const basic = { authorization: `Basic ${Buffer.from('admin:x').toString('base64')}` };
    const app = buildApp({ sources: [fake], metricsToken: 'x' });
    await app.inject({ method: 'POST', url: '/api/share', payload: body(), headers: { cookie: 'cestimo_ignorar=1' } });
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(stats.events.share_create ?? 0).toBe(0);
  });
});

describe('histórico de preços', () => {
  const compare = (app: ReturnType<typeof buildApp>, list: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/compare', payload: { list }, headers });
  const history = (app: ReturnType<typeof buildApp>, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/history', payload: payload as object });

  it('cada comparação grava o menor preço do dia e a série volta pela API', async () => {
    const app = buildApp({ sources: [fake] });
    await compare(app, 'Arroz 5kg\nFeijão 1kg');
    const res = await history(app, { queries: ['arroz 5KG', 'Sal'] });
    expect(res.statusCode).toBe(200);
    const { series } = res.json();
    expect(series[0].query).toBe('arroz 5KG');
    expect(series[0].points).toHaveLength(1);
    expect(series[0].points[0]).toMatchObject({ cheapestBRL: 21.79, cheapestSource: 'fake', sources: 1 });
    expect(series[1].points).toEqual([]);
  });
  it('itens incertos não entram no histórico', async () => {
    const odd: PriceSource = { name: 'odd', search: async () => [{ source: 'odd', title: 'Arroz Parboilizado Orgânico Integral 5kg', priceBRL: 99 }] };
    const app = buildApp({ sources: [odd] });
    await compare(app, 'Arroz 5kg');
    expect((await history(app, { queries: ['Arroz 5kg'] })).json().series[0].points).toEqual([]);
  });
  it('quem tem o cookie de opt-out não grava histórico', async () => {
    const app = buildApp({ sources: [fake] });
    await compare(app, 'Arroz 5kg', { cookie: 'cestimo_ignorar=1' });
    expect((await history(app, { queries: ['Arroz 5kg'] })).json().series[0].points).toEqual([]);
  });
  it.each([
    ['sem lista', {}],
    ['lista vazia', { queries: [] }],
    ['mais de 20', { queries: Array.from({ length: 21 }, (_, i) => `p${i}`) }],
    ['item que não é texto', { queries: [5] }],
    ['texto enorme', { queries: ['x'.repeat(200)] }],
    ['dias inválidos', { queries: ['a'], days: 'muitos' }],
  ])('rejeita: %s', async (_n, payload) => {
    expect((await history(buildApp({ sources: [fake] }), payload)).statusCode).toBe(400);
  });
  it('limita os dias pedidos a 90', async () => {
    expect((await history(buildApp({ sources: [fake] }), { queries: ['a'], days: 500 })).statusCode).toBe(200);
  });
  it('tem limite de uso por IP', async () => {
    const app = buildApp({ sources: [fake], historyRateLimit: { max: 1, windowMs: 60_000 } });
    expect((await history(app, { queries: ['a'] })).statusCode).toBe(200);
    expect((await history(app, { queries: ['a'] })).statusCode).toBe(429);
  });
});

