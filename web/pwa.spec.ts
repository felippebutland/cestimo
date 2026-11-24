import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

describe('manifest', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  it('tem o que o navegador exige para instalar', () => {
    expect(m).toMatchObject({ name: 'Cestimo', short_name: 'Cestimo', start_url: '/', scope: '/', display: 'standalone' });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('aponta para ícones 192 e 512 que existem', () => {
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of m.icons as Array<{ src: string }>) expect(existsSync(new URL(`.${i.src}`, import.meta.url))).toBe(true);
  });
});

describe('index.html', () => {
  const html = read('index.html');
  it('liga o manifest e registra o service worker', () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
    expect(read('app.js')).toContain("serviceWorker.register('/sw.js')");
  });
});

/** Carrega o sw.js num ambiente falso e devolve os ganchos registrados. */
function loadSw(opts: { network: (url: string) => Promise<{ ok: boolean; clone: () => unknown }>; cached?: Record<string, unknown> }) {
  const handlers: Record<string, (e: any) => void> = {};
  const stored = new Map<string, unknown>(Object.entries(opts.cached ?? {}));
  const caches = {
    open: async () => ({ addAll: async () => {}, put: async (req: { url: string }, res: unknown) => { stored.set(new URL(req.url).pathname, res); } }),
    match: async (req: string | { url: string }) => stored.get(typeof req === 'string' ? req : new URL(req.url).pathname),
    keys: async () => ['cestimo-shell-v0', 'outro'],
    delete: async () => true,
  };
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://cestimo.test' },
    addEventListener: (n: string, h: (e: any) => void) => { handlers[n] = h; },
    skipWaiting: async () => {},
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
  };
  runInNewContext(read('sw.js'), { self, caches, fetch: (r: { url: string }) => opts.network(r.url), URL, Promise });
  const respond = async (url: string, extra: Record<string, unknown> = {}) => {
    let out: Promise<unknown> | undefined;
    handlers.fetch!({ request: { url, method: 'GET', mode: 'cors', ...extra }, respondWith: (p: Promise<unknown>) => { out = p; } });
    return out;
  };
  const run = async (name: string, event: Record<string, unknown>) => {
    let waiting: Promise<unknown> | undefined;
    handlers[name]!({ ...event, waitUntil: (p: Promise<unknown>) => { waiting = p; } });
    await waiting;
  };
  return { respond, stored, shown, opened, run };
}
const okRes = (tag: string) => ({ ok: true, tag, clone() { return this; } });

describe('service worker', () => {
  it('com internet, entrega o que veio da rede e guarda uma cópia', async () => {
    const sw = loadSw({ network: async () => okRes('novo') as any });
    expect(await sw.respond('https://cestimo.test/app.js')).toMatchObject({ tag: 'novo' });
    expect(sw.stored.get('/app.js')).toMatchObject({ tag: 'novo' });
  });
  it('sem internet, usa a cópia guardada', async () => {
    const sw = loadSw({ network: async () => { throw new Error('offline'); }, cached: { '/app.js': { tag: 'velho' } } });
    expect(await sw.respond('https://cestimo.test/app.js')).toMatchObject({ tag: 'velho' });
  });
  it('sem internet, abrir um link compartilhado mostra a página inicial guardada', async () => {
    const sw = loadSw({ network: async () => { throw new Error('offline'); }, cached: { '/': { tag: 'casca' } } });
    expect(await sw.respond('https://cestimo.test/', { mode: 'navigate' })).toMatchObject({ tag: 'casca' });
  });
  it.each(['/api/jobs/1', '/admin', '/admin/stats', '/metrics', '/grafana/', '/healthz'])('não mexe em %s', async (path) => {
    const sw = loadSw({ network: async () => okRes('x') as any });
    expect(await sw.respond(`https://cestimo.test${path}`)).toBeUndefined();
  });
  it('não mexe em outros domínios nem em POST', async () => {
    const sw = loadSw({ network: async () => okRes('x') as any });
    expect(await sw.respond('https://outro.com/app.js')).toBeUndefined();
    expect(await sw.respond('https://cestimo.test/app.js', { method: 'POST' })).toBeUndefined();
  });
  it('resposta de erro do servidor não é guardada', async () => {
    const sw = loadSw({ network: async () => ({ ok: false, clone() { return this; } }) as any });
    await sw.respond('https://cestimo.test/app.js');
    expect(sw.stored.has('/app.js')).toBe(false);
  });
});

describe('avisos de queda de preço no service worker', () => {
  const offline = async () => { throw new Error('offline'); };
  it('mostra a notificação com o título e o texto enviados pelo servidor', async () => {
    const sw = loadSw({ network: offline });
    await sw.run('push', { data: { json: () => ({ title: 'Baixou 10%: sal 1kg', body: 'R$ 4,50 no Royal (antes R$ 5,00)' }) } });
    expect(sw.shown).toEqual([{ title: 'Baixou 10%: sal 1kg', options: expect.objectContaining({ body: 'R$ 4,50 no Royal (antes R$ 5,00)' }) }]);
  });
  it('aviso sem corpo legível ainda aparece (o navegador exige mostrar algo)', async () => {
    const sw = loadSw({ network: offline });
    await sw.run('push', { data: { json: () => { throw new Error('não é json'); } } });
    expect(sw.shown[0]!.title).toBe('Cestimo');
  });
  it('tocar na notificação abre o app', async () => {
    const sw = loadSw({ network: offline });
    let closed = false;
    await sw.run('notificationclick', { notification: { close: () => { closed = true; } } });
    expect(closed).toBe(true);
    expect(sw.opened).toEqual(['/']);
  });
  it('a casca do app guardada para uso sem internet inclui os módulos novos', () => {
    const src = read('sw.js');
    for (const f of ['/install.js', '/trend.js', '/push.js', '/mobileOrder.js', '/marketFilter.js', '/category.js']) expect(src).toContain(`'${f}'`);
  });
});
