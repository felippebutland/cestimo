/**
 * Service worker do Cestimo: permite instalar o app e abrir a casca da página sem internet.
 * Rede primeiro, sempre: a cópia guardada só aparece quando a rede falha, então uma versão nova
 * nunca fica presa atrás de um cache velho. Nada de /api, /admin, /metrics nem /grafana passa por aqui.
 */
const CACHE = 'cestimo-shell-v1';
const SHELL = ['/', '/app.js', '/format.js', '/jobs.js', '/shoppingList.js', '/overrides.js', '/history.js', '/share.js', '/install.js', '/trend.js', '/push.js', '/mobileOrder.js', '/marketFilter.js', '/category.js', '/cmed.js', '/theme.js', '/account.js', '/me.js', '/modal.js', '/welcome.js', '/panel.js', '/theme-init.js', '/favicon.svg', '/icon-192.png'];
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

// Aviso de queda de preço (Web Push): o servidor manda { title, body }; tocar abre o app.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* aviso sem corpo legível */ }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Cestimo';
  const body = typeof data.body === 'string' ? data.body : '';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'cestimo-queda', data: { url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      const target = (event.notification.data && event.notification.data.url) || '/';
      const open = all.find((c) => c.url.startsWith(self.location.origin));
      if (open) return open.navigate(target).then((c) => (c || open).focus()).catch(() => open.focus());
      return self.clients.openWindow(target);
    }),
  );
});
