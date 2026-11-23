import { formatBRL, formatPct } from './format.js';
import { JobExpiredError, submitJob, waitForJob } from './jobs.js';
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
  const title = m.url ? el('a', { href: m.url, target: '_blank', rel: 'noopener', textContent: m.title }) : m.title;
  td.append(el('div', { className: 'px', textContent: formatBRL(m.priceBRL) }), el('div', { className: 'sub', title: m.title }, title));
  const extra = [m.unitPriceBRL != null ? `${formatBRL(m.unitPriceBRL)}/${m.unit}` : null, m.sizeAdjusted ? `≈ ${formatBRL(m.equivalentBRL)} no tamanho pedido` : null].filter(Boolean);
  if (extra.length) td.append(el('div', { className: 'sub', textContent: extra.join(' · ') }));
  if (m.chosenByUser) td.append(el('div', { className: 'flag chosen', textContent: 'Escolhido por você' }));
  else if (m.uncertain) td.append(el('div', { className: 'flag', textContent: 'Incerto, confira', title: s.reason ?? 'Fora da média e da cesta' }));
  if (hasOptions) td.append(swapButton(m.chosenByUser ? 'Trocar de novo' : 'Não é esse?', onSwap));
  return td;
}

function comparisonPanel(data, onSwap) {
  const names = data.products[0]?.sources.map((s) => s.source) ?? [];
  const head = el('tr', {}, el('th', { className: 'prod', textContent: 'Produto' }), ...names.map((n) => el('th', { textContent: n })),
    el('th', { textContent: 'Média' }), el('th', { textContent: 'Diferença' }));
  const rows = data.products.map((p, pi) => {
    const best = p.stats?.cheapest.source;
    return el('tr', {}, el('td', { className: 'prod', textContent: p.query }),
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
    el('div', { className: 'panel-h' }, el('h2', { textContent: 'Comparação por produto' })),
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

function render(data, { fresh = true } = {}) {
  if (fresh) Object.assign(shopState, { mode: 'item', chosen: null });
  currentData = data;
  $('result').replaceChildren(...[comparisonPanel(data, openSwap), shoppingPanel(data)].filter(Boolean));
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
    render(data);
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
