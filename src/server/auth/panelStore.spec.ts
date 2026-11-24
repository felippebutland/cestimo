import { describe, it, expect } from 'vitest';
import { createAuthStore } from './users.js';
import { createPanelStore, MAX_LISTS, MAX_TRACKED } from './panelStore.js';

const mk = () => {
  let now = 1_000;
  const auth = createAuthStore({ path: ':memory:', now: () => now });
  const panel = createPanelStore(auth.db, () => now);
  const ana = auth.upsertUser({ sub: 'a', email: 'a@x.com', name: 'Ana' }).id;
  const bia = auth.upsertUser({ sub: 'b', email: 'b@x.com', name: 'Bia' }).id;
  return { auth, panel, ana, bia, tick: (ms: number) => { now += ms; } };
};

describe('listas salvas', () => {
  it('salva, lista e apaga só as do próprio usuário', () => {
    const { panel, ana, bia } = mk();
    const r = panel.saveList(ana, { name: 'Mês', category: 'mercados', body: 'Arroz 5kg\nLeite 1L' });
    expect(r.ok).toBe(true);
    expect(panel.lists(ana)).toMatchObject([{ name: 'Mês', category: 'mercados', body: 'Arroz 5kg\nLeite 1L' }]);
    expect(panel.lists(bia)).toEqual([]);
    const id = panel.lists(ana)[0]!.id;
    expect(panel.deleteList(bia, id)).toBe(false);
    expect(panel.deleteList(ana, id)).toBe(true);
    expect(panel.lists(ana)).toEqual([]);
  });
  it('mesmo nome e categoria substitui a lista (não duplica)', () => {
    const { panel, ana } = mk();
    panel.saveList(ana, { name: 'Mês', category: 'mercados', body: 'A' });
    panel.saveList(ana, { name: 'mês', category: 'mercados', body: 'B' });
    expect(panel.lists(ana)).toHaveLength(1);
    expect(panel.lists(ana)[0]!.body).toBe('B');
  });
  it('limite de listas por usuário', () => {
    const { panel, ana } = mk();
    for (let i = 0; i < MAX_LISTS; i++) expect(panel.saveList(ana, { name: `L${i}`, category: 'mercados', body: 'A' }).ok).toBe(true);
    expect(panel.saveList(ana, { name: 'extra', category: 'mercados', body: 'A' })).toEqual({ ok: false, reason: 'limit' });
  });
  it('renomeia', () => {
    const { panel, ana } = mk();
    panel.saveList(ana, { name: 'Velho', category: 'mercados', body: 'A' });
    const id = panel.lists(ana)[0]!.id;
    expect(panel.renameList(ana, id, 'Novo')).toBe(true);
    expect(panel.lists(ana)[0]!.name).toBe('Novo');
  });
  it('mais recente primeiro', () => {
    const { panel, ana, tick } = mk();
    panel.saveList(ana, { name: 'A', category: 'mercados', body: 'x' });
    tick(10);
    panel.saveList(ana, { name: 'B', category: 'mercados', body: 'x' });
    expect(panel.lists(ana).map((l) => l.name)).toEqual(['B', 'A']);
  });
});

describe('produtos acompanhados', () => {
  it('acompanha, não duplica (mesmo produto, mesma categoria) e remove', () => {
    const { panel, ana } = mk();
    expect(panel.track(ana, { query: 'Arroz Tio João 5kg', category: 'mercados' }).ok).toBe(true);
    expect(panel.track(ana, { query: ' arroz  tio joão 5KG ', category: 'mercados' }).ok).toBe(true);
    expect(panel.tracked(ana)).toHaveLength(1);
    const id = panel.tracked(ana)[0]!.id;
    expect(panel.untrack(ana, id)).toBe(true);
    expect(panel.tracked(ana)).toEqual([]);
  });
  it('limite por usuário', () => {
    const { panel, ana } = mk();
    for (let i = 0; i < MAX_TRACKED; i++) expect(panel.track(ana, { query: `produto ${i}`, category: 'mercados' }).ok).toBe(true);
    expect(panel.track(ana, { query: 'a mais', category: 'mercados' })).toEqual({ ok: false, reason: 'limit' });
  });
  it('a lista de busca diária junta produtos iguais de usuários diferentes', () => {
    const { panel, ana, bia } = mk();
    panel.track(ana, { query: 'Leite 1L', category: 'mercados' });
    panel.track(bia, { query: 'leite 1l', category: 'mercados' });
    panel.track(bia, { query: 'Dipirona 500mg 10 comprimidos', category: 'farmacias' });
    expect(panel.distinctTracked().sort((a, b) => a.query.localeCompare(b.query))).toEqual([
      { query: 'Dipirona 500mg 10 comprimidos', category: 'farmacias' },
      { query: 'Leite 1L', category: 'mercados' },
    ]);
  });
});

describe('preço inicial ao acompanhar', () => {
  it('guarda o preço e a loja do momento em que começou a acompanhar', () => {
    const { panel, ana } = mk();
    panel.track(ana, { query: 'Leite 1L', category: 'mercados', startPrice: 4.25, startSource: 'Comper' });
    expect(panel.tracked(ana)[0]).toMatchObject({ startPrice: 4.25, startSource: 'Comper' });
  });
  it('sem preço informado, fica nulo', () => {
    const { panel, ana } = mk();
    panel.track(ana, { query: 'Leite 1L', category: 'mercados' });
    expect(panel.tracked(ana)[0]).toMatchObject({ startPrice: null, startSource: null });
  });
  it('acompanhar de novo não troca o preço inicial já guardado, mas completa um que faltava', () => {
    const { panel, ana } = mk();
    panel.track(ana, { query: 'Leite 1L', category: 'mercados', startPrice: 4, startSource: 'Comper' });
    panel.track(ana, { query: 'Leite 1L', category: 'mercados', startPrice: 9, startSource: 'Royal' });
    expect(panel.tracked(ana)[0]!.startPrice).toBe(4);
    panel.track(ana, { query: 'Sal 1kg', category: 'mercados' });
    panel.track(ana, { query: 'Sal 1kg', category: 'mercados', startPrice: 3, startSource: 'Royal' });
    expect(panel.tracked(ana).find((t) => t.query === 'Sal 1kg')!.startPrice).toBe(3);
  });
  it('track diz se o produto é novo (para buscar o preço na hora)', () => {
    const { panel, ana } = mk();
    expect(panel.track(ana, { query: 'Sal 1kg', category: 'mercados' })).toEqual({ ok: true, added: true });
    expect(panel.track(ana, { query: 'sal 1kg', category: 'mercados' })).toEqual({ ok: true, added: false });
  });
});

describe('excluir conta', () => {
  it('apaga usuário, sessões, listas e acompanhados dele (e só dele)', () => {
    const { auth, panel, ana, bia } = mk();
    const token = auth.createSession(ana);
    panel.saveList(ana, { name: 'A', category: 'mercados', body: 'x' });
    panel.track(ana, { query: 'sal', category: 'mercados' });
    panel.track(bia, { query: 'sal', category: 'mercados' });
    auth.deleteUser(ana);
    expect(auth.userForSession(token)).toBeNull();
    expect(panel.lists(ana)).toEqual([]);
    expect(panel.tracked(ana)).toEqual([]);
    expect(panel.tracked(bia)).toHaveLength(1);
  });
});
