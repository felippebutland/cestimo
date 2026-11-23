import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', locale: 'pt-BR' })).newPage();
p.on('response', async (r) => { if (/retiradas$/.test(r.url())) { const j = JSON.parse(await r.text()); const c = j.data.find((x) => /Chapec/.test(x.nome)); console.log('CHAPECO', JSON.stringify(c).slice(0, 700)); console.log('KEYS', Object.keys(j.data[0]).join(',')); } });
await p.goto('https://www.passarelaemcasa.com.br/', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
const ls = await p.evaluate(() => Object.entries(localStorage).map(([k, v]) => k + '=' + v.slice(0, 160)));
console.log('LS', ls.join('\n'));
console.log('COOKIES', (await p.context().cookies()).map((c) => c.name).join(','));
await b.close();
