// The real app in Chromium (Playwright), two phones, against the real server
// (server/worker.js in workerd via miniflare) and mocked Google bridges/Gemini.
// Checks what only a browser shows: the pairing card in settings, real
// IndexedDB (and its upgrade from the previous version), the live WebSocket,
// and a service worker that installs every file of this version.
//   npm install --no-save miniflare fake-indexeddb ; node tests/e2e.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge, createDrive, createGemini } from './mock-google.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const FAMILY_CODE = 'e2e-family-code-123456';
let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failures.push(name); console.log('  ✗', name, '\n   ', (e && e.stack) || e); }
};

console.log('TripNest in the browser (Chromium + workerd)\n');

let chromium, Miniflare;
try { ({ chromium } = require('playwright')); } catch { /* below */ }
try { ({ Miniflare } = await import(join(ROOT, 'node_modules/miniflare/dist/src/index.js'))); } catch { /* below */ }
if (!chromium || !Miniflare) { console.log('  ✗ needs playwright (in the image) and miniflare (npm install --no-save miniflare fake-indexeddb)'); process.exit(1); }

/* ---------- the app, served as GitHub Pages would ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const site = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${site.address().port}`;

/* ---------- the server and what it talks to ---------- */
const drive = createDrive();
const liron = createBridge({ url: 'https://script.google.com/macros/s/LIRON-BRIDGE/exec', token: 'liron-token', email: 'liron@example.com', drive });
const partner = createBridge({ url: 'https://script.google.com/macros/s/PARTNER-BRIDGE/exec', token: 'partner-token', email: 'partner@example.com', drive });
const gemini = createGemini();
const bridgeFor = (url) => [liron, partner].find((b) => String(url).startsWith(b.S.url));
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  scriptPath: join(ROOT, 'server/worker.js'),
  modulesRoot: join(ROOT, 'server'),
  compatibilityDate: '2026-07-01',
  durableObjects: { FAMILY: { className: 'Family', useSQLite: true } },
  bindings: { FAMILY_CODE },
  outboundService: async (req) => {
    const body = req.method === 'POST' ? await req.text() : '';
    if (req.url.startsWith('https://generativelanguage.googleapis.com/')) {
      const r = await gemini.handle(req.url, Object.fromEntries(req.headers), body);
      return new Response(r.text, { status: r.status });
    }
    const b = bridgeFor(req.url);
    return b ? new Response(await b.handle(body)) : new Response('not found', { status: 404 });
  },
});
const SERVER = String(await mf.ready).replace(/\/$/, '');

const browser = await chromium.launch();
async function phone({ sw = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: sw ? 'allow' : 'block' });
  await ctx.addInitScript((url) => { try { localStorage.setItem('tn:server', url); } catch { } }, SERVER);
  // the outside world: CDNs stubbed (Tailwind only styles), the bridges mocked
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('https://cdn.tailwindcss.com')) return route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = { config: {} };' });
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    const b = bridgeFor(u);
    if (b) return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await b.handle(route.request().postData() || '') });
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [page error]', e.message));
  return { ctx, page };
}
const ready = (page) => page.waitForFunction(() => window.Server && window.DB && document.getElementById('view-home'));
// a first install claims the page and the app's updater reloads it once — ride it out
async function settled(page, fn) {
  for (let i = 0; ; i++) {
    try { return await page.evaluate(fn); } catch (e) {
      if (i > 4 || !/Execution context was destroyed|navigat/i.test(e.message)) throw e;
      await page.waitForLoadState('load');
      await ready(page);
    }
  }
}

try {
  await test('the previous version\'s database upgrades in place: data kept, outbox added', async () => {
    const { ctx, page } = await phone();
    await page.goto(APP + '/manifest.json'); // same origin, no app code: write a v2 database by hand
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('TripNestDB', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['trips', 'members']) db.createObjectStore(s, { keyPath: 'id' });
        for (const s of ['documents', 'events', 'checklists', 'expenses', 'archive']) db.createObjectStore(s, { keyPath: 'id' }).createIndex('tripId', 'tripId');
        db.createObjectStore('vault', { keyPath: 'id' }).createIndex('memberId', 'memberId');
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const t = req.result.transaction(['trips', 'settings'], 'readwrite');
        t.objectStore('trips').put({ id: 'old-trip', name: 'רומא 2025', updatedAt: 5 });
        t.objectStore('settings').put({ key: 'myEmail', value: 'liron@example.com' });
        t.oncomplete = () => { req.result.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    }));
    await page.goto(APP + '/');
    await ready(page);
    const out = await page.evaluate(async () => ({
      trip: (await DB.get('trips', 'old-trip'))?.name,
      email: await DB.settings.get('myEmail'),
      outbox: (await DB.outbox.list()).length,
      put: !!(await DB.put('events', { tripId: 'old-trip', title: 'x' })),
      queued: (await DB.outbox.list()).length,
    }));
    assert.equal(out.trip, 'רומא 2025');
    assert.equal(out.email, 'liron@example.com');
    assert.equal(out.outbox, 0);
    assert.equal(out.queued, 1, 'a local write lands in the outbox');
    await ctx.close();
  });

  await test('the service worker installs every file of this version (none missing)', async () => {
    const { ctx, page } = await phone({ sw: true });
    await page.goto(APP + '/');
    await ready(page);
    const cached = await settled(page, async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !(await caches.keys()).length; i++) await new Promise((r) => setTimeout(r, 100));
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return { name: keys[0], urls: (await c.keys()).map((r) => new URL(r.url).pathname) };
    });
    assert.ok(cached.name === 'tripnest-' + (await (await fetch(APP + '/version.json')).json()).version, 'cache named after version.json: ' + cached.name);
    for (const f of ['/js/merge.js', '/js/server.js', '/js/db.js', '/js/app.js', '/index.html']) assert.ok(cached.urls.includes(f), 'not precached: ' + f);
    await ctx.close();
  });

  let A, B, code;
  await test('his phone: the bridge as today, then "חיבור לשרת" in settings with the family code', async () => {
    A = await phone();
    await A.page.goto(APP + '/');
    await ready(A.page);
    await A.page.evaluate(async () => {
      const S = DB.settings;
      await S.set('bridgeUrl', 'https://script.google.com/macros/s/LIRON-BRIDGE/exec'); await S.set('bridgeToken', 'liron-token');
      await S.set('partnerBridgeUrl', 'https://script.google.com/macros/s/PARTNER-BRIDGE/exec'); await S.set('partnerBridgeToken', 'partner-token');
      await S.set('driveFolderId', 'folder-shared-0001'); await S.set('driveFolderName', 'TripNest — Navigo');
      await S.set('myEmail', 'liron@example.com'); await S.set('geminiKey', 'gemini-key-liron');
      await DB.put('trips', { id: 'trip-ath', name: 'אתונה 2026', startDate: '2026-07-10', endDate: '2026-07-20' });
      await DB.put('checklists', { id: 'cl-1', tripId: 'trip-ath', title: 'אריזה', items: [{ id: 'i1', text: 'דרכונים', done: false, u: 1 }] });
      await G.Sync.run({ silent: true });
    });
    await A.page.evaluate(() => App.navigate('settings'));
    await A.page.waitForSelector('#st-srv-pair');
    await A.page.fill('#st-srv-code', FAMILY_CODE);
    await A.page.fill('#st-srv-name', 'הטלפון של לירון');
    await A.page.click('#st-srv-pair');
    await A.page.waitForSelector('#st-srv-sync', { timeout: 15000 });
    const card = await A.page.textContent('#settings-body');
    assert.match(card, /מחובר לשרת/);
    assert.match(card, /partner@example\.com/);
    const gone = await A.page.evaluate(async () => [await DB.settings.get('bridgeToken'), await DB.settings.get('geminiKey')]);
    assert.deepEqual(gone, [null, null]);
  });

  await test('"חיבור מכשיר נוסף" shows a one-time code', async () => {
    await A.page.click('#st-srv-add');
    await A.page.waitForFunction(() => /[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/.test(document.body.innerText));
    code = (await A.page.evaluate(() => document.body.innerText.match(/[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/)[0]));
    assert.ok(code);
    await A.page.click('#modal-close');
  });

  await test('her phone pairs with that code and gets the trip; his tick shows up there by itself', async () => {
    B = await phone();
    await B.page.goto(APP + '/');
    await ready(B.page);
    await B.page.evaluate(async () => {
      const S = DB.settings;
      await S.set('bridgeUrl', 'https://script.google.com/macros/s/PARTNER-BRIDGE/exec'); await S.set('bridgeToken', 'partner-token');
      await S.set('driveFolderId', 'folder-shared-0001'); await S.set('myEmail', 'partner@example.com');
    });
    await B.page.evaluate(() => App.navigate('settings'));
    await B.page.waitForSelector('#st-srv-pair');
    await B.page.fill('#st-srv-code', code);
    await B.page.click('#st-srv-pair');
    await B.page.waitForSelector('#st-srv-sync', { timeout: 15000 });
    assert.equal(await B.page.evaluate(async () => (await DB.get('trips', 'trip-ath'))?.name), 'אתונה 2026');
    await B.page.waitForFunction(() => Server._live() && Server._live().readyState === 1, null, { timeout: 5000 });
    await A.page.evaluate(async () => {
      const l = await DB.get('checklists', 'cl-1');
      l.items[0].done = true; l.items[0].u = Date.now();
      await DB.put('checklists', l);
      G.Sync.queue();
    });
    await B.page.waitForFunction(async () => (await DB.get('checklists', 'cl-1')).items[0].done === true, null, { timeout: 8000, polling: 100 });
  });

  await test('the agent on her phone answers through the server (no Gemini key on her phone)', async () => {
    gemini.G.calls = [];
    const text = await B.page.evaluate(async () => Gemini.textOf(await Gemini.call({ contents: [{ role: 'user', parts: [{ text: 'שלום' }] }] })));
    assert.match(text, /^ok:/);
    assert.equal(gemini.G.calls[0].key, 'gemini-key-liron');
  });

  await test('the devices screen lists both phones', async () => {
    await A.page.evaluate(() => App.navigate('settings'));
    await A.page.waitForSelector('#st-srv-devices');
    await A.page.click('#st-srv-devices');
    await A.page.waitForSelector('.srv-dev');
    assert.equal(await A.page.locator('.srv-dev').count(), 2);
    assert.equal(await A.page.locator('.srv-revoke').count(), 1, 'this phone has no revoke button for itself');
  });
} finally {
  await browser.close();
  await mf.dispose();
  site.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
