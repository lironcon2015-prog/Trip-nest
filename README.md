# המזוודה 🧳 — TripNest

אפליקציית PWA משפחתית לניהול חופשות: מחיצה לכל טיול עם כל המסמכים, תוכנית טיול,
צ׳ק-ליסטים ותקציב — מסונכרן בין שני בני הזוג דרך תיקיית Google Drive משותפת,
עם גשר סריקת Gmail וסוכן AI מבוסס Gemini.

**Vanilla JS · ללא build · IndexedDB · Service Worker · עברית RTL**

## עקרונות פרטיות

- כל הנתונים נשמרים **אצלכם**: במכשיר (IndexedDB) ובתיקיית הדרייב הפרטית שלכם. שום דבר לא עובר דרך שרת של האפליקציה (אין כזה).
- **צילומי דרכון נשמרים במכשיר בלבד** — לא עולים לדרייב, לא נשלחים ל-Gemini, לא נכללים בגיבויים.
- מפתחות ה-API נשמרים מקומית במכשיר.

## הפעלה ראשונה — צ׳ק-ליסט

### 1) GitHub Pages
Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / root → Save.
האפליקציה תעלה ל-`https://<user>.github.io/trip-nest/`.

### 2) פרויקט Google Cloud (פעם אחת, לשני החשבונות)
1. היכנסו ל-[console.cloud.google.com](https://console.cloud.google.com) → צרו פרויקט חדש (למשל `tripnest`).
2. **APIs & Services → Library** → הפעילו: `Google Drive API`, `Gmail API`, `Google Picker API`.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → מלאו שם אפליקציה ואימייל.
   - Scopes: אפשר לדלג (הבקשה נעשית מהאפליקציה).
   - **Test users**: הוסיפו את שתי כתובות ה-Gmail שלכם.
4. **APIs & Services → Credentials**:
   - **Create Credentials → OAuth client ID** → Web application →
     תחת *Authorized JavaScript origins* הוסיפו את כתובת ה-Pages
     (`https://<user>.github.io`) → העתיקו את ה-**Client ID**.
   - **Create Credentials → API key** → מומלץ להגביל ל-Picker API ולכתובת האתר → העתיקו את ה-**API Key**.
5. באפליקציה: הגדרות → חיבור Google → הדביקו Client ID + API Key (בכל מכשיר).

> בזמן שהאפליקציה במצב Testing, גוגל מבקשת אישור הרשאות מחדש בערך פעם בשבוע — זה צפוי.

### 3) מפתח Gemini (חינם)
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key →
הדביקו בהגדרות → סוכן AI. (בכל מכשיר; המפתח לא מסתנכרן.)

### 4) תיקייה משותפת בדרייב
במכשיר הראשון: הגדרות → "➕ יצירה ושיתוף" → הזינו את המייל של בן/בת הזוג.
במכשיר השני: הגדרות → "📂 בחירת תיקייה" → בחרו את התיקייה ששותפה אליכם.

### 5) התקנה על מסך הבית
- **iPhone**: Safari → שיתוף → "הוסף למסך הבית".
- **Android**: Chrome → תפריט ⋮ → "הוספה למסך הבית".

## פיצ׳רים

| | |
|---|---|
| 🧳 מחיצת חופשה | מסמכים, ציר זמן, צ׳ק-ליסטים ותקציב לכל טיול |
| 👨‍👩‍👧‍👦 בני משפחה | אוואטרים, פרופיל (שם עברית/אנגלית, גיל), בחירת נוסעים לכל טיול |
| 🛂 כספת דרכונים | צילום ושמירה **מקומית בלבד**, קוד גישה אופציונלי, התרעות תוקף |
| ✉️ גשר Gmail | סריקה לפי מילות מפתח (עברית/אנגלית, ניתנות לעריכה) וייבוא קבצים |
| ✨ חילוץ AI | Gemini מחלץ טיסות/תאריכים/קודי הזמנה ומציע אירועים לציר הזמן |
| 🦉 סוכן AI | צ׳אט עם אישיות מותאמת, פעולות באישור, כפתורי פעולה מהירים |
| ☁️ סנכרון | דו-כיווני דרך תיקיית דרייב משותפת, offline-first |

## מבנה הפרויקט

```
├── index.html        # מעטפת האפליקציה (SPA יחיד)
├── sw.js             # Service Worker — חייב להישאר בשורש (scope)
├── manifest.json     # PWA manifest
├── version.json      # גרסה נוכחית (לבדיקת עדכונים)
├── css/
│   └── style.css
├── js/               # מודולי האפליקציה (נטענים לפי הסדר ב-index.html)
│   ├── db.js         # IndexedDB
│   ├── ui.js         # רכיבי UI משותפים
│   ├── gemini.js     # קריאות Gemini API
│   ├── google.js     # OAuth, Drive, Gmail
│   ├── members.js    # בני משפחה
│   ├── vault.js      # כספת דרכונים
│   ├── documents.js  # מסמכים
│   ├── itinerary.js  # ציר זמן
│   ├── trips.js      # טיולים
│   ├── agent.js      # סוכן AI
│   ├── settings.js   # הגדרות
│   └── app.js        # אתחול וניווט
├── icons/            # אייקוני PWA
└── docs/             # מסמכי עיצוב ותכנון
```

## פיתוח

```bash
python3 -m http.server 8080   # ואז http://localhost:8080
```

בכל commit שמשנה קוד יש לעדכן יחד: `sw.js` (CACHE_VERSION), `version.json`, `index.html` (`_BUNDLE_VERSION`).
