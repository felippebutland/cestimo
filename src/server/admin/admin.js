const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};
const int = (n) => Math.round(n).toLocaleString('pt-BR');
const dec = (n, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const pct = (n) => `${dec(n * 100, 0)}%`;

const EVENT_LABELS = {
  copy_item: 'Copiou a lista (mais barato por item)',
  copy_store: 'Copiou a lista (um mercado só)',
  print_item: 'Imprimiu (mais barato por item)',
  print_store: 'Imprimiu (um mercado só)',
  tab_item: 'Abriu "mais barato por item"',
  tab_store: 'Abriu "um mercado só"',
  pick_store: 'Trocou de mercado no seletor',
  swap_match: 'Trocou o item escolhido',
  pwa_open: 'Abriu o app instalado (PWA)',
  pwa_install: 'Instalou o app',
  switch_category: 'Trocou entre mercados e farmácias',
  filter_market: 'Filtrou a comparação por mercado',
  push_on: 'Ativou aviso de queda de preço',
  push_off: 'Desativou aviso de queda de preço',
  install_click: 'Tocou em "Instalar app"',
  example: 'Usou um exemplo',
};

function card(label, value, hint, highlight = false) {
  return el('div', { className: `card${highlight ? ' hl' : ''}` },
    el('div', { className: 'label', textContent: label }),
    el('div', { className: 'num', textContent: value }),
    hint ? el('div', { className: 'hint', textContent: hint }) : null);
}

function renderCards(t) {
  const foundRate = t.itemsFound + t.itemsMissing > 0 ? t.itemsFound / (t.itemsFound + t.itemsMissing) : 0;
  $('cards').replaceChildren(
    card('Visitas', int(t.pageViews), 'abriram a página'),
    card('Comparações', int(t.compares), t.pageViews ? `${dec(t.compares / t.pageViews)} por visita` : ''),
    card('Itens buscados', int(t.items), `${dec(t.avgItemsPerList)} por lista`),
    card('Listas copiadas', int(t.copies), `${pct(t.copyRate)} das comparações`, true),
    card('Impressões', int(t.prints), 'imprimir / PDF'),
    card('Economia estimada', brl(t.savingsBRL), 'preço médio − mais barato', true),
    card('Itens encontrados', pct(foundRate), `${int(t.itemsFound)} de ${int(t.itemsFound + t.itemsMissing)}`),
    card('Tempo médio', `${dec(t.avgSeconds)} s`, 'por comparação'),
  );
}

function barChart(title, days, key, format = int) {
  const values = days.map((d) => d.values[key] ?? 0);
  const max = Math.max(1, ...values);
  const w = 280, h = 110, pad = 14, bw = w / values.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title} por dia`);
  values.forEach((v, i) => {
    const bh = (v / max) * (h - pad - 14);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('class', `bar${i === values.length - 1 ? ' today' : ''}`);
    rect.setAttribute('x', String(i * bw + 2));
    rect.setAttribute('y', String(h - pad - bh));
    rect.setAttribute('width', String(bw - 4));
    rect.setAttribute('height', String(Math.max(v > 0 ? 1.5 : 0, bh)));
    rect.setAttribute('rx', '2');
    const tip = document.createElementNS(ns, 'title');
    tip.textContent = `${days[i].date.slice(8)}/${days[i].date.slice(5, 7)}: ${format(v)}`;
    rect.append(tip);
    svg.append(rect);
    if (i % 3 === values.length % 3 || i === values.length - 1) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(i * bw + bw / 2));
      t.setAttribute('y', String(h - 2));
      t.textContent = days[i].date.slice(8);
      svg.append(t);
    }
  });
  const total = values.reduce((a, b) => a + b, 0);
  return el('div', { className: 'panel chart' }, el('h3', {}, title, el('b', { textContent: format(total) })), svg);
}

function renderCharts(days) {
  $('charts').replaceChildren(
    barChart('Visitas', days, 'page_view'),
    barChart('Comparações', days, 'compare'),
    barChart('Itens buscados', days, 'items'),
    barChart('Listas copiadas', days, 'copy'),
    barChart('Economia estimada', days, 'savings', brl),
  );
}

function renderSources(sources) {
  const head = el('tr', {}, ...['Mercado', 'found', 'empty', 'erro', 'indisp.', 'sucesso', 'tempo'].map((h) => el('th', { textContent: h })));
  const rows = [...sources].sort((a, b) => a.source.localeCompare(b.source)).map((s) => {
    const total = s.found + s.empty + s.erro + s.indisponivel;
    const ok = total ? (s.found + s.empty) / total : 1;
    return el('tr', {}, el('td', { textContent: s.source }), el('td', { textContent: int(s.found) }), el('td', { textContent: int(s.empty) }),
      el('td', { className: s.erro ? 'bad' : '', textContent: int(s.erro) }), el('td', { className: s.indisponivel ? 'warn' : '', textContent: int(s.indisponivel) }),
      el('td', { className: ok < 0.9 ? 'bad' : ok < 1 ? 'warn' : 'ok', textContent: pct(ok) }),
      el('td', { textContent: `${dec(s.avgMs / 1000)} s` }));
  });
  $('sources').replaceChildren(el('thead', {}, head), el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 7, textContent: 'Ainda sem buscas.' }))])));
}

function renderTop(top) {
  const max = Math.max(1, ...top.map((t) => t.count));
  $('top').replaceChildren(...(top.length ? top.slice(0, 12).map((t) =>
    el('div', { className: 'rank-row' }, el('span', { textContent: t.term }),
      el('div', { className: 'bar' }, el('i', { style: `width:${(t.count / max) * 100}%` })),
      el('span', { textContent: int(t.count) })))
    : [el('p', { className: 'muted', textContent: 'Ainda sem buscas.' })]));
}

function renderClients(clients, pageViews) {
  const total = (items) => items.reduce((t, i) => t + i.count, 0);
  const fill = (id, items) => {
    const sum = total(items);
    const max = Math.max(1, ...items.map((i) => i.count));
    $(id).replaceChildren(...(items.length ? items.map((i) =>
      el('div', { className: 'rank-row wide' }, el('span', { textContent: i.name }),
        el('div', { className: 'bar' }, el('i', { style: `width:${(i.count / max) * 100}%` })),
        el('span', { textContent: `${int(i.count)} · ${pct(i.count / sum)}` })))
      : [el('p', { className: 'muted', textContent: 'Ainda sem visitas.' })]));
  };
  fill('dev', clients.device);
  fill('os', clients.os);
  fill('browser', clients.browser);
  const known = total(clients.device);
  const notes = [];
  if (clients.bots > 0) notes.push(`${int(clients.bots)} visita(s) de robôs (monitores, buscadores, scripts) ficam de fora dos números acima.`);
  if (pageViews > known) notes.push(`${int(pageViews - known)} visita(s) anteriores a este recurso não têm aparelho registrado.`);
  $('bots').textContent = notes.join(' ');
}

function renderEvents(events) {
  const rows = Object.entries(EVENT_LABELS).map(([k, label]) => el('tr', {}, el('td', { textContent: label }), el('td', { textContent: int(events[k] ?? 0) })));
  $('events').replaceChildren(el('tbody', {}, ...rows));
}

function renderIgnore(ignored) {
  const box = $('ignore');
  box.className = `ignore${ignored ? ' on' : ''}`;
  const button = el('button', { type: 'button', textContent: ignored ? 'Voltar a contar meus acessos' : 'Ignorar meus acessos' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    await fetch('/admin/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: !ignored }) });
    load();
  });
  box.replaceChildren(
    el('span', { textContent: ignored
      ? 'Os acessos feitos neste navegador (visitas, comparações e cliques) não entram nas contagens.'
      : 'Os acessos feitos neste navegador estão sendo contados, inclusive os seus.' }),
    button);
}

async function load() {
  try {
    const res = await fetch('/admin/stats', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    renderCards(d.totals);
    renderCharts(d.days);
    renderSources(d.sources);
    renderTop(d.top);
    renderIgnore(d.ignoredNow);
    renderClients(d.clients, d.totals.pageViews);
    renderEvents(d.events);
    $('err').textContent = '';
    $('updated').textContent = `No ar há ${dec(d.uptimeSeconds / 3600)} h · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · renova a cada 30 s`;
  } catch (e) {
    $('err').textContent = `Não foi possível carregar os números: ${e.message}`;
  }
}

load();
setInterval(load, 30_000);
