import { describe, it, expect } from 'vitest';
import { parseSubscribeBody, createSubscriptionStore, MAX_QUERIES } from './subscriptions.js';

const sub = (over: Record<string, unknown> = {}) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPublicKey_-1234567890', auth: 'AuthSecret_-12' },
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({ subscription: sub(), queries: ['Leite integral 1L', 'Sal 1kg'], ...over });

describe('parseSubscribeBody', () => {
  it('aceita inscrição de serviço de push conhecido e normaliza os produtos', () => {
    const r = parseSubscribeBody(body());
    expect(r).toEqual({ ok: true, value: { subscription: sub(), queries: ['leite integral 1l', 'sal 1kg'] } });
  });
  it.each([
    ['http://fcm.googleapis.com/x'],
    ['https://evil.example.com/x'],
    ['https://localhost/x'],
    ['https://169.254.169.254/latest'],
    ['https://fcm.googleapis.com.evil.com/x'],
    ['javascript:alert(1)'],
    ['https://' + 'a'.repeat(600) + '.googleapis.com/x'],
  ])('recusa endpoint fora da lista de serviços de push (%s): evita o servidor ser usado para chamar qualquer endereço', (endpoint) => {
    expect(parseSubscribeBody(body({ subscription: sub({ endpoint }) })).ok).toBe(false);
  });
  it.each([
    ['https://updates.push.services.mozilla.com/wpush/v2/x'],
    ['https://web.push.apple.com/x'],
    ['https://wns2-par02p.notify.windows.com/w/?token=x'],
  ])('aceita Firefox, Safari e Edge (%s)', (endpoint) => {
    expect(parseSubscribeBody(body({ subscription: sub({ endpoint }) })).ok).toBe(true);
  });
  it('recusa chaves ausentes ou fora do formato', () => {
    expect(parseSubscribeBody(body({ subscription: sub({ keys: {} }) })).ok).toBe(false);
    expect(parseSubscribeBody(body({ subscription: sub({ keys: { p256dh: 'ok_ok_ok_ok_ok', auth: 'não base64!' } }) })).ok).toBe(false);
  });
  it('lista vazia, grande demais ou com item inválido é recusada; duplicados e vazios saem', () => {
    expect(parseSubscribeBody(body({ queries: [] })).ok).toBe(false);
    expect(parseSubscribeBody(body({ queries: Array.from({ length: MAX_QUERIES + 1 }, (_, i) => `produto ${i}`) })).ok).toBe(false);
    expect(parseSubscribeBody(body({ queries: ['ok', 5] })).ok).toBe(false);
    const r = parseSubscribeBody(body({ queries: ['Sal 1kg', 'sal  1KG', '  '] }));
    expect(r.ok && r.value.queries).toEqual(['sal 1kg']);
  });
  it('corpo que não é objeto é recusado', () => {
    expect(parseSubscribeBody(null).ok).toBe(false);
    expect(parseSubscribeBody('x').ok).toBe(false);
  });
});

describe('createSubscriptionStore', () => {
  const value = () => {
    const r = parseSubscribeBody(body());
    if (!r.ok) throw new Error('inválido');
    return r.value;
  };
  it('inscrever de novo o mesmo aparelho atualiza a lista, sem duplicar', () => {
    const s = createSubscriptionStore();
    s.upsert(value());
    s.upsert({ ...value(), queries: ['arroz 5kg'] });
    expect(s.size()).toBe(1);
    expect(s.all()[0]!.queries).toEqual(['arroz 5kg']);
  });
  it('remove pelo endpoint e informa se havia', () => {
    const s = createSubscriptionStore();
    s.upsert(value());
    expect(s.remove(sub().endpoint)).toBe(true);
    expect(s.remove(sub().endpoint)).toBe(false);
    expect(s.size()).toBe(0);
  });
  it('queries() junta os produtos de todos sem repetir (uma busca por produto, não por pessoa)', () => {
    const s = createSubscriptionStore();
    s.upsert(value());
    s.upsert({ subscription: sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/outro' }), queries: ['sal 1kg', 'feijão 1kg'] });
    expect(s.queries().sort()).toEqual(['feijão 1kg', 'leite integral 1l', 'sal 1kg']);
  });
  it('limite de inscrições: ao lotar, recusa novas e continua atualizando as existentes', () => {
    const s = createSubscriptionStore({ maxSubs: 1 });
    expect(s.upsert(value())).toBe(true);
    expect(s.upsert({ subscription: sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/novo' }), queries: ['a'] })).toBe(false);
    expect(s.upsert({ ...value(), queries: ['b'] })).toBe(true);
  });
  it('guarda e devolve a referência de preço por produto, e sobrevive a snapshot/restore', () => {
    const s = createSubscriptionStore();
    s.upsert(value());
    s.setRef('sal 1kg', 4.5);
    const copy = createSubscriptionStore();
    copy.restore(s.snapshot());
    expect(copy.getRef('sal 1kg')).toBe(4.5);
    expect(copy.size()).toBe(1);
  });
  it('referências de produtos que ninguém mais acompanha são descartadas', () => {
    const s = createSubscriptionStore();
    s.upsert(value());
    s.setRef('sal 1kg', 4.5);
    s.setRef('produto abandonado', 9);
    s.pruneRefs();
    expect(s.getRef('produto abandonado')).toBeUndefined();
    expect(s.getRef('sal 1kg')).toBe(4.5);
  });
  it('restore ignora lixo sem quebrar', () => {
    const s = createSubscriptionStore();
    s.restore({ subs: 'x', refs: [1] });
    s.restore(null);
    expect(s.size()).toBe(0);
  });
});
