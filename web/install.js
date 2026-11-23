/**
 * Qual opção de instalar mostrar:
 *  'prompt'   = navegador com diálogo nativo (Chrome, Edge, Android): o botão dispara o diálogo
 *  'ios-hint' = Safari do iPhone/iPad, que não tem diálogo: mostra "Compartilhar → Adicionar à Tela de Início"
 *  'hidden'   = já instalado ou sem como instalar daqui
 */
export function installMode({ standalone, userAgent, hasPrompt, touchPoints = 0 }) {
  if (standalone) return 'hidden';
  if (hasPrompt) return 'prompt';
  const iphoneOrIpad = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  const otherBrowserOnIos = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return iphoneOrIpad && !otherBrowserOnIos ? 'ios-hint' : 'hidden';
}
