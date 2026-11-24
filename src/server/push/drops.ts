export const DROP_THRESHOLD = 0.05;

export type DropDecision =
  | { action: 'seed'; ref: number }
  | { action: 'keep'; ref: number | undefined }
  | { action: 'follow'; ref: number }
  | { action: 'notify'; ref: number; pct: number };

const valid = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Compara o menor preço de hoje com a referência guardada.
 *  - sem referência: guarda e não avisa (primeira vez que o produto é visto)
 *  - caiu `threshold` ou mais: avisa e o preço de hoje vira a referência
 *  - subiu: a referência acompanha (queda só conta a partir do preço mais alto recente)
 *  - caiu pouco: mantém a referência, então quedas pequenas seguidas somam até chegar ao limite
 */
export function evaluateDrop(ref: number | undefined, current: number, threshold = DROP_THRESHOLD): DropDecision {
  if (!valid(current)) return { action: 'keep', ref };
  if (!valid(ref)) return { action: 'seed', ref: current };
  if (current <= ref * (1 - threshold) + 1e-9) return { action: 'notify', ref: current, pct: Math.round((1 - current / ref) * 100) };
  if (current > ref) return { action: 'follow', ref: current };
  return { action: 'keep', ref };
}

const brl = (n: number): string => `R$ ${n.toFixed(2).replace('.', ',')}`;

export function dropMessage(d: { query: string; source: string; priceBRL: number; previousBRL: number; pct: number }): { title: string; body: string } {
  return { title: `Baixou ${d.pct}%: ${d.query}`, body: `${brl(d.priceBRL)} no ${d.source} (antes ${brl(d.previousBRL)})` };
}
