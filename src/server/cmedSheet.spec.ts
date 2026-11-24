import { describe, it, expect } from 'vitest';
import { createSheetReader, parseSharedStrings, parsePriceBR, findListUrl } from './cmedSheet.js';

describe('parseSharedStrings', () => {
  it('junta os textos de cada <si>, inclusive os repartidos em vários <t> e com entidades XML', () => {
    const xml = '<sst><si><t>DIPIRONA</t></si><si><r><t>500 </t></r><r><t>MG &amp; X</t></r></si><si><t xml:space="preserve"> a </t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['DIPIRONA', '500 MG & X', ' a ']);
  });
});

describe('parsePriceBR', () => {
  it.each([['37,02', 37.02], ['1.234,50', 1234.5], ['2098,20', 2098.2], ['9', 9]])('%s = %d', (text, n) => {
    expect(parsePriceBR(text)).toBe(n);
  });
  it.each([[''], ['-'], ['   -   '], ['Não'], [undefined]])('"%s" não é preço', (text) => {
    expect(parsePriceBR(text as string | undefined)).toBeNull();
  });
});

const STRINGS = ['SUBSTÂNCIA', 'PRODUTO', 'APRESENTAÇÃO', 'TIPO DE PRODUTO (STATUS DO PRODUTO)', 'PMC 17 %', 'PMC 17 %  ALC', 'DIPIRONA', 'NOVALGINA', '500 MG COM X 10', 'Referência', '17,12', '15,0', 'OUTRO', '1 G COM X 10', 'Genérico'];
const cell = (ref: string, v: number | string, shared = true) => `<c r="${ref}"${shared ? ' t="s"' : ''}><v>${v}</v></c>`;
const header = `<row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}${cell('D1', 3)}${cell('E1', 4)}${cell('F1', 5)}</row>`;
const dataRow = (n: number, s: number, p: number, a: number, t: number, pmc: number | string | null) =>
  `<row r="${n}">${cell(`A${n}`, s)}${cell(`B${n}`, p)}${cell(`C${n}`, a)}${cell(`D${n}`, t)}${pmc === null ? `<c r="E${n}"/>` : cell(`E${n}`, pmc)}</row>`;

describe('createSheetReader', () => {
  it('acha as colunas pelo nome do cabeçalho e devolve as linhas de dados', () => {
    const reader = createSheetReader(STRINGS);
    const out = reader.push(`<sheetData>${header}${dataRow(2, 6, 7, 8, 9, 10)}${dataRow(3, 6, 6, 13, 14, 11)}</sheetData>`);
    expect(out).toEqual([
      { s: 'DIPIRONA', p: 'NOVALGINA', a: '500 MG COM X 10', t: 'Referência', pmc: 17.12 },
      { s: 'DIPIRONA', p: 'DIPIRONA', a: '1 G COM X 10', t: 'Genérico', pmc: 15 },
    ]);
  });
  it('lê em pedaços: uma linha cortada ao meio espera o próximo pedaço', () => {
    const reader = createSheetReader(STRINGS);
    const xml = `<sheetData>${header}${dataRow(2, 6, 7, 8, 9, 10)}</sheetData>`;
    const cut = xml.indexOf('<c r="C2"');
    expect(reader.push(xml.slice(0, cut))).toEqual([]);
    expect(reader.push(xml.slice(cut))).toEqual([{ s: 'DIPIRONA', p: 'NOVALGINA', a: '500 MG COM X 10', t: 'Referência', pmc: 17.12 }]);
  });
  it('linha sem preço vira pmc null (a lista tem produtos sem PMC) e linha sem nome é descartada', () => {
    const reader = createSheetReader(STRINGS);
    const out = reader.push(`${header}${dataRow(2, 6, 7, 8, 9, null)}<row r="3">${cell('C3', 8)}</row>`);
    expect(out).toEqual([{ s: 'DIPIRONA', p: 'NOVALGINA', a: '500 MG COM X 10', t: 'Referência', pmc: null }]);
  });
  it('sem a coluna PMC 17 % no cabeçalho, avisa em vez de gerar dados errados', () => {
    const reader = createSheetReader(STRINGS);
    const bad = `<row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}</row>`;
    expect(() => reader.push(bad + dataRow(2, 6, 7, 8, 9, 10))).toThrow(/PMC 17 %/);
  });
  it('linhas antes do cabeçalho (título da planilha) são ignoradas', () => {
    const reader = createSheetReader(STRINGS);
    const title = `<row r="1">${cell('A1', 12)}</row>`;
    const out = reader.push(`${title}${header.replace('r="1"', 'r="2"')}${dataRow(3, 6, 7, 8, 9, 10)}`);
    expect(out).toHaveLength(1);
  });
});

describe('findListUrl', () => {
  it('acha o link da lista PMC (xlsx) na página oficial e o torna absoluto', () => {
    const html = '<a href="/anvisa/precos/arquivos/lista_pmvg_20261109_1.xlsx/@@download/file">PMVG</a> <a href="/anvisa/precos/arquivos/lista_pmc_20261109_111901662.xlsx/@@download/file">PMC - xls</a>';
    expect(findListUrl(html, 'https://www.gov.br/anvisa/pt-br/precos')).toEqual({ url: 'https://www.gov.br/anvisa/precos/arquivos/lista_pmc_20261109_111901662.xlsx/@@download/file', listDate: '2026-11-09' });
  });
  it('sem link PMC na página = null', () => {
    expect(findListUrl('<a href="/x.pdf">x</a>', 'https://www.gov.br/a')).toBeNull();
  });
});
