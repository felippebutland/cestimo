import { BlockedError, type Offer, type PriceSource } from '../domain/types.js';
import { withPage } from './browser.js';

const ORIGIN = 'https://www.amazon.com.br';
const PRICE_RE = /(\d{1,3}(?:\.\d{3})*,\d{2})/;

export type AmazonItem = { title?: string; price?: string; href?: string };

export function parseAmazonItems(items: AmazonItem[], source: string): Offer[] {
  return items.flatMap((i) => {
    const m = i.price ? PRICE_RE.exec(i.price) : null;
    if (!i.title || !m) return [];
    const priceBRL = Number(m[1]!.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(priceBRL) || priceBRL <= 0) return [];
    return [{ source, title: i.title, priceBRL }];
  });
}

export const isAmazonBlocked = (text: string): boolean => /captcha|digite os caracteres/i.test(text);

export const amazonSource: PriceSource = {
  name: 'Amazon',
  search: (query) =>
    withPage(async (page) => {
      await page.goto(`${ORIGIN}/s?k=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
      const rendered = await page
        .waitForSelector('[data-component-type="s-search-result"], form[action*="validateCaptcha"]', { timeout: 15_000 })
        .then(() => true, () => false);
      if (isAmazonBlocked(await page.evaluate(() => document.body.innerText))) throw new BlockedError('Amazon pediu CAPTCHA');
      if (!rendered) throw new Error('a página não renderizou os resultados');
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('[data-component-type="s-search-result"]')].map((e) => ({
          title: e.querySelector('h2')?.textContent?.trim(),
          price: e.querySelector('.a-price .a-offscreen')?.textContent ?? undefined,
          href: e.querySelector('a[href*="/dp/"]')?.getAttribute('href')?.split('?')[0] ?? undefined,
        })),
      );
      return parseAmazonItems(items, 'Amazon');
    }),
};
