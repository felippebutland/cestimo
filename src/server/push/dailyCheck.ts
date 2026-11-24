import { dropMessage, evaluateDrop } from './drops.js';
import { stripPharmacyPrefix } from './findPrices.js';
import type { PushSubscription, SubscriptionStore } from './subscriptions.js';

export type FoundPrice = { priceBRL: number; source: string };
/** Menor preço confiável de cada produto hoje (null = não achou). Uma busca por produto, não por pessoa. */
export type FindPrices = (queries: string[]) => Promise<Map<string, FoundPrice | null>>;
export type SendResult = 'ok' | 'gone' | 'erro';
export type Send = (subscription: PushSubscription, payload: { title: string; body: string; url?: string }) => Promise<SendResult>;

export type CheckSummary = { checked: number; drops: number; sent: number; removed: number; failed: number };

type Drop = { query: string; source: string; priceBRL: number; previousBRL: number; pct: number };

export async function runDailyCheck(deps: { store: SubscriptionStore; find: FindPrices; send: Send }): Promise<CheckSummary> {
  const { store, find, send } = deps;
  const summary: CheckSummary = { checked: 0, drops: 0, sent: 0, removed: 0, failed: 0 };
  if (store.size() === 0) return summary;

  const found = await find(store.queries());
  const drops = new Map<string, Drop>();
  for (const [query, price] of found) {
    if (!price) continue;
    summary.checked += 1;
    const previous = store.getRef(query);
    const decision = evaluateDrop(previous, price.priceBRL);
    if (decision.action !== 'keep') store.setRef(query, decision.ref);
    if (decision.action === 'notify' && previous !== undefined) {
      drops.set(query, { query: stripPharmacyPrefix(query), source: price.source, priceBRL: price.priceBRL, previousBRL: previous, pct: decision.pct });
    }
  }
  summary.drops = drops.size;

  for (const { subscription, queries } of store.all()) {
    for (const query of queries) {
      const drop = drops.get(query);
      if (!drop) continue;
      const result = await send(subscription, dropMessage(drop)).catch((): SendResult => 'erro');
      if (result === 'ok') summary.sent += 1;
      else if (result === 'gone') { store.remove(subscription.endpoint); summary.removed += 1; break; }
      else summary.failed += 1;
    }
  }
  store.pruneRefs();
  return summary;
}
