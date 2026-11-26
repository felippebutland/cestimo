import { existsSync, readFileSync } from 'node:fs';
import { looksLikeProduct } from '../../domain/looksLikeProduct.js';
import { productKey } from '../history.js';

/** Teto da lista base: cada produto vira uma consulta em todas as lojas, toda noite. */
export const MAX_SEED = 400;
const MAX_TEXT = 120;

/** Valida o conteúdo de config/seed-products.json: `{ "products": ["Arroz 5kg", ...] }`. Tira repetidos (ignora caixa e acento). */
export function parseSeedList(raw: unknown): string[] {
  const products = typeof raw === 'object' && raw !== null ? (raw as { products?: unknown }).products : undefined;
  if (!Array.isArray(products)) throw new Error('seed-products.json: precisa ser um objeto com a lista "products".');
  const clean = products.map((item, i) => {
    const text = typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > MAX_TEXT || !looksLikeProduct(text)) throw new Error(`seed-products.json: item ${i + 1} não é um nome de produto válido.`);
    return text;
  });
  const seen = new Set<string>();
  const unique = clean.filter((text) => {
    const key = productKey(text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length > MAX_SEED) throw new Error(`seed-products.json: no máximo ${MAX_SEED} produtos (tem ${unique.length}).`);
  return unique;
}

/** Lê a lista base. Arquivo ausente = lista vazia (a coleta noturna fica desligada). */
export function readSeedList(path: string): string[] {
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path}: JSON inválido.`);
  }
  return parseSeedList(raw);
}
