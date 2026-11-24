import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dayKey, type HistoryStore } from './history.js';

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** Pastas de backup além das `keep` mais recentes. Só considera nomes de data: nunca apaga o que não criou. */
export const backupsToRemove = (names: string[], keep: number): string[] =>
  names.filter((n) => DAY_DIR.test(n)).sort().reverse().slice(Math.max(0, keep));

export type BackupOptions = { dataDir: string; history: Pick<HistoryStore, 'backupTo'>; now: () => number; utcOffsetMinutes: number; keep: number };

/**
 * Backup do dia em `<dataDir>/backups/AAAA-MM-DD/`: histórico de preços (cópia consistente), estatísticas e links.
 * Rodar de novo no mesmo dia substitui o backup do dia.
 */
export function runBackup({ dataDir, history, now, utcOffsetMinutes, keep }: BackupOptions): { dir: string } {
  const root = join(dataDir, 'backups');
  const dir = join(root, dayKey(now(), utcOffsetMinutes));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  history.backupTo(join(dir, 'history.db'));
  for (const file of ['stats.json', 'shares.json', 'push.json', 'vapid.json']) {
    const from = join(dataDir, file);
    if (existsSync(from)) copyFileSync(from, join(dir, file));
  }
  for (const old of backupsToRemove(readdirSync(root), keep)) rmSync(join(root, old), { recursive: true, force: true });
  return { dir };
}
