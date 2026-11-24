import { formatBRL, formatPct } from './format.js';
import { JobExpiredError, submitJob, waitForJob } from './jobs.js';
import { installMode, isStandalone, pwaOpenOncePerSession } from './install.js';
import { parsePushState, pushMode, queriesToWatch, urlBase64ToUint8Array } from './push.js';
import { sparklinePath, summarize } from './trend.js';
import { formatDay, parseSaved, snapshot, variations } from './history.js';
import { parseShareHash, shareUrl, toShareBody } from './share.js';
import { applyChoice, mergeRecomputed, toRecomputeBody } from './overrides.js';
import { buildShoppingList, buildSingleStoreList, toText } from './shoppingList.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};

/** Conta uma ação anônima (só o nome da ação, nunca o conteúdo da lista). Falhas são ignoradas. */
function track(name) {
  try {
    fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }), keepalive: true }).catch(() => {});
  } catch {
    // sem rede: sem problema
  }
}

const SAVED_KEY = 'cestimo:ultima';
const readSaved = () => {
  try { return parseSaved(localStorage.getItem(SAVED_KEY)); } catch { return null; }
};
const writeSaved = (value) => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(value)); } catch { /* armazenamento indisponível: segue sem memória */ }
};

let SOURCES = [];
const EXAMPLES = ['Arroz Tio João 5kg', 'Feijão preto 1kg', 'Leite integral 1L', 'Ovos 30un', 'Café 500g'];

/* ---------- Configuração (cidade e mercados) ---------- */
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    SOURCES = cfg.sources;
    $('app-title').textContent = cfg.name;
    if (cfg.city) {
      document.title = `${cfg.name}: comparador de preços em ${cfg.city.split(',')[0]}`;
      $('app-tagline').textContent = `Comparador de preços de supermercados · ${cfg.city}`;
    }
  })
  .catch(() => {});

/* ---------- Última lista (só neste navegador) ---------- */
const lastSaved = readSaved();
if (lastSaved?.list.trim() && !$('list').value.trim()) {
  $('list').value = lastSaved.list;
  const when = lastSaved.snapshot ? ` de ${formatDay(lastSaved.snapshot.at)}` : '';
  $('list-note').textContent = `Lista da sua última consulta${when}, guardada só neste aparelho. `;
  $('list-note').append(el('button', { type: 'button', className: 'swap', textContent: 'Limpar', onclick: () => {
    $('list').value = '';
    $('list-note').textContent = '';
    writeSaved({ list: '' });
  } }));
}

/* ---------- Exemplos ---------- */
for (const ex of EXAMPLES) {
  const link = el('button', { type: 'button', textContent: ex });
  link.addEventListener('click', () => {
    const area = $('list');
    const lines = area.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.includes(ex)) area.value = [...lines, ex].join('\n');
    area.focus();
    track('example');
  });
  $('examples').append(link);
}

/* ---------- Tabela comparativa ---------- */
function swapButton(label, onSwap) {
  return el('button', { type: 'button', className: 'swap no-print', textContent: label, onclick: onSwap });
}

function cell(s, isBest, onSwap) {
  const td = el('td', { className: `cell${isBest ? ' best' : ''}` });
  const hasOptions = (s.alternatives?.length ?? 0) > 0 || Boolean(s.suggested);
  if (!s.match) {
    const label = s.status === 'erro' ? 'Erro' : s.status === 'indisponivel' ? 'Indisponível' : 'Sem resultado';
    td.append(el('span', { className: s.status === 'erro' ? 'flag bad' : 'none', textContent: label, title: s.reason ?? '' }));
    if (hasOptions && s.status === 'ok') td.append(swapButton('Ver opções', onSwap));
    return td;
  }
  const m = s.match;
  td.append(el('div', { className: 'px', textContent: formatBRL(m.priceBRL) }), el('div', { className: 'sub', title: m.title, textContent: m.title }));
  const extra = [m.unitPriceBRL != null ? `${formatBRL(m.unitPriceBRL)}/${m.unit}` : null, m.sizeAdjusted ? `≈ ${formatBRL(m.equivalentBRL)} no tamanho pedido` : null].filter(Boolean);
  if (extra.length) td.append(el('div', { className: 'sub', textContent: extra.join(' · ') }));
  if (m.chosenByUser) td.append(el('div', { className: 'flag chosen', textContent: 'Escolhido por você' }));
  else if (m.uncertain) td.append(el('div', { className: 'flag', textContent: 'Incerto, confira', title: s.reason ?? 'Fora da média e da cesta' }));
  if (hasOptions) td.append(swapButton(m.chosenByUser ? 'Trocar de novo' : 'Não é esse?', onSwap));
  return td;
}

function trendLine(v, since) {
  if (!v) return null;
  const text = v.direction === 'same' ? `Sem mudança desde ${since}`
    : `${v.direction === 'up' ? '▲' : '▼'} ${formatBRL(Math.abs(v.deltaBRL))} (${formatPct(v.pct)}) desde ${since}`;
  return el('div', { className: `sub trend ${v.direction}`, textContent: text, title: `Menor preço na consulta anterior: ${formatBRL(v.previousBRL)}` });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** "30 dias: R$ 3,50 a R$ 5,20" com mini-gráfico; nada enquanto houver menos de 2 dias de histórico. */
function historyLine(points) {
  const sum = points ? summarize(points) : null;
  if (!sum) return null;
  const d = sparklinePath(points, 72, 18);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 72 18');
  svg.setAttribute('width', '72');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  svg.append(path);
  const verdict = sum.atMin ? 'No menor preço' : `${formatPct(sum.aboveMinPct)} acima do menor`;
  return el('div', { className: `sub hist${sum.atMin ? ' low' : ''}`, title: `Menor preço entre os mercados, nos últimos ${sum.days} dias com consulta` },
    svg, el('span', { textContent: `${formatBRL(sum.minBRL)} a ${formatBRL(sum.maxBRL)} em ${sum.days} dias` }), el('b', { textContent: verdict }));
}

function comparisonPanel(data, onSwap, baseline, actions, series) {
  const trends = variations(baseline ?? null, data);
  const since = baseline ? formatDay(baseline.at) : '';
  const names = data.products[0]?.sources.map((s) => s.source) ?? [];
  const head = el('tr', {}, el('th', { className: 'prod', textContent: 'Produto' }), ...names.map((n) => el('th', { textContent: n })),
    el('th', { textContent: 'Média' }), el('th', { textContent: 'Diferença' }));
  const rows = data.products.map((p, pi) => {
    const best = p.stats?.cheapest.source;
    return el('tr', {}, el('td', { className: 'prod' }, p.query, trendLine(trends[pi], since), historyLine(series?.[pi])),
      ...p.sources.map((s) => cell(s, s.source === best, () => onSwap(pi, s.source))),
      el('td', { className: 'cell' }, el('span', { className: 'px', textContent: p.stats ? formatBRL(p.stats.averageBRL) : '—' })),
      el('td', { className: 'cell' }, el('span', { className: 'px', textContent: p.stats ? formatBRL(p.stats.diffBRL) : '—' }),
        p.stats ? el('div', { className: 'sub', textContent: formatPct(p.stats.diffPct) }) : null));
  });
  const { totals, coverage, total, cheapestSource } = data.basket;
  const foot = el('tr', {}, el('td', { className: 'prod', textContent: 'Total da cesta' }),
    ...names.map((n) => {
      const td = el('td', { className: `cell${n === cheapestSource ? ' best' : ''}` });
      if (totals[n] != null) td.append(el('div', { className: 'px', textContent: formatBRL(totals[n]) }), el('div', { className: 'sub', textContent: `${coverage[n]} de ${total} itens` }));
      else td.append(el('span', { className: 'none', textContent: '—' }));
      return td;
    }), el('td'), el('td'));
  const mixed = new Set(Object.values(coverage)).size > 1;
  return el('section', { className: 'panel detail' },
    el('div', { className: 'panel-h' }, el('h2', { textContent: 'Comparação por produto' }), actions),
    el('div', { className: 'scroll' }, el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows), el('tfoot', {}, foot))),
    el('p', { className: 'legend', textContent: `Verde: menor preço do produto, já ajustado ao tamanho pedido. "Incerto": confira o item; ele fica fora da média e da cesta.${mixed ? ' Mercados com menos itens têm total menor por cobrir menos produtos.' : ''}` }));
}

/* ---------- Lista de compras ---------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea', { value: text });
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function storeBlock(s) {
  return el('div', { className: 'store' },
    el('div', { className: 'store-h' }, el('b', { textContent: s.source }), el('span', { textContent: formatBRL(s.subtotalBRL) })),
    ...s.items.map((i) =>
      el('div', { className: 'li' },
        el('span', { className: 'box', ariaHidden: 'true' }),
        el('div', { className: 'li-main' },
          el('div', { textContent: i.query }),
          el('small', { textContent: i.sizeAdjusted ? `${i.title} · tamanho diferente do pedido` : i.title })),
        el('span', { className: 'li-price', textContent: formatBRL(i.priceBRL) }))));
}

function storeInfo(list, perItemTotal) {
  if (list.stores.length === 0) return null;
  const chosen = list.stores[0].source;
  const rec = list.options.find((o) => o.source === list.recommended);
  const faltam = list.missing.length ? ` (faltam: ${list.missing.join(', ')})` : '';
  if (!rec.complete) {
    return el('p', { className: 'note warn', textContent: `Nenhum mercado tem todos os itens. Mostrando ${chosen}${chosen === list.recommended ? ', o que mais tem' : ''}${faltam}.` });
  }
  if (chosen !== list.recommended) {
    const diff = list.equivalentBRL - rec.totalBRL;
    const lead = list.complete ? `Você escolheu ${chosen}.` : `${chosen} não tem todos os itens${faltam}.`;
    const gap = list.complete && diff > 0.005 ? ` Fica ${formatBRL(diff)} a mais.` : '';
    return el('p', { className: list.complete ? 'note' : 'note warn', textContent: `${lead} O mais barato com todos os itens é ${rec.source} (${formatBRL(rec.totalBRL)}).${gap}` });
  }
  const others = list.ranking.slice(1).map((r) => `${r.source} ${formatBRL(r.totalBRL)}`);
  const saving = list.totalBRL - perItemTotal;
  const tail = saving > 0.005 ? ` Item a item, em vários mercados, sairia ${formatBRL(perItemTotal)} (${formatBRL(saving)} a menos).` : '';
  return el('p', { className: 'note', textContent: `Mais barato entre os mercados que têm todos os itens.${others.length ? ` Outros: ${others.join(' · ')}.` : ''}${tail}` });
}

function optionLabel(o, recommended) {
  const base = `${o.source} · ${formatBRL(o.totalBRL)} · ${o.covered} de ${o.findable} itens`;
  const size = o.adjusted > 0 ? ` · ${o.adjusted} em outro tamanho` : '';
  if (o.source === recommended && o.complete) return `${base}${size} · mais barato`;
  return o.complete ? `${base}${size}` : `${base}${size} · incompleto`;
}

function shoppingPanel(data) {
  const perItem = buildShoppingList(data);
  if (perItem.stores.length === 0) return null;
  let { mode, chosen } = shopState;
  let single = buildSingleStoreList(data);
  const current = () => (mode === 'item' ? perItem : single);

  const body = el('div', { className: 'panel-b' });
  const tabItem = el('button', { type: 'button', className: 'tab on', textContent: 'Mais barato por item' });
  const tabStore = el('button', { type: 'button', className: 'tab', textContent: 'Um mercado só' });

  const select = el('select', { id: 'store-select', className: 'select' },
    ...single.options.map((o) => el('option', { value: o.source, textContent: optionLabel(o, single.recommended) })));
  const picker = el('div', { className: 'picker no-print' }, el('label', { htmlFor: 'store-select', textContent: 'Mercado' }), select);
  select.addEventListener('change', () => { chosen = select.value; shopState.chosen = chosen; track('pick_store'); paint(); });

  const paint = () => {
    single = buildSingleStoreList(data, chosen ?? undefined);
    select.value = single.stores[0]?.source ?? '';
    const list = current();
    tabItem.classList.toggle('on', mode === 'item');
    tabStore.classList.toggle('on', mode === 'store');
    body.replaceChildren(...[
      mode === 'store' ? picker : null,
      mode === 'store' ? storeInfo(single, perItem.totalBRL) : null,
      el('div', { className: 'store-grid' }, ...list.stores.map(storeBlock)),
      el('div', { className: 'total' }, mode === 'store' && Math.abs(single.equivalentBRL - single.totalBRL) > 0.005
        ? el('span', { className: 'muted-note', textContent: `equivale a ${formatBRL(single.equivalentBRL)} nos tamanhos pedidos` }) : null,
        el('span', { textContent: 'Total' }), el('b', { textContent: formatBRL(list.totalBRL) })),
      list.missing.length > 0 && !(mode === 'store' && !single.complete) ? el('p', { className: 'muted-note', textContent: `Não encontrados: ${list.missing.join(', ')}` }) : null,
    ].filter(Boolean));
  };
  tabItem.addEventListener('click', () => { if (mode !== 'item') track('tab_item'); mode = 'item'; shopState.mode = mode; paint(); });
  tabStore.addEventListener('click', () => { if (mode !== 'store') track('tab_store'); mode = 'store'; shopState.mode = mode; paint(); });

  const copy = el('button', { type: 'button', className: 'btn', textContent: 'Copiar texto' });
  copy.addEventListener('click', async () => {
    track(mode === 'item' ? 'copy_item' : 'copy_store');
    await copyText(toText(current()));
    copy.textContent = 'Copiado';
    setTimeout(() => { copy.textContent = 'Copiar texto'; }, 2000);
  });
  const print = el('button', { type: 'button', className: 'btn', textContent: 'Imprimir / PDF' });
  print.addEventListener('click', () => {
    track(mode === 'item' ? 'print_item' : 'print_store');
    window.print();
  });

  paint();
  return el('section', { className: 'panel' },
    el('div', { className: 'panel-h' }, el('h2', { textContent: 'Lista de compras' }), el('div', { className: 'no-print', style: 'display:flex;gap:8px' }, copy, print)),
    el('div', { className: 'tabs no-print' }, tabItem, tabStore),
    body);
}

/** Estado da lista de compras que sobrevive a um novo desenho (trocar um item não deve voltar a aba/mercado). */
const shopState = { mode: 'item', chosen: null };
let currentData = null;

let baseline = null;
let historySeries = null; // séries de preço dos últimos dias, na ordem dos produtos
let sharedView = null; // { createdAt } quando a tela mostra um link compartilhado

function render(data, { fresh = true, list, shared = null } = {}) {
  if (fresh) {
    Object.assign(shopState, { mode: 'item', chosen: null });
    sharedView = shared;
    historySeries = null;
    baseline = shared ? null : readSaved()?.snapshot ?? null;
    if (list !== undefined) writeSaved({ list, snapshot: snapshot(data) });
    if (!shared) void syncPush(data);
  }
  currentData = data;
  $('result').replaceChildren(...[
    sharedView ? sharedBanner(data) : null,
    comparisonPanel(data, openSwap, baseline, sharedView ? null : actionControls(), historySeries),
    shoppingPanel(data),
  ].filter(Boolean));
}

/** Busca a tendência dos últimos 30 dias dos produtos e redesenha a tabela com ela. Falha = segue sem tendência. */
async function loadHistory(data) {
  try {
    const res = await fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: data.products.map((p) => p.query) }) });
    if (!res.ok) return;
    const { series } = await res.json();
    if (currentData !== data || !Array.isArray(series) || series.length !== data.products.length) return; // a tela já mudou
    historySeries = series.map((x) => x.points);
    if (historySeries.some((points) => points.length >= 2)) render(data, { fresh: false });
  } catch {
    // sem rede ou servidor ocupado: a comparação continua valendo sem o gráfico
  }
}

/* ---------- Compartilhar o resultado ---------- */
const formatWhen = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function shareControls() {
  const note = el('span', { className: 'muted-note' });
  const button = el('button', { type: 'button', className: 'btn', textContent: 'Compartilhar' });
  button.addEventListener('click', async () => {
    if (!currentData) return;
    button.disabled = true;
    note.textContent = '';
    try {
      const res = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toShareBody(currentData)) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      const { id, expiresAt } = await res.json();
      const url = shareUrl(location.origin, id);
      const validUntil = new Date(expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Cestimo', text: 'Comparação de preços de supermercados', url });
          note.textContent = `Link vale até ${validUntil}.`;
        } catch (e) {
          if (e?.name !== 'AbortError') throw e;
        }
      } else {
        await copyText(url);
        note.textContent = `Link copiado. Vale até ${validUntil}.`;
      }
    } catch (e) {
      note.textContent = `Não foi possível gerar o link: ${e.message}`;
    } finally {
      button.disabled = false;
    }
  });
  return el('div', { className: 'no-print', style: 'display:flex;gap:10px;align-items:center' }, note, button);
}

/* ---------- Avisos de queda de preço ---------- */
const PUSH_KEY = 'cestimo:push';
const readPush = () => { try { return parsePushState(localStorage.getItem(PUSH_KEY)); } catch { return { on: false }; } };
const writePush = (on) => { try { localStorage.setItem(PUSH_KEY, JSON.stringify({ on })); } catch { /* sem armazenamento */ } };
const currentPushMode = () => pushMode({
  hasPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  standalone: isStandalone({ displayModeStandalone: matchMedia('(display-mode: standalone)').matches, navigatorStandalone: navigator.standalone }),
  userAgent: navigator.userAgent,
  touchPoints: navigator.maxTouchPoints,
  permission: 'Notification' in window ? Notification.permission : 'default',
});

const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Quem já ativou os avisos: manda a lista nova para o servidor acompanhar os produtos de agora. Falha = segue com a lista antiga. */
async function syncPush(data) {
  if (!readPush().on || currentPushMode() !== 'ready') return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    const queries = queriesToWatch(data.products);
    if (sub && queries.length > 0) await postJson('/api/push/subscribe', { subscription: sub.toJSON(), queries });
  } catch {
    // sem rede: tenta de novo na próxima comparação
  }
}

async function enablePush(data) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Sem a permissão de notificações, não dá para avisar.');
  const keyRes = await fetch('/api/push/key');
  if (!keyRes.ok) throw new Error('Avisos indisponíveis no momento.');
  const { key } = await keyRes.json();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  const queries = queriesToWatch(data.products);
  if (queries.length === 0) throw new Error('Nenhum produto da lista tem preço para acompanhar.');
  const res = await postJson('/api/push/subscribe', { subscription: sub.toJSON(), queries });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
  writePush(true);
}

async function disablePush() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (sub) {
    await postJson('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  writePush(false);
}

function pushControls() {
  const mode = currentPushMode();
  if (mode === 'unsupported') return null;
  const note = el('span', { className: 'muted-note' });
  const button = el('button', { type: 'button', className: 'btn' });
  const paint = () => { button.textContent = readPush().on ? 'Desativar avisos' : 'Avisar quando baixar'; };
  paint();
  button.addEventListener('click', async () => {
    note.textContent = '';
    if (mode === 'ios-install') { note.textContent = 'No iPhone, instale o app na Tela de Início (botão "Instalar app") e ative o aviso por lá.'; return; }
    if (mode === 'denied') { note.textContent = 'As notificações deste site estão bloqueadas. Libere nas configurações do navegador.'; return; }
    button.disabled = true;
    try {
      if (readPush().on) {
        await disablePush();
        track('push_off');
        note.textContent = 'Avisos desativados.';
      } else {
        await enablePush(currentData);
        track('push_on');
        note.textContent = 'Pronto! Avisamos quando algum item da lista baixar 5% ou mais.';
      }
    } catch (e) {
      note.textContent = e.message;
    } finally {
      paint();
      button.disabled = false;
    }
  });
  return el('div', { className: 'no-print', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, note, button);
}

function actionControls() {
  return el('div', { className: 'no-print', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end' }, pushControls(), shareControls());
}

function sharedBanner(data) {
  const again = el('button', { type: 'button', className: 'btn', textContent: 'Comparar de novo com preços de hoje' });
  again.addEventListener('click', () => {
    $('list').value = data.products.map((p) => p.query).join('\n');
    history.replaceState(null, '', location.pathname);
    compareNow();
  });
  return el('div', { className: 'note shared no-print' },
    el('span', { textContent: `Resultado compartilhado, com os preços de ${formatWhen(sharedView.createdAt)}. Os preços podem ter mudado desde então. ` }), again);
}

async function loadShared(id) {
  setBusy(true, 'Abrindo…');
  $('status').textContent = '';
  try {
    const res = await fetch(`/api/share/${id}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `erro ${res.status}`);
    render(body.result, { shared: { createdAt: body.createdAt } });
  } catch (e) {
    $('status').textContent = `Não foi possível abrir o link: ${e.message}`;
  } finally {
    setBusy(false);
  }
}

/* ---------- Trocar o item escolhido ---------- */
function optionButton(m, isCurrent, onPick) {
  const detail = [m.unitPriceBRL != null ? `${formatBRL(m.unitPriceBRL)}/${m.unit}` : null, m.sizeAdjusted ? `≈ ${formatBRL(m.equivalentBRL)} no tamanho pedido` : null].filter(Boolean).join(' · ');
  return el('button', { type: 'button', className: `opt${isCurrent ? ' on' : ''}`, onclick: onPick },
    el('span', { className: 'opt-main' }, el('span', { className: 'opt-title', textContent: m.title }), detail ? el('small', { textContent: detail }) : null),
    el('span', { className: 'opt-px' }, el('b', { textContent: formatBRL(m.priceBRL) }), isCurrent ? el('small', { textContent: 'Atual' }) : null));
}

function openSwap(productIndex, sourceName) {
  const product = currentData?.products[productIndex];
  const source = product?.sources.find((x) => x.source === sourceName);
  if (!product || !source) return;
  const dialog = el('dialog', { className: 'swap-dialog', ariaLabel: `Trocar item em ${sourceName}` });
  const close = () => { dialog.close(); dialog.remove(); };
  const choose = (choice) => { close(); applySwap(productIndex, sourceName, choice); };
  const alternatives = source.alternatives ?? [];
  dialog.append(
    el('h3', { textContent: product.query }),
    el('p', { className: 'muted-note', textContent: `${sourceName}: escolha o item certo. A média e a lista de compras são recalculadas.` }),
    el('div', { className: 'opts' },
      ...(source.match ? [optionButton(source.match, true, close)] : []),
      ...alternatives.map((m, i) => optionButton(m, false, () => choose(i)))),
    el('div', { className: 'dialog-actions' },
      source.match ? el('button', { type: 'button', className: 'btn', textContent: 'Nenhum destes', onclick: () => choose(null) }) : null,
      source.suggested ? el('button', { type: 'button', className: 'btn', textContent: 'Voltar ao sugerido', onclick: () => choose('suggested') }) : null,
      el('button', { type: 'button', className: 'btn', textContent: 'Fechar', onclick: close })));
  dialog.addEventListener('cancel', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

let recomputing = false;
async function applySwap(productIndex, sourceName, choice) {
  if (recomputing || !currentData) return;
  const next = applyChoice(currentData, productIndex, sourceName, choice);
  if (next === currentData) return;
  recomputing = true;
  $('status').textContent = '';
  track('swap_match');
  try {
    const res = await fetch('/api/recompute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toRecomputeBody(next)) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
    render(mergeRecomputed(next, await res.json()), { fresh: false });
  } catch (e) {
    $('status').textContent = `Não foi possível trocar o item: ${e.message}`;
  } finally {
    recomputing = false;
  }
}

/* ---------- Carregando ---------- */
let loadingTimer = null;
let progress = { done: 0, total: 0 };
let reconnecting = 0;

function startLoading(total, startedAt = Date.now()) {
  progress = { done: 0, total };
  reconnecting = 0;
  const names = SOURCES.length ? SOURCES : ['mercados'];
  const spans = names.map((n) => el('span', { textContent: n }));
  $('chips').replaceChildren(...spans.flatMap((s, i) => (i ? [document.createTextNode(' · '), s] : [s])));
  $('loading').classList.add('on');
  let step = 0;
  const tick = () => {
    spans.forEach((s, i) => s.classList.toggle('on', i === step % spans.length));
    const secs = Math.round((Date.now() - startedAt) / 1000);
    $('load-title').textContent = reconnecting ? 'Reconectando…' : 'Consultando os mercados…';
    $('load-sub').textContent = reconnecting
      ? 'A conexão oscilou. Sua consulta continua no servidor e será retomada.'
      : `${progress.done} de ${progress.total} ${progress.total === 1 ? 'produto' : 'produtos'} · ${secs} s`;
    step++;
  };
  tick();
  loadingTimer = setInterval(tick, 700);
}

function stopLoading() {
  clearInterval(loadingTimer);
  $('loading').classList.remove('on');
}

/* ---------- Consulta em duas etapas (aguenta queda de conexão) ---------- */
const JOB_KEY = 'cestimo.job';
const JOB_MAX_AGE_MS = 9 * 60 * 1000;

function saveJob(job) {
  try { sessionStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch { /* armazenamento indisponível */ }
}
function clearJob() {
  try { sessionStorage.removeItem(JOB_KEY); } catch { /* idem */ }
}
function readSavedJob() {
  try {
    const job = JSON.parse(sessionStorage.getItem(JOB_KEY) ?? 'null');
    return job && Date.now() - job.startedAt < JOB_MAX_AGE_MS ? job : null;
  } catch {
    return null;
  }
}

/** Espera `ms`, mas acorda antes se o celular voltar ao app ou a internet voltar (timers param em segundo plano). */
const wakeableSleep = (ms) =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', finish);
      resolve();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') finish(); };
    const timer = setTimeout(finish, ms);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', finish);
  });

let busy = false;

function setBusy(on, label) {
  busy = on;
  const button = $('go');
  button.disabled = on;
  button.textContent = on ? label : 'Comparar preços';
}

async function followJob(job) {
  setBusy(true, 'Comparando…');
  $('result').replaceChildren();
  $('status').textContent = '';
  startLoading(job.total, job.startedAt);
  try {
    const data = await waitForJob(job.id, {
      sleep: wakeableSleep,
      onProgress: (done, total) => { progress = { done, total }; },
      onReconnecting: (n) => { reconnecting = n; },
    });
    render(data, { list: job.list });
    loadHistory(data);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('status').textContent = e instanceof JobExpiredError
      ? 'A consulta expirou ou o servidor foi reiniciado. Envie a lista de novo.'
      : `Não foi possível comparar: ${e.message}`;
  } finally {
    clearJob();
    stopLoading();
    setBusy(false);
  }
}

async function compareNow() {
  if (busy) return;
  const list = $('list').value;
  setBusy(true, 'Enviando…');
  $('status').textContent = '';
  let job;
  try {
    const { id, total } = await submitJob(list);
    job = { id, total, startedAt: Date.now(), list };
    saveJob(job);
  } catch (e) {
    $('status').textContent = `Não foi possível comparar: ${e.message}`;
    setBusy(false);
    return;
  }
  await followJob(job);
}

$('go').addEventListener('click', compareNow);
$('list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) compareNow();
});

// Se a página foi recarregada no meio de uma consulta (o Safari faz isso ao voltar de outro app), retoma de onde parou.
const savedJob = readSavedJob();
if (savedJob) {
  $('list').value = savedJob.list;
  followJob(savedJob);
}

// Link compartilhado (#r=...): mostra o resultado congelado em vez de uma tela vazia.
const sharedId = parseShareHash(location.hash);
if (sharedId && !savedJob) loadShared(sharedId);

// App instalável: o service worker só guarda a casca da página para abrir sem internet (a rede vem primeiro).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ---------- Instalar como app ---------- */
let installPrompt = null;
const refreshInstall = () => {
  const mode = installMode({
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    userAgent: navigator.userAgent,
    hasPrompt: installPrompt !== null,
    touchPoints: navigator.maxTouchPoints,
  });
  $('install').hidden = mode === 'hidden';
  $('install').dataset.mode = mode;
};
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  refreshInstall();
});
window.addEventListener('appinstalled', () => { track('pwa_install'); installPrompt = null; refreshInstall(); });
$('install').addEventListener('click', async () => {
  track('install_click');
  if ($('install').dataset.mode === 'prompt' && installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    refreshInstall();
    return;
  }
  const dialog = el('dialog', { className: 'swap-dialog', ariaLabel: 'Como instalar no iPhone' },
    el('h3', { textContent: 'Instalar o Cestimo' }),
    el('ol', { className: 'install-steps' },
      el('li', { textContent: 'Toque em Compartilhar (o quadrado com a seta para cima) na barra do Safari.' }),
      el('li', { textContent: 'Role e toque em "Adicionar à Tela de Início".' }),
      el('li', { textContent: 'Toque em "Adicionar". O ícone do Cestimo aparece na tela inicial.' })),
    el('div', { className: 'dialog-actions' }, el('button', { type: 'button', className: 'btn', textContent: 'Entendi', onclick: () => { dialog.close(); dialog.remove(); } })));
  document.body.append(dialog);
  dialog.showModal();
});
refreshInstall();

// Abriu como app instalado? Conta uma vez por sessão (só o nome do evento, nada da pessoa).
let sessionStore = { getItem: () => null, setItem: () => {} };
try { sessionStore = sessionStorage; } catch { /* sem armazenamento */ }
if (pwaOpenOncePerSession(isStandalone({ displayModeStandalone: matchMedia('(display-mode: standalone)').matches, navigatorStandalone: navigator.standalone }), sessionStore)) track('pwa_open');

