/**
 * Avisos de queda de preço (Web Push) no navegador.
 *  'ready'       = dá para ativar
 *  'ios-install' = iPhone/iPad no Safari: o aviso só funciona com o app na Tela de Início
 *  'denied'      = a pessoa bloqueou notificações do site
 *  'unsupported' = sem suporte: não mostra o botão
 */
export function pushMode({ hasPush, standalone, userAgent, touchPoints = 0, permission }) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (!hasPush) return ios && !standalone ? 'ios-install' : 'unsupported';
  if (permission === 'denied') return 'denied';
  return 'ready';
}

/** A chave VAPID chega em base64 URL; o navegador quer bytes. */
export function urlBase64ToUint8Array(b64) {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const MAX_WATCHED = 10;

/** Produtos da lista que serão acompanhados: só os que têm preço, sem repetir (mesmo com caixa diferente), no máximo 10. */
export function queriesToWatch(products) {
  const seen = new Set();
  const out = [];
  for (const p of products) {
    const q = String(p.query ?? '').trim();
    const key = q.toLowerCase();
    if (!q || !p.stats || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_WATCHED) break;
  }
  return out;
}

export function parsePushState(raw) {
  try {
    const v = JSON.parse(raw ?? '');
    return { on: v?.on === true };
  } catch {
    return { on: false };
  }
}
