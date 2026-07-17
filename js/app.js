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
    document.getElementById('app-scroll')?.scrollTo(0, 0);
    if (view === 'home') Home.render();
    else if (view === 'trips') Trips.renderList();
    else if (view === 'trip') Trips.renderTrip(param || Trips.activeTripId());
    else if (view === 'agent') Agent.render();
    else if (view === 'settings') Settings.render();
  }
  const refresh = () => navigate(current, Trips.activeTripId());

  /* ---------- home ---------- */
  const Home = {
    next: null, // cached so quick actions can run synchronously inside the tap gesture (iOS file picker)
    async render() {
      await Members.strip('home-family');
      const next = await Itinerary.nextTrip();
      this.next = next;
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
      const travelers = Members.sorted((t.memberIds || []).map(id => members.find(m => m.id === id)).filter(Boolean));
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
          <h3 class="font-bold text-slate-800 mb-3">היום בטיול</h3>
          ${events.map(e => `<div class="flex items-center gap-2.5 py-1.5 text-sm"><span class="w-7 h-7 rounded-lg ${UI.eventType(e.type).tint} flex items-center justify-center shrink-0">${UI.icon(UI.eventType(e.type).icon, 'w-4 h-4')}</span><b class="text-slate-700">${e.time || ''}</b><span class="text-slate-600 truncate">${UI.esc(e.title)}</span></div>`).join('')}
          ${docs.length ? `<div class="flex gap-2 mt-3 overflow-x-auto no-scrollbar">${docs.map(d => `
            <button class="td-doc shrink-0 bg-indigo-50 text-indigo-700 text-xs font-medium px-3.5 py-2.5 rounded-xl flex items-center gap-1.5" data-id="${d.id}">
              ${UI.icon(UI.cat(d.category).icon, 'w-3.5 h-3.5')} ${UI.esc((d.extracted?.title || d.fileName).slice(0, 24))}</button>`).join('')}</div>` : ''}
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
      const dot = { error: 'bg-red-500', warning: 'bg-amber-400', info: 'bg-slate-300' };
      el.innerHTML = `
        <div class="bg-white rounded-3xl px-4 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 class="font-bold text-slate-800 pt-2 pb-1">מועדים חשובים</h3>
          ${alerts.map(a => `
            <div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0 text-sm">
              <span class="w-2 h-2 rounded-full ${dot[a.level] || dot.info} shrink-0"></span>
              <span class="leading-snug text-slate-700">${UI.esc(a.text)}</span>
            </div>`).join('')}
        </div>`;
    },
  };

  /* ---------- quick actions ---------- */
  async function quickAction(action) {
    // 'scan' must open the file picker synchronously within the tap gesture —
    // an await before input.click() makes iOS Safari swallow it silently
    if (action === 'scan') {
      const t = Home.next?.trip;
      if (t) { Documents.addFlow(t, { capture: true }); return; }
    }
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

  /* ---------- app updates (service worker + version.json) ----------
     שכבות הגנה, כי ספארי מכבד את ה-HTTP cache של Pages גם עבור sw.js:
     1. רישום עם updateViaCache:'none' — בלי cache מקומי לסקריפט.
     2. version.json (network-first) הוא מקור האמת; אם הוא חדש וה-SW לא
        מתעדכן — רישום מחדש עם ./sw.js?v=<גרסה>: URL חדש ששום cache
        (מקומי או CDN) לא יכול להגיש ממנו עותק ישן.
     3. עדיין תקוע → "עדכון כפוי": ניקוי caches + רישום מחדש + טעינה.
        הנתונים ב-IndexedDB לא נמחקים אף פעם. */
  const Updater = {
    reg: null,
    waiting: null,

    _wire() {
      if (!this.reg) return;
      // controller קיים = זה עדכון ולא התקנה ראשונה
      const track = (w) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) this.prompt(w);
        });
      };
      // כיסוי כל המצבים: גרסה שכבר מחכה, גרסה שבאמצע התקנה
      // (updatefound שירה לפני שנרשמנו), וגרסאות עתידיות
      if (this.reg.waiting && navigator.serviceWorker.controller) this.prompt(this.reg.waiting);
      track(this.reg.installing);
      this.reg.addEventListener('updatefound', () => track(this.reg.installing));
    },

    async init() {
      if (!('serviceWorker' in navigator)) return;
      try { this.reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); }
      catch (e) { console.warn('SW registration failed', e); return; }
      this._wire();

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });

      this.check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.check();
      });
    },

    async check({ manual = false } = {}) {
      try { await this.reg?.update(); } catch { }
      let remote = null;
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        remote = (await res.json()).version;
      } catch { }
      const current = window._BUNDLE_VERSION || '';

      // השרת חדש אבל אין שום התקנה בדרך → עקיפת cache בכוח עם URL ייחודי
      if (remote && remote !== current && this.reg && !this.reg.waiting && !this.reg.installing) {
        try {
          this.reg = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(remote)}`, { updateViaCache: 'none' });
          this._wire();
        } catch { }
      }
      // המתנה קצרה לסיום ההתקנה (עד ~8 שניות)
      for (let i = 0; i < 8 && !this.reg?.waiting; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (!this.reg?.installing && !this.reg?.waiting && i >= 2) break;
      }
      if (this.reg?.waiting && navigator.serviceWorker.controller) this.prompt(this.reg.waiting);

      if (manual) {
        if (this.waiting || this.reg?.waiting) { /* הבאנר כבר מוצג */ }
        else if (remote && remote !== current) this.offerForce(remote);
        else UI.toast(`אתם על הגרסה האחרונה (v${current}) ✓`, 'success');
      }
      return { current, remote };
    },

    // המוצא האחרון — דטרמיניסטי: מנקה את כל שכבות ה-cache וטוען מהשרת.
    async hardReload() {
      try {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
      } catch { }
      location.reload();
    },

    offerForce(remote) {
      UI.confirm(
        `גרסה ${remote} זמינה אבל ההתקנה השקטה נתקעה. לבצע עדכון כפוי? האפליקציה תנוקה מקבצים שמורים ותיטען מחדש מהשרת — הנתונים שלכם (טיולים, מסמכים, כספת) לא נמחקים.`,
        () => this.hardReload(),
      );
    },

    prompt(worker) {
      this.waiting = worker;
      if (document.getElementById('update-banner')) return;
      const el = document.createElement('div');
      el.id = 'update-banner';
      el.className = 'fixed top-0 left-0 right-0 z-[60] px-4 pt-safe';
      el.innerHTML = `
        <div class="max-w-lg mx-auto mt-3 bg-indigo-600 text-white rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3">
          <span class="text-xl">🚀</span>
          <span class="text-sm font-medium flex-1">גרסה חדשה של Navigo מוכנה</span>
          <button id="update-now" class="bg-white text-indigo-600 text-xs font-bold px-3.5 py-2 rounded-xl active:scale-95">עדכון</button>
          <button id="update-later" class="text-white/70 text-xs px-1">אחר-כך</button>
        </div>`;
      document.body.appendChild(el);
      document.getElementById('update-now').addEventListener('click', (e) => {
        e.target.textContent = 'מעדכן…';
        e.target.disabled = true;
        worker.postMessage({ type: 'SKIP_WAITING' }); // controllerchange יטען מחדש
        setTimeout(() => this.hardReload(), 5000);    // ואם לא הגיע — עדכון כפוי
      });
      document.getElementById('update-later').addEventListener('click', () => el.remove());
    },
  };

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

    Archive.init();
    Agent.init();
    navigate('home');

    // re-render after sync/local changes
    document.addEventListener('tn-data-changed', () => refresh());
    document.addEventListener('tn-sync-state', (e) => {
      const dot = document.getElementById('sync-dot');
      if (!dot) return;
      dot.className = 'w-2 h-2 rounded-full ' + (e.detail === 'start' ? 'bg-amber-400 animate-pulse' : e.detail === 'error' ? 'bg-red-400' : 'bg-emerald-400');
    });

    // service worker + update detection
    await Updater.init();

    // background sync on load + when returning to the app
    G.Sync.run({ silent: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') G.Sync.run({ silent: true });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { navigate, refresh, checkForUpdate: () => Updater.check({ manual: true }) };
})();
window.App = App;
