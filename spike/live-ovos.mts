import { pickBest, scoreMatch, searchTerm } from '../src/domain/match.js';
import { amazonSource } from '../src/sources/amazon.js';
import { closeBrowser } from '../src/sources/browser.js';
import { BRASAO, createMercafacilSource, UNICOOPER } from '../src/sources/mercafacil.js';
import { COMPER, createOsuperSource, ROYAL } from '../src/sources/osuper.js';
import { createVipSource, PASSARELA } from '../src/sources/vipcommerce.js';

const sources = [
  createOsuperSource(COMPER), createOsuperSource(ROYAL), createMercafacilSource(BRASAO),
  createMercafacilSource(UNICOOPER), createVipSource(PASSARELA), amazonSource,
];
const terms = (process.argv[2] ?? 'ovos').split('|');
const asked = process.argv[3] ?? 'Bandeja de ovos';
for (const term of terms) {
  console.log(`\n===== busca "${term}" (pedido: "${asked}")`);
  for (const s of sources) {
    try {
      const offers = await s.search(searchTerm(term));
      const top = offers.slice(0, 4).map((o) => `${o.title} R$${o.priceBRL} [${scoreMatch(asked, o.title).toFixed(2)}]`);
      const pick = pickBest(asked, offers);
      console.log(`${s.name.padEnd(10)} ${String(offers.length).padStart(3)} itens | match: ${pick ? pick.offer.title : 'NENHUM'}\n             ${top.join('\n             ')}`);
    } catch (e) {
      console.log(`${s.name.padEnd(10)} ERRO ${(e as Error).message}`);
    }
  }
}
await closeBrowser();
