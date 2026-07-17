/* TripNest — Google bridge client (v1.1.0).
   מדבר עם גשר Apps Script (bridge/bridge.gs) שרץ בחשבון Google של המשתמש —
   בלי OAuth בדפדפן, בלי Cloud Console, בלי Picker. מוגן בטוקן סודי.
   הגדרות: bridgeUrl + bridgeToken (נשמרים במכשיר בלבד). */
const G = (() => {
  const DB_FILE = 'tripnest-db.json';

  // deliberately no bare 'הזמנה'/'שובר'/'ויזה'/'visa' — they match every online
  // purchase, coupon and credit-card email; use the ad-hoc search for edge cases
  const DEFAULT_KEYWORDS = [
    'טיסה', 'כרטיס טיסה', 'אישור הזמנה', 'מלון', 'ביטוח נסיעות',
    'צ׳ק אין', 'כרטיס עלייה למטוס', 'השכרת רכב', 'אשרת כניסה',
    'flight', 'e-ticket', 'boarding pass', 'booking confirmation',
    'hotel', 'itinerary', 'check-in', 'travel insurance', 'car rental',
  ];

  /* --- bridge transport ---
     'me'      — הגשר בחשבון שלי (bridgeUrl/bridgeToken)
     'partner' — הגשר בחשבון של בן/בת הזוג (partnerBridgeUrl/partnerBridgeToken),
                 משמש רק לסריקת Gmail כדי שכל סריקה תכסה את שתי התיבות. */
  const isConfigured = async () =>
    !!(await DB.settings.get('bridgeUrl')) && !!(await DB.settings.get('bridgeToken'));
  const hasPartnerBridge = async () =>
    !!(await DB.settings.get('partnerBridgeUrl')) && !!(await DB.settings.get('partnerBridgeToken'));

  // POST כ-simple request (בלי headers) כדי לא להפעיל CORS preflight שהגשר לא עונה לו
  async function call(action, params = {}, { account = 'me' } = {}) {
    const keys = account === 'partner' ? ['partnerBridgeUrl', 'partnerBridgeToken'] : ['bridgeUrl', 'bridgeToken'];
    const [url, token] = await Promise.all(keys.map(k => DB.settings.get(k)));
    if (!url || !token) {
      throw new Error(account === 'partner'
        ? 'הגשר של בן/בת הזוג לא הוגדר — הדביקו כתובת וטוקן בהגדרות'
        : 'הגשר לא הוגדר — הדביקו כתובת וטוקן בהגדרות');
    }
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

  const ping = ({ account = 'me' } = {}) => call('ping', {}, { account }); // → { email, version }

  // the connected account's address. Old bridge deployments return an empty email
  // on ping (Apps Script getActiveUser limitation) — infer it from the mailbox
  // itself: the From of any sent message is the account owner.
  async function accountEmail({ account = 'me' } = {}) {
    try {
      const p = await ping({ account });
      if (p.email) return p.email;
    } catch { return null; }
    try {
      const r = await call('gmailSearch', { q: 'in:sent', max: 1 }, { account });
      const m = String((r.messages || [])[0]?.from || '').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
      if (m) return m[0];
    } catch { }
    return null;
  }

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
    // the partner-backup file carries the folder id, but the ability to open the
    // folder lives in Drive sharing. Verify through THEIR bridge that the folder is
    // visible; if not, grant edit from this side. → 'ok' | 'granted' | 'manual'
    // ('manual' = old bridge without shareFolder, or no partner email known).
    async ensurePartnerAccess({ folderId, partnerEmail }) {
      try {
        const out = await call('findShared', {}, { account: 'partner' });
        if (out.folderId === folderId) return 'ok';
      } catch { }
      if (!partnerEmail) return 'manual';
      try {
        await call('shareFolder', { folderId, email: partnerEmail });
        return 'granted';
      } catch { return 'manual'; }
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

  /* --- named JSON files in the shared folder (chat archive) ---
     requires bridge >= 1.3.0; an older bridge throws 'unknown action: fileGet' —
     callers must catch and degrade gracefully. */
  const files = {
    async get(name) {
      const folderId = await DB.settings.get('driveFolderId');
      return (await call('fileGet', { folderId, name })).content;
    },
    async put(name, content) {
      const folderId = await DB.settings.get('driveFolderId');
      await call('filePut', { folderId, name, content });
    },
  };

  /* --- Sync --- */
  let _syncing = false;
  const Sync = {
    async isReady() { return (await isConfigured()) && !!(await DB.settings.get('driveFolderId')); },

    async run({ silent = true } = {}) {
      if (_syncing) { if (!silent) UI.toast('סנכרון כבר מתבצע…', 'info'); return { skipped: true }; }
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
          if (doc.category === 'passport') continue; // passports never reach Drive
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
    // shared exclusion list — emails containing these words are filtered out of every scan
    async negKeywords() { return (await DB.settings.get('negKeywords')) || []; },
    // the standard scan pulls only mails the user labeled 'Navigo' in Gmail
    // (manually or via a Gmail filter) — precise, no keyword guessing. Pass
    // explicit terms (ad-hoc search) to search the whole mailbox instead.
    buildQuery(keywords, { after = null, before = null, newerDays = 180, attachmentsOnly = false, exclude = [] } = {}) {
      let q = keywords && keywords.length
        ? '(' + keywords.map(k => `"${k}"`).join(' OR ') + ')'
        : 'label:navigo';
      if (after) q += ` after:${after.replaceAll('-', '/')}`;
      if (before) q += ` before:${before.replaceAll('-', '/')}`;
      if (!after && !before) q += ` newer_than:${newerDays}d`;
      if (attachmentsOnly) q += ' has:attachment';
      for (const x of exclude) q += ` -"${x}"`;
      return q;
    },
    // מזהי הודעות מהתיבה של בן/בת הזוג מקבלים קידומת 'p:' — כך getFull/getAttachment
    // יודעים לאיזה גשר לפנות בלי שמודול המסמכים יצטרך להכיר שתי תיבות.
    _route(id) {
      return String(id).startsWith('p:')
        ? { id: String(id).slice(2), account: 'partner' }
        : { id, account: 'me' };
    },
    async search(q, max = 25) {
      const jobs = [
        call('gmailSearch', { q, max })
          .then(out => (out.messages || []).map(m => ({ ...m, mailbox: 'me' }))),
      ];
      if (await hasPartnerBridge()) {
        jobs.push(call('gmailSearch', { q, max }, { account: 'partner' })
          .then(out => (out.messages || []).map(m => ({ ...m, id: 'p:' + m.id, mailbox: 'partner' })))
          .catch(e => {
            console.warn('partner mailbox scan failed', e);
            UI.toast('התיבה של בן/בת הזוג לא נסרקה: ' + e.message, 'warning');
            return [];
          }));
      }
      const results = (await Promise.all(jobs)).flat();
      return results.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    },
    // הגשר כבר מפרק את המייל — payload הוא { text, html, attachments }
    async getFull(id) {
      const r = this._route(id);
      const out = await call('gmailGet', { id: r.id }, { account: r.account });
      return { id, payload: { text: out.text || '', html: out.html || '', attachments: out.attachments || [] } };
    },
    walkParts(payload) {
      return payload || { attachments: [], text: '', html: '' };
    },
    async getAttachment(msgId, att) {
      const r = this._route(msgId);
      const out = await call('gmailAttachment', { id: r.id, index: att.attachmentId }, { account: r.account });
      return b64ToBlob(out.data, out.mimeType || att.mimeType);
    },
  };

  return { isConfigured, hasPartnerBridge, ping, accountEmail, call, setup, drive, files, Sync, gmail, DEFAULT_KEYWORDS };
})();
window.G = G;
