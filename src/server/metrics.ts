export type Labels = Record<string, string>;
type Kind = 'counter' | 'histogram' | 'gauge';
type Def = { kind: Kind; help: string; buckets: number[] };
type CounterCell = { labels: Labels; value: number };
type HistCell = { labels: Labels; counts: number[]; sum: number; count: number };

const labelKey = (l: Labels = {}): string => JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)));
const escapeValue = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmtLabels = (l: Labels): string => {
  const parts = Object.entries(l).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${escapeValue(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

export type MetricsState = {
  counters: Record<string, Array<{ labels: Labels; value: number }>>;
  hists: Record<string, Array<{ labels: Labels; counts: number[]; sum: number; count: number }>>;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLabels = (v: unknown): v is Labels => isObj(v) && Object.values(v).every((x) => typeof x === 'string');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Métricas com tags (labels) no formato Prometheus, sem dependências. Métrica não definida é ignorada. */
export function createMetrics() {
  const defs = new Map<string, Def>();
  const counters = new Map<string, Map<string, CounterCell>>();
  const hists = new Map<string, Map<string, HistCell>>();
  const gauges = new Map<string, Map<string, CounterCell>>();

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

    /** Gauge: valor que sobe e desce (total de contas, contas ativas…). Recalculado, nunca gravado em disco. */
    set(name: string, labels: Labels, value: number): void {
      if (defs.get(name)?.kind !== 'gauge' || !Number.isFinite(value)) return;
      const cells = gauges.get(name) ?? new Map<string, CounterCell>();
      cells.set(labelKey(labels), { labels, value });
      gauges.set(name, cells);
    },

    gaugeSummary(name: string): Array<{ labels: Labels; value: number }> {
      return [...(gauges.get(name)?.values() ?? [])].map(({ labels, value }) => ({ labels, value }));
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

    /** Estado serializável, para gravar em disco. */
    snapshot(): MetricsState {
      return {
        counters: Object.fromEntries([...counters].map(([name, cells]) => [name, [...cells.values()].map(({ labels, value }) => ({ labels, value }))])),
        hists: Object.fromEntries([...hists].map(([name, cells]) => [name, [...cells.values()].map(({ labels, counts, sum, count }) => ({ labels, counts: [...counts], sum, count }))])),
      };
    },

    /** Carrega um estado salvo; ignora o que não existe mais ou está malformado. */
    restore(state: unknown): void {
      if (!isObj(state)) return;
      const c = isObj(state.counters) ? state.counters : {};
      for (const [name, cells] of Object.entries(c)) {
        if (defs.get(name)?.kind !== 'counter' || !Array.isArray(cells)) continue;
        const map = counters.get(name) ?? new Map<string, CounterCell>();
        for (const cell of cells) {
          if (isObj(cell) && isLabels(cell.labels) && isNum(cell.value)) map.set(labelKey(cell.labels), { labels: cell.labels, value: cell.value });
        }
        counters.set(name, map);
      }
      const h = isObj(state.hists) ? state.hists : {};
      for (const [name, cells] of Object.entries(h)) {
        const def = defs.get(name);
        if (def?.kind !== 'histogram' || !Array.isArray(cells)) continue;
        const map = hists.get(name) ?? new Map<string, HistCell>();
        for (const cell of cells) {
          if (!isObj(cell) || !isLabels(cell.labels) || !isNum(cell.sum) || !isNum(cell.count)) continue;
          if (!Array.isArray(cell.counts) || cell.counts.length !== def.buckets.length || !cell.counts.every(isNum)) continue;
          map.set(labelKey(cell.labels), { labels: cell.labels, counts: [...cell.counts], sum: cell.sum, count: cell.count });
        }
        hists.set(name, map);
      }
    },

    render(): string {
      const lines: string[] = [];
      for (const [name, def] of defs) {
        lines.push(`# HELP ${name} ${def.help}`, `# TYPE ${name} ${def.kind}`);
        if (def.kind === 'counter' || def.kind === 'gauge') {
          for (const c of (def.kind === 'counter' ? counters : gauges).get(name)?.values() ?? []) lines.push(`${name}${fmtLabels(c.labels)} ${c.value}`);
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
    snapshot(): Array<[string, number, number]> {
      return [...items.entries()].map(([term, { count, seq: sq }]) => [term, count, sq]);
    },
    restore(entries: unknown): void {
      if (!Array.isArray(entries)) return;
      entries.forEach((e, i) => {
        if (!Array.isArray(e) || typeof e[0] !== 'string' || !isNum(e[1]) || e[1] <= 0) return;
        const sq = isNum(e[2]) ? e[2] : i;
        items.set(e[0], { count: e[1], seq: sq });
        seq = Math.max(seq, sq + 1);
      });
    },
    top(n: number): Array<{ term: string; count: number }> {
      return [...items.entries()]
        .sort(([, a], [, b]) => b.count - a.count || a.seq - b.seq)
        .slice(0, n)
        .map(([term, { count }]) => ({ term, count }));
    },
  };
}
