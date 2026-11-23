import { chromium } from 'playwright';

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 900 } });
for (const [name, url] of [
  ['ML', 'https://lista.mercadolivre.com.br/arroz-5kg'],
  ['AMZ', 'https://www.amazon.com.br/s?k=arroz+5kg'],
]) {
  const p = await ctx.newPage();
  const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => ({ status: () => e.message }));
  await p.waitForTimeout(3000);
  const title = await p.title();
  const body = (await p.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, ' | ');
  console.log(`## ${name} status=${r.status?.()} title=${title}\n${body}\n`);
  await p.screenshot({ path: `spike/${name}.png` });
}
await b.close();
