import { createMercafacilSource, BRASAO, UNICOOPER } from '../src/sources/mercafacil.js';
import { closeBrowser } from '../src/sources/browser.js';

for (const cfg of [BRASAO, UNICOOPER]) {
  try {
    const r = await createMercafacilSource(cfg).search('arroz 5kg');
    console.log(cfg.name, r.length, r.slice(0, 3).map((o) => `${o.title} R$${o.priceBRL}`).join(' | '));
  } catch (e) {
    console.log(cfg.name, 'ERRO', (e as Error).message);
  }
}
await closeBrowser();
