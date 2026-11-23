// Spike descartável: captura chamadas GraphQL/JSON de uma busca.
// uso: node capture.mjs <url> <storeId|-> [cookieName]
import { chromium } from 'playwright';
const [url, storeId, cookieName] = process.argv.slice(2);
const host = new URL(url).hostname;
const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36' });
if (storeId && storeId !== '-' && cookieName)
  await ctx.addCookies([{ name: cookieName, value: encodeURIComponent(JSON.stringify({ id: storeId, userSelected: true })), domain: host.replace(/^www/, ''), path: '/' }]);
const p = await ctx.newPage();
p.on('response', async (r) => {
  const ct = r.headers()['content-type'] || '';
  if (!/json/.test(ct)) return;
  const req = r.request();
  let body = '';
  try { body = (await r.text()).slice(0, 400); } catch {}
  const post = (req.postData() || '').slice(0, 250).replace(/\s+/g, ' ');
  console.log(`${req.method()} ${r.status()} ${r.url().slice(0, 140)}\n  REQ ${post}\n  RES ${body.replace(/\s+/g, ' ')}\n`);
});
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log('goto', e.message));
await p.waitForTimeout(2500);
console.log('TEXT:', (await p.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\n+/g, ' | '));
await b.close();
