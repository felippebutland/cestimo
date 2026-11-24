import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from 'playwright';
import { withTimeout } from '../domain/timeout.js';
import { createLimiter } from './limiter.js';

export const USER_AGENT = 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36';
/** Páginas do Chromium abertas ao mesmo tempo (BROWSER_PAGES). Mais páginas = busca mais rápida, mas mais memória e CPU. */
const MAX_PAGES = Math.max(1, Math.floor(Number(process.env.BROWSER_PAGES)) || 3);
/** Tempo máximo de uma busca depois de obter a vaga; ao estourar o contexto é fechado (cancela o trabalho). */
const PAGE_TIMEOUT_MS = 45_000;

const run = createLimiter(MAX_PAGES);
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    // Em container (rodando como root) o Chromium precisa de --no-sandbox; o isolamento é o do próprio container.
    .launch({ args: process.env.PLAYWRIGHT_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] })
    .then((b) => {
      b.on('disconnected', () => {
        browserPromise = null;
      });
      return b;
    })
    .catch((e: unknown) => {
      browserPromise = null;
      throw e;
    });
  return browserPromise;
}

/** Executa `fn` em uma página nova de contexto isolado, com concorrência e tempo limitados. */
export function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { cookies?: Cookie[] } = {},
): Promise<T> {
  return run(async () => {
    const ctx = await (await getBrowser()).newContext({
      userAgent: USER_AGENT,
      locale: 'pt-BR',
      viewport: { width: 1400, height: 900 },
    });
    try {
      if (opts.cookies?.length) await ctx.addCookies(opts.cookies);
      return await withTimeout(fn(await ctx.newPage(), ctx), PAGE_TIMEOUT_MS);
    } finally {
      await ctx.close().catch(() => undefined);
    }
  });
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close();
}
