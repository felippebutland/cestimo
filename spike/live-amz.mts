import { amazonSource } from '../src/sources/amazon.js';
import { closeBrowser } from '../src/sources/browser.js';

try {
  const r = await amazonSource.search('arroz 5kg');
  console.log('Amazon', r.length, r.slice(0, 3).map((o) => `${o.title} R$${o.priceBRL} ${o.url?.slice(0, 50)}`).join(' | '));
} catch (e) {
  console.log('Amazon ERRO', (e as Error).message);
}
await closeBrowser();
