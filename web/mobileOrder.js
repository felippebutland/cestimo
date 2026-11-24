/**
 * No celular cada produto vira um cartão com um mercado por linha. Esta função diz em que posição cada mercado
 * aparece (0 = primeiro): confiáveis do mais barato ao mais caro, depois os incertos, depois os sem preço.
 * @param {Array<{ match: { equivalentBRL: number, uncertain: boolean } | null }>} sources
 * @returns {number[]} posição de cada mercado, na ordem original
 */
export function rankSources(sources) {
  const group = (s) => (!s.match ? 2 : s.match.uncertain ? 1 : 0);
  const sorted = sources
    .map((s, i) => ({ i, g: group(s), p: s.match ? s.match.equivalentBRL : 0 }))
    .sort((a, b) => a.g - b.g || a.p - b.p || a.i - b.i);
  const rank = new Array(sources.length);
  sorted.forEach((x, pos) => { rank[x.i] = pos; });
  return rank;
}

/**
 * Mesma ideia para o total da cesta: o mercado destacado (`best`) primeiro, os outros do menor para o maior total,
 * quem não tem total por último. Devolve a posição de cada mercado, na ordem original de `names`.
 * @param {string[]} names
 * @param {Record<string, number>} totals
 * @param {string | undefined} best
 * @returns {number[]}
 */
export function rankTotals(names, totals, best) {
  const key = (n) => (n === best ? -Infinity : totals[n] ?? Infinity);
  const sorted = names.map((n, i) => ({ i, k: key(n) })).sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1));
  const rank = new Array(names.length);
  sorted.forEach((x, pos) => { rank[x.i] = pos; });
  return rank;
}
