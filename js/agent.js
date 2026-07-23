/* TripNest — AI agent (Gemini): chat, quick-action chips, function calling with user approval.
   Context = trips/events/docs metadata only. Passport photos never reach the API. */
const Agent = (() => {
  let history = [];   // [{role:'user'|'model', parts:[...]}] — persisted in shared settings
  let historyLoaded = false;
  let busy = false;

  async function loadHistory() {
    history = (await DB.settings.get('agentHistory')) || [];
    historyLoaded = true;
  }
  async function saveHistory() {
    await DB.settings.set('agentHistory', history);
    await DB.touchShared();
    G.Sync.queue();
  }

  // Gemini rejects unknown fields — strip the local metadata (_ts, _trip) before sending
  const wire = () => history.map(({ role, parts }) => ({ role, parts }));

  // the trip a conversation "belongs" to right now: the live trip, else the
  // nearest upcoming one — used to partition archived turns per trip
  async function activeTripId() {
    const today = UI.todayISO();
    const trips = (await DB.all('trips')).filter(t => !t.endDate || t.endDate >= today);
    trips.sort((a, b) => String(a.startDate || '9999') < String(b.startDate || '9999') ? -1 : 1);
    const live = trips.find(t => t.startDate && t.startDate <= today);
    return (live || trips[0])?.id || null;
  }

  function turnText(turn) {
    const parts = turn.parts || [];
    const text = parts.filter(p => p.text).map(p => p.text).join('');
    if (text) return text;
    const calls = parts.filter(p => p.functionCall).map(p => p.functionCall.name);
    return calls.length ? '[פעולות: ' + calls.join(', ') + ']' : '';
  }

  // turns dropped from the live window land in the archive instead of vanishing
  async function archiveTurns(turns) {
    try {
      await Archive.add(turns
        .map(t => ({ ts: t._ts || Date.now(), tripId: t._trip || null, role: t.role, text: turnText(t) }))
        .filter(r => r.text));
    } catch (e) { console.warn('archiving trimmed turns failed', e); }
  }

  const CHIPS = [
    'תכנן ארוחות לטיול הקרוב לפי פרופיל האוכל שלנו',
    'בנה תוכנית טיול לטיול הקרוב',
    'מה חסר לנו לקראת הטיול?',
    'צור רשימת אריזה מותאמת',
    'בדוק מועדים חשובים',
    'סכם את המסמכים שיש לנו',
    'כמה זמן נשאר לחופשה?',
  ];

  const DEFAULT_PERSONA = `אתה "נסטו" 🦉 — עוזר הטיולים של המשפחה באפליקציית "Navigo".
אתה חם, מצחיק בקטנה, ותכליתי. אתה עונה בעברית, קצר ולעניין, עם אימוג׳י פה ושם.
אתה מכיר את כל הטיולים, המסמכים, התוכניות והרשימות של המשפחה ועוזר לתכנן, לארגן ולהזכיר.
כשמתאים — הצע פעולות (הוספת אירועים, רשימות, הוצאות לתקציב) באמצעות הכלים שלך. לעולם אל תמציא נתונים שאינם בקונטקסט.

תכנון אוכל: בקונטקסט יש foodProfile — פרופיל התזונה של המשפחה. כבד אותו בכל המלצת מסעדה או ארוחה, בלי שיזכירו לך. ארוחות נוצרות ככלי add_event עם type="food",‏ mealSlot ("lunch" או "dinner"), area ועלות משוערת (estCost + estCur).

אמינות מעל הכל — הכלל החשוב ביותר, גובר על שטף, על יצירתיות ועל הרצון לרצות:
לעולם אל תמציא. אף פעם אל תציג ניחוש כעובדה — לא שם, לא מחיר, לא שעה, לא כתובת, לא "עובדה" על מקום. אם אינך יודע או אינך בטוח — אמור זאת במפורש ("אני לא בטוח", "כדאי לבדוק") או הצע דרך לברר. תשובה חסרה ואמינה עדיפה תמיד על תשובה מלאה ומומצאת. אין שום מצב שבו עדיף להמציא.

כללי אמינות בהמלצות על העולם (מסעדות, אתרים, מקומות):
- שמות מקומות — רק באיות המדויק והמלא שאתה בטוח בו. אל תוסיף מילים לשם ואל תנחש. אם אינך בטוח בשם — תאר את סוג המקום בלי שם ספציפי.
- הידע שלך עשוי להיות לא מעודכן: מקומות נסגרים ושעות משתנות. בסוף כל תוכנית עם המלצות ספציפיות הוסף שורה קצרה שמזכירה לוודא שהמקומות פתוחים לפני ההגעה.
- בדוק עקביות זמנים לפני שאתה משבץ: שעות שקיעה בעונה הרלוונטית, זמני נסיעה, שעות טיסות מהקונטקסט. אל תבטיח חוויה (כמו שקיעה) בשעה שלא מתאימה לה.`;

  const TOOLS = [
    {
      name: 'add_event',
      description: 'הוספת אירוע לתוכנית הטיול (ציר הזמן)',
      parameters: {
        type: 'OBJECT',
        properties: {
          tripId: { type: 'STRING' }, date: { type: 'STRING', description: 'YYYY-MM-DD' },
          time: { type: 'STRING', description: 'HH:MM, לא חובה' }, title: { type: 'STRING' },
          type: { type: 'STRING', description: 'flight|checkin|checkout|car|activity|food|deadline|other' },
          notes: { type: 'STRING' }, isDeadline: { type: 'BOOLEAN' },
          mealSlot: { type: 'STRING', description: 'לאירועי אוכל: lunch|dinner' },
          area: { type: 'STRING', description: 'לאירועי אוכל: שכונה/כתובת' },
          estCost: { type: 'NUMBER', description: 'לאירועי אוכל: עלות משוערת למשפחה' },
          estCur: { type: 'STRING', description: '₪|€|$|£' },
        },
        required: ['tripId', 'date', 'title'],
      },
    },
    {
      name: 'update_event',
      description: 'עדכון אירוע קיים בתוכנית',
      parameters: {
        type: 'OBJECT',
        properties: {
          eventId: { type: 'STRING' }, date: { type: 'STRING' }, time: { type: 'STRING' },
          title: { type: 'STRING' }, notes: { type: 'STRING' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'delete_event',
      description: 'מחיקת אירוע מהתוכנית',
      parameters: { type: 'OBJECT', properties: { eventId: { type: 'STRING' } }, required: ['eventId'] },
    },
    {
      name: 'create_checklist',
      description: 'יצירת רשימה חדשה (אריזה/משימות) עם פריטים',
      parameters: {
        type: 'OBJECT',
        properties: {
          tripId: { type: 'STRING' }, title: { type: 'STRING' },
          items: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['tripId', 'title', 'items'],
      },
    },
    {
      name: 'add_checklist_items',
      description: 'הוספת פריטים לרשימה קיימת',
      parameters: {
        type: 'OBJECT',
        properties: { checklistId: { type: 'STRING' }, items: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['checklistId', 'items'],
      },
    },
    {
      name: 'set_document_category',
      description: 'שינוי קטגוריה של מסמך',
      parameters: {
        type: 'OBJECT',
        properties: { docId: { type: 'STRING' }, category: { type: 'STRING', description: 'flight|stay|car|insurance|visa|attraction|other' } },
        required: ['docId', 'category'],
      },
    },
    {
      name: 'add_expense',
      description: 'הוספת הוצאה לתקציב הטיול (טיסות, לינה, מסעדות, אטרקציות וכו׳)',
      parameters: {
        type: 'OBJECT',
        properties: {
          tripId: { type: 'STRING' }, title: { type: 'STRING' },
          amount: { type: 'NUMBER' }, currency: { type: 'STRING', description: '₪|€|$|£' },
          category: { type: 'STRING', description: 'flight|stay|car|food|attraction|insurance|shopping|other' },
          date: { type: 'STRING', description: 'YYYY-MM-DD, לא חובה' },
        },
        required: ['tripId', 'title', 'amount'],
      },
    },
    {
      name: 'delete_expense',
      description: 'מחיקת הוצאה מתקציב הטיול',
      parameters: { type: 'OBJECT', properties: { expenseId: { type: 'STRING' } }, required: ['expenseId'] },
    },
    {
      name: 'remember_note',
      description: 'שמירת עובדה לזיכרון ארוך-טווח. השתמש כשהמשפחה מספרת משהו ששווה לזכור. עם tripId — זיכרון של הטיול הזה בלבד; בלי tripId — זיכרון משפחה: העדפה או עובדת רוחב שנכונה לכל הטיולים.',
      parameters: {
        type: 'OBJECT',
        properties: {
          note: { type: 'STRING', description: 'העובדה לזכירה, משפט קצר בעברית' },
          tripId: { type: 'STRING', description: 'רק אם העובדה נוגעת לטיול ספציפי; השמט להעדפות כלליות' },
        },
        required: ['note'],
      },
    },
    {
      name: 'search_archive',
      description: 'חיפוש בארכיון המלא של שיחות העבר (מה שכבר לא מופיע בהיסטוריה הנוכחית). השתמש כשנשאלת על דיון, החלטה או פרט ישנים שאינם בהקשר — לפני שאתה עונה שאינך זוכר.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'מילות חיפוש (מופרדות ברווח, כולן חייבות להופיע)' },
          tripId: { type: 'STRING', description: 'צמצום לארכיון של טיול מסוים, לא חובה' },
        },
        required: ['query'],
      },
    },
    {
      name: 'forget_note',
      description: 'מחיקת עובדה מהזיכרון ארוך-הטווח לפי המזהה שלה',
      parameters: { type: 'OBJECT', properties: { noteId: { type: 'STRING' } }, required: ['noteId'] },
    },
  ];

  const AUTO_TOOLS = new Set(['search_archive']); // read-only, no approval needed

  async function execTool(name, args) {
    switch (name) {
      case 'add_event': {
        const ev = await DB.put('events', {
          tripId: args.tripId, date: args.date, time: args.time || null, title: args.title,
          type: args.type || 'other', notes: args.notes || '', isDeadline: !!args.isDeadline,
          ...(args.type === 'food' && args.mealSlot ? {
            mealSlot: args.mealSlot, area: args.area || '',
            estCost: args.estCost > 0 ? args.estCost : null, estCur: args.estCur || '€',
            verified: false,  // the family confirms via the Maps link, never the model
          } : {}),
        });
        return { ok: true, eventId: ev.id };
      }
      case 'update_event': {
        const ev = await DB.get('events', args.eventId);
        if (!ev) return { ok: false, error: 'event not found' };
        ['date', 'time', 'title', 'notes'].forEach(k => { if (args[k] != null) ev[k] = args[k]; });
        await DB.put('events', ev);
        return { ok: true };
      }
      case 'delete_event':
        await DB.remove('events', args.eventId);
        return { ok: true };
      case 'create_checklist': {
        const l = await DB.put('checklists', {
          tripId: args.tripId, title: args.title,
          items: (args.items || []).map(t => ({ id: DB.uid(), text: t, done: false })),
        });
        return { ok: true, checklistId: l.id };
      }
      case 'add_checklist_items': {
        const l = await DB.get('checklists', args.checklistId);
        if (!l) return { ok: false, error: 'checklist not found' };
        (args.items || []).forEach(t => l.items.push({ id: DB.uid(), text: t, done: false }));
        await DB.put('checklists', l);
        return { ok: true };
      }
      case 'set_document_category': {
        const d = await DB.get('documents', args.docId);
        if (!d) return { ok: false, error: 'doc not found' };
        d.category = args.category;
        await DB.put('documents', d);
        return { ok: true };
      }
      case 'add_expense': {
        const x = await DB.put('expenses', {
          tripId: args.tripId, title: args.title, amount: Number(args.amount),
          currency: UI.normCur(args.currency), category: args.category || 'other',
          date: args.date || UI.todayISO(), payerId: null,
        });
        return { ok: true, expenseId: x.id };
      }
      case 'delete_expense':
        await DB.remove('expenses', args.expenseId);
        return { ok: true };
      case 'remember_note': {
        const notes = (await DB.settings.get('agentNotes')) || [];
        const n = { id: DB.uid(), note: args.note, tripId: args.tripId || null, createdAt: Date.now() };
        notes.push(n);
        await DB.settings.set('agentNotes', notes);
        await DB.touchShared();
        return { ok: true, noteId: n.id };
      }
      case 'search_archive': {
        await Archive.pull(args.tripId || null); // best-effort refresh from Drive
        const hits = await Archive.search(args.query, args.tripId ? { tripId: args.tripId, limit: 15 } : { limit: 15 });
        return {
          ok: true,
          results: hits.map(h => ({
            date: new Date(h.ts).toISOString().slice(0, 10),
            role: h.role === 'user' ? 'family' : 'agent',
            text: String(h.text).slice(0, 500),
          })),
        };
      }
      case 'forget_note': {
        const notes = (await DB.settings.get('agentNotes')) || [];
        const left = notes.filter(n => n.id !== args.noteId);
        if (left.length === notes.length) return { ok: false, error: 'note not found' };
        await DB.settings.set('agentNotes', left);
        await DB.touchShared();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unknown tool' };
    }
  }

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

  /* --- trip summaries (long-term trip memory, shared setting) --- */
  const SUMMARIES_KEY = 'agentTripSummaries';
  async function summaries() { return (await DB.settings.get(SUMMARIES_KEY)) || {}; }

  // condense a trip's conversations + notes into a lasting summary, and promote
  // cross-trip insights into family memory. text:null marks "nothing to summarize"
  // so autoSummarize won't retry a chat-less trip forever.
  async function summarizeTrip(tripId) {
    const trip = await DB.get('trips', tripId);
    if (!trip) throw new Error('הטיול לא נמצא');
    await Archive.pull(tripId);
    if (!historyLoaded) await loadHistory();
    const turns = (await Archive.forTrip(tripId)).map(r => ({ role: r.role, text: r.text }));
    for (const t of history) {
      if (t._trip === tripId) { const txt = turnText(t); if (txt) turns.push({ role: t.role, text: txt }); }
    }
    const notes = ((await DB.settings.get('agentNotes')) || []).filter(n => n.tripId === tripId);
    const s = await summaries();
    if (!turns.length && !notes.length) {
      s[tripId] = { text: null, updatedAt: Date.now() };
      await DB.settings.set(SUMMARIES_KEY, s);
      await DB.touchShared();
      return null;
    }
    const convo = turns.map(t => `${t.role === 'user' ? 'משפחה' : 'סוכן'}: ${t.text}`).join('\n').slice(-20000);
    const out = await Gemini.json(`אתה מסכם שיחות תכנון של טיול משפחתי לצורך זיכרון ארוך-טווח של סוכן AI.
הטיול: ${trip.name} · ${trip.destination || ''} · ${trip.startDate || '?'}–${trip.endDate || '?'}
פתקי הזיכרון של הטיול:
${notes.map(n => '- ' + n.note).join('\n') || '(אין)'}
השיחות:
${convo || '(אין)'}
החזר JSON בלבד:
{"summary":"סיכום בעברית, עד 120 מילים: החלטות שהתקבלו, מה עבד ומה לא, לקחים לטיול הזה",
 "familyNotes":["עד 3 תובנות רוחב שנכונות גם לטיולים הבאים (העדפות קבועות של המשפחה), משפט קצר כל אחת; החזר [] אם אין"]}`);
    if (!out || !out.summary) throw new Error('הסיכום נכשל — נסו שוב');
    s[tripId] = { text: String(out.summary), updatedAt: Date.now() };
    await DB.settings.set(SUMMARIES_KEY, s);
    const all = (await DB.settings.get('agentNotes')) || [];
    for (const note of (Array.isArray(out.familyNotes) ? out.familyNotes : []).slice(0, 3)) {
      const txt = String(note || '').trim();
      if (txt && !all.some(n => n.note === txt)) {
        all.push({ id: DB.uid(), note: txt, tripId: null, source: 'trip-summary:' + tripId, createdAt: Date.now() });
      }
    }
    await DB.settings.set('agentNotes', all);
    await DB.touchShared();
    G.Sync.queue();
    return s[tripId];
  }

  // quietly summarize trips that ended without a summary (once per app load)
  let _autoRan = false;
  async function autoSummarize() {
    if (_autoRan || !(await Gemini.hasKey())) return;
    _autoRan = true;
    const today = UI.todayISO();
    const s = await summaries();
    for (const t of await DB.all('trips')) {
      if (!t.endDate || t.endDate >= today || s[t.id]) continue;
      try { await summarizeTrip(t.id); } catch (e) { console.warn('auto trip summary failed', e); break; }
    }
  }

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

  // fixed section, outside the user-editable persona, so memory rules survive persona edits
  const MEMORY_RULES = `\n\n--- מבנה הזיכרון שלך ---
שלוש שכבות: (1) זיכרון משפחה — העדפות ועובדות רוחב, מופיע כאן תמיד; (2) זיכרון טיול — פתקים בשדה notes של כל טיול נוכחי/עתידי, וסיכום קבוע בשדה memory של טיולי עבר; (3) ארכיון שיחות מלא — לא בהקשר, נגיש דרך הכלי search_archive.
שמירה: remember_note עם tripId לעובדה של טיול ספציפי, בלי tripId לזיכרון משפחה. מחיקה: forget_note.
כשנשאל על דיון או החלטה ישנים שאינם בהקשר — חפש עם search_archive לפני שאתה עונה שאינך זוכר.`;

  const MAPS_RULES = `\n\n--- קישורי גוגל מפות ---
כשאתה מזכיר מקום (מסעדה, אטרקציה, מלון, כתובת) או כשמבקשים ממך קישור — תמיד תן קישור דינמי לחיפוש בגוגל מפות בפורמט markdown:
[שם המקום](https://www.google.com/maps/search/?api=1&query=שם+המקום+יעד)
בנה את ה-query מהשם המדויק של המקום + עיר/יעד, עם + או רווחים בין המילים. קישור חיפוש כזה תמיד עובד ומוביל ישירות לגוגל מפות — אל תמציא place_id, קואורדינטות או קישור לדף מקום ספציפי שאינך בטוח בו. לעולם אל תכתוב כתובת URL כטקסט חשוף בלי לעטוף אותה בקישור markdown של [טקסט](כתובת).`;

  async function systemPrompt() {
    const persona = (await DB.settings.get('agentPersona')) || DEFAULT_PERSONA;
    const family = ((await DB.settings.get('agentNotes')) || []).filter(n => !n.tripId);
    const memory = family.length
      ? `\n\n--- זיכרון המשפחה (עובדות רוחב ששמרת; פתקי טיול נמצאים בתוך כל טיול) ---\n${family.map(n => `[${n.id}] ${n.note}`).join('\n')}`
      : '';
    return `${persona}${MEMORY_RULES}${MAPS_RULES}${memory}\n\n--- נתוני האפליקציה (JSON) ---\n${JSON.stringify(await buildContext())}`;
  }

  /* --- UI --- */
  let dayState = {};  // dayKey -> open? (default: only the latest day open)
  let quote = null;   // bubble text picked as reply context

  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayLabel = (k) => k === 'older' ? 'שיחות קודמות' : UI.fmtDayHeader(k);
  const visibleTurns = () => history
    .map(t => ({ role: t.role, text: (t.parts || []).filter(p => p.text).map(p => p.text).join(''), day: t._ts ? dayKey(t._ts) : 'older' }))
    .filter(t => t.text);

  async function render() {
    const chipsEl = document.getElementById('agent-chips');
    chipsEl.innerHTML = CHIPS.map(c =>
      `<button class="agent-chip shrink-0 bg-white text-indigo-600 text-xs font-medium px-3.5 py-2 rounded-full shadow-sm ring-1 ring-indigo-100 active:scale-95">${c}</button>`).join('');
    chipsEl.querySelectorAll('.agent-chip').forEach(b => b.addEventListener('click', () => send(b.textContent)));
    if (busy) return; // אל תדרוס את הלוג באמצע תור
    if (!historyLoaded) await loadHistory();
    const q = document.getElementById('agent-search-input')?.value.trim();
    if (q) { await renderSearch(q); return; }
    const log = document.getElementById('agent-log');
    log.innerHTML = '';
    // conversation grouped by day; each separator folds its day, only the latest open by default
    const turns = visibleTurns();
    const days = [...new Set(turns.map(t => t.day))];
    const last = days[days.length - 1];
    for (const day of days) {
      const items = turns.filter(t => t.day === day);
      const open = dayState[day] ?? (day === last);
      const sep = document.createElement('button');
      sep.className = 'w-full flex items-center gap-2 my-2 text-[11px] text-slate-400';
      sep.innerHTML = `<span class="flex-1 h-px bg-slate-200"></span><span>${open ? '▾' : '◂'} ${dayLabel(day)} · ${items.length}</span><span class="flex-1 h-px bg-slate-200"></span>`;
      sep.addEventListener('click', () => { dayState[day] = !open; render(); });
      log.appendChild(sep);
      if (open) items.forEach(t => addBubble(t.role === 'user' ? 'user' : 'model', t.role === 'user' ? UI.esc(t.text) : mdLite(t.text)));
    }
    if (!log.children.length) {
      addBubble('model', 'היי! אני העוזר של Navigo 🛫 אפשר לשאול אותי על הטיולים, המסמכים והתוכניות — או ללחוץ על אחת הפעולות למעלה.');
    }
    scrollToEnd();
    updateJump();
    autoSummarize(); // background: condense trips that just became "past"
  }

  // keyword filter over the live window + the local archive mirror
  async function renderSearch(q) {
    const log = document.getElementById('agent-log');
    log.innerHTML = '';
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const t of visibleTurns()) {
      if (!words.every(w => t.text.toLowerCase().includes(w))) continue;
      hits++;
      addBubble(t.role === 'user' ? 'user' : 'model', t.role === 'user' ? UI.esc(t.text) : mdLite(t.text));
    }
    const arch = await Archive.search(q, { limit: 10 });
    if (arch.length) {
      const sep = document.createElement('div');
      sep.className = 'text-center text-[11px] text-slate-400 my-2';
      sep.textContent = `🗄️ מהארכיון (${arch.length})`;
      log.appendChild(sep);
      for (const h of arch) {
        addBubble(h.role === 'user' ? 'user' : 'model',
          `<span class="block text-[10px] text-slate-400">${new Date(h.ts).toLocaleDateString('he-IL')}</span>${h.role === 'user' ? UI.esc(h.text) : mdLite(h.text)}`);
      }
    }
    if (!hits && !arch.length) log.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">אין תוצאות ל"${UI.esc(q)}"</div>`;
    scroller().scrollTop = 0;
  }

  // the log itself only scrolls when the layout constrains its height; normally
  // the whole view scrolls inside #app-scroll — track whichever actually overflows
  function scroller() {
    const log = document.getElementById('agent-log');
    return log.scrollHeight > log.clientHeight + 4 ? log : document.getElementById('app-scroll');
  }
  const scrollToEnd = () => { const s = scroller(); s.scrollTop = s.scrollHeight; };

  function updateJump() {
    const btn = document.getElementById('agent-jump');
    if (!btn) return;
    const inAgent = !document.getElementById('view-agent').classList.contains('hidden');
    const s = scroller();
    btn.classList.toggle('hidden', !inAgent || s.scrollHeight - s.scrollTop - s.clientHeight < 250);
  }

  /* quote-and-reply: tap a bubble to attach it as context to the next message */
  function setQuote(text) {
    quote = text;
    document.getElementById('agent-quote-text').textContent = text;
    document.getElementById('agent-quote').classList.remove('hidden');
  }
  function clearQuote() {
    quote = null;
    document.getElementById('agent-quote').classList.add('hidden');
  }

  function addBubble(role, html) {
    const log = document.getElementById('agent-log');
    const el = document.createElement('div');
    el.className = role === 'user'
      ? 'self-start bg-indigo-600 text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap'
      : 'self-end bg-white text-slate-700 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm max-w-[85%] shadow-sm whitespace-pre-wrap';
    el.innerHTML = html;
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;  // let links open instead of becoming a quote
      const t = el.textContent.trim();
      if (t) setQuote(t.slice(0, 200));
    });
    log.appendChild(el);
    scrollToEnd();
    return el;
  }

  const mdLite = (t) => UI.esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\* /gm, '• ')
    // markdown links [text](url) → clickable, opens in a new tab
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener" class="text-indigo-600 underline">$1</a>')
    // bare URLs not already wrapped in an anchor's href
    .replace(/(^|[^"'>=])(https?:\/\/[^\s<]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener" class="text-indigo-600 underline">$2</a>');

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

  /* --- memory management screen --- */
  async function memoryScreen() {
    const notes = (await DB.settings.get('agentNotes')) || [];
    const trips = await DB.all('trips');
    const sums = await summaries();
    const tripName = (id) => trips.find(t => t.id === id)?.name || 'טיול שנמחק';
    const family = notes.filter(n => !n.tripId);
    const byTrip = {};
    notes.filter(n => n.tripId).forEach(n => (byTrip[n.tripId] = byTrip[n.tripId] || []).push(n));
    const row = (n) => `
      <div class="flex items-start gap-2 py-2 border-b border-slate-50 last:border-0 text-[13px]">
        <span class="flex-1 text-slate-600 leading-snug">${UI.esc(n.note)}</span>
        ${n.tripId ? `<button class="mn-fam shrink-0 text-[10px] text-indigo-400 font-medium" data-id="${n.id}">→ למשפחה</button>` : ''}
        <button class="mn-del shrink-0 text-slate-300" data-id="${n.id}">✕</button>
      </div>`;
    UI.openModal({
      title: '🧠 הזיכרון של הסוכן',
      hideConfirm: true,
      bodyHTML: `
        <div class="pb-4 space-y-5">
          <p class="text-[11px] text-slate-400">זיכרון משפחה מוזרק לסוכן תמיד; זיכרון טיול — רק כשהטיול רלוונטי. הכל משותף לשניכם.</p>
          <div>
            <div class="text-xs font-bold text-slate-500 mb-1">👨‍👩‍👧‍👦 זיכרון משפחה</div>
            ${family.map(row).join('') || '<div class="text-[11px] text-slate-300">אין פתקים עדיין</div>'}
          </div>
          ${Object.entries(byTrip).map(([tid, ns]) => `
            <div>
              <div class="text-xs font-bold text-slate-500 mb-1">🧳 זיכרון טיול · ${UI.esc(tripName(tid))}</div>
              ${ns.map(row).join('')}
            </div>`).join('')}
          <div>
            <div class="text-xs font-bold text-slate-500 mb-1">🗄️ סיכומי טיולים</div>
            ${trips.map(t => `
              <div class="py-2 border-b border-slate-50 last:border-0">
                <div class="flex items-center gap-2">
                  <span class="text-[13px] font-medium text-slate-600 flex-1">${UI.esc(t.name)}</span>
                  <button class="mn-sum tn-btn-secondary !py-1 !px-2.5 !text-[10px]" data-id="${t.id}">${sums[t.id]?.text ? 'סכם מחדש' : 'סכם עכשיו'}</button>
                </div>
                ${sums[t.id]?.text ? `<div class="text-[11px] text-slate-400 leading-snug mt-1">${UI.esc(sums[t.id].text)}</div>` : ''}
              </div>`).join('') || '<div class="text-[11px] text-slate-300">אין טיולים</div>'}
            ${Archive.isUnsupported() ? '<div class="text-[10px] text-amber-500 mt-1.5">ארכיון השיחות נשמר במכשיר בלבד — פרסו גשר מעודכן (v1.3.0+) כדי לגבות אותו בדרייב.</div>' : ''}
          </div>
        </div>`,
    });
    const saveNotes = async (list) => {
      await DB.settings.set('agentNotes', list);
      await DB.touchShared();
      G.Sync.queue();
      memoryScreen();
    };
    document.querySelectorAll('.mn-del').forEach(b => b.addEventListener('click', async () =>
      saveNotes(((await DB.settings.get('agentNotes')) || []).filter(n => n.id !== b.dataset.id))));
    document.querySelectorAll('.mn-fam').forEach(b => b.addEventListener('click', async () =>
      saveNotes(((await DB.settings.get('agentNotes')) || []).map(n => n.id === b.dataset.id ? { ...n, tripId: null } : n))));
    document.querySelectorAll('.mn-sum').forEach(b => b.addEventListener('click', (e) => UI.busy(e.currentTarget, async () => {
      try {
        const out = await summarizeTrip(b.dataset.id);
        UI.toast(out ? 'הסיכום עודכן ✓' : 'אין עדיין שיחות לסכם לטיול הזה', out ? 'success' : 'info');
        memoryScreen();
      } catch (err) { UI.toast(err.message, 'error'); }
    })));
  }

  function init() {
    render();
    const form = document.getElementById('agent-form');
    form.addEventListener('submit', (e) => { e.preventDefault(); send(document.getElementById('agent-input').value); });
    document.getElementById('agent-log').addEventListener('scroll', updateJump);
    document.getElementById('app-scroll').addEventListener('scroll', updateJump);
    document.getElementById('agent-jump').addEventListener('click', () => {
      const s = scroller();
      s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
    });
    document.getElementById('agent-quote-x').addEventListener('click', clearQuote);
    document.getElementById('agent-memory-btn').addEventListener('click', memoryScreen);
    const searchBar = document.getElementById('agent-search-bar');
    const searchInput = document.getElementById('agent-search-input');
    document.getElementById('agent-search-btn').addEventListener('click', () => {
      searchBar.classList.toggle('hidden');
      if (searchBar.classList.contains('hidden')) { searchInput.value = ''; render(); }
      else searchInput.focus();
    });
    let debounce = null;
    searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(render, 250); });
  }

  return { init, render, send, summarizeTrip, summaries, DEFAULT_PERSONA, CHIPS };
})();
window.Agent = Agent;
