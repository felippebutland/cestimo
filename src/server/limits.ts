import { createHash, timingSafeEqual } from 'node:crypto';

/** Limite por chave (ex.: IP) em janela deslizante, em memória. */
export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let lastPrune = now();

  const prune = (t: number): void => {
    for (const [key, times] of hits) {
      const fresh = times.filter((ts) => t - ts < opts.windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
    lastPrune = t;
  };

  return {
    check(key: string): { allowed: boolean; retryAfterMs: number } {
      const t = now();
      if (t - lastPrune >= opts.windowMs) prune(t);
      const times = (hits.get(key) ?? []).filter((ts) => t - ts < opts.windowMs);
      if (times.length >= opts.max) {
        hits.set(key, times);
        return { allowed: false, retryAfterMs: times[0]! + opts.windowMs - t };
      }
      hits.set(key, [...times, t]);
      return { allowed: true, retryAfterMs: 0 };
    },
    size: (): number => hits.size,
  };
}

/** Limita quantas operações pesadas rodam ao mesmo tempo; quem não cabe é recusado (não fica na fila). */
export function createGate(max: number) {
  let active = 0;
  return {
    tryEnter(): (() => void) | null {
      if (active >= max) return null;
      active++;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        active--;
      };
    },
    active: (): number => active,
  };
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/** Autenticação Basic: qualquer usuário, senha igual ao token. Sem token configurado, nunca autoriza. */
export function basicAuthOk(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(token));
}
