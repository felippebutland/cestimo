import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', locale: 'pt-BR', viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
let saved = false;
p.on('response', async (r) => {
  if (/sense\.osuper\.com\.br\/\d+\/\d+\/v2\/search/.test(r.url()) && !saved) {
    saved = true; const t = await r.text(); writeFileSync('fixtures/royal.json', t);
    const j = JSON.parse(t); console.log('SENSE', r.url().slice(0, 150)); console.log('KEYS', Object.keys(j.hits?.[0] ?? {}).join(',')); console.log('SAMPLE', JSON.stringify(j.hits?.[0]).slice(0, 900));
  }
});
await p.goto('https://www.superroyal.com.br/busca/arroz%205kg', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
console.log('URL', p.url(), 'saved', saved);
console.log((await p.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\n+/g, ' | '));
await b.close();
