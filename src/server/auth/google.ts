/**
 * Login com Google (OpenID Connect, fluxo "código de autorização" feito pelo servidor).
 * O id_token chega direto do Google por HTTPS, na troca do código: por isso basta conferir emissor, audiência,
 * validade e nonce (a assinatura só importa quando o token passa por terceiros, o que não é o caso aqui).
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export type GoogleProfile = { sub: string; email: string; name: string };

export const buildAuthUrl = (p: { clientId: string; redirectUri: string; state: string; nonce: string }): string => {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    nonce: p.nonce,
    prompt: 'select_account',
  }).toString();
  return url.toString();
};

export function parseIdToken(idToken: string, opts: { clientId: string; nonce: string; now: () => number }): GoogleProfile | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  let c: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    c = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const { iss, aud, exp, nonce, sub, email, email_verified: verified, name } = c;
  if (typeof iss !== 'string' || !ISSUERS.includes(iss)) return null;
  if (aud !== opts.clientId) return null;
  if (typeof exp !== 'number' || exp * 1000 <= opts.now()) return null;
  if (nonce !== opts.nonce) return null;
  if (typeof sub !== 'string' || sub === '' || typeof email !== 'string' || email === '' || verified !== true) return null;
  return { sub, email, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : email.split('@')[0]! };
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function exchangeCode(p: { clientId: string; clientSecret: string; redirectUri: string; code: string; fetchFn?: FetchFn }): Promise<string | null> {
  const fetchFn = p.fetchFn ?? (fetch as unknown as FetchFn);
  try {
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: p.code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, grant_type: 'authorization_code' }).toString(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id_token?: unknown };
    return typeof body.id_token === 'string' ? body.id_token : null;
  } catch {
    return null;
  }
}
