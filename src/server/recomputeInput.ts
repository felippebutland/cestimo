import type { Match, SourceResult } from '../domain/compare.js';
import type { SourceStatus } from '../domain/types.js';

const MAX_PRODUCTS = 20;
const MAX_SOURCES = 12;
const MAX_TITLE = 300;
const MAX_NAME = 60;
const STATUSES: readonly SourceStatus[] = ['ok', 'erro', 'indisponivel'];

const MAX_QUERY = 120;
const UNITS = ['kg', 'L', 'un'] as const;

export type RecomputeInput = { products: Array<{ query?: string; sources: SourceResult[] }> };
export type ParsedRecompute = { ok: true; products: RecomputeInput['products'] } | { ok: false; error: string };
/** `display`: também guarda o que a tela mostra (consulta, link, preço por unidade), para o link compartilhado. */
export type ParseOptions = { display?: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000;

/** Copia só os campos usados no cálculo: nada do que o navegador mandar além disso passa adiante. */
function parseMatch(v: unknown, display: boolean): Match | null {
  if (!isObject(v)) return null;
  const { title, priceBRL, equivalentBRL, sizeAdjusted, score, uncertain, chosenByUser } = v;
  if (typeof title !== 'string' || title.length > MAX_TITLE) return null;
  if (!isPrice(priceBRL) || !isPrice(equivalentBRL)) return null;
  if (typeof sizeAdjusted !== 'boolean' || typeof uncertain !== 'boolean') return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (chosenByUser !== undefined && typeof chosenByUser !== 'boolean') return null;
  const base: Match = { title, priceBRL, equivalentBRL, sizeAdjusted, score, uncertain, ...(chosenByUser ? { chosenByUser } : {}) };
  if (!display) return base;
  const { unitPriceBRL, unit } = v;
  if (unitPriceBRL !== undefined && !isPrice(unitPriceBRL)) return null;
  if (unit !== undefined && !UNITS.includes(unit as (typeof UNITS)[number])) return null;
  return {
    ...base,
    ...(unitPriceBRL !== undefined ? { unitPriceBRL: unitPriceBRL as number } : {}),
    ...(unit !== undefined ? { unit: unit as (typeof UNITS)[number] } : {}),
  };
}

function parseSource(v: unknown, display: boolean): SourceResult | null {
  if (!isObject(v)) return null;
  const { source, status, match } = v;
  if (typeof source !== 'string' || source.length === 0 || source.length > MAX_NAME) return null;
  if (typeof status !== 'string' || !STATUSES.includes(status as SourceStatus)) return null;
  if (match === undefined) return { source, status: status as SourceStatus };
  const parsed = parseMatch(match, display);
  return parsed ? { source, status: status as SourceStatus, match: parsed } : null;
}

export function parseRecomputeBody(body: unknown, opts: ParseOptions = {}): ParsedRecompute {
  const display = opts.display === true;
  const bad = (error: string): ParsedRecompute => ({ ok: false, error });
  const products = isObject(body) ? body.products : undefined;
  if (!Array.isArray(products) || products.length === 0) return bad('Envie a lista de produtos com os itens escolhidos.');
  if (products.length > MAX_PRODUCTS) return bad(`No máximo ${MAX_PRODUCTS} produtos por vez.`);
  const parsed: RecomputeInput['products'] = [];
  for (const p of products) {
    const sources = isObject(p) ? p.sources : undefined;
    if (!Array.isArray(sources) || sources.length === 0) return bad('Cada produto precisa de ao menos um mercado.');
    if (sources.length > MAX_SOURCES) return bad(`No máximo ${MAX_SOURCES} mercados por produto.`);
    const rows = sources.map((src) => parseSource(src, display));
    if (rows.some((r) => r === null)) return bad('Há um item ou mercado com dados inválidos.');
    if (!display) {
      parsed.push({ sources: rows as SourceResult[] });
      continue;
    }
    const query = isObject(p) && typeof p.query === 'string' ? p.query.trim() : '';
    if (query.length === 0 || query.length > MAX_QUERY) return bad('Cada produto precisa de um nome de até 120 caracteres.');
    parsed.push({ query, sources: rows as SourceResult[] });
  }
  return { ok: true, products: parsed };
}
