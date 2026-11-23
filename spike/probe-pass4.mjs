import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', locale: 'pt-BR', viewport: { width: 1400, height: 900 } })).newPage();
await p.goto('https://www.passarelaemcasa.com.br/', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
await p.getByText('Retirar na loja', { exact: false }).first().click().catch((e) => console.log('click1', e.message.slice(0, 80)));
await p.waitForTimeout(1500);
console.log('T1', (await p.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, ' | '));
await p.screenshot({ path: 'spike/pass-modal.png' });
await b.close();
