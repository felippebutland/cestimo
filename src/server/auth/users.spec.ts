import { describe, it, expect } from 'vitest';
import { createAuthStore } from './users.js';

const mk = (t = { now: 1_000_000 }) => ({ t, store: createAuthStore({ path: ':memory:', now: () => t.now, sessionTtlMs: 1000 }) });
const ana = { sub: 'g-1', email: 'ana@x.com', name: 'Ana' };

describe('createAuthStore', () => {
  it('cria o usuário no primeiro login e reaproveita no seguinte (mesmo sub), atualizando nome e e-mail', () => {
    const { store } = mk();
    const a = store.upsertUser(ana);
    const b = store.upsertUser({ ...ana, name: 'Ana Maria' });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('Ana Maria');
  });
  it('sessão devolve o usuário; token errado ou vazio, ninguém', () => {
    const { store } = mk();
    const u = store.upsertUser(ana);
    const token = store.createSession(u.id);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(store.userForSession(token)).toEqual({ id: u.id, email: 'ana@x.com', name: 'Ana' });
    expect(store.userForSession('outro')).toBeNull();
    expect(store.userForSession('')).toBeNull();
  });
  it('sessão expira', () => {
    const { store, t } = mk();
    const token = store.createSession(store.upsertUser(ana).id);
    t.now += 1001;
    expect(store.userForSession(token)).toBeNull();
  });
  it('sair apaga a sessão', () => {
    const { store } = mk();
    const token = store.createSession(store.upsertUser(ana).id);
    store.deleteSession(token);
    expect(store.userForSession(token)).toBeNull();
  });
  it('o token não fica guardado em texto (só o hash)', () => {
    const { store } = mk();
    const token = store.createSession(store.upsertUser(ana).id);
    expect(store.rawSessionTokens()).not.toContain(token);
  });
  it('purge remove só as expiradas', () => {
    const { store, t } = mk();
    const old = store.createSession(store.upsertUser(ana).id);
    t.now += 2000;
    const fresh = store.createSession(store.upsertUser(ana).id);
    store.purgeExpired();
    expect(store.userForSession(old)).toBeNull();
    expect(store.userForSession(fresh)).not.toBeNull();
  });
});

describe('último acesso e números das contas', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const setup = () => {
    const t = { now: 100 * DAY };
    const store = createAuthStore({ path: ':memory:', now: () => t.now, sessionTtlMs: 365 * DAY });
    return { t, store };
  };
  const user = (store: ReturnType<typeof createAuthStore>, sub: string) => store.upsertUser({ sub, email: `${sub}@x.com`, name: sub });

  it('conta nova nasce com último acesso = criação', () => {
    const { store } = setup();
    user(store, 'a');
    expect(store.stats()).toMatchObject({ total: 1, active7: 1, active30: 1, newLast24h: 1, new7d: 1, returned: 0 });
  });
  it('usar a sessão atualiza o último acesso (no máximo a cada 6 horas)', () => {
    const { store, t } = setup();
    const u = user(store, 'a');
    const token = store.createSession(u.id);
    t.now += 40 * DAY;
    expect(store.stats().active30).toBe(0);
    store.userForSession(token);
    expect(store.stats()).toMatchObject({ active7: 1, active30: 1, returned: 1 });
  });
  it('ativas em 7 e 30 dias e quem voltou depois do 1º dia', () => {
    const { store, t } = setup();
    const a = user(store, 'a');
    user(store, 'b');
    const ta = store.createSession(a.id);
    t.now += 10 * DAY;
    store.userForSession(ta);
    user(store, 'c');
    const s = store.stats();
    expect(s.total).toBe(3);
    expect(s.active7).toBe(2); // a (voltou) e c (nova); b não apareceu mais
    expect(s.active30).toBe(3);
    expect(s.returned).toBe(1);
  });
  it('mesmo login repetido não conta como conta nova', () => {
    const { store } = setup();
    user(store, 'a');
    user(store, 'a');
    expect(store.stats().total).toBe(1);
  });
  it('contas criadas por dia, no fuso informado', () => {
    const { store, t } = setup();
    user(store, 'a');
    t.now += DAY;
    user(store, 'b');
    user(store, 'c');
    const series = store.signupsByDay(3, 0);
    expect(series).toHaveLength(3);
    expect(series.map((d) => d.count)).toEqual([0, 1, 2]);
  });
  it('listas, acompanhados e quem acompanha entram nos números (zero se o painel não existe)', () => {
    const { store } = setup();
    expect(store.stats()).toMatchObject({ lists: 0, tracked: 0, usersTracking: 0 });
  });
});
