import { describe, it, expect } from 'vitest';
import { parseClient } from './client.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.20.114 (iPhone14,5; iOS 17_5)',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('parseClient: dispositivo, sistema e navegador (categorias genéricas)', () => {
  it.each([
    ['iPhone + Safari', UA.iphoneSafari, { device: 'celular', os: 'iOS', browser: 'Safari' }],
    ['iPhone + Chrome', UA.iphoneChrome, { device: 'celular', os: 'iOS', browser: 'Chrome' }],
    ['iPhone + Firefox', UA.iphoneFirefox, { device: 'celular', os: 'iOS', browser: 'Firefox' }],
    ['iPad', UA.ipad, { device: 'tablet', os: 'iOS', browser: 'Safari' }],
    ['Android + Chrome', UA.androidChrome, { device: 'celular', os: 'Android', browser: 'Chrome' }],
    ['Android sem "Mobile" é tablet', UA.androidTablet, { device: 'tablet', os: 'Android', browser: 'Chrome' }],
    ['Samsung Internet', UA.samsung, { device: 'celular', os: 'Android', browser: 'Samsung Internet' }],
    ['Windows + Chrome', UA.winChrome, { device: 'computador', os: 'Windows', browser: 'Chrome' }],
    ['Windows + Edge', UA.winEdge, { device: 'computador', os: 'Windows', browser: 'Edge' }],
    ['macOS + Safari', UA.macSafari, { device: 'computador', os: 'macOS', browser: 'Safari' }],
    ['macOS + Chrome', UA.macChrome, { device: 'computador', os: 'macOS', browser: 'Chrome' }],
    ['Linux + Firefox', UA.linuxFirefox, { device: 'computador', os: 'Linux', browser: 'Firefox' }],
    ['Opera', UA.opera, { device: 'computador', os: 'Windows', browser: 'Opera' }],
    ['ChromeOS', UA.chromeOS, { device: 'computador', os: 'ChromeOS', browser: 'Chrome' }],
    ['navegador embutido (Instagram)', UA.iphoneInstagram, { device: 'celular', os: 'iOS', browser: 'Navegador de app' }],
  ])('%s', (_nome, ua, esperado) => {
    expect(parseClient(ua)).toEqual({ ...esperado, bot: false });
  });

  it.each([
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['monitor de uptime', 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
    ['curl', 'curl/8.4.0'],
    ['navegador automatizado', 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36'],
    ['script python', 'python-requests/2.31.0'],
    ['sem User-Agent', undefined],
    ['User-Agent vazio', '   '],
  ])('robô: %s', (_nome, ua) => {
    expect(parseClient(ua)).toEqual({ device: 'robô', os: 'Outro', browser: 'Outro', bot: true });
  });

  it('agente desconhecido (mas não robô) cai em "Outro"', () => {
    expect(parseClient('MeuAppDeTeste')).toEqual({ device: 'computador', os: 'Outro', browser: 'Outro', bot: false });
  });

  it('só devolve rótulos de um conjunto fixo: nunca o texto original nem versões', () => {
    for (const ua of Object.values(UA)) {
      const c = parseClient(ua);
      expect(JSON.stringify(c)).not.toMatch(/\d{2,}/);
      expect(JSON.stringify(c)).not.toContain('Mozilla');
    }
  });
});
