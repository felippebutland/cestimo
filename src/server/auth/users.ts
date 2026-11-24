import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AuthUser = { id: number; email: string; name: string };

const SEEN_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Contas e sessões em SQLite. Do Google guardamos só o identificador, o e-mail e o nome.
 * O token da sessão vai para o navegador; no banco fica apenas o hash dele.
 */
export function createAuthStore(opts: { path: string; now?: () => number; sessionTtlMs?: number }) {
  const now = opts.now ?? Date.now;
  const ttl = opts.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
  );`);
  // bancos criados antes do "último acesso" ganham a coluna; quem já existia conta como visto na criação
  try { db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER'); } catch { /* já existe */ }
  db.exec('UPDATE users SET last_seen_at = created_at WHERE last_seen_at IS NULL');

  const upsert = db.prepare(`INSERT INTO users (google_sub, email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name RETURNING id, email, name`);
  const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  const lookup = db.prepare(`SELECT u.id, u.email, u.name, u.last_seen_at AS lastSeen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`);
  const touch = db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    /** Já existe conta com este identificador do Google? */
    hasUser: (sub: string): boolean => db.prepare('SELECT 1 AS x FROM users WHERE google_sub = ?').get(sub) !== undefined,
    upsertUser(p: { sub: string; email: string; name: string }): AuthUser {
      return upsert.get(p.sub, p.email, p.name, now(), now()) as AuthUser;
    },
    createSession(userId: number): string {
      const token = randomBytes(32).toString('base64url');
      insertSession.run(hash(token), userId, now() + ttl);
      return token;
    },
    userForSession(token: string): AuthUser | null {
      if (!token) return null;
      const row = lookup.get(hash(token), now()) as (AuthUser & { lastSeen: number | null }) | undefined;
      if (!row) return null;
      // "último acesso": no máximo uma gravação a cada 6 horas por pessoa
      if (row.lastSeen === null || now() - row.lastSeen >= SEEN_EVERY_MS) touch.run(now(), row.id);
      return { id: row.id, email: row.email, name: row.name };
    },
    deleteSession(token: string): void {
      remove.run(hash(token));
    },
    purgeExpired(): void {
      purge.run(now());
    },
    /** Só para testes: o que está gravado na coluna do token. */
    rawSessionTokens(): string[] {
      return (db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>).map((r) => r.token_hash);
    },
    /** Números das contas, só contagens (nada que identifique alguém). */
    stats() {
      const t = now();
      const count = (sql: string, ...args: number[]): number => Number((db.prepare(sql).get(...args) as { n: number }).n);
      const tryCount = (sql: string): number => { try { return count(sql); } catch { return 0; } };
      return {
        total: count('SELECT COUNT(*) AS n FROM users'),
        active7: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?', t - 7 * DAY_MS),
        active30: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?', t - 30 * DAY_MS),
        newLast24h: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t - DAY_MS),
        new7d: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t - 7 * DAY_MS),
        /** Voltaram pelo menos um dia depois de criar a conta. */
        returned: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at - created_at >= ?', DAY_MS),
        lists: tryCount('SELECT COUNT(*) AS n FROM saved_lists'),
        tracked: tryCount('SELECT COUNT(*) AS n FROM tracked_products'),
        usersTracking: tryCount('SELECT COUNT(DISTINCT user_id) AS n FROM tracked_products'),
      };
    },
    /** Contas criadas por dia nos últimos `days` dias (o último é hoje), no fuso dado. */
    signupsByDay(days: number, utcOffsetMinutes: number): Array<{ day: string; count: number }> {
      const t = now();
      const dayOf = (ms: number): string => new Date(ms + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
      const buckets = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) buckets.set(dayOf(t - i * DAY_MS), 0);
      const rows = db.prepare('SELECT created_at AS c FROM users WHERE created_at >= ?').all(t - days * DAY_MS) as Array<{ c: number }>;
      for (const r of rows) {
        const d = dayOf(r.c);
        if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + 1);
      }
      return [...buckets].map(([day, count]) => ({ day, count }));
    },
    /** Apaga a conta e tudo que é dela (sessões, listas e produtos acompanhados). */
    deleteUser(userId: number): void {
      db.exec('BEGIN');
      try {
        for (const table of ['sessions', 'saved_lists', 'tracked_products', 'push_devices']) {
          try { db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId); } catch { /* tabela do painel ainda não criada */ }
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    /** Banco compartilhado com o painel (listas e acompanhados). */
    db,
    close(): void {
      db.close();
    },
  };
}
export type AuthStore = ReturnType<typeof createAuthStore>;
