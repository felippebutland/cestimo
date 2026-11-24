import { retryOnTransient } from './retry.js';
import type { Offer, PriceSource } from '../domain/types.js';
import { withPage } from './browser.js';

export type Card = { href: string; text: string };

const PRICE_RE = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
const NO_RESULTS_RE = /nenhum|0 resultado|n[ãa]o encontr/i;
const PREFIX_RE = /^(?:Clube)?(?:\+\d+)*\s*Add\s*/i;

const toNumber = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));

export function parseMercafacilCards(cards: Card[], source: string, origin: string): Offer[] {
  return cards.flatMap((c) => {
    const priceMatch = PRICE_RE.exec(c.text);
    if (!priceMatch) return [];
    const title = c.text.slice(0, priceMatch.index).replace(PREFIX_RE, '').trim();
    const priceBRL = toNumber(priceMatch[1]!);
    if (!title || !Number.isFinite(priceBRL) || priceBRL <= 0) return [];
    return [{ source, title, priceBRL }];
  });
}

/** Mensagem de erro de uma resposta GraphQL (o site mostra "Nenhum resultado" mesmo quando o backend dele cai). */
export function graphqlErrorMessage(payload: unknown): string | null {
  const errors = (payload as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  const first = errors[0] as { message?: unknown } | undefined;
  return typeof first?.message === 'string' ? first.message : null;
}

/** O site (banco de dados lotado, 502/503/504, tempo esgotado) disse que o problema é momentâneo. */
export const isTransientSiteError = (e: unknown): boolean =>
  e instanceof Error && e.message.startsWith('o site informou erro:') && /too many clients|status code 50[234]|timeout|temporar|try again/i.test(e.message);

export type MercafacilConfig = { name: string; origin: string; basePath: string };

export const BRASAO: MercafacilConfig = { name: 'Brasão', origin: 'https://www.brasao.com.br', basePath: '/avenida' };
export const UNICOOPER: MercafacilConfig = {
  name: 'Unicooper', origin: 'https://www.unicoopersupermercados.com.br', basePath: '/loja',
};

export function createMercafacilSource(cfg: MercafacilConfig): PriceSource {
  return {
    name: cfg.name,
    search: (query) =>
      retryOnTransient(() => withPage(async (page) => {
        let apiError: string | null = null;
        page.on('response', (r) => {
          if (!r.url().includes('graphql')) return;
          r.json().then((body) => { apiError ??= graphqlErrorMessage(body); }, () => undefined);
        });
        await page.goto(`${cfg.origin}${cfg.basePath}/busca?q=${encodeURIComponent(query)}`, {
          waitUntil: 'domcontentloaded',
        });
        const rendered = await page.waitForSelector('a[href*="/produto/"]', { timeout: 15_000 }).then(() => true, () => false);
        if (!rendered) {
          if (apiError) throw new Error(`o site informou erro: ${apiError}`);
          const text = await page.evaluate(() => document.body.innerText);
          if (!NO_RESULTS_RE.test(text)) throw new Error('a página não renderizou os resultados');
          return [];
        }
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/produto/"]')]
            .map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent ?? '' }))
            .filter((c) => c.text.includes('R$')),
        );
        return parseMercafacilCards(cards, cfg.name, cfg.origin);
      }), { isTransient: isTransientSiteError }),
  };
}
