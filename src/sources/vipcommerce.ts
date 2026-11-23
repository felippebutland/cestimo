import type { Offer, PriceSource } from '../domain/types.js';
import { withPage } from './browser.js';

type Produto = {
  descricao?: unknown;
  preco?: unknown;
  disponivel?: unknown;
  em_oferta?: unknown;
  oferta?: { preco_oferta?: unknown } | null;
  link?: unknown;
};

const toPrice = (v: unknown): number => (typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN);

export function parseVipProducts(payload: unknown, source: string, origin: string): Offer[] {
  const produtos = (payload as { data?: { produtos?: unknown } } | null)?.data?.produtos;
  if (!Array.isArray(produtos)) return [];
  return (produtos as Produto[]).flatMap((p) => {
    if (typeof p.descricao !== 'string' || p.disponivel === false) return [];
    const offerPrice = p.em_oferta === true ? toPrice(p.oferta?.preco_oferta) : Number.NaN;
    const priceBRL = Number.isFinite(offerPrice) && offerPrice > 0 ? offerPrice : toPrice(p.preco);
    if (!Number.isFinite(priceBRL) || priceBRL <= 0) return [];
    const url = typeof p.link === 'string' ? `${origin}/produto/${p.link}` : undefined;
    return [{ source, title: p.descricao, priceBRL, url }];
  });
}

export type VipConfig = { name: string; origin: string; branchName: string; distributionCenterId: string };

export const PASSARELA: VipConfig = {
  name: 'Passarela',
  origin: 'https://www.passarelaemcasa.com.br',
  branchName: 'Passarela - Chapecó',
  distributionCenterId: '8',
};

const SEARCH_RE = /buscas\/produtos\/termo\/[^/?]+\?/;

export function createVipSource(cfg: VipConfig): PriceSource {
  return {
    name: cfg.name,
    search: (query) =>
      withPage(async (page) => {
        await page.goto(cfg.origin, { waitUntil: 'domcontentloaded' });
        await page.getByText('Retirar na loja', { exact: false }).first().click({ timeout: 15_000 });
        await page.getByText(cfg.branchName, { exact: true }).first().click({ timeout: 15_000 });
        const input = page.locator('input[placeholder="O que você precisa?"]:visible').first();
        const [res] = await Promise.all([
          page.waitForResponse((r) => SEARCH_RE.test(r.url()), { timeout: 20_000 }),
          input.fill(query).then(() => input.press('Enter')),
        ]);
        if (!res.url().includes(`centro_distribuicao/${cfg.distributionCenterId}/`)) {
          throw new Error(`loja errada: esperado centro ${cfg.distributionCenterId}`);
        }
        return parseVipProducts(await res.json(), cfg.name, cfg.origin);
      }),
  };
}
