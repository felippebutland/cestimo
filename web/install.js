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

/**
 * Está rodando como app instalado (e não numa aba do navegador)?
 * @param {{ displayModeStandalone?: boolean, navigatorStandalone?: boolean }} p
 */
export const isStandalone = ({ displayModeStandalone, navigatorStandalone }) => displayModeStandalone === true || navigatorStandalone === true;

/**
 * @param {boolean} standalone
 * @param {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void }} storage
 * Conta a abertura como app uma vez por sessão (não a cada recarga). Sem armazenamento disponível
 * (modo privado), conta mesmo assim: melhor contar a mais uma vez do que quebrar.
 */
export function pwaOpenOncePerSession(standalone, storage) {
  if (!standalone) return false;
  const KEY = 'cestimo:pwa-open';
  try {
    if (storage.getItem(KEY)) return false;
    storage.setItem(KEY, '1');
  } catch {
    // sem armazenamento
  }
  return true;
}
