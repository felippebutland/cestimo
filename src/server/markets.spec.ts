import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSources, parseMarketsFile, readMarketsFile } from './markets.js';

const osuper = { platform: 'osuper', name: 'Comper', origin: 'https://www.comper.com.br', tenant: '335', storeId: '1803' };
const file = (markets: unknown[], city: unknown = 'Chapecó, SC') => ({ city, markets });

describe('parseMarketsFile', () => {
  it('aceita o config/markets.json que acompanha o projeto', () => {
    const parsed = readMarketsFile(join(process.cwd(), 'config', 'markets.json'));
    expect(parsed.city).toBe('Chapecó, SC');
    expect(parsed.markets.length).toBeGreaterThan(0);
  });
  it('rejeita o que não é objeto', () => {
    expect(() => parseMarketsFile(null)).toThrow(/objeto/);
  });
  it('exige a cidade', () => {
    expect(() => parseMarketsFile(file([osuper], ''))).toThrow(/city/);
  });
  it('exige ao menos um mercado', () => {
    expect(() => parseMarketsFile(file([]))).toThrow(/markets/);
  });
  it('rejeita plataforma desconhecida e lista as válidas', () => {
    expect(() => parseMarketsFile(file([{ platform: 'vtex', name: 'X' }]))).toThrow(/osuper.*mercafacil.*vipcommerce.*amazon/s);
  });
  it('aponta o campo que falta, citando o mercado', () => {
    const { tenant: _t, ...semTenant } = osuper;
    expect(() => parseMarketsFile(file([semTenant]))).toThrow(/Comper.*tenant/s);
  });
  it('exige origin http(s)', () => {
    expect(() => parseMarketsFile(file([{ ...osuper, origin: 'comper.com.br' }]))).toThrow(/origin/);
  });
  it('rejeita nomes repetidos', () => {
    expect(() => parseMarketsFile(file([osuper, osuper]))).toThrow(/repetido/);
  });
  it('storeCookie precisa ser verdadeiro ou falso', () => {
    expect(() => parseMarketsFile(file([{ ...osuper, storeCookie: 'sim' }]))).toThrow(/storeCookie/);
  });
  it('mercafacil exige basePath começando com /', () => {
    expect(() => parseMarketsFile(file([{ platform: 'mercafacil', name: 'B', origin: 'https://b.com', basePath: 'loja' }]))).toThrow(/basePath/);
  });
  it('vipcommerce exige branchName e distributionCenterId', () => {
    expect(() => parseMarketsFile(file([{ platform: 'vipcommerce', name: 'P', origin: 'https://p.com', branchName: 'P - X' }]))).toThrow(/distributionCenterId/);
  });
  it('amazon não precisa de campos', () => {
    expect(parseMarketsFile(file([{ platform: 'amazon' }])).markets).toEqual([{ platform: 'amazon' }]);
  });
});

describe('buildSources', () => {
  it('cria uma fonte por mercado, na ordem, com o nome configurado', () => {
    const parsed = parseMarketsFile(file([osuper, { platform: 'amazon' }]));
    expect(buildSources(parsed).map((s) => s.name)).toEqual(['Comper', 'Amazon']);
  });
});

describe('readMarketsFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'markets-'));
  it('arquivo inexistente dá erro claro', () => {
    expect(() => readMarketsFile(join(dir, 'nao-existe.json'))).toThrow(/não encontrado/);
  });
  it('JSON inválido dá erro claro', () => {
    const p = join(dir, 'ruim.json');
    writeFileSync(p, '{ isso não é json');
    expect(() => readMarketsFile(p)).toThrow(/JSON inválido/);
  });
});
