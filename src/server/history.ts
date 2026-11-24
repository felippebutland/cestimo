import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chave estável de um produto: sem caixa, acentos nem espaços repetidos. */
export const productKey = (query: string): string =>
  query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

/** Dia (AAAA-MM-DD) no fuso configurado. */
export const dayKey = (t: number, utcOffsetMinutes: number): string => new Date(t + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);

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
  CREATE INDEX IF NOT EXISTS prices_product_day ON prices (product, day);`);

  const upsert = db.prepare('INSERT OR REPLACE INTO prices (day, product, source, price) VALUES (?, ?, ?, ?)');
  const seriesQuery = db.prepare(
    `SELECT day, MIN(price) AS cheapest, AVG(price) AS average, COUNT(*) AS n,
       (SELECT source FROM prices q WHERE q.day = p.day AND q.product = p.product ORDER BY price, source LIMIT 1) AS cheapest_source
     FROM prices p WHERE product = ? AND day >= ? GROUP BY day ORDER BY day`,
  );
  const purgeQuery = db.prepare('DELETE FROM prices WHERE day < ?');

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
      return Number(purgeQuery.run(dayKey(now() - keepDays * DAY_MS, offset)).changes);
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
