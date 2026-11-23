/** Tendência de preço dos últimos dias de um produto (série vinda de /api/history). Tudo puro. */

const round2 = (n) => Math.round(n * 100) / 100;

/** Resumo para mostrar sob o produto; null enquanto houver menos de 2 dias de dados. */
export function summarize(points) {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.cheapestBRL);
  const minBRL = Math.min(...prices);
  const lastBRL = prices[prices.length - 1];
  return {
    minBRL,
    maxBRL: Math.max(...prices),
    lastBRL,
    days: points.length,
    atMin: lastBRL <= minBRL,
    aboveMinPct: round2(((lastBRL - minBRL) / minBRL) * 100),
  };
}

/** Caminho SVG do mini-gráfico: o mais barato fica embaixo. null sem 2 pontos. */
export function sparklinePath(points, width, height, pad = 2) {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.cheapestBRL);
  const min = Math.min(...prices);
  const range = Math.max(...prices) - min;
  const step = (width - 2 * pad) / (points.length - 1);
  return prices
    .map((price, i) => {
      const y = range === 0 ? height / 2 : pad + ((Math.max(...prices) - price) / range) * (height - 2 * pad);
      return `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}
