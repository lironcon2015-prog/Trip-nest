/* TripNest — smoke test for the Apps Script bridge client (js/google.js).
   Runs in plain Node (>=18): mocks the bridge over fetch, a minimal DB/UI/DOM,
   then drives ping, bad token, folder setup, Gmail scan, import and full sync.
   Usage: node tests/smoke.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- mock bridges (in-memory Apps Script, one per partner) ---------- */
const BRIDGE_URL = 'https://script.google.com/macros/s/MOCK/exec';
const TOKEN = 'test-secret-token';
const PARTNER_URL = 'https://script.google.com/macros/s/MOCK-PARTNER/exec';
const PARTNER_TOKEN = 'partner-secret-token';

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
    'msg-3': {
      from: 'Airbnb <auto@airbnb.com>', subject: 'הזמנת דירה — כרתים',
      date: '2026-07-04T12:00:00.000Z', text: 'הזמנה 555', html: '<p>555</p>',
      attachments: [], labels: ['@Navigo'], labelOnly: true,
    },
  },
};
const partnerState = {
  email: 'partner@example.com',
  folders: {}, files: {}, nextId: 1000,
  messages: {
    'pmsg-1': {
      from: 'ISSTA <deals@issta.co.il>', subject: 'שובר מלון — סנטוריני',
      date: '2026-07-03T08:00:00.000Z', text: 'שובר מספר XYZ789', html: '<p>שובר XYZ789</p>',
      attachments: [{ filename: 'voucher.pdf', mimeType: 'application/pdf', bytes: 'PARTNER-VOUCHER' }],
    },
  },
};
let partnerDown = false; // סימולציה של גשר שני שלא זמין

const nid = (p) => p + bridgeState.nextId++;
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');

function bridge(req, S = bridgeState, token = TOKEN) {
  if (req.token !== token) return { ok: false, error: 'bad token' };
  try {
    switch (req.action) {
      case 'ping':
        return { ok: true, email: S.email, version: '1.1.0' };
      case 'createFolder': {
        const id = nid('folder-');
        S.folders[id] = { name: req.name || 'TripNest', description: 'tripnest-root', parent: null, shares: req.partnerEmail ? [req.partnerEmail] : [] };
        return { ok: true, folderId: id, folderName: S.folders[id].name };
      }
      case 'shareFolder': {
        const f = S.folders[req.folderId];
        if (!f || !req.email) return { ok: false, error: 'folder not found' };
        f.shares.push(req.email);
        // simulate Drive sharing: the folder becomes visible to the other account
        (S === bridgeState ? partnerState : bridgeState).folders[req.folderId] = f;
        return { ok: true, shared: true };
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
      case 'fileGet': {
        const f = Object.values(S.files).find(f => f.parent === req.folderId && f.name === req.name);
        return { ok: true, content: f ? JSON.parse(Buffer.from(f.data, 'base64').toString('utf-8')) : null };
      }
      case 'filePut': {
        if (!req.name) return { ok: false, error: 'filePut: missing name' };
        if (req.name === 'tripnest-db.json') return { ok: false, error: 'filePut: use dbPut' };
        let f = Object.values(S.files).find(f => f.parent === req.folderId && f.name === req.name);
        if (!f) { const id = nid('file-'); f = S.files[id] = { name: req.name, mimeType: 'application/json', parent: req.folderId }; }
        f.data = b64(JSON.stringify(req.content));
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
        const wanted = req.label ? String(req.label).toLowerCase() : null;
        const messages = Object.entries(S.messages)
          .filter(([, m]) => wanted
            ? (m.labels || []).some(l => l.toLowerCase().includes(wanted))
            : !m.labelOnly)
          .filter(([, m]) => (!req.after || m.date >= req.after) && (!req.before || m.date.slice(0, 10) <= req.before))
          .map(([id, m]) => ({
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

/* mock Gemini API: per-model scripted responses + call log */
const gemini = { behavior: {}, calls: [] };
function geminiRespond(url, opts) {
  const model = String(url).match(/models\/([^:]+):generateContent/)[1];
  gemini.calls.push({ model, url: String(url), headers: opts.headers || {} });
  const b = gemini.behavior[model] || { status: 200 };
  if (b.status === 200) {
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: b.reply || 'ok:' + model }] } }] }) };
  }
  return {
    ok: false, status: b.status,
    json: async () => { if (b.nonJson) throw new Error('not json'); return { error: { message: b.message || 'err', status: b.apiStatus || '' } }; },
  };
}

globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('generativelanguage.googleapis.com')) return geminiRespond(url, opts);
  const req = JSON.parse(opts.body);
  let body;
  if (String(url).startsWith(PARTNER_URL)) {
    if (partnerDown) throw new TypeError('fetch failed');
    body = bridge(req, partnerState, PARTNER_TOKEN);
  } else if (String(url).startsWith(BRIDGE_URL)) {
    body = bridge(req);
  } else throw new Error('unexpected fetch: ' + url);
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

/* ---------- load the clients under test ---------- */
(0, eval)(readFileSync(join(root, 'js/google.js'), 'utf-8'));
(0, eval)(readFileSync(join(root, 'js/gemini.js'), 'utf-8'));
(0, eval)(readFileSync(join(root, 'js/mrz.js'), 'utf-8'));
const G = globalThis.G;
const Gemini = globalThis.Gemini;
const MRZ = globalThis.MRZ;

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

await test('accountEmail: מה-ping, וכשהוא ריק — היסק מ-in:sent', async () => {
  assert(await G.accountEmail() === 'liron@example.com', 'should come from ping');
  bridgeState.email = ''; // old bridge deployment: getActiveUser returns empty
  const inferred = await G.accountEmail();
  bridgeState.email = 'liron@example.com';
  assert(inferred === 'no-reply@elal.co.il', 'should infer from sent-mail From, got: ' + inferred);
});

await test('טוקן שגוי נדחה', async () => {
  await DB.settings.set('bridgeToken', 'wrong-token');
  let err = null;
  try { await G.ping(); } catch (e) { err = e; }
  await DB.settings.set('bridgeToken', TOKEN);
  assert(err && /bad token/.test(err.message), 'expected bad-token error, got: ' + err);
});

await test('יצירת תיקייה משותפת + שיתוף (מכשיר ראשון)', async () => {
  const out = await G.setup.create({ name: 'TripNest — Navigo', partnerEmail: 'partner@example.com' });
  assert(out.folderId, 'no folderId');
  assert(bridgeState.folders[out.folderId].shares.includes('partner@example.com'), 'not shared with partner');
  assert((await DB.settings.get('driveFolderId')) === out.folderId, 'folderId not saved');
});

await test('איתור תיקייה קיימת (מכשיר שני)', async () => {
  const out = await G.setup.connect({ name: 'TripNest — Navigo' });
  assert(out.folderName === 'TripNest — Navigo', 'wrong folder found');
});

await test('סריקת Gmail לפי מילות מפתח', async () => {
  const kw = await G.gmail.keywords();
  assert(kw.includes('טיסה') && kw.includes('boarding pass'), 'default keywords missing');
  const q = G.gmail.buildQuery(kw, { after: '2026-06-01' });
  assert(q.includes('"טיסה"') && q.includes('after:2026/06/01'), 'bad query: ' + q);
  const results = await G.gmail.search(q);
  assert(results.length === 2, 'expected 2 messages, got ' + results.length);
  assert(results.some(r => r.subject.includes('אתונה')), 'wrong subject');
  assert(results.every(r => r.mailbox === 'me'), 'partner not configured yet — all results must be mine');
});

await test('שאילתת חיפוש: חד-פעמי + רק עם קבצים מצורפים', async () => {
  const q = G.gmail.buildQuery(['ryanair'], { after: '2026-06-01', attachmentsOnly: true });
  assert(q.includes('"ryanair"'), 'ad-hoc keyword missing: ' + q);
  assert(!q.includes('label:'), 'ad-hoc search must cover the whole mailbox: ' + q);
  assert(q.includes('has:attachment'), 'attachment filter missing: ' + q);
  const q2 = G.gmail.buildQuery(['טיסה'], { after: '2026-06-01' });
  assert(!q2.includes('has:attachment'), 'attachment filter must be opt-in');
});

await test('שאילתת חיפוש: ברירת המחדל היא תווית Navigo', async () => {
  const q = G.gmail.buildQuery(null, { after: '2026-06-01', attachmentsOnly: true });
  assert(q.includes('label:navigo'), 'label scan missing: ' + q);
  assert(!q.includes('OR'), 'label scan must not carry keywords: ' + q);
  assert(q.includes('after:2026/06/01') && q.includes('has:attachment'), 'filters missing: ' + q);
});

await test('סריקה לפי תווית: תופסת גם @Navigo, וכולל סינון תאריכים', async () => {
  const results = await G.gmail.search('label:navigo', 25, { label: 'navigo' });
  assert(results.some(r => r.subject.includes('כרתים')), '@Navigo-labeled mail missing');
  assert(results.every(r => (r.subject || '').includes('כרתים')), 'label scan must return only labeled mails');
  const none = await G.gmail.search('label:navigo', 25, { label: 'navigo', before: '2026-07-03' });
  assert(!none.some(r => r.subject.includes('כרתים')), 'before-date filter ignored in label scan');
});

await test('אותו מייל בשתי התיבות — מיובא פעם אחת', async () => {
  partnerState.messages['pmsg-dup'] = {
    from: 'ELAL <no-reply@elal.co.il>', subject: 'אישור הזמנה — טיסה לאתונה',
    date: '2026-07-01T10:00:00.000Z', text: 'קוד הזמנה ABC123', html: '<p>ABC123</p>', attachments: [],
  };
  const results = await G.gmail.search('anything');
  delete partnerState.messages['pmsg-dup'];
  const copies = results.filter(r => r.subject.includes('אתונה'));
  assert(copies.length === 1, 'duplicate mail must collapse to one, got ' + copies.length);
  assert(copies[0].mailbox === 'me', 'my mailbox copy must win over the partner copy');
});

await test('שאילתת חיפוש: מילות סינון-החוצה', async () => {
  const q = G.gmail.buildQuery(['טיסה'], { after: '2026-06-01', exclude: ['זארה', 'בית קולנוע'] });
  assert(q.includes('-"זארה"') && q.includes('-"בית קולנוע"'), 'exclusions missing: ' + q);
  assert((await G.gmail.negKeywords()).length === 0, 'negKeywords must default to empty');
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

await test('סריקה כפולה: שתי התיבות ממוזגות וממוינות לפי תאריך', async () => {
  await DB.settings.set('partnerBridgeUrl', PARTNER_URL);
  await DB.settings.set('partnerBridgeToken', PARTNER_TOKEN);
  assert(await G.hasPartnerBridge(), 'partner bridge should be configured');
  const out = await G.ping({ account: 'partner' });
  assert(out.email === 'partner@example.com', 'partner ping wrong: ' + out.email);

  const results = await G.gmail.search('anything');
  assert(results.length === 3, 'expected 3 messages from both mailboxes, got ' + results.length);
  assert(results[0].subject.includes('סנטוריני') && results[0].mailbox === 'partner', 'newest (partner) message must be first');
  assert(results[0].id.startsWith('p:'), 'partner message id must carry p: prefix');
  assert(results.filter(r => r.mailbox === 'me').length === 2, 'own messages missing');
});

await test('ensurePartnerAccess: מענק גישה דרך הגשר שלי ואימות דרך הגשר השני', async () => {
  const folderId = await DB.settings.get('driveFolderId');
  const first = await G.setup.ensurePartnerAccess({ folderId, partnerEmail: 'partner@example.com' });
  assert(first === 'granted', 'expected granted, got: ' + first);
  const second = await G.setup.ensurePartnerAccess({ folderId, partnerEmail: 'partner@example.com' });
  assert(second === 'ok', 'expected ok once shared, got: ' + second);
  const manual = await G.setup.ensurePartnerAccess({ folderId: 'folder-unknown', partnerEmail: null });
  assert(manual === 'manual', 'expected manual without email, got: ' + manual);
});

await test('ייבוא מהתיבה של בן/בת הזוג מנותב לגשר הנכון', async () => {
  const full = await G.gmail.getFull('p:pmsg-1');
  const parts = G.gmail.walkParts(full.payload);
  assert(parts.text.includes('XYZ789'), 'partner body missing');
  assert(parts.attachments[0].filename === 'voucher.pdf', 'partner attachment meta wrong');
  const blob = await G.gmail.getAttachment('p:pmsg-1', parts.attachments[0]);
  assert((await blob.text()) === 'PARTNER-VOUCHER', 'partner attachment content wrong');
});

await test('גשר של בן/בת הזוג לא זמין — הסריקה עדיין מחזירה את התיבה שלי', async () => {
  partnerDown = true;
  const results = await G.gmail.search('anything');
  partnerDown = false;
  assert(results.length === 2 && results.every(r => r.mailbox === 'me'), 'own results must survive partner outage');
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

await test('דרכון לעולם לא עולה לדרייב בסנכרון', async () => {
  const doc = await DB.put('documents', {
    tripId: 'misc', fileName: 'passport-liron.jpg', mimeType: 'image/jpeg',
    blob: new Blob(['PASSPORT'], { type: 'image/jpeg' }), category: 'passport', source: 'camera',
  });
  const res = await G.Sync.run({ silent: true });
  assert(res.ok, 'sync failed: ' + res.error);
  const after = await DB.get('documents', doc.id);
  assert(!after.driveFileId, 'passport blob must not be uploaded');
  assert(!Object.values(bridgeState.files).some(f => f.name === 'passport-liron.jpg'), 'passport file found in Drive');
});

await test('קבצי JSON בשם: put→get, קובץ חסר → null, דריסה בלי כפילויות', async () => {
  assert((await G.files.get('chat-archive-general.json')) === null, 'missing file must return null');
  await G.files.put('chat-archive-general.json', { version: 1, records: [{ id: 'a1', text: 'שלום' }] });
  await G.files.put('chat-archive-general.json', { version: 1, records: [{ id: 'a1', text: 'שלום' }, { id: 'a2', text: 'עוד' }] });
  const out = await G.files.get('chat-archive-general.json');
  assert(out && out.records.length === 2 && out.records[1].id === 'a2', 'content wrong after overwrite');
  const copies = Object.values(bridgeState.files).filter(f => f.name === 'chat-archive-general.json');
  assert(copies.length === 1, 'filePut must overwrite in place, not duplicate');
});

await test('filePut על tripnest-db.json נחסם', async () => {
  let err = null;
  try { await G.files.put('tripnest-db.json', {}); } catch (e) { err = e; }
  assert(err && /dbPut/.test(err.message), 'expected rejection, got: ' + err);
});

/* ---------- Gemini cascade ---------- */
await DB.settings.set('geminiKey', 'test-gemini-key');

await test('Gemini: מפתח בכותרת, לא ב-URL', async () => {
  gemini.behavior = {}; gemini.calls = [];
  await Gemini.call({ contents: [] });
  const c = gemini.calls[0];
  assert(c.headers['x-goog-api-key'] === 'test-gemini-key', 'key header missing');
  assert(!c.url.includes('test-gemini-key'), 'key must not appear in URL');
});

const [M1, M2, M3] = Gemini.DEFAULT_MODELS;

await test('Gemini: עומס במודל הראשון → fallback לשני', async () => {
  gemini.behavior = { [M1]: { status: 429 } }; gemini.calls = [];
  const data = await Gemini.call({ contents: [] });
  assert(Gemini.textOf(data) === 'ok:' + M2, 'expected second model reply');
  assert(gemini.calls.length === 2, 'expected exactly 2 calls');
});

await test('Gemini: מודל שהוצא משירות (404) → דילוג למודל הבא', async () => {
  gemini.behavior = { [M1]: { status: 404, message: 'model not found', apiStatus: 'NOT_FOUND' } }; gemini.calls = [];
  const data = await Gemini.call({ contents: [] });
  assert(Gemini.textOf(data) === 'ok:' + M2, 'expected fallback past retired model');
  assert(gemini.calls.length === 2, 'expected exactly 2 calls');
});

await test('Gemini: שגיאת תצורה (400) → זריקה מיידית בלי fallback', async () => {
  gemini.behavior = { [M1]: { status: 400, message: 'API key not valid' } }; gemini.calls = [];
  let err = null;
  try { await Gemini.call({ contents: [] }); } catch (e) { err = e; }
  assert(err && err.message === 'API key not valid', 'expected immediate throw');
  assert(gemini.calls.length === 1, 'second model must not be tried on config error');
});

await test('Gemini: כל המודלים עמוסים (כולל גוף לא-JSON) → הודעת עומס', async () => {
  gemini.behavior = {
    [M1]: { status: 503, nonJson: true },
    [M2]: { status: 429 },
    [M3]: { status: 429 },
  };
  let err = null;
  try { await Gemini.call({ contents: [] }); } catch (e) { err = e; }
  assert(err && err.message.includes('עמוסים'), 'expected all-busy error, got: ' + err);
});

await test('Gemini: דריסת רשימת מודלים + testModels', async () => {
  await Gemini.setModels(['custom-model']);
  gemini.behavior = {}; gemini.calls = [];
  await Gemini.call({ contents: [] });
  assert(gemini.calls[0].model === 'custom-model', 'override not used');
  gemini.behavior = { 'custom-model': { status: 404, message: 'not found' } };
  const results = await Gemini.testModels('בדיקה');
  assert(results.length === 1 && !results[0].ok && results[0].error === 'not found', 'testModels result wrong');
  await Gemini.setModels(Gemini.DEFAULT_MODELS.slice());
});

/* ---------- MRZ (ICAO 9303 TD3 specimen) ---------- */
await test('MRZ: פענוח דוגמת התקן הרשמית', async () => {
  const p = MRZ.parse([
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
  ]);
  assert(p, 'specimen must parse');
  assert(p.nameEn === 'ANNA MARIA ERIKSSON', 'name wrong: ' + p.nameEn);
  assert(p.passportNumber === 'L898902C3', 'number wrong');
  assert(p.birthDate === '1974-08-12', 'birth wrong: ' + p.birthDate);
  assert(p.expiryDate === '2012-04-15', 'expiry wrong: ' + p.expiryDate);
  assert(p.sex === 'F' && p.nationality === 'UTO', 'sex/nationality wrong');
});

await test('MRZ: ספרת ביקורת שגויה → דחייה (בלי לנחש)', async () => {
  const bad = MRZ.parse([
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C37UTO7408122F1204159ZE184226B<<<<<10',
  ]);
  assert(bad === null, 'corrupted MRZ must be rejected');
});

await test('MRZ: איתור בתוך טקסט OCR מרובה שורות + תיקון O/0', async () => {
  const p = MRZ.fromText('PASSPORT\nsome noise\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO74O8122F12O4159ZE184226B<<<<<10\n');
  assert(p && p.birthDate === '1974-08-12' && p.expiryDate === '2012-04-15', 'fromText with O→0 fix failed');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
