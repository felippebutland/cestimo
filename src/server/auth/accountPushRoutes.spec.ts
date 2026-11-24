import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { createAuthStore } from './users.js';
import type { PriceSource } from '../../domain/types.js';

const fake: PriceSource = { name: 'fake', search: async () => [] };
const mk = () => {
  const store = createAuthStore({ path: ':memory:' });
  const app = buildApp({ sources: [fake], auth: { store, publicUrl: 'https://x.test', google: { clientId: 'c', clientSecret: 's' } } });
  const login = (sub: string) => `cestimo_sid=${store.createSession(store.upsertUser({ sub, email: `${sub}@x.com`, name: sub }).id)}`;
  return { app, ana: login('ana'), bia: login('bia') };
};
const sub = (host = 'fcm.googleapis.com', n = 'a') => ({ endpoint: `https://${host}/send/${n}`, keys: { p256dh: 'BPubKeyValue_123', auth: 'AuthSecret_123' } });
const call = (app: ReturnType<typeof buildApp>, method: 'GET' | 'POST', url: string, cookie?: string, payload?: object) => app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

describe('aviso de queda para a conta (aparelhos)', () => {
  it('exige login', async () => {
    const { app } = mk();
    expect((await call(app, 'POST', '/api/me/push', undefined, { subscription: sub() })).statusCode).toBe(401);
    expect((await call(app, 'GET', '/api/me/push?endpoint=x')).statusCode).toBe(401);
  });
  it('liga o aparelho à conta, consulta e desliga', async () => {
    const { app, ana } = mk();
    const s = sub();
    expect((await call(app, 'POST', '/api/me/push', ana, { subscription: s })).statusCode).toBe(204);
    expect((await call(app, 'GET', `/api/me/push?endpoint=${encodeURIComponent(s.endpoint)}`, ana)).json()).toEqual({ on: true });
    expect((await call(app, 'POST', '/api/me/push/remove', ana, { endpoint: s.endpoint })).statusCode).toBe(204);
    expect((await call(app, 'GET', `/api/me/push?endpoint=${encodeURIComponent(s.endpoint)}`, ana)).json()).toEqual({ on: false });
  });
  it('o aparelho de uma conta não aparece como ligado para outra', async () => {
    const { app, ana, bia } = mk();
    const s = sub();
    await call(app, 'POST', '/api/me/push', ana, { subscription: s });
    expect((await call(app, 'GET', `/api/me/push?endpoint=${encodeURIComponent(s.endpoint)}`, bia)).json()).toEqual({ on: false });
  });
  it('recusa endereço fora dos serviços de push (proteção contra SSRF) e corpo inválido', async () => {
    const { app, ana } = mk();
    expect((await call(app, 'POST', '/api/me/push', ana, { subscription: sub('169.254.169.254') })).statusCode).toBe(400);
    expect((await call(app, 'POST', '/api/me/push', ana, { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: {} } })).statusCode).toBe(400);
    expect((await call(app, 'POST', '/api/me/push', ana, {})).statusCode).toBe(400);
  });
  it('limite de aparelhos por conta: 409', async () => {
    const { app, ana } = mk();
    for (let i = 0; i < 5; i++) await call(app, 'POST', '/api/me/push', ana, { subscription: sub('fcm.googleapis.com', `d${i}`) });
    expect((await call(app, 'POST', '/api/me/push', ana, { subscription: sub('fcm.googleapis.com', 'extra') })).statusCode).toBe(409);
  });
});
