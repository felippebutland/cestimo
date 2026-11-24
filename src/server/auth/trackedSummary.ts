import type { PricePoint } from '../history.js';

export const DROP_THRESHOLD_PCT = 5;

export type TrackedSummary = {
  latestBRL: number | null;
  latestSource: string | null;
  latestDay: string | null;
  /** Variação do menor preço desde que a pessoa começou a acompanhar (negativo = baixou). */
  changePct: number | null;
  /** Quanto o último preço caiu em relação ao ponto anterior (positivo = caiu). */
  dropPct: number | null;
  dropped: boolean;
  spark: number[];
};

const pct = (from: number, to: number): number => ((to - from) / from) * 100;

/** `baseline`: o menor preço que a pessoa viu quando começou a acompanhar. É o primeiro preço enquanto o histórico não tem nada. */
export function summarizeTracked(series: PricePoint[], startDay: string, baseline: { priceBRL: number; source: string } | null = null): TrackedSummary {
  const last = series.at(-1);
  if (!last) {
    return baseline
      ? { latestBRL: baseline.priceBRL, latestSource: baseline.source, latestDay: startDay, changePct: null, dropPct: null, dropped: false, spark: [baseline.priceBRL] }
      : { latestBRL: null, latestSource: null, latestDay: null, changePct: null, dropPct: null, dropped: false, spark: [] };
  }
  const prevPrice = series.at(-2)?.cheapestBRL ?? baseline?.priceBRL ?? null;
  const base = series.find((p) => p.day >= startDay) ?? series[0]!;
  const dropPct = prevPrice !== null ? ((prevPrice - last.cheapestBRL) / prevPrice) * 100 : null;
  return {
    latestBRL: last.cheapestBRL,
    latestSource: last.cheapestSource,
    latestDay: last.day,
    changePct: baseline ? pct(baseline.priceBRL, last.cheapestBRL) : series.length > 1 && base !== last ? pct(base.cheapestBRL, last.cheapestBRL) : null,
    dropPct,
    dropped: dropPct !== null && dropPct >= DROP_THRESHOLD_PCT,
    spark: series.map((p) => p.cheapestBRL),
  };
}
