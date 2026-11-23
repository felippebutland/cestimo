import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({userAgent:'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36'})).newPage();
p.on('response', async r => { if (/retiradas$/.test(r.url())) { const j=JSON.parse(await r.text()); console.log('RETIRADAS', JSON.stringify((j.data||[]).map(x=>[x.nome, x.endereco?.cidade]))); } });
await p.goto('https://www.passarelaemcasa.com.br/',{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log(e.message));
await b.close();
