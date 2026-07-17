/* TripNest — food: family food profile, meal planning per trip day (lunch/dinner slots),
   Google-Maps links with a manual "verified" step, and "hungry now" quick searches.
   Meals are regular timeline events (type:'food' + mealSlot) — one source of truth;
   the food tab and the timeline strip are two lenses over the same rows. */
const Food = (() => {

  const SLOTS = [
    { id: 'lunch', he: 'צהריים', defTime: '13:00' },
    { id: 'dinner', he: 'ערב', defTime: '19:30' },
  ];
  const slotHe = (id) => (SLOTS.find(s => s.id === id) || {}).he || 'ארוחה';

  /* --- settings (profile + favorites are shared; view mode is per-device) --- */
  const profile = async () => (await DB.settings.get('foodProfile')) || '';
  const favoritesRaw = async () => (await DB.settings.get('foodFavorites')) || 'פיצה נפוליטנית, פסטה, סלמון';
  const favorites = async () => (await favoritesRaw()).split(',').map(s => s.trim()).filter(Boolean);
  const viewMode = async () => ((await DB.settings.get('foodView')) === 'timeline' ? 'timeline' : 'tab');

  const mapsURL = (...parts) =>
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(parts.filter(Boolean).join(' '));

  /* --- plan math --- */
  function tripDays(trip) {
    if (!trip.startDate || !trip.endDate) return [];
    const out = [];
    const d = UI.toDate(trip.startDate), end = UI.toDate(trip.endDate);
    while (d <= end && out.length < 45) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const meals = (events) => events.filter(e => e.type === 'food' && e.mealSlot);
  const mealMap = (events) => {
    const m = {};
    meals(events).forEach(e => { m[`${e.date}|${e.mealSlot}`] = e; });
    return m;
  };

  function stats(trip, events) {
    const days = tripDays(trip), mm = mealMap(events);
    let closed = 0, unverified = 0;
    const est = {}, gaps = [];
    for (const d of days) for (const s of SLOTS) {
      const ev = mm[`${d}|${s.id}`];
      if (!ev) { gaps.push({ date: d, slot: s.id }); continue; }
      closed++;
      if (!ev.verified) unverified++;
      if (+ev.estCost > 0) { const c = UI.normCur(ev.estCur); est[c] = (est[c] || 0) + +ev.estCost; }
    }
    return { total: days.length * SLOTS.length, closed, unverified, est, gaps };
  }
  const fmtEst = (est) => Object.entries(est).map(([c, v]) => `~${UI.fmtMoney(v, c)}`).join(' + ');

  /* --- shared card pieces --- */
  const verifyBadge = (ev) => ev.verified
    ? `<button class="text-[10px] text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5 font-bold" data-food-verify="${ev.id}" title="נבדק במפות">מאומת ✓</button>`
    : `<button class="text-[10px] text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 font-bold" data-food-verify="${ev.id}" title="הקישו אחרי שבדקתם במפות">לוודא</button>`;

  const mapsBtn = (trip, ev) =>
    `<a class="text-[11px] text-blue-600 bg-blue-50 rounded-lg px-2 py-1 font-semibold" target="_blank" rel="noopener"
        href="${mapsURL(ev.title, ev.area, trip.destination)}">🗺 מפות</a>`;

  const estLabel = (ev) => +ev.estCost > 0
    ? `<span class="text-[11px] text-slate-500" dir="ltr">~${UI.fmtMoney(+ev.estCost, UI.normCur(ev.estCur))}</span>` : '';

  // action row shown under a meal, both in the food tab and inside the timeline
  const mealActionsHTML = (trip, ev) =>
    `<span class="flex items-center gap-1.5 flex-wrap mt-1.5">${verifyBadge(ev)}${mapsBtn(trip, ev)}${estLabel(ev)}</span>`;

  const gapRowHTML = (date, slot, compact = false) => `
    <div class="flex items-center justify-between gap-2 border-[1.5px] border-dashed border-amber-300 bg-amber-50/40 rounded-xl px-3 py-2"
         id="food-gap-${date}-${slot}">
      <span class="text-[12px] text-amber-700 font-medium">${slotHe(slot)} — אין תוכנית</span>
      <span class="flex gap-1.5">
        <button class="text-[11px] bg-indigo-50 text-indigo-600 rounded-lg px-2.5 py-1 font-semibold" data-food-add="${date}|${slot}">+ מסעדה</button>
        ${compact ? '' : `<button class="text-[11px] bg-blue-50 text-blue-600 rounded-lg px-2.5 py-1 font-semibold" data-food-maps="${slot}">🗺 מפות</button>`}
      </span>
    </div>`;

  /* --- the food tab (view mode 'tab') --- */
  async function renderTab(trip, container) {
    const events = await DB.byTrip('events', trip.id);
    const days = tripDays(trip);
    if (!days.length) {
      container.innerHTML = UI.emptyState('food', 'אין תאריכים לטיול', 'קבעו תאריכי התחלה וסיום לטיול כדי לתכנן ארוחות');
      return;
    }
    const st = stats(trip, events);
    const mm = mealMap(events);
    const favs = await favorites();
    const today = UI.todayISO();

    const chips = favs.map(f =>
      `<a class="shrink-0 bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs text-slate-700 shadow-sm" target="_blank" rel="noopener"
          href="${mapsURL(f, 'ליד ' + (trip.destination || ''))}">🍽️ ${UI.esc(f)}</a>`).join('');

    container.innerHTML = `
      <div class="rounded-3xl p-5 mb-4 text-white bg-gradient-to-l from-indigo-600 via-indigo-600 to-blue-600 shadow-lg shadow-indigo-600/20 flex items-end justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[11px] text-white/70 font-medium">תוכנית אוכל</div>
          <div class="text-xl font-extrabold mt-0.5">${st.closed} מתוך ${st.total} ארוחות סגורות</div>
          ${st.unverified ? `<div class="text-xs text-white/80 mt-1">${st.unverified} עוד לא אומתו במפות</div>` : ''}
        </div>
        ${Object.keys(st.est).length ? `<div class="text-xs text-white/85 font-semibold shrink-0" dir="ltr">${fmtEst(st.est)}</div>` : ''}
      </div>
      <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-4">
        <span class="shrink-0 text-xs text-slate-400 font-medium py-1.5">😋 רעבים עכשיו?</span>${chips}
      </div>
      <div class="space-y-5">
      ${days.map((date, i) => {
        const d = UI.toDate(date);
        return `
        <div>
          <div class="flex items-center gap-3 mb-2.5 px-1">
            <span class="w-11 h-11 rounded-2xl ${date === today ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'} flex flex-col items-center justify-center shrink-0">
              <span class="text-[9px] font-medium ${date === today ? 'text-white/70' : 'text-slate-400'} leading-none mt-0.5">${UI.MONTHS_S[d.getMonth()]}</span>
              <span class="text-[15px] font-extrabold leading-tight">${d.getDate()}</span>
            </span>
            <div class="text-sm font-bold ${date === today ? 'text-indigo-600' : 'text-slate-800'}">יום ${i + 1}${date === today ? ' · היום' : ''}</div>
          </div>
          <div class="bg-white rounded-3xl px-4 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] divide-y divide-slate-100">
            <div class="flex items-center gap-3 py-3">
              <span class="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">☕️</span>
              <div><div class="text-[10px] text-slate-400 font-semibold">בוקר</div><div class="text-sm text-slate-400">ארוחת בוקר במלון</div></div>
            </div>
            ${SLOTS.map(s => {
              const ev = mm[`${date}|${s.id}`];
              if (!ev) return `<div class="py-3">${gapRowHTML(date, s.id)}</div>`;
              return `
              <div class="flex gap-3 py-3">
                <span class="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">🍽️</span>
                <div class="flex-1 min-w-0">
                  <button class="block text-right w-full" data-food-edit="${ev.id}">
                    <span class="block text-[10px] text-slate-400 font-semibold">${s.he}${ev.time ? ' · ' + ev.time : ''}</span>
                    <span class="block text-sm font-semibold text-slate-800">${UI.esc(ev.title)}</span>
                    ${ev.area || ev.notes ? `<span class="block text-[11px] text-slate-400 mt-0.5">${UI.esc([ev.area, ev.notes].filter(Boolean).join(' · '))}</span>` : ''}
                  </button>
                  ${mealActionsHTML(trip, ev)}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
      </div>
      <div class="text-center mt-6 mb-2">
        <button id="food-add-free" class="bg-white text-indigo-600 border border-indigo-100 text-sm font-medium px-5 py-2.5 rounded-xl shadow-sm active:scale-95">+ הוספת ארוחה</button>
      </div>`;

    document.getElementById('food-add-free').addEventListener('click', () => mealModal(trip, {}));
    bind(container, trip, events);
  }

  /* --- timeline-mode pieces (view mode 'timeline') --- */
  function stripHTML(st) {
    if (!st.total) return '';
    const g = st.gaps[0];
    const sub = g
      ? `חסרה תוכנית ל${slotHe(g.slot)} · ${UI.fmtDateShort(g.date)}`
      : (st.unverified ? `${st.unverified} ארוחות עוד לא אומתו במפות` : 'כל הארוחות סגורות 🎉');
    return `
      <button id="food-strip" class="w-full text-right bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between gap-2">
        <span class="min-w-0">
          <span class="block text-[13px] font-bold text-orange-900">🍽️ אוכל: ${st.closed} מתוך ${st.total} ארוחות סגורות${Object.keys(st.est).length ? ` · <span dir="ltr">${fmtEst(st.est)}</span>` : ''}</span>
          <span class="block text-[11px] text-orange-700 mt-0.5">${sub}</span>
        </span>
        <span class="text-orange-500 shrink-0">◂</span>
      </button>`;
  }

  function bindStrip(container) {
    document.getElementById('food-strip')?.addEventListener('click', () => {
      container.querySelector('[id^="food-gap-"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /* --- shared bindings for meal actions (used by the tab and by the timeline) --- */
  function bind(container, trip, events) {
    container.querySelectorAll('[data-food-edit]').forEach(b => b.addEventListener('click', () => {
      const ev = events.find(e => e.id === b.dataset.foodEdit);
      if (ev) mealModal(trip, { ev });
    }));
    container.querySelectorAll('[data-food-add]').forEach(b => b.addEventListener('click', () => {
      const [date, slot] = b.dataset.foodAdd.split('|');
      mealModal(trip, { date, slot });
    }));
    container.querySelectorAll('[data-food-verify]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ev = await DB.get('events', b.dataset.foodVerify);
      if (!ev) return;
      ev.verified = !ev.verified;
      await DB.put('events', ev);
      G.Sync.queue();
      document.dispatchEvent(new CustomEvent('tn-data-changed'));
    }));
    container.querySelectorAll('[data-food-maps]').forEach(b => b.addEventListener('click', async () => {
      const favs = await favorites();
      window.open(mapsURL(favs[0] || 'מסעדה צמחונית', 'ליד ' + (trip.destination || '')), '_blank', 'noopener');
    }));
  }

  /* --- add/edit meal modal (writes a type:'food' timeline event) --- */
  function mealModal(trip, { ev = null, date = null, slot = null } = {}) {
    const days = tripDays(trip);
    const curDate = ev?.date || date || days[0] || UI.todayISO();
    const curSlot = ev?.mealSlot || slot || 'dinner';
    UI.openModal({
      title: ev ? 'עריכת ארוחה' : 'הוספת ארוחה',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-3">
          <div><label class="tn-label">מסעדה / מקום *</label><input id="fm-name" class="tn-input" value="${UI.esc(ev?.title || '')}" placeholder="למשל: Granello"></div>
          <div><label class="tn-label">אזור / כתובת</label><input id="fm-area" class="tn-input" value="${UI.esc(ev?.area || '')}" placeholder="שכונה או רחוב — משפר את קישור המפות"></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 min-w-0"><label class="tn-label">תאריך *</label><input id="fm-date" type="date" class="tn-input" value="${curDate}"></div>
            <div class="min-w-0"><label class="tn-label">שעה</label><input id="fm-time" type="time" class="tn-input" value="${ev?.time || (SLOTS.find(s => s.id === curSlot)?.defTime || '')}"></div>
          </div>
          <div><label class="tn-label">ארוחה</label>
            <select id="fm-slot" class="tn-input">${SLOTS.map(s => `<option value="${s.id}" ${curSlot === s.id ? 'selected' : ''}>${s.he}</option>`).join('')}</select></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 min-w-0"><label class="tn-label">עלות משוערת למשפחה</label><input id="fm-est" type="number" step="1" min="0" class="tn-input" dir="ltr" value="${ev?.estCost ?? ''}"></div>
            <div class="min-w-0"><label class="tn-label">מטבע</label><select id="fm-cur" class="tn-input">${UI.CURRENCIES.map(c => `<option ${UI.normCur(ev?.estCur) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div><label class="tn-label">הערות (מה אוכלים שם?)</label><input id="fm-notes" class="tn-input" value="${UI.esc(ev?.notes || '')}" placeholder="פיצה נפוליטנית, תנור עצים"></div>
          <label class="flex items-center gap-2 text-sm text-slate-600"><input id="fm-verified" type="checkbox" class="accent-emerald-600 w-4 h-4" ${ev?.verified ? 'checked' : ''}> בדקתי במפות — קיים ופתוח ✓</label>
          ${ev ? `<button id="fm-delete" class="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium mt-1">${UI.icon('trash', 'w-4 h-4')} מחיקת הארוחה</button>` : ''}
        </div>`,
      onConfirm: async () => {
        const title = document.getElementById('fm-name').value.trim();
        const evDate = document.getElementById('fm-date').value;
        if (!title) throw new Error('חסר שם מסעדה');
        if (!evDate) throw new Error('חסר תאריך');
        const est = parseFloat(document.getElementById('fm-est').value);
        await DB.put('events', {
          ...(ev || { tripId: trip.id }), type: 'food', title,
          date: evDate,
          time: document.getElementById('fm-time').value || null,
          mealSlot: document.getElementById('fm-slot').value,
          area: document.getElementById('fm-area').value.trim(),
          estCost: est > 0 ? est : null,
          estCur: document.getElementById('fm-cur').value,
          notes: document.getElementById('fm-notes').value.trim(),
          verified: document.getElementById('fm-verified').checked,
        });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('הארוחה נשמרה ✓', 'success');
      },
    });
    document.getElementById('fm-delete')?.addEventListener('click', () =>
      UI.confirm('למחוק את הארוחה מהתוכנית?', async () => {
        UI.closeModal();
        await DB.remove('events', ev.id);
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
      }));
  }

  return { renderTab, mealModal, stats, stripHTML, bindStrip, bind, mealActionsHTML, gapRowHTML, slotHe, viewMode, profile, favoritesRaw, mapsURL, tripDays };
})();
window.Food = Food;
