import { BlockedError, type PriceSource } from '../domain/types.js';

/** Fonte que não pode ser consultada (bloqueio do site). Aparece como "indisponível" no resultado. */
export const blockedSource = (name: string, reason: string): PriceSource => ({
  name,
  search: async () => {
    throw new BlockedError(`${name}: ${reason}`);
  },
});
