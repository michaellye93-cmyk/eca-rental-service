/*
 * The pure rules of the service worker (public/sw.js), kept apart so the tests can check them in Node.
 * A plain script with no import/export: sw.js loads it with importScripts and the tests import it; both then read
 * globalThis.ecaServiceWorkerRules.
 */
(function () {
  /** One cache for the app shell. Bump the number only if the cache layout changes; new deploys are picked up anyway. */
  var CACHE_NAME = 'eca-shell-v1';
  /** Files that are always part of the shell besides index.html and the built assets it names. */
  var STATIC_SHELL = ['/manifest.webmanifest', '/logo.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
  /** Same-origin paths that are data, never app files (Supabase-style APIs, in case one is ever proxied here). */
  var DATA_PATHS = ['/rest/', '/auth/', '/functions/', '/realtime/', '/storage/'];

  /**
   * True when the service worker may answer this request (network first, cache only when offline). Only GET requests
   * for this site's own files: anything on another origin (Supabase, fonts, CDNs) and any data path is left alone, so
   * driver figures are never stored.
   */
  function shouldHandle(request, origin) {
    if (!request || request.method !== 'GET') return false;
    var url;
    try { url = new URL(request.url); } catch (e) { return false; }
    if (url.origin !== origin) return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    for (var i = 0; i < DATA_PATHS.length; i++) if (url.pathname.indexOf(DATA_PATHS[i]) === 0) return false;
    if (url.pathname === '/sw.js' || url.pathname === '/sw-rules.js') return false;
    return true;
  }

  /** The built files index.html names (/assets/… scripts, styles, preloads), found at run time, never hard-coded. */
  function shellAssets(html) {
    var found = [];
    var pattern = /(?:src|href)\s*=\s*["'](\/assets\/[^"'?#]+)["']/g;
    var match;
    while ((match = pattern.exec(String(html || ''))) !== null) if (found.indexOf(match[1]) < 0) found.push(match[1]);
    return found;
  }

  /** Everything to keep for offline use: the page itself (stored as "/"), its built assets and the static files. */
  function shellUrls(html) {
    return ['/'].concat(shellAssets(html), STATIC_SHELL);
  }

  /**
   * After a newer index.html is loaded: the cached /assets/ files to delete because a new deploy replaced them.
   * Nothing is dropped while the deploy is the same (lazy-loaded pages stay cached) or if the new page names no assets.
   */
  function staleAssets(cachedPaths, oldHtml, newHtml) {
    var before = shellAssets(oldHtml).slice().sort().join('|');
    var keep = shellAssets(newHtml);
    if (!keep.length || before === keep.slice().sort().join('|')) return [];
    return cachedPaths.filter(function (path) { return path.indexOf('/assets/') === 0 && keep.indexOf(path) < 0; });
  }

  /** Only complete answers from this site are worth keeping. */
  function isCacheable(response) {
    return !!response && response.ok && response.status === 200 && response.type === 'basic';
  }

  globalThis.ecaServiceWorkerRules = {
    CACHE_NAME: CACHE_NAME,
    STATIC_SHELL: STATIC_SHELL,
    shouldHandle: shouldHandle,
    shellAssets: shellAssets,
    shellUrls: shellUrls,
    staleAssets: staleAssets,
    isCacheable: isCacheable,
  };
})();
