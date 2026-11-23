import { existsSync, readFileSync } from 'node:fs';
import type { PriceSource } from '../domain/types.js';
import { amazonSource } from '../sources/amazon.js';
import { createMercafacilSource, type MercafacilConfig } from '../sources/mercafacil.js';
import { createOsuperSource, type OsuperConfig } from '../sources/osuper.js';
import { createVipSource, type VipConfig } from '../sources/vipcommerce.js';

export type MarketConfig =
  | ({ platform: 'osuper' } & OsuperConfig)
  | ({ platform: 'mercafacil' } & MercafacilConfig)
  | ({ platform: 'vipcommerce' } & VipConfig)
  | { platform: 'amazon' };

export type MarketsFile = { city: string; markets: MarketConfig[] };

const PLATFORMS = ['osuper', 'mercafacil', 'vipcommerce', 'amazon'] as const;
type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(m: Obj, key: string, label: string): string {
  const v = m[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${label}: falta o campo "${key}" (texto).`);
  return v;
}

function origin(m: Obj, label: string): string {
  const v = text(m, 'origin', label);
  if (!/^https?:\/\/[^/\s]+$/.test(v)) throw new Error(`${label}: "origin" deve ser o endereço do site sem barra no fim, ex.: https://www.exemplo.com.br`);
  return v;
}

function parseMarket(raw: unknown, index: number): MarketConfig {
  if (!isObject(raw)) throw new Error(`mercado #${index + 1}: deve ser um objeto.`);
  const platform = raw.platform;
  if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    throw new Error(`mercado #${index + 1}: "platform" deve ser um destes: ${PLATFORMS.join(', ')}.`);
  }
  if (platform === 'amazon') return { platform: 'amazon' };
  const name = text(raw, 'name', `mercado #${index + 1}`);
  const label = `Mercado "${name}" (${platform})`;
  const base = { name, origin: origin(raw, label) };
  switch (platform) {
    case 'osuper': {
      if (raw.storeCookie !== undefined && typeof raw.storeCookie !== 'boolean') {
        throw new Error(`${label}: "storeCookie" deve ser true ou false.`);
      }
      return {
        platform, ...base, tenant: text(raw, 'tenant', label), storeId: text(raw, 'storeId', label),
        ...(raw.storeCookie === undefined ? {} : { storeCookie: raw.storeCookie }),
      };
    }
    case 'mercafacil': {
      const basePath = text(raw, 'basePath', label);
      if (!basePath.startsWith('/')) throw new Error(`${label}: "basePath" deve começar com "/", ex.: /avenida`);
      return { platform, ...base, basePath };
    }
    default:
      return {
        platform: 'vipcommerce', ...base,
        branchName: text(raw, 'branchName', label), distributionCenterId: text(raw, 'distributionCenterId', label),
      };
  }
}

/** Valida o conteúdo de config/markets.json, com mensagens que dizem o que corrigir. */
export function parseMarketsFile(raw: unknown): MarketsFile {
  if (!isObject(raw)) throw new Error('O arquivo de mercados deve ser um objeto JSON com "city" e "markets".');
  if (typeof raw.city !== 'string' || raw.city.trim() === '') throw new Error('Falta o campo "city" (ex.: "Chapecó, SC").');
  if (!Array.isArray(raw.markets) || raw.markets.length === 0) throw new Error('"markets" deve ser uma lista com ao menos um mercado.');
  const markets = raw.markets.map(parseMarket);
  const names = markets.map((m) => (m.platform === 'amazon' ? 'Amazon' : m.name));
  const repeated = names.find((n, i) => names.indexOf(n) !== i);
  if (repeated) throw new Error(`Nome de mercado repetido: "${repeated}". Cada mercado precisa de um nome único.`);
  return { city: raw.city, markets };
}

export function readMarketsFile(path: string): MarketsFile {
  if (!existsSync(path)) throw new Error(`Arquivo de mercados não encontrado: ${path}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`JSON inválido em ${path}: ${(e as Error).message}`);
  }
  return parseMarketsFile(json);
}

export function buildSources(file: MarketsFile): PriceSource[] {
  return file.markets.map((m): PriceSource => {
    switch (m.platform) {
      case 'osuper': return createOsuperSource(m);
      case 'mercafacil': return createMercafacilSource(m);
      case 'vipcommerce': return createVipSource(m);
      case 'amazon': return amazonSource;
    }
  });
}
