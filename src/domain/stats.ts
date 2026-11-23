export type Priced = { source: string; priceBRL: number };
export type Stats = { cheapest: Priced; averageBRL: number; maxBRL: number; diffBRL: number; diffPct: number };
export type Basket = {
  totals: Map<string, number>;
  coverage: Map<string, number>;
  total: number;
  cheapestSource: string | null;
};

export function computeStats(items: Priced[]): Stats | null {
  if (items.length === 0) return null;
  const cheapest = items.reduce((a, b) => (b.priceBRL < a.priceBRL ? b : a));
  const maxBRL = items.reduce((m, i) => Math.max(m, i.priceBRL), 0);
  const sum = items.reduce((s, i) => s + i.priceBRL, 0);
  const diffBRL = maxBRL - cheapest.priceBRL;
  return {
    cheapest,
    averageBRL: sum / items.length,
    maxBRL,
    diffBRL,
    diffPct: cheapest.priceBRL > 0 ? (diffBRL / cheapest.priceBRL) * 100 : 0,
  };
}

/** Total por fonte sobre os produtos que ela cobre. A mais barata é escolhida entre as de maior cobertura. */
export function basketTotals(rows: Priced[][]): Basket {
  const totals = new Map<string, number>();
  const coverage = new Map<string, number>();
  for (const p of rows.flat()) {
    totals.set(p.source, (totals.get(p.source) ?? 0) + p.priceBRL);
    coverage.set(p.source, (coverage.get(p.source) ?? 0) + 1);
  }
  const maxCoverage = Math.max(0, ...coverage.values());
  const cheapestSource =
    [...totals.entries()]
      .filter(([source]) => coverage.get(source) === maxCoverage)
      .reduce<[string, number] | null>((best, e) => (best === null || e[1] < best[1] ? e : best), null)?.[0] ?? null;
  return { totals, coverage, total: rows.length, cheapestSource };
}
