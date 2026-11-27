import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPharmacySources, buildSources, parseMarketsFile, readMarketsFile } from './markets.js';

const osuper = { platform: 'osuper', name: 'Comper', origin: 'https://www.comper.com.br', tenant: '335', storeId: '1803' };
const file = (markets: unknown[], city: unknown = 'Chapecó, SC') => ({ city, markets });

describe('parseMarketsFile', () => {
  it('aceita o config/markets.json que acompanha o projeto', () => {
    const parsed = readMarketsFile(join(process.cwd(), 'config', 'markets.json'));
    expect(parsed.city).toBe('Chapecó, SC');
    expect(parsed.markets.length).toBeGreaterThan(0);
  });
  it('o config/markets.json do projeto inclui o Super Alfa (loja de Chapecó, Av. Fernando Machado, loja padrão do site)', () => {
    const parsed = readMarketsFile(join(process.cwd(), 'config', 'markets.json'));
    expect(parsed.markets).toContainEqual({ platform: 'osuper', name: 'Super Alfa', origin: 'https://superalfanumclick.com.br', tenant: '69', storeId: '189' });
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
    expect(() => parseMarketsFile(file([{ platform: 'magento', name: 'X' }]))).toThrow(/osuper.*mercafacil.*vipcommerce.*vtex.*amazon/s);
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

describe('farmácias (pharmacies)', () => {
  const vtex = { platform: 'vtex', name: 'Pague Menos', origin: 'https://www.paguemenos.com.br', postalCode: '89801000' };
  const withPharmacies = (pharmacies: unknown, markets: unknown[] = [osuper]) => ({ city: 'Chapecó, SC', markets, pharmacies });

  it('é opcional: sem a lista, não há farmácias', () => {
    expect(parseMarketsFile(file([osuper])).pharmacies).toEqual([]);
  });
  it('lê farmácias da plataforma vtex com o CEP', () => {
    const parsed = parseMarketsFile(withPharmacies([vtex]));
    expect(parsed.pharmacies).toEqual([{ platform: 'vtex', name: 'Pague Menos', origin: 'https://www.paguemenos.com.br', postalCode: '89801000' }]);
  });
  it('CEP precisa ter 8 dígitos (aceita com hífen e normaliza)', () => {
    expect(parseMarketsFile(withPharmacies([{ ...vtex, postalCode: '89801-000' }])).pharmacies[0]).toMatchObject({ postalCode: '89801000' });
    for (const bad of ['8980100', '898010000', 'abcdefgh', '']) {
      expect(() => parseMarketsFile(withPharmacies([{ ...vtex, postalCode: bad }]))).toThrow(/postalCode/);
    }
    const { postalCode: _p, ...semCep } = vtex;
    expect(() => parseMarketsFile(withPharmacies([semCep]))).toThrow(/Pague Menos.*postalCode/s);
  });
  it('"pharmacies" precisa ser uma lista', () => {
    expect(() => parseMarketsFile(withPharmacies('x'))).toThrow(/pharmacies/);
  });
  it('nome repetido vale entre mercados e farmácias (o nome identifica a loja nas métricas)', () => {
    expect(() => parseMarketsFile(withPharmacies([{ ...vtex, name: 'Comper' }]))).toThrow(/repetido/);
  });
  it('buildSources(file) monta só os mercados e buildPharmacySources(file) só as farmácias', () => {
    const parsed = parseMarketsFile(withPharmacies([vtex]));
    expect(buildSources(parsed).map((s) => s.name)).toEqual(['Comper']);
    expect(buildPharmacySources(parsed).map((s) => s.name)).toEqual(['Pague Menos']);
  });
  it('o config/markets.json do projeto traz só farmácias com loja em Chapecó (sem as de entrega, como a Pague Menos)', () => {
    const parsed = readMarketsFile(join(process.cwd(), 'config', 'markets.json'));
    expect(parsed.pharmacies.map((p) => (p.platform === 'amazon' ? 'Amazon' : p.name))).toEqual(['São João', 'Catarinense', 'Preço Popular']);
    expect(parsed.pharmacies.every((p) => p.platform === 'vtex' && p.postalCode === '89801000')).toBe(true);
  });
});

