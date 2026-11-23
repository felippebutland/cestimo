/** Link compartilhado: o que enviar ao servidor e como montar/ler o endereço (`#r=<id>`). */

const FIELDS = ['title', 'priceBRL', 'equivalentBRL', 'sizeAdjusted', 'score', 'uncertain', 'unitPriceBRL', 'unit', 'url', 'chosenByUser'];
const HASH_FORMAT = /^#r=([A-Za-z0-9_-]{12,64})$/;

const pickMatch = (m) => Object.fromEntries(FIELDS.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));

/** Só o que a tela mostra: sem alternativas, motivos nem estatísticas (o servidor recalcula as contas). */
export function toShareBody(data) {
  return {
    products: data.products.map((p) => ({
      query: p.query,
      sources: p.sources.map((s) => ({ source: s.source, status: s.status, ...(s.match ? { match: pickMatch(s.match) } : {}) })),
    })),
  };
}

export const shareUrl = (origin, id) => `${origin}/#r=${id}`;

/** Id de um link compartilhado vindo do `location.hash`, ou null. */
export const parseShareHash = (hash) => HASH_FORMAT.exec(hash)?.[1] ?? null;
