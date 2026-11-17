/* TripNest — the Navigo server client (server/worker.js on Cloudflare).

   Before pairing nothing here runs: the phone syncs through its Drive bridge
   as it always did (js/google.js). Pairing is the switch, once per phone: it
   hands the server its bridges, Gemini key and Drive folder, uploads all it
   holds, pulls everything back, and erases the secrets the server now keeps.
   From then on the phone talks only to the server:
   - sync: push the outbox (js/db.js), pull since the last rev, a WebSocket
     announces the partner's changes;
   - Gemini, Gmail (both mailboxes) and document files go through the server,
     which calls them from Western Europe — the phone's network location
     (roaming, a travel eSIM, a hotel) stops mattering;
   - a network that blocks the server: the same request goes around through a
     Google bridge (forward, bridge v1.5.0) for 10 minutes — "· דרך גוגל".
   Every action is safe to send twice (records merge by stamp, uploads are
   idempotent per document), so a failed request is quietly retried. */
const Server = (() => {
  const DEFAULT_URL = 'https://navigo.lironcon.com';
  const config = {
    timeoutMs: 30000, longTimeoutMs: 120000, retryDelayMs: 1000,
    viaMs: 10 * 60 * 1000, pollMs: 60000, helloMs: 5 * 60 * 1000, pingMs: 25000,
    wsBackoff: [1000, 3000, 10000, 30000],
  };
  const LONG = new Set(['upload', 'download', 'gmailAttachment', 'ai']);
  const BATCH = 200;

  // tests and a local server point elsewhere through localStorage — never the URL
  const baseUrl = () => { try { return localStorage.getItem('tn:server') || DEFAULT_URL; } catch { return DEFAULT_URL; } };

  let state = null;    // settings 'server': {serverId, rev, caps, routes, mailbox, pairedAt, helloAt, skew, unpaired}
  let deviceKey = null;
  let via = 0;         // the way around through Google, until this time

  class ServerError extends Error {
    constructor(message, code, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
  }

  const isPaired = () => !!(state && state.serverId && deviceKey && !state.unpaired);
  const caps = () => (state && state.caps) || { gemini: 0, mailboxes: [], drive: false };
  const goingAround = () => via > Date.now();
  const saveState = () => DB.settings.set('server', state);
  const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));

  async function init() {
    [state, deviceKey] = await Promise.all([DB.settings.get('server'), DB.settings.get('deviceKey')]);
    via = ((await DB.settings.get('serverVia')) || {}).until || 0;
    if (state && state.skew) DB.setClockSkew(state.skew);
    document.addEventListener('visibilitychange', onVisibility);
    if (isPaired()) startLive();
  }

  /* ---------- transport ---------- */
  async function attempt(target, body, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res;
    try {
      // no headers on purpose: a text/plain body keeps it a CORS "simple" request,
      // the same request the Google bridge can carry around
      res = await fetch(target, { method: 'POST', body, signal: ctrl.signal });
    } catch (e) {
      const t = e && e.name === 'AbortError';
      throw new ServerError(t ? 'השרת לא ענה בזמן — נסו שוב' : 'אין חיבור לשרת — בדקו את הרשת', 'network', { timeout: t });
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new ServerError(`השרת החזיר שגיאה (${res.status})`, res.status >= 500 ? 'http5xx' : 'http');
    let data = null;
    try { data = await res.json(); } catch { /* below */ }
    // a hotel login page or an HTML error is a network problem — never data
    if (!data || typeof data !== 'object') throw new ServerError('תשובה לא תקינה מהשרת', 'bad_reply');
    if (!data.ok) throw new ServerError(data.error || 'שגיאה בשרת', data.code || 'refused');
    return data.result;
  }

  // the way around: the same body, handed to a Google bridge that passes it on
  // bridges from before v1.5.0 have no forward: they answer 'bad token'. Such a
  // route is skipped for the rest of the session, and its refusal is never shown —
  // the phone's real problem is the original one (no connection to the server).
  const noForward = new Set();
  const usableRoutes = () => ((state && state.routes) || []).filter((r) => !noForward.has(r));
  async function around(body, ms, cause) {
    for (const route of usableRoutes()) {
      try {
        return await attempt(route, JSON.stringify({ forward: body }), ms + 15000);
      } catch (e) {
        if (e.code === 'refused' && /bad token|unknown action/.test(e.message)) { noForward.add(route); continue; }
        throw e;
      }
    }
    throw cause || new ServerError('אין חיבור לשרת — בדקו את הרשת', 'network');
  }

  async function setVia(until) {
    const was = goingAround();
    via = until;
    await DB.settings.set('serverVia', { until });
    if (was !== goingAround()) {
      emit('tn-route', { around: goingAround() });
      if (goingAround()) closeSocket(); else startLive();
    }
  }

  async function call(action, params = {}, { payload = null, timeout = 0 } = {}) {
    const body = JSON.stringify({ action, deviceKey, appVersion: window._BUNDLE_VERSION || '', ...params })
      + (payload == null ? '' : '\n' + payload);
    const ms = timeout || (LONG.has(action) ? config.longTimeoutMs : config.timeoutMs);
    const hasRoutes = usableRoutes().length > 0;
    if (goingAround() && hasRoutes) {
      try { return await around(body, ms); } catch (e) { if (e.code !== 'network') throw e; await setVia(0); }
    }
    try {
      const out = await attempt(baseUrl(), body, ms);
      if (via) await setVia(0);
      return out;
    } catch (e) {
      // the server never answered: maybe this network blocks it — ask through Google
      if (e.code === 'network' && !e.timeout && hasRoutes) {
        const out = await around(body, ms, e);
        await setVia(Date.now() + config.viaMs);
        return out;
      }
      if (!['network', 'http5xx', 'bad_reply'].includes(e.code) || e.timeout) throw e;
      await new Promise((r) => setTimeout(r, config.retryDelayMs));
      return attempt(baseUrl(), body, ms);
    }
  }

  /* ---------- files ---------- */
  const blobToB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const b64ToBlob = (data, mime = 'application/octet-stream') => {
    const bin = atob(data || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  const bare = (r) => { const { blob, ...rest } = r; return rest; };

  async function downloadFile(fileId) {
    const out = await call('download', { fileId });
    return b64ToBlob(out.data, out.mimeType);
  }

  async function uploadFiles() {
    let any = false;
    for (const doc of await DB.allRaw('documents')) {
      if (doc.deleted || !doc.blob || doc.driveFileId || doc.category === 'passport') continue; // passports never leave
      const trip = (await DB.get('trips', doc.tripId)) || { id: doc.tripId || 'misc', name: 'כללי' };
      try {
        const out = await call('upload', {
          docId: doc.id, tripId: trip.id, tripName: trip.name || 'טיול', fileName: doc.fileName || 'document',
          mimeType: doc.blob.type || doc.mimeType || 'application/octet-stream', category: doc.category || '',
        }, { payload: await blobToB64(doc.blob) });
        const fresh = await DB.get('documents', doc.id);
        if (fresh && !fresh.deleted) { fresh.driveFileId = out.fileId; await DB.put('documents', fresh); any = true; }
      } catch (e) {
        if (e.code === 'unpaired') throw e;
        console.warn('upload failed', doc.fileName, e.message);
      }
    }
    return any;
  }

  const missing = new Set(); // files that failed this session — not asked again until reload
  async function downloadFiles() {
    let any = false;
    for (const doc of await DB.allRaw('documents')) {
      if (doc.deleted || doc.blob || !doc.driveFileId || missing.has(doc.driveFileId)) continue;
      try {
        const blob = await downloadFile(doc.driveFileId);
        const fresh = await DB.get('documents', doc.id);
        if (fresh && !fresh.blob) { fresh.blob = blob; await DB.putRaw('documents', fresh); any = true; }
      } catch (e) {
        if (e.code === 'unpaired') throw e;
        missing.add(doc.driveFileId);
      }
    }
    return any;
  }

  /* ---------- sync ---------- */
  function applySkew(serverNow) {
    const d = Number(serverNow) ? serverNow - Date.now() : 0;
    state.skew = Math.abs(d) > 120000 ? d : 0; // seconds of latency are not a wrong clock
    DB.setClockSkew(state.skew);
  }

  // shared settings travel one key at a time; an unchanged key is not sent,
  // and an empty one never erases the partner's
  async function sharedChanges() {
    const meta = { ...((await DB.settings.get('sharedMeta')) || {}) };
    const legacyAt = (await DB.settings.get('sharedUpdatedAt')) || 0;
    const t = DB.now();
    const changes = [];
    for (const key of DB.SHARED_SETTINGS) {
      const value = await DB.settings.get(key);
      if (value == null) continue;
      const snap = Merge.canon(value);
      const m = meta[key];
      if (m && m.snap === snap) continue;
      const at = m ? Math.max(t, m.at + 1) : (legacyAt || t);
      changes.push({ store: 'shared', rec: { id: key, value, updatedAt: at } });
      meta[key] = { at, snap };
    }
    return { changes, meta };
  }

  async function applyShared(rec) {
    const key = rec.id;
    if (!DB.SHARED_SETTINGS.includes(key) || rec.value == null) return false;
    const meta = { ...((await DB.settings.get('sharedMeta')) || {}) };
    const local = await DB.settings.get(key);
    const m = meta[key];
    const snapLocal = local == null ? null : Merge.canon(local);
    const dirty = local != null && (!m || m.snap !== snapLocal);
    const localAt = m ? m.at : ((await DB.settings.get('sharedUpdatedAt')) || 0);
    if (dirty && localAt > (Number(rec.updatedAt) || 0)) return false; // ours is newer, it goes next push
    const snapRemote = Merge.canon(rec.value);
    const changed = snapRemote !== snapLocal;
    if (changed) await DB.settings.set(key, rec.value);
    meta[key] = { at: Number(rec.updatedAt) || 0, snap: snapRemote };
    await DB.settings.set('sharedMeta', meta);
    return changed;
  }

  async function apply({ store, rec }) {
    if (!rec || !rec.id) return false;
    if (store === 'shared') return applyShared(rec);
    if (!DB.SYNC_STORES.includes(store)) return false;
    const local = await DB.get(store, rec.id);
    const merged = Merge.record(store, local, rec);
    let changed = false;
    if (!local || !Merge.same(store, merged, local)) {
      const m = { ...merged };
      if (store === 'documents' && local && local.blob) m.blob = local.blob; // the file is a local cache
      await DB.putRaw(store, m);
      changed = true;
    }
    // this phone holds something the server lacks (a merge of both): send it
    if (!Merge.same(store, merged, rec)) await DB.outbox.add(store, rec.id);
    return changed;
  }

  const warned = new Set();
  async function send(changes) {
    for (let i = 0; i < changes.length; i += BATCH) {
      const res = await call('push', { changes: changes.slice(i, i + BATCH) });
      for (const r of res.rejected || []) {
        if (r.code === 'clock' && r.store !== 'shared') {
          const rec = await DB.get(r.store, r.id);
          if (rec) await DB.put(r.store, rec); // re-stamped by the corrected clock, sent next time
        } else if (r.code === 'too_big' && !warned.has(r.id)) {
          warned.add(r.id);
          UI.toast('רשומה אחת גדולה מדי לשרת ולא סונכרנה', 'warning');
        }
      }
    }
  }

  async function push() {
    const entries = await DB.outbox.list();
    const changes = [];
    for (const e of entries) {
      const rec = await DB.get(e.store, e.id);
      if (rec) changes.push({ store: e.store, rec: bare(rec) });
    }
    const sh = await sharedChanges();
    changes.push(...sh.changes);
    if (changes.length) await send(changes);
    await DB.settings.set('sharedMeta', sh.meta);
    await DB.outbox.done(entries); // entries changed meanwhile stay for the next push
  }

  // everything this phone holds — at pairing, and when the server is a new one
  async function pushEverything() {
    const snapshot = await DB.outbox.list();
    const changes = [];
    for (const st of DB.SYNC_STORES) for (const r of await DB.allRaw(st)) changes.push({ store: st, rec: bare(r) });
    await DB.settings.del('sharedMeta');
    const sh = await sharedChanges();
    changes.push(...sh.changes);
    await send(changes);
    await DB.settings.set('sharedMeta', sh.meta);
    await DB.outbox.done(snapshot);
    await Archive.pushAll();
  }

  // the full upload is done once per server; until it completes, every sync resumes it
  // (a pairing cut off midway must not strand what only this phone holds)
  async function seed() {
    await pushEverything();
    state.seeded = true;
    await saveState();
  }

  async function reseed(serverId) {
    Object.assign(state, { serverId, rev: 0, seeded: false });
    await saveState();
    await seed();
  }

  // the secrets the server holds leave the phone: a bridge once its mailbox is
  // on the server, the Gemini key once the server has accepted this phone's pairing
  async function eraseHeld() {
    const S = DB.settings;
    const held = new Set((caps().mailboxes || []).map((e) => String(e).toLowerCase()));
    const [me, them] = await Promise.all([S.get('myEmail'), S.get('partnerEmail')]);
    if (me && held.has(me.toLowerCase())) { await S.del('bridgeUrl'); await S.del('bridgeToken'); }
    if (them && held.has(them.toLowerCase())) { await S.del('partnerBridgeUrl'); await S.del('partnerBridgeToken'); }
    if (caps().gemini > 0) await S.del('geminiKey');
  }

  async function pull() {
    let changed = false;
    for (let page = 0; page < 1000; page++) {
      const res = await call('pull', { since: state.rev || 0 });
      if (res.serverId && res.serverId !== state.serverId) { await reseed(res.serverId); continue; }
      for (const c of res.changes || []) if (await apply(c)) changed = true;
      state.rev = res.rev;
      await saveState();
      if (!res.more) break;
    }
    return changed;
  }

  async function hello() {
    const res = await call('hello', {});
    if (res.serverId !== state.serverId) await reseed(res.serverId); // a new or reset server: give it everything
    Object.assign(state, { caps: res.caps, routes: res.routes || [], helloAt: Date.now() });
    applySkew(res.now);
    await saveState();
  }

  async function lost() {
    if (!state) return;
    state.unpaired = true;
    await saveState();
    closeSocket();
    UI.toast('המכשיר נותק מהשרת — חברו אותו מחדש בהגדרות', 'warning');
  }

  // one run at a time. A run in flight may have pulled before the change this
  // caller is about — so the caller waits for one more run after it (shared by
  // everyone who arrives meanwhile), never for a run that started too early.
  let running = null;
  let queued = null;
  function sync(opts = {}) {
    if (!running) {
      running = runOnce(opts).finally(() => { running = null; });
      return running;
    }
    if (!queued) {
      const next = () => { queued = null; return sync(opts); };
      queued = running.then(next, next);
    }
    return queued;
  }

  async function runOnce({ silent = true } = {}) {
    emit('tn-sync-state', 'start');
    try {
      if (!state.helloAt || Date.now() - state.helloAt > config.helloMs) await hello();
      if (!state.seeded) await seed();
      await push();
      let changed = await pull();
      if (await uploadFiles()) await push();
      if (await downloadFiles()) changed = true;
      await DB.settings.set('lastSync', Date.now());
      await eraseHeld();
      emit('tn-sync-state', 'done');
      if (changed) emit('tn-data-changed');
      if (!silent) UI.toast('הסנכרון הושלם ✓', 'success');
      return { ok: true, localChanged: changed };
    } catch (e) {
      console.error('server sync failed', e);
      if (e.code === 'unpaired') await lost();
      emit('tn-sync-state', 'error');
      if (!silent) UI.toast('סנכרון נכשל: ' + e.message, 'error');
      return { error: e.message, code: e.code };
    }
  }

  /* ---------- pairing ---------- */
  function newKey() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function defaultName(email) {
    const ua = navigator.userAgent || '';
    const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'דפדפן';
    return email ? `${kind} · ${email.split('@')[0]}` : kind;
  }

  async function pair({ familyCode = '', code = '', name = '', onStep = () => { } } = {}) {
    const S = DB.settings;
    if (!deviceKey) { deviceKey = newKey(); await S.set('deviceKey', deviceKey); }
    const keys = ['bridgeUrl', 'bridgeToken', 'partnerBridgeUrl', 'partnerBridgeToken', 'geminiKey', 'driveFolderId', 'driveFolderName'];
    const [bu, bt, pu, pt, gk, fid, fname] = await Promise.all(keys.map((k) => S.get(k)));
    let [myEmail, partnerEmail] = await Promise.all([S.get('myEmail'), S.get('partnerEmail')]);

    // 1. the latest from Drive first — the partner may still be on the old version
    if (bu && bt && fid) {
      onStep('מושך את העדכונים האחרונים מהדרייב…');
      await G.Sync.runLegacy({ silent: true }).catch(() => { });
      await Archive.importLegacy().catch(() => { });
    }

    onStep('מתחבר לשרת…');
    const bridges = [];
    if (bu && bt) bridges.push({ url: bu, token: bt, email: myEmail || '', mine: true });
    if (pu && pt) bridges.push({ url: pu, token: pt, email: partnerEmail || '', mine: false });
    const res = await call('pair', {
      familyCode: familyCode || null, code: code || null, name: name || defaultName(myEmail), mailbox: myEmail || '',
      bridges: bridges.map(({ url, token, email }) => ({ url, token, email })),
      geminiKey: gk || '', folderId: fid || '', folderName: fname || '',
    });
    const adopted = res.adopted || [];
    adopted.forEach((a, i) => {
      if (!a.ok || !a.email || !bridges[i]) return;
      if (bridges[i].mine && !myEmail) myEmail = a.email;
      if (!bridges[i].mine && !partnerEmail) partnerEmail = a.email;
    });
    if (myEmail) await S.set('myEmail', myEmail);
    if (partnerEmail) await S.set('partnerEmail', partnerEmail);
    state = {
      serverId: res.serverId, rev: 0, caps: res.caps, routes: res.routes || [], seeded: false,
      mailbox: res.mailbox || myEmail || null, pairedAt: Date.now(), helloAt: Date.now(), skew: 0,
    };
    applySkew(res.now);
    await saveState();

    // 2. everything this phone holds goes up; the server keeps the newer of each
    onStep('מעלה את הנתונים לשרת…');
    await seed();
    // 3. and everything comes back
    onStep('מוריד את הנתונים מהשרת…');
    await pull();
    // 4. the secrets the server now holds leave this phone
    await eraseHeld();

    startLive();
    emit('tn-data-changed');
    sync({ silent: true }); // the files, in the background
    return res;
  }

  // a key typed in settings after pairing goes to the server, not to the phone
  async function giveGeminiKey(key) {
    const res = await call('pair', { geminiKey: String(key || '').trim() });
    state.caps = res.caps;
    await saveState();
    return res.caps.gemini;
  }

  const pairCode = () => call('pairCode', {});
  const devices = () => call('devices', {});
  const revoke = (id) => call('revoke', { id });

  /* ---------- Gemini, Gmail ---------- */
  async function ai(model, payload, timeoutMs) {
    const r = await call('ai', { model }, { payload: JSON.stringify(payload), timeout: timeoutMs });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => { if (r.body == null) throw new Error('not json'); return r.body; },
    };
  }

  const gmail = {
    async search(q, max, extra = {}) {
      const r = await call('gmailSearch', { q, max, ...extra });
      for (const e of r.errors || []) UI.toast(`התיבה ${e.mailbox} לא נסרקה: ${e.error}`, 'warning');
      return r.messages || [];
    },
    get: (id) => call('gmailGet', { id }),
    attachment: (id, index) => call('gmailAttachment', { id, index }),
  };

  /* ---------- live ---------- */
  let ws = null;
  let wsTimer = null;
  let pingTimer = null;
  let pollTimer = null;
  let wsFails = 0;

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden' && isPaired()) sync({ silent: true }); }, config.pollMs);
  }
  function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

  function closeSocket() {
    clearTimeout(wsTimer); clearInterval(pingTimer);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* gone */ } }
  }

  function startLive() {
    if (!isPaired() || document.visibilityState === 'hidden') return;
    // the way around carries requests, not sockets: ask once a minute meanwhile
    if (goingAround() || typeof WebSocket === 'undefined') { startPoll(); return; }
    if (ws) return;
    let sock;
    try { sock = new WebSocket(baseUrl().replace(/^http/, 'ws') + '/live'); } catch { retryLive(); return; }
    ws = sock;
    sock.onopen = () => {
      wsFails = 0;
      stopPoll();
      sock.send(JSON.stringify({ type: 'hello', deviceKey }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { sock.send('ping'); } catch { /* closing */ } }, config.pingMs);
    };
    sock.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m = null;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'rev' && m.rev > (state.rev || 0)) sync({ silent: true });
      else if (m.type === 'bye') lost();
    };
    sock.onclose = () => {
      if (ws === sock) { ws = null; clearInterval(pingTimer); retryLive(); }
    };
    sock.onerror = () => { try { sock.close(); } catch { /* gone */ } };
  }

  function retryLive() {
    if (!isPaired() || document.visibilityState === 'hidden') return;
    startPoll(); // until the socket is back
    const d = config.wsBackoff[Math.min(wsFails++, config.wsBackoff.length - 1)];
    clearTimeout(wsTimer);
    wsTimer = setTimeout(startLive, d);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') { closeSocket(); stopPoll(); } else if (isPaired()) startLive();
  }

  return {
    init, isPaired, caps, goingAround, call, sync, pair, pairCode, devices, revoke, giveGeminiKey,
    ai, gmail, downloadFile, config, baseUrl, DEFAULT_URL, ServerError,
    state: () => state, mailbox: () => (state && state.mailbox) || null,
    _live: () => ws,
  };
})();
window.Server = Server;
