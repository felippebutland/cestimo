export type Device = 'celular' | 'tablet' | 'computador' | 'robô';
export type Client = { device: Device; os: string; browser: string; bot: boolean };

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-|go-http-client|java\/|axios|node-fetch|postman|scrapy|httpclient|facebookexternalhit/i;
const IN_APP_RE = /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|MicroMessenger|Twitter|Snapchat|Pinterest/;

const BOT: Client = { device: 'robô', os: 'Outro', browser: 'Outro', bot: true };

/**
 * Reduz o User-Agent a categorias genéricas (celular/tablet/computador, sistema, navegador).
 * Nunca devolve o texto original nem números de versão: serve só para contagem anônima.
 */
export function parseClient(userAgent: string | undefined): Client {
  const ua = (userAgent ?? '').trim();
  if (ua === '' || BOT_RE.test(ua)) return BOT;

  const device: Device =
    /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? 'tablet'
      : /iPhone|iPod|Android|Mobile/.test(ua)
        ? 'celular'
        : 'computador';

  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Linux|X11/.test(ua) ? 'Linux'
    : 'Outro';

  const browser = IN_APP_RE.test(ua) ? 'Navegador de app'
    : /Edg(?:e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : 'Outro';

  return { device, os, browser, bot: false };
}
