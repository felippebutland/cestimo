import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', locale: 'pt-BR', viewport: { width: 1400, height: 900 } })).newPage();
p.on('request', (r) => { if (/vipcommerce/.test(r.url()) && /centro_distribuicao|filial/.test(r.url())) console.log('REQ', r.url().replace('https://services.vipcommerce.com.br/api-admin/v1', '').slice(0, 140)); });
await p.goto('https://www.passarelaemcasa.com.br/', { waitUntil: 'networkidle' });
console.log('--- abrir seletor');
await p.getByText('Retirar na loja', { exact: false }).first().click();
await p.waitForTimeout(800);
console.log('--- escolher Chapecó');
await p.getByText('Passarela - Chapecó', { exact: true }).first().click();
await p.waitForTimeout(2500);
console.log('LS', await p.evaluate(() => `${localStorage.getItem('cdSelecionado')} ${localStorage.getItem('formaEntregaSelecionada')}`));
console.log('HEADER', (await p.evaluate(() => document.body.innerText)).slice(0, 120).replace(/\n+/g, ' | '));
await b.close();
