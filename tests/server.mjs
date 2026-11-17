// The Cloudflare server (server/), run for real: server/worker.js in workerd
// through miniflare, with the two Google bridges and Gemini mocked behind it.
//   npm install --no-save miniflare   (the session-start hook does it)
//   node tests/server.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge, createDrive, createGemini, b64, unb64 } from './mock-google.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAMILY_CODE = 'test-family-code-1234';
const LIRON = 'https://script.google.com/macros/s/LIRON-BRIDGE/exec';
const PARTNER = 'https://script.google.com/macros/s/PARTNER-BRIDGE/exec';
let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failures.push(name); console.log('  ✗', name, '\n   ', (e && e.stack) || e); }
};
const dev = (c) => c.repeat(43);
const waitFor = async (pred, ms = 3000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); };

console.log('TripNest server (workerd)\n');

await test('server/merge.js is js/merge.js as it stands', () => {
  const r = spawnSync(process.execPath, ['tools/make-server.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

let Miniflare;
try { ({ Miniflare } = await import(join(ROOT, 'node_modules/miniflare/dist/src/index.js'))); } catch { /* reported below */ }
if (!Miniflare) { try { ({ Miniflare } = await import('miniflare')); } catch { /* reported below */ } }
if (!Miniflare) {
  failures.push('miniflare is not installed (npm install --no-save miniflare)');
  console.log('  ✗ miniflare is not installed — npm install --no-save miniflare');
} else {
  const drive = createDrive();
  const liron = createBridge({
    url: LIRON, token: 'liron-token', email: 'liron@example.com', drive,
    messages: {
      'msg-1': { from: 'ELAL <no-reply@elal.co.il>', subject: 'טיסה לאתונה', date: '2026-07-01T10:00:00.000Z', text: 'ABC123', html: '<p>ABC123</p>',
        attachments: [{ filename: 'ticket.pdf', mimeType: 'application/pdf', bytes: 'PDF-BYTES' }], labels: ['Navigo'] },
    },
  });
  const partner = createBridge({
    url: PARTNER, token: 'partner-token', email: 'partner@example.com', drive,
    messages: {
      'pmsg-1': { from: 'ISSTA <deals@issta.co.il>', subject: 'שובר מלון', date: '2026-07-03T08:00:00.000Z', text: 'XYZ', html: '<p>XYZ</p>',
        attachments: [{ filename: 'voucher.pdf', mimeType: 'application/pdf', bytes: 'VOUCHER' }], labels: ['@Navigo'] },
    },
  });
  const gemini = createGemini();
  const outbound = [];
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
      outbound.push({ url: req.url, body });
      if (req.url.startsWith('https://generativelanguage.googleapis.com/')) {
        const r = await gemini.handle(req.url, Object.fromEntries(req.headers), body);
        return new Response(r.text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
      }
      for (const b of [liron, partner]) {
        if (req.url === b.S.url) {
          try { return new Response(await b.handle(body), { headers: { 'Content-Type': 'application/json' } }); }
          catch { return new Response('bad gateway', { status: 502 }); }
        }
      }
      return new Response('not found', { status: 404 });
    },
  });

  // the phone's request exactly: a string body, no headers (text/plain, no preflight)
  const call = async (body, payload = null) => {
    const r = await mf.dispatchFetch('https://navigo.test/', { method: 'POST', body: JSON.stringify(body) + (payload == null ? '' : '\n' + payload) });
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), text: null, ...(await r.json()) };
  };
  const A = dev('a'), B = dev('b'), C = dev('c');
  const bridges = [{ url: LIRON, token: 'liron-token', email: 'liron@example.com' }, { url: PARTNER, token: 'partner-token', email: 'partner@example.com' }];

  try {
    await test('health check and preflight carry CORS; unknown paths are refused', async () => {
      const h = await mf.dispatchFetch('https://navigo.test/');
      assert.equal(h.headers.get('access-control-allow-origin'), '*');
      assert.equal((await h.json()).result.service, 'navigo');
      const o = await mf.dispatchFetch('https://navigo.test/', { method: 'OPTIONS' });
      assert.equal(o.status, 204);
      const b = await mf.dispatchFetch('https://navigo.test/backup', { method: 'POST' });
      assert.equal(b.status, 404, 'the backup must not be reachable from outside');
    });

    await test('an unpaired phone gets nothing', async () => {
      for (const action of ['hello', 'pull', 'push', 'ai', 'gmailSearch', 'download', 'archiveGet', 'devices']) {
        const r = await call({ action, deviceKey: A });
        assert.equal(r.code, 'unpaired', action);
      }
    });

    await test('a wrong family code is refused', async () => {
      const r = await call({ action: 'pair', deviceKey: A, familyCode: 'nope-nope-nope' });
      assert.equal(r.code, 'bad_code');
    });

    let paired;
    await test('pairing with the family code adopts both bridges, the Gemini key and the folder — and leaks none of them', async () => {
      const r = await call({ action: 'pair', deviceKey: A, familyCode: FAMILY_CODE, name: 'הטלפון של לירון', mailbox: 'liron@example.com', appVersion: '2.0.0',
        bridges, geminiKey: 'gemini-key-liron', folderId: 'folder-shared-0001', folderName: 'TripNest — Navigo' });
      assert.equal(r.ok, true, r.error);
      paired = r.result;
      assert.deepEqual(paired.caps.mailboxes.sort(), ['liron@example.com', 'partner@example.com']);
      assert.equal(paired.caps.gemini, 1);
      assert.equal(paired.caps.drive, true);
      assert.equal(paired.rev, 0);
      assert.ok(paired.serverId && paired.routes.length === 2);
      const text = JSON.stringify(r);
      for (const s of ['liron-token', 'partner-token', 'gemini-key-liron']) assert.ok(!text.includes(s), 'secret in a reply: ' + s);
    });

    await test('pairing again with the same device key needs no code (a lost answer)', async () => {
      const r = await call({ action: 'pair', deviceKey: A });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.result.serverId, paired.serverId);
    });

    await test('push → pull: changes reach the other phone, a resend changes nothing', async () => {
      const add = await call({ action: 'pairCode', deviceKey: A });
      assert.match(add.result.code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      const pb = await call({ action: 'pair', deviceKey: B, code: add.result.code.toLowerCase().replace('-', ' '), name: 'הטלפון שלה', mailbox: 'partner@example.com' });
      assert.equal(pb.ok, true, pb.error);
      const again = await call({ action: 'pair', deviceKey: C, code: add.result.code });
      assert.equal(again.code, 'bad_code', 'a one-time code works once');

      const trip = { id: 'trip-1', name: 'אתונה', startDate: '2026-07-10', updatedAt: 1000 };
      const ev = { id: 'ev-1', tripId: 'trip-1', title: 'טיסה', date: '2026-07-10', updatedAt: 1001 };
      const p = await call({ action: 'push', deviceKey: A, changes: [{ store: 'trips', rec: trip }, { store: 'events', rec: ev }] });
      assert.equal(p.result.applied, 2);
      const pull = await call({ action: 'pull', deviceKey: B, since: 0 });
      assert.equal(pull.result.changes.length, 2);
      assert.deepEqual(pull.result.changes.map((c) => c.store), ['trips', 'events']);
      assert.equal(pull.result.changes[0].rec.name, 'אתונה');
      const again2 = await call({ action: 'push', deviceKey: A, changes: [{ store: 'trips', rec: trip }] });
      assert.equal(again2.result.applied, 0, 'a resend must be a no-op');
      const none = await call({ action: 'pull', deviceKey: B, since: pull.result.rev });
      assert.equal(none.result.changes.length, 0);
    });

    await test('the newer stamp wins; an older one is ignored; a tie resolves the same everywhere', async () => {
      await call({ action: 'push', deviceKey: B, changes: [{ store: 'trips', rec: { id: 'trip-1', name: 'אתונה וכרתים', updatedAt: 2000 } }] });
      const old = await call({ action: 'push', deviceKey: A, changes: [{ store: 'trips', rec: { id: 'trip-1', name: 'ישן', updatedAt: 1500 } }] });
      assert.equal(old.result.applied, 0);
      const t1 = await call({ action: 'push', deviceKey: A, changes: [{ store: 'events', rec: { id: 'tie', title: 'a', updatedAt: 5 } }] });
      const t2 = await call({ action: 'push', deviceKey: B, changes: [{ store: 'events', rec: { id: 'tie', title: 'b', updatedAt: 5 } }] });
      assert.equal(t1.result.applied + t2.result.applied >= 1, true);
      const all = (await call({ action: 'pull', deviceKey: A, since: 0 })).result.changes;
      assert.equal(all.find((c) => c.rec.id === 'trip-1').rec.name, 'אתונה וכרתים');
      assert.equal(all.find((c) => c.rec.id === 'tie').rec.title, 'b', 'tie-break by content: "b" > "a" on every side');
    });

    await test('a checklist merges per item on the server: both ticks survive', async () => {
      const items = [{ id: 'i1', text: 'דרכונים', done: false, u: 1 }, { id: 'i2', text: 'מטען', done: false, u: 1 }];
      await call({ action: 'push', deviceKey: A, changes: [{ store: 'checklists', rec: { id: 'L1', tripId: 'trip-1', title: 'אריזה', items, updatedAt: 10 } }] });
      await call({ action: 'push', deviceKey: A, changes: [{ store: 'checklists', rec: { id: 'L1', tripId: 'trip-1', title: 'אריזה', items: [{ ...items[0], done: true, u: 20 }, items[1]], updatedAt: 20 } }] });
      await call({ action: 'push', deviceKey: B, changes: [{ store: 'checklists', rec: { id: 'L1', tripId: 'trip-1', title: 'אריזה', items: [items[0], { ...items[1], done: true, u: 15 }], updatedAt: 15 } }] });
      const l = (await call({ action: 'pull', deviceKey: A, since: 0 })).result.changes.find((c) => c.rec.id === 'L1').rec;
      assert.deepEqual(l.items.map((i) => i.done), [true, true]);
    });

    await test('files never live in records; a broken clock and a wrong store are refused', async () => {
      const r = await call({ action: 'push', deviceKey: A, changes: [
        { store: 'documents', rec: { id: 'd1', tripId: 'trip-1', fileName: 'x.pdf', blob: { a: 1 }, blobData: 'data:...', updatedAt: 30 } },
        { store: 'documents', rec: { id: 'd2', updatedAt: Date.now() + 3 * 86400000 } },
        { store: 'vault', rec: { id: 'v1', updatedAt: 1 } },
      ] });
      assert.equal(r.result.applied, 1);
      assert.deepEqual(r.result.rejected.map((x) => x.code), ['clock', 'bad_record']);
      const d = (await call({ action: 'pull', deviceKey: B, since: 0 })).result.changes.find((c) => c.rec.id === 'd1').rec;
      assert.ok(!('blob' in d) && !('blobData' in d));
    });

    await test('live: the other phone hears about a change; ping is answered without waking the object', async () => {
      const res = await mf.dispatchFetch('https://navigo.test/live', { headers: { Upgrade: 'websocket' } });
      const ws = res.webSocket;
      assert.ok(ws, 'no websocket');
      ws.accept();
      const got = [];
      ws.addEventListener('message', (e) => got.push(String(e.data)));
      ws.send(JSON.stringify({ type: 'hello', deviceKey: B }));
      await waitFor(() => got.length >= 1);
      const first = JSON.parse(got[0]);
      assert.equal(first.type, 'rev');
      await call({ action: 'push', deviceKey: A, changes: [{ store: 'expenses', rec: { id: 'x1', tripId: 'trip-1', amount: 50, updatedAt: 40 } }] });
      await waitFor(() => got.length >= 2);
      const second = JSON.parse(got[1]);
      assert.equal(second.type, 'rev');
      assert.ok(second.rev > first.rev);
      ws.send('ping');
      await waitFor(() => got.includes('pong'));
      assert.ok(got.includes('pong'));
      ws.close();
    });

    await test('devices: list, and a lost phone is revoked — its key stops working at once', async () => {
      const pc = await call({ action: 'pairCode', deviceKey: A });
      await call({ action: 'pair', deviceKey: C, code: pc.result.code, name: 'טלפון ישן' });
      const list = (await call({ action: 'devices', deviceKey: A })).result;
      assert.equal(list.length, 3);
      assert.ok(list.find((d) => d.me).name === 'הטלפון של לירון');
      const old = list.find((d) => d.name === 'טלפון ישן');
      const r = await call({ action: 'revoke', deviceKey: B, id: old.id });
      assert.equal(r.result.revoked, 1);
      assert.equal((await call({ action: 'pull', deviceKey: C, since: 0 })).code, 'unpaired');
      assert.equal((await call({ action: 'devices', deviceKey: A })).result.length, 2);
    });

    await test('Gemini from the server: the key in a header, the payload untouched, the status kept', async () => {
      gemini.G.calls = []; gemini.G.behavior = {};
      const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'שלום' }] }] });
      const r = await call({ action: 'ai', deviceKey: A, model: 'gemini-3.5-flash' }, payload);
      assert.equal(r.result.status, 200);
      assert.match(r.result.body.candidates[0].content.parts[0].text, /^ok:gemini-3.5-flash:gemini-key-liron$/);
      assert.equal(gemini.G.calls[0].key, 'gemini-key-liron');
      assert.equal(gemini.G.calls[0].body, payload);
      assert.ok(!gemini.G.calls[0].url.includes('gemini-key'), 'key must not be in the URL');
      const bad = await call({ action: 'ai', deviceKey: A, model: '../evil' }, payload);
      assert.equal(bad.code, 'bad_request');
    });

    await test('Gemini: a key out of quota hands over to the other key; an upstream error keeps its status', async () => {
      await call({ action: 'pair', deviceKey: B, geminiKey: 'gemini-key-partner' });
      gemini.G.calls = [];
      gemini.G.byKey = { 'gemini-key-liron': { status: 429, apiStatus: 'RESOURCE_EXHAUSTED' } };
      const payload = JSON.stringify({ contents: [] });
      let r = await call({ action: 'ai', deviceKey: A, model: 'm1' }, payload);
      assert.equal(r.result.status, 200);
      assert.ok(gemini.G.calls.some((c) => c.key === 'gemini-key-partner'));
      gemini.G.byKey = {};
      gemini.G.behavior = { m2: { status: 400, apiStatus: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } };
      r = await call({ action: 'ai', deviceKey: A, model: 'm2' }, payload);
      assert.equal(r.result.status, 400);
      assert.equal(r.result.body.error.status, 'FAILED_PRECONDITION');
      gemini.G.behavior = { m3: { status: 503, nonJson: true } };
      r = await call({ action: 'ai', deviceKey: A, model: 'm3' }, payload);
      assert.equal(r.result.status, 503);
      assert.equal(r.result.body, null);
    });

    await test('Gemini: a slow answer keeps the line alive with spaces, then the JSON', async () => {
      gemini.G.byKey = {}; gemini.G.behavior = { slow: { status: 200, delayMs: 6500, reply: 'late' } };
      const r = await mf.dispatchFetch('https://navigo.test/', { method: 'POST', body: JSON.stringify({ action: 'ai', deviceKey: A, model: 'slow' }) + '\n{"contents":[]}' });
      const text = await r.text();
      assert.equal(r.status, 200);
      assert.match(text, /^ +\{/, 'expected keep-alive spaces before the JSON');
      assert.equal(JSON.parse(text).result.body.candidates[0].content.parts[0].text, 'late');
      gemini.G.behavior = {};
    });

    await test('Gmail: one search covers both mailboxes, ids carry the mailbox, reads go to the right bridge', async () => {
      const r = await call({ action: 'gmailSearch', deviceKey: B, q: 'label:navigo', max: 25, label: 'navigo' });
      assert.deepEqual(r.result.messages.map((m) => m.id).sort(), ['liron@example.com/msg-1', 'partner@example.com/pmsg-1']);
      assert.equal(r.result.messages.find((m) => m.id.startsWith('partner')).mailbox, 'partner@example.com');
      const full = await call({ action: 'gmailGet', deviceKey: B, id: 'liron@example.com/msg-1' });
      assert.equal(full.result.attachments[0].filename, 'ticket.pdf');
      const att = await call({ action: 'gmailAttachment', deviceKey: A, id: 'partner@example.com/pmsg-1', index: 0 });
      assert.equal(unb64(att.result.data), 'VOUCHER');
      assert.equal(liron.S.calls.at(-1).action, 'gmailGet');
      assert.equal(partner.S.calls.at(-1).action, 'gmailAttachment');
    });

    await test('Gmail: a mailbox that does not answer is reported, the other still comes back', async () => {
      partner.S.down = true;
      try {
        const r = await call({ action: 'gmailSearch', deviceKey: A, q: 'x', label: 'navigo' });
        assert.deepEqual(r.result.messages.map((m) => m.mailbox), ['liron@example.com']);
        assert.equal(r.result.errors[0].mailbox, 'partner@example.com');
      } finally { partner.S.down = false; }
    });

    await test('files: upload lands in the shared folder through the phone\'s own bridge, once per document', async () => {
      const data = b64('PDF-BYTES-1');
      const head = { action: 'upload', deviceKey: B, docId: 'doc-1', tripId: 'trip-1', tripName: 'אתונה', fileName: 'ticket.pdf', mimeType: 'application/pdf' };
      const r = await call(head, data);
      assert.equal(r.ok, true, r.error);
      const f = drive.files[r.result.fileId];
      assert.equal(f.by, 'partner@example.com', 'the phone\'s own mailbox bridge first');
      assert.equal(unb64(f.data), 'PDF-BYTES-1');
      const again = await call(head, data);
      assert.equal(again.result.fileId, r.result.fileId, 'a retry must not upload a second copy');
      const down = await call({ action: 'download', deviceKey: A, fileId: r.result.fileId });
      assert.equal(unb64(down.result.data), 'PDF-BYTES-1');
      assert.equal(down.result.mimeType, 'application/pdf');
      const pass = await call({ ...head, docId: 'pp', category: 'passport' }, data);
      assert.equal(pass.code, 'passport');
      const inj = await call({ ...head, docId: 'inj' }, 'abc","folderId":"other');
      assert.equal(inj.code, 'bad_request');
    });

    await test('files: when one bridge fails, the other account (same shared folder) takes the upload', async () => {
      partner.S.down = true;
      try {
        const r = await call({ action: 'upload', deviceKey: B, docId: 'doc-2', tripId: 'trip-1', fileName: 'b.pdf', mimeType: 'application/pdf' }, b64('B'));
        assert.equal(r.ok, true, r.error);
        assert.equal(drive.files[r.result.fileId].by, 'liron@example.com');
      } finally { partner.S.down = false; }
    });

    await test('chat archive: union by id, per trip, shared by both phones', async () => {
      const t = (id, tripId, text) => ({ id, ts: Date.now(), tripId, role: 'user', text });
      let r = await call({ action: 'archivePut', deviceKey: A, turns: [t('a1', 'trip-1', 'שלום'), t('a2', null, 'כללי')] });
      assert.equal(r.result.added, 2);
      r = await call({ action: 'archivePut', deviceKey: B, turns: [t('a1', 'trip-1', 'שלום'), t('b1', 'trip-1', 'עוד')] });
      assert.equal(r.result.added, 1);
      const trip = await call({ action: 'archiveGet', deviceKey: B, tripId: 'trip-1' });
      assert.deepEqual(trip.result.turns.map((x) => x.id).sort(), ['a1', 'b1']);
      const gen = await call({ action: 'archiveGet', deviceKey: A, tripId: null });
      assert.deepEqual(gen.result.turns.map((x) => x.id), ['a2']);
    });

    await test('nightly backup: one file per weekday in the shared folder, no secrets in it, skipped when nothing changed', async () => {
      const worker = await mf.getWorker();
      await worker.scheduled({ cron: '41 0 * * *' });
      await waitFor(() => Object.values(drive.files).some((f) => f.name.startsWith('navigo-backup-')));
      const f = Object.values(drive.files).find((x) => x.name.startsWith('navigo-backup-'));
      assert.ok(f, 'no backup file');
      assert.match(f.name, /^navigo-backup-\d-(sun|mon|tue|wed|thu|fri|sat)\.json$/);
      const text = unb64(f.data);
      const content = JSON.parse(text);
      assert.equal(content.kind, 'server-backup');
      assert.ok(content.records.some((r) => r.rec.id === 'trip-1'));
      assert.ok(content.archive.length >= 3);
      for (const s of ['liron-token', 'partner-token', 'gemini-key-liron', 'gemini-key-partner', A, B]) assert.ok(!text.includes(s), 'secret in the backup: ' + s.slice(0, 12));
      const before = outbound.filter((o) => o.body.includes('"filePut"')).length;
      await worker.scheduled({ cron: '41 0 * * *' });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(outbound.filter((o) => o.body.includes('"filePut"')).length, before, 'an unchanged night must not write again');
      const h = await call({ action: 'hello', deviceKey: A, appVersion: '2.0.0' });
      assert.ok(h.result.caps.backupAt > 0);
    });

    await test('too many wrong codes lock pairing for a while', async () => {
      let last;
      for (let i = 0; i < 10; i++) last = await call({ action: 'pair', deviceKey: dev('z'), code: 'AAAA-AAAA' });
      assert.equal(last.code, 'locked');
      const okDev = await call({ action: 'hello', deviceKey: A });
      assert.equal(okDev.ok, true, 'paired phones keep working');
    });
  } finally {
    await mf.dispose();
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
