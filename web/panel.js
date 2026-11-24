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
