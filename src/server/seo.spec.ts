import { describe, it, expect } from 'vitest';
import { renderIndex, robotsTxt, sitemapXml } from './seo.js';

const SITE = 'https://cestimo.butland.sbs';

describe('robotsTxt', () => {
  it('libera o site, esconde o que é interno e aponta o sitemap', () => {
    const txt = robotsTxt(SITE);
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Allow: /');
    for (const p of ['/admin', '/api/', '/metrics']) expect(txt).toContain(`Disallow: ${p}`);
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
  it('sem endereço público, não cita o sitemap', () => {
    expect(robotsTxt(undefined)).not.toContain('Sitemap');
  });
  it('barra de endereço com / no fim não duplica a barra', () => {
    expect(robotsTxt(`${SITE}/`)).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe('sitemapXml', () => {
  it('lista a página inicial e a de privacidade com a data da última mudança', () => {
    const xml = sitemapXml(SITE, '2026-11-26');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/privacidade.html</loc>`);
    expect(xml.match(/<lastmod>2026-11-26<\/lastmod>/g)).toHaveLength(2);
  });
  it('escapa caracteres especiais do endereço', () => {
    expect(sitemapXml('https://x.com/a&b', '2026-11-26')).toContain('https://x.com/a&amp;b/');
  });
});

describe('renderIndex', () => {
  const html = [
    '<html><head>',
    '<title>Cestimo em __CITY__</title>',
    '<link rel="canonical" href="__SITE_URL__/" />',
    '<meta property="og:image" content="__SITE_URL__/og.png" />',
    '<script type="application/ld+json">__JSONLD__</script>',
    '</head><body><p>Comparamos __SOURCES__.</p></body></html>',
  ].join('\n');
  const opts = { siteUrl: SITE, city: 'Chapecó, SC', name: 'Cestimo', sources: ['Comper', 'Royal', 'São João'] };

  it('troca cidade, endereço e lojas', () => {
    const out = renderIndex(html, opts);
    expect(out).toContain('<title>Cestimo em Chapecó, SC</title>');
    expect(out).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(out).toContain('<p>Comparamos Comper, Royal e São João.</p>');
    expect(out).not.toMatch(/__[A-Z_]+__/);
  });
  it('escreve o JSON-LD como WebApplication válido, sem fechar a tag script antes da hora', () => {
    const out = renderIndex(html, { ...opts, city: 'A </script><b>' });
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)![1]!;
    const data = JSON.parse(json);
    expect(data).toMatchObject({ '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Cestimo', url: `${SITE}/`, inLanguage: 'pt-BR', isAccessibleForFree: true });
    expect(data.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'BRL' });
    expect(json).not.toContain('</script>');
  });
  it('escapa HTML no que vem da configuração', () => {
    const out = renderIndex(html, { ...opts, sources: ['<img src=x>'] });
    expect(out).not.toContain('<img src=x>');
    expect(out).toContain('&lt;img src=x&gt;');
  });
  it('sem endereço público, tira as linhas que precisam dele (canonical, og:image) e o JSON-LD', () => {
    const out = renderIndex(html, { ...opts, siteUrl: undefined });
    expect(out).not.toContain('canonical');
    expect(out).not.toContain('og:image');
    expect(out).not.toContain('ld+json');
    expect(out).toContain('Cestimo em Chapecó, SC');
  });
  it('sem lojas, não deixa a frase quebrada', () => {
    expect(renderIndex(html, { ...opts, sources: [] })).toContain('<p>Comparamos os mercados e farmácias da cidade.</p>');
  });
});
