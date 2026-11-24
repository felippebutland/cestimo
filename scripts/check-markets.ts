/**
 * Testa cada mercado do arquivo de configuração com uma busca real e mostra o que veio.
 * Uso: npm run markets:check [-- <termo> [<arquivo>]]
 * Ex.:  npm run markets:check -- "leite 1L"
 */
import { fileURLToPath } from 'node:url';
import { closeBrowser } from '../src/sources/browser.js';
import { buildPharmacySources, buildSources, readMarketsFile } from '../src/server/markets.js';

// Mercados usam o termo informado (ou "arroz 5kg"); farmácias usam o segundo termo (ou "dipirona 500mg").
const term = process.argv[2] ?? 'arroz 5kg';
const pharmacyTerm = process.argv[4] ?? 'dipirona 500mg';
const path = process.argv[3] ?? process.env.MARKETS_FILE ?? fileURLToPath(new URL('../config/markets.json', import.meta.url));

const markets = readMarketsFile(path);
console.log(`Cidade: ${markets.city} · busca de teste: "${term}" (mercados) e "${pharmacyTerm}" (farmácias)\n`);

let problems = 0;
const targets = [
  ...buildSources(markets).map((source) => ({ source, term })),
  ...buildPharmacySources(markets).map((source) => ({ source, term: pharmacyTerm })),
];
for (const { source, term } of targets) {
  const started = Date.now();
  try {
    const offers = await source.search(term);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (offers.length === 0) {
      problems++;
      console.log(`⚠️  ${source.name.padEnd(14)} 0 itens (${secs}s). Confira a loja/IDs no config/markets.json.`);
      continue;
    }
    console.log(`✅ ${source.name.padEnd(14)} ${String(offers.length).padStart(3)} itens (${secs}s)`);
    for (const o of offers.slice(0, 3)) console.log(`     ${o.title}  R$ ${o.priceBRL.toFixed(2)}`);
  } catch (e) {
    problems++;
    console.log(`❌ ${source.name.padEnd(14)} ${(e as Error).message}`);
  }
}
await closeBrowser();
console.log(problems === 0 ? '\nTudo certo.' : `\n${problems} mercado(s) com problema.`);
process.exit(problems === 0 ? 0 : 1);
