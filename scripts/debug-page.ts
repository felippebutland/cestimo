/** Depuração: mostra o texto que o navegador enxerga numa URL. Uso: npx tsx scripts/debug-page.ts <url> */
import { closeBrowser, withPage } from '../src/sources/browser.js';

const url = process.argv[2];
if (!url) throw new Error('Informe a URL.');
await withPage(async (page) => {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  console.log('status', res?.status(), '| url final', page.url());
  console.log('produtos (links /produto/):', await page.locator('a[href*="/produto/"]').count());
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\n+/g, ' | '));
});
await closeBrowser();
