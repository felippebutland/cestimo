import type { PricePoint } from '../history.js';
import type { PushSubscription } from '../push/subscriptions.js';
import type { SendResult } from '../push/dailyCheck.js';
import type { PanelCategory, TrackedItem } from './panelStore.js';
import { summarizeTracked } from './trackedSummary.js';

export type NotifyItem = TrackedItem & { userId: number; notifiedDay: string | null };
export type Drop = { query: string; latestBRL: number; source: string; prevBRL: number; dropPct: number };

const brl = (n: number): string => `R$ ${n.toFixed(2).replace('.', ',')}`;
const pct = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

/** Texto do aviso: um produto mostra preço novo, loja e preço anterior; vários viram um resumo só (um aviso por pessoa). */
export function dropNotification(drops: Drop[]): { title: string; body: string; url: string } {
  const url = '/#acompanhando';
  if (drops.length === 1) {
    const d = drops[0]!;
    return { title: `Caiu ${pct(d.dropPct)}%: ${d.query}`, body: `${brl(d.latestBRL)} no ${d.source} (era ${brl(d.prevBRL)})`, url };
  }
  const names = drops.map((d) => d.query);
  const body = names.length <= 3 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`;
  return { title: `${drops.length} produtos que você acompanha baixaram`, body, url };
}

/**
 * Depois da rotina diária: quem acompanha um produto cujo menor preço de hoje caiu 5% ou mais recebe um aviso em cada aparelho.
 * Um aviso por pessoa; o produto só é marcado como avisado se ao menos um aparelho recebeu (senão tenta de novo na próxima rodada).
 */
export async function notifyTrackedDrops(p: {
  day: string;
  items: NotifyItem[];
  devicesOf: (userId: number) => PushSubscription[];
  seriesOf: (query: string, category: PanelCategory) => PricePoint[];
  send: (sub: PushSubscription, payload: { title: string; body: string; url?: string }) => Promise<SendResult>;
  markNotified: (itemId: number) => void;
  removeDevice: (endpoint: string) => void;
}): Promise<{ users: number; drops: number; sent: number; gone: number; failed: number }> {
  const out = { users: 0, drops: 0, sent: 0, gone: 0, failed: 0 };
  const byUser = new Map<number, Array<{ item: NotifyItem; drop: Drop }>>();
  for (const item of p.items) {
    if (item.notifiedDay === p.day) continue;
    const series = p.seriesOf(item.query, item.category);
    const baseline = item.startPrice !== null && item.startSource ? { priceBRL: item.startPrice, source: item.startSource } : null;
    const s = summarizeTracked(series, p.day, baseline);
    if (!s.dropped || s.latestDay !== p.day || s.latestBRL === null || s.latestSource === null || s.dropPct === null) continue;
    const prevBRL = series.at(-2)?.cheapestBRL ?? baseline?.priceBRL ?? s.latestBRL;
    const list = byUser.get(item.userId) ?? [];
    list.push({ item, drop: { query: item.query, latestBRL: s.latestBRL, source: s.latestSource, prevBRL, dropPct: s.dropPct } });
    byUser.set(item.userId, list);
  }
  for (const [userId, entries] of byUser) {
    const devices = p.devicesOf(userId);
    if (devices.length === 0) continue;
    const payload = dropNotification(entries.map((e) => e.drop));
    let delivered = false;
    for (const device of devices) {
      const result = await p.send(device, payload).catch((): SendResult => 'erro');
      if (result === 'ok') { out.sent++; delivered = true; }
      else if (result === 'gone') { out.gone++; p.removeDevice(device.endpoint); }
      else out.failed++;
    }
    out.users++;
    out.drops += entries.length;
    if (delivered) for (const e of entries) p.markNotified(e.item.id);
  }
  return out;
}
