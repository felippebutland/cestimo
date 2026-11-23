import { extractQuantity } from './quantity.js';
import type { Offer } from './types.js';

/** Abaixo disto o item não é considerado o mesmo produto. */
export const MATCH_THRESHOLD = 0.6;
/** Entre MATCH_THRESHOLD e este valor o match é "incerto": aparece, mas não entra em média nem cesta. */
export const CERTAIN_THRESHOLD = 0.85;

/** Palavras que mudam o produto: se estão no título e não na consulta, pesam mais. */
const VARIANT_WORDS = new Set([
  'organico', 'organica', 'integral', 'parboilizado', 'parbolizado', 'desnatado', 'semidesnatado', 'zero',
  'lactose', 'light', 'diet', 'sem', 'vegano', 'vegana', 'artesanal', 'premium', 'infantil', 'baby', 'pet',
  'gourmet', 'importado', 'congelado', 'codorna', 'caipira', 'porta', 'organizador', 'suporte',
  'carnaroli', 'arboreo', 'basmati', 'jasmim', 'sushi', 'risoto',
]);
const NEUTRAL_WORDS = new Set([
  'tipo', 'de', 'da', 'do', 'com', 'em', 'uht', 'longa', 'vida', 'bandeja', 'bdj', 'estojo', 'cartela', 'pacote',
  'grande', 'grandes', 'extra', 'unidade', 'unidades', 'unid', 'un', 'und',
]);
/** Palavras da consulta que não precisam aparecer no título (ligação e embalagem). */
const QUERY_IGNORED = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'bandeja', 'bdj', 'cartela', 'estojo']);
const VARIANT_FACTOR = 0.7;
const OTHER_EXTRA_FACTOR = 0.95;
const MAX_OTHER_EXTRAS = 4;

const MULTIPACK_RE = /\b\d+\s*x\s*\d|\bfardo\b|\bkit\b|\bcaixa\b/;
const COUNT_PACK_RE = /\bc\/\s*\d+/;

/** "12x1L", fardo, kit; e "C/12" só é fardo quando o item também tem litros/gramas ("1L C/12"). */
const isMultipack = (normalized: string): boolean => {
  const q = extractQuantity(normalized);
  return MULTIPACK_RE.test(normalized) || (COUNT_PACK_RE.test(normalized) && q !== null && q.dim !== 'count');
};

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s+(kg|g|ml|lt|l|un|und)\b/g, '$1$2');

const tokens = (s: string): Set<string> => new Set(normalize(s).split(/[^a-z0-9.]+/).filter(Boolean));

/** Termos que a consulta exige no título: sem palavras de ligação/embalagem (a menos que sobre nada). */
function queryTerms(query: string): Set<string> {
  const all = tokens(query);
  const kept = [...all].filter((tok) => !QUERY_IGNORED.has(tok));
  return kept.length > 0 ? new Set(kept) : all;
}

/** Consulta enviada às fontes: sem palavras de ligação/embalagem, que atrapalham a busca nos sites. */
export function searchTerm(query: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !QUERY_IGNORED.has(normalize(w)) && !COUNT_TOKEN_RE.test(normalize(w)));
  return kept.length > 0 ? kept.join(' ') : query;
}

/** Fração dos termos pedidos presentes no título, penalizada por tamanho divergente/ausente, extras e embalagem múltipla. */
export function scoreMatch(query: string, title: string): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const t = tokens(title);
  const nq = normalize(query);
  const nt = normalize(title);
  const qq = extractQuantity(nq);
  const tq = extractQuantity(nt);
  const sizeUncertain = qq !== null && (tq === null || tq.dim !== qq.dim || tq.value !== qq.value);
  const multipack = isMultipack(nt) && !isMultipack(nq);
  return termRecall(queryTerms(query), t) * extrasFactor(q, t) * (sizeUncertain ? 0.5 : 1) * (multipack ? 0.5 : 1);
}

/** Contagem de unidades ("30un"): os buscadores das lojas não a entendem. */
const COUNT_TOKEN_RE = /^\d+(un|und|unid|unidades?)$/;
const SIZE_TOKEN_RE = /^\d+(\.\d+)?(kg|g|ml|lt|l|un|und)$/;

const isNeutral = (tok: string): boolean =>
  tok.length <= 1 || /^\d+$/.test(tok) || /^tp?\d$/.test(tok) || SIZE_TOKEN_RE.test(tok) || NEUTRAL_WORDS.has(tok);

/** Penalidade por termos do título ausentes da consulta: variantes pesam mais que marca/outras palavras. */
function extrasFactor(q: Set<string>, t: Set<string>): number {
  const extras = [...t].filter((tok) => !q.has(tok) && !isNeutral(tok));
  const variants = extras.filter((tok) => VARIANT_WORDS.has(tok)).length;
  const others = Math.min(extras.length - variants, MAX_OTHER_EXTRAS);
  return VARIANT_FACTOR ** variants * OTHER_EXTRA_FACTOR ** others;
}

type Scored = { offer: Offer; score: number; words: number; rank: number };
export type Pick = { offer: Offer; score: number; sizeAdjusted: boolean };


/** Fração dos termos pedidos (sem o tamanho) presentes no título. */
function termRecall(q: Set<string>, t: Set<string>): number {
  const terms = [...q].filter((tok) => !SIZE_TOKEN_RE.test(tok));
  return terms.length === 0 ? 0 : terms.filter((tok) => t.has(tok)).length / terms.length;
}

const better = (a: Scored, b: Scored): boolean =>
  a.score !== b.score ? a.score > b.score : a.words !== b.words ? a.words < b.words : a.rank < b.rank;

const best = (items: Scored[]): Scored | null =>
  items.reduce<Scored | null>((acc, cur) => (acc === null || better(cur, acc) ? cur : acc), null);

/** Candidato do mesmo produto em outro tamanho (mesma dimensão), para comparar pelo preço equivalente. */
function sizeAdjustedCandidate(query: string, offer: Offer): Scored | null {
  const nq = normalize(query);
  const nt = normalize(offer.title);
  const qq = extractQuantity(nq);
  const tq = extractQuantity(nt);
  if (!qq || !tq || qq.dim !== tq.dim || qq.value === tq.value) return null;
  if (isMultipack(nt) && !isMultipack(nq)) return null;
  const q = tokens(query);
  const t = tokens(offer.title);
  const score = termRecall(queryTerms(query), t) * extrasFactor(q, t);
  if (score < CERTAIN_THRESHOLD) return null;
  return { offer, score, words: tokens(offer.title).size, rank: offer.priceBRL * (qq.value / tq.value) };
}

export function pickBest(query: string, offers: Offer[]): Pick | null {
  const exact = best(
    offers.map((offer): Scored => ({ offer, score: scoreMatch(query, offer.title), words: tokens(offer.title).size, rank: offer.priceBRL })),
  );
  if (exact && exact.score >= MATCH_THRESHOLD) return { offer: exact.offer, score: exact.score, sizeAdjusted: false };
  const adjusted = best(offers.flatMap((o) => sizeAdjustedCandidate(query, o) ?? []));
  return adjusted ? { offer: adjusted.offer, score: adjusted.score, sizeAdjusted: true } : null;
}
