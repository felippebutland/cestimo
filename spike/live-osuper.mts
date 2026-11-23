import { createOsuperSource, COMPER, ROYAL } from '../src/sources/osuper.js';
import { closeBrowser } from '../src/sources/browser.js';

for (const cfg of [COMPER, ROYAL]) {
  const r = await createOsuperSource(cfg).search('arroz 5kg');
  console.log(cfg.name, r.length, r.slice(0, 3).map((o) => `${o.title} R$${o.priceBRL}`).join(' | '));
}
await closeBrowser();
