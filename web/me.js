import { accountView, loginFailed } from './account.js';
import { changeBadge, defaultListName, listLabel, sparkPoints } from './panel.js';
import { sparklinePath } from './trend.js';
import { formatBRL } from './format.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};
const GOOGLE_G = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
const norm = (q) => q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status} do servidor.`);
  return data;
}

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/**
 * Conta e painel (listas salvas e produtos acompanhados).
 * `hooks`: getCurrent() => { category, list }; useList({ category, list }) coloca a lista salva na tela.
 * Devolve o que a tela de resultados precisa: se há login, se um produto é acompanhado e como alternar.
 */
export async function initMe(hooks) {
  const state = { authEnabled: true, user: null, tracked: [] };
  const api_ = {
    get loggedIn() { return state.user !== null; },
    isTracked: (query, category) => state.tracked.some((t) => t.category === category && norm(t.query) === norm(query)),
    onTrackedChange: () => {},
    async toggleTrack(query, category, seen = null) {
      if (!state.user) { location.href = '/api/auth/google'; return; }
      const existing = state.tracked.find((t) => t.category === category && norm(t.query) === norm(query));
      try {
        if (existing) await api('DELETE', `/api/me/tracked/${existing.id}`);
        else await api('POST', '/api/me/tracked', { query, category, ...(seen ? { priceBRL: seen.priceBRL, source: seen.source } : {}) });
        await loadTracked();
        toast(existing ? 'Produto removido do acompanhamento.' : 'Pronto! Acompanhando a partir do preço de hoje.');
        api_.onTrackedChange();
      } catch (e) { toast(e.message); }
    },
    async saveCurrentList() {
      if (!state.user) { location.href = '/api/auth/google'; return; }
      const { category, list } = hooks.getCurrent();
      if (!list.trim()) { toast('Escreva a lista antes de salvar.'); return; }
      const name = window.prompt('Nome da lista:', defaultListName(new Date()));
      if (name === null) return;
      try {
        await api('POST', '/api/me/lists', { name, category, list });
        toast('Lista salva em "Minhas listas".');
        if (!$('me-panel').hidden) await renderPanel();
      } catch (e) { toast(e.message); }
    },
  };

  async function loadTracked() {
    try { state.tracked = (await api('GET', '/api/me/tracked')).items; } catch { state.tracked = []; }
  }

  /* ---- cabeçalho: entrar ou menu da conta ---- */
  const box = $('account');
  function paintAccount() {
    const view = accountView({ authEnabled: state.authEnabled, user: state.user });
    box.hidden = view.mode === 'hidden';
    if (view.mode === 'login') {
      const link = el('a', { className: 'btn sm', href: '/api/auth/google', title: 'Entrar com Google para guardar listas e acompanhar produtos' });
      link.insertAdjacentHTML('afterbegin', GOOGLE_G);
      link.append('Entrar');
      box.replaceChildren(link);
    } else if (view.mode === 'user') {
      const menu = el('div', { className: 'menu', role: 'menu', hidden: true },
        el('button', { type: 'button', role: 'menuitem', textContent: 'Minhas listas', onclick: () => open('lists') }),
        el('button', { type: 'button', role: 'menuitem', textContent: 'Produtos acompanhados', onclick: () => open('tracked') }),
        el('hr'),
        el('button', { type: 'button', role: 'menuitem', textContent: 'Sair', onclick: logout }),
        el('button', { type: 'button', role: 'menuitem', className: 'danger', textContent: 'Excluir minha conta', onclick: removeAccount }));
      const trigger = el('button', { type: 'button', className: 'user-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: state.user.email },
        el('span', { className: 'avatar', textContent: view.label.slice(0, 1).toUpperCase(), 'aria-hidden': 'true' }),
        el('span', { className: 'who', textContent: view.label }),
        el('span', { className: 'chev', textContent: '▾', 'aria-hidden': 'true' }));
      const setOpen = (on) => { menu.hidden = !on; trigger.setAttribute('aria-expanded', String(on)); };
      trigger.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
      document.addEventListener('click', (e) => { if (!box.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
      menu.addEventListener('click', () => setOpen(false));
      box.replaceChildren(trigger, menu);
    }
  }

  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch { /* o cookie some no próximo acesso */ }
    location.reload();
  }
  async function removeAccount() {
    if (!window.confirm('Excluir a conta apaga suas listas salvas e os produtos acompanhados. Isso não pode ser desfeito. Excluir?')) return;
    try { await api('DELETE', '/api/me'); location.reload(); } catch (e) { toast(e.message); }
  }

  /* ---- painel ---- */
  let view = 'lists';
  const panel = $('me-panel');
  async function open(which) {
    view = which;
    panel.hidden = false;
    await renderPanel();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const closePanel = () => { panel.hidden = true; };

  async function renderPanel() {
    const tabs = el('div', { className: 'tabs' },
      ...[['lists', 'Minhas listas'], ['tracked', 'Acompanhando']].map(([id, label]) =>
        el('button', { type: 'button', className: `tab${view === id ? ' on' : ''}`, textContent: label, onclick: () => { view = id; void renderPanel(); } })));
    const body = el('div', { className: 'panel-b' }, el('p', { className: 'muted-note', textContent: 'Carregando…' }));
    panel.replaceChildren(
      el('div', { className: 'panel-h' }, el('h2', { textContent: `Olá, ${state.user.name.split(/\s+/)[0]}` }), el('button', { type: 'button', className: 'btn sm', textContent: 'Fechar', onclick: closePanel })),
      tabs, body);
    try {
      body.replaceChildren(...(view === 'lists' ? await listsView() : await trackedView()));
    } catch (e) {
      body.replaceChildren(el('p', { className: 'muted-note', textContent: e.message }));
    }
  }

  async function listsView() {
    const { lists } = await api('GET', '/api/me/lists');
    if (lists.length === 0) return [el('p', { className: 'muted-note', textContent: 'Nenhuma lista salva ainda. Monte uma lista na tela principal e toque em "Salvar lista".' })];
    return [el('ul', { className: 'rows' }, ...lists.map((l) => el('li', { className: 'row' },
      el('div', { className: 'row-main' }, el('b', { textContent: l.name }), el('small', { textContent: listLabel(l) })),
      el('div', { className: 'row-actions' },
        el('button', { type: 'button', className: 'btn sm brand', textContent: 'Usar', onclick: () => { hooks.useList(l); closePanel(); } }),
        el('button', { type: 'button', className: 'btn sm', textContent: 'Renomear', onclick: async () => {
          const name = window.prompt('Novo nome:', l.name);
          if (name === null) return;
          try { await api('PATCH', `/api/me/lists/${l.id}`, { name }); await renderPanel(); } catch (e) { toast(e.message); }
        } }),
        el('button', { type: 'button', className: 'btn sm', textContent: 'Apagar', onclick: async () => {
          if (!window.confirm(`Apagar a lista "${l.name}"?`)) return;
          try { await api('DELETE', `/api/me/lists/${l.id}`); await renderPanel(); } catch (e) { toast(e.message); }
        } })))))];
  }

  async function trackedView() {
    await loadTracked();
    if (state.tracked.length === 0) return [el('p', { className: 'muted-note', textContent: 'Você ainda não acompanha nenhum produto. Nos resultados, toque em "Acompanhar" no produto que quiser vigiar.' })];
    return [
      el('ul', { className: 'rows' }, ...state.tracked.map((t) => {
        const s = t.summary;
        const badge = changeBadge(s);
        const d = sparklinePath(sparkPoints(s.spark), 84, 28);
        const spark = d ? (() => { const wrap = el('span', { className: `spark ${badge.kind}`, 'aria-hidden': 'true' }); wrap.innerHTML = `<svg width="84" height="28" viewBox="0 0 84 28"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`; return wrap; })() : null;
        return el('li', { className: 'row' },
          el('div', { className: 'row-main' },
            el('b', { textContent: t.query }),
            el('small', { textContent: t.category === 'farmacias' ? 'Farmácias' : 'Mercados' }),
            s.latestBRL != null ? el('span', { className: 'now', textContent: `${formatBRL(s.latestBRL)} no ${s.latestSource}` }) : null,
            el('span', { className: `badge ${badge.kind}`, textContent: badge.text })),
          spark,
          el('div', { className: 'row-actions' },
            el('button', { type: 'button', className: 'btn sm', textContent: 'Parar de acompanhar', onclick: async () => {
              try { await api('DELETE', `/api/me/tracked/${t.id}`); await renderPanel(); api_.onTrackedChange(); } catch (e) { toast(e.message); }
            } })));
      })),
      el('p', { className: 'muted-note', textContent: 'Os preços são atualizados uma vez por dia, de manhã.' }),
    ];
  }

  /* ---- início ---- */
  if (loginFailed(location.search)) {
    toast('Não foi possível entrar com o Google. Tente de novo.');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  try { state.user = (await api('GET', '/api/me')).user; } catch { /* sem rede: segue deslogado */ }
  if (state.user) await loadTracked();
  paintAccount();
  return api_;
}
