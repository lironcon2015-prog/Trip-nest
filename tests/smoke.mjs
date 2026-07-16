/* TripNest — smoke test for the Apps Script bridge client (js/google.js).
   Runs in plain Node (>=18): mocks the bridge over fetch, a minimal DB/UI/DOM,
   then drives ping, bad token, folder setup, Gmail scan, import and full sync.
   Usage: node tests/smoke.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- mock bridge (in-memory Apps Script) ---------- */
const BRIDGE_URL = 'https://script.google.com/macros/s/MOCK/exec';
const TOKEN = 'test-secret-token';

const bridgeState = {
  email: 'liron@example.com',
  folders: {},   // id -> { name, description, parent, shares:[] }
  files: {},     // id -> { name, mimeType, data(base64), parent }
  nextId: 1,
  messages: {
    'msg-1': {
      from: 'ELAL <no-reply@elal.co.il>', subject: 'אישור הזמנה — טיסה לאתונה',
      date: '2026-07-01T10:00:00.000Z', text: 'קוד הזמנה ABC123', html: '<p>קוד הזמנה ABC123</p>',
      attachments: [{ filename: 'ticket.pdf', mimeType: 'application/pdf', bytes: 'PDF-BYTES' }],
    },
    'msg-2': {
      from: 'Booking <noreply@booking.com>', subject: 'Booking confirmation — Athens Hotel',
      date: '2026-07-02T09:00:00.000Z', text: 'Your reservation is confirmed', html: '<p>confirmed</p>',
      attachments: [],
    },
  },
};
const nid = (p) => p + bridgeState.nextId++;
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');

function bridge(req) {
  if (req.token !== TOKEN) return { ok: false, error: 'bad token' };
  const S = bridgeState;
  try {
    switch (req.action) {
      case 'ping':
        return { ok: true, email: S.email, version: '1.1.0' };
      case 'createFolder': {
        const id = nid('folder-');
        S.folders[id] = { name: req.name || 'TripNest', description: 'tripnest-root', parent: null, shares: req.partnerEmail ? [req.partnerEmail] : [] };
        return { ok: true, folderId: id, folderName: S.folders[id].name };
      }
      case 'findShared': {
        const hit = Object.entries(S.folders).find(([, f]) =>
          f.description === 'tripnest-root' && (!req.name || f.name === req.name));
        if (!hit) return { ok: false, error: 'לא נמצאה תיקיית TripNest משותפת' };
        return { ok: true, folderId: hit[0], folderName: hit[1].name };
      }
      case 'dbGet': {
        const f = Object.values(S.files).find(f => f.parent === req.folderId && f.name === 'tripnest-db.json');
        return { ok: true, db: f ? JSON.parse(Buffer.from(f.data, 'base64').toString('utf-8')) : null };
      }
      case 'dbPut': {
        let f = Object.values(S.files).find(f => f.parent === req.folderId && f.name === 'tripnest-db.json');
        if (!f) { const id = nid('file-'); f = S.files[id] = { name: 'tripnest-db.json', mimeType: 'application/json', parent: req.folderId }; }
        f.data = b64(JSON.stringify(req.db));
        return { ok: true };
      }
      case 'upload': {
        const marker = 'tripnest-trip:' + req.tripId;
        let [tfId] = Object.entries(S.folders).find(([, f]) => f.parent === req.folderId && f.description === marker) || [];
        if (!tfId) { tfId = nid('folder-'); S.folders[tfId] = { name: req.tripName, description: marker, parent: req.folderId, shares: [] }; }
        const id = nid('file-');
        S.files[id] = { name: req.fileName, mimeType: req.mimeType, data: req.data, parent: tfId };
        return { ok: true, fileId: id };
      }
      case 'download': {
        const f = S.files[req.fileId];
        if (!f) return { ok: false, error: 'file not found' };
        return { ok: true, fileName: f.name, mimeType: f.mimeType, data: f.data };
      }
      case 'gmailSearch': {
        const messages = Object.entries(S.messages).map(([id, m]) => ({
          id, from: m.from, subject: m.subject, date: m.date, snippet: m.text.slice(0, 140),
        }));
        return { ok: true, messages };
      }
      case 'gmailGet': {
        const m = S.messages[req.id];
        if (!m) return { ok: false, error: 'message not found' };
        return {
          ok: true, text: m.text, html: m.html,
          attachments: m.attachments.map((a, i) => ({ attachmentId: i, filename: a.filename, mimeType: a.mimeType, size: a.bytes.length })),
        };
      }
      case 'gmailAttachment': {
        const a = S.messages[req.id]?.attachments[req.index];
        if (!a) return { ok: false, error: 'attachment not found' };
        return { ok: true, filename: a.filename, mimeType: a.mimeType, data: b64(a.bytes) };
      }
      default:
        return { ok: false, error: 'unknown action: ' + req.action };
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith(BRIDGE_URL)) throw new Error('unexpected fetch: ' + url);
  const body = bridge(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => body };
};

/* ---------- mock DOM / UI / DB ---------- */
globalThis.window = globalThis;
globalThis.document = { dispatchEvent() { } };
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
}
globalThis.UI = { toast() { } };
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buf => {
      this.result = `data:${blob.type};base64,` + Buffer.from(buf).toString('base64');
      this.onload && this.onload();
    }).catch(e => this.onerror && this.onerror(e));
  }
};

// in-memory DB with the exact surface google.js uses (same merge semantics as js/db.js)
const stores = { trips: new Map(), documents: new Map(), events: new Map(), checklists: new Map(), expenses: new Map(), members: new Map(), settings: new Map() };
const SYNC_STORES = ['trips', 'documents', 'events', 'checklists', 'expenses', 'members'];
const SHARED_SETTINGS = ['keywords', 'agentPersona'];
globalThis.DB = {
  uid: () => 'id-' + Math.random().toString(36).slice(2, 10),
  async put(store, rec) { if (!rec.id) rec.id = this.uid(); rec.updatedAt = Date.now(); stores[store].set(rec.id, rec); return rec; },
  async putRaw(store, rec) { stores[store].set(rec.id, rec); return rec; },
  async get(store, id) { return stores[store].get(id) || null; },
  async allRaw(store) { return [...stores[store].values()]; },
  settings: {
    async get(key) { return stores.settings.has(key) ? stores.settings.get(key) : null; },
    async set(key, value) { stores.settings.set(key, value); },
  },
  async touchShared() { stores.settings.set('sharedUpdatedAt', Date.now()); },
  async exportSync() {
    const strip = ({ blob, ...rest }) => rest;
    const out = { version: 1, exported: Date.now() };
    for (const st of SYNC_STORES) out[st] = (await this.allRaw(st)).map(r => st === 'documents' ? strip(r) : r);
    out.shared = { updatedAt: (await this.settings.get('sharedUpdatedAt')) || 0 };
    for (const k of SHARED_SETTINGS) out.shared[k] = await this.settings.get(k);
    return out;
  },
  async mergeSync(remote) {
    let needUpload = false, localChanged = false;
    if (!remote) return { needUpload: true, localChanged };
    for (const st of SYNC_STORES) {
      const remoteRecs = remote[st] || [];
      const localRecs = await this.allRaw(st);
      const localMap = new Map(localRecs.map(r => [r.id, r]));
      const remoteIds = new Set(remoteRecs.map(r => r.id));
      for (const rr of remoteRecs) {
        const lr = localMap.get(rr.id);
        if (!lr || (rr.updatedAt || 0) > (lr.updatedAt || 0)) {
          const merged = { ...rr };
          if (st === 'documents' && lr && lr.blob) merged.blob = lr.blob;
          await this.putRaw(st, merged);
          localChanged = true;
        } else if ((lr.updatedAt || 0) > (rr.updatedAt || 0)) needUpload = true;
      }
      if (localRecs.some(r => !remoteIds.has(r.id))) needUpload = true;
    }
    return { needUpload, localChanged };
  },
};

/* ---------- load the client under test ---------- */
(0, eval)(readFileSync(join(root, 'js/google.js'), 'utf-8'));
const G = globalThis.G;

/* ---------- tiny runner ---------- */
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e.stack || e)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('TripNest bridge-client smoke test\n');

await DB.settings.set('bridgeUrl', BRIDGE_URL);
await DB.settings.set('bridgeToken', TOKEN);

await test('ping מחזיר את המייל המחובר', async () => {
  const out = await G.ping();
  assert(out.email === 'liron@example.com', 'wrong email: ' + out.email);
  assert(out.version === '1.1.0', 'wrong version');
});

await test('טוקן שגוי נדחה', async () => {
  await DB.settings.set('bridgeToken', 'wrong-token');
  let err = null;
  try { await G.ping(); } catch (e) { err = e; }
  await DB.settings.set('bridgeToken', TOKEN);
  assert(err && /bad token/.test(err.message), 'expected bad-token error, got: ' + err);
});

await test('יצירת תיקייה משותפת + שיתוף (מכשיר ראשון)', async () => {
  const out = await G.setup.create({ name: 'TripNest — המזוודה', partnerEmail: 'partner@example.com' });
  assert(out.folderId, 'no folderId');
  assert(bridgeState.folders[out.folderId].shares.includes('partner@example.com'), 'not shared with partner');
  assert((await DB.settings.get('driveFolderId')) === out.folderId, 'folderId not saved');
});

await test('איתור תיקייה קיימת (מכשיר שני)', async () => {
  const out = await G.setup.connect({ name: 'TripNest — המזוודה' });
  assert(out.folderName === 'TripNest — המזוודה', 'wrong folder found');
});

await test('סריקת Gmail לפי מילות מפתח', async () => {
  const kw = await G.gmail.keywords();
  assert(kw.includes('טיסה') && kw.includes('boarding pass'), 'default keywords missing');
  const q = G.gmail.buildQuery(kw, { after: '2026-06-01' });
  assert(q.includes('"טיסה"') && q.includes('after:2026/06/01'), 'bad query: ' + q);
  const results = await G.gmail.search(q);
  assert(results.length === 2, 'expected 2 messages, got ' + results.length);
  assert(results[0].subject.includes('אתונה'), 'wrong subject');
});

await test('ייבוא מייל: גוף + קובץ מצורף', async () => {
  const full = await G.gmail.getFull('msg-1');
  const parts = G.gmail.walkParts(full.payload);
  assert(parts.text.includes('ABC123'), 'body text missing');
  assert(parts.attachments.length === 1 && parts.attachments[0].filename === 'ticket.pdf', 'attachment meta wrong');
  const blob = await G.gmail.getAttachment('msg-1', parts.attachments[0]);
  assert(blob instanceof Blob && blob.type === 'application/pdf', 'attachment blob wrong');
  assert((await blob.text()) === 'PDF-BYTES', 'attachment content wrong');
});

await test('סנכרון מלא: העלאת מסמך + db.json, ומשיכה חזרה', async () => {
  const trip = await DB.put('trips', { name: 'אתונה 2026' });
  await DB.put('documents', {
    tripId: trip.id, fileName: 'ticket.pdf', mimeType: 'application/pdf',
    blob: new Blob(['PDF-BYTES'], { type: 'application/pdf' }), category: 'flight', source: 'email',
  });

  const res = await G.Sync.run({ silent: true });
  assert(res.ok, 'sync failed: ' + res.error);

  const doc = (await DB.allRaw('documents'))[0];
  assert(doc.driveFileId, 'doc blob was not uploaded');
  const folderId = await DB.settings.get('driveFolderId');
  const tripFolder = Object.values(bridgeState.folders).find(f => f.description === 'tripnest-trip:' + trip.id);
  assert(tripFolder && tripFolder.parent === folderId, 'trip subfolder missing');
  const dbFile = Object.values(bridgeState.files).find(f => f.parent === folderId && f.name === 'tripnest-db.json');
  assert(dbFile, 'db.json was not uploaded');
  const remoteDb = JSON.parse(Buffer.from(dbFile.data, 'base64').toString('utf-8'));
  assert(remoteDb.trips.length === 1 && remoteDb.documents.length === 1, 'db.json content wrong');
  assert(!remoteDb.documents[0].blob, 'blob must not be embedded in db.json');

  // סימולציית "המכשיר השני": בלי blob מקומי → נמשך מהדרייב
  delete doc.blob;
  await DB.putRaw('documents', doc);
  const res2 = await G.Sync.run({ silent: true });
  assert(res2.ok, 'second sync failed: ' + res2.error);
  const pulled = (await DB.allRaw('documents'))[0];
  assert(pulled.blob && (await pulled.blob.text()) === 'PDF-BYTES', 'blob was not pulled back');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
