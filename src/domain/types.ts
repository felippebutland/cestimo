export type Offer = { source: string; title: string; priceBRL: number; url?: string };
export type SourceStatus = 'ok' | 'erro' | 'indisponivel';
export interface PriceSource {
  readonly name: string;
  search(query: string): Promise<Offer[]>;
}

/** Lançado por um adaptador quando a fonte bloqueia (CAPTCHA, 403). Vira status "indisponivel". */
export class BlockedError extends Error {}
