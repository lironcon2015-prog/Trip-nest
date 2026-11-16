/* TripNest — merge rules for synced records, shared by the app and the server.
   server/merge.js is generated from this file (node tools/make-server.mjs):
   edit here only; tests/server.mjs fails on a stale copy.

   - A record: the newer updatedAt wins. A tie is broken by content, so every
     device and the server pick the same winner instead of each keeping its own.
   - A checklist: items merge one by one. Each item carries its own stamp `u`;
     a removed item leaves its stamp in `removed`. Two people ticking the same
     packing list — or ticking it offline abroad — keep each other's ticks.
   - `blob` is a device-local cache (document files) and never takes part. */
const Merge = (() => {
  // stable JSON: sorted keys, undefined dropped — the same content always reads the same
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(x => canon(x === undefined ? null : x)).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort()
        .filter(k => v[k] !== undefined && typeof v[k] !== 'function')
        .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  const stamp = (r) => Number(r && r.updatedAt) || 0;
  const num = (x) => Number(x) || 0;
  const bare = (r) => {
    if (!r || typeof r !== 'object' || !('blob' in r)) return r;
    const { blob, ...rest } = r;
    return rest;
  };

  // the newer of two versions of one record (never mutates either)
  function newer(a, b) {
    const ua = stamp(a), ub = stamp(b);
    if (ua !== ub) return ua > ub ? a : b;
    return canon(bare(a)) >= canon(bare(b)) ? a : b;
  }

  function checklist(a, b) {
    const win = newer(a, b);
    const lose = win === a ? b : a;
    const removed = {};
    for (const src of [lose.removed, win.removed]) {
      for (const [id, t] of Object.entries(src || {})) removed[id] = Math.max(num(t), num(removed[id]));
    }
    const byId = new Map();
    const order = [];
    for (const it of [...(win.items || []), ...(lose.items || [])]) {
      if (!it || it.id == null) continue;
      const cur = byId.get(it.id);
      if (!cur) { byId.set(it.id, it); order.push(it.id); continue; }
      const cu = num(cur.u), iu = num(it.u);
      if (iu > cu || (iu === cu && canon(it) > canon(cur))) byId.set(it.id, it);
    }
    // an item survives unless it was removed at or after its last change
    const items = order.map(id => byId.get(id))
      .filter(it => !(Object.prototype.hasOwnProperty.call(removed, it.id) && removed[it.id] >= num(it.u)));
    const out = { ...bare(win), items, updatedAt: Math.max(stamp(a), stamp(b)) };
    if (Object.keys(removed).length) out.removed = removed; else delete out.removed;
    return out;
  }

  // merged version of one record; local/remote may be null
  function record(store, local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    if (store === 'checklists' && !local.deleted && !remote.deleted
      && Array.isArray(local.items) && Array.isArray(remote.items)) return checklist(local, remote);
    return newer(local, remote);
  }

  // same content? ignores key order, the local blob cache, and checklist item order
  function key(store, r) {
    let x = bare(r);
    if (store === 'checklists' && x && Array.isArray(x.items)) {
      x = { ...x, items: [...x.items].sort((p, q) => (String(p && p.id) < String(q && q.id) ? -1 : 1)) };
    }
    return canon(x);
  }
  const same = (store, a, b) => (!a || !b ? a === b : key(store, a) === key(store, b));

  return { record, newer, same, canon };
})();
if (typeof window !== 'undefined') window.Merge = Merge;
