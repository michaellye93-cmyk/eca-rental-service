/*
 * Lets the installed driver app open without a connection. Hand-written on purpose (no build plugin).
 * - Network first for this site's pages and files, so a new deploy is always used when online.
 * - The cache is only a fallback when offline: index.html (stored as "/") and the built assets it names.
 * - Never touches Supabase or any other site (driver figures are never stored); see sw-rules.js.
 */
importScripts('/sw-rules.js');
var rules = self.ecaServiceWorkerRules;

/** Fetches index.html fresh and stores it with the assets it names. */
async function cacheShell() {
  var cache = await caches.open(rules.CACHE_NAME);
  var page = await fetch('/', { cache: 'reload' });
  if (!rules.isCacheable(page)) return;
  var html = await page.clone().text();
  await cache.put('/', page);
  var others = rules.shellUrls(html).filter(function (url) { return url !== '/'; });
  // One missing icon must not stop the rest being kept.
  await Promise.all(others.map(function (url) {
    return fetch(url, { cache: 'reload' }).then(function (response) {
      if (rules.isCacheable(response)) return cache.put(url, response);
    }).catch(function () {});
  }));
}

self.addEventListener('install', function (event) {
  event.waitUntil(cacheShell().catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) { return name !== rules.CACHE_NAME; })
      .map(function (name) { return caches.delete(name); }));
  }).then(function () { return self.clients.claim(); }));
});

/** A page load: always the network when online; keeps that index.html, and drops assets an earlier deploy used. */
async function navigate(request) {
  var cache = await caches.open(rules.CACHE_NAME);
  try {
    var response = await fetch(request);
    if (rules.isCacheable(response)) {
      var previous = await cache.match('/');
      var oldHtml = previous ? await previous.text() : '';
      var newHtml = await response.clone().text();
      await cache.put('/', response.clone());
      var paths = (await cache.keys()).map(function (key) { return new URL(key.url).pathname; });
      await Promise.all(rules.staleAssets(paths, oldHtml, newHtml).map(function (path) { return cache.delete(path); }));
    }
    return response;
  } catch (offline) {
    var saved = await cache.match('/');
    if (saved) return saved;
    throw offline;
  }
}

/** A file (script, style, icon): the network when online, the kept copy only when offline. */
async function asset(request) {
  var cache = await caches.open(rules.CACHE_NAME);
  try {
    var response = await fetch(request);
    if (rules.isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (offline) {
    var saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    throw offline;
  }
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!rules.shouldHandle(request, self.location.origin)) return;
  event.respondWith(request.mode === 'navigate' ? navigate(request) : asset(request));
});
