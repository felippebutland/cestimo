import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { createAppMetrics } from '../appMetrics.js';
import { createAuthStore } from './users.js';
import type { PriceSource } from '../../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [] };
const NOW = Date.UTC(2026, 10, 24, 15);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
let nonce = '';

function mk(withAuth = true) {
  const metrics = createAppMetrics();
  const store = createAuthStore({ path: ':memory:', now: () => NOW });
  const idToken = () => `h.${b64({ iss: 'https://accounts.google.com', aud: 'c', exp: NOW / 1000 + 600, nonce, sub: 'g1', email: 'a@x.com', email_verified: true, name: 'Ana' })}.s`;
  const app = buildApp({
    sources: [fake], metrics, metricsToken: 'seg',
    ...(withAuth ? { auth: { store, publicUrl: 'https://x.test', now: () => NOW, google: { clientId: 'c', clientSecret: 's' }, exchange: async ({ code }: { code: string }) => (code === 'bad' ? null : idToken()) } } : {}),
  });
  const count = (name: string, labels: Record<string, string>) => metrics.counterSummary(name).find((c) => Object.entries(labels).every(([k, v]) => c.labels[k] === v))?.value ?? 0;
  return { app, store, metrics, count };
}
const pair = (res: { headers: Record<string, unknown> }, name: string) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [String(raw)]).find((c) => c.startsWith(`${name}=`))?.split(';')[0];
};
async function login(app: ReturnType<typeof buildApp>, code = 'ok') {
  const start = await app.inject({ method: 'GET', url: '/api/auth/google' });
  const loc = new URL(String(start.headers.location));
  nonce = loc.searchParams.get('nonce')!;
  const cb = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=${code}&state=${loc.searchParams.get('state')}`, headers: { cookie: pair(start, 'cestimo_oauth')! } });
  return { cb, sid: pair(cb, 'cestimo_sid') };
}
const basic = { authorization: `Basic ${Buffer.from('x:seg').toString('base64')}` };

describe('contadores de conta', () => {
  it('login: novo cadastro, retorno e erro são contados à parte', async () => {
    const { app, count } = mk();
    await login(app);
    expect(count('auth_events_total', { event: 'login_ok' })).toBe(1);
    expect(count('auth_events_total', { event: 'signup' })).toBe(1);
    await login(app);
    expect(count('auth_events_total', { event: 'login_ok' })).toBe(2);
    expect(count('auth_events_total', { event: 'signup' })).toBe(1);
    await login(app, 'bad');
    expect(count('auth_events_total', { event: 'login_error' })).toBe(1);
  });
  it('sair e excluir conta', async () => {
    const { app, count } = mk();
    const { sid } = await login(app);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sid! } });
    expect(count('auth_events_total', { event: 'logout' })).toBe(1);
    const again = await login(app);
    await app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: again.sid! } });
    expect(count('auth_events_total', { event: 'account_deleted' })).toBe(1);
  });
  it('listas e acompanhados do painel', async () => {
    const { app, count } = mk();
    const { sid } = await login(app);
    const h = { cookie: sid! };
    await app.inject({ method: 'POST', url: '/api/me/lists', headers: h, payload: { name: 'A', category: 'mercados', list: 'Arroz' } });
    await app.inject({ method: 'POST', url: '/api/me/tracked', headers: h, payload: { query: 'Sal 1kg', category: 'mercados' } });
    await app.inject({ method: 'POST', url: '/api/me/tracked', headers: h, payload: { query: 'sal 1kg', category: 'mercados' } });
    const id = (await app.inject({ method: 'GET', url: '/api/me/tracked', headers: h })).json().items[0].id;
    await app.inject({ method: 'DELETE', url: `/api/me/tracked/${id}`, headers: h });
    const listId = (await app.inject({ method: 'GET', url: '/api/me/lists', headers: h })).json().lists[0].id;
    await app.inject({ method: 'DELETE', url: `/api/me/lists/${listId}`, headers: h });
    expect(count('panel_events_total', { event: 'list_saved' })).toBe(1);
    expect(count('panel_events_total', { event: 'list_deleted' })).toBe(1);
    expect(count('panel_events_total', { event: 'track_added' })).toBe(1); // o repetido não conta
    expect(count('panel_events_total', { event: 'track_removed' })).toBe(1);
  });
});

describe('números das contas no /admin/stats e no /metrics', () => {
  it('/admin/stats traz o bloco "accounts"', async () => {
    const { app } = mk();
    const { sid } = await login(app);
    await app.inject({ method: 'POST', url: '/api/me/tracked', headers: { cookie: sid! }, payload: { query: 'Sal 1kg', category: 'mercados' } });
    const { accounts } = (await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json();
    expect(accounts).toMatchObject({ total: 1, active7: 1, active30: 1, newLast24h: 1, tracked: 1, usersTracking: 1, lists: 0 });
    expect(accounts.signups).toHaveLength(14);
    expect(accounts.signups.at(-1).count).toBe(1);
  });
  it('sem login configurado, "accounts" é null', async () => {
    const { app } = mk(false);
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: basic })).json().accounts).toBeNull();
  });
  it('/metrics expõe os totais como gauge', async () => {
    const { app } = mk();
    await login(app);
    const text = (await app.inject({ method: 'GET', url: '/metrics', headers: basic })).body;
    expect(text).toContain('accounts_total 1');
    expect(text).toContain('accounts_active{window="7d"} 1');
    expect(text).toContain('accounts_active{window="30d"} 1');
    expect(text).toMatch(/saved_lists_total 0/);
    expect(text).toMatch(/tracked_products_total 0/);
  });
});
