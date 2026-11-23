export type Labels = Record<string, string>;
type Kind = 'counter' | 'histogram';
type Def = { kind: Kind; help: string; buckets: number[] };
type CounterCell = { labels: Labels; value: number };
type HistCell = { labels: Labels; counts: number[]; sum: number; count: number };

const labelKey = (l: Labels = {}): string => JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)));
const escapeValue = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmtLabels = (l: Labels): string => {
  const parts = Object.entries(l).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${escapeValue(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

/** Métricas com tags (labels) no formato Prometheus, sem dependências. Métrica não definida é ignorada. */
export function createMetrics() {
  const defs = new Map<string, Def>();
  const counters = new Map<string, Map<string, CounterCell>>();
  const hists = new Map<string, Map<string, HistCell>>();

  return {
    define(name: string, kind: Kind, help: string, buckets: number[] = []): void {
      defs.set(name, { kind, help, buckets: [...buckets].sort((a, b) => a - b) });
    },

    inc(name: string, labels: Labels = {}, by = 1): void {
      if (defs.get(name)?.kind !== 'counter') return;
      const cells = counters.get(name) ?? new Map<string, CounterCell>();
      const key = labelKey(labels);
      const cell = cells.get(key) ?? { labels, value: 0 };
      cell.value += by;
      cells.set(key, cell);
      counters.set(name, cells);
    },

    observe(name: string, value: number, labels: Labels = {}): void {
      const def = defs.get(name);
      if (def?.kind !== 'histogram') return;
      const cells = hists.get(name) ?? new Map<string, HistCell>();
      const key = labelKey(labels);
      const cell = cells.get(key) ?? { labels, counts: def.buckets.map(() => 0), sum: 0, count: 0 };
      def.buckets.forEach((b, i) => { if (value <= b) cell.counts[i] = (cell.counts[i] ?? 0) + 1; });
      cell.sum += value;
      cell.count += 1;
      cells.set(key, cell);
      hists.set(name, cells);
    },

    counterSummary(name: string): Array<{ labels: Labels; value: number }> {
      return [...(counters.get(name)?.values() ?? [])].map(({ labels, value }) => ({ labels, value }));
    },

    histogramSummary(name: string): Array<{ labels: Labels; count: number; sum: number; avg: number }> {
      return [...(hists.get(name)?.values() ?? [])].map(({ labels, count, sum }) => ({ labels, count, sum, avg: count ? sum / count : 0 }));
    },

    render(): string {
      const lines: string[] = [];
      for (const [name, def] of defs) {
        lines.push(`# HELP ${name} ${def.help}`, `# TYPE ${name} ${def.kind}`);
        if (def.kind === 'counter') {
          for (const c of counters.get(name)?.values() ?? []) lines.push(`${name}${fmtLabels(c.labels)} ${c.value}`);
          continue;
        }
        for (const h of hists.get(name)?.values() ?? []) {
          def.buckets.forEach((b, i) => lines.push(`${name}_bucket${fmtLabels({ ...h.labels, le: String(b) })} ${h.counts[i]}`));
          lines.push(`${name}_bucket${fmtLabels({ ...h.labels, le: '+Inf' })} ${h.count}`);
          lines.push(`${name}_sum${fmtLabels(h.labels)} ${h.sum}`, `${name}_count${fmtLabels(h.labels)} ${h.count}`);
        }
      }
      return `${lines.join('\n')}\n`;
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

/** Termo de busca para estatística: minúsculas, espaços colapsados, até 60 caracteres. */
export const normalizeQuery = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

/** Ranking limitado dos termos mais buscados (memória fixa). */
export function createTopList(max: number) {
  const items = new Map<string, { count: number; seq: number }>();
  let seq = 0;
  return {
    record(term: string): void {
      const cur = items.get(term);
      items.set(term, { count: (cur?.count ?? 0) + 1, seq: cur?.seq ?? seq++ });
      if (items.size <= max) return;
      const [evict] = [...items.entries()].sort(([, a], [, b]) => a.count - b.count || b.seq - a.seq);
      if (evict) items.delete(evict[0]);
    },
    top(n: number): Array<{ term: string; count: number }> {
      return [...items.entries()]
        .sort(([, a], [, b]) => b.count - a.count || a.seq - b.seq)
        .slice(0, n)
        .map(([term, { count }]) => ({ term, count }));
    },
  };
}
