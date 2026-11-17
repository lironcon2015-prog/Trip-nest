/* TripNest — Google Apps Script bridge  (v1.6.0)
   ------------------------------------------------
   הגשר רץ בחשבון Google שלכם ומחליף את OAuth/Cloud Console:
   האפליקציה שולחת אליו בקשות, והוא ניגש ל-Drive ול-Gmail בשמכם.

   הקובץ מודבק תמיד כמו שהוא, בלי לערוך בו כלום: הטוקן הסודי לא כתוב בקוד
   (הקובץ בריפו ציבורי) — הוא שמור בהגדרות הפרויקט, Script properties ← SECRET_TOKEN.

   הקמה (כ-5 דקות, כל אחד מבני הזוג בחשבון שלו):
   1. היכנסו ל-https://script.new (מחוברים לחשבון ה-Gmail הנכון).
   2. מחקו את התוכן והדביקו את הקובץ הזה במלואו.
   3. בתפריט הפונקציות בוחרים newToken ← Run ← מאשרים הרשאות. ביומן מופיעה שורה
      "SECRET_TOKEN (להדביק בהגדרות האפליקציה): …" — הטוקן כבר שמור בגשר.
   4. Deploy → New deployment → Type: Web app →
      Execute as: Me · Who has access: Anyone → Deploy → אשרו הרשאות.
   5. העתיקו את כתובת ה-Web app (מסתיימת ב-/exec) — אותה מדביקים בהגדרות האפליקציה יחד עם הטוקן.

   עדכון גרסה: מדביקים את הקובץ החדש כמו שהוא → Deploy → Manage deployments → Edit →
   Version: New → Deploy. הטוקן נשאר ב-Script properties ולא נוגעים בו.

   מעבר מגרסה עד 1.5.0, שבה הטוקן היה כתוב בקוד — פעם אחת בלבד:
   לפני ההדבקה מעתיקים את הטוקן מהשורה const SECRET_TOKEN = '…' שבקוד הישן ←
   Project Settings (גלגל השיניים) ← Script properties ← Add script property ←
   Property: SECRET_TOKEN · Value: הטוקן ← Save script properties. אחר כך מדביקים.
   (הטוקן לא משתנה, ולכן הטלפונים והשרת ממשיכים לעבוד בלי שינוי.)

   v1.5.0 — מסלול עקיפה לשרת Navigo: רשת שחוסמת את השרת (סלולרי, מלון) עדיין
   מגיעה לגוגל, והגשר מעביר את הבקשה לשרת מצד גוגל (forward). בפעם הראשונה:
   בעורך בוחרים testForward ← Run ← מאשרים הרשאה (גישה לרשת חיצונית).
*/

const BRIDGE_VERSION = '1.6.0';
// the default that older versions shipped in the code — public, so never a valid token
const PLACEHOLDER_TOKEN = 'CHANGE-ME-to-a-long-random-secret';
// the Navigo server on Cloudflare (server/worker.js) — the only address forward calls
const SERVER_URL = 'https://navigo.lironcon.com';
const DB_FILE = 'tripnest-db.json';
const ROOT_MARKER = 'tripnest-root';
const TRIP_MARKER = 'tripnest-trip:'; // + tripId, בתיאור של תת-התיקייה

/* ---------- entry points ---------- */

function doGet() {
  // בדיקה ידנית בדפדפן — בלי טוקן, בלי מידע רגיש. installed: האם יש טוקן ב-Script properties
  return _json({ ok: true, service: 'TripNest bridge', version: BRIDGE_VERSION, installed: !!_secretToken() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok: false, error: 'bad request body' }); }

  // the way around for a phone whose network blocks the server. No token and no
  // Drive/Gmail access here: the server checks the phone's device key itself,
  // and SERVER_URL is the only address this ever calls.
  if (req.forward != null) return _forward(req.forward);

  const token = _secretToken();
  if (!token) {
    return _json({ ok: false, error: 'הגשר לא הותקן: חסר SECRET_TOKEN ב-Script properties (או הריצו newToken בעורך)', code: 'setup' });
  }
  if (!req.token || !_sameText(req.token, token)) {
    return _json({ ok: false, error: 'bad token' });
  }

  try {
    const out = _dispatch(req);
    return _json(Object.assign({ ok: true }, out));
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

function _dispatch(req) {
  switch (req.action) {
    case 'ping':            return ping();
    case 'createFolder':    return createFolder(req);
    case 'findShared':      return findShared(req);
    case 'shareFolder':     return shareFolder(req);
    case 'dbGet':           return dbGet(req);
    case 'dbPut':           return dbPut(req);
    case 'fileGet':         return fileGet(req);
    case 'filePut':         return filePut(req);
    case 'upload':          return upload(req);
    case 'download':        return download(req);
    case 'gmailSearch':     return gmailSearch(req);
    case 'gmailGet':        return gmailGet(req);
    case 'gmailAttachment': return gmailAttachment(req);
    default: throw new Error('unknown action: ' + req.action);
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- actions ---------- */

function ping() {
  // getActiveUser() is empty in "execute as me / anyone" web-app deployments;
  // getEffectiveUser() is the executing account — the one whose Drive/Gmail we use
  return { email: Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail(), version: BRIDGE_VERSION };
}

/* מכשיר ראשון: יצירת התיקייה המשותפת ושיתופה לבן/בת הזוג */
function createFolder(req) {
  const name = req.name || 'TripNest — Navigo';
  const folder = DriveApp.createFolder(name);
  folder.setDescription(ROOT_MARKER);
  if (req.partnerEmail) folder.addEditor(req.partnerEmail);
  return { folderId: folder.getId(), folderName: folder.getName() };
}
// grant the partner's account edit access after the fact (works for the folder
// owner and for editors alike) — used by the partner-backup export flow
function shareFolder(req) {
  if (!req.folderId || !req.email) throw new Error('shareFolder: missing folderId/email');
  DriveApp.getFolderById(req.folderId).addEditor(req.email);
  return { shared: true };
}

/* מכשיר שני: איתור תיקיית TripNest ששותפה אליי (או שכבר קיימת אצלי) */
function findShared(req) {
  const wanted = req.name || null;
  const scopes = wanted
    ? ["title = '" + _q(wanted) + "' and trashed = false",
       "sharedWithMe and title = '" + _q(wanted) + "'"]
    : ["trashed = false", "sharedWithMe"];
  const seen = {};
  let fallback = null;
  for (const q of scopes) {
    const it = DriveApp.searchFolders(q);
    while (it.hasNext()) {
      const f = it.next();
      if (seen[f.getId()]) continue;
      seen[f.getId()] = true;
      if (f.getDescription() === ROOT_MARKER) {
        return { folderId: f.getId(), folderName: f.getName() };
      }
      if (wanted && !fallback) fallback = f; // שם מדויק בלי מרקר — עדיין קביל
    }
  }
  if (fallback) return { folderId: fallback.getId(), folderName: fallback.getName() };
  throw new Error('לא נמצאה תיקיית TripNest משותפת — ודאו שהמכשיר הראשון יצר ושיתף אותה');
}

/* ---------- db.json ---------- */

function _dbFile(folderId) {
  const it = DriveApp.getFolderById(folderId).getFilesByName(DB_FILE);
  return it.hasNext() ? it.next() : null;
}

function dbGet(req) {
  const f = _dbFile(req.folderId);
  if (!f) return { db: null };
  try { return { db: JSON.parse(f.getBlob().getDataAsString('UTF-8')) }; }
  catch (e) { return { db: null }; }
}

function dbPut(req) {
  const f = _dbFile(req.folderId);
  const content = JSON.stringify(req.db);
  if (f) f.setContent(content);
  else DriveApp.getFolderById(req.folderId)
    .createFile(DB_FILE, content, 'application/json');
  return {};
}

/* ---------- named JSON files (chat archive etc.) ----------
   fileGet/filePut work on a caller-chosen file name in the root folder, with
   overwrite semantics (unlike 'upload', which always creates a new file). */

function _namedFile(folderId, name) {
  const it = DriveApp.getFolderById(folderId).getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function fileGet(req) {
  if (!req.name) throw new Error('fileGet: missing name');
  const f = _namedFile(req.folderId, req.name);
  if (!f) return { content: null };
  try { return { content: JSON.parse(f.getBlob().getDataAsString('UTF-8')) }; }
  catch (e) { return { content: null }; }
}

function filePut(req) {
  if (!req.name) throw new Error('filePut: missing name');
  if (req.name === DB_FILE) throw new Error('filePut: use dbPut');
  const f = _namedFile(req.folderId, req.name);
  const content = JSON.stringify(req.content);
  if (f) f.setContent(content);
  else DriveApp.getFolderById(req.folderId).createFile(req.name, content, 'application/json');
  return {};
}

/* ---------- documents ---------- */

function _tripFolder(rootId, tripId, tripName) {
  const root = DriveApp.getFolderById(rootId);
  const marker = TRIP_MARKER + tripId;
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDescription() === marker) return f;
  }
  const created = root.createFolder(tripName || 'טיול');
  created.setDescription(marker);
  return created;
}

function upload(req) {
  const folder = _tripFolder(req.folderId, req.tripId || 'misc', req.tripName || 'כללי');
  const blob = Utilities.newBlob(
    Utilities.base64Decode(req.data),
    req.mimeType || 'application/octet-stream',
    req.fileName || 'document');
  const file = folder.createFile(blob);
  return { fileId: file.getId() };
}

function download(req) {
  const file = DriveApp.getFileById(req.fileId);
  const blob = file.getBlob();
  return {
    fileName: file.getName(),
    mimeType: blob.getContentType(),
    data: Utilities.base64Encode(blob.getBytes()),
  };
}

/* ---------- Gmail ---------- */

function gmailSearch(req) {
  const max = Math.min(req.max || 25, 50);
  // label mode (v1.4.0+): pull threads straight off matching labels — bypasses
  // Gmail search-syntax normalization, so '@Navigo' and friends work too
  const threads = req.label ? _labelThreads(req.label, max) : GmailApp.search(req.q || '', 0, max);
  const after = req.after ? new Date(req.after) : null;
  const before = req.before ? new Date(new Date(req.before).getTime() + 86400000) : null; // inclusive end day
  const out = [];
  for (const t of threads) {
    // one result per thread: the newest message carrying attachments,
    // otherwise the newest message — long threads no longer flood the list
    const msgs = t.getMessages();
    let m = msgs[msgs.length - 1], atts = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const n = msgs[i].getAttachments({ includeInlineImages: false, includeAttachments: true }).length;
      if (n) { m = msgs[i]; atts = n; break; }
    }
    if (after && m.getDate() < after) continue;
    if (before && m.getDate() >= before) continue;
    out.push({
      id: m.getId(),
      from: m.getFrom(),
      subject: m.getSubject(),
      date: m.getDate().toISOString(),
      snippet: (m.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 140),
      attachments: atts,
    });
    if (out.length >= max) break;
  }
  return { messages: out };
}

// any user label whose name CONTAINS the given word (case-insensitive) counts —
// '@Navigo', 'Navigo!', 'טיולים/Navigo'. Threads carrying several matching labels
// are deduped, newest first.
function _labelThreads(word, max) {
  const wanted = String(word).toLowerCase();
  const seen = {};
  const threads = [];
  const labels = GmailApp.getUserLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName().toLowerCase().indexOf(wanted) === -1) continue;
    const ts = labels[i].getThreads(0, max);
    for (var j = 0; j < ts.length; j++) {
      const id = ts[j].getId();
      if (!seen[id]) { seen[id] = true; threads.push(ts[j]); }
    }
  }
  threads.sort(function (a, b) { return b.getLastMessageDate() - a.getLastMessageDate(); });
  return threads;
}

function gmailGet(req) {
  const m = GmailApp.getMessageById(req.id);
  const atts = m.getAttachments({ includeInlineImages: false, includeAttachments: true });
  return {
    text: m.getPlainBody() || '',
    html: m.getBody() || '',
    attachments: atts.map(function (a, i) {
      return { attachmentId: i, filename: a.getName(), mimeType: a.getContentType(), size: a.getSize() };
    }),
  };
}

function gmailAttachment(req) {
  const m = GmailApp.getMessageById(req.id);
  const atts = m.getAttachments({ includeInlineImages: false, includeAttachments: true });
  const a = atts[req.index];
  if (!a) throw new Error('attachment not found');
  return {
    filename: a.getName(),
    mimeType: a.getContentType(),
    data: Utilities.base64Encode(a.getBytes()),
  };
}

/* ---------- forward (v1.5.0) ---------- */

function _forward(body) {
  if (typeof body !== 'string' || !body || body.length > 30 * 1024 * 1024) {
    return _json({ ok: false, error: 'bad forward', code: 'bad_request' });
  }
  try {
    const res = UrlFetchApp.fetch(SERVER_URL + '/', {
      method: 'post', contentType: 'text/plain; charset=utf-8', payload: body,
      muteHttpExceptions: true, followRedirects: true,
    });
    const text = res.getContentText('UTF-8');
    // the server's own answer (an error included) passes as is; a dead server is 'network'
    if (res.getResponseCode() >= 500 || !text) return _json({ ok: false, error: 'השרת לא זמין כרגע', code: 'network' });
    return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return _json({ ok: false, error: 'השרת לא זמין כרגע', code: 'network' });
  }
}

// run once from the editor after pasting v1.5.0: grants the external-request
// permission and checks that Google reaches the server
function testForward() {
  const res = UrlFetchApp.fetch(SERVER_URL + '/', { muteHttpExceptions: true });
  Logger.log('השרת ענה (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
}

/* ---------- the token (Script properties, never the code) ---------- */

function _secretToken() {
  const t = String(PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN') || '').trim();
  return t && t !== PLACEHOLDER_TOKEN ? t : '';
}

// constant time: the answer's timing must not tell how much of a guess was right
function _sameText(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// a new bridge: run once from the editor — creates a long random token, keeps it in
// Script properties and logs it once, for the app's settings. It never replaces a
// token that exists: the phones and the Navigo server already use it (showToken).
function newToken() {
  const existing = _secretToken();
  if (existing) {
    Logger.log('כבר יש טוקן בגשר — לא נוצר חדש. showToken מציג אותו.');
    return existing;
  }
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SECRET_TOKEN', token);
  Logger.log('SECRET_TOKEN (להדביק בהגדרות האפליקציה): ' + token);
  return token;
}

// the token in the log — to set up a phone before it connects to the server
function showToken() {
  const t = _secretToken();
  Logger.log(t ? 'SECRET_TOKEN: ' + t : 'אין טוקן בגשר — הריצו newToken');
  return t;
}

/* ---------- utils ---------- */

function _q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
