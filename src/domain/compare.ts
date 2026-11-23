import { CERTAIN_THRESHOLD, pickBest, rankCandidates, searchTerm } from './match.js';
import { extractQuantity, scaleToQuantity, unitLabel, unitPrice } from './quantity.js';
import { basketTotals, computeStats, type Basket, type Priced, type Stats } from './stats.js';
import { withTimeout } from './timeout.js';
import { BlockedError, type Offer, type PriceSource, type SourceStatus } from './types.js';

/** Um item de um mercado que casou (ou pode casar) com o produto pedido. */
export type Match = {
  title: string;
  priceBRL: number;
  /** Preço real convertido para o tamanho pedido (igual a priceBRL quando o tamanho é o mesmo). */
  equivalentBRL: number;
  sizeAdjusted: boolean;
  unitPriceBRL?: number;
  unit?: 'kg' | 'L' | 'un';
  score: number;
  uncertain: boolean;
  /** A pessoa escolheu este item em vez do sugerido: vale mesmo que a nota seja baixa. */
  chosenByUser?: boolean;
  url?: string;
};

export type SourceResult = {
  source: string;
  status: SourceStatus;
  reason?: string;
  match?: Match;
  /** Outros itens parecidos da mesma loja, para trocar quando o escolhido estiver errado. */
  alternatives?: Match[];
};
export type ProductResult = { query: string; sources: SourceResult[]; stats: Stats | null };
/** Evento de uma busca em um mercado (para métricas e logs). */
export type SourceEvent = { query: string; source: string; status: SourceStatus; ms: number; matched: boolean; reason?: string };
export type Observer = (event: SourceEvent) => void;

export type CompareResult = { products: ProductResult[]; basket: Basket };

/** Teto de segurança por consulta (inclui a espera na fila de navegadores). */
const DEFAULT_TIMEOUT_MS = 300_000;

const validPrice = (o: Offer): boolean => Number.isFinite(o.priceBRL) && o.priceBRL > 0;

const safely = (observer: Observer | undefined, event: SourceEvent): void => {
  try {
    observer?.(event);
  } catch {
    // métrica nunca pode derrubar a comparação
  }
};

async function querySource(query: string, source: PriceSource, timeoutMs: number, observer?: Observer): Promise<SourceResult> {
  const started = Date.now();
  const result = await runSource(query, source, timeoutMs);
  safely(observer, { query, source: source.name, status: result.status, ms: Date.now() - started, matched: result.match !== undefined, reason: result.reason });
  return result;
}

const MAX_ALTERNATIVES = 4;

function buildMatch(query: string, offer: Offer, score: number, sizeAdjusted: boolean): Match {
  const wanted = extractQuantity(query);
  const found = extractQuantity(offer.title);
  return {
    title: offer.title,
    priceBRL: offer.priceBRL,
    equivalentBRL: sizeAdjusted && wanted && found ? scaleToQuantity(offer.priceBRL, found, wanted) : offer.priceBRL,
    sizeAdjusted,
    unitPriceBRL: found ? unitPrice(offer.priceBRL, found) : undefined,
    unit: found ? unitLabel(found.dim) : undefined,
    score,
    uncertain: score < CERTAIN_THRESHOLD,
    url: offer.url,
  };
}

const sameItem = (a: Offer, b: Offer): boolean => a.title === b.title && a.priceBRL === b.priceBRL;

async function runSource(query: string, source: PriceSource, timeoutMs: number): Promise<SourceResult> {
  try {
    const offers = (await withTimeout(source.search(searchTerm(query)), timeoutMs)).filter(validPrice);
    const best = pickBest(query, offers);
    const alternatives = rankCandidates(query, offers, MAX_ALTERNATIVES + 1)
      .filter((c) => !best || !sameItem(c.offer, best.offer))
      .slice(0, MAX_ALTERNATIVES)
      .map((c) => buildMatch(query, c.offer, c.relevance, c.sizeAdjusted));
    return {
      source: source.name,
      status: 'ok',
      ...(best ? { match: buildMatch(query, best.offer, best.score, best.sizeAdjusted) } : {}),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    };
  } catch (e) {
    return {
      source: source.name,
      status: e instanceof BlockedError ? 'indisponivel' : 'erro',
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

const OUTLIER_HIGH = 2.5;
const OUTLIER_LOW = 0.4;
const MIN_SOURCES_FOR_OUTLIER = 3;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Preço escalado (de outro tamanho) muito acima/abaixo da mediana das outras lojas é provável match errado: vira "incerto".
 * Só vale para itens "ajustados": a escala multiplica o erro (1 kg x5). Item de tamanho exato com título compatível é confiável,
 * mesmo com preço bem diferente (marcas): o mais barato de verdade costuma ser uma marca econômica.
 */
function flagOutliers(results: SourceResult[]): SourceResult[] {
  const prices = results.flatMap((r) => (r.match && !r.match.uncertain ? [r.match.equivalentBRL] : []));
  if (prices.length < MIN_SOURCES_FOR_OUTLIER) return results;
  const mid = median(prices);
  return results.map((r) =>
    r.match && !r.match.uncertain && r.match.sizeAdjusted && (r.match.equivalentBRL > mid * OUTLIER_HIGH || r.match.equivalentBRL < mid * OUTLIER_LOW)
      ? { ...r, reason: 'preço muito fora do padrão das outras lojas', match: { ...r.match, uncertain: true } }
      : r,
  );
}

const priced = (r: SourceResult): Priced[] =>
  r.match && !r.match.uncertain ? [{ source: r.source, priceBRL: r.match.equivalentBRL }] : [];

/** Estatísticas por produto e cesta a partir dos itens atuais (é o que muda quando a pessoa troca um item). */
export function recompute(products: Array<{ sources: SourceResult[] }>): { stats: Array<Stats | null>; basket: Basket } {
  const rows = products.map((p) => p.sources.flatMap(priced));
  return { stats: rows.map(computeStats), basket: basketTotals(rows) };
}

export async function compare(
  list: string[],
  sources: PriceSource[],
  opts: { timeoutMs?: number; observer?: Observer; onProgress?: (done: number, total: number) => void } = {},
): Promise<CompareResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let finished = 0;
  const products = await Promise.all(
    list.map(async (query): Promise<ProductResult> => {
      const results = flagOutliers(await Promise.all(sources.map((s) => querySource(query, s, timeoutMs, opts.observer))));
      finished += 1;
      try {
        opts.onProgress?.(finished, list.length);
      } catch {
        // acompanhamento nunca pode derrubar a comparação
      }
      return { query, sources: results, stats: computeStats(results.flatMap(priced)) };
    }),
  );
  const basket = basketTotals(products.map((p) => p.sources.flatMap(priced)));
  return { products, basket };
}
