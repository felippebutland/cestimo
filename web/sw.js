/**
 * Service worker do Cestimo: permite instalar o app e abrir a casca da página sem internet.
 * Rede primeiro, sempre: a cópia guardada só aparece quando a rede falha, então uma versão nova
 * nunca fica presa atrás de um cache velho. Nada de /api, /admin, /metrics nem /grafana passa por aqui.
 */
const CACHE = 'cestimo-shell-v1';
const SHELL = ['/', '/app.js', '/format.js', '/jobs.js', '/shoppingList.js', '/overrides.js', '/history.js', '/share.js', '/favicon.svg', '/icon-192.png'];
const SKIP = /^\/(api|admin|metrics|grafana|healthz)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cestimo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (error) {
    const hit = await caches.match(request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await caches.match('/');
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  event.respondWith(networkFirst(request));
});
