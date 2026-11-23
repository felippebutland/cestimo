import type { Cookie } from 'playwright';
import { extractQuantity } from '../domain/quantity.js';
import type { Offer, PriceSource } from '../domain/types.js';
import { withPage } from './browser.js';

type Hit = {
  name?: unknown;
  content?: unknown;
  contentUnit?: unknown;
  slug?: unknown;
  pricing?: { price?: unknown; promotion?: unknown; promotionalPrice?: unknown };
};

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

function toOffer(hit: Hit, source: string, origin?: string): Offer | null {
  if (typeof hit.name !== 'string') return null;
  const p = hit.pricing;
  const price = p?.promotion === true ? asNumber(p.promotionalPrice) : asNumber(p?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const hasContent = typeof hit.content === 'number' && typeof hit.contentUnit === 'string';
  const title = !extractQuantity(hit.name) && hasContent ? `${hit.name} ${hit.content}${hit.contentUnit}` : hit.name;
  const url = origin && typeof hit.slug === 'string' ? `${origin}/produto/${hit.slug}` : undefined;
  return { source, title, priceBRL: price, url };
}

export function parseOsuperHits(json: unknown, source: string, origin?: string): Offer[] {
  const hits = (json as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((h) => {
    const o = toOffer(h as Hit, source, origin);
    return o ? [o] : [];
  });
}

export type OsuperConfig = { name: string; origin: string; tenant: string; storeId: string; storeCookie?: boolean };

export const COMPER: OsuperConfig = {
  name: 'Comper', origin: 'https://www.comper.com.br', tenant: '335', storeId: '1803', storeCookie: true,
};
export const ROYAL: OsuperConfig = {
  name: 'Royal', origin: 'https://www.superroyal.com.br', tenant: '8', storeId: '18',
};

function storeCookie(cfg: OsuperConfig): Cookie[] {
  if (!cfg.storeCookie) return [];
  const domain = `.${new URL(cfg.origin).hostname.replace(/^www\./, '')}`;
  const value = encodeURIComponent(JSON.stringify({ id: cfg.storeId, userSelected: true }));
  return [{ name: `st_${cfg.tenant}`, value, domain, path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }];
}

export function createOsuperSource(cfg: OsuperConfig): PriceSource {
  const searchUrl = new RegExp(`sense\\.osuper\\.com\\.br/${cfg.tenant}/${cfg.storeId}/v2/search`);
  return {
    name: cfg.name,
    search: (query) =>
      withPage(
        async (page) => {
          const [response] = await Promise.all([
            page.waitForResponse((r) => searchUrl.test(r.url()), { timeout: 20_000 }),
            page.goto(`${cfg.origin}/busca/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' }),
          ]);
          return parseOsuperHits(await response.json(), cfg.name, cfg.origin);
        },
        { cookies: storeCookie(cfg) },
      ),
  };
}
