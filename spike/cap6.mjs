import { chromium } from 'playwright';
const [url, term] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({userAgent:'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36',viewport:{width:1400,height:900}})).newPage();
p.on('response', async r => { const u=r.url(); if (/centros_distribuicoes\/1$/.test(u)) { const j=JSON.parse(await r.text()); console.log('CD', JSON.stringify(j.data.endereco)); }
  if (/produtos\/(busca|pesquisa)|\/busca|search|termo/i.test(u) && /vipcommerce/.test(u)) console.log('SEARCH', r.status(), u.slice(0,220), (await r.text()).slice(0,500).replace(/\s+/g,' ')); });
await p.goto(url,{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log(e.message));
if (term) { const inp=p.locator('input[type=search], input[placeholder*="usc" i], input[placeholder*="roduto" i]').locator('visible=true').first(); await inp.fill(term).catch(e=>console.log('nofill')); await inp.press('Enter').catch(()=>{}); await p.waitForTimeout(5000); }
console.log('URL', p.url()); console.log('TEXT', (await p.evaluate(()=>document.body.innerText)).slice(0,700).replace(/\n+/g,' | '));
console.log('LINKS', (await p.evaluate(()=>[...document.querySelectorAll('a')].map(a=>a.href).filter(h=>/play\.google|apps\.apple|loja|delivery|compra|app/i.test(h)).slice(0,10))).join(' '));
await b.close();
