import { describe, it, expect } from 'vitest';
import { createShareStore } from './shares.js';

const DAY = 24 * 60 * 60 * 1000;
const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe('createShareStore', () => {
  it('guarda e devolve o resultado com as datas', () => {
    const c = clock();
    const s = createShareStore({ now: c.now, ttlMs: 7 * DAY });
    const { id, expiresAt } = s.put({ a: 1 });
    expect(expiresAt).toBe(c.now() + 7 * DAY);
    expect(s.get(id)).toEqual({ result: { a: 1 }, createdAt: c.now(), expiresAt });
  });
  it('id longo e sem caracteres de URL problemáticos', () => {
    const s = createShareStore({});
    const ids = new Set(Array.from({ length: 200 }, () => s.put({}).id));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12,}$/);
  });
  it('expira depois do prazo', () => {
    const c = clock();
    const s = createShareStore({ now: c.now, ttlMs: DAY });
    const { id } = s.put({});
    c.advance(DAY - 1);
    expect(s.get(id)).not.toBeNull();
    c.advance(2);
    expect(s.get(id)).toBeNull();
    expect(s.size()).toBe(0);
  });
  it('id desconhecido ou fora do formato devolve null', () => {
    const s = createShareStore({});
    expect(s.get('nao-existe')).toBeNull();
    expect(s.get('../../etc/passwd')).toBeNull();
  });
  it('ao passar do teto, descarta os mais antigos', () => {
    const c = clock();
    const s = createShareStore({ now: c.now, maxEntries: 2 });
    const a = s.put({ n: 1 }).id;
    c.advance(1);
    const b = s.put({ n: 2 }).id;
    c.advance(1);
    const d = s.put({ n: 3 }).id;
    expect(s.get(a)).toBeNull();
    expect(s.get(b)).not.toBeNull();
    expect(s.get(d)).not.toBeNull();
  });
  it('snapshot/restore mantêm os links e descartam os vencidos', () => {
    const c = clock();
    const s = createShareStore({ now: c.now, ttlMs: DAY });
    const old = s.put({ n: 'velho' }).id;
    c.advance(DAY / 2);
    const fresh = s.put({ n: 'novo' }).id;
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    c.advance(DAY / 2 + 1);
    const t = createShareStore({ now: c.now, ttlMs: DAY });
    t.restore(snap);
    expect(t.get(old)).toBeNull();
    expect(t.get(fresh)?.result).toEqual({ n: 'novo' });
  });
  it('restore ignora lixo sem quebrar', () => {
    const s = createShareStore({});
    expect(() => { s.restore(null); s.restore('x'); s.restore({ entries: [['a']] }); }).not.toThrow();
    expect(s.size()).toBe(0);
  });
  it('avisa quando um link é criado, para quem quiser gravar em disco na hora', () => {
    let calls = 0;
    const s = createShareStore({ onPut: () => { calls++; } });
    s.put({});
    s.put({});
    expect(calls).toBe(2);
  });
  it('falha em quem escuta não impede o link de ser criado', () => {
    const s = createShareStore({ onPut: () => { throw new Error('disco cheio'); } });
    const { id } = s.put({ a: 1 });
    expect(s.get(id)).not.toBeNull();
  });
});
