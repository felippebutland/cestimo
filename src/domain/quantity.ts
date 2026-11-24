export type Quantity = { value: number; dim: 'mass' | 'volume' | 'count' };

const UNITS: Record<string, { dim: Quantity['dim']; factor: number }> = {
  kg: { dim: 'mass', factor: 1000 },
  g: { dim: 'mass', factor: 1 },
  gr: { dim: 'mass', factor: 1 },
  grs: { dim: 'mass', factor: 1 },
  l: { dim: 'volume', factor: 1000 },
  lt: { dim: 'volume', factor: 1000 },
  lts: { dim: 'volume', factor: 1000 },
  litro: { dim: 'volume', factor: 1000 },
  litros: { dim: 'volume', factor: 1000 },
  ml: { dim: 'volume', factor: 1 },
  un: { dim: 'count', factor: 1 },
  und: { dim: 'count', factor: 1 },
  unid: { dim: 'count', factor: 1 },
  unidade: { dim: 'count', factor: 1 },
  unidades: { dim: 'count', factor: 1 },
};

/** "5kg", "500 g", "12un", "30 unidades". */
const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(kg|ml|lts|lt|litros|litro|unidades|unidade|unid|und|un|grs|gr|g|l)\b/i;
/** Contagem sem unidade: "C/30", "c20", "com 30" (exceto quando o número é seguido de kg/g/ml/l). */
const COUNT_PREFIX_RE = /(?:\bc\/\s*|\bc(?=\d)|\bcom\s+)(\d+)\b(?![.,]?\d*\s*(?:kg|ml|lt|g|l)\b)/i;

/**
 * Contagem de remédio e afins: "20 comprimidos", "28 cápsulas", "10 ampolas", "15 sachês".
 * Vale mais que gramas ou mililitros do mesmo texto, que costumam ser a dosagem ("1g") ou o tamanho da ampola ("5ml").
 */
export const PHARMA_COUNT_WORDS = 'comprimidos?|comps?|cps|cp|c[aá]psulas?|caps|dr[aá]geas?|sach[eê]s?|ampolas?|pastilhas?|tiras?|doses?|adesivos?|supositorios?|supositórios?';
const PHARMA_COUNT_RE = new RegExp(`(\\d+)\\s*(?:${PHARMA_COUNT_WORDS})(?![a-zà-ú])`, 'i');

/** Primeira quantidade do texto (a que aparece primeiro), em g, ml ou unidades. */
export function extractQuantity(text: string): Quantity | null {
  const pharma = PHARMA_COUNT_RE.exec(text);
  if (pharma) return { value: Number(pharma[1]), dim: 'count' };
  const unit = UNIT_RE.exec(text);
  const count = COUNT_PREFIX_RE.exec(text);
  if (count && (!unit || count.index < unit.index)) return { value: Number(count[1]), dim: 'count' };
  if (!unit) return null;
  const u = UNITS[unit[2]!.toLowerCase()];
  if (!u) return null;
  return { value: Number(unit[1]!.replace(',', '.')) * u.factor, dim: u.dim };
}

/** R$ por kg, L ou unidade. */
export function unitPrice(priceBRL: number, q: Quantity): number {
  const base = q.dim === 'count' ? q.value : q.value / 1000;
  return priceBRL / base;
}

export const unitLabel = (dim: Quantity['dim']): 'kg' | 'L' | 'un' =>
  dim === 'mass' ? 'kg' : dim === 'volume' ? 'L' : 'un';

/** Preço equivalente de `from` para a quantidade `to` (mesma dimensão), proporcional à quantidade. */
export const scaleToQuantity = (priceBRL: number, from: Quantity, to: Quantity): number =>
  (priceBRL * to.value) / from.value;
