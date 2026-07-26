# BRIEF — Navigo (TripNest)
עודכן: 2026-07-26 | commit: 5d3a6cd

## 1. מטרה
PWA משפחתי לניהול חופשות: מחיצה לכל טיול עם מסמכים, ציר זמן, צ׳ק-ליסטים, תקציב ותכנון אוכל.
קהל היעד: זוג הורים + ילדים; שני בני הזוג מסונכרנים דרך תיקיית Google Drive משותפת.
פלטפורמה עיקרית: דפדפן מובייל (iOS Safari / Android Chrome) כאפליקציה במסך הבית, offline-first.
אין שרת אפליקציה — כל הנתונים במכשיר (IndexedDB) ובדרייב של המשתמש (`README.md`, `manifest.json`).
ממשק עברית RTL בלבד.

## 2. סטאק

| רכיב | פרט |
|---|---|
| שפה | Vanilla JavaScript (ES2020+), ללא build ו-ללא package.json |
| מבנה מודולים | IIFE → `window.X`, נטענים לפי סדר סקריפטים ב-`index.html` |
| UI | Tailwind CSS מ-CDN (`cdn.tailwindcss.com`, ללא pin) + `css/style.css` (115 שורות) + פונט Rubik מ-Google Fonts |
| אחסון מקומי | IndexedDB `TripNestDB` v2 (`js/db.js`) |
| Offline | Service Worker `sw.js`, cache `tripnest-1.40.2`, precache של shell + pdf.js |
| PWA | `manifest.json` (standalone, rtl, he), אייקונים 192/512/180 |
| AI | Google Gemini REST `v1beta/models/*:generateContent` (`js/gemini.js`) |
| Backend/Integrations | Google Apps Script web-app (`bridge/bridge.gs`, `BRIDGE_VERSION = '1.4.0'`) |
| PDF | pdf.js self-hosted v3.11.174 (`lib/pdfjs/`) |
| OCR | Tesseract.js 5 — lazy מ-`cdn.jsdelivr.net` (`js/mrz.js:88`) |
| טסטים | Node ESM, ללא framework — `tests/smoke.mjs` (29 בדיקות) |
| Hosting | GitHub Pages מ-branch `main` / root |
| גרסה | `version.json` = 1.40.2 (2026-07-24), חייבת להתאים ל-`sw.js` ול-`_BUNDLE_VERSION` |

## 3. מפת ארכיטקטורה
```
index.html        SPA יחיד — כל ה-views ב-DOM, הצגה/הסתרה ב-class hidden
sw.js             Service Worker (שורש = scope), precache + עקיפת hosts חיצוניים
js/               15 מודולים גלובליים, סדר הטעינה = גרף התלות
  db.js           IndexedDB + מיזוג סנכרון + גיבוי/שחזור
  ui.js           רכיבים משותפים: modal, toast, icon (SVG קווי), פורמט תאריך/כסף
  gemini.js       לקוח Gemini + מפל מודלים + פרומפט חילוץ מסמכים
  mrz.js          קריאת MRZ של דרכון — OCR מקומי בלבד
  google.js       לקוח הגשר: Drive, Gmail, מנוע ה-Sync (G.Sync)
  archive.js      ארכיון שיחות הסוכן (IndexedDB + מראה בדרייב)
  members.js / vault.js / documents.js / food.js / itinerary.js / trips.js
  agent.js        סוכן ה-AI: persona, TOOLS, קונטקסט, זיכרון, סיכומי טיול
  settings.js     מסך הגדרות (גשר, Gemini, אוכל, פרטיות, גיבוי, עדכון גרסה)
  app.js          אתחול, ניווט (home/trips/trip/agent/settings), באנר עדכון
bridge/bridge.gs  Apps Script — מודבק ידנית אצל המשתמש, לא נטען מהאתר
lib/pdfjs/        pdf.js self-hosted (cmaps + standard_fonts)
tests/smoke.mjs   mock מלא של שני גשרים מול js/google.js
docs/design-prompt.md  רפרנס העיצוב המחייב
```
זרימת מידע: UI → `DB.put(store, rec)` (מוסיף `id` + `updatedAt`) → אירוע `tn-data-changed` לרענון →
`G.Sync.queue()` → `dbGet` מהגשר → `DB.mergeSync(remote)` לפי `updatedAt` עם tombstones → `dbPut` חזרה.
blobs של מסמכים לא נכנסים ל-`db.json`: הם מועלים כקבצים לתת-תיקיית טיול (`G.Sync`, `js/google.js:164`).

## 4. מודל נתונים
Object stores ב-`TripNestDB` (`js/db.js`):
- **מסונכרנים** (`SYNC_STORES`): `trips`, `documents`, `events`, `checklists`, `expenses`, `members`.
- **מקומיים למכשיר בלבד**: `vault` (צילומי דרכון), `settings` (keyPath `key`), `archive` (תורות שיחה).

ישויות ושדות מפתח (שמות בלבד):
- `trips`: id, name, destination, startDate, endDate, coverEmoji, cover, budget{total, byCat}, travelers[], updatedAt, deleted
- `documents`: id, tripId, fileName, category (flight|stay|car|insurance|visa|attraction|receipt|passport|other), blob (מקומי), driveFileId, extracted{}, emailMeta{}, updatedAt
- `events`: id, tripId, docId, date, time, type (flight|checkin|checkout|activity|deadline|food), title, place, notes, mealSlot, computed
- `checklists`: id, tripId, title, items[{id, text, done}]
- `expenses`: id, tripId, eventId, docId, title, amount, currency, category, date
- `members`: id, nameHe, nameEn, birthDate, avatar, sortOrder
- `vault`: id, memberId, blob, expiryDate, passportNumber (לעולם לא יוצא מהמכשיר)
- `archive`: id, ts, tripId|null, role (user|model), text

קשרים: trip 1—N documents/events/checklists/expenses (index `tripId`); event↔expense דו-כיווני
(`eventId`/`docId`); document → events מוצעים אחרי חילוץ AI; member ↔ vault לפי `memberId`;
trip.travelers[] מפנה ל-member.id.

הגדרות משותפות (נוסעות ב-`db.json` תחת `shared`): keywords, negKeywords, agentPersona, agentNotes,
agentTripSummaries, foodProfile, foodFavorites. כל השאר (מפתחות, כתובות גשר, `agentHistory`, PIN) מקומי.

## 5. שכבת AI
**מודלים** (`js/gemini.js:11`): מפל `['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite']`,
ניתן לדריסה ב-`DB.settings.geminiModels` מתוך מסך ההגדרות. המפתח נשלח בכותרת `x-goog-api-key` בלבד.

**מיקום הפרומפטים** (כולם inline בקוד, אין תיקיית prompts):
- `js/gemini.js` — `EXTRACT_PROMPT`: חילוץ מסמכי נסיעה ל-JSON (טיסות, צ׳ק-אין, סכומים, דרכון).
- `js/agent.js` — `DEFAULT_PERSONA` ("נסטו" 🦉), `MEMORY_RULES`, `MAPS_RULES`, `TOOLS` (11 כלים),
  `buildContext()` (טיולים/בני משפחה/מסמכים/הוצאות), פרומפט סיכום טיול ב-`summarizeTrip()`.
- `js/food.js` — הצעות מסעדות לפי `foodProfile` + `foodFavorites`.

**פיצ׳רים תלויי AI**: חילוץ נתונים ממסמך/תמונה/PDF והצעת אירועים לציר הזמן; צ׳אט הסוכן עם
function-calling (add_event, update_event, delete_event, create_checklist, add_checklist_items,
set_document_category, add_expense, delete_expense, remember_note, forget_note, search_archive);
זיכרון בשלוש שכבות (זיכרון משפחה / זיכרון טיול + סיכומים / ארכיון שיחות בחיפוש); תכנון ארוחות.

**אישורים**: כל כלי דורש אישור משתמש חוץ מ-`AUTO_TOOLS = {search_archive}` (קריאה בלבד).

**שגיאות ועלויות**: fallback למודל הבא רק על 429/503/404/RESOURCE_EXHAUSTED/UNAVAILABLE/NOT_FOUND;
כל שגיאה אחרת נזרקת מיד עם הודעה בעברית. אין ניטור עלות/טוקנים בקוד — המפתח הוא של המשתמש
(Gemini free tier לפי README). בקרת עלות עקיפה: חלון שיחה של 40 תורות, השאר עובר לארכיון;
טקסט מסמך נחתך ל-14,000 תווים; `temperature` 0.1 לחילוץ, 0.35 לצ׳אט. אבחון: `Gemini.testModels`.

## 6. אינטגרציות חיצוניות

| שירות | תפקיד | חובה/אופציונלי |
|---|---|---|
| Google Apps Script bridge (`bridge/bridge.gs`) | Drive + Gmail בשם המשתמש; פעולות: ping, createFolder, findShared, shareFolder, dbGet, dbPut, fileGet, filePut, upload, download, gmailSearch, gmailGet, gmailAttachment | חובה לסנכרון ולסריקת מייל; האפליקציה עובדת מקומית בלעדיו |
| גשר שני (בן/בת הזוג) | סריקת תיבת מייל נוספת; מזהי הודעות בקידומת `p:`, ניתוב ב-`G.gmail._route` | אופציונלי |
| Google Drive | `tripnest-db.json` + blobs לפי טיול + `chat-archive-<key>.json` | חובה לסנכרון בין מכשירים |
| Gmail | סריקה לפי תווית `navigo` (ברירת מחדל) או מילות מפתח ad-hoc | אופציונלי |
| Gemini API | חילוץ + סוכן | אופציונלי — בלי מפתח האפליקציה עובדת ידנית |
| Google Maps (קישורי `maps.google.com`) | קישורי מקום מהסוכן ומציר הזמן | אופציונלי |
| GitHub Pages | hosting + `version.json` לבדיקת עדכון | חובה לפריסה |
| CDN: tailwindcss, Google Fonts, jsdelivr (Tesseract) | UI ו-OCR | חובה לטעינה ראשונה (לא בprecache) |

**Auth**: אין OAuth ואין חשבונות. הגישה לגשר מוגנת ב-`SECRET_TOKEN` שהמשתמש קובע, נשלח בגוף
בקשת POST כ-simple request (ללא headers, כדי לא להפעיל CORS preflight).

## 7. קונבנציות
- **שמות**: מודול = אובייקט גלובלי ב-PascalCase/אות בודדת (`DB`, `UI`, `G`, `Gemini`, `Agent`, `Trips`,
  `MRZ`, `Archive`). פונקציות פנימיות camelCase; פונקציות "פרטיות" בקידומת `_` (`G.gmail._route`).
  מזהים: `DB.uid()` = `crypto.randomUUID`, fallback ל-base36.
- **State**: אין ספריית state. מקור האמת הוא IndexedDB; משתני מודול (`_activeTab`, `_expFilter`,
  `history`) מחזיקים state של תצוגה. רענון דרך אירועי DOM: `tn-data-changed`, `tn-sync-state`.
- **Styling/UI**: Tailwind utility classes ישירות ב-template strings; מחלקות משותפות
  (`tn-card`, `tn-btn-primary`, `tn-input`, `tn-label`) ב-`css/style.css`. רינדור = בניית HTML
  כמחרוזת + `addEventListener` אחרי ההזרקה. אייקונים: SVG קווי דרך `UI.icon` — לא אימוג׳ים
  באלמנטי ממשק (עדיין קיימים אימוג׳ים בכמה מקומות, ראו סעיף 9).
- **שגיאות**: `throw new Error('...')` בעברית; המודל מציג דרך `UI.toast` / הודעת modal.
  שגיאות רשת של הגשר מוחזרות כ-`{ error }` ומתורגמות ב-`G.call`.
- **טסטים**: קובץ אחד, `test(name, fn)` + `assert(cond, msg)` תוצרת בית, mock מלא של שני גשרים
  (`bridgeState`) מול `js/google.js` האמיתי. הרצה: `node tests/smoke.mjs`. אין CI מוגדר בריפו.
- **גרסאות**: כל commit שמשנה קוד מקפיץ יחד `sw.js` / `version.json` / `index.html`.

## 8. סטטוס

| אזור | סטטוס | בסיס |
|---|---|---|
| טיולים (רשימה, כרטיס, עריכה, סוג טיול) | עובד | `js/trips.js` מלא; קומיטים אחרונים 5d3a6cd/7e01e7c/f653976 |
| מסמכים (העלאה, הדבקה, צפייה, PDF/EML) | עובד | `js/documents.js` (430 שורות), 236b0f5, 099f6a0 |
| ציר זמן + אירועים מחושבים | עובד | `js/itinerary.js`, f69c9d9 |
| צ׳ק-ליסטים | עובד | `js/trips.js:242-320` |
| תקציב והוצאות + זיהוי כפילויות | עובד | `js/trips.js:323-510` |
| בני משפחה + אוואטרים | עובד | `js/members.js`, 0bbccfe |
| כספת דרכונים + MRZ מקומי | עובד | `js/vault.js`, `js/mrz.js`, 6c3e677 |
| סנכרון דרייב דו-כיווני | עובד | `js/google.js` + `DB.mergeSync`, מכוסה ב-smoke |
| סריקת Gmail (שתי תיבות, תווית Navigo) | עובד | `js/google.js:201+`, bba6392, 7fa48a7 |
| חילוץ AI ממסמכים | עובד | `js/gemini.js` + `documents.extractDoc` |
| סוכן AI + כלים + זיכרון | עובד | `js/agent.js` (750 שורות), 407a6e6, faee458 |
| ארכיון שיחות בדרייב | חלקי | דורש גשר ≥1.3.0; עם גשר ישן — מקומי בלבד (`js/archive.js:11`) |
| תכנון אוכל | עובד | `js/food.js`, 7378a2a |
| גיבוי/שחזור + פרופיל חיבורים | עובד | `DB.exportBackup/importBackup`, 081e80a, 4bcf042 |
| מנגנון עדכון גרסה (SW + באנר) | עובד | `js/app.js:140-250`, `sw.js` |
| CI / בדיקות אוטומטיות בענן | לא קיים | אין `.github/workflows` |

## 9. חובות ופערים
מיון לפי חומרה. **אין אף TODO/FIXME/HACK בקוד** (grep על `js/`, `sw.js`, `bridge/`, `tests/` — 0 תוצאות).
1. **תלות CDN ללא pin ובלי precache** — Tailwind (`index.html:24`) ו-Tesseract.js (`js/mrz.js:88`)
   נטענים מ-CDN חיצוני ולא נמצאים ב-`CORE` של ה-SW: אופליין או content-blocker → ממשק בלי עיצוב,
   וזיהוי MRZ שלא עובד. `sw.js:2` מתאר את Tesseract כ-"assets cached by the SW" — לא מדויק.
2. **הגשר דורש פריסה ידנית** — `bridge.gs` v1.4.0 מודבק ידנית ע"י המשתמש; אין דרך לוודא מהאפליקציה
   שהגשר המותקן עדכני מלבד `ping` שמחזיר `version`. פער בין גשר ישן לפיצ׳ר חדש שובר בשקט (ארכיון).
3. **מפתח Gemini ב-IndexedDB ללא הצפנה** — `settings.geminiKey`, וכך גם טוקן הגשר ו-PIN הכספת
   (PIN נשמר כ-SHA-256, `js/vault.js:25`). מוגן רק ברמת origin של הדפדפן.
4. **דריפט תיעודי**: `CLAUDE.md` כותב "10 בדיקות" ב-`tests/smoke.mjs` — בפועל 29;
   README מתאר "גשר v1.3.0" כשהקובץ בריפו הוא 1.4.0.
5. **הקפצת גרסה משולשת ידנית** (`sw.js`, `version.json`, `index.html`) — שכחה של אחד מהם מונעת
   זיהוי עדכון אצל המשתמשים. אין בדיקה אוטומטית שהשלושה מסונכרנים.
6. **אימוג׳ים בממשק בניגוד לקונבנציה שלכם** — למשל `🧠` (`index.html`), `🦉` בכותרת הסוכן,
   `✕`/`⬇` כטקסט ב-modal ובצופה המסמכים, `🗺` ב-`js/food.js:78`.
7. **אין טסטים ל-UI ולמודולים שאינם `google.js`** — `DB.mergeSync`, `Agent.execTool`, `MRZ` נבדקים
   רק דרך שימוש ידני. אין CI.
8. **`cmaps` של pdf.js (כ-200 קבצים) בריפו** ולא ב-precache — נטענים רק בזמן ריצה ל-PDF בCJK.

## 10. שאלות פתוחות
1. האם יש כוונה לפרוס את Tailwind/Tesseract כ-self-hosted (כמו שנעשה ל-pdf.js), או שהתלות ב-CDN מקובלת?
2. האם `bridge.gs` v1.4.0 כבר פרוס בפועל אצל שני בני הזוג, או שהריפו מקדים את הפריסה?
3. מי מלבד שני בני הזוג אמור להשתמש באפליקציה — האם יש תוכנית להפוך אותה למוצר לאחרים?
4. האם יש CI/בדיקות שרצות מחוץ לריפו (למשל אצלך מקומית), או שהכל ידני לפני commit?
5. האם `docs/design-prompt.md` עדיין מחייב, או שהעיצוב התפתח מאז ומסמך הרפרנס לא עודכן?
