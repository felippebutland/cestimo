import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36', locale: 'pt-BR', viewport: { width: 1400, height: 900 } })).newPage();
await p.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => [...document.querySelectorAll('input')].map((i) => `${i.id}|${i.type}|${i.placeholder}|${i.offsetParent ? 'vis' : 'hid'}`).join('\n')));
console.log((await p.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n+/g, ' | '));
await b.close();
