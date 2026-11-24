import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { createAuthStore } from './users.js';
import type { PriceSource } from '../../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [] };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = 1_700_000_000_000;

function mk(over: { idToken?: (nonce: string) => string | null } = {}) {
  const store = createAuthStore({ path: ':memory:', now: () => NOW });
  const app = buildApp({
    sources: [fake],
    auth: {
      store, publicUrl: 'https://cestimo.test', now: () => NOW,
      google: { clientId: 'cid', clientSecret: 'sec' },
      exchange: async ({ code }) => (code === 'bad' ? null : (over.idToken ?? ((nonce) => `h.${b64({ iss: 'https://accounts.google.com', aud: 'cid', exp: NOW / 1000 + 600, nonce, sub: 'g1', email: 'ana@x.com', email_verified: true, name: 'Ana' })}.s`))(lastNonce)),
    },
  });
  return { app, store };
}
let lastNonce = '';
const cookieOf = (res: { headers: Record<string, unknown> }, name: string): string | undefined => {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return all.find((c) => c.startsWith(`${name}=`));
};
const pair = (setCookie: string) => setCookie.split(';')[0]!;

async function startLogin(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
  const loc = new URL(String(res.headers.location));
  lastNonce = loc.searchParams.get('nonce')!;
  return { res, state: loc.searchParams.get('state')!, oauthCookie: pair(cookieOf(res, 'cestimo_oauth')!) };
}

describe('login com Google', () => {
  it('sem configuração, as rotas não existem (404) e /api/me diz que ninguém entrou', async () => {
    const app = buildApp({ sources: [fake] });
    expect((await app.inject({ method: 'GET', url: '/api/auth/google' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/me' })).json()).toEqual({ user: null });
  });

  it('/api/config avisa quando o login existe', async () => {
    expect((await mk().app.inject({ method: 'GET', url: '/api/config' })).json().auth).toEqual({ google: true });
  });

  it('começa o login: redireciona ao Google e guarda state/nonce em cookie HttpOnly', async () => {
    const { res, state } = await startLogin(mk().app);
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('accounts.google.com');
    expect(new URL(String(res.headers.location)).searchParams.get('redirect_uri')).toBe('https://cestimo.test/api/auth/google/callback');
    expect(state.length).toBeGreaterThan(15);
    expect(cookieOf(res, 'cestimo_oauth')).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);
  });

  it('volta do Google: cria a sessão, entra, e /api/me devolve o usuário', async () => {
    const { app } = mk();
    const { state, oauthCookie } = await startLogin(app);
    const cb = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=ok&state=${state}`, headers: { cookie: oauthCookie } });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/');
    const sid = cookieOf(cb, 'cestimo_sid')!;
    expect(sid).toMatch(/HttpOnly/);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: pair(sid) } });
    expect(me.json()).toEqual({ user: { name: 'Ana', email: 'ana@x.com' } });
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('state diferente do cookie (ataque CSRF): recusa e não cria sessão', async () => {
    const { app } = mk();
    const { oauthCookie } = await startLogin(app);
    const cb = await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=ok&state=falso', headers: { cookie: oauthCookie } });
    expect(cb.headers.location).toBe('/?login=erro');
    expect(cookieOf(cb, 'cestimo_sid')).toBeUndefined();
  });

  it('sem o cookie de início, recusa', async () => {
    const cb = await mk().app.inject({ method: 'GET', url: '/api/auth/google/callback?code=ok&state=x' });
    expect(cb.headers.location).toBe('/?login=erro');
  });

  it('usuário cancelou no Google (error=access_denied) ou o código não vale: volta com erro, sem sessão', async () => {
    const { app } = mk();
    const a = await startLogin(app);
    const denied = await app.inject({ method: 'GET', url: `/api/auth/google/callback?error=access_denied&state=${a.state}`, headers: { cookie: a.oauthCookie } });
    expect(denied.headers.location).toBe('/?login=erro');
    const b = await startLogin(app);
    const bad = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=bad&state=${b.state}`, headers: { cookie: b.oauthCookie } });
    expect(bad.headers.location).toBe('/?login=erro');
    expect(cookieOf(bad, 'cestimo_sid')).toBeUndefined();
  });

  it('token do Google inválido (nonce errado): recusa', async () => {
    const { app } = mk({ idToken: () => `h.${b64({ iss: 'https://accounts.google.com', aud: 'cid', exp: NOW / 1000 + 600, nonce: 'outro', sub: 'g1', email: 'a@x.com', email_verified: true })}.s` });
    const { state, oauthCookie } = await startLogin(app);
    const cb = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=ok&state=${state}`, headers: { cookie: oauthCookie } });
    expect(cb.headers.location).toBe('/?login=erro');
  });

  it('sair apaga a sessão e o cookie', async () => {
    const { app } = mk();
    const { state, oauthCookie } = await startLogin(app);
    const cb = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=ok&state=${state}`, headers: { cookie: oauthCookie } });
    const sid = pair(cookieOf(cb, 'cestimo_sid')!);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sid } });
    expect(out.statusCode).toBe(204);
    expect(cookieOf(out, 'cestimo_sid')).toContain('Max-Age=0');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sid } })).json()).toEqual({ user: null });
  });
});
