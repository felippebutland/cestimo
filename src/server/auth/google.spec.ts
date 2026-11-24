import { describe, it, expect } from 'vitest';
import { buildAuthUrl, exchangeCode, parseIdToken } from './google.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const NOW = 1_700_000_000_000;
const ok = { iss: 'https://accounts.google.com', aud: 'cid', exp: NOW / 1000 + 600, nonce: 'n1', sub: '123', email: 'a@b.com', email_verified: true, name: 'Ana' };
const opts = { clientId: 'cid', nonce: 'n1', now: () => NOW };

describe('buildAuthUrl', () => {
  it('monta o endereço do Google com escopo mínimo, state e nonce', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.com/cb', state: 's1', nonce: 'n1' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x.com/cb');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('s1');
    expect(u.searchParams.get('nonce')).toBe('n1');
  });
});

describe('parseIdToken', () => {
  it('lê id, e-mail e nome de um token válido', () => {
    expect(parseIdToken(token(ok), opts)).toEqual({ sub: '123', email: 'a@b.com', name: 'Ana' });
  });
  it('aceita o emissor sem https', () => {
    expect(parseIdToken(token({ ...ok, iss: 'accounts.google.com' }), opts)).not.toBeNull();
  });
  it('sem nome, usa a parte antes do @ do e-mail', () => {
    expect(parseIdToken(token({ ...ok, name: undefined }), opts)?.name).toBe('a');
  });
  it.each([
    ['audiência de outro app', { aud: 'outro' }],
    ['emissor errado', { iss: 'https://evil.com' }],
    ['expirado', { exp: NOW / 1000 - 1 }],
    ['nonce diferente', { nonce: 'zzz' }],
    ['e-mail não verificado', { email_verified: false }],
    ['sem sub', { sub: undefined }],
    ['sem e-mail', { email: undefined }],
  ])('recusa: %s', (_n, patch) => {
    expect(parseIdToken(token({ ...ok, ...patch }), opts)).toBeNull();
  });
  it('recusa lixo', () => {
    for (const t of ['', 'a.b', 'a.!!!.c', `${b64({})}.${b64('x')}.s`]) expect(parseIdToken(t, opts)).toBeNull();
  });
});

describe('exchangeCode', () => {
  const args = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x.com/cb', code: 'abc' };
  it('troca o código pelo id_token no endereço do Google', async () => {
    let seen: { url: string; body: string } | null = null;
    const fetchFn = (async (url: string, init: { body: string }) => { seen = { url, body: init.body }; return { ok: true, json: async () => ({ id_token: 'T' }) }; }) as never;
    expect(await exchangeCode({ ...args, fetchFn })).toBe('T');
    expect(seen!.url).toBe('https://oauth2.googleapis.com/token');
    const p = new URLSearchParams(seen!.body);
    expect(p.get('grant_type')).toBe('authorization_code');
    expect(p.get('code')).toBe('abc');
    expect(p.get('client_secret')).toBe('sec');
  });
  it('null quando o Google recusa, sem id_token ou a rede falha', async () => {
    expect(await exchangeCode({ ...args, fetchFn: (async () => ({ ok: false, json: async () => ({}) })) as never })).toBeNull();
    expect(await exchangeCode({ ...args, fetchFn: (async () => ({ ok: true, json: async () => ({}) })) as never })).toBeNull();
    expect(await exchangeCode({ ...args, fetchFn: (async () => { throw new Error('rede'); }) as never })).toBeNull();
  });
});
