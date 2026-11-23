import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({userAgent:'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36'})).newPage();
p.on('request', r => { if (/graphql/.test(r.url())) { const d = r.postData()||''; const op = d.match(/"operationName":"(\w+)"/)?.[1]; if (!/GetAllStores|Ecommerce|Featured|Dynamic/.test(op||'')) console.log('REQ', op, d.slice(0,1800).replace(/\s+/g,' ')); }});
p.on('response', async r => { if (/graphql/.test(r.url())) { const op=(r.request().postData()||'').match(/"operationName":"(\w+)"/)?.[1]; if (/earch|roduct|Catalog/i.test(op||'')) console.log('RES', op, (await r.text()).slice(0,900)); }});
await p.goto(url,{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log(e.message)); await p.waitForTimeout(2500);
console.log('TEXT', (await p.evaluate(()=>document.body.innerText)).slice(0,600).replace(/\n+/g,' | '));
await b.close();
