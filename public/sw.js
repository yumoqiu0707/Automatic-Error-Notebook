/**
 * Service Worker：让应用可以「安装到桌面」并离线打开外壳。
 *
 * 策略：
 *   - 页面导航：network-first（保证拿到最新版），断网时回落到缓存
 *   - 图标 / manifest 等静态资源：stale-while-revalidate
 *   - /api/ 一律不缓存，永远走网络（错题数据必须是最新的）
 */

const CACHE = 'cuotiji-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // 数据接口永不缓存

  /* 页面导航：优先网络 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  /* 静态资源：先给缓存，后台更新 */
  event.respondWith(
    caches.match(req).then(hit => {
      const fetching = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});
