/* TripNest — Google bridge client (v1.1.0).
   מדבר עם גשר Apps Script (bridge/bridge.gs) שרץ בחשבון Google של המשתמש —
   בלי OAuth בדפדפן, בלי Cloud Console, בלי Picker. מוגן בטוקן סודי.
   הגדרות: bridgeUrl + bridgeToken (נשמרים במכשיר בלבד). */
const G = (() => {
  const DB_FILE = 'tripnest-db.json';

  const DEFAULT_KEYWORDS = [
    'טיסה', 'כרטיס טיסה', 'אישור הזמנה', 'הזמנה', 'מלון', 'שובר', 'ביטוח נסיעות',
    'צ׳ק אין', 'כרטיס עלייה למטוס', 'השכרת רכב', 'ויזה',
    'flight', 'e-ticket', 'boarding pass', 'booking confirmation', 'reservation',
    'hotel', 'itinerary', 'voucher', 'check-in', 'travel insurance', 'car rental', 'visa',
  ];

  /* --- bridge transport --- */
  const isConfigured = async () =>
    !!(await DB.settings.get('bridgeUrl')) && !!(await DB.settings.get('bridgeToken'));

  // POST כ-simple request (בלי headers) כדי לא להפעיל CORS preflight שהגשר לא עונה לו
  async function call(action, params = {}) {
    const [url, token] = await Promise.all([
      DB.settings.get('bridgeUrl'), DB.settings.get('bridgeToken'),
    ]);
    if (!url || !token) throw new Error('הגשר לא הוגדר — הדביקו כתובת וטוקן בהגדרות');
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, action, ...params }) });
    } catch {
      throw new Error('אין חיבור לגשר — בדקו את הכתובת ואת הרשת');
    }
    if (!res.ok) throw new Error(`הגשר החזיר שגיאה (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('תשובה לא תקינה מהגשר — ודאו שהכתובת היא כתובת ה-Web app (/exec)');
    if (!data.ok) throw new Error(data.error || 'שגיאת גשר');
    return data;
  }

  const ping = () => call('ping'); // → { email, version }

  /* --- base64 helpers --- */
  const b64ToBlob = (data, mime = 'application/octet-stream') => {
    const bin = atob(data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  const blobToB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

  /* --- setup (החלפת ה-Picker): יצירה/איתור של התיקייה המשותפת --- */
  const setup = {
    async create({ name, partnerEmail } = {}) {
      const out = await call('createFolder', { name, partnerEmail });
      await DB.settings.set('driveFolderId', out.folderId);
      await DB.settings.set('driveFolderName', out.folderName);
      return out;
    },
    async connect({ name } = {}) {
      const out = await call('findShared', { name });
      await DB.settings.set('driveFolderId', out.folderId);
      await DB.settings.set('driveFolderName', out.folderName);
      return out;
    },
  };

  /* --- drive (מה שהמודולים האחרים צריכים) --- */
  const drive = {
    async downloadBlob(fileId) {
      const out = await call('download', { fileId });
      return b64ToBlob(out.data, out.mimeType);
    },
    async uploadDoc(folderId, trip, doc) {
      const out = await call('upload', {
        folderId, tripId: trip.id, tripName: trip.name || 'טיול',
        fileName: doc.fileName || 'document',
        mimeType: doc.blob.type || doc.mimeType || 'application/octet-stream',
        data: await blobToB64(doc.blob),
      });
      return out.fileId;
    },
  };

  /* --- Sync --- */
  let _syncing = false;
  const Sync = {
    async isReady() { return (await isConfigured()) && !!(await DB.settings.get('driveFolderId')); },

    async run({ silent = true } = {}) {
      if (_syncing) return { skipped: true };
      if (!(await this.isReady())) { if (!silent) UI.toast('הגשר לא הוגדר — פתחו את ההגדרות', 'warning'); return { skipped: true }; }
      _syncing = true;
      document.dispatchEvent(new CustomEvent('tn-sync-state', { detail: 'start' }));
      try {
        const folderId = await DB.settings.get('driveFolderId');
        // 1. merge remote db.json
        const remote = (await call('dbGet', { folderId })).db;
        const { needUpload, localChanged } = await DB.mergeSync(remote);

        // 2. push local document blobs that aren't in Drive yet
        let blobsPushed = false;
        for (const doc of await DB.allRaw('documents')) {
          if (doc.deleted) continue;
          if (doc.blob && !doc.driveFileId) {
            const trip = (await DB.get('trips', doc.tripId)) || { id: doc.tripId || 'misc', name: 'כללי' };
            doc.driveFileId = await drive.uploadDoc(folderId, trip, doc);
            await DB.put('documents', doc); // bump updatedAt so the other device learns the driveFileId
            blobsPushed = true;
          }
        }
        // 3. pull blobs we don't have locally (cache for offline)
        for (const doc of await DB.allRaw('documents')) {
          if (doc.deleted || doc.blob || !doc.driveFileId) continue;
          try { doc.blob = await drive.downloadBlob(doc.driveFileId); await DB.putRaw('documents', doc); } catch { }
        }
        // 4. upload merged db.json
        if (needUpload || blobsPushed || !remote) {
          await call('dbPut', { folderId, db: await DB.exportSync() });
        }
        await DB.settings.set('lastSync', Date.now());
        document.dispatchEvent(new CustomEvent('tn-sync-state', { detail: 'done' }));
        if (localChanged) document.dispatchEvent(new CustomEvent('tn-data-changed'));
        if (!silent) UI.toast('הסנכרון הושלם ✓', 'success');
        return { ok: true, localChanged };
      } catch (e) {
        console.error('sync failed', e);
        document.dispatchEvent(new CustomEvent('tn-sync-state', { detail: 'error' }));
        if (!silent) UI.toast('סנכרון נכשל: ' + e.message, 'error');
        return { error: e.message };
      } finally { _syncing = false; }
    },

    // debounce a background sync after local writes
    _t: null,
    queue() {
      clearTimeout(this._t);
      this._t = setTimeout(() => this.run({ silent: true }), 4000);
    },
  };

  /* --- Gmail --- */
  const gmail = {
    async keywords() {
      let kw = await DB.settings.get('keywords');
      if (!kw || !kw.length) { kw = [...DEFAULT_KEYWORDS]; await DB.settings.set('keywords', kw); await DB.touchShared(); }
      return kw;
    },
    buildQuery(keywords, { after = null, before = null, newerDays = 180 } = {}) {
      const kw = '(' + keywords.map(k => `"${k}"`).join(' OR ') + ')';
      let q = kw;
      if (after) q += ` after:${after.replaceAll('-', '/')}`;
      if (before) q += ` before:${before.replaceAll('-', '/')}`;
      if (!after && !before) q += ` newer_than:${newerDays}d`;
      return q;
    },
    async search(q, max = 25) {
      return (await call('gmailSearch', { q, max })).messages || [];
    },
    // הגשר כבר מפרק את המייל — payload הוא { text, html, attachments }
    async getFull(id) {
      const out = await call('gmailGet', { id });
      return { id, payload: { text: out.text || '', html: out.html || '', attachments: out.attachments || [] } };
    },
    walkParts(payload) {
      return payload || { attachments: [], text: '', html: '' };
    },
    async getAttachment(msgId, att) {
      const out = await call('gmailAttachment', { id: msgId, index: att.attachmentId });
      return b64ToBlob(out.data, out.mimeType || att.mimeType);
    },
  };

  return { isConfigured, ping, call, setup, drive, Sync, gmail, DEFAULT_KEYWORDS };
})();
window.G = G;
