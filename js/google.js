/* TripNest — Google bridge: Identity (GIS), Drive sync to a shared folder, Picker, Gmail scan.
   Scopes: drive.file (only files this app created/opened) + gmail.readonly (requested on demand). */
const G = (() => {
  const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
  const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
  const DB_FILE = 'tripnest-db.json';

  const DEFAULT_KEYWORDS = [
    'טיסה', 'כרטיס טיסה', 'אישור הזמנה', 'הזמנה', 'מלון', 'שובר', 'ביטוח נסיעות',
    'צ׳ק אין', 'כרטיס עלייה למטוס', 'השכרת רכב', 'ויזה',
    'flight', 'e-ticket', 'boarding pass', 'booking confirmation', 'reservation',
    'hotel', 'itinerary', 'voucher', 'check-in', 'travel insurance', 'car rental', 'visa',
  ];

  /* --- script loaders --- */
  const _loaded = {};
  function loadScript(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('טעינת ' + src + ' נכשלה'));
      document.head.appendChild(s);
    });
    return _loaded[src];
  }

  /* --- auth --- */
  let _token = null; // { token, exp, scopes:[] }
  try { _token = JSON.parse(sessionStorage.getItem('tn-token') || 'null'); } catch { }

  const isConfigured = async () => !!(await DB.settings.get('googleClientId'));

  async function ensureToken(scopes = [SCOPE_DRIVE]) {
    if (_token && _token.exp > Date.now() + 60000 && scopes.every(s => _token.scopes.includes(s))) return _token.token;
    const clientId = await DB.settings.get('googleClientId');
    if (!clientId) throw new Error('חסר Google Client ID — הגדירו אותו בהגדרות');
    await loadScript('https://accounts.google.com/gsi/client');
    const wanted = [...new Set([...(_token?.scopes || []), ...scopes])];
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: wanted.join(' '),
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          _token = { token: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000, scopes: wanted };
          sessionStorage.setItem('tn-token', JSON.stringify(_token));
          resolve(_token.token);
        },
        error_callback: (e) => reject(new Error(e.message || 'ההתחברות ל-Google בוטלה')),
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }

  function signOut() { _token = null; sessionStorage.removeItem('tn-token'); }
  const isSignedIn = () => !!(_token && _token.exp > Date.now());

  async function api(url, { method = 'GET', headers = {}, body, scopes = [SCOPE_DRIVE], raw = false } = {}, _retry = true) {
    const token = await ensureToken(scopes);
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
    if (res.status === 401 && _retry) { signOut(); return api(url, { method, headers, body, scopes, raw }, false); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Google API ${res.status}`);
    }
    return raw ? res : res.json();
  }

  /* --- Drive --- */
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  const drive = {
    list(q, fields = 'files(id,name,mimeType,appProperties)') {
      return api(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    },
    async downloadBlob(fileId) {
      const res = await api(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, { raw: true });
      return res.blob();
    },
    async downloadJson(fileId) {
      const res = await api(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, { raw: true });
      return res.json();
    },
    multipart(metadata, blob, fileId = null) {
      const boundary = 'tn' + Date.now();
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`,
      ]);
      const url = fileId
        ? `${UPLOAD}/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
        : `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`;
      return api(url, {
        method: fileId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
    },
    uploadJson(folderId, fileId, name, obj) {
      const meta = fileId ? {} : { name, parents: [folderId], mimeType: 'application/json' };
      return this.multipart(meta, new Blob([JSON.stringify(obj)], { type: 'application/json' }), fileId);
    },
    uploadBlob(folderId, name, blob) {
      return this.multipart({ name, parents: [folderId] }, blob);
    },
    createFolder(name, parentId = null, appProperties = null) {
      const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
      if (parentId) meta.parents = [parentId];
      if (appProperties) meta.appProperties = appProperties;
      return api(`${DRIVE}/files?supportsAllDrives=true`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
      });
    },
    share(fileId, email) {
      return api(`${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
      });
    },
    async ensureTripFolder(rootId, trip) {
      const found = await this.list(`'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and appProperties has { key='tripId' and value='${trip.id}' } and trashed=false`);
      if (found.files?.length) return found.files[0].id;
      const created = await this.createFolder(trip.name || 'טיול', rootId, { tripId: trip.id });
      return created.id;
    },
  };

  /* --- Picker (choosing the shared folder needs an API key) --- */
  async function pickFolder() {
    const apiKey = await DB.settings.get('googleApiKey');
    if (!apiKey) throw new Error('חסר Google API Key (לבוחר התיקיות) — הגדירו בהגדרות');
    const token = await ensureToken();
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise(res => gapi.load('picker', res));
    return new Promise((resolve) => {
      const mkView = () => new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes('application/vnd.google-apps.folder');
      const picker = new google.picker.PickerBuilder()
        .setLocale('iw')
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .addView(mkView())
        .addView(mkView().setOwnedByMe(false))
        .setTitle('בחרו את תיקיית TripNest המשותפת')
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const d = data.docs[0]; resolve({ id: d.id, name: d.name });
          } else if (data.action === google.picker.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    });
  }

  /* --- Sync --- */
  let _syncing = false;
  const Sync = {
    async isReady() { return !!(await DB.settings.get('googleClientId')) && !!(await DB.settings.get('driveFolderId')); },

    async run({ silent = true } = {}) {
      if (_syncing) return { skipped: true };
      if (!(await this.isReady())) { if (!silent) UI.toast('חיבור Google לא הוגדר — פתחו את ההגדרות', 'warning'); return { skipped: true }; }
      _syncing = true;
      document.dispatchEvent(new CustomEvent('tn-sync-state', { detail: 'start' }));
      try {
        const folderId = await DB.settings.get('driveFolderId');
        // 1. merge remote db.json
        const found = await drive.list(`'${folderId}' in parents and name='${DB_FILE}' and trashed=false`, 'files(id,name)');
        let fileId = found.files?.[0]?.id || null;
        let remote = null;
        if (fileId) { try { remote = await drive.downloadJson(fileId); } catch { remote = null; } }
        const { needUpload, localChanged } = await DB.mergeSync(remote);

        // 2. push local document blobs that aren't in Drive yet
        let blobsPushed = false;
        const docs = await DB.allRaw('documents');
        for (const doc of docs) {
          if (doc.deleted) continue;
          if (doc.blob && !doc.driveFileId) {
            const trip = (await DB.get('trips', doc.tripId)) || { id: doc.tripId || 'misc', name: 'כללי' };
            const tf = await drive.ensureTripFolder(folderId, trip);
            const up = await drive.uploadBlob(tf, doc.fileName || 'document', doc.blob);
            doc.driveFileId = up.id;
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
        if (needUpload || blobsPushed || !fileId) {
          const data = await DB.exportSync();
          const up = await drive.uploadJson(folderId, fileId, DB_FILE, data);
          fileId = fileId || up.id;
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
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const b64urlToBlob = (data, mime = 'application/octet-stream') => {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  const b64urlToText = (data) => {
    try { return decodeURIComponent(escape(atob(data.replace(/-/g, '+').replace(/_/g, '/')))); }
    catch { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); }
  };

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
      const data = await api(`${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`, { scopes: [SCOPE_DRIVE, SCOPE_GMAIL] });
      const msgs = data.messages || [];
      return Promise.all(msgs.map(async m => {
        const meta = await api(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { scopes: [SCOPE_DRIVE, SCOPE_GMAIL] });
        const h = (name) => meta.payload.headers.find(x => x.name === name)?.value || '';
        return { id: m.id, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: meta.snippet || '' };
      }));
    },
    getFull(id) { return api(`${GMAIL}/messages/${id}?format=full`, { scopes: [SCOPE_DRIVE, SCOPE_GMAIL] }); },
    walkParts(payload, out = { attachments: [], text: '', html: '' }) {
      if (!payload) return out;
      if (payload.filename && payload.body?.attachmentId) {
        out.attachments.push({ filename: payload.filename, mimeType: payload.mimeType, attachmentId: payload.body.attachmentId });
      } else if (payload.mimeType === 'text/plain' && payload.body?.data) {
        out.text += b64urlToText(payload.body.data);
      } else if (payload.mimeType === 'text/html' && payload.body?.data) {
        out.html += b64urlToText(payload.body.data);
      }
      (payload.parts || []).forEach(p => this.walkParts(p, out));
      return out;
    },
    async getAttachment(msgId, att) {
      const data = await api(`${GMAIL}/messages/${msgId}/attachments/${att.attachmentId}`, { scopes: [SCOPE_DRIVE, SCOPE_GMAIL] });
      return b64urlToBlob(data.data, att.mimeType);
    },
  };

  return { ensureToken, signOut, isSignedIn, isConfigured, drive, pickFolder, Sync, gmail, DEFAULT_KEYWORDS, SCOPE_DRIVE, SCOPE_GMAIL };
})();
window.G = G;
