import { createVipSource, PASSARELA } from '../src/sources/vipcommerce.js';
import { closeBrowser } from '../src/sources/browser.js';

try {
  const r = await createVipSource(PASSARELA).search('arroz 5kg');
  console.log(PASSARELA.name, r.length, r.slice(0, 3).map((o) => `${o.title} R$${o.priceBRL}`).join(' | '));
} catch (e) {
  console.log('ERRO', (e as Error).message);
}
await closeBrowser();
