/* TripNest — itinerary: day-by-day timeline, deadlines, auto-events from extracted docs. */
const Itinerary = (() => {

  // proposed itinerary events out of a document's extracted data (not saved yet)
  function eventsFromExtracted(trip, doc) {
    const x = doc.extracted;
    if (!x) return [];
    const out = [];
    const push = (ev) => { if (ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)) out.push({ tripId: trip.id, docId: doc.id, ...ev }); };
    (x.flights || []).forEach(f => {
      if (f.depDate) push({
        date: f.depDate, time: f.depTime || null, type: 'flight',
        title: `טיסה ${f.flightNo || ''} ${f.from || ''}${f.to ? ' → ' + f.to : ''}`.trim(),
        notes: [f.airline, x.confirmation ? `PNR: ${x.confirmation}` : ''].filter(Boolean).join(' · '),
      });
      if (f.arrDate && f.arrDate !== f.depDate) push({
        date: f.arrDate, time: f.arrTime || null, type: 'flight', title: `נחיתה ב${f.to || 'יעד'}`,
      });
    });
    if (x.checkIn) push({ date: x.checkIn, type: 'checkin', title: `צ׳ק-אין: ${x.title || x.provider || 'מלון'}`, notes: x.address || '' });
    if (x.checkOut) push({ date: x.checkOut, type: 'checkout', title: `צ׳ק-אאוט: ${x.title || x.provider || 'מלון'}` });
    (x.dates || []).forEach(d => push({ date: d.date, time: d.time || null, type: 'activity', title: d.label || x.title || 'אירוע' }));
    // dedupe against identical proposals
    const seen = new Set();
    return out.filter(e => { const k = `${e.date}|${e.time}|${e.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // computed (not stored) reminders, e.g. check-in opens 24h before each flight
  function computedDeadlines(events) {
    const out = [];
    events.filter(e => e.type === 'flight' && e.date && /^טיסה/.test(e.title || '')).forEach(e => {
      const d = UI.toDate(e.date); d.setDate(d.getDate() - 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (UI.daysUntil(iso) >= 0) out.push({
        id: 'auto-' + e.id, date: iso, time: e.time || null, type: 'deadline',
        title: `צ׳ק-אין אונליין נפתח — ${e.title}`, computed: true,
      });
    });
    return out;
  }

  const EVENT_TO_EXPENSE_CAT = { flight: 'flight', checkin: 'stay', checkout: 'stay', car: 'car', activity: 'attraction', food: 'food' };

  async function renderTab(trip, container) {
    const events = (await DB.byTrip('events', trip.id));
    const expByEvent = {};
    (await DB.byTrip('expenses', trip.id)).forEach(x => { if (x.eventId) expByEvent[x.eventId] = x; });
    const all = [...events, ...computedDeadlines(events)]
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));

    if (!all.length) {
      container.innerHTML = UI.emptyState('clock', 'אין עדיין תוכנית טיול', 'הוסיפו אירוע, חלצו נתונים ממסמך, או בקשו מהסוכן לבנות תוכנית') +
        `<div class="text-center"><button id="it-add-empty" class="bg-indigo-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl shadow-md active:scale-95">+ אירוע ראשון</button></div>`;
      document.getElementById('it-add-empty').addEventListener('click', () => editModal(trip));
      return;
    }

    const byDay = {};
    all.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
    const today = UI.todayISO();

    // gradient trip-summary banner
    const tripDays = trip.startDate && trip.endDate
      ? Math.round((UI.toDate(trip.endDate) - UI.toDate(trip.startDate)) / 86400000) + 1 : null;
    const banner = `
      <div class="rounded-3xl p-5 mb-5 text-white bg-gradient-to-l from-indigo-600 via-indigo-600 to-blue-600 shadow-lg shadow-indigo-600/20 flex items-end justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[11px] text-white/70 font-medium">מסלול הטיול</div>
          <div class="text-xl font-extrabold mt-0.5 truncate">${tripDays ? `${tripDays} ימים · ` : ''}${UI.esc(trip.name)}</div>
          ${trip.destination ? `<div class="text-xs text-white/80 mt-1.5 flex items-center gap-1">${UI.icon('pin', 'w-3.5 h-3.5')} <span class="truncate">${UI.esc(trip.destination)}</span></div>` : ''}
        </div>
        <div class="text-xs text-white/80 font-medium shrink-0">${all.length} אירועים</div>
      </div>`;

    container.innerHTML = banner + `<div class="space-y-5">` + Object.keys(byDay).sort().map(date => {
      const dayNum = trip.startDate ? Math.round((UI.toDate(date) - UI.toDate(trip.startDate)) / 86400000) + 1 : null;
      const d = UI.toDate(date);
      const evs = byDay[date];
      return `
      <div>
        <div class="flex items-center gap-3 mb-2.5 px-1">
          <span class="w-11 h-11 rounded-2xl ${date === today ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'} flex flex-col items-center justify-center shrink-0">
            <span class="text-[9px] font-medium ${date === today ? 'text-white/70' : 'text-slate-400'} leading-none mt-0.5">${UI.MONTHS_S[d.getMonth()]}</span>
            <span class="text-[15px] font-extrabold leading-tight">${d.getDate()}</span>
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold ${date === today ? 'text-indigo-600' : 'text-slate-800'}">${dayNum && dayNum > 0 ? `יום ${dayNum}` : UI.fmtDayHeader(date)}${date === today ? ' · היום' : ''}</div>
            ${dayNum && dayNum > 0 ? `<div class="text-[11px] text-slate-400">${UI.fmtDayHeader(date)}</div>` : ''}
          </div>
          <span class="text-[11px] text-slate-400 shrink-0">${evs.length} אירועים${(() => {
            const dt = UI.expenseTotals(evs.map(e => expByEvent[e.id]).filter(Boolean), trip.fxRates);
            const s = [dt.ils > 0 ? UI.fmtMoney(dt.ils) : '', Object.entries(dt.leftover).map(([c, v]) => UI.fmtMoney(v, c)).join(' + ')].filter(Boolean).join(' + ');
            return s ? ` · <span dir="ltr">${s}</span>` : '';
          })()}</span>
        </div>
        <div class="bg-white rounded-3xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          ${evs.map((e, i) => eventCard(e, i === evs.length - 1, expByEvent[e.id])).join('')}
        </div>
      </div>`;
    }).join('') + `</div>
      <div class="text-center mt-6"><button id="it-add" class="bg-white text-indigo-600 border border-indigo-100 text-sm font-medium px-5 py-2.5 rounded-xl shadow-sm active:scale-95">+ הוספת אירוע</button></div>`;

    document.getElementById('it-add').addEventListener('click', () => editModal(trip));
    container.querySelectorAll('[data-event]').forEach(b => b.addEventListener('click', async () => {
      const ev = events.find(e => e.id === b.dataset.event);
      if (ev) editModal(trip, ev);
    }));
    container.querySelectorAll('[data-eventdoc]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const doc = await DB.get('documents', b.dataset.eventdoc);
      if (doc) UI.viewer.open(doc);
    }));
  }

  function eventCard(e, last = false, cost = null) {
    const t = UI.eventType(e.type);
    const deadline = e.type === 'deadline' || e.isDeadline;
    const note = [e.notes ? UI.esc(e.notes) : '', e.computed ? 'תזכורת אוטומטית' : ''].filter(Boolean).join(' · ');
    return `
      <div class="flex gap-3">
        <div class="flex flex-col items-center shrink-0">
          <span class="w-10 h-10 rounded-xl ${deadline ? 'bg-amber-100 text-amber-600' : t.tint} flex items-center justify-center">${UI.icon(t.icon, 'w-[19px] h-[19px]')}</span>
          ${last ? '' : '<span class="w-px flex-1 bg-slate-100 my-1.5"></span>'}
        </div>
        <div class="flex-1 min-w-0 ${last ? '' : 'pb-4'}">
          <div class="flex items-start justify-between gap-2">
            <button class="min-w-0 text-right" ${e.computed ? '' : `data-event="${e.id}"`}>
              <span class="block text-sm font-semibold ${deadline ? 'text-amber-700' : 'text-slate-800'} truncate pt-0.5">${UI.esc(e.title)}</span>
            </button>
            <span class="flex items-center gap-2 shrink-0">
              ${e.docId ? `<button class="text-slate-300 -mt-0.5" data-eventdoc="${e.docId}" title="פתיחת המסמך">${UI.icon('doc', 'w-[18px] h-[18px]')}</button>` : ''}
              ${cost ? `<span class="text-[11px] text-slate-400 pt-1" dir="ltr">${UI.fmtMoney(cost.amount, UI.normCur(cost.currency))}</span>` : ''}
              ${e.time ? `<span class="text-[11px] text-slate-400 flex items-center gap-1 pt-1">${e.time} ${UI.icon('clock', 'w-3 h-3')}</span>` : ''}
            </span>
          </div>
          ${note ? `<div class="bg-slate-50 rounded-lg px-3 py-2 text-[11px] ${deadline ? 'text-amber-600' : 'text-slate-500'} mt-1.5">${note}</div>` : ''}
        </div>
      </div>`;
  }

  async function editModal(trip, ev = null) {
    const linked = ev ? (await DB.byTrip('expenses', trip.id)).find(x => x.eventId === ev.id) : null;
    UI.openModal({
      title: ev ? 'עריכת אירוע' : 'אירוע חדש',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-3">
          <div><label class="tn-label">כותרת *</label><input id="ev-title" class="tn-input" value="${UI.esc(ev?.title || '')}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0"><label class="tn-label">תאריך *</label><input id="ev-date" type="date" class="tn-input" value="${ev?.date || trip.startDate || ''}"></div>
            <div class="min-w-0"><label class="tn-label">שעה</label><input id="ev-time" type="time" class="tn-input" value="${ev?.time || ''}"></div>
          </div>
          <div><label class="tn-label">סוג</label>
            <select id="ev-type" class="tn-input">${UI.EVENT_TYPES.map(t => `<option value="${t.id}" ${ev?.type === t.id ? 'selected' : ''}>${t.he}</option>`).join('')}</select></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 min-w-0"><label class="tn-label">עלות (לא חובה)</label><input id="ev-cost" type="number" step="0.01" min="0" class="tn-input" dir="ltr" value="${linked?.amount ?? ''}" placeholder="נכנס לתקציב"></div>
            <div class="min-w-0"><label class="tn-label">מטבע</label><select id="ev-cur" class="tn-input">${UI.CURRENCIES.map(c => `<option ${UI.normCur(linked?.currency) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div><label class="tn-label">הערות</label><input id="ev-notes" class="tn-input" value="${UI.esc(ev?.notes || '')}"></div>
          <label class="flex items-center gap-2 text-sm text-slate-600"><input id="ev-deadline" type="checkbox" class="accent-indigo-600 w-4 h-4" ${ev?.isDeadline ? 'checked' : ''}> מועד חשוב (מודגש)</label>
          ${ev ? `<button id="ev-delete" class="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium mt-1">${UI.icon('trash', 'w-4 h-4')} מחיקת האירוע</button>` : ''}
        </div>`,
      onConfirm: async () => {
        const title = document.getElementById('ev-title').value.trim();
        const date = document.getElementById('ev-date').value;
        if (!title || !date) throw new Error('חסרים כותרת או תאריך');
        const saved = await DB.put('events', {
          ...(ev || { tripId: trip.id }), title, date,
          time: document.getElementById('ev-time').value || null,
          type: document.getElementById('ev-type').value,
          notes: document.getElementById('ev-notes').value.trim(),
          isDeadline: document.getElementById('ev-deadline').checked,
        });
        const amount = parseFloat(document.getElementById('ev-cost').value);
        if (amount > 0) {
          // reuse the doc-proposed expense when this event came from the same document
          const target = linked ||
            (saved.docId ? (await DB.byTrip('expenses', trip.id)).find(x => x.docId === saved.docId && !x.eventId) : null);
          await DB.put('expenses', {
            ...(target || { tripId: trip.id }), eventId: saved.id, title, amount,
            currency: document.getElementById('ev-cur').value,
            category: target?.category || EVENT_TO_EXPENSE_CAT[saved.type] || 'other',
            date, docId: saved.docId || target?.docId || null,
          });
        } else if (linked) {
          await DB.remove('expenses', linked.id);
        }
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('נשמר ✓', 'success');
      },
    });
    document.getElementById('ev-delete')?.addEventListener('click', () =>
      UI.confirm('למחוק את האירוע?', async () => {
        await DB.remove('events', ev.id);
        if (linked) await DB.remove('expenses', linked.id);
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('האירוע נמחק', 'success');
      }));
  }

  /* --- home-screen helpers --- */
  async function nextTrip() {
    const trips = await DB.all('trips');
    const today = UI.todayISO();
    const current = trips.filter(t => t.startDate && t.startDate <= today && (t.endDate || t.startDate) >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (current.length) return { trip: current[0], live: true };
    const upcoming = trips.filter(t => t.startDate && t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return upcoming.length ? { trip: upcoming[0], live: false } : null;
  }

  // documents + events relevant for a travel day ("boarding passes first")
  async function todayHighlights(trip) {
    const today = UI.todayISO();
    const events = (await DB.byTrip('events', trip.id)).filter(e => e.date === today)
      .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const docIds = new Set(events.map(e => e.docId).filter(Boolean));
    const docs = (await DB.byTrip('documents', trip.id)).filter(d => docIds.has(d.id) || (events.some(e => e.type === 'flight') && d.category === 'flight'));
    return { events, docs };
  }

  async function upcomingDeadlines(days = 14) {
    const trips = await DB.all('trips');
    const out = [];
    for (const t of trips) {
      const evs = await DB.byTrip('events', t.id);
      [...evs.filter(e => e.isDeadline || e.type === 'deadline'), ...computedDeadlines(evs)].forEach(e => {
        const du = UI.daysUntil(e.date);
        if (du >= 0 && du <= days) out.push({ ...e, tripName: t.name, daysUntil: du });
      });
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  return { renderTab, editModal, eventsFromExtracted, computedDeadlines, nextTrip, todayHighlights, upcomingDeadlines };
})();
window.Itinerary = Itinerary;
