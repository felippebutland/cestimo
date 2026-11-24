/**
 * Manda uma notificação de teste para os aparelhos que uma conta ativou em "Preços que acompanho".
 * Serve para conferir, no celular, se o aviso de queda chega (sem esperar um preço cair).
 *
 * No servidor (Docker):  docker exec prices-cestimo-1 node --import tsx scripts/push-test.ts voce@gmail.com
 * Local:                 npx tsx scripts/push-test.ts voce@gmail.com
 * Usa DATA_DIR (padrão ./data): auth.db para achar a conta e vapid.json para assinar o envio.
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as webpush from 'web-push';
import { createSender, loadOrCreateVapid } from '../src/server/push/sender.js';

const email = process.argv[2];
if (!email) {
  console.error('Uso: push-test.ts <e-mail da conta>');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? './data';
const db = new DatabaseSync(join(dataDir, 'auth.db'), { readOnly: true });
const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email) as { id: number; name: string } | undefined;
if (!user) {
  console.error('Nenhuma conta com esse e-mail.');
  process.exit(1);
}
const devices = db.prepare('SELECT endpoint, p256dh, auth FROM push_devices WHERE user_id = ?').all(user.id) as Array<{ endpoint: string; p256dh: string; auth: string }>;
if (devices.length === 0) {
  console.error('Essa conta não tem aparelho com aviso ativo. Ative em "Preços que acompanho" > "Ativar aviso neste aparelho".');
  process.exit(1);
}
const vapid = loadOrCreateVapid(dataDir, () => webpush.generateVAPIDKeys(), process.env.PUSH_SUBJECT || 'https://cestimo.butland.sbs');
const send = createSender(vapid, (subscription, payload, options) => webpush.sendNotification(subscription, payload, options));

for (const [i, d] of devices.entries()) {
  const result = await send(
    { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
    { title: 'Teste do Cestimo 🔔', body: 'Se você está lendo isto, o aviso de queda de preço chegou neste aparelho.', url: '/#acompanhando' },
  );
  console.log(`aparelho ${i + 1}: ${result === 'ok' ? 'enviado' : result === 'gone' ? 'não existe mais (a inscrição expirou)' : 'falhou'}`);
}
