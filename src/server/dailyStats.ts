export type DayValues = Record<string, number>;

/** Contagens por dia (no fuso configurado), para o gráfico do painel. Mantém só os últimos `keepDays`. */
export function createDailyStats(opts: { now?: () => number; utcOffsetMinutes?: number; keepDays?: number } = {}) {
  const now = opts.now ?? Date.now;
  const offsetMs = (opts.utcOffsetMinutes ?? -180) * 60_000;
  const keepDays = opts.keepDays ?? 90;
  const days = new Map<string, DayValues>();

  const keyAt = (t: number): string => new Date(t + offsetMs).toISOString().slice(0, 10);

  const prune = (): void => {
    const keys = [...days.keys()].sort();
    keys.slice(0, Math.max(0, keys.length - keepDays)).forEach((k) => days.delete(k));
  };

  return {
    add(event: string, n = 1): void {
      const key = keyAt(now());
      const values = days.get(key) ?? {};
      values[event] = (values[event] ?? 0) + n;
      days.set(key, values);
      prune();
    },
    /** Últimos `n` dias, do mais antigo ao de hoje, incluindo dias sem eventos. */
    series(n: number): Array<{ date: string; values: DayValues }> {
      const base = now();
      return Array.from({ length: n }, (_, i) => {
        const date = keyAt(base - (n - 1 - i) * 86_400_000);
        return { date, values: { ...(days.get(date) ?? {}) } };
      });
    },
    total(event: string): number {
      return [...days.values()].reduce((sum, v) => sum + (v[event] ?? 0), 0);
    },
    snapshot(): Record<string, DayValues> {
      return Object.fromEntries([...days].map(([k, v]) => [k, { ...v }]));
    },
    restore(state: unknown): void {
      if (typeof state !== 'object' || state === null || Array.isArray(state)) return;
      for (const [date, values] of Object.entries(state)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof values !== 'object' || values === null) continue;
        const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
        days.set(date, clean as DayValues);
      }
      prune();
    },
  };
}

export type DailyStats = ReturnType<typeof createDailyStats>;
