/* TripNest — trips: list, trip dashboard (tabs: documents / timeline / checklist / budget). */
const Trips = (() => {
  let _activeTripId = null;
  let _activeTab = 'docs';
  const EMOJIS = ['🏝️', '🏔️', '🏙️', '🎡', '🎿', '🏛️', '🌋', '🏖️', '🚢', '🎌', '🗽', '🐪'];

  const activeTripId = () => _activeTripId;

  /* ---------- trips list ---------- */
  async function renderList() {
    const el = document.getElementById('trips-list');
    const trips = await DB.all('trips');
    const members = await DB.all('members');
    const today = UI.todayISO();
    const upcoming = trips.filter(t => !t.endDate || t.endDate >= today).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const past = trips.filter(t => t.endDate && t.endDate < today).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    const card = (t) => {
      const travelers = Members.sorted((t.memberIds || []).map(id => members.find(m => m.id === id)).filter(Boolean));
      const du = t.startDate ? UI.daysUntil(t.startDate) : null;
      const pill = du === null ? '' : du > 0 ? `בעוד ${du} ימים` : (t.endDate && t.endDate >= today ? 'עכשיו בטיול ✈️' : 'הסתיים');
      return `
      <button class="trip-card w-full text-right relative min-h-[150px] rounded-[1.75rem] overflow-hidden shadow-lg active:scale-[0.98] transition" data-trip="${t.id}">
        ${t.coverImage
          ? `<img src="${t.coverImage}" class="absolute inset-0 w-full h-full object-cover">`
          : `<div class="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-7xl opacity-90">${t.coverEmoji || '🧳'}</div>`}
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"></div>
        ${pill ? `<span class="absolute top-3 left-3 bg-white/20 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full">${pill}</span>` : ''}
        <div class="absolute bottom-0 right-0 left-0 p-4 flex items-end justify-between">
          <div>
            <div class="text-white text-xl font-bold">${UI.esc(t.name)}</div>
            <div class="text-white/80 text-xs mt-0.5">${UI.esc(t.destination || '')}${t.destination && t.startDate ? ' · ' : ''}${UI.fmtDateRange(t.startDate, t.endDate)}</div>
          </div>
          <div class="flex -space-x-2 space-x-reverse">${travelers.slice(0, 4).map(m => UI.avatarHTML(m, 'w-8 h-8', 'ring-2 ring-white/60')).join('')}</div>
        </div>
      </button>`;
    };

    el.innerHTML = `
      ${upcoming.length ? upcoming.map(card).join('') : UI.emptyState('luggage', 'אין טיולים מתוכננים', 'לחצו על + כדי לפתוח מחיצת חופשה חדשה')}
      ${past.length ? `<h3 class="text-sm font-bold text-slate-400 mt-6 mb-1">טיולים שהיו 💫</h3>${past.map(card).join('')}` : ''}`;
    el.querySelectorAll('.trip-card').forEach(b => b.addEventListener('click', () => App.navigate('trip', b.dataset.trip)));
  }

  /* ---------- add / edit ---------- */
  async function editModal(trip = null) {
    let cover = trip?.coverImage || null;
    const pickerHTML = await Members.pickerHTML(trip?.memberIds || (await DB.all('members')).map(m => m.id));
    UI.openModal({
      title: trip ? 'עריכת טיול' : 'חופשה חדשה 🎉',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-3">
          <div><label class="tn-label">שם הטיול *</label><input id="tf-name" class="tn-input" placeholder="למשל: סנטוריני 2026" value="${UI.esc(trip?.name || '')}"></div>
          <div><label class="tn-label">יעד</label><input id="tf-dest" class="tn-input" placeholder="עיר, מדינה" value="${UI.esc(trip?.destination || '')}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="tn-label">תאריך יציאה</label><input id="tf-start" type="date" class="tn-input" value="${trip?.startDate || ''}"></div>
            <div><label class="tn-label">תאריך חזרה</label><input id="tf-end" type="date" class="tn-input" value="${trip?.endDate || ''}"></div>
          </div>
          <div><label class="tn-label">מי נוסע?</label><div id="tf-members">${pickerHTML}</div></div>
          <div><label class="tn-label">תמונת החופשה</label>
            <div id="tf-cover-preview" class="relative w-full h-28 rounded-2xl overflow-hidden mb-2 ${cover ? '' : 'hidden'}">
              <img id="tf-cover-img" src="${cover || ''}" class="w-full h-full object-cover">
              <button type="button" id="tf-cover-remove" class="absolute top-2 left-2 bg-black/60 text-white w-7 h-7 rounded-full text-xs">✕</button>
            </div>
            <div class="flex gap-2">
              <button type="button" id="tf-cover-btn" class="tn-btn-secondary flex-1 !text-xs">${UI.icon('image', 'w-3.5 h-3.5')} ${cover ? 'החלפת תמונה' : 'בחירת תמונה'}</button>
              <button type="button" id="tf-cover-camera" class="tn-btn-secondary flex-1 !text-xs">${UI.icon('camera', 'w-3.5 h-3.5')} צילום</button>
            </div>
            <input type="file" id="tf-cover" accept="image/*" class="hidden">
            <input type="file" id="tf-cover-cam" accept="image/*" capture="environment" class="hidden">
          </div>
          <div><label class="tn-label">או אימוג׳י (כשאין תמונה)</label>
            <div class="flex flex-wrap gap-1.5">${EMOJIS.map(e => `<button type="button" class="tf-emoji text-xl p-1.5 rounded-xl ${trip?.coverEmoji === e ? 'bg-indigo-100' : 'bg-slate-50'}" data-e="${e}">${e}</button>`).join('')}</div>
          </div>
          ${trip ? `<button id="tf-delete" class="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium">${UI.icon('trash', 'w-4 h-4')} מחיקת הטיול</button>` : ''}
        </div>`,
      onConfirm: async () => {
        const name = document.getElementById('tf-name').value.trim();
        if (!name) throw new Error('חסר שם לטיול');
        const start = document.getElementById('tf-start').value || null;
        const end = document.getElementById('tf-end').value || null;
        if (start && end && end < start) throw new Error('תאריך החזרה לפני היציאה');
        const saved = await DB.put('trips', {
          ...(trip || {}), name,
          destination: document.getElementById('tf-dest').value.trim(),
          startDate: start, endDate: end,
          memberIds: Members.pickedIds(document.getElementById('tf-members')),
          coverEmoji: document.querySelector('.tf-emoji.bg-indigo-100')?.dataset.e || trip?.coverEmoji || '🧳',
          coverImage: cover,
        });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('הטיול נשמר ✓', 'success');
        if (!trip) App.navigate('trip', saved.id);
      },
    });
    Members.wirePicker(document.getElementById('tf-members'));
    document.querySelectorAll('.tf-emoji').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tf-emoji').forEach(x => x.classList.remove('bg-indigo-100'));
      b.classList.add('bg-indigo-100'); b.classList.remove('bg-slate-50');
    }));
    const setCover = async (file) => {
      if (!file) return;
      cover = await UI.fileToDataURL(file, 1000, 0.75);
      document.getElementById('tf-cover-img').src = cover;
      document.getElementById('tf-cover-preview').classList.remove('hidden');
      document.getElementById('tf-cover-btn').innerHTML = `${UI.icon('image', 'w-3.5 h-3.5')} החלפת תמונה`;
    };
    document.getElementById('tf-cover-btn').addEventListener('click', () => document.getElementById('tf-cover').click());
    document.getElementById('tf-cover-camera').addEventListener('click', () => document.getElementById('tf-cover-cam').click());
    document.getElementById('tf-cover').addEventListener('change', (e) => setCover(e.target.files[0]));
    document.getElementById('tf-cover-cam').addEventListener('change', (e) => setCover(e.target.files[0]));
    document.getElementById('tf-cover-remove').addEventListener('click', () => {
      cover = null;
      document.getElementById('tf-cover-preview').classList.add('hidden');
      document.getElementById('tf-cover-btn').innerHTML = `${UI.icon('image', 'w-3.5 h-3.5')} בחירת תמונה`;
    });
    document.getElementById('tf-delete')?.addEventListener('click', () =>
      UI.confirm(`למחוק את "${trip.name}" על כל המסמכים והתוכנית שלו?`, async () => {
        for (const st of ['documents', 'events', 'checklists', 'expenses'])
          for (const r of await DB.byTrip(st, trip.id)) await DB.remove(st, r.id);
        await DB.remove('trips', trip.id);
        G.Sync.queue();
        UI.toast('הטיול נמחק', 'success');
        App.navigate('trips');
      }));
  }

  /* ---------- single trip view ---------- */
  async function renderTrip(tripId) {
    const trip = await DB.get('trips', tripId);
    if (!trip || trip.deleted) { App.navigate('trips'); return; }
    _activeTripId = tripId;
    const members = await DB.all('members');
    const travelers = Members.sorted((trip.memberIds || []).map(id => members.find(m => m.id === id)).filter(Boolean));

    document.getElementById('trip-title').textContent = trip.name;
    document.getElementById('trip-sub').textContent =
      [trip.destination, UI.fmtDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ');
    document.getElementById('trip-travelers').innerHTML =
      travelers.map(m => UI.avatarHTML(m, 'w-5 h-5 !text-[8px]', 'ring-2 ring-white')).join('');
    document.getElementById('trip-edit').onclick = () => editModal(trip);

    const tabs = document.querySelectorAll('#trip-tabs button');
    tabs.forEach(b => {
      b.classList.toggle('tab-active', b.dataset.tab === _activeTab);
      b.onclick = () => { _activeTab = b.dataset.tab; renderTrip(tripId); };
    });

    const panel = document.getElementById('trip-panel');
    panel.innerHTML = '<div class="py-10 text-center text-slate-300">טוען…</div>';
    if (_activeTab === 'docs') await Documents.renderTab(trip, panel);
    else if (_activeTab === 'timeline') await Itinerary.renderTab(trip, panel);
    else if (_activeTab === 'checklist') await renderChecklist(trip, panel);
    else if (_activeTab === 'budget') await renderBudget(trip, panel);

    const fab = document.getElementById('trip-fab');
    fab.onclick = () => {
      if (_activeTab === 'timeline') Itinerary.editModal(trip);
      else if (_activeTab === 'checklist') addChecklistModal(trip);
      else if (_activeTab === 'budget') expenseModal(trip);
      else addDocChooser(trip);
    };
  }

  function addDocChooser(trip) {
    UI.openModal({
      title: 'הוספת מסמך',
      hideConfirm: true,
      bodyHTML: `
        <div class="space-y-2">
          <button id="ad-file" class="tn-menu-btn">${UI.icon('folder', 'w-4 h-4')} בחירת קבצים (PDF / תמונה)</button>
          <button id="ad-camera" class="tn-menu-btn">${UI.icon('camera', 'w-4 h-4')} צילום מסמך</button>
          <button id="ad-email" class="tn-menu-btn">${UI.icon('mail', 'w-4 h-4')} ייבוא מהמייל</button>
        </div>`,
    });
    document.getElementById('ad-file').addEventListener('click', () => { UI.closeModal(); Documents.addFlow(trip); });
    document.getElementById('ad-camera').addEventListener('click', () => { UI.closeModal(); Documents.addFlow(trip, { capture: true }); });
    document.getElementById('ad-email').addEventListener('click', () => { UI.closeModal(); Documents.emailImport(trip); });
  }

  /* ---------- checklist tab ---------- */
  async function renderChecklist(trip, panel) {
    const lists = await DB.byTrip('checklists', trip.id);
    if (!lists.length) {
      panel.innerHTML = UI.emptyState('list', 'אין עדיין רשימות', 'צרו רשימת אריזה או משימות — או בקשו מהסוכן להכין אחת') +
        `<div class="text-center"><button id="cl-add-empty" class="bg-indigo-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl shadow-md active:scale-95">+ רשימה חדשה</button></div>`;
      document.getElementById('cl-add-empty').addEventListener('click', () => addChecklistModal(trip));
      return;
    }
    panel.innerHTML = lists.map(l => {
      const done = l.items.filter(i => i.done).length;
      return `
      <div class="bg-white rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4" data-list="${l.id}">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-slate-800">${UI.esc(l.title)}</h4>
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-slate-400">${done}/${l.items.length}</span>
            <button class="cl-del text-slate-300" data-id="${l.id}">${UI.icon('trash', 'w-4 h-4')}</button>
          </div>
        </div>
        <div class="space-y-1.5">${l.items.map(i => `
          <div class="flex items-center gap-2.5 py-1">
            <input type="checkbox" class="cl-item accent-indigo-600 w-4 h-4 rounded" data-list="${l.id}" data-item="${i.id}" ${i.done ? 'checked' : ''}>
            <button type="button" class="cl-item-text flex-1 text-right text-sm ${i.done ? 'line-through text-slate-300' : 'text-slate-700'}" data-list="${l.id}" data-item="${i.id}">${UI.esc(i.text)}</button>
          </div>`).join('')}</div>
        <form class="cl-add-form flex gap-2 mt-3" data-list="${l.id}">
          <input class="tn-input !py-2 text-sm flex-1" placeholder="פריט חדש…">
          <button class="bg-slate-100 text-slate-600 px-3.5 rounded-xl text-sm font-medium">+</button>
        </form>
      </div>`;
    }).join('');

    panel.querySelectorAll('.cl-item').forEach(c => c.addEventListener('change', async () => {
      const l = await DB.get('checklists', c.dataset.list);
      const it = l.items.find(i => i.id === c.dataset.item);
      if (it) { it.done = c.checked; await DB.put('checklists', l); G.Sync.queue(); renderChecklist(trip, panel); }
    }));
    panel.querySelectorAll('.cl-add-form').forEach(f => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = f.querySelector('input').value.trim();
      if (!text) return;
      const l = await DB.get('checklists', f.dataset.list);
      l.items.push({ id: DB.uid(), text, done: false });
      await DB.put('checklists', l); G.Sync.queue();
      renderChecklist(trip, panel);
    }));
    panel.querySelectorAll('.cl-item-text').forEach(b => b.addEventListener('click', () =>
      editChecklistItemModal(trip, panel, b.dataset.list, b.dataset.item)));
    panel.querySelectorAll('.cl-del').forEach(b => b.addEventListener('click', () =>
      UI.confirm('למחוק את הרשימה?', async () => { await DB.remove('checklists', b.dataset.id); G.Sync.queue(); renderChecklist(trip, panel); })));
  }

  async function editChecklistItemModal(trip, panel, listId, itemId) {
    const l = await DB.get('checklists', listId);
    const it = l?.items.find(i => i.id === itemId);
    if (!it) return;
    UI.openModal({
      title: 'עריכת פריט',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div><label class="tn-label">שם הפריט</label><input id="cli-text" class="tn-input" value="${UI.esc(it.text)}"></div>
        <button id="cli-delete" class="mt-4 w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium">${UI.icon('trash', 'w-4 h-4')} הסרת הפריט מהרשימה</button>`,
      onConfirm: async () => {
        const text = document.getElementById('cli-text').value.trim();
        if (!text) throw new Error('חסר שם לפריט');
        it.text = text;
        await DB.put('checklists', l); G.Sync.queue();
        renderChecklist(trip, panel);
      },
    });
    document.getElementById('cli-delete').addEventListener('click', async () => {
      l.items = l.items.filter(i => i.id !== itemId);
      await DB.put('checklists', l); G.Sync.queue();
      UI.closeModal();
      UI.toast('הפריט הוסר ✓', 'success');
      renderChecklist(trip, panel);
    });
  }

  function addChecklistModal(trip) {
    UI.openModal({
      title: 'רשימה חדשה',
      confirmLabel: 'יצירה',
      bodyHTML: `
        <div><label class="tn-label">שם הרשימה</label><input id="cl-title" class="tn-input" value="רשימת אריזה" placeholder="למשל: רשימת אריזה"></div>
        <p class="text-[11px] text-slate-400 mt-2">💡 טיפ: הסוכן יכול להכין רשימת אריזה מותאמת ליעד ולעונה — בקשו ממנו.</p>`,
      onConfirm: async () => {
        const title = document.getElementById('cl-title').value.trim() || 'רשימה';
        await DB.put('checklists', { tripId: trip.id, title, items: [] });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
      },
    });
  }

  /* ---------- budget tab ---------- */
  async function renderBudget(trip, panel) {
    const expenses = await DB.byTrip('expenses', trip.id);
    const members = await DB.all('members');
    const byCur = {};
    expenses.forEach(x => byCur[x.currency || '₪'] = (byCur[x.currency || '₪'] || 0) + Number(x.amount || 0));

    panel.innerHTML = `
      <div class="bg-white rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4 text-center">
        <div class="text-xs text-slate-400 mb-1">סה״כ הוצאות בטיול</div>
        <div class="text-2xl font-bold text-slate-800">${Object.keys(byCur).length ? Object.entries(byCur).map(([c, v]) => UI.fmtMoney(v, c)).join(' + ') : UI.fmtMoney(0)}</div>
      </div>
      ${expenses.length ? `<div class="space-y-2.5">${expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(x => {
        const payer = members.find(m => m.id === x.payerId);
        return `
        <button class="exp-item w-full bg-white rounded-2xl p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-3 text-right" data-id="${x.id}">
          <span class="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-lg shrink-0">💸</span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-semibold text-slate-800 truncate">${UI.esc(x.title)}</span>
            <span class="block text-[11px] text-slate-400">${x.date ? UI.fmtDateShort(x.date) : ''}${payer ? ' · שילם/ה: ' + UI.esc(payer.nameHe) : ''}</span>
          </span>
          <span class="font-bold text-slate-700 text-sm shrink-0" dir="ltr">${UI.fmtMoney(x.amount, x.currency || '₪')}</span>
        </button>`;
      }).join('')}</div>` : UI.emptyState('wallet', 'אין עדיין הוצאות', 'הוסיפו עם כפתור ה-+')}`;
    panel.querySelectorAll('.exp-item').forEach(b => b.addEventListener('click', async () =>
      expenseModal(trip, await DB.get('expenses', b.dataset.id))));
  }

  async function expenseModal(trip, x = null) {
    const members = await DB.all('members');
    UI.openModal({
      title: x ? 'עריכת הוצאה' : 'הוצאה חדשה',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-3">
          <div><label class="tn-label">תיאור *</label><input id="xf-title" class="tn-input" value="${UI.esc(x?.title || '')}"></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2"><label class="tn-label">סכום *</label><input id="xf-amount" type="number" step="0.01" min="0" class="tn-input" dir="ltr" value="${x?.amount ?? ''}"></div>
            <div><label class="tn-label">מטבע</label><select id="xf-cur" class="tn-input">${['₪', '€', '$', '£'].map(c => `<option ${x?.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="tn-label">תאריך</label><input id="xf-date" type="date" class="tn-input" value="${x?.date || UI.todayISO()}"></div>
            <div><label class="tn-label">מי שילם/ה</label><select id="xf-payer" class="tn-input"><option value="">—</option>${members.map(m => `<option value="${m.id}" ${x?.payerId === m.id ? 'selected' : ''}>${UI.esc(m.nameHe)}</option>`).join('')}</select></div>
          </div>
          ${x ? `<button id="xf-delete" class="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-medium">${UI.icon('trash', 'w-4 h-4')} מחיקה</button>` : ''}
        </div>`,
      onConfirm: async () => {
        const title = document.getElementById('xf-title').value.trim();
        const amount = parseFloat(document.getElementById('xf-amount').value);
        if (!title || !(amount >= 0)) throw new Error('חסרים תיאור או סכום');
        await DB.put('expenses', {
          ...(x || { tripId: trip.id }), title, amount,
          currency: document.getElementById('xf-cur').value,
          date: document.getElementById('xf-date').value || null,
          payerId: document.getElementById('xf-payer').value || null,
        });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
      },
    });
    document.getElementById('xf-delete')?.addEventListener('click', () =>
      UI.confirm('למחוק את ההוצאה?', async () => {
        await DB.remove('expenses', x.id); G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
      }));
  }

  return { renderList, renderTrip, editModal, activeTripId };
})();
window.Trips = Trips;
