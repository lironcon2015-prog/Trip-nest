/* TripNest — chat archive: the full agent-conversation record, partitioned per
   trip (+ 'general' for untagged turns), kept locally in IndexedDB and mirrored
   to named JSON files in the shared Drive folder (chat-archive-<key>.json).
   The agent never sees the archive in its regular context — it reaches it on
   demand through the search_archive tool. Requires bridge >= 1.3.0 for the
   Drive mirror; with an older bridge the archive stays local-only. */
const Archive = (() => {
  const keyOf = (tripId) => tripId || 'general';
  const fileOf = (key) => `chat-archive-${key}.json`;

  let unsupported = false; // bridge without fileGet/filePut — keep local only
  const oldBridge = (e) => /unknown action/.test(String(e && e.message || e));

  async function dirtyKeys() { return (await DB.settings.get('archiveDirty')) || []; }
  async function markDirty(key) {
    const d = await dirtyKeys();
    if (!d.includes(key)) { d.push(key); await DB.settings.set('archiveDirty', d); }
  }

  /* records: { id, ts, tripId|null, role:'user'|'model', text } */
  async function add(records) {
    for (const r of records) {
      if (!r.text) continue;
      await DB.putRaw('archive', {
        id: r.id || DB.uid(), ts: r.ts || Date.now(),
        tripId: r.tripId || null, role: r.role === 'user' ? 'user' : 'model', text: r.text,
      });
      await markDirty(keyOf(r.tripId));
    }
  }

  const forKey = async (key) => (await DB.allRaw('archive'))
    .filter(r => keyOf(r.tripId) === key)
    .sort((a, b) => a.ts - b.ts);
  const forTrip = (tripId) => forKey(keyOf(tripId));

  async function search(query, { tripId = undefined, limit = 20 } = {}) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    let recs = await DB.allRaw('archive');
    if (tripId !== undefined) recs = recs.filter(r => keyOf(r.tripId) === keyOf(tripId));
    return recs
      .filter(r => { const t = String(r.text).toLowerCase(); return words.every(w => t.includes(w)); })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  const count = async () => (await DB.allRaw('archive')).length;

  /* --- Drive mirror: union-by-id merge, so both partners can append --- */
  async function mergeRemote(key) {
    const remote = await G.files.get(fileOf(key)); // throws on an old bridge
    const have = new Set((await forKey(key)).map(r => r.id));
    for (const r of (remote?.records || [])) {
      if (r && r.id && !have.has(r.id)) await DB.putRaw('archive', r);
    }
    return remote;
  }

  // pull one partition before a deep search (best effort, silent)
  async function pull(tripId) {
    if (unsupported || !(await G.Sync.isReady())) return;
    try { await mergeRemote(keyOf(tripId)); }
    catch (e) { if (oldBridge(e)) unsupported = true; }
  }

  let _syncing = false;
  async function sync() {
    if (_syncing || unsupported || !(await G.Sync.isReady())) return;
    _syncing = true;
    try {
      for (const key of await dirtyKeys()) {
        const remote = await mergeRemote(key);
        const remoteIds = new Set((remote?.records || []).map(r => r.id));
        const all = await forKey(key);
        if (all.some(r => !remoteIds.has(r.id))) {
          await G.files.put(fileOf(key), { version: 1, records: all });
        }
        await DB.settings.set('archiveDirty', (await dirtyKeys()).filter(k => k !== key));
      }
    } catch (e) {
      if (oldBridge(e)) unsupported = true;
      else console.warn('archive sync failed', e);
    } finally { _syncing = false; }
  }

  function init() {
    // piggyback on the app sync cycle instead of hooking into G.Sync itself
    document.addEventListener('tn-sync-state', (e) => { if (e.detail === 'done') sync(); });
  }

  return { add, search, forTrip, count, pull, sync, init, isUnsupported: () => unsupported };
})();
window.Archive = Archive;
