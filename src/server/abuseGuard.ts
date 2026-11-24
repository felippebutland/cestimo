/**
 * Bloqueio por IP de quem insiste em buscar o que não é produto. Tudo em memória (o IP nunca vai para disco nem para os logs):
 * reiniciar o servidor zera as contas e os bloqueios.
 */
export function createAbuseGuard(opts: { maxStrikes?: number; blockMs?: number; now?: () => number } = {}) {
  const maxStrikes = opts.maxStrikes ?? 2;
  const blockMs = opts.blockMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;
  type Entry = { strikes: number; firstAt: number; blockedUntil: number };
  const entries = new Map<string, Entry>();

  const prune = (t: number): void => {
    for (const [ip, e] of entries) if (e.blockedUntil <= t && t - e.firstAt >= blockMs) entries.delete(ip);
  };

  return {
    /** Registra uma busca inválida. Passou de `maxStrikes`, o IP fica bloqueado por `blockMs`. */
    strike(ip: string): { blocked: boolean; strikes: number } {
      const t = now();
      prune(t);
      let e = entries.get(ip);
      if (!e || (e.blockedUntil <= t && t - e.firstAt >= blockMs)) {
        e = { strikes: 0, firstAt: t, blockedUntil: 0 };
        entries.set(ip, e);
      }
      e.strikes++;
      if (e.strikes > maxStrikes) {
        e.blockedUntil = t + blockMs;
        return { blocked: true, strikes: e.strikes };
      }
      return { blocked: false, strikes: e.strikes };
    },
    /** Milissegundos que faltam de bloqueio; 0 = livre. */
    isBlocked(ip: string): number {
      const e = entries.get(ip);
      const left = e ? e.blockedUntil - now() : 0;
      return left > 0 ? left : 0;
    },
    size: (): number => entries.size,
  };
}
export type AbuseGuard = ReturnType<typeof createAbuseGuard>;
