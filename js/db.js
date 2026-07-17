/* TripNest — IndexedDB layer.
   Synced stores go to the shared Drive db.json; `vault` and `settings` never leave the device. */
const DB = (() => {
  const NAME = 'TripNestDB';
  const VERSION = 2;
  const SYNC_STORES = ['trips', 'documents', 'events', 'checklists', 'expenses', 'members'];
  // agentHistory (the live chat window) is deliberately NOT here: conversations stay
  // per-device. Shared memory (notes, trip summaries, persona) and the Drive chat
  // archive still give both partners' agents access to what was learned.
  const SHARED_SETTINGS = ['keywords', 'negKeywords', 'agentPersona', 'agentNotes', 'agentTripSummaries', 'foodProfile', 'foodFavorites'];
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const mk = (name, opts, indexes = []) => {
          if (db.objectStoreNames.contains(name)) return;
          const s = db.createObjectStore(name, opts);
          indexes.forEach(ix => s.createIndex(ix, ix, { unique: false }));
        };
        mk('trips', { keyPath: 'id' });
        mk('documents', { keyPath: 'id' }, ['tripId']);
        mk('events', { keyPath: 'id' }, ['tripId']);
        mk('checklists', { keyPath: 'id' }, ['tripId']);
        mk('expenses', { keyPath: 'id' }, ['tripId']);
        mk('members', { keyPath: 'id' });
        mk('vault', { keyPath: 'id' }, ['memberId']);
        mk('settings', { keyPath: 'key' });
        mk('archive', { keyPath: 'id' }, ['tripId']); // chat archive (v2), Drive-mirrored separately from db.json
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && out._result !== undefined ? out._result : out);
      t.onerror = () => reject(t.error);
    }));
  }

  function reqProm(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  /* --- generic CRUD --- */
  async function put(store, rec) {
    if (!rec.id) rec.id = uid();
    rec.updatedAt = Date.now();
    await reqProm(store, 'readwrite', s => s.put(rec));
    return rec;
  }
  // preserves updatedAt — used by sync merge and blob-cache writes
  async function putRaw(store, rec) {
    await reqProm(store, 'readwrite', s => s.put(rec));
    return rec;
  }
  const get = (store, id) => reqProm(store, 'readonly', s => s.get(id));
  const allRaw = (store) => reqProm(store, 'readonly', s => s.getAll());
  const all = async (store) => (await allRaw(store)).filter(r => !r.deleted);
  const byTrip = async (store, tripId) =>
    (await reqProm(store, 'readonly', s => s.index('tripId').getAll(tripId))).filter(r => !r.deleted);

  async function remove(store, id) {
    if (SYNC_STORES.includes(store)) {
      const rec = await get(store, id);
      if (!rec) return;
      const tomb = { id: rec.id, deleted: true, updatedAt: Date.now() };
      if (rec.tripId) tomb.tripId = rec.tripId;
      await putRaw(store, tomb);
    } else {
      await reqProm(store, 'readwrite', s => s.delete(id));
    }
  }

  /* --- settings --- */
  const settings = {
    async get(key) { const r = await get('settings', key); return r ? r.value : null; },
    set(key, value) { return putRaw('settings', { key, value }); },
    del(key) { return reqProm('settings', 'readwrite', s => s.delete(key)); },
  };
  async function touchShared() { await settings.set('sharedUpdatedAt', Date.now()); }

  /* --- sync (Drive db.json) --- */
  const stripBlob = (rec) => { const { blob, ...rest } = rec; return rest; };

  async function exportSync() {
    const out = { version: 1, exported: Date.now() };
    for (const st of SYNC_STORES) {
      const recs = await allRaw(st);
      out[st] = st === 'documents' ? recs.map(stripBlob) : recs;
    }
    out.shared = { updatedAt: (await settings.get('sharedUpdatedAt')) || 0 };
    for (const k of SHARED_SETTINGS) out.shared[k] = await settings.get(k);
    return out;
  }

  // merges remote db.json into local. returns whether local has data the remote lacks (needUpload)
  // and whether local state changed (localChanged → UI refresh).
  async function mergeSync(remote) {
    let needUpload = false, localChanged = false;
    if (!remote) return { needUpload: true, localChanged };
    for (const st of SYNC_STORES) {
      const remoteRecs = remote[st] || [];
      const localRecs = await allRaw(st);
      const localMap = new Map(localRecs.map(r => [r.id, r]));
      const remoteIds = new Set(remoteRecs.map(r => r.id));
      for (const rr of remoteRecs) {
        const lr = localMap.get(rr.id);
        if (!lr || (rr.updatedAt || 0) > (lr.updatedAt || 0)) {
          const merged = { ...rr };
          if (st === 'documents' && lr && lr.blob) merged.blob = lr.blob; // blob is a local cache
          await putRaw(st, merged);
          localChanged = true;
        } else if ((lr.updatedAt || 0) > (rr.updatedAt || 0)) {
          needUpload = true;
        }
      }
      if (localRecs.some(r => !remoteIds.has(r.id))) needUpload = true;
    }
    const rs = remote.shared || {};
    const localSharedAt = (await settings.get('sharedUpdatedAt')) || 0;
    if ((rs.updatedAt || 0) === localSharedAt) {
      // equal stamps normally mean identical values, but a past bug could leave the
      // remote copy hollow — if we hold a value the remote lacks, push a healed copy
      for (const k of SHARED_SETTINGS) {
        if (rs[k] == null && (await settings.get(k)) != null) {
          await touchShared(); needUpload = true; break;
        }
      }
    } else if ((rs.updatedAt || 0) > localSharedAt) {
      // a remote null never erases a local value — a device that synced before it
      // had the shared settings must not clobber them. Keep ours and re-upload with
      // a fresh stamp so every other device pulls the healed copy.
      let heal = false;
      for (const k of SHARED_SETTINGS) {
        if (rs[k] != null) await settings.set(k, rs[k]);
        else if ((await settings.get(k)) != null) heal = true;
      }
      if (heal) { await touchShared(); needUpload = true; }
      else await settings.set('sharedUpdatedAt', rs.updatedAt);
      localChanged = true;
    } else if (localSharedAt > (rs.updatedAt || 0)) {
      needUpload = true;
    }
    return { needUpload, localChanged };
  }

  /* --- local backup (vault excluded: passport photos never leave the device) --- */
  const blobToDataURL = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
  });
  async function dataURLToBlob(du) { return (await fetch(du)).blob(); }

  // transient keys that make no sense on another install; shared keys are exported separately
  const BACKUP_SETTINGS_SKIP = ['lastSync', 'sharedUpdatedAt', ...SHARED_SETTINGS];

  async function exportBackup() {
    const out = { app: 'TripNest', version: 2, exported: new Date().toISOString() };
    for (const st of SYNC_STORES) {
      const recs = await allRaw(st);
      out[st] = await Promise.all(recs.map(async r => {
        if (st === 'documents' && r.blob) return { ...stripBlob(r), blobData: await blobToDataURL(r.blob) };
        return r;
      }));
    }
    out.settingsShared = {};
    for (const k of SHARED_SETTINGS) out.settingsShared[k] = await settings.get(k);
    // device-local settings (bridges, tokens, Drive folder, Gemini key, vault PIN) —
    // included so a restore brings the app up fully connected, no re-setup
    out.settingsLocal = {};
    for (const r of await allRaw('settings'))
      if (!BACKUP_SETTINGS_SKIP.includes(r.key)) out.settingsLocal[r.key] = r.value;
    return out;
  }

  async function importBackup(data) {
    if (!data || data.app !== 'TripNest') throw new Error('קובץ גיבוי לא תקין');
    for (const st of SYNC_STORES) {
      for (const r of (data[st] || [])) {
        const rec = { ...r };
        if (rec.blobData) { rec.blob = await dataURLToBlob(rec.blobData); delete rec.blobData; }
        await putRaw(st, rec);
      }
    }
    const shared = Object.entries(data.settingsShared || {}).filter(([, v]) => v != null);
    for (const [k, v] of shared) await settings.set(k, v);
    for (const [k, v] of Object.entries(data.settingsLocal || {})) if (v != null) await settings.set(k, v);
    // a connections-only profile carries no shared settings — leave the local stamp
    // at zero so the first sync pulls them all from Drive instead of skipping them
    if (shared.length) await touchShared();
    else await settings.del('sharedUpdatedAt');
  }

  return {
    init: open, uid, put, putRaw, get, all, allRaw, byTrip, remove,
    settings, touchShared, exportSync, mergeSync, exportBackup, importBackup,
    blobToDataURL, dataURLToBlob, SYNC_STORES,
  };
})();
window.DB = DB;
