import { describe, it, expect } from 'vitest';
import { dropNotification, notifyTrackedDrops, type NotifyItem } from './trackedNotify.js';
import type { PricePoint } from '../history.js';

const pt = (day: string, p: number, source = 'Comper'): PricePoint => ({ day, cheapestBRL: p, cheapestSource: source, averageBRL: p, sources: 2 });
const DAY = '2026-11-25';
const item = (id: number, userId: number, query: string, over: Partial<NotifyItem> = {}): NotifyItem => ({ id, userId, query, category: 'mercados', createdAt: 0, startPrice: null, startSource: null, notifiedDay: null, ...over });
const dev = (n: string) => ({ endpoint: `https://fcm.googleapis.com/${n}`, keys: { p256dh: 'p', auth: 'a' } });

type Sent = { endpoint: string; title: string; body: string; url?: string };
function run(over: { items?: NotifyItem[]; series?: Record<string, PricePoint[]>; devices?: Record<number, ReturnType<typeof dev>[]>; result?: 'ok' | 'gone' | 'erro' } = {}) {
  const sent: Sent[] = [];
  const marked: number[] = [];
  const removed: string[] = [];
  const out = notifyTrackedDrops({
    day: DAY,
    items: over.items ?? [],
    devicesOf: (u) => over.devices?.[u] ?? [],
    seriesOf: (q) => over.series?.[q] ?? [],
    send: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...payload }); return over.result ?? 'ok'; },
    markNotified: (id) => { marked.push(id); },
    removeDevice: (endpoint) => { removed.push(endpoint); },
  });
  return { out, sent, marked, removed };
}

describe('dropNotification', () => {
  it('um produto: queda, preço novo, loja e preço anterior', () => {
    expect(dropNotification([{ query: 'Leite integral 1L', latestBRL: 4.4, source: 'Comper', prevBRL: 4.9, dropPct: 10.2 }])).toEqual({
      title: 'Caiu 10,2%: Leite integral 1L',
      body: 'R$ 4,40 no Comper (era R$ 4,90)',
      url: '/#acompanhando',
    });
  });
  it('vários: título conta quantos, corpo lista até 3 e diz quantos faltam', () => {
    const d = (q: string) => ({ query: q, latestBRL: 1, source: 'X', prevBRL: 2, dropPct: 50 });
    const n = dropNotification([d('A'), d('B'), d('C'), d('D'), d('E')]);
    expect(n.title).toBe('5 produtos que você acompanha baixaram');
    expect(n.body).toBe('A, B, C e mais 2');
  });
  it('dois ou três: lista todos', () => {
    const d = (q: string) => ({ query: q, latestBRL: 1, source: 'X', prevBRL: 2, dropPct: 50 });
    expect(dropNotification([d('A'), d('B')]).body).toBe('A e B');
    expect(dropNotification([d('A'), d('B'), d('C')]).body).toBe('A, B e C');
  });
});

describe('notifyTrackedDrops', () => {
  const dropped = { 'Leite 1L': [pt('2026-11-24', 5), pt(DAY, 4.5)] };
  it('avisa os aparelhos de quem acompanha quando o preço de hoje caiu 5% ou mais', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L')], series: dropped, devices: { 7: [dev('a'), dev('b')] } });
    const res = await r.out;
    expect(r.sent.map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/a', 'https://fcm.googleapis.com/b']);
    expect(r.sent[0]!.title).toBe('Caiu 10%: Leite 1L');
    expect(r.marked).toEqual([1]);
    expect(res).toMatchObject({ users: 1, drops: 1, sent: 2, gone: 0, failed: 0 });
  });
  it('queda pequena, alta, preço velho (de outro dia) ou sem histórico: não avisa', async () => {
    const r = run({
      items: [item(1, 7, 'A'), item(2, 7, 'B'), item(3, 7, 'C'), item(4, 7, 'D')],
      series: { A: [pt('2026-11-24', 5), pt(DAY, 4.9)], B: [pt('2026-11-24', 5), pt(DAY, 6)], C: [pt('2026-11-22', 5), pt('2026-11-23', 3)], D: [] },
      devices: { 7: [dev('a')] },
    });
    await r.out;
    expect(r.sent).toEqual([]);
    expect(r.marked).toEqual([]);
  });
  it('não repete no mesmo dia (notifiedDay = hoje)', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L', { notifiedDay: DAY })], series: dropped, devices: { 7: [dev('a')] } });
    await r.out;
    expect(r.sent).toEqual([]);
  });
  it('vários produtos do mesmo usuário viram uma notificação só (por aparelho)', async () => {
    const series = { 'Leite 1L': dropped['Leite 1L']!, 'Sal 1kg': [pt('2026-11-24', 4), pt(DAY, 3)] };
    const r = run({ items: [item(1, 7, 'Leite 1L'), item(2, 7, 'Sal 1kg')], series, devices: { 7: [dev('a')] } });
    await r.out;
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.title).toBe('2 produtos que você acompanha baixaram');
    expect(r.marked.sort()).toEqual([1, 2]);
  });
  it('usuários diferentes recebem cada um o seu', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L'), item(2, 8, 'Leite 1L')], series: dropped, devices: { 7: [dev('a')], 8: [dev('b')] } });
    await r.out;
    expect(r.sent.map((s) => s.endpoint).sort()).toEqual(['https://fcm.googleapis.com/a', 'https://fcm.googleapis.com/b']);
  });
  it('sem aparelho cadastrado, não faz nada e não marca', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L')], series: dropped, devices: {} });
    await r.out;
    expect(r.sent).toEqual([]);
    expect(r.marked).toEqual([]);
  });
  it('aparelho que não existe mais (gone) é removido; se nenhum recebeu, não marca como avisado', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L')], series: dropped, devices: { 7: [dev('a')] }, result: 'gone' });
    const res = await r.out;
    expect(r.removed).toEqual(['https://fcm.googleapis.com/a']);
    expect(r.marked).toEqual([]);
    expect(res.gone).toBe(1);
  });
  it('falha de envio conta como falha e tenta de novo na próxima rodada', async () => {
    const r = run({ items: [item(1, 7, 'Leite 1L')], series: dropped, devices: { 7: [dev('a')] }, result: 'erro' });
    const res = await r.out;
    expect(res.failed).toBe(1);
    expect(r.marked).toEqual([]);
  });
});
