import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chave estável de um produto: sem caixa, acentos nem espaços repetidos. */
export const productKey = (query: string): string =>
  query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

/** Dia (AAAA-MM-DD) no fuso configurado. */
export const dayKey = (t: number, utcOffsetMinutes: number): string => new Date(t + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);

/** O histórico de farmácias fica separado do de mercados (mesmo texto de produto, lojas diferentes). */
export const historyKey = (query: string, category: 'mercados' | 'farmacias'): string => (category === 'farmacias' ? `farmacias: ${query}` : query);

export type PricePoint = { day: string; cheapestBRL: number; cheapestSource: string; averageBRL: number; sources: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Histórico de preços: um valor por dia, produto e mercado (o último do dia vale), em SQLite.
 * Só guarda o texto normalizado do produto, o mercado, o dia e o preço: nada que identifique quem consultou.
 */
export function createHistoryStore(opts: { path: string; now?: () => number; keepDays?: number; utcOffsetMinutes?: number }) {
  const now = opts.now ?? Date.now;
  const keepDays = opts.keepDays ?? 365;
  const offset = opts.utcOffsetMinutes ?? -180;
  if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path);
  db.exec(`CREATE TABLE IF NOT EXISTS prices (
    day TEXT NOT NULL, product TEXT NOT NULL, source TEXT NOT NULL, price REAL NOT NULL,
    PRIMARY KEY (day, product, source)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS prices_product_day ON prices (product, day);
  CREATE TABLE IF NOT EXISTS observations (
    day TEXT NOT NULL, product TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, price REAL NOT NULL, unit_price REAL, uncertain INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, product, source)
  ) WITHOUT ROWID;`);

  const upsert = db.prepare('INSERT OR REPLACE INTO prices (day, product, source, price) VALUES (?, ?, ?, ?)');
  const seriesQuery = db.prepare(
    `SELECT day, MIN(price) AS cheapest, AVG(price) AS average, COUNT(*) AS n,
       (SELECT source FROM prices q WHERE q.day = p.day AND q.product = p.product ORDER BY price, source LIMIT 1) AS cheapest_source
     FROM prices p WHERE product = ? AND day >= ? GROUP BY day ORDER BY day`,
  );
  const purgeQuery = db.prepare('DELETE FROM prices WHERE day < ?');
  const purgeObservations = db.prepare('DELETE FROM observations WHERE day < ?');
  const upsertObservation = db.prepare('INSERT OR REPLACE INTO observations (day, product, source, title, price, unit_price, uncertain) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const observationsQuery = db.prepare('SELECT source, title, price, unit_price, uncertain FROM observations WHERE day = ? AND product = ? ORDER BY source');
  const coverageQuery = db.prepare('SELECT source, COUNT(*) AS n FROM observations WHERE day = ? GROUP BY source ORDER BY source');

  return {
    record(day: string, query: string, rows: Array<{ source: string; priceBRL: number }>): void {
      const product = productKey(query);
      const valid = rows.filter((r) => Number.isFinite(r.priceBRL) && r.priceBRL > 0 && r.source.length > 0 && r.source.length <= 60);
      if (!product || valid.length === 0) return;
      db.exec('BEGIN');
      try {
        for (const r of valid) upsert.run(day, product, r.source, r.priceBRL);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    series(query: string, days: number): PricePoint[] {
      const since = dayKey(now() - (Math.max(1, days) - 1) * DAY_MS, offset);
      return (seriesQuery.all(productKey(query), since) as Array<{ day: string; cheapest: number; average: number; n: number; cheapest_source: string }>).map((r) => ({
        day: r.day,
        cheapestBRL: round2(r.cheapest),
        cheapestSource: r.cheapest_source,
        averageBRL: round2(r.average),
        sources: r.n,
      }));
    },
    purge(): number {
      const limit = dayKey(now() - keepDays * DAY_MS, offset);
      purgeObservations.run(limit);
      return Number(purgeQuery.run(limit).changes);
    },
    /** Grava o que cada loja tinha para o produto, com o título que casou (a mesma chave do histórico de preços). */
    recordObservations(day: string, query: string, rows: Array<{ source: string; title: string; priceBRL: number; unitPriceBRL?: number | undefined; uncertain: boolean }>): void {
      const product = productKey(query);
      const valid = rows.filter((r) => Number.isFinite(r.priceBRL) && r.priceBRL > 0 && r.source.length > 0 && r.source.length <= 60 && r.title.trim().length > 0);
      if (!product || valid.length === 0) return;
      db.exec('BEGIN');
      try {
        for (const r of valid) {
          const unit = r.unitPriceBRL !== undefined && Number.isFinite(r.unitPriceBRL) ? r.unitPriceBRL : null;
          upsertObservation.run(day, product, r.source, r.title.trim().slice(0, 200), r.priceBRL, unit, r.uncertain ? 1 : 0);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    observationsOn(day: string, query: string): Array<{ source: string; title: string; priceBRL: number; unitPriceBRL?: number; uncertain: boolean }> {
      return (observationsQuery.all(day, productKey(query)) as Array<{ source: string; title: string; price: number; unit_price: number | null; uncertain: number }>).map((r) => ({
        source: r.source, title: r.title, priceBRL: r.price, ...(r.unit_price !== null ? { unitPriceBRL: r.unit_price } : {}), uncertain: r.uncertain === 1,
      }));
    },
    /** Produtos coletados por loja no dia. */
    coverageOn(day: string): Record<string, number> {
      return Object.fromEntries((coverageQuery.all(day) as Array<{ source: string; n: number }>).map((r) => [r.source, Number(r.n)]));
    },
    /** Cópia consistente do banco em um novo arquivo (seguro com o app em uso). O destino não pode existir. */
    backupTo(path: string): void {
      db.prepare('VACUUM INTO ?').run(path);
    },
    close(): void {
      db.close();
    },
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;
