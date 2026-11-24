import { describe, it, expect } from 'vitest';
import { pushMode, urlBase64ToUint8Array, queriesToWatch, parsePushState, watchKeys } from './push.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const base = { hasPush: true, standalone: false, userAgent: CHROME, touchPoints: 5, permission: 'default' };

describe('pushMode', () => {
  it('Chrome/Android com suporte: pronto para ativar, instalado ou não', () => {
    expect(pushMode(base)).toBe('ready');
    expect(pushMode({ ...base, standalone: true })).toBe('ready');
  });
  it('iPhone fora do app instalado: o iOS só entrega aviso para app na Tela de Início', () => {
    expect(pushMode({ ...base, userAgent: IPHONE, hasPush: false })).toBe('ios-install');
    expect(pushMode({ ...base, userAgent: IPHONE, hasPush: false, standalone: true })).toBe('unsupported');
  });
  it('iPhone com o app instalado e suporte: pronto', () => {
    expect(pushMode({ ...base, userAgent: IPHONE, standalone: true })).toBe('ready');
  });
  it('navegador sem suporte: não mostra o botão', () => {
    expect(pushMode({ ...base, hasPush: false })).toBe('unsupported');
  });
  it('permissão já negada: avisa que precisa liberar nas configurações', () => {
    expect(pushMode({ ...base, permission: 'denied' })).toBe('denied');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('converte a chave pública VAPID (base64 URL) em bytes', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });
});

describe('queriesToWatch', () => {
  const p = (query: string, priced: boolean) => ({ query, stats: priced ? { cheapest: { priceBRL: 1, source: 'A' } } : null });
  it('só produtos que têm preço, sem repetir, no máximo 10', () => {
    expect(queriesToWatch([p('sal', true), p('xyz', false), p('Sal', true), p('arroz', true)])).toEqual(['sal', 'arroz']);
    const many = Array.from({ length: 15 }, (_, i) => p(`produto ${i}`, true));
    expect(queriesToWatch(many)).toHaveLength(10);
  });
});

describe('parsePushState', () => {
  it('lê o estado guardado e ignora lixo', () => {
    expect(parsePushState('{"on":true}')).toEqual({ on: true });
    expect(parsePushState('{"on":"sim"}')).toEqual({ on: false });
    expect(parsePushState('lixo')).toEqual({ on: false });
    expect(parsePushState(null)).toEqual({ on: false });
  });
});

describe('watchKeys (produtos do aviso por lista, por categoria)', () => {
  const products = [{ query: 'Dipirona 500mg', stats: {} }, { query: 'Sal 1kg', stats: {} }, { query: 'Sem preço', stats: null }];
  it('mercados: o texto do produto, como sempre', () => {
    expect(watchKeys(products, 'mercados')).toEqual(['Dipirona 500mg', 'Sal 1kg']);
  });
  it('farmácias: cada produto leva o prefixo "farmacias: " (o servidor busca nas farmácias)', () => {
    expect(watchKeys(products, 'farmacias')).toEqual(['farmacias: Dipirona 500mg', 'farmacias: Sal 1kg']);
  });
});
