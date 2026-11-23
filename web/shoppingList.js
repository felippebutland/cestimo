import { formatBRL } from './format.js';

/**
 * @typedef {{ query: string, title: string, priceBRL: number, sizeAdjusted: boolean, url?: string }} ListItem
 * @typedef {{ source: string, items: ListItem[], subtotalBRL: number }} Store
 * @typedef {{ stores: Store[], missing: string[], totalBRL: number }} ShoppingList
 * @typedef {{ source: string, totalBRL: number, covered: number }} RankRow
 * @typedef {{ source: string, totalBRL: number, realBRL: number, adjusted: number, covered: number, findable: number, complete: boolean }} StoreOption
 * @typedef {ShoppingList & { equivalentBRL: number, complete: boolean, ranking: RankRow[], options: StoreOption[], recommended: string | null }} SingleStoreList
 */

/**
 * Monta a lista de compras: cada produto vai para o mercado mais barato dele.
 * Produtos sem preço confiável ficam em `missing`.
 */
/**
 * @param {{ products: any[] }} data
 * @returns {ShoppingList}
 */
export function buildShoppingList(data) {
  /** @type {Map<string, ListItem[]>} */
  const groups = new Map();
  /** @type {string[]} */
  const missing = [];
  for (const p of data.products) {
    const cheapest = p.stats?.cheapest.source;
    const m = cheapest ? p.sources.find((s) => s.source === cheapest)?.match : undefined;
    if (!m) {
      missing.push(p.query);
      continue;
    }
    const item = { query: p.query, title: m.title, priceBRL: m.priceBRL, sizeAdjusted: m.sizeAdjusted, url: m.url };
    groups.set(cheapest, [...(groups.get(cheapest) ?? []), item]);
  }
  const stores = [...groups]
    .map(([source, items]) => ({ source, items, subtotalBRL: items.reduce((sum, i) => sum + i.priceBRL, 0) }))
    .sort((a, b) => b.items.length - a.items.length);
  return { stores, missing, totalBRL: stores.reduce((sum, s) => sum + s.subtotalBRL, 0) };
}

/**
 * Lista de um mercado só. Sem `chosen`, usa o mais barato entre os que têm todos os itens encontráveis
 * (produto que nenhum mercado tem vai para `missing`); sem mercado completo, o de maior cobertura.
 * Com `chosen`, mostra aquele mercado. Compara pelo preço equivalente ao tamanho pedido; mostra o preço real.
 * `options` traz todos os mercados com seus totais, para um seletor.
 * @param {{ products: any[] }} data
 * @param {string} [chosen] mercado escolhido pelo usuário
 * @returns {SingleStoreList}
 */
export function buildSingleStoreList(data, chosen) {
  /** @type {Map<string, Map<string, any>>} fonte -> (consulta -> match confiável) */
  const bySource = new Map();
  const available = new Set();
  for (const p of data.products) {
    for (const s of p.sources) {
      if (!s.match || s.match.uncertain) continue;
      available.add(p.query);
      bySource.set(s.source, (bySource.get(s.source) ?? new Map()).set(p.query, s.match));
    }
  }
  const findable = data.products.filter((p) => available.has(p.query));
  const rows = [...bySource].map(([source, matches]) => {
    const found = findable.filter((p) => matches.has(p.query));
    return {
      source,
      matches,
      covered: found.length,
      equivalentBRL: found.reduce((sum, p) => sum + matches.get(p.query).equivalentBRL, 0),
      realBRL: found.reduce((sum, p) => sum + matches.get(p.query).priceBRL, 0),
      adjusted: found.filter((p) => matches.get(p.query).sizeAdjusted).length,
    };
  });
  const isComplete = (r) => r.covered === findable.length;
  const cheaperFirst = (a, b) => a.equivalentBRL - b.equivalentBRL;
  const ordered = [...rows.filter(isComplete).sort(cheaperFirst), ...rows.filter((r) => !isComplete(r)).sort((a, b) => b.covered - a.covered || cheaperFirst(a, b))];
  const recommended = ordered[0];
  const options = ordered.map((r) => ({
    source: r.source, totalBRL: r.equivalentBRL, realBRL: r.realBRL, adjusted: r.adjusted,
    covered: r.covered, findable: findable.length, complete: isComplete(r),
  }));
  if (!recommended) return { stores: [], missing: data.products.map((p) => p.query), totalBRL: 0, equivalentBRL: 0, complete: false, ranking: [], options, recommended: null };

  const pick = ordered.find((r) => r.source === chosen) ?? recommended;
  const items = findable.flatMap((p) => {
    const m = pick.matches.get(p.query);
    return m ? [{ query: p.query, title: m.title, priceBRL: m.priceBRL, sizeAdjusted: m.sizeAdjusted, url: m.url }] : [];
  });
  const taken = new Set(items.map((i) => i.query));
  return {
    stores: [{ source: pick.source, items, subtotalBRL: pick.realBRL }],
    missing: data.products.filter((p) => !taken.has(p.query)).map((p) => p.query),
    totalBRL: pick.realBRL,
    equivalentBRL: pick.equivalentBRL,
    complete: isComplete(pick),
    ranking: ordered.filter(isComplete).map((r) => ({ source: r.source, totalBRL: r.equivalentBRL, covered: r.covered })),
    options,
    recommended: recommended.source,
  };
}

/**
 * Texto pronto para colar no WhatsApp ou nas notas.
 * @param {ShoppingList} list
 * @returns {string}
 */
export function toText(list) {
  if (list.stores.length === 0 && list.missing.length === 0) return 'Lista de compras\n\nNenhum item.';
  const blocks = list.stores.map((s) => {
    const lines = s.items.map((i) => {
      const note = i.sizeAdjusted ? ' (tamanho diferente do pedido)' : '';
      return `• ${i.query}: ${i.title} — ${formatBRL(i.priceBRL)}${note}`;
    });
    return [`*${s.source}* (${formatBRL(s.subtotalBRL)})`, ...lines].join('\n');
  });
  const tail = [`Total: ${formatBRL(list.totalBRL)}`];
  if (list.missing.length > 0) tail.push(`Não encontrados: ${list.missing.join(', ')}`);
  return ['🛒 Lista de compras', ...blocks, tail.join('\n')].join('\n\n');
}
