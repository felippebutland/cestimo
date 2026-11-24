import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { extractQuantity } from '../domain/quantity.js';

/**
 * Preço máximo ao consumidor (PMC) da CMED/Anvisa: o teto que a farmácia pode cobrar por cada apresentação de remédio.
 * Os dados vêm da lista oficial (ver scripts/build-cmed.ts), com o PMC de 17% de ICMS, que é o de Santa Catarina.
 */
export type CmedRow = {
  /** Substância(s) ativa(s). */
  s: string;
  /** Nome do produto (marca ou o nome do genérico). */
  p: string;
  /** Apresentação oficial, ex.: "500 MG COM CT BL AL PLAS TRANS X 10". */
  a: string;
  /** Tipo: Referência, Genérico, Similar… */
  t: string;
  /** PMC em reais, ou null quando a apresentação não tem preço máximo. */
  pmc: number | null;
};

/** `generic`: a faixa considera só os genéricos (o teto que interessa a quem compra o mais barato); senão, todas as apresentações. */
export type Ceiling = { minBRL: number; maxBRL: number; n: number; generic: boolean };
type Form = 'comprimido' | 'capsula' | 'gotas' | 'xarope';
export type Presentation = { strengths: string[]; count: number | null; form: Form | null };

const plain = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2');

const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|ui|%)(?![a-z])/g;
const LEADING_GRAMS_RE = /^\s*(\d+(?:\.\d+)?)\s*g(?![a-z])/;
const trim = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/** "500 MG", "1 G" (= 1000mg), "0,5 MG": dosagens como texto normalizado ("500mg"). Grama só conta no começo: no fim é o peso do tubo. */
function strengthsOf(normalized: string): string[] {
  const found = [...normalized.matchAll(STRENGTH_RE)].map((m) => `${trim(Number(m[1]))}${m[2]}`);
  const grams = LEADING_GRAMS_RE.exec(normalized);
  return grams ? [`${trim(Number(grams[1]) * 1000)}mg`, ...found] : found;
}

/** Lê a apresentação oficial: dosagens, quantidade de unidades ("X 10", mas "X 10 ML" é volume) e forma farmacêutica. */
export function parsePresentation(presentation: string): Presentation {
  const n = plain(presentation);
  const counts = [...n.matchAll(/\bx\s*(\d+)(?!\d)(?!\s*(?:ml|g|mg|l)\b)/g)];
  const form: Form | null = /\b(gts|gotas?)\b/.test(n) ? 'gotas' : /\bxpe\b/.test(n) ? 'xarope' : /\bcap\b/.test(n) ? 'capsula' : /\bcom\b/.test(n) ? 'comprimido' : null;
  return { strengths: strengthsOf(n), count: counts.length > 0 ? Number(counts[counts.length - 1]![1]) : null, form };
}

type Entry = { row: CmedRow; words: Set<string>; productWords: Set<string>; multi: boolean; parsed: Presentation };
export type CmedIndex = { entries: Entry[]; listDate: string | null };

const words = (s: string): string[] => plain(s).split(/[^a-z0-9.]+/).filter(Boolean);

/**
 * Embalagem que a farmácia não vende ao consumidor: "(EMB MULT/FRAC)", caixa ("CX") e caixa de papelão com várias
 * cartelas ou frascos ("CT 50 FR", "CT DISP 10 BL"). "CT BL" ou "CT FR" (uma cartela/frasco) é a embalagem comum.
 */
const isClinicPack = (presentation: string): boolean => /\(emb\b|\bcx\b|\bct\s+(?:disp\s+)?(?:[2-9]|\d{2,})\s/i.test(presentation);

export function createCmedIndex(rows: CmedRow[], listDate: string | null = null): CmedIndex {
  return {
    listDate,
    entries: rows
      // embalagem hospitalar/múltipla/fracionável não é a que a farmácia vende ao consumidor
      .filter((r) => typeof r.pmc === 'number' && r.pmc > 0 && !isClinicPack(r.a))
      .map((row) => ({ row, words: new Set(words(`${row.s} ${row.p}`)), productWords: new Set(words(row.p)), multi: row.s.includes(';'), parsed: parsePresentation(row.a) })),
  };
}

const FORM_WORDS: Record<string, Form> = { comprimido: 'comprimido', comprimidos: 'comprimido', comp: 'comprimido', comps: 'comprimido', capsula: 'capsula', capsulas: 'capsula', gotas: 'gotas', gota: 'gotas', xarope: 'xarope' };
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'para', 'a', 'o']);
const NOT_A_NAME = /^\d+(\.\d+)?(mg|mcg|ug|ui|g|ml|l|kg|un|und)?$/;

/**
 * Faixa de preços máximos (do menor, em geral o genérico, ao maior, em geral a marca) das apresentações da lista oficial
 * que batem com o pedido: mesmo nome, dosagem, quantidade e forma. Sem dosagem nem quantidade a faixa seria enganosa: null.
 */
export function findCeiling(index: CmedIndex, query: string): Ceiling | null {
  const q = plain(query);
  const wantStrengths = [...q.matchAll(STRENGTH_RE)].map((m) => `${trim(Number(m[1]))}${m[2]}`);
  const gramsInQuery = [...q.matchAll(/(\d+(?:\.\d+)?)\s*g(?![a-z])/g)].map((m) => `${trim(Number(m[1]) * 1000)}mg`);
  const strengths = [...wantStrengths, ...gramsInQuery];
  const quantity = extractQuantity(q);
  const count = quantity?.dim === 'count' ? quantity.value : null;
  const tokens = words(query);
  const form = tokens.map((t) => FORM_WORDS[t]).find(Boolean) ?? null;
  const name = tokens.filter((t) => !STOP.has(t) && !NOT_A_NAME.test(t) && !(t in FORM_WORDS) && !/^\d+(comprimidos?|capsulas?|comps?|caps)$/.test(t));
  if (name.length === 0 || (strengths.length === 0 && count === null)) return null;

  const matches = index.entries
    .filter(({ row, words: w, productWords, multi, parsed }) =>
      name.every((t) => w.has(t)) &&
      // associação de substâncias só vale quando o pedido é pelo nome do produto (marca)
      (!multi || name.every((t) => productWords.has(t))) &&
      strengths.every((s) => parsed.strengths.includes(s)) &&
      (count === null || parsed.count === count) &&
      (form === null || parsed.form === form) &&
      row.pmc !== null)
    .map(({ row }) => row);
  if (matches.length === 0) return null;
  const generics = matches.filter((r) => /gen[eé]rico/i.test(r.t));
  const used = (generics.length > 0 ? generics : matches).map((r) => r.pmc as number);
  return { minBRL: Math.min(...used), maxBRL: Math.max(...used), n: used.length, generic: generics.length > 0 };
}

/** Lê o arquivo gerado por scripts/build-cmed.ts (JSON comprimido). Sem o arquivo, o recurso simplesmente não aparece. */
export function loadCmedFile(path: string): CmedIndex | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as { listDate?: unknown; rows?: unknown };
    if (!Array.isArray(data.rows)) return null;
    return createCmedIndex(data.rows as CmedRow[], typeof data.listDate === 'string' ? data.listDate : null);
  } catch {
    return null;
  }
}
