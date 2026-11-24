/** Teto oficial (CMED/Anvisa) mostrado sob o nome do remédio, nas farmácias. */

const valid = (c) => c && Number.isFinite(c.minBRL) && Number.isFinite(c.maxBRL);

/** "Teto oficial (CMED): R$ 15,06 a R$ 22,79", ou "até R$ x" quando é um valor só. `brl` formata em reais. */
export function cmedText(c, brl) {
  if (!valid(c)) return null;
  const label = c.generic ? 'Teto oficial do genérico (CMED)' : 'Teto oficial (CMED)';
  return c.minBRL === c.maxBRL ? `${label}: até ${brl(c.minBRL)}` : `${label}: ${brl(c.minBRL)} a ${brl(c.maxBRL)}`;
}

/** Texto de ajuda (ao passar o mouse ou manter o dedo): o que o número significa e de quando é a lista. */
export function cmedTitle(c) {
  const when = typeof c.listDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.listDate) ? ` (lista de ${c.listDate.split('-').reverse().join('/')})` : '';
  const n = c.n === 1 ? '1 apresentação' : `${c.n} apresentações`;
  return `Preço máximo ao consumidor definido pela CMED/Anvisa${when}, com ICMS de 17% (Santa Catarina). A farmácia não pode cobrar mais que isso. Faixa de ${n} do mesmo remédio${c.generic ? ' (só genéricos)' : ''}.`;
}
