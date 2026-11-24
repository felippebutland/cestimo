import { accountView, loginFailed } from './account.js';
import { pushPanelState, ageLabel, changeBadge, changeLabel, changesSince, defaultListName, isStale, itemKey, listLabel, progress, sparkPoints, toggleChecked } from './panel.js';
import { askConfirm, askText } from './modal.js';
import { buildShoppingList, buildSingleStoreList } from './shoppingList.js';
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
      if (!state.user) {
        if (await askConfirm({ title: 'Acompanhar o preço deste produto', message: 'Entre com o Google e, todo dia de manhã, conferimos o preço dele nos mercados e mostramos no seu painel quando baixar.', confirmLabel: 'Entrar com Google' })) location.href = '/api/auth/google';
        return;
      }
      const existing = state.tracked.find((t) => t.category === category && norm(t.query) === norm(query));
      try {
        if (existing) await api('DELETE', `/api/me/tracked/${existing.id}`);
        else await api('POST', '/api/me/tracked', { query, category, ...(seen ? { priceBRL: seen.priceBRL, source: seen.source } : {}) });
        await loadTracked();
        toast(existing ? 'Parei de acompanhar o preço deste produto.' : 'Pronto! Todo dia de manhã conferimos o preço. Ative o aviso em "Preços que acompanho" para ser notificado quando baixar.');
        api_.onTrackedChange();
      } catch (e) { toast(e.message); }
    },
    async saveCurrentList() {
      if (!state.user) {
        if (await askConfirm({ title: 'Guardar esta lista', message: 'Entre com o Google para guardar a lista com os preços de hoje, usar como lista de compras no mercado (marcando o que já comprou) e ver depois quanto os preços variaram.', confirmLabel: 'Entrar com Google' })) location.href = '/api/auth/google';
        return;
      }
      const { category, list, result } = hooks.getCurrent();
      if (!list.trim()) { toast('Escreva a lista antes de salvar.'); return; }
      const name = await askText({ title: 'Salvar lista', label: 'Nome da lista', value: defaultListName(new Date()), confirmLabel: 'Salvar' });
      if (name === null) return;
      try {
        await api('POST', '/api/me/lists', { name, category, list, ...(result ? { result } : {}) });
        toast(result ? 'Lista salva com os preços de agora.' : 'Lista salva em "Minhas listas".');
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
        el('button', { type: 'button', role: 'menuitem', textContent: 'Preços que acompanho', onclick: () => open('tracked') }),
        el('hr'),
        el('button', { type: 'button', role: 'menuitem', textContent: 'Minha conta', onclick: () => open('account') }),
        el('button', { type: 'button', role: 'menuitem', textContent: 'Sair', onclick: logout }));
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
    if (!(await askConfirm({ title: 'Excluir minha conta?', message: 'Isso apaga suas listas salvas, os produtos acompanhados e seus dados de login. Não dá para desfazer.', confirmLabel: 'Excluir conta', danger: true }))) return;
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
      ...[['lists', 'Listas'], ['tracked', 'Preços que acompanho'], ['account', 'Conta']].map(([id, label]) =>
        el('button', { type: 'button', className: `tab${view === id ? ' on' : ''}`, textContent: label, onclick: () => { view = id; void renderPanel(); } })));
    const body = el('div', { className: 'panel-b' }, el('p', { className: 'muted-note', textContent: 'Carregando…' }));
    panel.replaceChildren(
      el('div', { className: 'panel-h' }, el('h2', { textContent: `Olá, ${state.user.name.split(/\s+/)[0]}` }), el('button', { type: 'button', className: 'btn sm', textContent: 'Fechar', onclick: closePanel })),
      tabs, body);
    try {
      body.replaceChildren(...(view === 'lists' ? await listsView() : view === 'tracked' ? await trackedView() : accountPanel()));
    } catch (e) {
      body.replaceChildren(el('p', { className: 'muted-note', textContent: e.message }));
    }
  }

  const keysOf = (l) => l.list.split('\n').filter(Boolean).map(itemKey);
  const brlTotal = (l) => (l.result ? buildShoppingList(l.result).totalBRL : null);

  async function listsView() {
    const { lists } = await api('GET', '/api/me/lists');
    if (lists.length === 0) return [el('p', { className: 'muted-note', textContent: 'Nenhuma lista salva ainda. Compare uma lista na tela principal e toque em "Salvar lista": ela fica guardada com os preços e vira sua lista de compras.' })];
    return [el('ul', { className: 'rows' }, ...lists.map((l) => {
      const p = progress(keysOf(l), l.checked);
      const total = brlTotal(l);
      return el('li', { className: 'row' },
        el('div', { className: 'row-main' },
          el('b', { textContent: l.name }),
          el('small', { textContent: listLabel(l) }),
          l.result ? el('span', { className: 'now', textContent: `${formatBRL(total)} · ${ageLabel(l.result.at)}` }) : el('small', { textContent: 'Sem preços salvos' }),
          l.result && p.done > 0 ? el('span', { className: 'badge down', textContent: `${p.label} comprados` }) : null),
        el('div', { className: 'row-actions' },
          l.result ? el('button', { type: 'button', className: 'btn sm brand', textContent: 'Abrir', onclick: () => openDetail(l) }) : null,
          el('button', { type: 'button', className: l.result ? 'btn sm' : 'btn sm brand', textContent: 'Usar na busca', onclick: () => { hooks.useList(l); closePanel(); } }),
          el('button', { type: 'button', className: 'btn sm', textContent: 'Renomear', onclick: async () => {
            const name = await askText({ title: 'Renomear lista', label: 'Novo nome', value: l.name, confirmLabel: 'Renomear' });
            if (name === null) return;
            try { await api('PATCH', `/api/me/lists/${l.id}`, { name }); await renderPanel(); } catch (e) { toast(e.message); }
          } }),
          el('button', { type: 'button', className: 'btn sm', textContent: 'Apagar', onclick: async () => {
            if (!(await askConfirm({ title: 'Apagar a lista?', message: `"${l.name}" será apagada, com os preços salvos e os itens marcados.`, confirmLabel: 'Apagar', danger: true }))) return;
            try { await api('DELETE', `/api/me/lists/${l.id}`); await renderPanel(); } catch (e) { toast(e.message); }
          } })));
    }))];
  }

  /* ---- lista de compras: preços salvos, variação e itens marcados ---- */
  function openDetail(list) {
    let l = list;
    let mode = 'item';
    let store = null;
    const body = panel.querySelector('.panel-b');
    const tabs = panel.querySelector('.tabs');
    tabs.hidden = true;

    const saveChecked = async () => { try { await api('PUT', `/api/me/lists/${l.id}/checked`, { checked: l.checked }); } catch (e) { toast(e.message); } };

    function draw() {
      const data = l.result;
      const changes = changesSince(data, l.prev);
      const shopping = mode === 'store' ? buildSingleStoreList(data, store ?? undefined) : buildShoppingList(data);
      const p = progress(keysOf(l), l.checked);
      const stale = isStale(data.at, Date.now());

      const refresh = el('button', { type: 'button', className: 'btn sm brand', textContent: 'Atualizar preços' });
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        refresh.textContent = 'Buscando preços…';
        try {
          const fresh = await hooks.refreshPrices(l.list, l.category);
          const { list: updated } = await api('PUT', `/api/me/lists/${l.id}/prices`, { result: fresh });
          l = updated;
          toast('Preços atualizados.');
        } catch (e) { toast(e.message); }
        draw();
      });

      const modeTabs = el('div', { className: 'tabs' },
        ...[['item', 'Mais barato por item'], ['store', 'Um mercado só']].map(([id, label]) =>
          el('button', { type: 'button', className: `tab${mode === id ? ' on' : ''}`, textContent: label, onclick: () => { mode = id; draw(); } })));
      const picker = mode === 'store' && shopping.options.length > 1
        ? el('div', { className: 'picker' }, el('label', { textContent: 'Mercado', htmlFor: 'detail-store' }),
          (() => {
            const sel = el('select', { id: 'detail-store', className: 'select' }, ...shopping.options.map((o) => el('option', { value: o.source, textContent: `${o.source} · ${formatBRL(o.totalBRL)}${o.complete ? '' : ` · ${o.covered}/${o.findable} itens`}`, selected: o.source === shopping.stores[0]?.source })));
            sel.addEventListener('change', () => { store = sel.value; draw(); });
            return sel;
          })())
        : null;

      const itemRow = (it) => {
        const key = itemKey(it.query);
        const done = l.checked.includes(key);
        const chg = changes.items.get(key);
        const box = el('input', { type: 'checkbox', checked: done, 'aria-label': `Comprado: ${it.query}` });
        box.addEventListener('change', () => { l.checked = toggleChecked(l.checked, key); void saveChecked(); draw(); });
        return el('label', { className: `shop-item${done ? ' done' : ''}` }, box,
          el('span', { className: 'shop-main' }, el('b', { textContent: it.query }), el('small', { textContent: it.title })),
          el('span', { className: 'shop-price' }, el('b', { textContent: formatBRL(it.priceBRL) }), chg && chg.kind !== 'same' ? el('small', { className: `chg ${chg.kind}`, textContent: changeLabel(chg) }) : null));
      };

      const totalChg = changes.total;
      const summary = el('div', { className: 'shop-summary' },
        el('div', {}, el('small', { textContent: mode === 'store' ? 'Total neste mercado' : 'Total da lista' }), el('div', { className: 'shop-total', textContent: formatBRL(shopping.totalBRL) }),
          totalChg && totalChg.kind !== 'same' && mode === 'item' ? el('small', { className: `chg ${totalChg.kind}`, textContent: `${changeLabel(totalChg)} desde ${ageLabel(l.prev.at).replace('preços de ', '')}` }) : null),
        el('div', { className: 'shop-progress' }, el('small', { textContent: `${p.label} comprados` }),
          (() => { const bar = el('div', { className: 'bar2' }); bar.append(el('i', { style: `width:${p.total ? (p.done / p.total) * 100 : 0}%` })); return bar; })()));

      body.replaceChildren(...[
        el('div', { className: 'shop-head' },
          el('button', { type: 'button', className: 'btn sm', textContent: '← Minhas listas', onclick: () => { tabs.hidden = false; void renderPanel(); } }),
          el('b', { textContent: l.name })),
        el('div', { className: `shop-age${stale ? ' stale' : ''}` },
          el('span', { textContent: `${ageLabel(data.at)}${stale ? ' · podem ter mudado, atualize antes de ir às compras' : ''}` }), refresh),
        summary,
        modeTabs, picker,
        ...shopping.stores.map((st) => el('section', { className: 'shop-store' },
          el('div', { className: 'shop-store-h' }, el('b', { textContent: st.source }), el('span', { textContent: formatBRL(st.subtotalBRL) })),
          ...st.items.map(itemRow))),
        shopping.missing.length ? el('p', { className: 'muted-note', textContent: `Sem preço confiável: ${shopping.missing.join(', ')}` }) : null,
        l.checked.length ? el('button', { type: 'button', className: 'btn sm', textContent: 'Desmarcar tudo', onclick: () => { l.checked = []; void saveChecked(); draw(); } }) : null,
      ].filter(Boolean));
    }
    draw();
  }

  /** Conta: dados de login, sair e, bem no fim e recolhido, excluir a conta. */
  function accountPanel() {
    return [
      el('div', { className: 'row' },
        el('div', { className: 'row-main' }, el('b', { textContent: state.user.name }), el('small', { textContent: state.user.email }), el('small', { textContent: 'Entrou com o Google' })),
        el('div', { className: 'row-actions' }, el('button', { type: 'button', className: 'btn sm', textContent: 'Sair', onclick: logout }))),
      el('details', { className: 'danger-zone' },
        el('summary', { textContent: 'Excluir minha conta' }),
        el('p', { className: 'muted-note', textContent: 'Apaga suas listas salvas, os produtos acompanhados, seu nome e seu e-mail. Não dá para desfazer.' }),
        el('button', { type: 'button', className: 'btn sm danger-btn', textContent: 'Excluir minha conta…', onclick: removeAccount })),
    ];
  }

  /** Aviso de queda no celular: liga/desliga este aparelho na conta. */
  async function pushBox() {
    if (!hooks.push) return null;
    const mode = hooks.push.mode();
    let on = false;
    try { on = mode === 'ready' ? await hooks.push.isOn() : false; } catch { /* sem rede: mostra desligado */ }
    const st = pushPanelState({ mode, on });
    if (!st.show) return null;
    const note = el('p', { className: 'muted-note', textContent: st.note });
    const box = el('div', { className: 'push-box' }, note);
    if (st.action) {
      const button = el('button', { type: 'button', className: st.action === 'enable' ? 'btn sm brand' : 'btn sm', textContent: st.button });
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if (st.action === 'enable') { await hooks.push.enable(); toast('Pronto! Avisaremos neste aparelho quando o preço baixar.'); }
          else { await hooks.push.disable(); toast('Aviso desativado neste aparelho.'); }
          await renderPanel();
        } catch (e) { toast(e.message); button.disabled = false; }
      });
      box.append(button);
    }
    return box;
  }

  async function trackedView() {
    await loadTracked();
    if (state.tracked.length === 0) return [el('p', { className: 'muted-note', textContent: 'Você ainda não acompanha o preço de nenhum produto. Compare uma lista e toque em "☆ Acompanhar preço" no produto que quiser vigiar: todo dia de manhã conferimos o preço nos mercados e mostramos aqui quando baixar.' })];
    return [
      await pushBox(),
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
            el('button', { type: 'button', className: 'btn sm', textContent: 'Parar de acompanhar o preço', onclick: async () => {
              try { await api('DELETE', `/api/me/tracked/${t.id}`); await renderPanel(); api_.onTrackedChange(); } catch (e) { toast(e.message); }
            } })));
      })),
      el('p', { className: 'muted-note', textContent: 'Conferimos o preço destes produtos uma vez por dia, de manhã. O selo "Caiu" aparece quando o menor preço baixa 5% ou mais; ative o aviso acima para receber também uma notificação.' }),
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
  if (state.user && location.hash === '#acompanhando') { history.replaceState(null, '', location.pathname + location.search); void open('tracked'); }
  return api_;
}
