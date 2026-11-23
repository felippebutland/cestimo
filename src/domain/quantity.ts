export type Quantity = { value: number; dim: 'mass' | 'volume' | 'count' };

const UNITS: Record<string, { dim: Quantity['dim']; factor: number }> = {
  kg: { dim: 'mass', factor: 1000 },
  g: { dim: 'mass', factor: 1 },
  l: { dim: 'volume', factor: 1000 },
  lt: { dim: 'volume', factor: 1000 },
  ml: { dim: 'volume', factor: 1 },
  un: { dim: 'count', factor: 1 },
  und: { dim: 'count', factor: 1 },
  unid: { dim: 'count', factor: 1 },
  unidade: { dim: 'count', factor: 1 },
  unidades: { dim: 'count', factor: 1 },
};

/** "5kg", "500 g", "12un", "30 unidades". */
const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(kg|ml|lt|unidades|unidade|unid|und|un|g|l)\b/i;
/** Contagem sem unidade: "C/30", "c20", "com 30" (exceto quando o número é seguido de kg/g/ml/l). */
const COUNT_PREFIX_RE = /(?:\bc\/\s*|\bc(?=\d)|\bcom\s+)(\d+)\b(?![.,]?\d*\s*(?:kg|ml|lt|g|l)\b)/i;

/** Primeira quantidade do texto (a que aparece primeiro), em g, ml ou unidades. */
export function extractQuantity(text: string): Quantity | null {
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
