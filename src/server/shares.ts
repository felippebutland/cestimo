import { randomBytes } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_FORMAT = /^[A-Za-z0-9_-]{12,64}$/;

type Entry = { createdAt: number; result: unknown };
export type SharedResult = { result: unknown; createdAt: number; expiresAt: number };

/** Resultados congelados atrás de um id aleatório. Vencem sozinhos e o total é limitado (descarta os mais antigos). */
export function createShareStore(opts: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? 7 * DAY_MS;
  const maxEntries = opts.maxEntries ?? 2000;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const expired = (e: Entry): boolean => now() >= e.createdAt + ttlMs;
  const sweep = (): void => {
    for (const [id, e] of entries) if (expired(e)) entries.delete(id);
  };

  return {
    put(result: unknown): { id: string; expiresAt: number } {
      sweep();
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      const id = randomBytes(12).toString('base64url');
      const createdAt = now();
      entries.set(id, { createdAt, result });
      return { id, expiresAt: createdAt + ttlMs };
    },
    get(id: string): SharedResult | null {
      if (!ID_FORMAT.test(id)) return null;
      const e = entries.get(id);
      if (!e) return null;
      if (expired(e)) {
        entries.delete(id);
        return null;
      }
      return { result: e.result, createdAt: e.createdAt, expiresAt: e.createdAt + ttlMs };
    },
    size(): number {
      sweep();
      return entries.size;
    },
    snapshot(): { entries: Array<[string, Entry]> } {
      sweep();
      return { entries: [...entries] };
    },
    restore(raw: unknown): void {
      const list = (raw as { entries?: unknown } | null)?.entries;
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || !ID_FORMAT.test(item[0])) continue;
        const e = item[1] as Partial<Entry> | undefined;
        if (!e || typeof e.createdAt !== 'number' || !Number.isFinite(e.createdAt) || e.result === undefined) continue;
        if (!expired(e as Entry)) entries.set(item[0], { createdAt: e.createdAt, result: e.result });
      }
    },
  };
}

export type ShareStore = ReturnType<typeof createShareStore>;
