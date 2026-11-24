import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSender, loadOrCreateVapid } from './sender.js';

const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'BPublicKey_-1234567890', auth: 'AuthSecret_-12' } };

describe('createSender', () => {
  const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'https://exemplo.com' };
  it('envia o aviso como JSON com as chaves VAPID e prazo (TTL) de um dia', async () => {
    let seen: { sub: unknown; body: string; opts: Record<string, unknown> } | undefined;
    const send = createSender(vapid, async (s, body, opts) => { seen = { sub: s, body: String(body), opts: opts as Record<string, unknown> }; });
    expect(await send(sub, { title: 'T', body: 'B' })).toBe('ok');
    expect(JSON.parse(seen!.body)).toEqual({ title: 'T', body: 'B' });
    expect(seen!.opts).toMatchObject({ TTL: 86400, vapidDetails: vapid });
  });
  it.each([[404], [410]])('status %i do serviço de push = aparelho não existe mais (gone)', async (statusCode) => {
    const send = createSender(vapid, async () => { throw Object.assign(new Error('x'), { statusCode }); });
    expect(await send(sub, { title: 'T', body: 'B' })).toBe('gone');
  });
  it('outros erros (rede, 500, 429) são falha passageira, não remove o aparelho', async () => {
    for (const err of [Object.assign(new Error('x'), { statusCode: 500 }), Object.assign(new Error('x'), { statusCode: 429 }), new Error('rede')]) {
      const send = createSender(vapid, async () => { throw err; });
      expect(await send(sub, { title: 'T', body: 'B' })).toBe('erro');
    }
  });
});

describe('loadOrCreateVapid', () => {
  it('cria as chaves na primeira vez e reaproveita nas seguintes (trocar as chaves invalida todas as inscrições)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vapid-'));
    const a = loadOrCreateVapid(dir, () => ({ publicKey: 'P1', privateKey: 'S1' }), 'https://x.com');
    const b = loadOrCreateVapid(dir, () => ({ publicKey: 'P2', privateKey: 'S2' }), 'https://x.com');
    expect(a).toEqual({ publicKey: 'P1', privateKey: 'S1', subject: 'https://x.com' });
    expect(b.publicKey).toBe('P1');
    expect(JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8')).privateKey).toBe('S1');
  });
  it('arquivo corrompido: gera novas chaves em vez de quebrar a inicialização', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vapid-'));
    writeFileSync(join(dir, 'vapid.json'), 'lixo');
    expect(loadOrCreateVapid(dir, () => ({ publicKey: 'N', privateKey: 'M' }), 'https://x.com').publicKey).toBe('N');
  });
});
