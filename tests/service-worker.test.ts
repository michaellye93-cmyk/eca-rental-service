import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ORIGIN = 'https://eca.example.test';
await import('../public/sw-rules.js');
const rules = (globalThis as any).ecaServiceWorkerRules;
const get = (url: string, extra: Record<string, unknown> = {}) => ({ method: 'GET', url, mode: 'no-cors', ...extra });

test('only GET requests for this site\'s own files are handled; Supabase and other sites never are', () => {
  assert.equal(rules.shouldHandle(get(`${ORIGIN}/`), ORIGIN), true);
  assert.equal(rules.shouldHandle(get(`${ORIGIN}/assets/index-abc123.js`), ORIGIN), true);
  assert.equal(rules.shouldHandle(get(`${ORIGIN}/admin/collections`), ORIGIN), true);
  assert.equal(rules.shouldHandle({ ...get(`${ORIGIN}/assets/x.js`), method: 'POST' }, ORIGIN), false, 'not a POST');
  assert.equal(rules.shouldHandle(get('https://fixture.supabase.co/rest/v1/drivers'), ORIGIN), false, 'not Supabase');
  assert.equal(rules.shouldHandle(get('https://fixture.supabase.co/auth/v1/token'), ORIGIN), false);
  assert.equal(rules.shouldHandle(get('https://fonts.example.test/font.woff2'), ORIGIN), false, 'not another site');
  for (const path of ['/rest/v1/rpc/driver_portal_login', '/auth/v1/user', '/functions/v1/access-id-login', '/realtime/v1', '/storage/v1/x']) {
    assert.equal(rules.shouldHandle(get(`${ORIGIN}${path}`), ORIGIN), false, `${path} is data, even on this site`);
  }
  assert.equal(rules.shouldHandle(get(`${ORIGIN}/sw.js`), ORIGIN), false);
  assert.equal(rules.shouldHandle(get('chrome-extension://abc/x.js'), ORIGIN), false);
  assert.equal(rules.shouldHandle(null, ORIGIN), false);
});

const HTML_V1 = `<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest" />
  <script type="module" crossorigin src="/assets/index-AAA111.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-BBB222.js">
  <link rel="stylesheet" crossorigin href="/assets/index-CCC333.css"></head><body><div id="root"></div></body></html>`;
const HTML_V2 = HTML_V1.replace('index-AAA111.js', 'index-DDD444.js');

test('the shell is found from index.html at run time, never from hard-coded hashes', () => {
  assert.deepEqual(rules.shellAssets(HTML_V1), ['/assets/index-AAA111.js', '/assets/vendor-BBB222.js', '/assets/index-CCC333.css']);
  assert.deepEqual(rules.shellUrls(HTML_V1).slice(0, 4), ['/', '/assets/index-AAA111.js', '/assets/vendor-BBB222.js', '/assets/index-CCC333.css']);
  assert.ok(rules.shellUrls('').includes('/manifest.webmanifest'));
  assert.match(rules.CACHE_NAME, /^eca-shell-v\d+$/, 'the cache name carries a version');
});

test('a new deploy drops the old built files; the same deploy keeps lazily loaded pages', () => {
  const cached = ['/', '/assets/index-AAA111.js', '/assets/vendor-BBB222.js', '/assets/index-CCC333.css', '/assets/FinanceView-EEE555.js', '/icon-192.png'];
  assert.deepEqual(rules.staleAssets(cached, HTML_V1, HTML_V1), [], 'same deploy: nothing dropped');
  assert.deepEqual(rules.staleAssets(cached, HTML_V1, HTML_V2), ['/assets/index-AAA111.js', '/assets/FinanceView-EEE555.js']);
  assert.deepEqual(rules.staleAssets(cached, HTML_V1, '<p>maintenance</p>'), [], 'a page with no assets drops nothing');
});

test('only complete answers from this site are kept', () => {
  assert.equal(rules.isCacheable({ ok: true, status: 200, type: 'basic' }), true);
  assert.equal(rules.isCacheable({ ok: true, status: 200, type: 'opaque' }), false);
  assert.equal(rules.isCacheable({ ok: false, status: 404, type: 'basic' }), false);
  assert.equal(rules.isCacheable({ ok: true, status: 206, type: 'basic' }), false);
  assert.equal(rules.isCacheable(undefined), false);
});

// ---- The worker itself, run in a sandbox with a fake network and cache ----
class FakeResponse {
  body: string; status: number; type: string;
  constructor(body: string, status = 200, type = 'basic') { this.body = body; this.status = status; this.type = type; }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return new FakeResponse(this.body, this.status, this.type); }
  async text() { return this.body; }
}
const key = (request: any) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).pathname;

async function worker(site: Record<string, string>) {
  const network = { online: true, site, requests: [] as string[] };
  const stores = new Map<string, Map<string, FakeResponse>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (request: any) => store.get(key(request))?.clone(),
      put: async (request: any, response: FakeResponse) => void store.set(key(request), response.clone()),
      delete: async (request: any) => store.delete(key(request)),
      keys: async () => [...store.keys()].map(path => ({ url: ORIGIN + path })),
    };
  };
  const listeners: Record<string, (event: any) => void> = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self: any = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; },
    skipWaiting: async () => { calls.skipWaiting++; },
    clients: { claim: async () => { calls.claim++; } },
  };
  const sandbox: any = {
    self, URL, Promise,
    caches: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) },
    fetch: async (request: any) => {
      const path = key(request);
      network.requests.push(path);
      if (!network.online) throw new TypeError('Failed to fetch');
      const body = network.site[path] ?? network.site['/'];
      return new FakeResponse(body ?? '', body === undefined ? 404 : 200);
    },
    importScripts: () => { sandbox.self.ecaServiceWorkerRules = rules; },
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox);
  const run = async (type: string, request?: any) => {
    let waited: Promise<unknown> | undefined;
    let answer: Promise<FakeResponse> | undefined;
    listeners[type]({ request, waitUntil: (p: Promise<unknown>) => { waited = p; }, respondWith: (p: Promise<FakeResponse>) => { answer = p; } });
    await waited;
    return answer;
  };
  return { network, stores, calls, run };
}

test('the worker keeps the shell on install, takes over at once and clears older caches', async () => {
  const sw = await worker({ '/': HTML_V1, '/assets/index-AAA111.js': 'v1', '/assets/vendor-BBB222.js': 'vendor', '/assets/index-CCC333.css': 'css',
    '/manifest.webmanifest': '{}' });
  sw.stores.set('eca-shell-v0', new Map());
  await sw.run('install');
  await sw.run('activate');
  assert.deepEqual([...sw.stores.keys()], [rules.CACHE_NAME], 'the older cache is deleted');
  const shell = sw.stores.get(rules.CACHE_NAME)!;
  for (const path of ['/', '/assets/index-AAA111.js', '/assets/vendor-BBB222.js', '/assets/index-CCC333.css', '/manifest.webmanifest']) {
    assert.ok(shell.has(path), `${path} is kept`);
  }
  assert.deepEqual(sw.calls, { skipWaiting: 1, claim: 1 });
});

test('online the network always wins (a new deploy is picked up); offline the kept shell opens', async () => {
  const sw = await worker({ '/': HTML_V1, '/assets/index-AAA111.js': 'v1' });
  await sw.run('install');
  await sw.run('activate');
  sw.network.site = { '/': HTML_V2, '/assets/index-DDD444.js': 'v2' };
  const page = await sw.run('fetch', get(`${ORIGIN}/`, { mode: 'navigate' }));
  assert.equal(await page!.text(), HTML_V2, 'online: the new index.html');
  const script = await sw.run('fetch', get(`${ORIGIN}/assets/index-DDD444.js`));
  assert.equal(await script!.text(), 'v2');
  assert.equal(sw.stores.get(rules.CACHE_NAME)!.has('/assets/index-AAA111.js'), false, 'the old deploy\'s file is dropped');

  sw.network.online = false;
  const offlinePage = await sw.run('fetch', get(`${ORIGIN}/`, { mode: 'navigate' }));
  assert.equal(await offlinePage!.text(), HTML_V2, 'offline: the last index.html');
  const offlineScript = await sw.run('fetch', get(`${ORIGIN}/assets/index-DDD444.js`));
  assert.equal(await offlineScript!.text(), 'v2');
});

test('Supabase requests pass straight through the worker and are never stored', async () => {
  const sw = await worker({ '/': HTML_V1 });
  await sw.run('install');
  const answer = await sw.run('fetch', { method: 'POST', url: 'https://fixture.supabase.co/rest/v1/rpc/driver_portal_login', mode: 'cors' });
  assert.equal(answer, undefined, 'the worker does not answer it');
  const answerGet = await sw.run('fetch', get('https://fixture.supabase.co/rest/v1/drivers'));
  assert.equal(answerGet, undefined);
  assert.ok([...sw.stores.get(rules.CACHE_NAME)!.keys()].every(path => !path.includes('rest')));
});
