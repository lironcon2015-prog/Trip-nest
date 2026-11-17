// TripNest (Navigo) — the Cloudflare server.
//
// One Durable Object, "the family", holds the shared trips and does every
// location-sensitive job from one fixed place (pinned to Western Europe):
// Gemini, and the two Google bridges (both Gmail mailboxes, the Drive folder).
// The phones talk only to this domain, so where a phone happens to connect
// from — roaming, a travel eSIM, a hotel network — no longer decides what works.
//
// Routes:
//   GET  /       health check: {"ok":true,"result":{"service":"navigo",...}}
//   POST /       the API. The body is one JSON line (the request), optionally
//                followed by "\n" and a raw payload (a file's base64, a Gemini
//                request) that is passed on without being parsed — cheap on CPU.
//   GET  /live   WebSocket. Say {"type":"hello","deviceKey":…}; get
//                {"type":"rev","rev":n} whenever the shared data moves.
//   cron         a nightly backup into the shared Drive folder, through a bridge.
//
// Settings (Cloudflare → the Worker → Settings → Variables and Secrets):
//   FAMILY_CODE — secret, 12+ characters. A new phone types it once.
// Everything else — both bridges (URL + token), the Gemini keys, the Drive
// folder — the phones hand over at pairing. It lives in the object's storage,
// never leaves in a reply and never reaches a backup.
import { DurableObject } from 'cloudflare:workers';
import Merge from './merge.js';

const VERSION = '1.0.0';
const STORES = new Set(['trips', 'documents', 'events', 'checklists', 'expenses', 'members', 'shared']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const MAX_BODY = 30 * 1024 * 1024;      // a ~22 MB file as base64
const MAX_RECORD = 1536 * 1024;         // one record's JSON, under the 2 MB row limit
const PULL_LIMIT = 500;
const PUSH_LIMIT = 500;
const FUTURE_MS = 24 * 3600 * 1000;     // a stamp further ahead is a broken clock
const PAIR_TTL = 10 * 60 * 1000;
const FAILS_MAX = 8;
const FAILS_WINDOW = 15 * 60 * 1000;
const FETCH_MS = 60000;
const AI_MS = 35000; // a model silent longer than this counts as unavailable — the cascade moves on
const FILE_MS = 120000;
const MAX_SOCKETS = 40;
// a waiting answer sends a space this often: a cellular network cuts a request
// that stays silent too long (seen: 25 s), and JSON allows leading whitespace
const KEEPALIVE_MS = 5000;
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
const BRIDGE_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const CODE_ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I — read aloud, typed by hand
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS secret (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS device (hash TEXT PRIMARY KEY, name TEXT, mailbox TEXT, created INTEGER, seen INTEGER, version TEXT, revoked INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS rec (store TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, trip TEXT, data TEXT NOT NULL, PRIMARY KEY (store, id))',
  'CREATE INDEX IF NOT EXISTS rec_rev ON rec (rev)',
  'CREATE TABLE IF NOT EXISTS archive (id TEXT PRIMARY KEY, trip TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS archive_trip ON archive (trip, ts)',
  'CREATE TABLE IF NOT EXISTS upload (doc TEXT PRIMARY KEY, file TEXT NOT NULL, at INTEGER)',
  'CREATE TABLE IF NOT EXISTS pair (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, by TEXT)',
];

const headers = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };
const raw = (text, status = 200) => new Response(text, { status, headers });
const ok = (result) => raw(JSON.stringify({ ok: true, result }));
const fail = (error, code, status = 200) => raw(JSON.stringify({ ok: false, error, code }), status);

// a refusal the phone should show as is (Hebrew), with a code it can act on
class Refusal extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a, b) { // no early exit on the first difference
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// The answer of a slow job, streamed: a space every KEEPALIVE_MS until the JSON is
// ready. Always HTTP 200 — a failure goes inside the JSON, as everywhere else.
function keepAlive(job) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const tick = setInterval(() => { writer.write(enc.encode(' ')).catch(() => { }); }, KEEPALIVE_MS);
  (async () => {
    let text;
    try { text = await job(); } catch (e) {
      text = JSON.stringify(e instanceof Refusal ? { ok: false, error: e.message, code: e.code } : { ok: false, error: 'שגיאה בשרת', code: 'server' });
      if (!(e instanceof Refusal)) console.error('navigo keepAlive', (e && e.stack) || e);
    } finally { clearInterval(tick); }
    try { await writer.write(enc.encode(text)); await writer.close(); } catch { /* the phone left */ }
  })();
  return new Response(readable, { headers });
}

const family = (env) => env.FAMILY.get(env.FAMILY.idFromName('family'), { locationHint: 'weur' });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    if (path !== '/' && path !== '/live') return fail('לא נמצא', 'not_found', 404);
    return family(env).fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(family(env).fetch('https://family/backup', { method: 'POST' }));
  },
};

export class Family extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.devices = new Map(); // hash → device row
    // the phone's keep-alive is answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      for (const q of SCHEMA) this.sql.exec(q);
      if (!this.kv('id')) this.setKv('id', crypto.randomUUID());
    });
  }

  /* ---------- small storage helpers ---------- */
  kv(k) { const r = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0]; return r ? r.v : null; }
  setKv(k, v) { this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)); }
  rev() { return Number(this.kv('rev') || 0); }
  setSecret(k, v) { this.sql.exec('INSERT INTO secret (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); }
  secrets(prefix) {
    return this.sql.exec('SELECT k, v FROM secret ORDER BY k').toArray().filter((r) => r.k.startsWith(prefix)).map((r) => r.v);
  }
  bridges() { return this.secrets('bridge:').map((v) => JSON.parse(v)); }
  // the phone's own mailbox first: its bridge most likely owns the files it uploads
  bridgesFor(dev) {
    const all = this.bridges();
    return [...all.filter((b) => b.email === dev.mailbox), ...all.filter((b) => b.email !== dev.mailbox)];
  }
  caps() {
    const bridges = this.bridges();
    const folder = this.kv('folder');
    return {
      gemini: this.secrets('gemini:').length,
      mailboxes: bridges.map((b) => b.email),
      drive: !!folder && bridges.length > 0,
      folderName: this.kv('folderName') || null,
      backupAt: Number(this.kv('backup_at') || 0) || null,
    };
  }

  /* ---------- HTTP ---------- */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/live') return this.live(request);
    if (url.pathname === '/backup') return this.backup();
    if (url.hostname === 'egress' && url.pathname === '/gemini') return this.egress(request);
    if (request.method === 'GET') return ok({ service: 'navigo', server: 'cloudflare', version: VERSION });
    if (request.method !== 'POST') return fail('שיטה לא נתמכת', 'method', 405);
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return fail('הקובץ גדול מדי לשרת', 'too_big', 413);
    const text = await request.text();
    if (text.length > MAX_BODY) return fail('הקובץ גדול מדי לשרת', 'too_big', 413);
    const nl = text.indexOf('\n'); // JSON.stringify never writes a raw newline
    let req = null;
    try { req = JSON.parse(nl < 0 ? text : text.slice(0, nl)); } catch { /* below */ }
    if (!req || typeof req !== 'object' || Array.isArray(req)) return fail('בקשה לא תקינה', 'bad_request');
    const payload = nl < 0 ? '' : text.slice(nl + 1);
    try {
      return await this.handle(req, payload);
    } catch (e) {
      if (e instanceof Refusal) return fail(e.message, e.code);
      console.error('navigo', req.action, (e && e.stack) || e);
      return fail('שגיאה בשרת', 'server');
    }
  }

  async handle(req, payload) {
    const action = String(req.action || '');
    if (action === 'pair') return this.pair(req);
    const dev = await this.device(req.deviceKey);
    switch (action) {
      case 'hello': return ok(this.hello(dev, req));
      case 'pull': return this.pull(req);
      case 'push': return ok(this.push(dev, req));
      case 'pairCode': return ok(await this.pairCode(dev));
      case 'devices': return ok(this.listDevices(dev));
      case 'revoke': return ok(this.revoke(req));
      case 'ai': return this.ai(req, payload);
      case 'gmailSearch': return ok(await this.gmailSearch(req));
      case 'gmailGet': return this.gmailGet(req);
      case 'gmailAttachment': return this.gmailAttachment(req);
      case 'upload': return ok(await this.upload(dev, req, payload));
      case 'download': return this.download(dev, req);
      case 'archivePut': return ok(this.archivePut(req));
      case 'archiveGet': return this.archiveGet(req);
      default: throw new Refusal('פעולה לא מוכרת', 'unknown_action');
    }
  }

  /* ---------- devices ---------- */
  async device(key) {
    key = String(key || '');
    if (key.length < 32) throw new Refusal('המכשיר לא מחובר לשרת — חברו אותו בהגדרות', 'unpaired');
    const hash = await sha256(key);
    let d = this.devices.get(hash);
    if (!d) {
      d = this.sql.exec('SELECT hash, name, mailbox, revoked FROM device WHERE hash = ?', hash).toArray()[0];
      if (d) this.devices.set(hash, d);
    }
    if (!d || d.revoked) throw new Refusal('המכשיר לא מחובר לשרת — חברו אותו בהגדרות', 'unpaired');
    return d;
  }

  // too many wrong codes → a pause, for everyone (two people use this)
  throttle() {
    const f = JSON.parse(this.kv('fails') || '{"n":0,"t":0}');
    if (Date.now() - f.t > FAILS_WINDOW) return;
    if (f.n >= FAILS_MAX) throw new Refusal('יותר מדי ניסיונות שגויים — נסו שוב בעוד רבע שעה', 'locked');
  }
  failed() {
    let f = JSON.parse(this.kv('fails') || '{"n":0,"t":0}');
    if (Date.now() - f.t > FAILS_WINDOW) f = { n: 0, t: Date.now() };
    f.n++;
    this.setKv('fails', JSON.stringify(f));
  }

  async pair(req) {
    const key = String(req.deviceKey || '');
    if (key.length < 32) throw new Refusal('מפתח מכשיר לא תקין', 'bad_request');
    const hash = await sha256(key);
    const known = this.sql.exec('SELECT revoked FROM device WHERE hash = ?', hash).toArray()[0];
    // a phone already paired asks again (an answer lost on the way): no code needed
    if (!known || known.revoked) {
      this.throttle();
      const familyCode = String(this.env.FAMILY_CODE || '').trim();
      const famOk = familyCode.length >= 12 && req.familyCode != null && sameText(String(req.familyCode).trim(), familyCode);
      let codeOk = false;
      if (!famOk && req.code) {
        const ch = await sha256(normCode(req.code));
        const row = this.sql.exec('SELECT expires FROM pair WHERE hash = ?', ch).toArray()[0];
        if (row && row.expires > Date.now()) { codeOk = true; this.sql.exec('DELETE FROM pair WHERE hash = ?', ch); }
      }
      if (!famOk && !codeOk) {
        if (familyCode.length < 12 && !req.code) throw new Refusal('בשרת עוד לא הוגדר FAMILY_CODE (12 תווים לפחות) — ראו README', 'not_configured');
        this.failed();
        throw new Refusal('הקוד שגוי או שפג תוקפו', 'bad_code');
      }
      const now = Date.now();
      this.sql.exec(`INSERT INTO device (hash, name, mailbox, created, seen, version, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(hash) DO UPDATE SET revoked = 0, name = excluded.name, mailbox = excluded.mailbox, seen = excluded.seen, version = excluded.version`,
      hash, clip(req.name, 60) || 'מכשיר', clip(req.mailbox, 120).toLowerCase(), now, now, clip(req.appVersion, 20));
      this.devices.delete(hash);
    }
    const adopted = await this.adopt(req);
    const dev = await this.device(key);
    return ok({ ...this.hello(dev, req), adopted });
  }

  // what a phone hands over at pairing: its bridges, its Gemini key, the Drive folder.
  // A bridge is kept only if it answers — the phone erases only what the server holds.
  async adopt(req) {
    const report = [];
    const list = Array.isArray(req.bridges) ? req.bridges.slice(0, 4) : [];
    for (const b of list) {
      const url = String((b && b.url) || '').trim();
      const token = String((b && b.token) || '');
      if (!BRIDGE_RE.test(url) || !token) { report.push({ email: null, ok: false, error: 'כתובת או טוקן לא תקינים' }); continue; }
      let email = String((b && b.email) || '').trim().toLowerCase();
      try {
        const p = await this.bridgeCall({ url, token, email: email || 'הגשר' }, { action: 'ping' }, FETCH_MS);
        if (p.email) email = String(p.email).trim().toLowerCase();
      } catch (e) { report.push({ email, ok: false, error: e.message }); continue; }
      if (!email.includes('@')) { report.push({ email, ok: false, error: 'הגשר לא מסר את כתובת החשבון' }); continue; }
      this.setSecret('bridge:' + email, JSON.stringify({ url, token, email }));
      report.push({ email, ok: true });
    }
    const gk = String(req.geminiKey || '').trim();
    if (gk) this.setSecret('gemini:' + (await sha256(gk)).slice(0, 16), gk);
    const folder = String(req.folderId || '').trim();
    if (folder && /^[\w-]{10,}$/.test(folder) && !this.kv('folder')) {
      this.setKv('folder', folder);
      if (req.folderName) this.setKv('folderName', clip(req.folderName, 120));
    }
    return report;
  }

  hello(dev, req) {
    this.sql.exec('UPDATE device SET seen = ?, version = ? WHERE hash = ?', Date.now(), clip(req.appVersion, 20), dev.hash);
    return {
      serverId: this.kv('id'),
      rev: this.rev(),
      now: Date.now(),
      caps: this.caps(),
      routes: this.bridges().map((b) => b.url), // the way around through Google
      mailbox: dev.mailbox || null,
    };
  }

  async pairCode(dev) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => CODE_ABC[b % 32]).join('');
    this.sql.exec('DELETE FROM pair WHERE expires < ?', Date.now());
    this.sql.exec('INSERT INTO pair (hash, expires, by) VALUES (?, ?, ?)', await sha256(code), Date.now() + PAIR_TTL, dev.hash);
    return { code: code.slice(0, 4) + '-' + code.slice(4), expires: Date.now() + PAIR_TTL };
  }

  listDevices(dev) {
    return this.sql.exec('SELECT hash, name, mailbox, seen, version FROM device WHERE revoked = 0 ORDER BY created').toArray()
      .map((d) => ({ id: d.hash.slice(0, 16), name: d.name, mailbox: d.mailbox, seen: d.seen, version: d.version, me: d.hash === dev.hash }));
  }

  revoke(req) {
    const id = String(req.id || '');
    if (!/^[0-9a-f]{16}$/.test(id)) throw new Refusal('מזהה מכשיר לא תקין', 'bad_request');
    const rows = this.sql.exec('SELECT hash FROM device WHERE revoked = 0').toArray().filter((d) => d.hash.startsWith(id));
    if (rows.length !== 1) throw new Refusal('המכשיר לא נמצא', 'not_found');
    const hash = rows[0].hash;
    this.sql.exec('UPDATE device SET revoked = 1 WHERE hash = ?', hash);
    this.devices.delete(hash);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() || {}).hash !== hash) continue;
      try { ws.send(JSON.stringify({ type: 'bye', code: 'unpaired' })); ws.close(4001, 'revoked'); } catch { /* gone */ }
    }
    return { revoked: 1 };
  }

  /* ---------- sync ---------- */
  pull(req) {
    const since = Math.max(0, Number(req.since) || 0);
    const limit = Math.min(PULL_LIMIT, Math.max(1, Number(req.limit) || PULL_LIMIT));
    const rows = this.sql.exec('SELECT store, rev, data FROM rec WHERE rev > ? ORDER BY rev LIMIT ?', since, limit + 1).toArray();
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const rev = page.length ? page[page.length - 1].rev : this.rev();
    // the stored JSON goes out as is — no parse/stringify round trip
    return raw('{"ok":true,"result":{"serverId":' + JSON.stringify(this.kv('id')) + ',"rev":' + rev + ',"more":' + more
      + ',"changes":[' + page.map((r) => '{"store":' + JSON.stringify(r.store) + ',"rec":' + r.data + '}').join(',') + ']}}');
  }

  push(dev, req) {
    const changes = Array.isArray(req.changes) ? req.changes : [];
    if (changes.length > PUSH_LIMIT) throw new Refusal('יותר מדי שינויים בבקשה אחת', 'too_many');
    const now = Date.now();
    const rejected = [];
    let rev = this.rev();
    let applied = 0;
    this.ctx.storage.transactionSync(() => {
      for (const c of changes) {
        const store = String((c && c.store) || '');
        const rec = c && c.rec;
        const id = rec && rec.id;
        if (!STORES.has(store) || !rec || typeof rec !== 'object' || typeof id !== 'string' || !id || id.length > 200) {
          rejected.push({ store, id: typeof id === 'string' ? id : null, code: 'bad_record' });
          continue;
        }
        const r = { ...rec };
        delete r.blob; delete r.blobData; // files never live in records
        if ((Number(r.updatedAt) || 0) > now + FUTURE_MS) { rejected.push({ store, id, code: 'clock' }); continue; }
        const row = this.sql.exec('SELECT data FROM rec WHERE store = ? AND id = ?', store, id).toArray()[0];
        const cur = row ? JSON.parse(row.data) : null;
        const merged = Merge.record(store, cur, r);
        if (cur && Merge.same(store, merged, cur)) continue; // nothing new (an echo, a retry)
        const data = JSON.stringify(merged);
        if (data.length > MAX_RECORD) { rejected.push({ store, id, code: 'too_big' }); continue; }
        rev++;
        this.sql.exec(`INSERT INTO rec (store, id, rev, updated_at, deleted, trip, data) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(store, id) DO UPDATE SET rev = excluded.rev, updated_at = excluded.updated_at, deleted = excluded.deleted, trip = excluded.trip, data = excluded.data`,
        store, id, rev, Number(merged.updatedAt) || 0, merged.deleted ? 1 : 0, merged.tripId || null, data);
        applied++;
      }
      if (applied) this.setKv('rev', rev);
    });
    if (applied) this.broadcast(dev.hash, rev);
    return { rev, applied, rejected };
  }

  broadcast(exceptHash, rev) {
    const msg = JSON.stringify({ type: 'rev', rev });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (!a.hash || a.hash === exceptHash) continue;
      try { ws.send(msg); } catch { /* closing */ }
    }
  }

  /* ---------- live ---------- */
  live(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return fail('נדרש WebSocket', 'no_upgrade', 426);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return fail('יותר מדי חיבורים חיים', 'too_many', 503);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ opened: Date.now() });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    let m = null;
    try { m = JSON.parse(typeof msg === 'string' ? msg : new TextDecoder().decode(msg)); } catch { /* below */ }
    if (!m || m.type !== 'hello') { ws.close(1003, 'hello first'); return; }
    try {
      const dev = await this.device(m.deviceKey);
      ws.serializeAttachment({ hash: dev.hash, opened: Date.now() });
      ws.send(JSON.stringify({ type: 'rev', rev: this.rev() }));
    } catch (e) {
      try { ws.send(JSON.stringify({ type: 'bye', code: e.code || 'error' })); ws.close(4001, 'unpaired'); } catch { /* gone */ }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }

  /* ---------- Gemini, from here ---------- */
  async ai(req, payload) {
    const model = String(req.model || '');
    if (!/^[\w.-]{1,80}$/.test(model)) throw new Refusal('שם מודל לא תקין', 'bad_request');
    if (!payload) throw new Refusal('בקשה ריקה ל-AI', 'bad_request');
    const keys = this.secrets('gemini:');
    if (!keys.length) throw new Refusal('לשרת אין מפתח Gemini — חברו מכשיר שיש בו מפתח', 'not_configured');
    // where the call to Gemini leaves from: 'us' (a second object pinned to the US)
    // or 'eu' (this object). A request may pick one, for comparing the two.
    const via = ['us', 'eu'].includes(req.egress) ? req.egress : (this.env.GEMINI_EGRESS || 'eu');
    return keepAlive(() => this.gemini(keys, model, payload, via));
  }

  // the Gemini call itself, from the chosen place; a network failure or timeout throws
  async geminiFetch(key, model, payload, via) {
    const ms = Number(this.env.AI_TIMEOUT_MS) || AI_MS;
    if (via !== 'us') {
      return fetch(GEMINI + model + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: payload, signal: AbortSignal.timeout(ms),
      });
    }
    const stub = this.env.FAMILY.get(this.env.FAMILY.idFromName('egress-us'), { locationHint: 'enam' });
    const res = await stub.fetch('https://egress/gemini', {
      method: 'POST', body: payload,
      headers: { 'x-navigo-key': key, 'x-navigo-model': model, 'x-navigo-ms': String(ms) },
    });
    if (res.status === 599) throw new Error('egress: no answer');
    return res;
  }

  // a second object of this class, created near the US, that only relays Gemini calls.
  // Reachable from the family object alone: the Worker routes nothing to 'egress'.
  async egress(request) {
    const model = request.headers.get('x-navigo-model') || '';
    if (!/^[\w.-]{1,80}$/.test(model)) return new Response('bad model', { status: 400 });
    try {
      const res = await fetch(GEMINI + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': request.headers.get('x-navigo-key') || '' },
        body: await request.text(),
        signal: AbortSignal.timeout(Number(request.headers.get('x-navigo-ms')) || AI_MS),
      });
      return new Response(await res.text(), { status: res.status });
    } catch {
      return new Response('', { status: 599 });
    }
  }

  async gemini(keys, model, payload, via) {
    const start = Number(this.kv('gemini_next') || 0) % keys.length;
    let last = null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(start + i) % keys.length];
      let res;
      try {
        res = await this.geminiFetch(key, model, payload, via);
      } catch {
        // a model that hangs (or a dropped call) is reported as unavailable, not as a
        // failure: the app's cascade then moves on to the next model
        const body = { error: { code: 503, status: 'UNAVAILABLE', message: `המודל ${model} לא ענה בזמן` } };
        return '{"ok":true,"result":{"status":503,"body":' + JSON.stringify(body) + '}}';
      }
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* an HTML error page */ }
      last = { status: res.status, text: body ? text : 'null' };
      // a key out of quota: the other one (the partner's) may still have some
      const exhausted = res.status === 429 || (body && body.error && body.error.status === 'RESOURCE_EXHAUSTED');
      if (!exhausted) break;
      this.setKv('gemini_next', (start + i + 1) % keys.length);
    }
    return '{"ok":true,"result":{"status":' + last.status + ',"body":' + last.text + '}}';
  }

  /* ---------- the Google bridges ---------- */
  async bridgeFetch(b, body, ms) {
    let res;
    try {
      res = await fetch(b.url, { method: 'POST', body, signal: AbortSignal.timeout(ms) });
    } catch {
      throw new Refusal(`הגשר של ${b.email} לא ענה`, 'upstream');
    }
    const text = await res.text();
    if (!res.ok) throw new Refusal(`הגשר של ${b.email} החזיר שגיאה (${res.status})`, 'upstream');
    return text;
  }

  async bridgeCall(b, params, ms) {
    const text = await this.bridgeFetch(b, JSON.stringify({ token: b.token, ...params }), ms);
    let out = null;
    try { out = JSON.parse(text); } catch { /* below */ }
    if (!out) throw new Refusal(`תשובה לא תקינה מהגשר של ${b.email}`, 'upstream');
    if (!out.ok) throw new Refusal(out.error || 'שגיאת גשר', 'upstream');
    return out;
  }

  // a big answer (a file, an attachment) passes through as text, unparsed
  async bridgePass(b, params, ms) {
    const text = await this.bridgeFetch(b, JSON.stringify({ token: b.token, ...params }), ms);
    if (!text.startsWith('{"ok":true')) {
      let out = null;
      try { out = JSON.parse(text); } catch { /* below */ }
      throw new Refusal((out && out.error) || `תשובה לא תקינה מהגשר של ${b.email}`, 'upstream');
    }
    return raw('{"ok":true,"result":' + text + '}');
  }

  route(id) {
    const s = String(id || '');
    const i = s.lastIndexOf('/');
    const email = s.slice(0, i).toLowerCase();
    const b = i > 0 && this.bridges().find((x) => x.email === email);
    if (!b) throw new Refusal('התיבה של המייל הזה לא מחוברת לשרת', 'not_configured');
    return { b, id: s.slice(i + 1) };
  }

  async gmailSearch(req) {
    const bridges = this.bridges();
    if (!bridges.length) throw new Refusal('לשרת אין גשר Gmail — חברו מכשיר עם גשר', 'not_configured');
    const params = { action: 'gmailSearch', q: clip(req.q, 2000), max: Math.min(50, Math.max(1, Number(req.max) || 25)) };
    for (const k of ['label', 'after', 'before']) if (req[k]) params[k] = clip(req[k], 100);
    const results = await Promise.all(bridges.map((b) => this.bridgeCall(b, params, FETCH_MS)
      .then((out) => ({ messages: (out.messages || []).map((m) => ({ ...m, id: b.email + '/' + m.id, mailbox: b.email })) }))
      .catch((e) => ({ messages: [], error: { mailbox: b.email, error: e.message } }))));
    return { messages: results.flatMap((r) => r.messages), errors: results.filter((r) => r.error).map((r) => r.error) };
  }

  gmailGet(req) {
    const { b, id } = this.route(req.id);
    return this.bridgePass(b, { action: 'gmailGet', id }, FETCH_MS);
  }

  gmailAttachment(req) {
    const { b, id } = this.route(req.id);
    return this.bridgePass(b, { action: 'gmailAttachment', id, index: Number(req.index) || 0 }, FILE_MS);
  }

  /* ---------- document files (they stay in the shared Drive folder) ---------- */
  async upload(dev, req, payload) {
    const doc = clip(req.docId, 200);
    if (!doc) throw new Refusal('חסר מזהה מסמך', 'bad_request');
    if (req.category === 'passport') throw new Refusal('צילום דרכון לא עוזב את המכשיר', 'passport');
    const done = this.sql.exec('SELECT file FROM upload WHERE doc = ?', doc).toArray()[0];
    if (done) return { fileId: done.file }; // a retry after a lost answer: no second copy
    if (!payload) throw new Refusal('הקובץ ריק', 'bad_request');
    if (payload.indexOf('"') !== -1 || payload.indexOf('\\') !== -1) throw new Refusal('קובץ לא תקין', 'bad_request');
    const folder = this.kv('folder');
    if (!folder) throw new Refusal('לשרת אין תיקיית דרייב', 'not_configured');
    const head = JSON.stringify({
      action: 'upload', folderId: folder, tripId: clip(req.tripId, 200) || 'misc', tripName: clip(req.tripName, 120) || 'כללי',
      fileName: clip(req.fileName, 200) || 'document', mimeType: clip(req.mimeType, 120) || 'application/octet-stream',
    });
    let lastErr = null;
    for (const b of this.bridgesFor(dev)) {
      // the base64 goes in as is: no character in it needs escaping
      const body = '{"token":' + JSON.stringify(b.token) + ',' + head.slice(1, -1) + ',"data":"' + payload + '"}';
      try {
        let out = null;
        try { out = JSON.parse(await this.bridgeFetch(b, body, FILE_MS)); } catch (e) { if (e instanceof Refusal) throw e; }
        if (!out || !out.ok || !out.fileId) throw new Refusal((out && out.error) || 'ההעלאה לדרייב נכשלה', 'upstream');
        this.sql.exec('INSERT OR REPLACE INTO upload (doc, file, at) VALUES (?, ?, ?)', doc, out.fileId, Date.now());
        return { fileId: out.fileId };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Refusal('לשרת אין גשר לדרייב', 'not_configured');
  }

  async download(dev, req) {
    const fileId = String(req.fileId || '');
    if (!/^[\w-]{10,}$/.test(fileId)) throw new Refusal('מזהה קובץ לא תקין', 'bad_request');
    let lastErr = null;
    for (const b of this.bridgesFor(dev)) {
      try { return await this.bridgePass(b, { action: 'download', fileId }, FILE_MS); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Refusal('לשרת אין גשר לדרייב', 'not_configured');
  }

  /* ---------- the chat archive (shared, append-only) ---------- */
  archivePut(req) {
    const turns = Array.isArray(req.turns) ? req.turns.slice(0, 1000) : [];
    let added = 0;
    for (const t of turns) {
      if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 200 || !t.text) continue;
      if (this.sql.exec('SELECT 1 FROM archive WHERE id = ?', t.id).toArray().length) continue;
      const rec = { id: t.id, ts: Number(t.ts) || 0, tripId: t.tripId ? clip(t.tripId, 200) : null, role: t.role === 'user' ? 'user' : 'model', text: clip(t.text, 20000) };
      this.sql.exec('INSERT INTO archive (id, trip, ts, data) VALUES (?, ?, ?, ?)', rec.id, rec.tripId || 'general', rec.ts, JSON.stringify(rec));
      added++;
    }
    return { added };
  }

  archiveGet(req) {
    const rows = this.sql.exec('SELECT data FROM archive WHERE trip = ? ORDER BY ts', req.tripId ? String(req.tripId) : 'general').toArray();
    return raw('{"ok":true,"result":{"turns":[' + rows.map((r) => r.data).join(',') + ']}}');
  }

  /* ---------- the nightly backup (7 rolling files, one per weekday) ---------- */
  exportText() {
    const recs = this.sql.exec('SELECT store, data FROM rec ORDER BY store, id').toArray();
    const arch = this.sql.exec('SELECT data FROM archive ORDER BY ts').toArray();
    const devs = this.sql.exec('SELECT name, mailbox, seen, version FROM device WHERE revoked = 0').toArray();
    return '{"app":"Navigo","kind":"server-backup","version":1,"exported":' + JSON.stringify(new Date().toISOString())
      + ',"serverId":' + JSON.stringify(this.kv('id')) + ',"rev":' + this.rev()
      + ',"records":[' + recs.map((r) => '{"store":' + JSON.stringify(r.store) + ',"rec":' + r.data + '}').join(',') + ']'
      + ',"archive":[' + arch.map((r) => r.data).join(',') + ']'
      + ',"devices":' + JSON.stringify(devs) + '}';
  }

  async backup() {
    const rev = this.rev();
    if (String(rev) === this.kv('backup_rev')) return ok({ skipped: 'unchanged' });
    const folder = this.kv('folder');
    const bridges = this.bridges();
    if (!folder || !bridges.length) return ok({ skipped: 'not_configured' });
    const day = new Date().getUTCDay();
    const name = `navigo-backup-${day}-${DAYS[day]}.json`;
    const content = this.exportText();
    let lastErr = null;
    for (const b of bridges) {
      const body = '{"token":' + JSON.stringify(b.token) + ',"action":"filePut","folderId":' + JSON.stringify(folder)
        + ',"name":' + JSON.stringify(name) + ',"content":' + content + '}';
      try {
        const out = JSON.parse(await this.bridgeFetch(b, body, FILE_MS));
        if (!out.ok) throw new Error(out.error || 'filePut failed');
        this.setKv('backup_rev', rev);
        this.setKv('backup_at', Date.now());
        return ok({ name });
      } catch (e) { lastErr = e; }
    }
    console.error('navigo backup failed', lastErr && lastErr.message);
    return fail('הגיבוי לדרייב נכשל', 'upstream');
  }
}
