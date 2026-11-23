import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('fixtures', { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 900 } });
const term = 'arroz 5kg';

// Amazon: HTML da busca
{
  const p = await ctx.newPage();
  await p.goto('https://www.amazon.com.br/s?k=arroz+5kg', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  writeFileSync('fixtures/amazon.html', await p.content());
  const items = await p.evaluate(() =>
    [...document.querySelectorAll('[data-component-type="s-search-result"]')].slice(0, 4).map((e) => ({
      title: e.querySelector('h2')?.textContent?.trim(),
      price: e.querySelector('.a-price .a-offscreen')?.textContent,
    })),
  );
  console.log('AMAZON', JSON.stringify(items));
  await p.close();
}

// Royal (osuper): captura JSON do sense
for (const [name, origin, tenant, storeId] of [['royal', 'https://www.superroyal.com.br', '8', '18']]) {
  const p = await ctx.newPage();
  await ctx.addCookies([{ name: `st_${tenant}`, value: encodeURIComponent(JSON.stringify({ id: storeId, userSelected: true })), domain: new URL(origin).hostname.replace(/^www/, ''), path: '/' }]);
  let saved = false;
  p.on('response', async (r) => {
    if (!saved && /sense\.osuper\.com\.br\/\d+\/\d+\/v2\/search/.test(r.url())) {
      saved = true;
      const t = await r.text();
      writeFileSync(`fixtures/${name}.json`, t);
      const j = JSON.parse(t);
      console.log(name.toUpperCase(), r.url().slice(0, 120), 'HITKEYS', Object.keys(j.hits?.[0] ?? {}).join(','));
      console.log(name.toUpperCase(), 'SAMPLE', JSON.stringify(j.hits?.[0]).slice(0, 700));
    }
  });
  await p.goto(`${origin}/busca/${encodeURIComponent(term)}`, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
  await p.waitForTimeout(1500);
  console.log(name.toUpperCase(), 'saved=', saved);
  await p.close();
}
await b.close();
