# תשובות נאביגו — עוזר השיחה (Q1–Q4)

מקור: `lironcon2015-prog/Trip-nest` @ `main`, גרסה `1.40.2`. הרכיבים: `js/agent.js`, `js/gemini.js`.
כל בלוק קוד ורבטים. **החלטה** = הכרעה, לא תיאור.

**ההבדל האחד שממנו נגזר כל השאר:** אתה מבקש מהמודל JSON חופשי ומאמת אותו בעצמך
(`Chat.compile`); אנחנו משתמשים ב-**function calling אמיתי של Gemini** (`tools.functionDeclarations`)
ומריצים **לולאה רב-סבבית** שמזינה בחזרה `functionResponse`. זה נותן לנו סכימה מהצד של ה-API
ושרשור טבעי — אבל **חסר לנו בדיוק מה שיש לך**: שכבת אימות סמנטית לפני הצגה. פירוט בסוף Q1,
כולל חור אמיתי שיש אצלנו ואין אצלך.

---

## Q1 — לולאת השיחה

### התשובה הישירה

- **function calling, לא JSON חופשי.** `payload.tools = [{ functionDeclarations: TOOLS }]`.
- **זה החזיק.** לא נדרש מסלול נסיגה ל"המודל החזיר טקסט במקום קריאה", **כי אצל Gemini זו לא
  שגיאה אלא מצב לגיטימי**: `parts` יכול להכיל טקסט, קריאות, או את שניהם באותו תור. הלולאה
  שלנו קוראת את שניהם בנפרד ויוצאת כשאין קריאות — "טקסט בלבד" הוא פשוט סוף השיחה, לא כשל.
- **"תשובה שאינה JSON תקין" לא קיימת במסלול הצ'אט.** אנחנו לא מפרסרים JSON של מודל:
  `functionCall.args` מגיע כאובייקט מפורסר מה-API. JSON חופשי קיים אצלנו רק במסלולים שאינם
  צ'אט (חילוץ מסמכים, סיכומי טיולים) — שם `responseMimeType: 'application/json'`, ו-
  `JSON.parse` בתוך `try` שמחזיר **`null`** בכישלון, וכל קורא מטפל ב-null כ"נכשל".

### 1. הטרנספורט — `js/gemini.js` (רלוונטי במלואו)

```js
/* TripNest — Gemini API client (key is stored locally in settings, never synced).
   Transport = model cascade: try each model in order, falling back to the next
   on overload/unavailability (429/503/RESOURCE_EXHAUSTED/UNAVAILABLE) and on a
   retired/unknown model name (404/NOT_FOUND — per-model, the next may exist);
   any other error (bad key, safety block) throws immediately — a config error
   will fail on the next model too, so falling back only hides it. */
const Gemini = (() => {
  const API = 'https://generativelanguage.googleapis.com/v1beta/models';
  const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

  async function key() {
    const k = await DB.settings.get('geminiKey');
    if (!k) throw new Error('חסר מפתח Gemini — הוסיפו אותו בהגדרות');
    return k;
  }
  const hasKey = async () => !!(await DB.settings.get('geminiKey'));

  async function models() {
    const stored = await DB.settings.get('geminiModels');
    if (Array.isArray(stored) && stored.length) {
      const cleaned = stored.map(s => String(s || '').trim()).filter(Boolean);
      if (cleaned.length) return cleaned;
    }
    return DEFAULT_MODELS.slice();
  }

  // API key travels in a header, not the query string — URLs get logged
  // by proxies/CDNs; headers don't.
  const post = async (model, apiKey, payload) => fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });

  async function call(payload) {
    const apiKey = await key();
    for (const model of await models()) {
      const res = await post(model, apiKey, payload);
      // Non-JSON error bodies (proxy/HTML 5xx) must not abort the cascade.
      let data = null;
      try { data = await res.json(); } catch { }
      if (res.ok && data) return data;
      const msg = data?.error?.message || `שגיאת API (HTTP ${res.status})`;
      const status = data?.error?.status || '';
      const shouldFallback = res.status === 429 || res.status === 503 || res.status === 404
        || status === 'RESOURCE_EXHAUSTED' || status === 'UNAVAILABLE' || status === 'NOT_FOUND';
      if (!shouldFallback) throw new Error(msg);
    }
    throw new Error('כל המודלים עמוסים כרגע – נסו שוב בעוד דקה');
  }

  const textOf = (data) =>
    (data.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('');

  async function json(prompt, { inlineData = null } = {}) {
    const parts = [{ text: prompt }];
    if (inlineData) parts.push({ inlineData });
    const data = await call({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    const t = textOf(data);
    try { return JSON.parse(t); } catch { return null; }
  }

  // one full chat turn; history = [{role:'user'|'model', parts:[...]}]
  function chat(history, { system, tools } = {}) {
    // low-ish temperature: itineraries and place names are factual work —
    // the fun lives in the persona, not in sampling noise
    const payload = { contents: history, generationConfig: { temperature: 0.35 } };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) payload.tools = [{ functionDeclarations: tools }];
    return call(payload);
  }
```

**מפל המודלים הוא הדבר שהייתי מפציר בך לפורט** גם אם תישאר ב-JSON חופשי: ב-Gemini
החינמי 429/503 הם יומיומיים, ורשימת מודלים עם נפילה לבא בתור הופכת "העוזר מת" ל"העוזר
איטי קצת". שים לב מה **לא** נופל: מפתח שגוי או חסימת בטיחות נזרקים מיד — נפילה עליהם רק
מסתירה תקלת קונפיגורציה מאחורי שלוש קריאות איטיות.

### 2. בניית ה-`contents` — `js/agent.js`

ההיסטוריה **היא** ה-`contents`, ומנוקה משדות מקומיים לפני שליחה:

```js
  let history = [];   // [{role:'user'|'model', parts:[...]}] — persisted in shared settings

  // Gemini rejects unknown fields — strip the local metadata (_ts, _trip) before sending
  const wire = () => history.map(({ role, parts }) => ({ role, parts }));
```

`_ts`/`_trip` הם מטא-דאטה שלנו (חותמת זמן לקיבוץ לפי יום, ושיוך התור לטיול לצורך הארכיון).
**Gemini דוחה שדות לא מוכרים בתוך `contents`** — זה כשל 400 מיידי שקל להתעלם ממנו בשלב
הבנייה, ולכן `wire()` היא פונקציה נפרדת ולא `history` ישירות.

### 3. הלולאה המלאה — `send()`

```js
  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (!(await Gemini.hasKey())) {
      addBubble('model', 'כדי שאוכל לעבוד צריך מפתח Gemini 🔑 — מוסיפים אותו בהגדרות (חינם ב-Google AI Studio).');
      return;
    }
    // leaving search mode: restore the full log before appending the new exchange
    const si = document.getElementById('agent-search-input');
    if (si && si.value) {
      si.value = '';
      document.getElementById('agent-search-bar').classList.add('hidden');
      await render();
    }
    if (quote) { text = `בהקשר להודעה קודמת: «${quote}»\n\n${text}`; clearQuote(); }
    busy = true;
    if (!historyLoaded) await loadHistory();
    const tripTag = await activeTripId(); // partitions this exchange's turns in the archive
    const meta = () => ({ _ts: Date.now(), _trip: tripTag });
    document.getElementById('agent-input').value = '';
    addBubble('user', UI.esc(text));
    history.push({ role: 'user', parts: [{ text }], ...meta() });
    let bubble = addBubble('model', '<span class="text-slate-400">חושב…</span>');

    try {
      const system = await systemPrompt();
      for (let round = 0; round < 6; round++) {
        const data = await Gemini.chat(wire(), { system, tools: TOOLS });
        const content = data.candidates?.[0]?.content;
        if (!content) { bubble.innerHTML = 'לא התקבלה תשובה 🤔'; break; }
        history.push({ ...content, ...meta() });

        const calls = (content.parts || []).filter(p => p.functionCall).map(p => p.functionCall);
        const modelText = Gemini.textOf(data);
        if (modelText) bubble.innerHTML = mdLite(modelText);
        else bubble.remove();
        if (!calls.length) break;

        // read-only tools run without an approval card — just a muted status line
        const autoOnly = calls.every(c => AUTO_TOOLS.has(c.name));
        let approved = true;
        if (autoOnly) {
          addBubble('model', `<span class="text-slate-400 text-xs">${calls.map(c => describeCall(c.name, c.args || {})).join('<br>')}</span>`);
        } else {
          approved = await approvalCard(calls.map(c => ({ name: c.name, args: c.args || {} })));
        }
        const responses = [];
        for (const c of calls) {
          const result = approved ? await execTool(c.name, c.args || {}) : { ok: false, error: 'user rejected the action' };
          responses.push({ functionResponse: { name: c.name, response: { result } } });
        }
        if (approved && !autoOnly) {
          G.Sync.queue();
          document.dispatchEvent(new CustomEvent('tn-data-changed'));
        }
        history.push({ role: 'user', parts: responses, ...meta() });
        bubble = addBubble('model', '<span class="text-slate-400">ממשיך…</span>');
      }
    } catch (e) {
      console.error(e);
      bubble.innerHTML = `<span class="text-red-500">שגיאה: ${UI.esc(e.message)}</span>`;
    } finally {
      // keep the live window bounded, cutting only at a plain-text user turn so
      // functionCall/functionResponse pairs are never split; dropped turns go to
      // the archive instead of vanishing
      if (history.length > 40) {
        let cut = history.length - 30;
        while (cut < history.length && !(history[cut].role === 'user' && history[cut].parts?.some(p => p.text))) cut++;
        await archiveTurns(history.slice(0, cut));
        history = history.slice(cut);
      }
      await saveHistory();
      busy = false;
    }
  }
```

חמש נקודות בלולאה שלא נראות בקריאה ראשונה, וכולן נכתבו אחרי באג:

1. **`for (let round = 0; round < 6; round++)`** — תקרת סבבים קשיחה. בלעדיה מודל שנתקע
   בלולאה (קורא כלי, מקבל שגיאה, קורא שוב אותו כלי) שורף מכסה עד שהמשתמש סוגר את הטאב.
   שש הוא מספר שנבחר אמפירית: שרשרת אמיתית ארוכה אצלנו היא 3 סבבים.
2. **`history.push({ ...content, ...meta() })` לפני הביצוע** — תור המודל נשמר גם אם המשתמש
   ידחה. אחרת ההיסטוריה נשארת עם `functionResponse` בלי ה-`functionCall` שקדם לו, ו-Gemini
   מחזיר 400 בתור הבא.
3. **דחייה חוזרת כ-`functionResponse` ולא כשתיקה:** `{ ok: false, error: 'user rejected the action' }`.
   המודל **לומד מהדחייה** ולרוב מגיב "בסדר, בלי זה — רוצה שאעשה X במקום?". אם פשוט מפסיקים
   את הלולאה, המשתמש נשאר מול כרטיס דחוי בלי מילה. **זה הפרט שהכי הייתי ממליץ לך לאמץ**
   גם בארכיטקטורת ה-JSON שלך: החזר את הדחייה למודל בתור הבא.
4. **`busy` כמנעול תור** — ובנוסף `if (busy) return;` בתוך `render()`, כי ציור מחדש באמצע
   תור (למשל אחרי `tn-data-changed` שנפלט מהכלי עצמו) מוחק את בועת "חושב…" ואת כרטיס האישור
   שממתין ל-`resolve`, וההבטחה נתקעת לנצח.
5. **החיתוך רק בתור-משתמש-טקסטואלי** — ראה Q4.

### מה שיש לך ואין לנו — תשובה כנה

`Chat.compile` **שלך עדיף**. אצלנו הסכימה של `functionDeclarations` מבטיחה טיפוסים, אבל
**אף אחד לא בודק סמנטיקה לפני ההצגה**. הבדיקות היחידות יושבות בתוך `execTool` — כלומר
**אחרי** האישור:

```js
      case 'update_event': {
        const ev = await DB.get('events', args.eventId);
        if (!ev) return { ok: false, error: 'event not found' };
```

וזה עובד ל-`eventId`/`checklistId`/`docId` — אבל **לא ל-`tripId`**:

```js
      case 'add_event': {
        const ev = await DB.put('events', {
          tripId: args.tripId, date: args.date, time: args.time || null, title: args.title,
```

`add_event` ו-`add_expense` מקבלים `tripId` **בלי לוודא שהטיול קיים**. מודל שממציא מזהה
טיול ייצור אצלנו רשומה יתומה שלא תופיע בשום מסך, וגם לא תישלח חזרה לקונטקסט — כלומר באג
שקט לגמרי. זה חוב אצלנו, וזה בדיוק מה ש-`compile` שלך מונע. **אל תוותר עליו כשתעבור ל-function
calling** (אם תעבור) — סכימת טיפוסים היא לא ולידציה.

---

## Q2 — היקף הפעולות

### הרשימה המדויקת: 11 כלים

| שם | סוג | הערה |
|---|---|---|
| `add_event` | יצירה | + `mealSlot`/`area`/`estCost`/`estCur` לאירועי אוכל |
| `update_event` | עדכון | שדות: `date`, `time`, `title`, `notes`, `place` |
| `delete_event` | **מחיקה** | |
| `create_checklist` | יצירה | |
| `add_checklist_items` | עדכון | |
| `set_document_category` | עדכון | **השדה היחיד במסמך שהסוכן יכול לגעת בו** |
| `add_expense` | יצירה | |
| `delete_expense` | **מחיקה** | |
| `remember_note` | יצירה (זיכרון) | עם `tripId` = זיכרון טיול, בלי = זיכרון משפחה |
| `forget_note` | **מחיקה** (זיכרון) | |
| `search_archive` | קריאה בלבד | היחיד ב-`AUTO_TOOLS` — רץ בלי אישור |

```js
  const AUTO_TOOLS = new Set(['search_archive']); // read-only, no approval needed
```

**מה שאין ברשימה חשוב לא פחות ממה שיש:** אין `delete_document`, אין `delete_trip`, אין
`delete_checklist`, אין כלי שנוגע ב-`members`, ואין שום כלי שנוגע ב-`vault`. **החלטה:**
מחיקה מותרת רק על ישויות ש**הסוכן עצמו יכול היה ליצור** (אירוע, הוצאה, פתק). מסמך שהמשתמש
העלה, טיול, ובן משפחה — הסוכן לא מוחק, נקודה. זה גבול פשוט להסביר ולאכוף, והוא מבטל את
כל מחלקת "העוזר מחק לי את כרטיס הטיסה".

### מה עוצר טעות במחיקה

שלושה דברים, ובכנות **אף אחד מהם אינו undo**:

1. כרטיס האישור (Q3) — חובה לחיצה, ואין ברירת מחדל.
2. הגבול לעיל — מוחקים רק אירוע/הוצאה/פתק.
3. `DB.remove` על store מסונכרן **לא מוחק פיזית**, אלא כותב tombstone:
   `{ id, deleted: true, updatedAt }`. זה לא undo — הנתונים אבדו — אבל זה כן אומר שמחיקה
   שגויה מתפשטת בצורה **צפויה** לשני המכשירים במקום להיעלם באחד ולחזור מהשני בסנכרון הבא.

**מה שהייתי עושה אצלך, אם אתה שוקל להוסיף מחיקה:** אל תוסיף. שמור על "אין פעולת מחיקה"
כמו שיש לך היום — ל-DocVault של תעודות זה הכלל הנכון, ואצלנו מחיקת אירוע היא זולה
(אירוע שנוצר בטעות) בעוד שאצלך כל אובייקט הוא תעודה של אדם.

### פעולה שהוספנו ואז הסרנו — כן, אחת, וזו התשובה השימושית ביותר כאן

**לא הסרנו כלי מהרשימה** (ההיסטוריה מראה רק תוספות: `add_expense`/`delete_expense`
ב-`28ed924`, `search_archive` ב-`faee458`). מה שכן **הסרנו זו יכולת בתוך כלי**: היכולת של
המודל לכתוב **מיקום כטקסט חופשי בשדה `notes`**.

מה שקרה בפועל: המודל שם בהערות של אירוע כתובות, קישורי גוגל מפות שהמציא, ולפעמים
`place_id` שנראה תקין ומוביל לשום מקום. שתי גרסאות ניסינו לתקן את זה בצד התצוגה
(`008ea9c` — רינדור קישורים בצ'אט), עד שהבנו שהתיקון הוא **סכימתי, לא תצוגתי**
(`f69c9d9`): הוספנו שדה `place` מובנה, והאפליקציה בונה ממנו כפתור מפות דינמי. הכלל נאכף
בפרומפט:

```js
  const MAPS_RULES = `\n\n--- קישורי גוגל מפות ---
בטקסט צ'אט: כשאתה מזכיר מקום (מסעדה, אטרקציה, מלון, כתובת) או כשמבקשים ממך קישור — תמיד תן קישור דינמי לחיפוש בגוגל מפות בפורמט markdown:
[שם המקום](https://www.google.com/maps/search/?api=1&query=שם+המקום+יעד)
בנה את ה-query מהשם המדויק של המקום + עיר/יעד, עם + או רווחים בין המילים. קישור כזה תמיד עובד ומוביל ישירות לגוגל מפות — אל תמציא place_id, קואורדינטות או קישור לדף מקום ספציפי שאינך בטוח בו. לעולם אל תכתוב כתובת URL כטקסט חשוף בלי לעטוף אותה בקישור markdown של [טקסט](כתובת).
באירועי ציר-הזמן (add_event/update_event): אל תדביק קישור או כתובת URL בשדה notes. במקום זה מלא את שדה place בשם המקום המדויק + יעד או בכתובת המלאה — האפליקציה בונה מזה כפתור "מפות" דינמי על האירוע. השאר את place ריק אם אין מיקום אמיתי, כדי שלא יופיע כפתור מיותר.`;
```

**הלקח שאני מוסר לך כהחלטה:** כל שדה טקסט חופשי שהמודל ממלא הוא מקום שבו הוא ימציא
מבנה. אם יש לערך צורה ידועה (מיקום, מטבע, קוד הזמנה) — תן לו שדה משלו ותן לאפליקציה
לבנות את הייצוג. אצלך זה מתרגם ישירות ל-`setNotes`: זה הכלי שבו המודל ימציא לך פורמטים.

ובאותו רוח, שדה אחד שהמודל **אסור** לו למלא:

```js
            verified: false,  // the family confirms via the Maps link, never the model
```

**"מאומת" הוא סטטוס אנושי.** מודל שיכול לסמן משהו כמאומת יסמן.

### שרשור ומניעת מזהים מומצאים

**כן, המודל משרשר** — וזה בדיוק מה שהלולאה הרב-סבבית קונה. הוא יכול ליצור רשימה ואז
להוסיף לה פריטים, או ליצור אירוע ואז הוצאה מקושרת. המנגנון הוא ש**כל כלי יוצר מחזיר את
המזהה שנוצר**, וזה חוזר למודל כ-`functionResponse`:

```js
        return { ok: true, eventId: ev.id };
        ...
        return { ok: true, checklistId: l.id };
        ...
        return { ok: true, expenseId: x.id };
        ...
        return { ok: true, noteId: n.id };
```

שלוש שכבות מונעות מזהים מומצאים:

1. **כל מזהה שהמודל צריך כבר נמצא בקונטקסט.** `buildContext` שולח `id` לכל טיול, אירוע,
   מסמך, רשימה, הוצאה ופתק (Q4). אין לו סיבה להמציא.
2. **מזהה חדש חוזר אליו מהביצוע**, כך שהסבב הבא עובד על ה-id האמיתי ולא על ניחוש.
3. **בדיקת קיום שמחזירה שגיאה למודל** — לא זורקת, אלא נכנסת ללולאה:
   `if (!ev) return { ok: false, error: 'event not found' };`. בפועל המודל מגיב לזה ומתקן
   את עצמו באותו תור.

השכבה החסרה, כאמור, היא `tripId`. אצלך `compile` סוגר את זה מראש — עדיף.

---

## Q3 — האישור

### שכבת האישור המלאה

```js
  function approvalCard(calls) {
    return new Promise((resolve) => {
      const log = document.getElementById('agent-log');
      const el = document.createElement('div');
      el.className = 'self-end bg-indigo-50 rounded-2xl p-4 text-sm max-w-[90%] w-full ring-1 ring-indigo-100';
      el.innerHTML = `
        <div class="text-xs font-bold text-indigo-500 mb-2">הסוכן מבקש לבצע:</div>
        <div class="space-y-1.5 mb-3">${calls.map(c => `<div class="text-slate-700 text-[13px]">${describeCall(c.name, c.args)}</div>`).join('')}</div>
        <div class="flex gap-2">
          <button class="ac-yes flex-1 bg-indigo-600 text-white py-2 rounded-xl text-sm font-medium active:scale-95">✓ אישור</button>
          <button class="ac-no flex-1 bg-white text-slate-500 py-2 rounded-xl text-sm font-medium ring-1 ring-slate-200 active:scale-95">✗ דחייה</button>
        </div>`;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      const finish = (ok) => {
        el.querySelector('.ac-yes').remove(); el.querySelector('.ac-no').remove();
        el.insertAdjacentHTML('beforeend', `<div class="text-xs font-medium ${ok ? 'text-emerald-600' : 'text-slate-400'}">${ok ? '✓ אושר ובוצע' : '✗ נדחה'}</div>`);
        resolve(ok);
      };
      el.querySelector('.ac-yes').addEventListener('click', () => finish(true));
      el.querySelector('.ac-no').addEventListener('click', () => finish(false));
    });
  }
```

ותיאורי הפעולות שמוצגים בכרטיס:

```js
  function describeCall(name, args) {
    switch (name) {
      case 'add_event': return `➕ הוספת אירוע: <b>${UI.esc(args.title)}</b> · ${UI.fmtDate(args.date)}${args.time ? ' ' + args.time : ''}`;
      case 'update_event': return `✏️ עדכון אירוע${args.title ? `: <b>${UI.esc(args.title)}</b>` : ''}`;
      case 'delete_event': return '🗑️ מחיקת אירוע מהתוכנית';
      case 'create_checklist': return `📝 יצירת רשימה "<b>${UI.esc(args.title)}</b>" עם ${(args.items || []).length} פריטים`;
      case 'add_checklist_items': return `📝 הוספת ${(args.items || []).length} פריטים לרשימה`;
      case 'set_document_category': return `🏷️ שינוי קטגוריית מסמך ל"${UI.cat(args.category).he}"`;
      case 'add_expense': return `💰 הוספת הוצאה: <b>${UI.esc(args.title)}</b> · ${UI.fmtMoney(args.amount, UI.normCur(args.currency))}`;
      case 'delete_expense': return '🗑️ מחיקת הוצאה מהתקציב';
      case 'remember_note': return `🧠 לזכור${args.tripId ? ' (בטיול)' : ' (זיכרון משפחה)'}: <b>${UI.esc(args.note)}</b>`;
      case 'search_archive': return `🗄️ חיפוש בארכיון: "<b>${UI.esc(args.query || '')}</b>"`;
      case 'forget_note': return '🧠 מחיקת פתק מהזיכרון';
      default: return UI.esc(name);
    }
  }
```

### תשובות לשאלות שלך, אחת-אחת

**האם יש אישור בכלל, או החלה עם ביטול אחרי?** אישור לפני. **אין ביטול אחרי, ואין undo.**
כתיבה קורית רק אחרי לחיצה מפורשת.

**מסומן או לא מסומן כברירת מחדל?** **אין תיבות סימון בכלל.** הכרטיס הוא אישור
**הכל-או-כלום לכל הסבב**: כל הקריאות של אותו סבב מוצגות יחד, ושני הכפתורים ניטרליים —
אין ברירת מחדל, אין פעולה שקורית בלי לחיצה. **החלטה, אבל לא בהכרח הנכונה:** היתרון הוא
שכרטיס אחד מייצג "תור" אחד של הסוכן ואי אפשר לאשר חצי שרשרת ולהשאיר את המודל עם מצב
חלקי שלא ידע עליו. החיסרון ברור — "צור רשימת אריזה" שמייצרת 14 פריטים ואחד לא מתאים
מאלץ דחייה של הכל.

**דעתי על ברירת המחדל שלך (מסומן):** נכונה לרוב הפעולות שלך, **לא** לכולן. מסומן-כברירת-
מחדל הוא הצהרה "זה בטוח והפיך". זה נכון ל-`setField`/`setNotes`/`setTitle`; זה **לא** נכון
ל-`clearField` ול-`moveDoc`. שתיים או שלוש שורות: `SAFE = new Set([...])`, וכל מה שמחוץ
לה מגיע לא מסומן. זה מפסיק להיות "אשר הכל" ומתחיל להיות מידע.

**האם מציגים את הערך הקודם לצד החדש? לא — וכן, זה חסר בפועל, ואצלנו זה מורגש בדיוק
במקום אחד:** `update_event`. הכרטיס מציג "✏️ עדכון אירוע" ותו לא, ואם המודל לא שלח
`title` — גם לא את שם האירוע. המשתמש מאשר שינוי שהוא לא רואה. **זה הכרטיס הכי גרוע
באפליקציה שלנו, ואני אומר את זה כדי שלא תשכפל אותו.** אצלך יש את הערך הקודם בקוד וכל
מה שנשאר זה להציג `ישן → חדש`; אצלנו זה דורש קודם `DB.get` בזמן בניית הכרטיס. **תציג.**
ההבדל בין "עדכון תאריך" ל-"12 באוגוסט → 12 בספטמבר" הוא ההבדל בין אישור אוטומטי לבדיקה.

**undo אחרי החלה — ואיך הוא מתיישב עם מיזוג הסנכרון.** אין לנו undo, אבל התשובה
לשאלה הזאת היא הדבר הכי חשוב בסעיף, כי יש כאן מלכודת שתיראה כמו באג סנכרון אקראי:

> **undo חייב להיות כתיבה קדימה, לעולם לא שחזור של המצב הקודם על חותמת הזמן הקודמת.**

המיזוג שלנו (ושלך, אם פירטת אותו) הוא last-writer-wins ברמת רשומה לפי `updatedAt`. אם
undo משחזר את הרשומה הישנה **עם ה-`updatedAt` הישן שלה**, אז:

- מקומית הכל נראה תקין — הערך חזר.
- בסנכרון הבא, העותק המרוחק (שכבר קיבל את הערך החדש עם חותמת מאוחרת יותר) **מנצח**,
  והשינוי שביטלת **חוזר לבד**, לפעמים שעות אחר כך, במכשיר שבו המשתמש לא עשה כלום.

המימוש הנכון: `DB.put` רגיל עם הערכים הישנים — כלומר `updatedAt = Date.now()` חדש.
undo הוא פעולת עריכה ככל אחרת, שבמקרה מחזירה ערך ישן.

**ולמחיקה זה גרוע יותר:** ביטול מחיקה חייב לדרוס את ה-tombstone ברשומה חיה עם חותמת
חדשה. אצלנו tombstone שומר רק `{id, deleted, updatedAt}` — **כל שאר השדות כבר לא קיימים**,
ולכן undo למחיקה מחייב להחזיק את הרשומה המלאה בזיכרון מרגע האישור. ואם מדובר במסמך —
ה-`blob` הוא cache מקומי, כך ש-undo יעבוד רק במכשיר שביצע את המחיקה. **המסקנה המעשית:**
אם אתה בונה undo, בנה אותו כ"מחסנית פעולות בזיכרון עם הרשומה המלאה לפני השינוי", תן לו
חלון קצר (הודעת toast עם "בטל"), ואל תנסה להפוך אותו למנגנון היסטוריה מתמיד — זה
ייכשל בדיוק מול המיזוג.

---

## Q4 — ההקשר

### הפונקציה שבונה אותו

```js
  /* --- context --- */
  async function buildContext() {
    const [trips, members] = [await DB.all('trips'), await DB.all('members')];
    const notes = (await DB.settings.get('agentNotes')) || [];
    const sums = await summaries();
    const ctx = {
      today: UI.todayISO(),
      family: members.map(m => ({ id: m.id, name: m.nameHe, nameEn: m.nameEn, age: UI.age(m.birthDate) })),
      foodProfile: (await Food.profile()) || null,
      trips: [],
    };
    // full detail only for current/upcoming trips; past trips shrink to a
    // summary line — keeps the prompt small as trips accumulate
    for (const t of trips) {
      const tt = Trips.tripType(t, members);
      const base = {
        id: t.id, name: t.name, destination: t.destination, start: t.startDate, end: t.endDate,
        travelers: (t.memberIds || []).map(id => members.find(m => m.id === id)?.nameHe).filter(Boolean),
        ...(tt ? { tripType: tt.label } : {}),
      };
      const past = t.endDate && t.endDate < ctx.today;
      if (past) {
        // past trips: one line + the lasting memory summary, nothing more
        ctx.trips.push({ ...base, past: true, ...(sums[t.id]?.text ? { memory: sums[t.id].text } : {}) });
        continue;
      }
      const expenses = await DB.byTrip('expenses', t.id);
      ctx.trips.push({
        ...base,
        // trip character — the agent should tailor every suggestion to it
        ...(tt ? { tripCharacter: tt.hint } : {}),
        notes: notes.filter(n => n.tripId === t.id).map(n => ({ id: n.id, note: n.note })),
        documents: (await DB.byTrip('documents', t.id)).map(d => ({
          id: d.id, name: d.fileName, category: d.category, extracted: d.extracted || null,
        })),
        events: (await DB.byTrip('events', t.id)).map(e => ({
          id: e.id, date: e.date, time: e.time, title: e.title, type: e.type, isDeadline: e.isDeadline,
          ...(e.place ? { place: e.place } : {}),
          ...(e.mealSlot ? { mealSlot: e.mealSlot, area: e.area, estCost: e.estCost, estCur: e.estCur, verified: !!e.verified } : {}),
        })),
        checklists: (await DB.byTrip('checklists', t.id)).map(l => ({
          id: l.id, title: l.title, items: l.items.map(i => ({ text: i.text, done: i.done })),
        })),
        expenses: expenses.map(x => ({
          id: x.id, title: x.title, amount: x.amount, currency: UI.normCur(x.currency),
          category: x.category || 'other', date: x.date,
        })),
        // precomputed so the model doesn't do arithmetic: ₪ totals via trip fx rates
        costSummary: UI.expenseTotals(expenses, t.fxRates),
        budget: t.budget || null,
      });
    }
    return ctx;
  }
```

וההרכבה לפרומפט המערכת:

```js
  async function systemPrompt() {
    const persona = (await DB.settings.get('agentPersona')) || DEFAULT_PERSONA;
    const family = ((await DB.settings.get('agentNotes')) || []).filter(n => !n.tripId);
    const memory = family.length
      ? `\n\n--- זיכרון המשפחה (עובדות רוחב ששמרת; פתקי טיול נמצאים בתוך כל טיול) ---\n${family.map(n => `[${n.id}] ${n.note}`).join('\n')}`
      : '';
    return `${persona}${MEMORY_RULES}${MAPS_RULES}${memory}\n\n--- נתוני האפליקציה (JSON) ---\n${JSON.stringify(await buildContext())}`;
  }
```

### שולחים הכל או מסננים?

**שולחים הכל — ומעולם לא לפי השאלה.** זו החלטה מפורשת, והיא התשובה הישירה לחשש שהעלית:
**סינון לפי השאלה הוא בדיוק המנגנון שמסתיר את מה שנשאלו עליו.** משתמש שכותב "מה עם
ההוא מהפעם הקודמת?" לא נותן שום מילת מפתח שאפשר לסנן לפיה, ומערכת שמסננת לפי דמיון
לשאלה תחזיר קונטקסט ריק ותגרום למודל לענות "אין לי מידע" על מידע שיש לו.

**הצמצום שלנו הוא לפי זמן, לא לפי תוכן:** טיול שהסתיים מצטמצם לשורה אחת + שדה `memory`
(סיכום קבוע שנוצר פעם אחת). זה דטרמיניסטי, ניתן להסבר למשתמש ("טיולים שהסתיימו מסוכמים"),
ולא תלוי בניסוח השאלה.

**ולמידע שכן נופל מחוץ לחלון יש דלת אחורית מפורשת** — כלי, לא סינון:

```js
    {
      name: 'search_archive',
      description: 'חיפוש בארכיון המלא של שיחות העבר (מה שכבר לא מופיע בהיסטוריה הנוכחית). השתמש כשנשאלת על דיון, החלטה או פרט ישנים שאינם בהקשר — לפני שאתה עונה שאינך זוכר.',
```

**זה הדפוס שאני ממליץ לך עליו במקום סינון:** קונטקסט קבוע ודטרמיניסטי + כלי חיפוש
קריאה-בלבד שהמודל קורא לו בעצמו כשחסר לו. המודל יודע מה חסר לו הרבה יותר טוב ממנוע
סינון שרץ לפניו.

### כמה טוקנים בפועל

**כאן אני חייב להיות מדויק לגבי מה אני יודע: אין לנו מדידה.** אין טלמטריה, ואין לנו
`countTokens`. מה שאני כן יכול לתת לך זה מה שדוחף את הגודל, לפי סדר:

1. **`items` של רשימות אריזה** — רשימה אחת של 40 פריטים, כל פריט אובייקט `{text, done}`.
2. **`extracted` של מסמכים** — אובייקט החילוץ המלא, כולל מערך `flights`.
3. **`events`** — גדל ליניארית עם תכנון מפורט (10 ימים × 4 אירועים).
4. **`expenses`** — גדל לאורך הטיול עצמו.

`family`, `foodProfile`, `budget` ו-`costSummary` זניחים.

**מאיזה גודל התחלנו להרגיש:** לא הרגשנו את זה כטוקנים אלא כ**זמן תגובה** בטיול פעיל עם
תוכנית מלאה — וזה בדיוק מה שהוליד את `past → memory` (טיולים שהסתיימו היו קודם מלאים
בקונטקסט). **המדידה שאני ממליץ לך לעשות ולנו לא עשינו:** שורה אחת,
`console.log(JSON.stringify(ctx).length)`, וכלל אצבע של ~4 תווים לטוקן בעברית פחות ובקוד
יותר. תדע תוך יום מה המספר האמיתי, במקום לנחש כמונו.

**לך זה יגדל אחרת ממני:** "כל הכספת בכל הודעה" מתנהג יפה על 30 מסמכים ורע על 300, ואין לך
את המפלט של "טיול שהסתיים" — תעודה לא מסתיימת. הצמצום המקביל אצלך הוא לפי **תפוגה**:
מסמך שפג תוקפו לפני שנתיים יכול להצטמצם לשורה.

### כמה תורות היסטוריה

**חלון של 40 תורות, נחתך ל-30, והעודף עובר לארכיון ולא נעלם.** אתה שולח 12.

```js
      if (history.length > 40) {
        let cut = history.length - 30;
        while (cut < history.length && !(history[cut].role === 'user' && history[cut].parts?.some(p => p.text))) cut++;
        await archiveTurns(history.slice(0, cut));
        history = history.slice(cut);
      }
```

**שים לב ללולאת ה-`while` — זה לא ניקיון, זו הגנה מפני 400.** "תור" בפרוטוקול הזה אינו
בהכרח הודעה: סבב עם קריאת כלי מייצר **שלושה** תורות (טקסט המודל + `functionCall`,
`functionResponse` בתפקיד user, ואז תשובת המודל). חיתוך במקום שרירותי יכול להשאיר
`functionResponse` בלי ה-`functionCall` שלו, ו-Gemini דוחה את הבקשה. לכן החיתוך זוחל
קדימה עד **תור משתמש טקסטואלי אמיתי**.

**זה רלוונטי אליך ישירות אם תעבור אי פעם ל-function calling**: "12 תורות" יהפוך במכה
ל-4 חילופי דברים אמיתיים, וחיתוך נאיבי יתחיל לזרוק 400 שייראו אקראיים.

### שדות שהחלטנו לא לשלוח — מעבר למה שממילא לא יוצא מהמכשיר

ארבעה, ולכל אחד סיבה נפרדת:

1. **הכספת (`vault`) — לא בקונטקסט, לא ב-store המסונכרן, לא בגיבוי.** צילומי דרכונים לא
   מגיעים לא ל-API ולא לדרייב.
2. **`blob` של מסמכים.** לקונטקסט נכנסים רק `id`, `name`, `category` ו-`extracted`.
   הסוכן יודע ש"יש כרטיס טיסה של אל על ב-12 באוגוסט" בלי שהקובץ ייצא מהמכשיר.
3. **מסמך שסווג `passport` לעולם לא מקבל `extracted`.** זה לא סינון בקונטקסט אלא גדר שלב
   אחד קודם, בשלב החילוץ — `extractDoc` יוצאת מוקדם לפני ההשמה:

```js
      if (extracted.category === 'passport') {
        doc.category = 'passport';
        await DB.put('documents', doc);
        Members.proposeFromPassport({ blob: doc.blob, mimeType: doc.mimeType, docId: doc.id }, extracted.passport || {});
        return;
      }
      doc.extracted = extracted;
```

   כלומר גם אילו הקונטקסט היה שולח את `extracted` בלי אבחנה — ואין לו אבחנה — לא היה שם
   מה לשלוח. **גדר בשכבת הכתיבה שורדת רפקטור בשכבת התצוגה; סינון בקונטקסט לא.** זה
   ההבדל שהייתי מבקש ממך לאמץ בסינון השדות הרגישים שלך: אל תסתפק בסינון בזמן בניית
   הקונטקסט — עדיף שהערך הרגיש לא ייכתב לשדה שהקונטקסט קורא ממנו מלכתחילה.
4. **`agentHistory` אינו ב-`SHARED_SETTINGS`** — השיחות מקומיות למכשיר בכוונה. מה שמשותף
   בין בני הזוג הוא **הזיכרון** (`agentNotes`, `agentTripSummaries`) והארכיון בדרייב,
   לא חלון השיחה.

ודבר אחרון שהוא לא "לא לשלוח" אלא "לשלוח מחושב":

```js
        // precomputed so the model doesn't do arithmetic: ₪ totals via trip fx rates
        costSummary: UI.expenseTotals(expenses, t.fxRates),
```

**מודל שמחשב סכומים טועה בשקט.** כל מספר שהמשתמש עשוי לצטט — סכומים, ימים שנותרו, ספירות —
עדיף שיגיע לקונטקסט מחושב מראש. זה גם חוסך לו עבודה וגם מוציא מחלקת שגיאות שלמה
מהמשוואה. אצלך המקבילה היא ספירת מסמכים לפי סוג וימים עד תפוגה.

---

## סיכום ההבדלים בשורה אחת כל אחד

| | התיק המשפחתי (שלך) | נאביגו |
|---|---|---|
| פרוטוקול | JSON חופשי, תשובה יחידה | `functionDeclarations`, לולאה עד 6 סבבים |
| ולידציה | `Chat.compile` לפני הצגה — **חזק יותר** | סכימת טיפוסים + בדיקת קיום בזמן ביצוע; `tripId` לא נבדק כלל |
| שרשור | לא (תשובה יחידה) | כן, מזהים חוזרים ב-`functionResponse` |
| מחיקה | אין — **נכון לתחום שלך** | 3 כלים, מוגבלים לישויות שהסוכן יוצר |
| אישור | כרטיס לפעולה, מסומן כברירת מחדל | כל-או-כלום לסבב, בלי ברירת מחדל |
| ערך קודם | קיים בקוד, לא מוצג | לא קיים — **והחיסרון מורגש ב-`update_event`** |
| דחייה | לא חוזרת למודל | חוזרת כ-`functionResponse` והמודל מגיב |
| היסטוריה | 12 תורות | 40, חיתוך ל-30 בגבול בטוח + ארכיון |
| קונטקסט | הכל, מסונן לשדות רגישים | הכל, מצומצם לפי זמן + `search_archive` ככלי |
