/** Painel de quem está logado: textos e formatos (tudo puro). */

const pct = (n) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;

export function changeBadge(s) {
  if (s.latestBRL == null) return { kind: 'none', text: 'Aguardando o primeiro preço' };
  if (s.dropped) return { kind: 'drop', text: `Caiu ${pct(s.dropPct)}` };
  if (s.changePct == null) return { kind: 'flat', text: 'Acompanhando' };
  if (s.changePct <= -0.5) return { kind: 'down', text: `${pct(-s.changePct)} mais barato desde que você começou` };
  if (s.changePct >= 0.5) return { kind: 'up', text: `${pct(s.changePct)} mais caro desde que você começou` };
  return { kind: 'flat', text: 'Preço estável' };
}

const CATEGORY_NAME = { mercados: 'Mercados', farmacias: 'Farmácias' };

export function listLabel(l) {
  const n = l.list.split('\n').filter(Boolean).length;
  return `${n} ${n === 1 ? 'item' : 'itens'} · ${CATEGORY_NAME[l.category] ?? l.category}`;
}

export const defaultListName = (date) => `Lista de ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;

export const sparkPoints = (prices) => prices.map((p) => ({ cheapestBRL: p }));

/* ---------- Lista de compras salva (preços, variação e itens marcados) ---------- */

/** Mesma chave do servidor para identificar um item: sem acento, caixa e espaços repetidos. */
export const itemKey = (query) => query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

const money = (n) => `R$ ${n.toFixed(2).replace('.', ',')}`;
const cheapestOf = (p) => p.stats?.cheapest?.priceBRL ?? null;
const change = (from, to) => {
  const diff = Math.round((to - from) * 100) / 100;
  return { fromBRL: from, toBRL: to, diffBRL: diff, pct: from > 0 ? ((to - from) / from) * 100 : 0, kind: diff < 0 ? 'down' : diff > 0 ? 'up' : 'same' };
};

/**
 * Variação do resultado atual da lista contra os preços da foto anterior (`prev.prices`, por item).
 * Só entram os itens com preço nos dois momentos; o total soma só esses.
 */
export function changesSince(result, prev) {
  const items = new Map();
  if (!prev) return { items, total: null };
  let from = 0;
  let to = 0;
  for (const p of result.products) {
    const key = itemKey(p.query);
    const now = cheapestOf(p);
    const before = prev.prices[key];
    if (now === null || typeof before !== 'number') continue;
    items.set(key, change(before, now));
    from += before;
    to += now;
  }
  return { items, total: items.size > 0 ? change(Math.round(from * 100) / 100, Math.round(to * 100) / 100) : null };
}

export function changeLabel(c) {
  if (c.kind === 'same') return 'igual';
  return `${c.kind === 'down' ? '↓' : '↑'} ${money(Math.abs(c.diffBRL))} (${pct(Math.abs(c.pct))})`;
}

/** Quantos itens da lista já foram marcados (marcado que não é mais da lista não conta). */
export function progress(keys, checked) {
  const done = keys.filter((k) => checked.includes(k)).length;
  return { done, total: keys.length, label: `${done} de ${keys.length}` };
}

export const toggleChecked = (checked, key) => (checked.includes(key) ? checked.filter((k) => k !== key) : [...checked, key]);

const two = (n) => String(n).padStart(2, '0');
export function ageLabel(at) {
  const d = new Date(at);
  return `preços de ${two(d.getDate())}/${two(d.getMonth() + 1)} às ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const isStale = (at, now) => now - at > STALE_AFTER_MS;

/** O que mostrar no painel sobre o aviso de queda no celular, conforme o aparelho e se já está ligado. */
export function pushPanelState({ mode, on }) {
  if (mode === 'unsupported') return { show: false };
  if (mode === 'ios-install') return { show: true, action: null, button: null, note: 'No iPhone, instale o Cestimo na Tela de Início (Compartilhar → Adicionar à Tela de Início) e ative o aviso por lá.' };
  if (mode === 'denied') return { show: true, action: null, button: null, note: 'As notificações deste site estão bloqueadas. Libere nas configurações do navegador para receber o aviso.' };
  return on
    ? { show: true, action: 'disable', button: 'Desativar aviso neste aparelho', note: 'Aviso ativo: quando o preço de um produto baixar 5% ou mais, mandamos uma notificação para este aparelho.' }
    : { show: true, action: 'enable', button: '🔔 Ativar aviso neste aparelho', note: 'Receba uma notificação neste aparelho quando o preço de um produto que você acompanha baixar 5% ou mais.' };
}

/**
 * Os itens achados vêm em embalagens de tamanhos diferentes (40, 70 e 84 fraldas)? Então o menor preço total não é o mais barato
 * de verdade, e vale comparar pelo preço por unidade. Só conta item confiável, no tamanho em que foi achado.
 */
export function sizesDiffer(product) {
  const packs = product.sources.flatMap((s) => {
    const m = s.match;
    return m && !m.uncertain && !m.sizeAdjusted && m.unitPriceBRL ? [m.priceBRL / m.unitPriceBRL] : [];
  });
  return packs.length >= 2 && Math.max(...packs) / Math.min(...packs) > 1.05;
}
