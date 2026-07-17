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

  const CHIPS = [
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
      description: 'שמירת עובדה לזיכרון ארוך-טווח (העדפות, החלטות, מידע שכדאי לזכור לטיולים הבאים). השתמש כשהמשפחה מספרת משהו ששווה לזכור.',
      parameters: {
        type: 'OBJECT',
        properties: {
          note: { type: 'STRING', description: 'העובדה לזכירה, משפט קצר בעברית' },
          tripId: { type: 'STRING', description: 'אם קשור לטיול ספציפי, לא חובה' },
        },
        required: ['note'],
      },
    },
    {
      name: 'forget_note',
      description: 'מחיקת עובדה מהזיכרון ארוך-הטווח לפי המזהה שלה',
      parameters: { type: 'OBJECT', properties: { noteId: { type: 'STRING' } }, required: ['noteId'] },
    },
  ];

  async function execTool(name, args) {
    switch (name) {
      case 'add_event': {
        const ev = await DB.put('events', {
          tripId: args.tripId, date: args.date, time: args.time || null, title: args.title,
          type: args.type || 'other', notes: args.notes || '', isDeadline: !!args.isDeadline,
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
      case 'remember_note': return `🧠 לזכור: <b>${UI.esc(args.note)}</b>`;
      case 'forget_note': return '🧠 מחיקת פתק מהזיכרון';
      default: return UI.esc(name);
    }
  }

  /* --- context --- */
  async function buildContext() {
    const [trips, members] = [await DB.all('trips'), await DB.all('members')];
    const ctx = {
      today: UI.todayISO(),
      family: members.map(m => ({ id: m.id, name: m.nameHe, nameEn: m.nameEn, age: UI.age(m.birthDate) })),
      trips: [],
    };
    // full detail only for current/upcoming trips; past trips shrink to a
    // summary line — keeps the prompt small as trips accumulate
    for (const t of trips) {
      const base = {
        id: t.id, name: t.name, destination: t.destination, start: t.startDate, end: t.endDate,
        travelers: (t.memberIds || []).map(id => members.find(m => m.id === id)?.nameHe).filter(Boolean),
      };
      const past = t.endDate && t.endDate < ctx.today;
      if (past) { ctx.trips.push({ ...base, past: true }); continue; }
      const expenses = await DB.byTrip('expenses', t.id);
      ctx.trips.push({
        ...base,
        documents: (await DB.byTrip('documents', t.id)).map(d => ({
          id: d.id, name: d.fileName, category: d.category, extracted: d.extracted || null,
        })),
        events: (await DB.byTrip('events', t.id)).map(e => ({
          id: e.id, date: e.date, time: e.time, title: e.title, type: e.type, isDeadline: e.isDeadline,
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

  async function systemPrompt() {
    const persona = (await DB.settings.get('agentPersona')) || DEFAULT_PERSONA;
    const notes = (await DB.settings.get('agentNotes')) || [];
    const memory = notes.length
      ? `\n\n--- הזיכרון שלך (עובדות ששמרת עם remember_note; מחיקה עם forget_note) ---\n${notes.map(n => `[${n.id}] ${n.note}`).join('\n')}`
      : '';
    return `${persona}${memory}\n\n--- נתוני האפליקציה (JSON) ---\n${JSON.stringify(await buildContext())}`;
  }

  /* --- UI --- */
  async function render() {
    const chipsEl = document.getElementById('agent-chips');
    chipsEl.innerHTML = CHIPS.map(c =>
      `<button class="agent-chip shrink-0 bg-white text-indigo-600 text-xs font-medium px-3.5 py-2 rounded-full shadow-sm ring-1 ring-indigo-100 active:scale-95">${c}</button>`).join('');
    chipsEl.querySelectorAll('.agent-chip').forEach(b => b.addEventListener('click', () => send(b.textContent)));
    if (busy) return; // אל תדרוס את הלוג באמצע תור
    if (!historyLoaded) await loadHistory();
    const log = document.getElementById('agent-log');
    log.innerHTML = '';
    // rebuild visible conversation from persisted history (text turns only)
    for (const turn of history) {
      const text = (turn.parts || []).filter(p => p.text).map(p => p.text).join('');
      if (!text) continue;
      addBubble(turn.role === 'user' ? 'user' : 'model', turn.role === 'user' ? UI.esc(text) : mdLite(text));
    }
    if (!log.children.length) {
      addBubble('model', 'היי! אני העוזר של Navigo 🛫 אפשר לשאול אותי על הטיולים, המסמכים והתוכניות — או ללחוץ על אחת הפעולות למעלה.');
    }
  }

  function addBubble(role, html) {
    const log = document.getElementById('agent-log');
    const el = document.createElement('div');
    el.className = role === 'user'
      ? 'self-start bg-indigo-600 text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap'
      : 'self-end bg-white text-slate-700 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm max-w-[85%] shadow-sm whitespace-pre-wrap';
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  const mdLite = (t) => UI.esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\* /gm, '• ');

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
    busy = true;
    if (!historyLoaded) await loadHistory();
    document.getElementById('agent-input').value = '';
    addBubble('user', UI.esc(text));
    history.push({ role: 'user', parts: [{ text }] });
    let bubble = addBubble('model', '<span class="text-slate-400">חושב…</span>');

    try {
      const system = await systemPrompt();
      for (let round = 0; round < 6; round++) {
        const data = await Gemini.chat(history, { system, tools: TOOLS });
        const content = data.candidates?.[0]?.content;
        if (!content) { bubble.innerHTML = 'לא התקבלה תשובה 🤔'; break; }
        history.push(content);

        const calls = (content.parts || []).filter(p => p.functionCall).map(p => p.functionCall);
        const modelText = Gemini.textOf(data);
        if (modelText) bubble.innerHTML = mdLite(modelText);
        else bubble.remove();
        if (!calls.length) break;

        const approved = await approvalCard(calls.map(c => ({ name: c.name, args: c.args || {} })));
        const responses = [];
        for (const c of calls) {
          const result = approved ? await execTool(c.name, c.args || {}) : { ok: false, error: 'user rejected the action' };
          responses.push({ functionResponse: { name: c.name, response: { result } } });
        }
        if (approved) {
          G.Sync.queue();
          document.dispatchEvent(new CustomEvent('tn-data-changed'));
        }
        history.push({ role: 'user', parts: responses });
        bubble = addBubble('model', '<span class="text-slate-400">ממשיך…</span>');
      }
    } catch (e) {
      console.error(e);
      bubble.innerHTML = `<span class="text-red-500">שגיאה: ${UI.esc(e.message)}</span>`;
    } finally {
      // keep history bounded, cutting only at a plain-text user turn so
      // functionCall/functionResponse pairs are never split
      if (history.length > 40) {
        let cut = history.length - 30;
        while (cut < history.length && !(history[cut].role === 'user' && history[cut].parts?.some(p => p.text))) cut++;
        history = history.slice(cut);
      }
      await saveHistory();
      busy = false;
    }
  }

  function init() {
    render();
    const form = document.getElementById('agent-form');
    form.addEventListener('submit', (e) => { e.preventDefault(); send(document.getElementById('agent-input').value); });
  }

  return { init, render, send, DEFAULT_PERSONA, CHIPS };
})();
window.Agent = Agent;
