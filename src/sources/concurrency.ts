import type { PriceSource } from '../domain/types.js';
import { createLimiter } from './limiter.js';

/**
 * Limita quantas buscas ficam abertas ao mesmo tempo em UMA loja. Com muitos itens na lista, isso impede que
 * um site seja atingido por dezenas de pedidos de uma vez (e protege os que ficam lentos ou lotados).
 */
export function withConcurrency(source: PriceSource, max: number): PriceSource {
  const run = createLimiter(Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1);
  return { name: source.name, search: (query) => run(() => source.search(query)) };
}
