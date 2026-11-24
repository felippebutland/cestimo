import type { DatabaseSync } from 'node:sqlite';
import { productKey } from '../history.js';

export const MAX_LISTS = 10;
export const MAX_TRACKED = 20;
export type PanelCategory = 'mercados' | 'farmacias';

export type SavedList = {
  id: number; name: string; category: PanelCategory; body: string; updatedAt: number;
  /** Resultado da comparação no momento em que a lista foi salva/atualizada (JSON), a data dele, os preços da foto anterior (JSON) e os itens marcados (JSON). */
  snapshot: string | null; snapshotAt: number | null; prev: string | null; checked: string;
};
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

  // listas criadas antes do resultado salvo ganham as colunas novas
  for (const col of ['snapshot TEXT', 'snapshot_at INTEGER', 'prev TEXT', "checked TEXT NOT NULL DEFAULT '[]'"]) {
    try { db.exec(`ALTER TABLE saved_lists ADD COLUMN ${col}`); } catch { /* já existe */ }
  }
  // bancos criados antes do preço inicial ganham as colunas novas
  for (const col of ['start_price REAL', 'start_source TEXT']) {
    try { db.exec(`ALTER TABLE tracked_products ADD COLUMN ${col}`); } catch { /* já existe */ }
  }

  const countLists = db.prepare('SELECT COUNT(*) AS n FROM saved_lists WHERE user_id = ?');
  const existingList = db.prepare('SELECT id FROM saved_lists WHERE user_id = ? AND name_key = ? AND category = ?');
  const insertList = db.prepare('INSERT INTO saved_lists (user_id, name, name_key, category, body, updated_at, snapshot, snapshot_at, prev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const updateList = db.prepare('UPDATE saved_lists SET name = ?, body = ?, updated_at = ? WHERE id = ?');
  const updateListWithSnapshot = db.prepare('UPDATE saved_lists SET name = ?, body = ?, updated_at = ?, snapshot = ?, snapshot_at = ?, prev = ? WHERE id = ?');
  const COLUMNS = 'id, name, category, body, updated_at AS updatedAt, snapshot, snapshot_at AS snapshotAt, prev, checked';
  const selectLists = db.prepare(`SELECT ${COLUMNS} FROM saved_lists WHERE user_id = ? ORDER BY updated_at DESC, id DESC`);
  const selectList = db.prepare(`SELECT ${COLUMNS} FROM saved_lists WHERE user_id = ? AND id = ?`);
  const selectByName = db.prepare(`SELECT ${COLUMNS} FROM saved_lists WHERE user_id = ? AND name_key = ? AND category = ?`);
  const setSnapshotStmt = db.prepare('UPDATE saved_lists SET snapshot = ?, snapshot_at = ?, prev = ?, updated_at = ? WHERE id = ? AND user_id = ?');
  const setCheckedStmt = db.prepare('UPDATE saved_lists SET checked = ? WHERE id = ? AND user_id = ?');
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
    list: (userId: number, id: number): SavedList | null => (selectList.get(userId, id) as SavedList | undefined) ?? null,
    listByName: (userId: number, name: string, category: PanelCategory): SavedList | null => (selectByName.get(userId, nameKey(name), category) as SavedList | undefined) ?? null,
    /** Cria a lista ou, com o mesmo nome e categoria, substitui. Com `snapshot`, troca também o resultado (e os preços da foto anterior em `prev`). */
    saveList(userId: number, l: { name: string; category: PanelCategory; body: string; snapshot?: string; prev?: string | null }): Result {
      const key = nameKey(l.name);
      const found = existingList.get(userId, key, l.category) as { id: number } | undefined;
      if (found) {
        if (l.snapshot !== undefined) updateListWithSnapshot.run(l.name, l.body, now(), l.snapshot, now(), l.prev ?? null, found.id);
        else updateList.run(l.name, l.body, now(), found.id);
        return { ok: true };
      }
      if ((countLists.get(userId) as { n: number }).n >= MAX_LISTS) return { ok: false, reason: 'limit' };
      insertList.run(userId, l.name, key, l.category, l.body, now(), l.snapshot ?? null, l.snapshot !== undefined ? now() : null, l.prev ?? null);
      return { ok: true };
    },
    setSnapshot: (userId: number, id: number, snapshot: string, prev: string | null): boolean => Number(setSnapshotStmt.run(snapshot, now(), prev, now(), id, userId).changes) > 0,
    setChecked: (userId: number, id: number, keys: string[]): boolean => Number(setCheckedStmt.run(JSON.stringify(keys), id, userId).changes) > 0,
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
