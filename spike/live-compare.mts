import { compare } from '../src/domain/compare.js';
import { amazonSource } from '../src/sources/amazon.js';
import { closeBrowser } from '../src/sources/browser.js';
import { BRASAO, createMercafacilSource, UNICOOPER } from '../src/sources/mercafacil.js';
import { COMPER, createOsuperSource, ROYAL } from '../src/sources/osuper.js';
import { createVipSource, PASSARELA } from '../src/sources/vipcommerce.js';

const sources = [
  createOsuperSource(COMPER), createOsuperSource(ROYAL), createMercafacilSource(BRASAO),
  createMercafacilSource(UNICOOPER), createVipSource(PASSARELA), amazonSource,
];
const t = Date.now();
const r = await compare(['Bandeja de ovos 30un', 'Ovos 20un'], sources);
for (const p of r.products) {
  console.log(`\n## ${p.query}  stats=${p.stats ? `min ${p.stats.cheapest.source} R$${p.stats.cheapest.priceBRL} média ${p.stats.averageBRL.toFixed(2)} dif ${p.stats.diffPct.toFixed(0)}%` : 'null'}`);
  for (const s of p.sources) {
    console.log(`  ${s.source.padEnd(14)} ${s.status.padEnd(12)} ${s.match ? `R$${s.match.priceBRL} ${s.match.uncertain ? '[incerto] ' : ''}${s.match.sizeAdjusted ? '[ajustado R$' + s.match.equivalentBRL.toFixed(2) + '] ' : ''}${s.match.title}` : s.reason ?? '-'}`);
  }
}
console.log('\nCESTA', JSON.stringify({ totals: Object.fromEntries(r.basket.totals), coverage: Object.fromEntries(r.basket.coverage), cheapest: r.basket.cheapestSource }));
console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`);
await closeBrowser();
