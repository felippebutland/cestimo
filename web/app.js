import { formatBRL, formatPct } from './format.js';
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
function cell(s, isBest) {
  const td = el('td', { className: `cell${isBest ? ' best' : ''}` });
  if (!s.match) {
    const label = s.status === 'erro' ? 'Erro' : s.status === 'indisponivel' ? 'Indisponível' : 'Sem resultado';
    td.append(el('span', { className: s.status === 'erro' ? 'flag bad' : 'none', textContent: label, title: s.reason ?? '' }));
    return td;
  }
  const m = s.match;
  const title = m.url ? el('a', { href: m.url, target: '_blank', rel: 'noopener', textContent: m.title }) : m.title;
  td.append(el('div', { className: 'px', textContent: formatBRL(m.priceBRL) }), el('div', { className: 'sub', title: m.title }, title));
  const extra = [m.unitPriceBRL != null ? `${formatBRL(m.unitPriceBRL)}/${m.unit}` : null, m.sizeAdjusted ? `≈ ${formatBRL(m.equivalentBRL)} no tamanho pedido` : null].filter(Boolean);
  if (extra.length) td.append(el('div', { className: 'sub', textContent: extra.join(' · ') }));
  if (m.uncertain) td.append(el('div', { className: 'flag', textContent: 'Incerto, confira', title: s.reason ?? 'Fora da média e da cesta' }));
  return td;
}

function comparisonPanel(data) {
  const names = data.products[0]?.sources.map((s) => s.source) ?? [];
  const head = el('tr', {}, el('th', { className: 'prod', textContent: 'Produto' }), ...names.map((n) => el('th', { textContent: n })),
    el('th', { textContent: 'Média' }), el('th', { textContent: 'Diferença' }));
  const rows = data.products.map((p) => {
    const best = p.stats?.cheapest.source;
    return el('tr', {}, el('td', { className: 'prod', textContent: p.query }),
      ...p.sources.map((s) => cell(s, s.source === best)),
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
  let mode = 'item';
  let chosen = null;
  let single = buildSingleStoreList(data);
  const current = () => (mode === 'item' ? perItem : single);

  const body = el('div', { className: 'panel-b' });
  const tabItem = el('button', { type: 'button', className: 'tab on', textContent: 'Mais barato por item' });
  const tabStore = el('button', { type: 'button', className: 'tab', textContent: 'Um mercado só' });

  const select = el('select', { id: 'store-select', className: 'select' },
    ...single.options.map((o) => el('option', { value: o.source, textContent: optionLabel(o, single.recommended) })));
  const picker = el('div', { className: 'picker no-print' }, el('label', { htmlFor: 'store-select', textContent: 'Mercado' }), select);
  select.addEventListener('change', () => { chosen = select.value; track('pick_store'); paint(); });

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
  tabItem.addEventListener('click', () => { if (mode !== 'item') track('tab_item'); mode = 'item'; paint(); });
  tabStore.addEventListener('click', () => { if (mode !== 'store') track('tab_store'); mode = 'store'; paint(); });

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

function render(data) {
  $('result').replaceChildren(...[comparisonPanel(data), shoppingPanel(data)].filter(Boolean));
}

/* ---------- Carregando ---------- */
let loadingTimer = null;

function startLoading(items) {
  const names = SOURCES.length ? SOURCES : ['mercados'];
  const spans = names.map((n) => el('span', { textContent: n }));
  $('chips').replaceChildren(...spans.flatMap((s, i) => (i ? [document.createTextNode(' · '), s] : [s])));
  $('loading').classList.add('on');
  const t0 = Date.now();
  let step = 0;
  const tick = () => {
    spans.forEach((s, i) => s.classList.toggle('on', i === step % spans.length));
    $('load-sub').textContent = `${items} ${items === 1 ? 'produto' : 'produtos'} · ${Math.round((Date.now() - t0) / 1000)} s`;
    step++;
  };
  tick();
  loadingTimer = setInterval(tick, 700);
}

function stopLoading() {
  clearInterval(loadingTimer);
  $('loading').classList.remove('on');
}

/* ---------- Ação ---------- */
async function compareNow() {
  const button = $('go');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Comparando…';
  $('result').replaceChildren();
  $('status').textContent = '';
  startLoading($('list').value.split('\n').filter((l) => l.trim()).length || 1);
  try {
    const res = await fetch('/api/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: $('list').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    render(data);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('status').textContent = `Não foi possível comparar: ${e.message}`;
  } finally {
    stopLoading();
    button.disabled = false;
    button.textContent = 'Comparar preços';
  }
}

$('go').addEventListener('click', compareNow);
$('list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) compareNow();
});
