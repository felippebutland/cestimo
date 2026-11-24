/**
 * Gera config/cmed-pmc.json.gz a partir da lista oficial de preços máximos ao consumidor (PMC) da CMED/Anvisa.
 * A lista muda uma vez por mês: rode este script de vez em quando e faça o commit do arquivo gerado.
 *
 * Uso:
 *   npm run cmed:build                      baixa a lista mais recente da página oficial (≈13 MB)
 *   npm run cmed:build -- caminho/lista.xlsx  usa um arquivo que você já baixou
 *
 * Precisa do comando `unzip` (já vem no macOS e na maioria dos Linux). O PMC usado é o de 17% de ICMS (Santa Catarina).
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { CmedRow } from '../src/server/cmed.js';
import { createSheetReader, findListUrl, parseSharedStrings } from '../src/server/cmedSheet.js';

const PAGE = 'https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos';
const OUT = fileURLToPath(new URL('../config/cmed-pmc.json.gz', import.meta.url));

async function download(): Promise<{ file: string; listDate: string | null }> {
  const html = await (await fetch(PAGE)).text();
  const found = findListUrl(html, PAGE);
  if (!found) throw new Error(`Não achei o link da lista PMC (xlsx) em ${PAGE}. Baixe o arquivo à mão e passe o caminho.`);
  console.log(`Baixando a lista oficial de ${found.listDate ?? '?'}: ${found.url}`);
  const res = await fetch(found.url);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const dir = join(tmpdir(), 'cestimo-cmed');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'pmc.xlsx');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${(statSync(file).size / 1048576).toFixed(1)} MB`);
  return { file, listDate: found.listDate };
}

/** A planilha de dados é a maior das abas do arquivo. */
function dataSheet(xlsx: string): string {
  const listing = execFileSync('unzip', ['-l', xlsx], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const sheets = [...listing.matchAll(/^\s*(\d+)\s+\S+\s+\S+\s+(xl\/worksheets\/sheet\d+\.xml)$/gm)].map((m) => ({ size: Number(m[1]), name: m[2]! }));
  if (sheets.length === 0) throw new Error('Nenhuma aba encontrada no arquivo.');
  return sheets.sort((a, b) => b.size - a.size)[0]!.name;
}

async function readRows(xlsx: string): Promise<CmedRow[]> {
  const strings = parseSharedStrings(execFileSync('unzip', ['-p', xlsx, 'xl/sharedStrings.xml'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const reader = createSheetReader(strings);
  const rows: CmedRow[] = [];
  const child = spawn('unzip', ['-p', xlsx, dataSheet(xlsx)]);
  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout) rows.push(...reader.push(chunk as string));
  return rows;
}

const arg = process.argv[2];
const source = arg ? { file: arg, listDate: /(\d{4})(\d{2})(\d{2})/.exec(arg)?.slice(1).join('-') ?? null } : await download();
if (!existsSync(source.file)) throw new Error(`Arquivo não encontrado: ${source.file}`);

const all = await readRows(source.file);
const rows = all.filter((r) => r.pmc !== null);
if (rows.length < 5000) throw new Error(`Só ${rows.length} linhas com preço: algo mudou no formato. Nada foi gravado.`);
const json = JSON.stringify({ source: 'CMED/Anvisa, lista PMC (ICMS 17%)', listDate: source.listDate, generatedAt: new Date().toISOString().slice(0, 10), rows });
writeFileSync(OUT, gzipSync(json, { level: 9 }));
console.log(`${all.length} linhas lidas, ${rows.length} com preço máximo. Gravado ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB).`);
