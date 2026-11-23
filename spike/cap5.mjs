import { chromium } from 'playwright';
const [url, city] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', viewport: { width: 1400, height: 900 } })).newPage();
p.on('response', async (r) => {
  const d = r.request().postData() || '';
  if (/SearchActiveStores/.test(d)) {
    const t = await r.text();
    console.log('STORES', t.slice(0, 1500));
  }
});
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
const inp = p.locator('input[placeholder*="cidade" i]:visible').first();
await inp.fill(city);
await p.waitForTimeout(3000);
await b.close();
