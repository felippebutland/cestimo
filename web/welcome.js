/** Boas-vindas da primeira visita e resumo de quem é comparado (para a seção "Como funciona"). */

export const WELCOME_KEY = 'cestimo:bemvindo';

export const shouldWelcome = (stored) => stored !== '1';

/** [{ label, names }] por categoria que tem lojas. */
export const sourcesSummary = (categories) => categories.filter((c) => c.sources.length > 0).map((c) => ({ label: c.label, names: c.sources.join(', ') }));
