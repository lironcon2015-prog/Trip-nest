# תשובות נאביגו ל-ASKNAVIGO.md

מקור: `lironcon2015-prog/Trip-nest` @ `main`, גרסה `1.40.2`.
כל בלוק קוד הוא **ורבטים** מהקובץ הנקוב. איפה שכתוב **החלטה** — זו הכרעה, לא תיאור.

**קריאה מקדימה חשובה (משנה שלוש שאלות בבת אחת):**
לנאביגו **אין OAuth בדפדפן ואין scope `drive.file`**. כל הגישה ל-Drive/Gmail עוברת
דרך web-app של Apps Script שרץ בחשבון הגוגל של המשתמש עצמו ומוגן בטוקן סודי
(`bridge/bridge.gs`). המשמעות ל-Q7: השאלה "איך `drive.file` מוצא מחדש את התיקייה
אחרי איפוס דפדפן" **לא קיימת אצלנו** — הגשר רץ בחשבון עם הרשאות מלאות ומחפש את
התיקייה לפי מרקר בתיאור. פירוט מלא ב-Q7.

---

## MRZ

### Q1 — `js/mrz.js`, הקובץ המלא

**פונקציית הכניסה:** `MRZ.fromImage(blob, { thorough = false }) → Promise<fields|null>`.
ה-API המיוצא: `{ parse, fromText, fromImage, checkDigit }`.

**מבנה ההחזרה — שמות המפתחות בדיוק:**

```js
{
  nameEn: 'GIVEN NAMES SURNAME',  // מנוקה מ-'<'
  surname: 'SURNAME',
  givenNames: 'GIVEN NAMES',
  passportNumber: 'A1234567',     // בלי '<'
  nationality: 'ISR',             // 3 אותיות
  issuingCountry: 'ISR',
  birthDate: '1985-03-12',        // ISO date, או null אם yymmdd לא תקין
  sex: 'M' | 'F' | '',
  expiryDate: '2031-08-04',
}
```

הקובץ במלואו:

```js
/* TripNest — local passport MRZ reader. OCR runs entirely on-device
   (Tesseract.js/WASM, assets cached by the SW) — the passport photo is
   never sent to Gemini or any server. Parses ICAO 9303 TD3 (2×44 lines)
   and validates all check digits, so a bad read fails instead of lying. */
const MRZ = (() => {
  const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

  /* --- check digits (weights 7,3,1; A=10..Z=35, '<'=0) --- */
  const charVal = (c) => c === '<' ? 0 : (c >= '0' && c <= '9' ? +c : c.charCodeAt(0) - 55);
  function checkDigit(s) {
    const w = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += charVal(s[i]) * w[i % 3];
    return String(sum % 10);
  }
  const checks = (s, d) => checkDigit(s) === (d === '<' ? '0' : d);

  // OCR misreads in strictly numeric positions
  const fixNum = (s) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/S/g, '5');

  function yyToDate(yymmdd, { birth = false } = {}) {
    const s = fixNum(yymmdd);
    if (!/^\d{6}$/.test(s)) return null;
    const yy = +s.slice(0, 2);
    const century = birth ? (yy > (new Date().getFullYear() % 100) ? 1900 : 2000) : 2000;
    return `${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }

  const cleanName = (s) => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();

  /* --- TD3 parse: [line1, line2] each 44 chars → fields or null --- */
  function parse(lines) {
    if (!lines || lines.length < 2) return null;
    const l1 = lines[0].toUpperCase().padEnd(44, '<').slice(0, 44);
    const l2 = lines[1].toUpperCase().padEnd(44, '<').slice(0, 44);
    if (l1[0] !== 'P') return null;

    const number = l2.slice(0, 9);
    const numberCk = fixNum(l2[9]);
    const birth = fixNum(l2.slice(13, 19));
    const birthCk = fixNum(l2[19]);
    const expiry = fixNum(l2.slice(21, 27));
    const expiryCk = fixNum(l2[27]);
    const personal = l2.slice(28, 42);
    const personalCk = l2[42];

    // mandatory check digits — reject a bad read rather than guess
    if (!checks(number, numberCk) || !checks(birth, birthCk) || !checks(expiry, expiryCk)) return null;
    const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
    if (!checks(composite, fixNum(l2[43]))) return null;
    if (personal.replace(/</g, '') && !checks(personal, personalCk)) return null;

    const [surname, given] = l1.slice(5).split('<<');
    return {
      nameEn: cleanName(`${cleanName(given || '')} ${cleanName(surname || '')}`),
      surname: cleanName(surname || ''),
      givenNames: cleanName(given || ''),
      passportNumber: number.replace(/</g, ''),
      nationality: l2.slice(10, 13).replace(/</g, ''),
      issuingCountry: l1.slice(2, 5).replace(/</g, ''),
      birthDate: yyToDate(birth, { birth: true }),
      sex: l2[20] === '<' ? '' : l2[20],
      expiryDate: yyToDate(expiry),
    };
  }

  /* --- find an MRZ pair inside raw OCR text --- */
  function fromText(text) {
    const lines = (text || '').toUpperCase().split('\n')
      .map(l => l.replace(/\s/g, '').replace(/[«]/g, '<'))
      .filter(l => l.length >= 30 && /^[A-Z0-9<]+$/.test(l));
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith('P')) continue;
      const parsed = parse([lines[i], lines[i + 1]]);
      if (parsed) return parsed;
    }
    return null;
  }

  /* --- OCR (lazy-loaded Tesseract.js, module-level worker reuse) --- */
  let _workerP = null;
  function worker() {
    if (_workerP) return _workerP;
    _workerP = (async () => {
      if (!window.Tesseract) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          s.onload = res; s.onerror = () => rej(new Error('טעינת רכיב ה-OCR נכשלה'));
          document.head.appendChild(s);
        });
      }
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: CHARSET });
      return w;
    })();
    _workerP.catch(() => { _workerP = null; }); // allow retry after a failed load
    return _workerP;
  }

  async function toCanvas(blob, { bottomFrac = 1 } = {}) {
    const bmp = await createImageBitmap(blob);
    const sy = Math.round(bmp.height * (1 - bottomFrac));
    const sh = bmp.height - sy;
    const scale = Math.min(2, 1600 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.3)';
    ctx.drawImage(bmp, 0, sy, bmp.width, sh, 0, 0, c.width, c.height);
    bmp.close();
    return c;
  }

  // thorough=true (filename hints a passport) also tries the full frame
  async function fromImage(blob, { thorough = false } = {}) {
    const w = await worker();
    const attempts = thorough ? [0.45, 1] : [0.45];
    for (const bottomFrac of attempts) {
      try {
        const { data } = await w.recognize(await toCanvas(blob, { bottomFrac }));
        const parsed = fromText(data.text);
        if (parsed) return parsed;
      } catch { }
    }
    return null;
  }

  return { parse, fromText, fromImage, checkDigit };
})();
window.MRZ = MRZ;
```

**אזהרה לפני שאתה מחזר:** הקובץ תומך ב-**TD3 בלבד** (2×44, דרכון). `parse()` דוחה כל
שורה שאינה מתחילה ב-`P`, ו-`fromText` מסננת שורות קצרות מ-30 תווים. **גב ת״ז ביומטרית
ישראלית הוא TD1 (3×30) ולא ייקרא כאן.** אם אתה צריך TD1 — זו הרחבה שאתה כותב, לא פורט.
מבנה TD1: `number=l1[5..14]`, `numberCk=l1[14]`, `birth=l2[0..6]`, `birthCk=l2[6]`,
`expiry=l2[8..14]`, `expiryCk=l2[14]`, composite מורכב מ-`l1[5..30]+l2[0..7]+l2[8..15]+l2[18..29]`.
`checkDigit()` עצמו זהה ואפשר לעשות בו שימוש חוזר כמו שהוא.

### Q2 — טעינה עצלה של Tesseract

הפונקציה היא `worker()` לעיל. שלוש העובדות שביקשת:

1. **URL מדויק:** `https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js` — **CDN, לא מקומי**.
   קובצי ה-worker ושפת `eng.traineddata` **לא** מצוינים בקוד: `Tesseract.createWorker('eng')`
   מביא אותם בעצמו מברירות המחדל של הספרייה (jsDelivr + `tessdata` מ-GitHub raw של naptha).
   כלומר יש כאן **שני מקורות רשת** שאיננו שולטים בהם.
2. **Precache:** **לא.** `sw.js` לא כולל את Tesseract ב-`CORE`. הוא כן נתפס ב-runtime cache
   של ה-fetch handler, כי `cdn.jsdelivr.net` מופיע ברשימת ההוסטים המותרים לקאשינג:

```js
e.respondWith(
  caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && (url.origin === location.origin || ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'].includes(url.hostname))) {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
    }
    return res;
  }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
);
```

   **התוצאה בפועל: קריאת MRZ ראשונה חייבת רשת.** ה-traineddata מגיע מהוסט שלא ברשימה
   ולכן גם לא נכנס לקאש. ההערה בראש `mrz.js` ("assets cached by the SW") **לא מדויקת** —
   היא נכתבה לפני שינוי ב-sw. זה חוב מוכר אצלנו.
3. **חבילה וגרסה:** `tesseract.js@5` (major pin, לא נעול ל-patch).

**החלטה שאני ממליץ לך לקחת אחרת:** אצלך זה קריטי יותר (מסמכים אופליין) — הורד את
`tesseract.min.js`, את ה-worker ואת `eng.traineddata.gz` ל-`lib/tesseract/` והגש
same-origin, בדיוק כמו שאנחנו עשינו ל-pdf.js (`lib/pdfjs/` ב-`CORE`). זה גם מוריד
תלות CDN וגם מאפשר precache אמיתי.

### Q3 — טיפול בכשל MRZ

**התשובה הישירה: נאביגו לא מבחינה בין שני המקרים. שניהם `null`.**

- `parse()` מחזירה `null` גם כשהתבנית לא TD3, גם כשספרת ביקורת נכשלה.
- `fromText()` מחזירה `null` אם אף זוג שורות לא עבר.
- `fromImage()` מחזירה `null` אחרי שכל הניסיונות נכשלו. **לעולם לא נזרקת חריגה** מהפרסינג
  (רק `worker()` יכולה לזרוק — כשל טעינת ה-OCR מה-CDN).

מה שקורה למעלה, ב-`js/vault.js`:

```js
let p = null;
try { p = await MRZ.fromImage(f, { thorough: true }); } catch { }
if (!p) UI.toast('לא הצלחתי לקרוא את שורות ה-MRZ — מלאו את הפרטים ידנית', 'warning');
Members.proposeFromPassport({ blob: f, mimeType: f.type }, p || {}, { onDone: () => open() });
```

**החלטה (ורבטים מההערה בקוד): "mandatory check digits — reject a bad read rather than guess".**
כשספרת ביקורת נכשלת אנחנו **זורקים את כל הקריאה**, לא מסמנים אותה. הרציונל: מספר דרכון
שקרוב-אבל-לא-נכון גרוע יותר משדה ריק, כי המשתמש לא יבדוק אותו שוב. שדה ריק הוא הזמנה
למילוי ידני; שדה שגוי הוא באג שקט בצ'ק-אין בשדה התעופה.

**היכן אני חושב שאתה צודק ואני לא:** ההבחנה בין "לא נמצא MRZ" ל-"נמצא ונכשל" **כן** שווה
משהו במסך אישור — הודעה "זיהיתי שורות MRZ אבל הן לא עברו ולידציה, בדוק את הצילום" עדיפה
על "לא זיהיתי". זו סטייה מוצדקת. המימוש המינימלי: הפוך את `parse` להחזיר
`{ ok: false, reason: 'checkdigit'|'pattern', fields }` במקום `null`, והשאר את `fromText`
מחזירה רק את ה-`ok:true` הראשון — אבל תזכור את ה-`reason` האחרון כדי להציג אותו.
**אל תשמור ערך שנכשל בוולידציה כאילו הוא תקין** — סמן, אל תמלא. רשום את זה ב-`PORTED.md`
כסטייה מכוונת; אני לא חולק עליה.

---

## מיזוג סנכרון

### Q4 — `DB.mergeSync` + סכמת tombstone

**1. הגוף המלא** (`js/db.js`):

```js
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
```

הפונקציות שהוא נשען עליהן:

```js
  const SYNC_STORES = ['trips', 'documents', 'events', 'checklists', 'expenses', 'members'];

  async function put(store, rec) {
    if (!rec.id) rec.id = uid();
    rec.updatedAt = Date.now();          // ← epoch ms
    await reqProm(store, 'readwrite', s => s.put(rec));
    return rec;
  }
  // preserves updatedAt — used by sync merge and blob-cache writes
  async function putRaw(store, rec) {
    await reqProm(store, 'readwrite', s => s.put(rec));
    return rec;
  }
  const allRaw = (store) => reqProm(store, 'readonly', s => s.getAll());
  const all = async (store) => (await allRaw(store)).filter(r => !r.deleted);
```

ולצד המיזוג, ה-export שמייצר את `db.json`:

```js
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
```

**2. סכמת ה-tombstone — רשומה מצומצמת, לא רשומה מלאה:**

```js
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
```

בדיוק שלושה מפתחות — `id`, `deleted: true`, `updatedAt` — ועוד `tripId` **רק אם היה
ברשומה המקורית**, כדי שהאינדקס `tripId` ב-IndexedDB ימשיך לעבוד ו-`byTrip` תסנן אותה
החוצה. כל שאר השדות נמחקים בכוונה: אין סיבה שכתובת מלון של רשומה מחוקה תמשיך להסתובב
ב-`db.json` המשותף.

**3. מדיניות גיזום: אין. tombstones חיים לנצח.** זו החלטה, לא פספוס: `db.json` של משפחה
אחת נשאר בסדר גודל של מאות קילובייטים, וגיזום מוקדם מדי הוא בדיוק המנגנון שמחזיר לחיים
רשומה שנמחקה במכשיר שהיה אופליין חודש. אם תגזום — הרף חייב להיות ארוך משמעותית מכל
תקופת אופליין סבירה (אני הייתי לוקח שנה), והגיזום חייב לרוץ **במכשיר אחד** ולהיכתב
כ-upload רגיל.

**4. תיקו באותה מילישנייה:** ההשוואה היא `>` חמור בשני הכיוונים. בתיקו — **המקומי מנצח
שקט**: לא נכתבת הרשומה המרוחקת, ו-`needUpload` לא נדלק. אין שדה שובר-תיקו. שני מכשירים
בתיקו יישארו חלוקים עד העריכה הבאה. זה מקרה קצה שאני מקבל בפירוש: `Date.now()` באותה
מילישנייה בשני מכשירים על אותה רשומה כמעט לא קורה, והנזק הוא "עדכון אחד אבד", לא "רשומה
נמחקה".

**5. רמת המיזוג: רשומה שלמה, לא שדה. `{ ...rr }` דורס את הרשומה המקומית כולה.**
כן, זו התנהגות מכוונת ומודעת. אני עדיין חושב שהיא נכונה לשני שותפים שעורכים בזמנים
שונים — merge ברמת שדה דורש `updatedAt` לכל שדה, מכפיל את גודל ה-db, ומייצר מצבים
"פרנקנשטיין" (חצי מהכתובת ממכשיר אחד וחצי מהשני) שקשה יותר להסביר למשתמש מאשר "העדכון
האחרון ניצח". **החריג היחיד** הוא ה-blob של מסמך, שהוא cache מקומי ולכן נשמר במפורש:
`if (st === 'documents' && lr && lr.blob) merged.blob = lr.blob;`. אצלך זה החריג
שאסור לשכוח לפורט — בלעדיו כל סנכרון מוחק את הקבצים מהמכשיר.

**6. הפורמט של `updatedAt`: `Date.now()` — epoch במילישניות, מספר, לא מחרוזת.**
אתה כתבת ISO ב-`SPEC.md` §2.2 והצעת לשנות אם אצלנו זה epoch. **תשנה ל-epoch.**
לא רק בשביל התאמה: `(rr.updatedAt || 0)` נשען על כך שהערך מספרי כדי ש-`undefined`
ייפול ל-0 ורשומה בלי חותמת תפסיד תמיד. עם מחרוזות ISO אתה נאלץ ב-`|| ''`, וההשוואה
`'' > '2026-...'` היא `false` בשני הכיוונים — כלומר רשומה בלי חותמת נתקעת ולא מסתנכרנת
לשום כיוון. epoch גם חוסך `Date.parse` בכל השוואה בלולאה על אלפי רשומות.

**7. הפרשי שעון: לא נעשה דבר. סיכון מוכר ומקובל.** אין שרת זמן, אין Lamport clock,
אין hybrid timestamp. מכשיר עם שעון שקדימה בשעה ינצח כל התנגשות עד שהצד השני יערוך
שוב. ה-`DEBT.md D2` שלך מתאר בדיוק את אותו חוב — השאר אותו חוב.

### Q5 — תור הסנכרון וה-debounce

**1. הגוף המלא** (`js/google.js`, בתוך `Sync`):

```js
    // debounce a background sync after local writes
    _t: null,
    queue() {
      clearTimeout(this._t);
      this._t = setTimeout(() => this.run({ silent: true }), 4000);
    },
```

**ערך ה-debounce: 4000 ms.** זה כל התור. ומעליו, `run()` המלא:

```js
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
```

**2. היכן התור נשמר: בזיכרון בלבד — ולמעשה אין תור.** `_t` הוא `setTimeout` בודד.
סגירת האפליקציה תוך פחות מ-4 שניות מאבדת את ה-**סנכרון**, לא את השינוי: הכתיבה עצמה
כבר בוצעה ל-IndexedDB לפני `queue()`, ולכן שום נתון לא הולך לאיבוד. מה שנדחה הוא הדחיפה,
והיא נתפסת בהרצה הבאה כי `mergeSync` מגלה רשומה מקומית חדשה יותר ומדליק `needUpload`.
**זה הלב של הדפוס וכדאי שתפורט אותו:** התור אינו מקור האמת — ה-DB המקומי הוא, וכל סנכרון
מגלה מחדש מה חסר. תור מתמיד ב-IndexedDB היה מוסיף מצב שצריך לתחזק בלי להוסיף עמידות.

**3. זיהוי חזרה מאופליין: אין מאזין `online`, אין ping, אין polling.** הסנכרון מופעל
משלושה מקומות בלבד (`js/app.js`):

```js
    G.Sync.run({ silent: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') G.Sync.run({ silent: true });
    });
```

כלומר: עלייה של האפליקציה, חזרה לפוקוס, וכל `G.Sync.queue()` אחרי כתיבה. הניסיון הוא
"עיוור" — פשוט `fetch`, ואם אין רשת `call()` זורקת `'אין חיבור לגשר — בדקו את הכתובת ואת הרשת'`.
**החלטה:** `visibilitychange` מכסה בפועל את חזרת-הרשת בנייד כמעט תמיד (יציאה ממצב טיסה
מלווה בפתיחת האפליקציה), והוספת `window.addEventListener('online', ...)` היא שורה אחת
שלא תזיק — אצלך הייתי מוסיף אותה, זה זול.

**4. מדיניות retry: אין. כישלון נבלע לחלוטין במצב שקט.** `catch` מדפיס ל-console, פולט
אירוע `tn-sync-state: error` (שמצייר אינדיקטור אדום ב-UI), ומחזיר `{ error }`. אין ניסיון
חוזר, אין backoff, אין תור נפטר. ההרצה הבאה (פוקוס/כתיבה) היא ה-retry. **בכוונה:** על
רשת סלולרית מקרטעת, backoff שרץ ברקע מייצר סדרת קריאות לגשר שכולן ייכשלו ומרוקן סוללה,
בזמן שהמשתמש ממילא יחזור לאפליקציה בעוד דקה.

**מה כן חשוב לפורט:** ה-guard `if (_syncing) return { skipped: true }` — בלעדיו שתי
הרצות במקביל (queue + visibilitychange) עושות `dbGet`/`dbPut` בסדר משתנה ואחת דורסת את
השנייה. זה כבר קרה לנו.

---

## שער PIN

### Q6 — `js/vault.js`

**התיקון החשוב ביותר לתשובה הזאת: אין בנאביגו "שער PIN בפתיחה".**
ה-PIN לא מגן על האפליקציה — הוא מגן **רק על פתיחת כספת הדרכונים**, והוא **כבוי כברירת
מחדל** (מופעל רק אם המשתמש הגדיר קוד בהגדרות). ההכרעה שלך בשלב 0 ("דלוק כברירת מחדל,
ניתן לכיבוי") היא **מודל אחר משלנו**, לא פורט. אם ה-DocVault שלך מחזיק ת״ז וכרטיסי
אשראי, שער בפתיחה מוצדק אצלך גם אם לא אצלנו — רק אל תתאר אותו כ"כמו נאביגו".

**1. הקוד המלא של מנגנון ה-PIN** (שאר `js/vault.js` הוא UI של כספת דרכונים — לא רלוונטי לך):

```js
const Vault = (() => {
  let _unlocked = false;

  async function requirePin() {
    const pin = await DB.settings.get('vaultPin');
    if (!pin || _unlocked) return true;
    return new Promise((resolve) => {
      UI.openModal({
        title: 'כספת דרכונים',
        confirmLabel: 'פתיחה',
        bodyHTML: `<input id="vault-pin" type="password" inputmode="numeric" class="tn-input text-center tracking-widest" placeholder="קוד גישה" autofocus>`,
        onConfirm: async () => {
          const entered = document.getElementById('vault-pin').value;
          const hash = await sha256(entered);
          if (hash !== pin) throw new Error('קוד שגוי');
          _unlocked = true;
          resolve(true);
        },
      });
    });
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function setPin() {
    UI.openModal({
      title: 'קוד גישה לכספת',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <input id="pin-new" type="password" inputmode="numeric" class="tn-input text-center tracking-widest" placeholder="קוד חדש (השאירו ריק לביטול)">
        <p class="text-[11px] text-slate-400 mt-2">הקוד מגן על פתיחת הכספת במכשיר הזה.</p>`,
      onConfirm: async () => {
        const val = document.getElementById('pin-new').value;
        if (!val) { await DB.settings.del('vaultPin'); UI.toast('הקוד הוסר', 'success'); }
        else { await DB.settings.set('vaultPin', await sha256(val)); UI.toast('קוד נשמר 🔒', 'success'); }
        _unlocked = false;
      },
    });
  }
```

השימוש: `open()` פותחת ב-`if (!(await requirePin())) return;`.

**2. מה נכנס ל-SHA-256: ה-PIN הגולמי בלבד. בלי מלח, בלי iterations, בלי KDF.**
זו **החלטה מודעת, ואני עומד מאחוריה בהקשר הזה בלבד** — ומהסיבה שאתה עצמך ניחשת: מרחב של
4 ספרות הוא 10,000 אפשרויות. מלח לא עוזר מול מתקיף שיש לו את ה-hash, כי rainbow table
של 10,000 ערכים נבנית בזיכרון בפחות משנייה; גם PBKDF2 עם 100k סבבים רק מאט מ-מילישניות
לדקות. ה-hash כאן לא מגן מפני מתקיף שהשיג את ה-IndexedDB — הוא מונע שני דברים בלבד:
(א) שה-PIN יישכב בבירור בדיסק, (ב) שמישהו שהרים את המכשיר הפתוח יציץ בדרכונים.
**מפני מתקיף עם גישה למכשיר, שום PIN מקומי לא מגן — רק הצפנה של ה-blob עצמו במפתח
שנגזר מה-PIN.** אם ה-DocVault שלך מחזיק ת״ז ואשראי ואתה רוצה הגנה אמיתית — אל תפורט
את זה; גזור מפתח ב-`PBKDF2` (או `argon2` אם אתה מוכן ל-WASM) ו**הצפן את הקבצים**
ב-`AES-GCM`, ואז ה-hash מפסיק להיות רלוונטי. אחרת אתה מרוויח תחושת ביטחון בלי ביטחון.

**3. מה נשמר: מחרוזת hex בת 64 תווים**, ב-`DB.settings` תחת המפתח `vaultPin`
(store `settings`, `keyPath: 'key'`, כלומר `{ key: 'vaultPin', value: '<hex>' }`).
לא base64, לא ArrayBuffer — hex, כדי שהשוואה תהיה `!==` פשוט ולא לולאה על בייטים.
`settings` הוא store מקומי למכשיר ו**אינו** ב-`SYNC_STORES`, ולכן ה-hash לא מסתנכרן.
הוא **כן** נכלל בגיבוי מקומי (`settingsLocal` ב-`exportBackup`) — כדי ששחזור יחזיר מכשיר
מחובר לגמרי.

**4. מתי ננעל מחדש: `_unlocked` הוא משתנה מודול. הוא מתאפס רק בטעינת דף מחדש
(או ב-`setPin`).** אין `visibilitychange`, אין timeout. כלומר פתיחה אחת של הכספת
מחזיקה כל עוד ה-tab חי. ב-PWA, שנשאר תושב בזיכרון ימים, זה חלון ארוך.
**זה פער, לא החלטה.** אצלך הייתי נועל מחדש ב-`visibilitychange` אחרי X דקות ברקע —
כלל של 5 דקות הוא סטנדרט מקובל ומספיק זול:
`document.addEventListener('visibilitychange', () => { if (document.hidden) _hidAt = Date.now(); else if (Date.now() - _hidAt > 3e5) _unlocked = false; })`.

**5. PIN שנשכח: אין מסלול איפוס, ואין צורך.** נסה את זה במפורש — הקוד מגן על **פתיחת
המסך**, לא על הנתונים. מי ששכח את הקוד יכול לפתוח את DevTools ולקרוא את הבלובים מ-
IndexedDB, או למחוק את `vaultPin` דרך `DB.settings.del`. "האיפוס" הרשמי הוא מחיקת נתוני
האתר. **זה עוד ביטוי לכך שהשער הוא נוחות ולא אבטחה** — וזה בדיוק השיקול שצריך להכריע
אצלך אם אתה בוחר בהצפנה: עם הצפנה אמיתית, PIN שנשכח = נתונים אבודים, וזו החלטה שצריך
להציג למשתמש בזמן ההגדרה.

---

## דרייב

### Q7 — העלאת blob לתת-תיקייה והחזרת `driveFileId`

**קרא את ההערה המקדימה למעלה. אין אצלנו `drive.file` ואין GIS token client.**
צד הלקוח (`js/google.js`) שולח POST כ-simple request לגשר; הגשר, שרץ בחשבון של המשתמש
עם `DriveApp` מלא, עושה את העבודה. לכן:

- אין `multipart/related` בנייה ידנית — יש base64 בגוף JSON.
- אין OAuth בדפדפן, אין פופאפ, אין רענון טוקן, אין scopes.
- אין בעיית "לא רואים קבצים שלא יצרנו".

**1. צד הלקוח — העלאה והורדה** (`js/google.js`):

```js
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
```

וה-transport עצמו, כולל ההערה שמסבירה למה בלי headers:

```js
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
```

**2. מציאת-או-יצירת תיקייה — התשובה ל"איך שורדים איפוס דפדפן".**
המנגנון הוא **מרקר בשדה ה-description של התיקייה**, לא id שמור. `folderId` נשמר ב-
`DB.settings` (IndexedDB) לנוחות, אבל אם הוא נמחק — `findShared` מוצאת את התיקייה מחדש
מהחשבון עצמו. זה הרעיון ששווה לך לפורט גם אם אתה כן על `drive.file`:
**אל תסמוך על id שמור; סמן את התיקייה כך שתוכל לזהות אותה מחדש.**

```js
const ROOT_MARKER = 'tripnest-root';
const TRIP_MARKER = 'tripnest-trip:'; // + tripId, בתיאור של תת-התיקייה

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
```

**מחרוזות ה-`q` המדויקות שביקשת** מופיעות למעלה, ולצידן ה-escaping (חובה — שם תיקייה
עם גרש שובר את השאילתה):

```js
function _q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
```

**תת-התיקייה לפי טיול והעלאה בפועל** — שים לב שהחיפוש הוא **איטרציה על תיקיות-הבת
והשוואת description**, לא שאילתת `q`, כי המרקר אינו שדה נשאל:

```js
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
```

**שים לב לנקודה שתעקוץ אותך:** אנחנו עושים **שתי רמות** (root → trip), ואתה מתכנן שלוש
(`DocVault/files/<docId>/`). התבנית מכלילה — אבל **תיקייה לכל מסמך היא טעות בקנה מידה**:
Drive מתחיל להיחנק בניווט של אלפי תיקיות-בת, וכל `_tripFolder`-כמותה עושה איטרציה
לינארית על כל הילדים. עדיף `DocVault/files/` שטוח, עם `docId` כקידומת בשם הקובץ.
אם אתה חייב היררכיה — לפי סוג מסמך או לפי שנה, לא לפי מסמך.

**3. `drive.file` ואיפוס דפדפן — התשובה החלופית שאתה כן צריך:** אם אתה נשאר על OAuth,
`drive.file` **לא** יראה את התיקייה שיצרת בהתקנה קודמת אחרי איפוס. הפתרון המקובל הוא
`appDataFolder` (scope `drive.appdata`) לשמירת ה-`folderId` — הוא נשמר בחשבון, לא בדפדפן,
והאפליקציה תמיד רואה אותו. שילוב של `drive.file` לקבצים + `drive.appdata` למצביע נותן
את מה שהמרקר נותן לנו, בלי scope רחב.

**4. טוקן ופופאפ:** לא רלוונטי — יש טוקן סטטי שהמשתמש מדביק פעם אחת בהגדרות
(`bridgeUrl` + `bridgeToken`, מקומיים למכשיר). לעולם אין פופאפ.

**5. גודל מקסימלי:** אין resumable — העלאה אחת, בגוף JSON, ב-base64. התקרה המעשית היא
מגבלת Apps Script (~50MB לתשובה, ובפועל הרבה פחות בגלל ניפוח base64 של ~33% וזיכרון
ה-`URLFetch`). מסמכי נסיעות (PDF, צילומים) יושבים הרבה מתחת לזה, ולכן לא השקענו.
**אצלך, אם המשתמש מעלה סריקות של 20MB, זה יישבר.** תגביל בצד הלקוח ותציג שגיאה ברורה.

---

## צופה מסמכים

### Q8 — צופה PDF ותמונה

**2. איך PDF מוצג: pdf.js, self-hosted, רינדור ל-`<canvas>` — לא iframe, לא embed.**
זו הכרעה שנלמדה בכאב, ובדיוק בגלל הבעיה שהעלית בסעיף 5. `blob:` ב-`<iframe>` ב-iOS Safari
לא עובד באופן אמין, ו-`<embed>` מציג viewer מערכתי שאין עליו שליטה. `pdf.js` על canvas
עובד זהה בכל פלטפורמה **וגם אופליין** — וזה הרציונל שמצדיק את המחיר.

pdf.js נטען סינכרונית ב-`index.html` (`<script src="lib/pdfjs/pdf.min.js"></script>`,
שורה 30), **ומוכל ב-precache של ה-SW** — כולל ה-worker וגופני התחליף:

```js
const CORE = [
  './', './index.html', './css/style.css', './manifest.json', './version.json',
  ...
  // pdf.js is self-hosted and precached so tickets open with no signal; the
  // worker and substitute fonts load lazily, so runtime caching isn't enough
  './lib/pdfjs/pdf.min.js', './lib/pdfjs/pdf.worker.min.js',
  ...['FoxitDingbats', 'FoxitFixed', 'FoxitFixedBold', 'FoxitFixedBoldItalic', 'FoxitFixedItalic',
    'FoxitSerif', 'FoxitSerifBold', 'FoxitSerifBoldItalic', 'FoxitSerifItalic', 'FoxitSymbol']
    .map(f => `./lib/pdfjs/standard_fonts/${f}.pfb`),
  ...['Regular', 'Bold', 'Italic', 'BoldItalic'].map(f => `./lib/pdfjs/standard_fonts/LiberationSans-${f}.ttf`),
  // cmaps (CJK PDFs) are rare — served same-origin and runtime-cached on first use
];
```

**זו התשובה הכי שימושית שיש לי עבורך בכל המסמך הזה:** גופני התחליף חייבים precache
מפורש. הם נטענים **עצלה** בתוך pdf.js, ולכן runtime caching לא תופס אותם — הכרטיס ייפתח
אופליין עם אותיות חסרות ואתה תחפש את הבאג בפרסר.

**1. הפונקציה במלואה** (`js/ui.js`). קודם זיהוי ה-mime, שהוא חצי מהעבודה בפועל, כי
צרופות Gmail מגיעות כ-`application/octet-stream`:

```js
  const EXT_MIME = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', html: 'text/html', htm: 'text/html',
    eml: 'message/rfc822',
  };
  function docMime(doc, blob = doc.blob) {
    let mt = (doc.mimeType || blob?.type || '').split(';')[0].trim().toLowerCase();
    if (!mt || mt === 'application/octet-stream' || mt === 'binary/octet-stream')
      mt = EXT_MIME[(doc.fileName || '').split('.').pop().toLowerCase()] || mt;
    return mt;
  }

  /* --- fullscreen document viewer --- */
  const viewer = {
    async open(doc) {
      const v = document.getElementById('viewer');
      document.getElementById('viewer-title').textContent = doc.fileName || 'מסמך';
      const body = document.getElementById('viewer-body');
      body.innerHTML = '<div class="flex justify-center py-16 text-slate-400">טוען…</div>';
      v.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');

      let blob = doc.blob;
      if (!blob && doc.driveFileId && window.G) {
        try { blob = await G.drive.downloadBlob(doc.driveFileId); doc.blob = blob; await DB.putRaw('documents', doc); }
        catch (e) { body.innerHTML = emptyState('cloud', 'המסמך בדרייב וטרם הורד למכשיר', 'התחברו ל-Google וסנכרנו כדי לצפות'); return; }
      }
      if (!blob) { body.innerHTML = emptyState('doc', 'אין קובץ לתצוגה'); return; }

      const dl = document.getElementById('viewer-download');
      dl.onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = doc.fileName || 'document';
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };

      const mt = docMime(doc, blob);
      if (mt.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<img src="${url}" class="max-w-full mx-auto rounded-xl shadow-md">`;
      } else if (mt === 'application/pdf') {
        await renderPdf(blob, body);
      } else if (mt.startsWith('text/')) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<iframe src="${url}" sandbox="" class="w-full bg-white rounded-xl" style="height:75vh"></iframe>`;
      } else if (mt === 'message/rfc822') {
        await renderEml(blob, body);
      } else {
        body.innerHTML = emptyState('doc', 'לא ניתן להציג קובץ מסוג זה', 'ניתן להוריד אותו בכפתור למעלה');
      }
    },
    close() {
      document.getElementById('viewer').classList.add('hidden');
      document.getElementById('viewer-body').innerHTML = '';
      document.body.classList.remove('overflow-hidden');
    },
  };
```

והרינדור:

```js
  // PDFs with non-embedded fonts (e.g. bare Helvetica) render with missing
  // glyphs unless pdf.js is given its substitute font files; CJK/Hebrew CID
  // fonts likewise need the cMaps.
  const PDF_OPTS = {
    standardFontDataUrl: 'lib/pdfjs/standard_fonts/',
    cMapUrl: 'lib/pdfjs/cmaps/',
    cMapPacked: true,
  };

  async function renderPdf(blob, container) {
    try {
      const data = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data, ...PDF_OPTS }).promise;
      container.innerHTML = '';
      const pages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const scale = Math.min(2, (container.clientWidth || 360) / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.className = 'w-full rounded-xl shadow-md mb-4 bg-white';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        // the app is dir=rtl, and canvas contexts inherit it — flipping fillText
        // anchoring so pdf.js paints glyph runs shifted and the PDF's clip rects
        // cut them off (missing letters). PDFs are always laid out explicitly.
        ctx.direction = 'ltr';
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      }
    } catch (e) {
      console.error(e);
      container.innerHTML = emptyState('doc', 'שגיאה בפתיחת ה-PDF');
    }
  }
```

**`ctx.direction = 'ltr'` הוא באג-אמת שעלה לנו שעות, והוא רלוונטי לך ישירות** — כל
אפליקציה `dir="rtl"` שמרנדרת PDF ל-canvas תסבול ממנו: ה-context יורש RTL מה-DOM,
`fillText` מעגן לצד השני, ו-clip rects של ה-PDF חותכים אותיות. הסימפטום נראה כמו
"PDF פגום", לא כמו באג RTL. **פורט את השורה הזאת ואת ההערה שמעליה.**

**3. ניהול `blob:` URL — כאן אנחנו לא טובים, אל תפורט:** `URL.revokeObjectURL` נקרא
**רק** בכפתור ההורדה (`setTimeout(..., 5000)`). ה-URL של התמונה, של ה-`text/*` ושל ה-eml
**דולפים** — `close()` מנקה `innerHTML` אבל לא מבטל את ה-URL-ים. בדיוק הדליפה השקטה
שתיארת. **התיקון הנכון** (עשה אותו אצלך מהיום הראשון): החזק `let _urls = []`, דחוף אליו
כל `createObjectURL`, ו-`close()` יעשה `_urls.forEach(URL.revokeObjectURL); _urls = []`.
canvas ב-pdf.js לא סובל מזה כלל — עוד נקודה לטובת pdf.js על iframe.

**4. זום ופאן בתמונה: אין. `<img class="max-w-full">` בלבד** — זום ההצמדה של הדפדפן
ותו לא. (ה-`av-zoom` שאולי ראית ב-`ui.js` הוא חותך אווטרים, לא הצופה.)
**אתה צודק שזה חסר**, ואצלך זה חמור יותר: קריאת מספר ת״ז מצילום דורשת זום. אנחנו נפטרנו
מזה כי כרטיס טיסה נקרא בגודל מלא. אם אתה בונה זום — `touch-action: none` + `pointerdown/move`
עם מטריצת `transform` היא כ-40 שורות, ואל תשכח שהאפליקציה RTL: התחל מ-`transform-origin: center`
ואל תניח שכיוון ה-`scrollLeft` חיובי.

**5. iOS Safari:** ראה סעיף 2 — לא נתקלנו בבעיה כי אנחנו לא משתמשים ב-`blob:` ב-iframe
עבור PDF. **כן** נשארה חשיפה ב-`text/*` וב-eml, שם אנחנו כן משתמשים ב-iframe עם
`sandbox=""` — שם זה עובד כי התוכן טקסטואלי ו-Safari לא מנסה להפעיל plugin viewer.

---

## RTL ומצבי ריק

### Q9 — דפוס בידוד bidi

**התשובה הכנה: אין אצלנו פונקציית עטיפה, ואין `<bdi>` בכלל.**
חיפוש על כל בסיס הקוד מחזיר אפס מופעים של `<bdi>`. הדפוס בפועל הוא `dir="ltr"` ידני על
האלמנט, בנקודת השימוש. אין קנון לפורט כאן — יש דפוס, ואני מוסר אותו ככזה.

**2. מה כן קיים:** `dir="ltr"` על `<span>` או ישירות על ה-`<input>`, ואף פעם לא תווי
בקרה של יוניקוד. הנימוק נגד `U+2066`/`U+2069`: הם בלתי-נראים במקור, ניצודים ב-`grep`
בקושי, ו-`UI.esc()` לא נוגע בהם — כלומר הם נוסעים בשקט לתוך ערכים שנשמרים ב-DB
ומגיעים משם ל-Gemail/Gemini. תו נראה במקור עדיף על תו בלתי-נראה בנתונים.

דוגמאות ורבטים:

```js
// js/trips.js:427 — סכום כספי
`<span class="font-bold text-slate-700 text-sm shrink-0" dir="ltr">${UI.fmtMoney(x.amount, UI.normCur(x.currency))}</span>`

// js/itinerary.js:195 — קוד הזמנה
`<span dir="ltr">PNR ${UI.esc(x.confirmation)}</span>`

// js/settings.js:26 — קלט של URL
`<input id="st-bridge-url" class="tn-input text-xs" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${UI.esc(bridgeUrl || '')}">`

// js/trips.js:338 — פס התקדמות; RTL הופך את כיוון המילוי
`<div class="h-1.5 rounded-full bg-slate-100 overflow-hidden" dir="ltr">`
```

**1. הפונקציה היחידה שכן ראויה להיקרא "פורמטר":**

```js
  const fmtMoney = (n, cur = '₪') => `${cur} ${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
```

**3. ערך מעורב: לא מטופל.** אין לנו IBAN ואין לוחיות רישוי. `dir="ltr"` על מחרוזת
מעורבת עברית-לטינית **ישבור אותה** — העברית תיזרק לסוף. **ההמלצה שלי אליך, וזו סטייה
שאני חושב שכדאי לך לעשות:** `<bdi>` בלי `dir` כלל (כלומר `dir="auto"` שהוא ברירת המחדל
של `bdi`) הוא הכלי הנכון לערך מעורב — הוא **מבודד** את הערך מהסביבה בלי לכפות עליו כיוון,
וזה בדיוק ההבדל בין "בידוד" ל-"כפייה". השתמש ב-`dir="ltr"` רק לערך שאתה **יודע** שהוא
לטיני-בלבד (מספר דרכון, IBAN, PNR, סכום), וב-`<bdi>` נקי לכל דבר שמגיע מהמשתמש.

**4. תאריכים: יש פורמטרים ייעודיים, ובכוונה הם מוציאים עברית ולא `DD/MM/YYYY`** — וזה
פותר את הבעיה בשורש במקום להילחם בה:

```js
  const toDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = (iso) => { if (!iso) return ''; const d = toDate(iso); return `${d.getDate()} ב${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtDateShort = (iso) => { if (!iso) return ''; const d = toDate(iso); return `${d.getDate()} ${MONTHS_S[d.getMonth()]}`; };
  const fmtDayHeader = (iso) => { const d = toDate(iso); return `יום ${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`; };
  function fmtDateRange(a, b) {
    if (!a) return '';
    if (!b || a === b) return fmtDate(a);
    const da = toDate(a), db_ = toDate(b);
    if (da.getMonth() === db_.getMonth() && da.getFullYear() === db_.getFullYear())
      return `${da.getDate()}–${db_.getDate()} ב${MONTHS[da.getMonth()]} ${da.getFullYear()}`;
    return `${da.getDate()} ${MONTHS_S[da.getMonth()]} – ${db_.getDate()} ${MONTHS_S[db_.getMonth()]} ${db_.getFullYear()}`;
  }
```

**"12 באוגוסט 2026" הוא טקסט עברי ולא נשבר ב-RTL. `12/08/2026` נשבר.** זו ההכרעה:
תאריך תצוגה בעברית מילולית, `YYYY-MM-DD` ב-DB בלבד. שים לב גם ל-`toDate` — **פירוק ידני
ולא `new Date(iso)`**, כי `new Date('2026-08-12')` נקרא כ-UTC וקופץ יום אחורה באזורי זמן
שליליים. עוד באג שקט ששווה לך לפורט.

### Q10 — ה-markup של מצב ריק

**יש לנו שני דפוסים שונים, וזו לא עקביות מכוונת — זו התפתחות.** אני מוסר את שניהם ומסמן
מי הנכון.

**(א) `UI.emptyState` — מצב ריק פסיבי, בלי פעולה, בלי מסגרת** (`js/ui.js`). זה מה שרוב
המסכים משתמשים בו:

```js
  /* accepts an ICONS name (preferred) or a literal emoji fallback */
  const emptyState = (ico, msg, sub = '') => `
    <div class="flex flex-col items-center justify-center py-10 text-center">
      ${ICONS[ico]
        ? `<div class="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">${icon(ico, 'w-7 h-7')}</div>`
        : `<div class="text-4xl mb-3">${ico}</div>`}
      <div class="text-slate-500 font-medium">${esc(msg)}</div>
      ${sub ? `<div class="text-slate-400 text-sm mt-1">${esc(sub)}</div>` : ''}
    </div>`;
```

**(ב) ה-hero הריק במסך הבית — מצב ריק כהזמנה, המסגרת המקווקוות והפעולה בתוכה**
(`js/app.js:34`). זה הדפוס שתיארת ב-§10, וזה **הנכון**:

```js
    async renderHero(next) {
      const el = document.getElementById('home-hero');
      if (!next) {
        el.innerHTML = `
          <button id="hero-empty" class="w-full min-h-[220px] rounded-[2rem] border-2 border-dashed border-slate-200 bg-white/60 flex flex-col items-center justify-center gap-2 text-slate-400 active:scale-[0.98] transition">
            <span class="text-5xl">🏝️</span>
            <span class="font-semibold text-slate-500">אין חופשה מתוכננת</span>
            <span class="text-xs bg-indigo-600 text-white px-4 py-2 rounded-full font-medium mt-1 shadow-md">+ פתיחת מחיצת חופשה</span>
          </button>`;
        document.getElementById('hero-empty').addEventListener('click', () => Trips.editModal());
        return;
      }
```

**המפרט המדויק של המסגרת, כדי שהשתיים ייראו כמשפחה אחת:**
`border-2 border-dashed border-slate-200` · `rounded-[2rem]` · `bg-white/60` ·
`min-h-[220px]` · `active:scale-[0.98] transition` · הפעולה היא pill פנימי
`bg-indigo-600 text-white px-4 py-2 rounded-full shadow-md`.
**כל האלמנט הוא `<button>` יחיד** — לא div עם כפתור בפנים. זה מה שנותן את "הפעולה בתוך
המסגרת": כל השטח לחיץ, ו-`active:scale` מגיב על כל המסגרת.

**מצב `dragover`: אין לנו, בכלל.** האפליקציה היא PWA-first לנייד; אין גרירת קבצים. יש
דפוס קרוב שאולי תרצה — אזור הדבקה (paste) של צילום מסך, `js/documents.js:141`:

```js
<div id="pf-target" contenteditable="true" inputmode="none" class="w-full min-h-24 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-4 text-center text-xs text-slate-400 outline-none flex items-center justify-center">
```

שים לב שכאן המקווקוו **צבעוני** (`indigo`), לא ניטרלי — זה ההבדל בין "מסגרת ממתינה"
ל-"מסגרת שמזמינה פעולה עכשיו". לדפוס `dragover` שלך: התחל ב-`border-slate-200` והחלף
ל-`border-indigo-400 bg-indigo-50` בזמן הגרירה. אותה משפחה ויזואלית בדיוק.

**הערה חשובה על אימוג'ים** — ה-🏝️ ב-hero הוא **חריג היסטורי שאנחנו מוציאים בהדרגה**.
הכלל בפרויקט (`CLAUDE.md`): אלמנטי ממשק משתמשים באייקוני ה-SVG הקוויים של `UI.icon`
בלבד, ואימוג'ים מותרים רק כתוכן שהמשתמש בוחר. **אל תפורט את האימוג'י** — השתמש
במסלול ה-`ICONS` של `emptyState`.

---

## גרסאות

### Q11 — מנגנון הקפצת הגרסה המשולש

**1. שלוש הנקודות המדויקות:**

| קובץ | שורה | המקור |
|---|---|---|
| `sw.js` | 2 | `const CACHE_VERSION = '1.40.2';` |
| `version.json` | 1 | `{ "version": "1.40.2", "date": "2026-07-24" }` |
| `index.html` | 36 | `<script>window._BUNDLE_VERSION = '1.40.2';</script>` |

התפקיד של כל אחת שונה לגמרי, וזה הלב של התשובה:
- `CACHE_VERSION` → מייצר `CACHE_NAME` חדש, ולכן **מבטל את הקאש הישן** ב-`activate`.
- `version.json` → **מקור האמת מהשרת**, נטען network-first, אומר לאפליקציה "יש חדש".
- `_BUNDLE_VERSION` → **מה שרץ עכשיו בדפדפן**, להשוואה מול השרת.

המנוע שמחבר ביניהן (`js/app.js`), עם ההערה שמסבירה למה זה כך:

```js
  /* ---------- app updates (service worker + version.json) ----------
     שכבות הגנה, כי ספארי מכבד את ה-HTTP cache של Pages גם עבור sw.js:
     1. רישום עם updateViaCache:'none' — בלי cache מקומי לסקריפט.
     2. version.json (network-first) הוא מקור האמת; אם הוא חדש וה-SW לא
        מתעדכן — רישום מחדש עם ./sw.js?v=<גרסה>: URL חדש ששום cache
        (מקומי או CDN) לא יכול להגיש ממנו עותק ישן.
     3. עדיין תקוע → "עדכון כפוי": ניקוי caches + רישום מחדש + טעינה.
        הנתונים ב-IndexedDB לא נמחקים אף פעם. */
```

```js
    async check({ manual = false } = {}) {
      try { await this.reg?.update(); } catch { }
      let remote = null;
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        remote = (await res.json()).version;
      } catch { }
      const current = window._BUNDLE_VERSION || '';

      // השרת חדש אבל אין שום התקנה בדרך → עקיפת cache בכוח עם URL ייחודי
      if (remote && remote !== current && this.reg && !this.reg.waiting && !this.reg.installing) {
        try {
          this.reg = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(remote)}`, { updateViaCache: 'none' });
          this._wire();
        } catch { }
      }
```

ובצד ה-SW, מה שהופך את ההקפצה לאפקטיבית:

```js
const CACHE_VERSION = '1.40.2';
const CACHE_NAME = `tripnest-${CACHE_VERSION}`;

self.addEventListener('install', (e) => {
  // cache:'no-cache' — fill the new cache from the server, never from a
  // possibly-stale HTTP cache (Safari serves Pages' max-age=600 copies)
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => Promise.all(CORE.map(u =>
        fetch(u, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(u, r); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
```

**2. מה נשבר בפועל כששוכחים אחת מהשלוש** — לא "קוד ישן מול DB חדש", אלא:

- **שוכחים `sw.js`:** הקובץ `sw.js` **זהה בתוכן** לקודם, ולכן הדפדפן לא מזהה SW חדש
  ולא מריץ `install` כלל. גם אם קובצי ה-JS השתנו בשרת, ה-SW הישן ממשיך להגיש אותם
  **cache-first** מהקאש הישן. **המשתמש לא יראה את העדכון לעולם.** זה הכשל הכי גרוע.
- **שוכחים `version.json`:** `check()` משווה `remote === current` ומחליט שאין עדכון.
  שכבת ההצלה (רישום מחדש עם `?v=`) לא נדלקת. אם ה-SW כן השתנה — העדכון בסוף יגיע
  בדרך הרגילה, אבל מאוחר יותר ובלי באנר. **כשל שקט**, לא חוסם.
- **שוכחים `_BUNDLE_VERSION`:** ההפך — `remote !== current` **תמיד**, גם אחרי עדכון
  מוצלח. האפליקציה תרשום מחדש `sw.js?v=` בכל `visibilitychange` לנצח. לא נשבר, אבל
  רועש ומבזבז רשת.

**IndexedDB לא נוגעים בו אף פעם** — אין קשר בין הגרסה לסכמת ה-DB. סכמת ה-DB יש לה
גרסה משלה (`const VERSION = 2` ב-`db.js`) שרצה דרך `onupgradeneeded`.

**3. ההחלטה שביקשת: לא. לא הייתי בונה את זה ככה שוב — אבל לא בגלל שהמנגנון שגוי.**

המנגנון עצמו נכון: **צריך** שלושה דברים שונים כאן, כי הם אחראים לשלושה תפקידים שונים
(פירוק הקאש, הכרזת השרת, זהות הריצה). מה ששבור הוא ש**המספר נכתב ידנית בשלושה קבצים**.
כל השלישייה הזאת היא בעיית *סנכרון ידני*, לא בעיית ארכיטקטורה, וסנכרון ידני נשכח.

**מה שהייתי עושה במקומך**, לפי סדר עדיפות:

1. **מקור אמת אחד + סקריפט הקפצה.** `version.json` הוא המקור; `npm run bump` (או
   `node tools/bump.mjs` — אין לך build, אבל node לסקריפט זה בסדר) קורא אותו,
   מעלה patch, וכותב ב-`sed` את שתי הנקודות האחרות. **זה מה שהיינו עושים אילו התחלנו
   היום** — 15 שורות, ומבטל את מחלקת התקלות כולה.
2. **בדיקת עקביות ב-CI (או ב-pre-commit hook)**: שלוש grep, השוואה, `exit 1` אם לא זהות.
   זול עוד יותר מסעיף 1 ותופס את השכחה גם כשמישהו עורך ידנית. אם אתה עושה רק דבר אחד —
   עשה את זה.
3. **`_BUNDLE_VERSION` אפשר לחסל לגמרי:** במקום קבוע ב-HTML, ה-SW יכול לענות על
   `/__version` מתוך `CACHE_VERSION` שלו, והאפליקציה תשאל אותו. זה מוריד לשתי נקודות.
   **לא הייתי מתחיל מזה** — זה מוסיף תלות ב-SW פעיל בדיוק במסלול שאמור לאבחן SW תקוע.

**מה שכן שווה שכפול בלי שינוי:** שלוש שכבות ההגנה ב-`Updater` (`updateViaCache:'none'`,
רישום מחדש עם `?v=`, ועדכון כפוי) ו-`fetch(u, { cache: 'no-cache' })` ב-`install`.
כולן נכתבו נגד באגים אמיתיים של Safari מול GitHub Pages, ואתה מגיש מאותו מקום.

---

## גבול הדרכונים

### Q12 — רשומת דרכון ב-vault של נאביגו

**1. הסכמה — ורבטים משתי נקודות הכתיבה** (`js/vault.js`). ה-store הוא `vault`,
`keyPath: 'id'`, אינדקס על `memberId`:

```js
          await DB.putRaw('vault', {
            id: DB.uid(), memberId: member.id, blob: r.f, mimeType: r.f.type,
            expiryDate: r.p?.expiryDate || null, passportNumber: r.p?.passportNumber || null, createdAt: Date.now(),
          });
```

```js
          await DB.putRaw('vault', {
            id: DB.uid(), memberId, blob: f, mimeType: f.type,
            expiryDate: document.getElementById('vc-expiry').value || null, createdAt: Date.now(),
          });
```

**שמות המפתחות שביקשת במפורש: `passportNumber` (מחרוזת או `null`) ו-`expiryDate`
(`'YYYY-MM-DD'` או `null`).** `expiryDate` מגיע או מ-MRZ או מהזנה ידנית של המשתמש
בשדה `<input type="date">` — ולכן הפורמט זהה בשני המסלולים.
שים לב ש-`passportNumber` **נשמר רק במסלול הרב-קבצי**; במסלול `capture()` (צילום בודד)
הוא לא נשמר כלל. אי-עקביות מוכרת.

**2. כן, לנאביגו כבר יש התרעת תפוגה על דרכונים** — והיא מתוחכמת יותר מ"התראה לפני X ימים",
כי היא נגזרת מתאריך הטיול (כלל ששת החודשים):

```js
  // passport expiry alerts for a trip's actual travelers (device-local knowledge)
  async function alertsForTrip(trip) {
    const out = [];
    const shots = await DB.allRaw('vault');
    const members = await DB.all('members');
    for (const mid of (trip.memberIds || [])) {
      const m = members.find(x => x.id === mid);
      if (!m) continue;
      const withExpiry = shots.filter(v => v.memberId === mid && v.expiryDate);
      for (const v of withExpiry) {
        const sixMonthsAfterTrip = new Date(UI.toDate(trip.endDate || trip.startDate));
        sixMonthsAfterTrip.setMonth(sixMonthsAfterTrip.getMonth() + 6);
        if (UI.toDate(v.expiryDate) < sixMonthsAfterTrip)
          out.push({ level: UI.toDate(v.expiryDate) < UI.toDate(trip.startDate) ? 'error' : 'warning', text: `הדרכון של ${m.nameHe} בתוקף עד ${UI.fmtDate(v.expiryDate)} — פחות מ-6 חודשים אחרי "${trip.name}"` });
      }
    }
    return out;
  }
```

וגם תגית תפוגה ויזואלית ברשימת הכספת:

```js
  function expiryClass(expiry) {
    const months = (UI.toDate(expiry) - new Date()) / (86400000 * 30.4);
    if (months < 6) return 'bg-red-600 text-white';
    if (months < 12) return 'bg-amber-500 text-white';
    return 'bg-black/60 text-white';
  }
```

**ההכרעה שאני מבקש: כבה את התרעת תפוגת הדרכון אצלך.** לא מסיבת נימוס — מסיבה מהותית:
ההתרעה שלנו קשורה ל**טיול קונקרטי** (`trip.endDate + 6 חודשים`), ואת הטיולים אתה לא
מחזיק. התרעה גנרית "הדרכון פג בעוד 6 חודשים" תירה גם כשאין שום נסיעה מתוכננת, תתנגש
עם ההתרעה שלנו, ותאמן את המשתמש להתעלם משתיהן. אם אתה כן רוצה נוכחות — הצג את התפוגה
כ**עובדה** בכרטיס (תגית `expiryClass` בדיוק כמו שלנו, שלוש הרמות), בלי התראה יזומה.

**3. כן, נאביגו שומרת גם את הסריקה** — `blob: r.f` הוא קובץ התמונה המלא, ב-IndexedDB.
זה בדיוק מה ש"מטא-דאטה בלבד" אצלך מוותר עליו, וטוב שכך. הבידוד אצלנו מוחלט ומאוכף
בשלוש נקודות נפרדות, וזו ההתחייבות שאתה יכול להסתמך עליה:

```js
// db.js — vault אינו ב-SYNC_STORES ולכן לא נכנס ל-db.json
const SYNC_STORES = ['trips', 'documents', 'events', 'checklists', 'expenses', 'members'];

// db.js — ולא בגיבוי המקומי
/* --- local backup (vault excluded: passport photos never leave the device) --- */

// google.js — ומסמך שסווג passport לא עולה לדרייב גם מחוץ לכספת
if (doc.category === 'passport') continue; // passports never reach Drive
```

**מה שאני כן צריך ממך בגבול הזה:** אל תשמור אצלך `passportNumber` בכלל, גם לא חלקי,
גם לא 4 ספרות אחרונות. `expiryDate` + `memberId` מספיקים לתזכורת, ומספר דרכון בקובץ
מסונכרן הוא בדיוק הדבר שהארכיטקטורה שלנו נבנתה למנוע. `allowFiles: false` ל-`passport`
ב-`DOC_TYPES` — הכרעה נכונה, תודה.

---

## מה שלא נשאל ואני מוסר בכל זאת

שלושה דברים שיעלו לך זמן אם לא תדע אותם מראש:

1. **`toDate` ידני, לא `new Date(iso)`** — ראה Q9 §4. `new Date('2026-08-12')` הוא UTC
   וקופץ יום אחורה. זה יופיע אצלך כ"התוקף מוצג יום לפני".
2. **`ctx.direction = 'ltr'` ב-canvas** — ראה Q8. באפליקציית RTL זה נראה כמו PDF פגום.
3. **גופני התחליף של pdf.js חייבים precache מפורש** — ראה Q8 §2. runtime caching
   לא תופס אותם כי pdf.js טוען אותם עצלה.
