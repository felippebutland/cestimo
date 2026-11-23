/**
 * Gera os ícones PNG e o favicon.ico a partir de web/favicon.svg.
 * Uso: npx tsx scripts/build-icons.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const web = new URL('../web/', import.meta.url);
const svg = readFileSync(new URL('favicon.svg', web), 'utf8');

/** Versão sem cantos arredondados (o iOS aplica a própria máscara) e com tema claro fixo. */
const fullBleed = svg.replace(/rx="14"/, 'rx="0"').replace(/@media[\s\S]*?\}\s*\}/, '');

const browser = await chromium.launch();
const render = async (source: string, size: number, transparent: boolean): Promise<Buffer> => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  const png = await page.screenshot({ omitBackground: transparent, type: 'png' });
  await page.close();
  return png;
};

const png16 = await render(svg, 16, true);
const png32 = await render(svg, 32, true);
const png48 = await render(svg, 48, true);
writeFileSync(new URL('icon-192.png', web), await render(svg, 192, true));
writeFileSync(new URL('icon-512.png', web), await render(svg, 512, true));
writeFileSync(new URL('apple-touch-icon.png', web), await render(fullBleed, 180, false));
await browser.close();

/** favicon.ico com PNGs embutidos (16, 32 e 48 px). */
const images = [[16, png16], [32, png32], [48, png48]] as const;
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(([size, data]) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0);
  e.writeUInt8(size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
writeFileSync(new URL('favicon.ico', web), Buffer.concat([header, ...entries, ...images.map(([, d]) => d)]));
console.log('Ícones gerados em web/: favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png');
