import { describe, it, expect } from 'vitest';
import { installMode, isStandalone, pwaOpenOncePerSession } from './install.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';

describe('installMode', () => {
  it('já instalado (aberto como app): nada a mostrar', () => {
    expect(installMode({ standalone: true, userAgent: CHROME, hasPrompt: true })).toBe('hidden');
    expect(installMode({ standalone: true, userAgent: IPHONE, hasPrompt: false })).toBe('hidden');
  });
  it('navegador com diálogo nativo de instalar: botão que dispara o diálogo', () => {
    expect(installMode({ standalone: false, userAgent: CHROME, hasPrompt: true })).toBe('prompt');
  });
  it('Safari no iPhone/iPad: não há diálogo, mostra o passo a passo', () => {
    expect(installMode({ standalone: false, userAgent: IPHONE, hasPrompt: false })).toBe('ios-hint');
    expect(installMode({ standalone: false, userAgent: IPAD_DESKTOP_UA, hasPrompt: false, touchPoints: 5 })).toBe('ios-hint');
  });
  it('outros navegadores no iPhone não instalam por aqui: esconde', () => {
    expect(installMode({ standalone: false, userAgent: IOS_CHROME, hasPrompt: false })).toBe('hidden');
  });
  it('sem diálogo e fora do iOS (ainda não elegível, Firefox desktop…): esconde', () => {
    expect(installMode({ standalone: false, userAgent: CHROME, hasPrompt: false })).toBe('hidden');
    expect(installMode({ standalone: false, userAgent: IPAD_DESKTOP_UA, hasPrompt: false, touchPoints: 0 })).toBe('hidden');
  });
});

describe('isStandalone', () => {
  it('aberto como app: display-mode standalone (Android/desktop) ou navigator.standalone (iPhone)', () => {
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
  });
  it('aba normal do navegador: não é app', () => {
    expect(isStandalone({ displayModeStandalone: false })).toBe(false);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
  });
});

describe('pwaOpenOncePerSession', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('conta a primeira abertura como app e ignora as seguintes na mesma sessão', () => {
    const s = store();
    expect(pwaOpenOncePerSession(true, s)).toBe(true);
    expect(pwaOpenOncePerSession(true, s)).toBe(false);
  });
  it('não conta aba normal e não marca a sessão', () => {
    const s = store();
    expect(pwaOpenOncePerSession(false, s)).toBe(false);
    expect(pwaOpenOncePerSession(true, s)).toBe(true);
  });
  it('sem armazenamento (modo privado): ainda conta, sem quebrar', () => {
    const quebrado = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(pwaOpenOncePerSession(true, quebrado)).toBe(true);
  });
});
