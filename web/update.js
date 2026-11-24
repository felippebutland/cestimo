/**
 * Nova versão do app (o service worker novo assumiu o controle).
 * 'ignore' = é só a primeira instalação; 'reload' = nada a perder, recarrega; 'offer' = há resultado ou busca na tela, só avisa.
 */
export function updateAction({ hadController, hasResult, loading }) {
  if (!hadController) return 'ignore';
  return hasResult || loading ? 'offer' : 'reload';
}
