/* TripNest — router, home screen, bootstrap. */
const App = (() => {
  let current = 'home';

  const VIEWS = ['home', 'trips', 'trip', 'agent', 'settings'];
  const NAV_MAP = { home: 'home', trips: 'trips', trip: 'trips', agent: 'agent', settings: 'settings' };

  function navigate(view, param = null) {
    if (!VIEWS.includes(view)) view = 'home';
    current = view;
    VIEWS.forEach(v => document.getElementById('view-' + v).classList.toggle('hidden', v !== view));
    document.querySelectorAll('#bottom-nav [data-nav]').forEach(b =>
      b.classList.toggle('nav-active', b.dataset.nav === NAV_MAP[view]));
    window.scrollTo(0, 0);
    if (view === 'home') Home.render();
    else if (view === 'trips') Trips.renderList();
    else if (view === 'trip') Trips.renderTrip(param || Trips.activeTripId());
    else if (view === 'agent') Agent.render();
    else if (view === 'settings') Settings.render();
  }
  const refresh = () => navigate(current, Trips.activeTripId());

  /* ---------- home ---------- */
  const Home = {
    async render() {
      await Members.strip('home-family');
      const next = await Itinerary.nextTrip();
      await this.renderHero(next);
      await this.renderTravelDay(next);
      await this.renderAlerts(next);
    },

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
      const t = next.trip;
      const du = t.startDate ? UI.daysUntil(t.startDate) : null;
      const pill = next.live ? '🏖️ עכשיו בטיול!' : (du != null ? `בעוד ${du} ימים` : '');
      const members = await DB.all('members');
      const travelers = (t.memberIds || []).map(id => members.find(m => m.id === id)).filter(Boolean);
      el.innerHTML = `
        <button id="hero-card" class="w-full text-right relative min-h-[280px] rounded-[2rem] overflow-hidden shadow-lg active:scale-[0.98] transition">
          ${t.coverImage
          ? `<img src="${t.coverImage}" class="absolute inset-0 w-full h-full object-cover">`
          : `<div class="absolute inset-0 bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 flex items-center justify-center text-9xl opacity-95">${t.coverEmoji || '🧳'}</div>`}
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
          ${pill ? `<span class="absolute top-4 left-4 bg-white/20 backdrop-blur-md text-white text-sm font-medium px-4 py-2 rounded-full">${pill}</span>` : ''}
          <div class="absolute bottom-0 right-0 left-0 p-5 flex items-end justify-between">
            <div>
              <div class="text-white text-3xl font-bold">${UI.esc(t.name)}</div>
              <div class="text-white/80 text-sm mt-1">${UI.esc(t.destination || '')}${t.destination && t.startDate ? ' · ' : ''}${UI.fmtDateRange(t.startDate, t.endDate)}</div>
            </div>
            <div class="flex -space-x-2.5 space-x-reverse">${travelers.slice(0, 4).map(m => UI.avatarHTML(m, 'w-9 h-9', 'ring-2 ring-white/70')).join('')}</div>
          </div>
        </button>`;
      document.getElementById('hero-card').addEventListener('click', () => navigate('trip', t.id));
    },

    // travel-day mode: today's documents come first
    async renderTravelDay(next) {
      const el = document.getElementById('home-today');
      el.innerHTML = '';
      if (!next || !next.live) return;
      const { events, docs } = await Itinerary.todayHighlights(next.trip);
      if (!events.length && !docs.length) return;
      el.innerHTML = `
        <div class="bg-white rounded-3xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 class="font-bold text-slate-800 mb-3">🎒 היום בטיול</h3>
          ${events.map(e => `<div class="flex items-center gap-2.5 py-1.5 text-sm"><span>${UI.eventType(e.type).emoji}</span><b class="text-slate-700">${e.time || ''}</b><span class="text-slate-600 truncate">${UI.esc(e.title)}</span></div>`).join('')}
          ${docs.length ? `<div class="flex gap-2 mt-3 overflow-x-auto no-scrollbar">${docs.map(d => `
            <button class="td-doc shrink-0 bg-indigo-50 text-indigo-700 text-xs font-medium px-3.5 py-2.5 rounded-xl flex items-center gap-1.5" data-id="${d.id}">
              ${UI.cat(d.category).emoji} ${UI.esc((d.extracted?.title || d.fileName).slice(0, 24))}</button>`).join('')}</div>` : ''}
        </div>`;
      el.querySelectorAll('.td-doc').forEach(b => b.addEventListener('click', async () =>
        UI.viewer.open(await DB.get('documents', b.dataset.id))));
    },

    async renderAlerts(next) {
      const el = document.getElementById('home-alerts');
      const alerts = [];
      if (next) (await Vault.alertsForTrip(next.trip)).forEach(a => alerts.push(a));
      (await Itinerary.upcomingDeadlines(14)).slice(0, 4).forEach(d =>
        alerts.push({ level: 'info', text: `${d.title} · ${d.daysUntil === 0 ? 'היום' : `בעוד ${d.daysUntil} ימים`} (${d.tripName})` }));
      if (!alerts.length) { el.innerHTML = ''; return; }
      const cls = { error: 'bg-red-50 text-red-700', warning: 'bg-amber-50 text-amber-700', info: 'bg-indigo-50 text-indigo-700' };
      const icon = { error: '🛂', warning: '⚠️', info: '⏰' };
      el.innerHTML = `
        <div class="bg-white rounded-3xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 class="font-bold text-slate-800 mb-3">התראות חשובות</h3>
          <div class="space-y-2">${alerts.map(a => `
            <div class="${cls[a.level] || cls.info} p-3 rounded-xl flex items-center gap-3 text-sm">
              <span class="text-lg">${icon[a.level] || '🔔'}</span><span class="leading-snug">${UI.esc(a.text)}</span>
            </div>`).join('')}</div>
        </div>`;
    },
  };

  /* ---------- quick actions ---------- */
  async function quickAction(action) {
    const next = await Itinerary.nextTrip();
    const needTrip = async () => {
      if (next) return next.trip;
      UI.toast('קודם פותחים מחיצת חופשה 🧳', 'info');
      Trips.editModal();
      return null;
    };
    if (action === 'scan') { const t = await needTrip(); if (t) Documents.addFlow(t, { capture: true }); }
    else if (action === 'vault') Vault.open();
    else if (action === 'packing') {
      const t = await needTrip();
      if (t) { navigate('trip', t.id); document.querySelector('#trip-tabs [data-tab="checklist"]')?.click(); }
    }
    else if (action === 'budget') {
      const t = await needTrip();
      if (t) { navigate('trip', t.id); document.querySelector('#trip-tabs [data-tab="budget"]')?.click(); }
    }
  }

  /* ---------- bootstrap ---------- */
  async function init() {
    await DB.init();
    UI.init();

    // seed shared keyword list on first run
    await G.gmail.keywords();

    // nav
    document.querySelectorAll('#bottom-nav [data-nav]').forEach(b =>
      b.addEventListener('click', () => navigate(b.dataset.nav)));
    document.getElementById('trip-back').addEventListener('click', () => navigate('trips'));
    document.getElementById('btn-add-trip').addEventListener('click', () => Trips.editModal());
    document.querySelectorAll('[data-qa]').forEach(b =>
      b.addEventListener('click', () => quickAction(b.dataset.qa)));

    Agent.init();
    navigate('home');

    // re-render after sync/local changes
    document.addEventListener('tn-data-changed', () => refresh());
    document.addEventListener('tn-sync-state', (e) => {
      const dot = document.getElementById('sync-dot');
      if (!dot) return;
      dot.className = 'w-2 h-2 rounded-full ' + (e.detail === 'start' ? 'bg-amber-400 animate-pulse' : e.detail === 'error' ? 'bg-red-400' : 'bg-emerald-400');
    });

    // service worker
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW registration failed', e); }
    }

    // background sync on load + when returning to the app
    G.Sync.run({ silent: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') G.Sync.run({ silent: true });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { navigate, refresh };
})();
window.App = App;
