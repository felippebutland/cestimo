import { join } from 'node:path';
import { createStateFile } from '../persistence.js';
import type { PushSubscription } from './subscriptions.js';
import type { Send, SendResult } from './dailyCheck.js';

export type Vapid = { publicKey: string; privateKey: string; subject: string };
type Keys = { publicKey: string; privateKey: string };
const isKeys = (v: unknown): v is Keys => typeof v === 'object' && v !== null && typeof (v as Keys).publicKey === 'string' && typeof (v as Keys).privateKey === 'string';

/** Chaves VAPID ficam em DATA_DIR/vapid.json. Trocar as chaves invalida todas as inscrições, então só gera se não houver. */
export function loadOrCreateVapid(dataDir: string, generate: () => Keys, subject: string): Vapid {
  const file = createStateFile(join(dataDir, 'vapid.json'));
  const saved = file.load();
  if (isKeys(saved)) return { publicKey: saved.publicKey, privateKey: saved.privateKey, subject };
  const keys = generate();
  file.save({ publicKey: keys.publicKey, privateKey: keys.privateKey });
  return { ...keys, subject };
}

type Transport = (subscription: PushSubscription, payload: string, options: { TTL: number; vapidDetails: Vapid }) => Promise<unknown>;

export function createSender(vapid: Vapid, transport: Transport): Send {
  return async (subscription, payload): Promise<SendResult> => {
    try {
      await transport(subscription, JSON.stringify(payload), { TTL: 24 * 60 * 60, vapidDetails: vapid });
      return 'ok';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'gone' : 'erro';
    }
  };
}
