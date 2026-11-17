// Two phones, the real app modules (js/merge.js, db.js, gemini.js, google.js,
// server.js, archive.js) over fake-indexeddb, against the real server
// (server/worker.js in workerd via miniflare) and mocked Google bridges/Gemini.
// It walks the whole move: Drive sync as today → pairing (one phone still on
// Drive meanwhile) → live sync between the phones → Gemini, Gmail and files
// through the server → a network that blocks the server → a lost phone.
//   npm install --no-save miniflare fake-indexeddb   (the session-start hook does it)
//   node tests/sync.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge, createDrive, createGemini, b64, unb64 } from './mock-google.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAMILY_CODE = 'family-code-for-tests-42';
const LIRON = 'https://script.google.com/macros/s/LIRON-BRIDGE/exec';
const PARTNER = 'https://script.google.com/macros/s/PARTNER-BRIDGE/exec';
let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failures.push(name); console.log('  ✗', name, '\n   ', (e && e.stack) || e); }
};
const waitFor = async (pred, ms = 5000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};

console.log('TripNest two-phone sync (app modules + workerd)\n');

let Miniflare, IDB;
try { ({ Miniflare } = await import(join(ROOT, 'node_modules/miniflare/dist/src/index.js'))); } catch { /* below */ }
try { IDB = await import(join(ROOT, 'node_modules/fake-indexeddb/build/esm/index.js')); } catch { /* below */ }
if (!Miniflare || !IDB) {
  console.log('  ✗ needs: npm install --no-save miniflare fake-indexeddb');
  process.exit(1);
}

const drive = createDrive();
const liron = createBridge({
  url: LIRON, token: 'liron-token', email: 'liron@example.com', drive,
  messages: { 'msg-1': { from: 'ELAL <no-reply@elal.co.il>', subject: 'טיסה לאתונה', date: '2026-07-01T10:00:00.000Z', text: 'ABC123', html: '<p>ABC123</p>',
    attachments: [{ filename: 'ticket.pdf', mimeType: 'application/pdf', bytes: 'PDF-BYTES' }], labels: ['Navigo'] } },
});
const partner = createBridge({
  url: PARTNER, token: 'partner-token', email: 'partner@example.com', drive,
  messages: { 'pmsg-1': { from: 'ISSTA <deals@issta.co.il>', subject: 'שובר מלון — סנטוריני', date: '2026-07-03T08:00:00.000Z', text: 'XYZ', html: '<p>XYZ</p>',
    attachments: [{ filename: 'voucher.pdf', mimeType: 'application/pdf', bytes: 'VOUCHER' }], labels: ['@Navigo'] } },
});
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
    if (b) { try { return new Response(await b.handle(body)); } catch { return new Response('down', { status: 502 }); } }
    return new Response('not found', { status: 404 });
  },
});
const SERVER = String(await mf.ready).replace(/\/$/, '');
// bridge v1.5.0: forward the request to the server from Google's side
for (const b of [liron, partner]) {
  b.S.forwardTo = async (text) => (await fetch(SERVER + '/', { method: 'POST', body: text })).text();
}

/* ---------- a phone: the app's modules in their own global scope ---------- */
function makePhone(label) {
  const listeners = {};
  const store = new Map([['tn:server', SERVER]]);
  const toasts = [];
  const phone = {
    label, toasts, blocked: false, clockOffset: 0,
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    URL, Blob, TextEncoder, TextDecoder, atob, btoa, crypto, AbortController, performance,
    indexedDB: new IDB.IDBFactory(), IDBKeyRange: IDB.IDBKeyRange,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) test-' + label },
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then((buf) => { this.result = `data:${blob.type};base64,` + Buffer.from(buf).toString('base64'); this.onload && this.onload(); })
          .catch((e) => this.onerror && this.onerror(e));
      }
    },
    UI: { toast: (m, t) => toasts.push({ m, t }), esc: (s) => String(s) },
    _BUNDLE_VERSION: '2.0.0',
  };
  phone.document = {
    visibilityState: 'visible',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent: (e) => { for (const fn of listeners[e.type] || []) { try { fn(e); } catch (err) { console.error(err); } } return true; },
  };
  phone.events = [];
  phone.document.addEventListener('tn-sync-state', (e) => phone.events.push('sync:' + e.detail));
  phone.document.addEventListener('tn-route', (e) => phone.events.push('route:' + e.detail.around));
  // the network: a blocked server throws like a phone that cannot reach it
  phone.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(SERVER)) {
      if (phone.blocked) throw new TypeError('fetch failed');
      return fetch(url, opts);
    }
    const b = bridgeFor(u);
    if (b) {
      const text = await b.handle(opts.body);
      return new Response(text, { status: 200 });
    }
    if (u.startsWith('https://generativelanguage.googleapis.com/')) {
      const r = await gemini.handle(u, opts.headers || {}, opts.body);
      return new Response(r.text, { status: r.status });
    }
    throw new TypeError('unexpected fetch ' + u);
  };
  phone.WebSocket = class extends WebSocket {
    constructor(url) { if (phone.blocked) throw new Error('blocked'); super(url); }
  };
  vm.createContext(phone);
  vm.runInContext('var window = globalThis; var self = globalThis;', phone);
  for (const f of ['js/merge.js', 'js/db.js', 'js/gemini.js', 'js/google.js', 'js/server.js', 'js/archive.js']) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf-8'), phone, { filename: f });
  }
  Object.assign(phone.Server.config, { retryDelayMs: 10, viaMs: 400, pollMs: 200, helloMs: 0, pingMs: 1000, wsBackoff: [50, 100, 200] });
  return phone;
}

const A = makePhone('liron');
const B = makePhone('partner');
const S = (p) => p.DB.settings;

async function setupLegacy(p, mine, theirs, myEmail, theirEmail, geminiKey) {
  await p.DB.init();
  await S(p).set('bridgeUrl', mine.S.url); await S(p).set('bridgeToken', mine.S.token);
  await S(p).set('partnerBridgeUrl', theirs.S.url); await S(p).set('partnerBridgeToken', theirs.S.token);
  await S(p).set('driveFolderId', 'folder-shared-0001'); await S(p).set('driveFolderName', 'TripNest — Navigo');
  await S(p).set('myEmail', myEmail); await S(p).set('partnerEmail', theirEmail);
  await S(p).set('geminiKey', geminiKey);
  await p.Server.init();
  p.Archive.init();
}

try {
  await setupLegacy(A, liron, partner, 'liron@example.com', 'partner@example.com', 'gemini-key-liron');
  await setupLegacy(B, partner, liron, 'partner@example.com', 'liron@example.com', 'gemini-key-partner');

  let trip, list, doc;
  await test('before pairing: the two phones share a trip through Drive, as today', async () => {
    trip = await A.DB.put('trips', { name: 'אתונה 2026', startDate: '2026-07-10', endDate: '2026-07-20' });
    list = await A.DB.put('checklists', { tripId: trip.id, title: 'אריזה', items: [
      { id: 'i1', text: 'דרכונים', done: false, u: 1 }, { id: 'i2', text: 'מטען', done: false, u: 1 }, { id: 'i3', text: 'כובע', done: false, u: 1 }] });
    doc = await A.DB.put('documents', { tripId: trip.id, fileName: 'ticket.pdf', mimeType: 'application/pdf', category: 'flight',
      blob: new Blob(['PDF-BYTES'], { type: 'application/pdf' }) });
    await A.DB.settings.set('agentNotes', [{ id: 'n1', note: 'צמחונים' }]); await A.DB.touchShared();
    assert.equal((await A.G.Sync.run({ silent: true })).ok, true);
    assert.equal((await B.G.Sync.run({ silent: true })).ok, true);
    assert.equal((await B.DB.get('trips', trip.id)).name, 'אתונה 2026');
    assert.equal(await (await B.DB.get('documents', doc.id)).blob.text(), 'PDF-BYTES');
    assert.deepEqual(await B.DB.settings.get('agentNotes'), [{ id: 'n1', note: 'צמחונים' }]);
  });

  await test('she, still on Drive, ticks an item; pairing his phone brings her tick along', async () => {
    const l = await B.DB.get('checklists', list.id);
    l.items[1].done = true; l.items[1].u = Date.now();
    await B.DB.put('checklists', l);
    assert.equal((await B.G.Sync.run({ silent: true })).ok, true); // B still syncs through Drive
    const steps = [];
    const res = await A.Server.pair({ familyCode: FAMILY_CODE, name: 'הטלפון של לירון', onStep: (t) => t && steps.push(t) });
    assert.ok(steps.some((t) => /דרייב/.test(t)), 'the Drive catch-up step ran');
    assert.deepEqual([...res.caps.mailboxes].sort(), ['liron@example.com', 'partner@example.com']);
    assert.equal(A.Server.isPaired(), true);
    assert.equal((await A.DB.get('checklists', list.id)).items[1].done, true, 'her Drive tick came along');
  });

  await test('after pairing his phone holds no bridge token and no Gemini key', async () => {
    for (const k of ['bridgeUrl', 'bridgeToken', 'partnerBridgeUrl', 'partnerBridgeToken', 'geminiKey']) {
      assert.equal(await A.DB.settings.get(k), null, k + ' must be erased');
    }
    assert.equal(await A.DB.settings.get('myEmail'), 'liron@example.com');
    assert.equal(await A.Gemini.hasKey(), true, 'the server holds a key');
  });

  await test('her phone pairs with a one-time code from his; nothing is lost on the way', async () => {
    const { code } = await A.Server.pairCode();
    await B.Server.pair({ code, name: 'הטלפון שלה' });
    assert.equal(B.Server.isPaired(), true);
    const l = await B.DB.get('checklists', list.id);
    assert.equal(l.items.length, 3);
    assert.equal(l.items[1].done, true);
    assert.equal(await B.DB.settings.get('partnerBridgeToken'), null);
    assert.deepEqual(await B.DB.settings.get('agentNotes'), [{ id: 'n1', note: 'צמחונים' }]);
  });

  await test('live: his tick reaches her phone within a moment, without her opening anything', async () => {
    await waitFor(() => A.Server._live() && A.Server._live().readyState === 1);
    await waitFor(() => B.Server._live() && B.Server._live().readyState === 1);
    const l = await A.DB.get('checklists', list.id);
    l.items[0].done = true; l.items[0].u = Date.now();
    await A.DB.put('checklists', l);
    await A.G.Sync.run({ silent: true });
    const ok = await waitFor(async () => (await B.DB.get('checklists', list.id)).items[0].done === true, 4000);
    assert.ok(ok, 'her phone did not hear about the change');
  });

  await test('offline on both phones, each ticks another item: after both sync, both ticks stand everywhere', async () => {
    const la = await A.DB.get('checklists', list.id);
    la.items[2].done = true; la.items[2].u = Date.now();
    await A.DB.put('checklists', la);
    const lb = await B.DB.get('checklists', list.id);
    lb.items.push({ id: 'i4', text: 'מטריה', done: false, u: Date.now() + 1 });
    await B.DB.put('checklists', lb);
    await Promise.all([A.G.Sync.run({ silent: true }), B.G.Sync.run({ silent: true })]);
    await A.G.Sync.run({ silent: true }); await B.G.Sync.run({ silent: true });
    for (const p of [A, B]) {
      const l = await p.DB.get('checklists', list.id);
      const byId = Object.fromEntries(l.items.map((i) => [i.id, i]));
      assert.ok(byId.i1.done && byId.i2.done && byId.i3.done && byId.i4, `${p.label}: ` + JSON.stringify(l.items));
    }
  });

  await test('a deleted record stays deleted on the other phone', async () => {
    const ev = await A.DB.put('events', { tripId: trip.id, title: 'סיור', date: '2026-07-11' });
    await A.G.Sync.run({ silent: true }); await B.G.Sync.run({ silent: true });
    assert.ok(await B.DB.get('events', ev.id));
    await B.DB.remove('events', ev.id);
    await B.G.Sync.run({ silent: true }); await A.G.Sync.run({ silent: true });
    assert.equal((await A.DB.get('events', ev.id)).deleted, true);
  });

  await test('Gemini from her phone goes through the server (her key is no longer on the phone)', async () => {
    gemini.G.calls = []; gemini.G.behavior = {}; gemini.G.byKey = {};
    const data = await B.Gemini.call({ contents: [{ role: 'user', parts: [{ text: 'שלום' }] }] });
    assert.match(B.Gemini.textOf(data), /^ok:/);
    assert.ok(gemini.G.calls.length >= 1 && gemini.G.calls.every((c) => c.key.startsWith('gemini-key-')));
    gemini.G.behavior = { [B.Gemini.DEFAULT_MODELS[0]]: { status: 429 } };
    const next = await B.Gemini.call({ contents: [] });
    assert.match(B.Gemini.textOf(next), new RegExp(B.Gemini.DEFAULT_MODELS[1].replace(/\./g, '\\.')), 'the cascade still walks the models');
    gemini.G.behavior = { [B.Gemini.DEFAULT_MODELS[0]]: { status: 400, apiStatus: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } };
    await assert.rejects(B.Gemini.call({ contents: [] }), (e) => e.message === B.Gemini.LOCATION_MSG);
    gemini.G.behavior = {};
  });

  await test('Gmail from her phone: both mailboxes, absolute ids, and an import works from either', async () => {
    const res = await B.G.gmail.search('label:navigo', 25, { label: 'navigo' });
    assert.deepEqual([...res.map((m) => m.id)].sort(), ['liron@example.com/msg-1', 'partner@example.com/pmsg-1']); // spread: an array of this realm
    const theirs = res.find((m) => m.mailbox === 'liron@example.com');
    const full = await B.G.gmail.getFull(theirs.id);
    assert.equal(full.payload.attachments[0].filename, 'ticket.pdf');
    const blob = await B.G.gmail.getAttachment(theirs.id, full.payload.attachments[0]);
    assert.equal(await blob.text(), 'PDF-BYTES');
    assert.equal(await B.G.hasPartnerBridge(), true);
  });

  await test('a document added on her phone reaches his — file and all — through the server and Drive', async () => {
    const d = await B.DB.put('documents', { tripId: trip.id, fileName: 'voucher.pdf', mimeType: 'application/pdf', category: 'stay',
      blob: new Blob(['VOUCHER-BYTES'], { type: 'application/pdf' }) });
    await B.G.Sync.run({ silent: true });
    const up = await B.DB.get('documents', d.id);
    assert.ok(up.driveFileId, 'uploaded to Drive');
    assert.equal(drive.files[up.driveFileId].by, 'partner@example.com', 'through her own bridge');
    await A.G.Sync.run({ silent: true });
    const got = await A.DB.get('documents', d.id);
    assert.equal(await got.blob.text(), 'VOUCHER-BYTES');
    const pass = await B.DB.put('documents', { tripId: trip.id, fileName: 'passport.jpg', mimeType: 'image/jpeg', category: 'passport',
      blob: new Blob(['PASSPORT'], { type: 'image/jpeg' }) });
    await B.G.Sync.run({ silent: true });
    assert.ok(!(await B.DB.get('documents', pass.id)).driveFileId, 'a passport never uploads');
    assert.ok(!Object.values(drive.files).some((f) => f.name === 'passport.jpg'));
  });

  await test('the chat archive is shared: a turn archived on his phone is searchable on hers', async () => {
    await A.Archive.add([{ id: 'turn-1', tripId: trip.id, role: 'user', text: 'איפה אוכלים באתונה?' }]);
    await A.G.Sync.run({ silent: true });
    await waitFor(async () => (await A.DB.settings.get('archiveDirty')).length === 0);
    await B.Archive.pull(trip.id);
    const hits = await B.Archive.search('אוכלים');
    assert.equal(hits[0] && hits[0].id, 'turn-1');
  });

  await test('a network that blocks the server: requests go around through Google, then back', async () => {
    A.blocked = true;
    try {
      const e = await A.DB.put('expenses', { tripId: trip.id, amount: 30, currency: '€', category: 'food' });
      const r = await A.G.Sync.run({ silent: true });
      assert.equal(r.ok, true, r.error);
      assert.equal(A.Server.goingAround(), true);
      assert.ok(A.events.includes('route:true'));
      assert.ok(liron.S.calls.some((c) => c.forward != null), 'the request went through the Google bridge');
      await B.G.Sync.run({ silent: true });
      assert.ok(await B.DB.get('expenses', e.id), 'her phone sees what went around');
    } finally { A.blocked = false; }
    await new Promise((r) => setTimeout(r, 450)); // viaMs passes
    const r2 = await A.G.Sync.run({ silent: true });
    assert.equal(r2.ok, true);
    assert.equal(A.Server.goingAround(), false, 'back on the direct way');
  });

  await test('a lost phone: revoked from the other one, it is told at once and stops', async () => {
    const list2 = await A.Server.devices();
    const hers = list2.find((d) => !d.me);
    await A.Server.revoke(hers.id);
    await waitFor(() => !B.Server.isPaired(), 3000);
    if (B.Server.isPaired()) await B.G.Sync.run({ silent: true });
    assert.equal(B.Server.isPaired(), false);
    assert.ok(B.toasts.some((t) => /נותק/.test(t.m)));
    const local = await B.DB.get('trips', trip.id);
    assert.ok(local, 'the data on the phone stays');
  });
  await test('a pairing cut off mid-upload is finished by the next sync — nothing only that phone held is lost', async () => {
    const C = makePhone('third');
    await C.DB.init();
    await C.Server.init();
    C.Archive.init();
    await C.DB.put('trips', { id: 'trip-only-c', name: 'אילת', startDate: '2026-12-01' });
    const { code } = await A.Server.pairCode();
    const allRaw = C.DB.allRaw;
    let cut = true;
    C.DB.allRaw = async (st) => { if (cut && st === 'trips') { cut = false; throw new Error('the network dropped'); } return allRaw(st); };
    await assert.rejects(C.Server.pair({ code, name: 'טלפון שלישי' }));
    assert.equal(C.Server.isPaired(), true, 'the pairing itself went through');
    assert.equal(C.Server.state().seeded, false);
    assert.equal((await C.G.Sync.run({ silent: true })).ok, true);
    assert.equal(C.Server.state().seeded, true);
    await A.G.Sync.run({ silent: true });
    assert.equal((await A.DB.get('trips', 'trip-only-c'))?.name, 'אילת');
    C.document.visibilityState = 'hidden'; C.document.dispatchEvent({ type: 'visibilitychange' });
  });
  await test('a blocked server and only old bridges (no forward): the real error, never "bad token"', async () => {
    const saved = [liron.S.forwardTo, partner.S.forwardTo];
    liron.S.forwardTo = null; partner.S.forwardTo = null; // bridges before v1.5.0
    A.blocked = true;
    try {
      const r = await A.G.Sync.run({ silent: true });
      assert.equal(r.code, 'network', JSON.stringify(r));
      assert.ok(!/bad token/.test(r.error), 'the old bridge refusal must not reach the user: ' + r.error);
    } finally { A.blocked = false; [liron.S.forwardTo, partner.S.forwardTo] = saved; }
  });
} finally {
  for (const p of [A, B]) { try { p.document.visibilityState = 'hidden'; p.document.dispatchEvent({ type: 'visibilitychange' }); } catch { } }
  await mf.dispose();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
