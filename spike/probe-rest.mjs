import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36';
const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 1400, height: 900 } });

// Comper com cookie da loja
{
  await ctx.addCookies([{ name: 'st_335', value: encodeURIComponent(JSON.stringify({ id: '1803', userSelected: true })), domain: '.comper.com.br', path: '/' }]);
  const p = await ctx.newPage(); let saved = false;
  p.on('response', async (r) => { if (!saved && /sense\.osuper\.com\.br\/335\/\d+\/v2\/search/.test(r.url())) { saved = true; writeFileSync('fixtures/comper.json', await r.text()); console.log('COMPER', r.url().slice(0, 110)); } });
  await p.goto('https://www.comper.com.br/busca/arroz%205kg', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
  await p.waitForTimeout(1500); console.log('COMPER saved', saved); await p.close();
}
// Brasão: DOM dos cards
{
  const p = await ctx.newPage();
  await p.goto('https://www.brasao.com.br/avenida/busca?q=arroz%205kg', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
  await p.waitForTimeout(2000);
  writeFileSync('fixtures/brasao.html', await p.content());
  const cards = await p.evaluate(() => {
    const priced = [...document.querySelectorAll('*')].filter((e) => e.children.length < 6 && /R\$\s*\d/.test(e.textContent || '') && (e.textContent || '').length < 200);
    return priced.slice(0, 4).map((e) => ({ tag: e.tagName, cls: e.className?.toString().slice(0, 60), text: e.textContent?.replace(/\s+/g, ' ').trim() }));
  });
  console.log('BRASAO', JSON.stringify(cards));
  await p.close();
}
// Passarela: loja + busca
{
  const p = await ctx.newPage();
  p.on('response', async (r) => { if (/vipcommerce/.test(r.url()) && /busca|pesquisa|produtos\/(?!disponiveis)/i.test(r.url())) console.log('VIP', r.status(), r.url().slice(0, 200)); });
  await p.goto('https://www.passarelaemcasa.com.br/', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
  console.log('PASS inputs', await p.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.placeholder).join(' ; ')));
  console.log('PASS text', (await p.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n+/g, ' | '));
  await p.close();
}
await b.close();
