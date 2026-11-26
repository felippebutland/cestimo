import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { renderIndex, robotsTxt, sitemapXml } from './seo.js';

export type SeoRouteOptions = { siteUrl: string | undefined; city: string; name: string; sources: string[] };

/**
 * robots.txt, sitemap.xml e a página inicial já com cidade, endereço (canonical) e lojas escritos no HTML.
 * Registre antes do servidor de arquivos (que deve ficar com `index: false`), para esta página valer no "/".
 */
export function registerSeoRoutes(app: FastifyInstance, opts: SeoRouteOptions): void {
  const builtOn = new Date().toISOString().slice(0, 10);
  app.get('/robots.txt', (_req, reply) => reply.type('text/plain; charset=utf-8').header('cache-control', 'public, max-age=3600').send(robotsTxt(opts.siteUrl)));
  app.get('/sitemap.xml', (_req, reply) => {
    if (!opts.siteUrl) return reply.code(404).send({ error: 'not found' });
    return reply.type('application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600').send(sitemapXml(opts.siteUrl, builtOn));
  });
  let template: string | null = null;
  const serveIndex = (_req: unknown, reply: FastifyReply) => {
    template ??= readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(renderIndex(template, opts));
  };
  app.get('/', serveIndex);
  app.get('/index.html', serveIndex);
}
