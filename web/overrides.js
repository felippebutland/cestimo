/**
 * Troca do item escolhido em um mercado. Tudo puro e imutável: devolve dados novos.
 * `choice`: posição na lista de alternativas, `null` ("nenhum destes") ou 'suggested' (voltar ao sugerido).
 */

const CHOSEN_FIELDS = ['title', 'priceBRL', 'equivalentBRL', 'sizeAdjusted', 'score', 'uncertain', 'chosenByUser'];

/**
 * @param {{ products: any[] }} data
 * @param {number} productIndex
 * @param {string} sourceName
 * @param {number | null | 'suggested'} choice
 */
export function applyChoice(data, productIndex, sourceName, choice) {
  const product = data.products[productIndex];
  const sourceIndex = product ? product.sources.findIndex((s) => s.source === sourceName) : -1;
  if (!product || sourceIndex < 0) return data;
  const source = product.sources[sourceIndex];
  const alternatives = source.alternatives ?? [];

  /** @type {any} */
  let next;
  if (choice === 'suggested') {
    if (!source.suggested) return data;
    const { suggested, ...rest } = source;
    const rejected = source.match ? [source.match, ...alternatives] : alternatives;
    next = { ...rest, match: suggested, alternatives: rejected };
  } else if (choice === null) {
    const { match, ...rest } = source;
    next = { ...rest, ...(match ? { alternatives: [match, ...alternatives] } : {}), ...(source.suggested || !match || match.chosenByUser ? {} : { suggested: match }) };
  } else {
    const picked = alternatives[choice];
    if (!picked) return data;
    const remaining = alternatives.filter((_, i) => i !== choice);
    const suggested = source.suggested ?? (source.match && !source.match.chosenByUser ? source.match : undefined);
    next = {
      ...source,
      match: { ...picked, uncertain: false, chosenByUser: true },
      alternatives: source.match ? [source.match, ...remaining] : remaining,
      ...(suggested ? { suggested } : {}),
    };
  }
  const sources = product.sources.map((s, i) => (i === sourceIndex ? next : s));
  return { ...data, products: data.products.map((p, i) => (i === productIndex ? { ...product, sources } : p)) };
}

/** O que o servidor precisa para recalcular: nada de links, alternativas ou textos extras. */
export function toRecomputeBody(data) {
  return {
    products: data.products.map((p) => ({
      query: p.query,
      sources: p.sources.map((s) => ({
        source: s.source,
        status: s.status,
        ...(s.match ? { match: Object.fromEntries(CHOSEN_FIELDS.filter((k) => s.match[k] !== undefined).map((k) => [k, s.match[k]])) } : {}),
      })),
    })),
  };
}

/** Aplica estatísticas e cesta recalculadas; resposta incompatível é ignorada. */
export function mergeRecomputed(data, result) {
  if (!result || !Array.isArray(result.stats) || result.stats.length !== data.products.length) return data;
  return { ...data, products: data.products.map((p, i) => ({ ...p, stats: result.stats[i] })), basket: result.basket };
}
