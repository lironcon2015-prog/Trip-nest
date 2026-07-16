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

  async function renderTab(trip, container) {
    const events = (await DB.byTrip('events', trip.id));
    const all = [...events, ...computedDeadlines(events)]
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));

    if (!all.length) {
      container.innerHTML = UI.emptyState('🗓️', 'אין עדיין תוכנית טיול', 'הוסיפו אירוע, חלצו נתונים ממסמך, או בקשו מהסוכן לבנות תוכנית') +
        `<div class="text-center"><button id="it-add-empty" class="bg-indigo-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl shadow-md active:scale-95">+ אירוע ראשון</button></div>`;
      document.getElementById('it-add-empty').addEventListener('click', () => editModal(trip));
      return;
    }

    const byDay = {};
    all.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
    const today = UI.todayISO();

    container.innerHTML = `<div class="space-y-5">` + Object.keys(byDay).sort().map(date => {
      const dayNum = trip.startDate ? Math.round((UI.toDate(date) - UI.toDate(trip.startDate)) / 86400000) + 1 : null;
      return `
      <div>
        <div class="flex items-center gap-2 mb-2 ${date === today ? 'text-indigo-600' : 'text-slate-500'}">
          <span class="text-sm font-bold">${UI.fmtDayHeader(date)}</span>
          ${dayNum && dayNum > 0 ? `<span class="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full">יום ${dayNum}</span>` : ''}
          ${date === today ? '<span class="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full">היום</span>' : ''}
        </div>
        <div class="border-r-2 ${date === today ? 'border-indigo-200' : 'border-slate-100'} pr-4 space-y-2.5">
          ${byDay[date].map(e => eventCard(e)).join('')}
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

  function eventCard(e) {
    const t = UI.eventType(e.type);
    const deadline = e.type === 'deadline' || e.isDeadline;
    return `
      <div class="rounded-2xl p-3.5 flex items-center gap-3 ${deadline ? 'bg-amber-50' : 'bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]'}">
        <span class="text-xl shrink-0">${t.emoji}</span>
        <button class="flex-1 min-w-0 text-right" ${e.computed ? '' : `data-event="${e.id}"`}>
          <span class="block text-sm font-semibold ${deadline ? 'text-amber-800' : 'text-slate-800'} truncate">${UI.esc(e.title)}</span>
          <span class="block text-[11px] ${deadline ? 'text-amber-600' : 'text-slate-400'}">${e.time || ''}${e.notes ? (e.time ? ' · ' : '') + UI.esc(e.notes) : ''}${e.computed ? ' · תזכורת אוטומטית' : ''}</span>
        </button>
        ${e.docId ? `<button class="text-lg shrink-0" data-eventdoc="${e.docId}" title="פתיחת המסמך">📎</button>` : ''}
      </div>`;
  }

  function editModal(trip, ev = null) {
    UI.openModal({
      title: ev ? 'עריכת אירוע' : 'אירוע חדש',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-3">
          <div><label class="tn-label">כותרת *</label><input id="ev-title" class="tn-input" value="${UI.esc(ev?.title || '')}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="tn-label">תאריך *</label><input id="ev-date" type="date" class="tn-input" value="${ev?.date || trip.startDate || ''}"></div>
            <div><label class="tn-label">שעה</label><input id="ev-time" type="time" class="tn-input" value="${ev?.time || ''}"></div>
          </div>
          <div><label class="tn-label">סוג</label>
            <select id="ev-type" class="tn-input">${UI.EVENT_TYPES.map(t => `<option value="${t.id}" ${ev?.type === t.id ? 'selected' : ''}>${t.emoji} ${t.he}</option>`).join('')}</select></div>
          <div><label class="tn-label">הערות</label><input id="ev-notes" class="tn-input" value="${UI.esc(ev?.notes || '')}"></div>
          <label class="flex items-center gap-2 text-sm text-slate-600"><input id="ev-deadline" type="checkbox" class="accent-indigo-600 w-4 h-4" ${ev?.isDeadline ? 'checked' : ''}> ⏰ מועד חשוב (מודגש)</label>
          ${ev ? '<button id="ev-delete" class="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium mt-1">🗑️ מחיקת האירוע</button>' : ''}
        </div>`,
      onConfirm: async () => {
        const title = document.getElementById('ev-title').value.trim();
        const date = document.getElementById('ev-date').value;
        if (!title || !date) throw new Error('חסרים כותרת או תאריך');
        await DB.put('events', {
          ...(ev || { tripId: trip.id }), title, date,
          time: document.getElementById('ev-time').value || null,
          type: document.getElementById('ev-type').value,
          notes: document.getElementById('ev-notes').value.trim(),
          isDeadline: document.getElementById('ev-deadline').checked,
        });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('נשמר ✓', 'success');
      },
    });
    document.getElementById('ev-delete')?.addEventListener('click', () =>
      UI.confirm('למחוק את האירוע?', async () => {
        await DB.remove('events', ev.id); G.Sync.queue();
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
