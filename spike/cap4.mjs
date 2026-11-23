import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({userAgent:'Mozilla/5.0 (Macintosh) Chrome/150 Safari/537.36',viewport:{width:1400,height:900}})).newPage();
await p.goto('https://www.brasao.com.br/avenida',{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log(e.message));
console.log((await p.evaluate(()=>document.body.innerText)).slice(0,700).replace(/\n+/g,' | '));
console.log(await p.evaluate(()=>[...document.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(h=>h&&/avenida|produto|busca|search|departamento/.test(h)).slice(0,25).join('\n')));
console.log('INPUTS', await p.evaluate(()=>[...document.querySelectorAll('input')].map(i=>i.type+'|'+i.placeholder).join(' ; ')));
await b.close();
