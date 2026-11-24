import type { CmedRow } from './cmed.js';

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Textos compartilhados da planilha (xl/sharedStrings.xml): as células de texto guardam só o número do texto. */
export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1]!)).join(''),
  );
}

/** "37,02" e "1.234,50" (formato brasileiro) viram número; vazio, "-" ou texto = null. */
export function parsePriceBR(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d[\d.]*(,\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

type Cols = { s: string; p: string; a: string; t: string; pmc: string };
const HEADERS = { s: 'SUBSTÂNCIA', p: 'PRODUTO', a: 'APRESENTAÇÃO', t: 'TIPO DE PRODUTO (STATUS DO PRODUTO)', pmc: 'PMC 17 %' } as const;

/**
 * Lê a planilha da CMED em pedaços (o XML tem dezenas de MB) e devolve as linhas já no formato do app.
 * As colunas são achadas pelo nome do cabeçalho: se a Anvisa mudar a ordem, continua certo; se mudar o nome, avisa.
 */
export function createSheetReader(strings: string[]) {
  let rest = '';
  let cols: Cols | null = null;

  const cellsOf = (rowXml: string): Map<string, string> => {
    const cells = new Map<string, string>();
    for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
      if (v === undefined) continue;
      cells.set(c[1]!, /\bt="s"/.test(c[2]!) ? strings[Number(v)] ?? '' : decode(v));
    }
    return cells;
  };

  const findCols = (cells: Map<string, string>): Cols | null => {
    const byName = new Map([...cells].map(([col, text]) => [text.trim(), col]));
    const found = Object.fromEntries(Object.entries(HEADERS).map(([key, name]) => [key, byName.get(name)]));
    if (!found.s || !found.p) return null; // ainda não é a linha do cabeçalho
    const missing = Object.entries(HEADERS).filter(([key]) => !found[key]).map(([, name]) => `"${name}"`);
    if (missing.length > 0) throw new Error(`Cabeçalho da planilha sem a(s) coluna(s) ${missing.join(', ')}: a Anvisa mudou o formato.`);
    return found as Cols;
  };

  return {
    push(chunk: string): CmedRow[] {
      rest += chunk;
      const out: CmedRow[] = [];
      let from = 0;
      for (const m of rest.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        from = m.index! + m[0].length;
        const cells = cellsOf(m[1]!);
        if (!cols) { cols = findCols(cells); continue; }
        const s = (cells.get(cols.s) ?? '').trim();
        const p = (cells.get(cols.p) ?? '').trim();
        if (!s && !p) continue;
        out.push({ s, p, a: (cells.get(cols.a) ?? '').trim(), t: (cells.get(cols.t) ?? '').trim(), pmc: parsePriceBR(cells.get(cols.pmc)) });
      }
      rest = rest.slice(from);
      return out;
    },
  };
}

/** Endereço da lista PMC (xlsx) na página oficial de preços da CMED, e a data que vem no nome do arquivo. */
export function findListUrl(html: string, pageUrl: string): { url: string; listDate: string | null } | null {
  const m = /href="([^"]*lista_pmc_(\d{4})(\d{2})(\d{2})[^"]*\.xlsx[^"]*)"/i.exec(html);
  if (!m) return null;
  return { url: new URL(m[1]!, pageUrl).toString(), listDate: `${m[2]}-${m[3]}-${m[4]}` };
}
