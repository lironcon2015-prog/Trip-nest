/* TripNest — Google Apps Script bridge  (v1.2.0)
   ------------------------------------------------
   הגשר רץ בחשבון Google שלכם ומחליף את OAuth/Cloud Console:
   האפליקציה שולחת אליו בקשות, והוא ניגש ל-Drive ול-Gmail בשמכם.

   הקמה (כ-5 דקות, כל אחד מבני הזוג בחשבון שלו):
   1. היכנסו ל-https://script.new (מחוברים לחשבון ה-Gmail הנכון).
   2. מחקו את התוכן והדביקו את הקובץ הזה במלואו.
   3. החליפו את SECRET_TOKEN למחרוזת סודית משלכם (שני בני הזוג — אותו טוקן או שונה, לא משנה).
   4. Deploy → New deployment → Type: Web app →
      Execute as: Me · Who has access: Anyone → Deploy → אשרו הרשאות.
   5. העתיקו את כתובת ה-Web app (מסתיימת ב-/exec) — אותה מדביקים בהגדרות האפליקציה יחד עם הטוקן.

   עדכון גרסה: הדביקו קוד חדש → Deploy → Manage deployments → Edit → Version: New → Deploy.
*/

const SECRET_TOKEN = 'CHANGE-ME-to-a-long-random-secret';

const BRIDGE_VERSION = '1.2.0';
const DB_FILE = 'tripnest-db.json';
const ROOT_MARKER = 'tripnest-root';
const TRIP_MARKER = 'tripnest-trip:'; // + tripId, בתיאור של תת-התיקייה

/* ---------- entry points ---------- */

function doGet() {
  // בדיקה ידנית בדפדפן — בלי טוקן, בלי מידע רגיש
  return _json({ ok: true, service: 'TripNest bridge', version: BRIDGE_VERSION });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok: false, error: 'bad request body' }); }

  if (!req.token || req.token !== SECRET_TOKEN) {
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
    case 'dbGet':           return dbGet(req);
    case 'dbPut':           return dbPut(req);
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
  return { email: Session.getActiveUser().getEmail(), version: BRIDGE_VERSION };
}

/* מכשיר ראשון: יצירת התיקייה המשותפת ושיתופה לבן/בת הזוג */
function createFolder(req) {
  const name = req.name || 'TripNest — Navigo';
  const folder = DriveApp.createFolder(name);
  folder.setDescription(ROOT_MARKER);
  if (req.partnerEmail) folder.addEditor(req.partnerEmail);
  return { folderId: folder.getId(), folderName: folder.getName() };
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
  const threads = GmailApp.search(req.q || '', 0, max);
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

/* ---------- utils ---------- */

function _q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
