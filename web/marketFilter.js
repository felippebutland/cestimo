/** Filtro por mercado na comparação: `null` = todos; um nome = só esse mercado. */

/** Mantém o mercado escolhido só se ele ainda existe (uma nova consulta pode ter outra lista de mercados). */
export const normalizeMarket = (names, market) => (market !== null && names.includes(market) ? market : null);

/** Mercados que aparecem na tabela/cartões. */
export const visibleMarkets = (names, market) => (normalizeMarket(names, market) === null ? names : [market]);
