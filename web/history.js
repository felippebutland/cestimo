/**
 * Memória da última consulta, guardada só no navegador: a lista e o menor preço de cada produto.
 * Tudo puro; quem lê e grava no localStorage é o app.js.
 */

const MAX_LIST_CHARS = 5000;

/** Chave estável de um produto: sem caixa, acentos nem espaços repetidos. */
export const normalizeKey = (query) =>
  query.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** @param {{ products: any[] }} data */
export function snapshot(data, now = new Date()) {
  const prices = Object.fromEntries(
    data.products.flatMap((p) => (p.stats ? [[normalizeKey(p.query), { priceBRL: p.stats.cheapest.priceBRL, source: p.stats.cheapest.source }]] : [])),
  );
  return { at: now.toISOString(), prices };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Variação do menor preço de cada produto desde a consulta anterior (mesma ordem de `data.products`).
 * null quando não há como comparar (sem consulta anterior, produto novo ou sem resultado agora).
 */
export function variations(previous, data) {
  return data.products.map((p) => {
    const before = previous?.prices[normalizeKey(p.query)];
    if (!before || !p.stats) return null;
    const deltaBRL = round2(p.stats.cheapest.priceBRL - before.priceBRL);
    return {
      direction: deltaBRL > 0 ? 'up' : deltaBRL < 0 ? 'down' : 'same',
      deltaBRL,
      pct: round2((deltaBRL / before.priceBRL) * 100),
      previousBRL: before.priceBRL,
    };
  });
}

const isPriceEntry = (v) => v && typeof v === 'object' && Number.isFinite(v.priceBRL) && v.priceBRL > 0 && typeof v.source === 'string';

/** Lê o que está no localStorage sem confiar nele: qualquer coisa fora do formato vira null. */
export function parseSaved(raw) {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object' || typeof v.list !== 'string' || v.list.length > MAX_LIST_CHARS) return null;
    if (v.snapshot === undefined) return { list: v.list };
    const s = v.snapshot;
    const valid = s && typeof s.at === 'string' && s.prices && typeof s.prices === 'object' && Object.values(s.prices).every(isPriceEntry);
    return valid ? { list: v.list, snapshot: { at: s.at, prices: s.prices } } : null;
  } catch {
    return null;
  }
}

export const formatDay = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
