import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHistoryStore } from './history.js';
import { backupsToRemove, runBackup } from './backup.js';
import { createAuthStore } from './auth/users.js';
import { createPanelStore } from './auth/panelStore.js';

describe('backupsToRemove', () => {
  it('mantém os N dias mais recentes e remove os mais antigos', () => {
    const names = ['2026-11-20', '2026-11-22', '2026-11-21', '2026-11-23'];
    expect(backupsToRemove(names, 2).sort()).toEqual(['2026-11-20', '2026-11-21']);
  });
  it('ignora o que não parece uma pasta de backup (nunca apaga o que não criou)', () => {
    expect(backupsToRemove(['2026-11-20', 'minhas-fotos', '.DS_Store', '2026-11-21'], 1)).toEqual(['2026-11-20']);
  });
  it('com menos pastas que o limite, não remove nada', () => {
    expect(backupsToRemove(['2026-11-23'], 14)).toEqual([]);
  });
});

describe('runBackup', () => {
  let data: string;
  beforeEach(() => { data = mkdtempSync(join(tmpdir(), 'cestimo-')); });
  const DAY = Date.UTC(2026, 10, 23, 15, 0, 0);

  it('copia o histórico (consistente), stats.json e shares.json para uma pasta do dia', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    history.record('2026-11-23', 'Leite integral 1L', [{ source: 'Comper', priceBRL: 4.99 }]);
    writeFileSync(join(data, 'stats.json'), '{"a":1}');
    writeFileSync(join(data, 'shares.json'), '[]');

    const out = runBackup({ dataDir: data, history, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });

    expect(out.dir).toBe(join(data, 'backups', '2026-11-23'));
    expect(readFileSync(join(out.dir, 'stats.json'), 'utf8')).toBe('{"a":1}');
    const copy = new DatabaseSync(join(out.dir, 'history.db'));
    expect((copy.prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }).n).toBe(1);
    copy.close();
    history.close();
  });

  it('rodar duas vezes no mesmo dia substitui o backup do dia sem falhar', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    runBackup({ dataDir: data, history, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });
    history.record('2026-11-23', 'Sal 1kg', [{ source: 'Royal', priceBRL: 3 }]);
    const out = runBackup({ dataDir: data, history, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });
    const copy = new DatabaseSync(join(out.dir, 'history.db'));
    expect((copy.prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }).n).toBe(1);
    copy.close();
    history.close();
  });

  it('arquivos que ainda não existem (sem links criados) não impedem o backup', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    const out = runBackup({ dataDir: data, history, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });
    expect(existsSync(join(out.dir, 'history.db'))).toBe(true);
    expect(existsSync(join(out.dir, 'shares.json'))).toBe(false);
    history.close();
  });

  it('apaga backups além do limite, só os com nome de data', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    for (const d of [20, 21, 22, 23]) runBackup({ dataDir: data, history, now: () => Date.UTC(2026, 10, d, 15), utcOffsetMinutes: -180, keep: 2 });
    expect(readdirSync(join(data, 'backups')).sort()).toEqual(['2026-11-22', '2026-11-23']);
    history.close();
  });

  it('copia também o banco das contas (usuários, listas salvas e produtos acompanhados), consistente', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    const auth = createAuthStore({ path: join(data, 'auth.db'), now: () => DAY });
    const u = auth.upsertUser({ sub: 'g1', email: 'a@x.com', name: 'Ana' });
    const panel = createPanelStore(auth.db, () => DAY);
    panel.saveList(u.id, { name: 'Mês', category: 'mercados', body: 'Arroz 5kg' });
    panel.track(u.id, { query: 'Leite 1L', category: 'mercados' });

    const out = runBackup({ dataDir: data, history, auth, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });

    const copy = new DatabaseSync(join(out.dir, 'auth.db'));
    expect((copy.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    expect((copy.prepare('SELECT COUNT(*) AS n FROM saved_lists').get() as { n: number }).n).toBe(1);
    expect((copy.prepare('SELECT COUNT(*) AS n FROM tracked_products').get() as { n: number }).n).toBe(1);
    copy.close();
    auth.close();
    history.close();
  });

  it('sem login configurado, o backup segue sem o auth.db', () => {
    const history = createHistoryStore({ path: join(data, 'history.db'), now: () => DAY });
    const out = runBackup({ dataDir: data, history, now: () => DAY, utcOffsetMinutes: -180, keep: 14 });
    expect(existsSync(join(out.dir, 'auth.db'))).toBe(false);
    history.close();
  });
});
