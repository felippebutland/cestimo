import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createRateLimiter } from '../limits.js';
import type { Metrics } from '../metrics.js';
import { parseCookies, serializeCookie } from './cookies.js';
import { buildAuthUrl, exchangeCode, parseIdToken } from './google.js';
import type { AuthStore, AuthUser } from './users.js';

export type AuthDeps = {
  store: AuthStore;
  /** Endereço público do app (https://…): dele sai o redirect_uri cadastrado no Google e o cookie Secure. */
  publicUrl: string;
  google: { clientId: string; clientSecret: string };
  /** Troca do código pelo token; vem do Google, os testes passam um falso. */
  exchange?: typeof exchangeCode;
  now?: () => number;
  /** Duração da sessão em segundos (padrão: 30 dias). */
  sessionTtlSec?: number;
  /** Chamado quando uma conta começa a acompanhar um produto novo: o app busca o preço na hora (sem esperar a rotina diária). */
  onTrack?: (query: string, category: 'mercados' | 'farmacias') => void;
  /** Limite de tentativas de login por IP (padrão: 30 por hora). */
  rateLimit?: { max: number; windowMs: number };
};

export const SESSION_COOKIE = 'cestimo_sid';
const OAUTH_COOKIE = 'cestimo_oauth';
const OAUTH_TTL_SEC = 10 * 60;
const CALLBACK_PATH = '/api/auth/google/callback';

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function userFromRequest(auth: AuthDeps | undefined, req: FastifyRequest): AuthUser | null {
  if (!auth) return null;
  return auth.store.userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? '');
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthDeps | undefined, metrics?: Metrics): void {
  const event = (name: string): void => metrics?.inc('auth_events_total', { event: name });
  app.get('/api/me', async (req, reply) => {
    const user = userFromRequest(auth, req);
    return reply.header('cache-control', 'no-store').send({ user: user ? { name: user.name, email: user.email } : null });
  });
  if (!auth) return;

  const secure = auth.publicUrl.startsWith('https://');
  const now = auth.now ?? Date.now;
  const exchange = auth.exchange ?? exchangeCode;
  const sessionTtlSec = auth.sessionTtlSec ?? 30 * 24 * 60 * 60;
  const redirectUri = `${auth.publicUrl.replace(/\/$/, '')}${CALLBACK_PATH}`;
  const limiter = createRateLimiter(auth.rateLimit ?? { max: 30, windowMs: 60 * 60 * 1000 });
  const clearOauth = serializeCookie(OAUTH_COOKIE, '', { maxAgeSec: 0, secure });

  app.get('/api/auth/google', async (req, reply) => {
    if (!limiter.check(req.ip).allowed) return reply.code(429).send({ error: 'Muitas tentativas seguidas. Tente de novo mais tarde.' });
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    return reply
      .header('set-cookie', serializeCookie(OAUTH_COOKIE, `${state}.${nonce}`, { maxAgeSec: OAUTH_TTL_SEC, secure }))
      .header('cache-control', 'no-store')
      .redirect(buildAuthUrl({ clientId: auth.google.clientId, redirectUri, state, nonce }));
  });

  app.get(CALLBACK_PATH, async (req, reply) => {
    const fail = () => { event('login_error'); return reply.header('set-cookie', clearOauth).header('cache-control', 'no-store').redirect('/?login=erro'); };
    const { code, state, error } = req.query as { code?: unknown; state?: unknown; error?: unknown };
    const saved = (parseCookies(req.headers.cookie)[OAUTH_COOKIE] ?? '').split('.');
    const [savedState, nonce] = saved;
    if (error || typeof code !== 'string' || typeof state !== 'string' || !savedState || !nonce || !sameText(state, savedState)) return fail();
    const idToken = await exchange({ code, clientId: auth.google.clientId, clientSecret: auth.google.clientSecret, redirectUri });
    const profile = idToken ? parseIdToken(idToken, { clientId: auth.google.clientId, nonce, now }) : null;
    if (!profile) return fail();
    const isNew = !auth.store.hasUser(profile.sub);
    const user = auth.store.upsertUser(profile);
    const token = auth.store.createSession(user.id);
    event('login_ok');
    if (isNew) event('signup');
    return reply
      .header('set-cookie', [clearOauth, serializeCookie(SESSION_COOKIE, token, { maxAgeSec: sessionTtlSec, secure })])
      .header('cache-control', 'no-store')
      .redirect('/');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) auth.store.deleteSession(token);
    event('logout');
    return reply.header('set-cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure })).code(204).send();
  });
}
