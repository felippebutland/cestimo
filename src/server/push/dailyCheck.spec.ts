import { describe, it, expect } from 'vitest';
import { createSubscriptionStore, parseSubscribeBody } from './subscriptions.js';
import { runDailyCheck, type FindPrices, type Send } from './dailyCheck.js';

const add = (store: ReturnType<typeof createSubscriptionStore>, id: string, queries: string[]) => {
  const r = parseSubscribeBody({ subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'BPublicKey_-1234567890', auth: 'AuthSecret_-12' } }, queries });
  if (!r.ok) throw new Error('inválido');
  store.upsert(r.value);
};
const prices = (m: Record<string, { priceBRL: number; source: string } | null>): FindPrices => async (qs) => new Map(qs.map((q) => [q, m[q] ?? null]));

describe('runDailyCheck', () => {
  it('primeiro dia só guarda referências: ninguém é avisado', async () => {
    const store = createSubscriptionStore(); add(store, 'a', ['sal 1kg']);
    const sent: unknown[] = [];
    await runDailyCheck({ store, find: prices({ 'sal 1kg': { priceBRL: 5, source: 'Comper' } }), send: async (_s, p) => { sent.push(p); return 'ok'; } });
    expect(sent).toEqual([]);
    expect(store.getRef('sal 1kg')).toBe(5);
  });
  it('queda de 5% ou mais avisa só quem acompanha aquele produto, e nenhuma busca repete produto', async () => {
    const store = createSubscriptionStore(); add(store, 'a', ['sal 1kg', 'arroz 5kg']); add(store, 'b', ['sal 1kg']); add(store, 'c', ['feijão 1kg']);
    store.setRef('sal 1kg', 5); store.setRef('arroz 5kg', 30); store.setRef('feijão 1kg', 8);
    const asked: string[][] = [];
    const find: FindPrices = async (qs) => { asked.push([...qs]); return new Map([['sal 1kg', { priceBRL: 4.5, source: 'Royal' }], ['arroz 5kg', { priceBRL: 30, source: 'Comper' }], ['feijão 1kg', { priceBRL: 8, source: 'Comper' }]]); };
    const sent: Array<{ to: string; title: string; body: string }> = [];
    const send: Send = async (s, p) => { sent.push({ to: s.endpoint.split('/').pop()!, title: p.title, body: p.body }); return 'ok'; };
    const r = await runDailyCheck({ store, find, send });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.sort()).toEqual(['arroz 5kg', 'feijão 1kg', 'sal 1kg']);
    expect(sent.map((s) => s.to).sort()).toEqual(['a', 'b']);
    expect(sent[0]!.title).toBe('Baixou 10%: sal 1kg');
    expect(sent[0]!.body).toBe('R$ 4,50 no Royal (antes R$ 5,00)');
    expect(r).toMatchObject({ checked: 3, drops: 1, sent: 2 });
    expect(store.getRef('sal 1kg')).toBe(4.5);
  });
  it('produto sem preço confiável hoje não muda a referência nem avisa', async () => {
    const store = createSubscriptionStore(); add(store, 'a', ['sal 1kg']); store.setRef('sal 1kg', 5);
    const sent: unknown[] = [];
    await runDailyCheck({ store, find: prices({}), send: async (_s, p) => { sent.push(p); return 'ok'; } });
    expect(sent).toEqual([]);
    expect(store.getRef('sal 1kg')).toBe(5);
  });
  it('aparelho que o serviço de push diz que sumiu (gone) é removido; falha passageira não remove', async () => {
    const store = createSubscriptionStore(); add(store, 'velho', ['sal 1kg']); add(store, 'oscila', ['sal 1kg']); add(store, 'ok', ['sal 1kg']);
    store.setRef('sal 1kg', 5);
    const send: Send = async (s) => (s.endpoint.endsWith('velho') ? 'gone' : s.endpoint.endsWith('oscila') ? 'erro' : 'ok');
    const r = await runDailyCheck({ store, find: prices({ 'sal 1kg': { priceBRL: 4, source: 'Comper' } }), send });
    expect(store.all().map((s) => s.subscription.endpoint.split('/').pop()).sort()).toEqual(['ok', 'oscila']);
    expect(r).toMatchObject({ sent: 1, removed: 1, failed: 1 });
  });
  it('sem inscrições não busca nada', async () => {
    let called = false;
    await runDailyCheck({ store: createSubscriptionStore(), find: async () => { called = true; return new Map(); }, send: async () => 'ok' });
    expect(called).toBe(false);
  });
  it('erro ao enviar para um aparelho não impede os outros', async () => {
    const store = createSubscriptionStore(); add(store, 'a', ['sal 1kg']); add(store, 'b', ['sal 1kg']); store.setRef('sal 1kg', 5);
    const sent: string[] = [];
    const send: Send = async (s) => { if (s.endpoint.endsWith('a')) throw new Error('boom'); sent.push(s.endpoint); return 'ok'; };
    await runDailyCheck({ store, find: prices({ 'sal 1kg': { priceBRL: 4, source: 'Comper' } }), send });
    expect(sent).toHaveLength(1);
  });
});
