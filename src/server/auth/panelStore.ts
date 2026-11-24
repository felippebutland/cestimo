import type { DatabaseSync } from 'node:sqlite';
import { productKey } from '../history.js';

export const MAX_LISTS = 10;
export const MAX_TRACKED = 20;
export type PanelCategory = 'mercados' | 'farmacias';

export type SavedList = { id: number; name: string; category: PanelCategory; body: string; updatedAt: number };
export type TrackedItem = { id: number; query: string; category: PanelCategory; createdAt: number; startPrice: number | null; startSource: string | null };
type Result = { ok: true } | { ok: false; reason: 'limit' };
type TrackResult = { ok: true; added: boolean } | { ok: false; reason: 'limit' };

/** Listas de compra salvas e produtos acompanhados de cada conta. Usa o mesmo banco do login. */
export function createPanelStore(db: DatabaseSync, now: () => number = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS saved_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
    category TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (user_id, name_key, category)
  );
  CREATE TABLE IF NOT EXISTS tracked_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_key TEXT NOT NULL, query TEXT NOT NULL,
    category TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (user_id, product_key, category)
  );`);

  // bancos criados antes do preço inicial ganham as colunas novas
  for (const col of ['start_price REAL', 'start_source TEXT']) {
    try { db.exec(`ALTER TABLE tracked_products ADD COLUMN ${col}`); } catch { /* já existe */ }
  }

  const countLists = db.prepare('SELECT COUNT(*) AS n FROM saved_lists WHERE user_id = ?');
  const existingList = db.prepare('SELECT id FROM saved_lists WHERE user_id = ? AND name_key = ? AND category = ?');
  const insertList = db.prepare('INSERT INTO saved_lists (user_id, name, name_key, category, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const updateList = db.prepare('UPDATE saved_lists SET name = ?, body = ?, updated_at = ? WHERE id = ?');
  const selectLists = db.prepare('SELECT id, name, category, body, updated_at AS updatedAt FROM saved_lists WHERE user_id = ? ORDER BY updated_at DESC, id DESC');
  const removeList = db.prepare('DELETE FROM saved_lists WHERE id = ? AND user_id = ?');
  const renameStmt = db.prepare('UPDATE saved_lists SET name = ?, name_key = ?, updated_at = ? WHERE id = ? AND user_id = ?');

  const countTracked = db.prepare('SELECT COUNT(*) AS n FROM tracked_products WHERE user_id = ?');
  const existingTracked = db.prepare('SELECT id, start_price FROM tracked_products WHERE user_id = ? AND product_key = ? AND category = ?');
  const insertTracked = db.prepare('INSERT INTO tracked_products (user_id, product_key, query, category, created_at, start_price, start_source) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const fillBaseline = db.prepare('UPDATE tracked_products SET start_price = ?, start_source = ? WHERE id = ? AND start_price IS NULL');
  const selectTracked = db.prepare('SELECT id, query, category, created_at AS createdAt, start_price AS startPrice, start_source AS startSource FROM tracked_products WHERE user_id = ? ORDER BY created_at DESC, id DESC');
  const removeTracked = db.prepare('DELETE FROM tracked_products WHERE id = ? AND user_id = ?');
  const distinct = db.prepare('SELECT product_key, MIN(query) AS query, category FROM tracked_products GROUP BY product_key, category');

  const nameKey = (name: string): string => productKey(name);

  return {
    lists: (userId: number): SavedList[] => selectLists.all(userId) as SavedList[],
    saveList(userId: number, l: { name: string; category: PanelCategory; body: string }): Result {
      const key = nameKey(l.name);
      const found = existingList.get(userId, key, l.category) as { id: number } | undefined;
      if (found) {
        updateList.run(l.name, l.body, now(), found.id);
        return { ok: true };
      }
      if ((countLists.get(userId) as { n: number }).n >= MAX_LISTS) return { ok: false, reason: 'limit' };
      insertList.run(userId, l.name, key, l.category, l.body, now());
      return { ok: true };
    },
    renameList(userId: number, id: number, name: string): boolean {
      try {
        return Number(renameStmt.run(name, nameKey(name), now(), id, userId).changes) > 0;
      } catch {
        return false; // já existe outra lista com esse nome
      }
    },
    deleteList: (userId: number, id: number): boolean => Number(removeList.run(id, userId).changes) > 0,

    tracked: (userId: number): TrackedItem[] => selectTracked.all(userId) as TrackedItem[],
    track(userId: number, t: { query: string; category: PanelCategory; startPrice?: number; startSource?: string }): TrackResult {
      const key = productKey(t.query);
      const found = existingTracked.get(userId, key, t.category) as { id: number; start_price: number | null } | undefined;
      if (found) {
        if (found.start_price === null && t.startPrice !== undefined && t.startSource) fillBaseline.run(t.startPrice, t.startSource, found.id);
        return { ok: true, added: false };
      }
      if ((countTracked.get(userId) as { n: number }).n >= MAX_TRACKED) return { ok: false, reason: 'limit' };
      const hasBase = t.startPrice !== undefined && !!t.startSource;
      insertTracked.run(userId, key, t.query.trim().replace(/\s+/g, ' '), t.category, now(), hasBase ? t.startPrice! : null, hasBase ? t.startSource! : null);
      return { ok: true, added: true };
    },
    untrack: (userId: number, id: number): boolean => Number(removeTracked.run(id, userId).changes) > 0,
    /** Cada produto acompanhado por alguém, uma vez só (é o que a rotina diária consulta). */
    distinctTracked: (): Array<{ query: string; category: PanelCategory }> =>
      (distinct.all() as Array<{ query: string; category: PanelCategory }>).map((r) => ({ query: r.query, category: r.category })),
  };
}
export type PanelStore = ReturnType<typeof createPanelStore>;
