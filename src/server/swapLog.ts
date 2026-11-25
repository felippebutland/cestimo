export type SwapKind = 'open' | 'swap';
export type SwapCategory = 'mercados' | 'farmacias';
export type SwapDetail = { source: string; query: string; category: SwapCategory; from?: string; to?: string };
export type SwapEntry = SwapDetail & { at: number; kind: SwapKind };

const MAX_TEXT = 120;
const CATEGORIES: readonly string[] = ['mercados', 'farmacias'];

/** Tira caracteres de controle e espaços repetidos; corta no limite. Vazio vira null. */
const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return text || null;
};

/** Valida o detalhe que o site manda junto do evento. Só a loja precisa existir; os textos são limpos e cortados. */
export function parseSwapDetail(raw: unknown, knownSources: readonly string[]): SwapDetail | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const query = clean(r.query);
  if (!query || typeof r.source !== 'string' || !knownSources.includes(r.source)) return null;
  if (typeof r.category !== 'string' || !CATEGORIES.includes(r.category)) return null;
  const from = clean(r.from);
  const to = clean(r.to);
  return { source: r.source, query, category: r.category as SwapCategory, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

type Counts = Record<string, { opens: number; swaps: number }>;

/**
 * Registro anônimo de "Não é esse?" (abriu as opções) e de trocas (qual produto saiu e qual entrou).
 * Guarda as últimas `max` ações e, à parte, as contagens por loja, que não se perdem quando a lista corta as antigas.
 */
export function createSwapLog(opts: { max?: number; now?: () => number } = {}) {
  const max = opts.max ?? 300;
  const now = opts.now ?? Date.now;
  let entries: SwapEntry[] = [];
  let counts: Counts = {};

  const bump = (counts_: Counts, source: string, kind: SwapKind): Counts => {
    const cur = counts_[source] ?? { opens: 0, swaps: 0 };
    return { ...counts_, [source]: kind === 'open' ? { ...cur, opens: cur.opens + 1 } : { ...cur, swaps: cur.swaps + 1 } };
  };

  return {
    add(kind: SwapKind, detail: SwapDetail): void {
      entries = [...entries, { ...detail, kind, at: now() }].slice(-max);
      counts = bump(counts, detail.source, kind);
    },
    /** Mais recentes primeiro. */
    recent(n: number): SwapEntry[] {
      return entries.slice(-n).reverse();
    },
    summary() {
      const bySource = Object.entries(counts)
        .map(([source, c]) => ({ source, ...c }))
        .sort((a, b) => b.opens + b.swaps - (a.opens + a.swaps) || a.source.localeCompare(b.source));
      const swaps = new Map<string, { query: string; from: string; to: string; count: number }>();
      for (const e of entries) {
        if (e.kind !== 'swap') continue;
        const key = `${e.query}\u0000${e.from ?? ''}\u0000${e.to ?? ''}`;
        const cur = swaps.get(key);
        swaps.set(key, cur ? { ...cur, count: cur.count + 1 } : { query: e.query, from: e.from ?? '', to: e.to ?? '', count: 1 });
      }
      return {
        opens: bySource.reduce((t, s) => t + s.opens, 0),
        swaps: bySource.reduce((t, s) => t + s.swaps, 0),
        bySource,
        topSwaps: [...swaps.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      };
    },
    snapshot: () => ({ entries, counts }),
    restore(state: unknown): void {
      if (typeof state !== 'object' || state === null) return;
      const s = state as { entries?: unknown; counts?: unknown };
      if (Array.isArray(s.entries)) {
        entries = s.entries
          .filter((e): e is SwapEntry => typeof e === 'object' && e !== null && (e.kind === 'open' || e.kind === 'swap') && typeof e.at === 'number' && typeof e.source === 'string' && typeof e.query === 'string' && CATEGORIES.includes(e.category))
          .slice(-max);
      }
      if (typeof s.counts === 'object' && s.counts !== null && !Array.isArray(s.counts)) {
        counts = Object.fromEntries(
          Object.entries(s.counts as Record<string, { opens?: unknown; swaps?: unknown }>)
            .filter(([, c]) => typeof c?.opens === 'number' && typeof c?.swaps === 'number')
            .map(([k, c]) => [k, { opens: c.opens as number, swaps: c.swaps as number }]),
        );
      }
    },
  };
}

export type SwapLog = ReturnType<typeof createSwapLog>;
