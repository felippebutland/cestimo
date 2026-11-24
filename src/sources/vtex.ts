import type { Offer, PriceSource } from '../domain/types.js';
import { withPage } from './browser.js';
import { retryOnTransient } from './retry.js';

type VtexProduct = {
  productName?: unknown;
  priceRange?: { sellingPrice?: { lowPrice?: unknown } } | null;
  items?: Array<{ sellers?: Array<{ commertialOffer?: { AvailableQuantity?: unknown } }> }> | null;
};

/** Sem lista de itens/vendedores, não há como saber o estoque: mantém (a busca já pede só os disponíveis). */
const inStock = (p: VtexProduct): boolean => {
  const offers = (p.items ?? []).flatMap((i) => (i.sellers ?? []).map((s) => s.commertialOffer?.AvailableQuantity));
  return offers.length === 0 || offers.some((q) => typeof q !== 'number' || q > 0);
};

/** Produtos da busca de uma loja VTEX (`product_search` da própria vitrine). Descarta sem estoque, sem nome ou sem preço válido. */
export function parseVtexProducts(payload: unknown, source: string): Offer[] {
  const products = (payload as { products?: unknown } | null | undefined)?.products;
  if (!Array.isArray(products)) return [];
  return (products as VtexProduct[]).flatMap((p) => {
    const title = typeof p?.productName === 'string' ? p.productName.trim() : '';
    const price = p?.priceRange?.sellingPrice?.lowPrice;
    if (!title || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || !inStock(p)) return [];
    return [{ source, title, priceBRL: price }];
  });
}

/** Região (preços e estoque da cidade) que a loja associa a um CEP: `/api/checkout/pub/regions`. null = a loja não atende o CEP. */
export function pickRegionId(regions: unknown): string | null {
  const first = Array.isArray(regions) ? (regions[0] as { id?: unknown } | undefined) : undefined;
  return typeof first?.id === 'string' && first.id.length > 0 ? first.id : null;
}

export function buildSearchPath(query: string, regionId: string | null): string {
  const params = new URLSearchParams({ query, locale: 'pt-BR', count: '24', page: '1', hideUnavailableItems: 'true', simulationBehavior: 'default' });
  if (regionId) params.set('regionId', regionId);
  return `/api/io/_v/api/intelligent-search/product_search/?${params.toString()}`;
}

/** Página mínima da loja, só para as chamadas de busca terem a origem certa (a vitrine inteira é pesada e já derrubou o navegador). */
export const bootstrapUrl = (origin: string): string => `${origin}/robots.txt`;

/** O Chromium caiu no meio da busca (memória): vale tentar de novo uma vez. */
export const isTransientBrowserError = (e: unknown): boolean => e instanceof Error && /Target (crashed|closed)|has been closed/i.test(e.message);

export type VtexConfig = { name: string; origin: string; postalCode: string };

/**
 * Loja na plataforma VTEX (Pague Menos, São João, Catarinense…). Abre a vitrine e chama, de dentro dela, a busca pública
 * que a própria página usa, com a região do CEP configurado (preço e estoque de Chapecó).
 */
export function createVtexSource(cfg: VtexConfig): PriceSource {
  let region: string | undefined;
  return {
    name: cfg.name,
    search: (query) =>
      retryOnTransient(() => withPage(async (page) => {
        await page.goto(bootstrapUrl(cfg.origin), { waitUntil: 'domcontentloaded' });
        if (region === undefined) {
          const regions = await page.evaluate(async (cep) => {
            const r = await fetch(`/api/checkout/pub/regions?country=BRA&postalCode=${cep}`);
            return r.ok ? r.json() : null;
          }, cfg.postalCode);
          const id = pickRegionId(regions);
          if (id === null) throw new Error(`a loja não atende o CEP ${cfg.postalCode}`);
          region = id;
        }
        const res = await page.evaluate(async (path) => {
          const r = await fetch(path);
          return { status: r.status, body: await r.json().catch(() => null) };
        }, buildSearchPath(query, region));
        if (res.status !== 200 || !Array.isArray((res.body as { products?: unknown } | null)?.products)) {
          throw new Error(`o site respondeu ${res.status} sem a lista de produtos`);
        }
        return parseVtexProducts(res.body, cfg.name);
      }), { isTransient: isTransientBrowserError, delayMs: 1000 }),
  };
}
