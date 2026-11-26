/** SEO: robots.txt, sitemap.xml e a página inicial com cidade, endereço e lojas escritos no HTML. Tudo puro. */

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeXml = (s: string): string => escapeHtml(s).replace(/'/g, '&apos;');
const trimSlash = (url: string): string => url.replace(/\/+$/, '');

/** Caminhos que não são conteúdo para o Google (painel, API, métricas). */
export const NOINDEX_PREFIXES = ['/admin', '/api/', '/metrics', '/healthz'] as const;

export function robotsTxt(siteUrl: string | undefined): string {
  const lines = ['User-agent: *', 'Allow: /', ...NOINDEX_PREFIXES.filter((p) => p !== '/healthz').map((p) => `Disallow: ${p}`)];
  if (siteUrl) lines.push('', `Sitemap: ${trimSlash(siteUrl)}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function sitemapXml(siteUrl: string, lastmod: string): string {
  const base = escapeXml(trimSlash(siteUrl));
  const urls = [`${base}/`, `${base}/privacidade.html`];
  const entries = urls.map((loc) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export type IndexOptions = { siteUrl: string | undefined; city: string; name: string; sources: string[] };

/** "A, B e C" (lista em português). */
const joinPt = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);

const jsonLd = (o: IndexOptions & { siteUrl: string }): string => {
  const url = `${trimSlash(o.siteUrl)}/`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: o.name,
    url,
    description: `Compare os preços dos supermercados e farmácias de ${o.city} com a sua lista de compras.`,
    applicationCategory: 'ShoppingApplication',
    operatingSystem: 'Qualquer (navegador e app instalável)',
    inLanguage: 'pt-BR',
    isAccessibleForFree: true,
    areaServed: { '@type': 'City', name: o.city },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
  };
  // "<" vira <: um nome com "</script>" não consegue fechar a tag antes da hora
  return JSON.stringify(data).replace(/</g, '\\u003c');
};

/** Troca __CITY__, __SITE_URL__, __SOURCES__ e __JSONLD__ no HTML. Sem endereço público, tira as linhas que dependem dele. */
export function renderIndex(html: string, o: IndexOptions): string {
  const withUrl = o.siteUrl
    ? html.replace(/__SITE_URL__/g, trimSlash(o.siteUrl)).replace(/__JSONLD__/g, jsonLd({ ...o, siteUrl: o.siteUrl }))
    : html
        .split('\n')
        .filter((line) => !line.includes('__SITE_URL__') && !line.includes('__JSONLD__'))
        .join('\n');
  const sources = o.sources.length > 0 ? joinPt(o.sources.map(escapeHtml)) : 'os mercados e farmácias da cidade';
  return withUrl.replace(/__CITY__/g, escapeHtml(o.city)).replace(/__SOURCES__/g, sources);
}
