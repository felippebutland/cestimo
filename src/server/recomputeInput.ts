import type { Match, SourceResult } from '../domain/compare.js';
import type { SourceStatus } from '../domain/types.js';

const MAX_PRODUCTS = 20;
const MAX_SOURCES = 12;
const MAX_TITLE = 300;
const MAX_NAME = 60;
const STATUSES: readonly SourceStatus[] = ['ok', 'erro', 'indisponivel'];

export type RecomputeInput = { products: Array<{ sources: SourceResult[] }> };
export type ParsedRecompute = { ok: true; products: RecomputeInput['products'] } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000;

/** Copia só os campos usados no cálculo: nada do que o navegador mandar além disso passa adiante. */
function parseMatch(v: unknown): Match | null {
  if (!isObject(v)) return null;
  const { title, priceBRL, equivalentBRL, sizeAdjusted, score, uncertain, chosenByUser } = v;
  if (typeof title !== 'string' || title.length > MAX_TITLE) return null;
  if (!isPrice(priceBRL) || !isPrice(equivalentBRL)) return null;
  if (typeof sizeAdjusted !== 'boolean' || typeof uncertain !== 'boolean') return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (chosenByUser !== undefined && typeof chosenByUser !== 'boolean') return null;
  return { title, priceBRL, equivalentBRL, sizeAdjusted, score, uncertain, ...(chosenByUser ? { chosenByUser } : {}) };
}

function parseSource(v: unknown): SourceResult | null {
  if (!isObject(v)) return null;
  const { source, status, match } = v;
  if (typeof source !== 'string' || source.length === 0 || source.length > MAX_NAME) return null;
  if (typeof status !== 'string' || !STATUSES.includes(status as SourceStatus)) return null;
  if (match === undefined) return { source, status: status as SourceStatus };
  const parsed = parseMatch(match);
  return parsed ? { source, status: status as SourceStatus, match: parsed } : null;
}

export function parseRecomputeBody(body: unknown): ParsedRecompute {
  const bad = (error: string): ParsedRecompute => ({ ok: false, error });
  const products = isObject(body) ? body.products : undefined;
  if (!Array.isArray(products) || products.length === 0) return bad('Envie a lista de produtos com os itens escolhidos.');
  if (products.length > MAX_PRODUCTS) return bad(`No máximo ${MAX_PRODUCTS} produtos por vez.`);
  const parsed: RecomputeInput['products'] = [];
  for (const p of products) {
    const sources = isObject(p) ? p.sources : undefined;
    if (!Array.isArray(sources) || sources.length === 0) return bad('Cada produto precisa de ao menos um mercado.');
    if (sources.length > MAX_SOURCES) return bad(`No máximo ${MAX_SOURCES} mercados por produto.`);
    const rows = sources.map(parseSource);
    if (rows.some((r) => r === null)) return bad('Há um item ou mercado com dados inválidos.');
    parsed.push({ sources: rows as SourceResult[] });
  }
  return { ok: true, products: parsed };
}
