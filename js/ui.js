/* TripNest — UI helpers: toasts, modals, formatters, document viewer. */
const UI = (() => {
  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const MONTHS_S = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  /* inline SVG icon set (24x24 stroke paths, Heroicons/Lucide-style) — replaces UI-chrome emojis */
  const ICONS = {
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    bed: '<path d="M2 20v-8a2 2 0 012-2h16a2 2 0 012 2v8M4 10V6a2 2 0 012-2h12a2 2 0 012 2v4M2 17h20"/>',
    luggage: '<path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m-9 0h12a1.5 1.5 0 011.5 1.5V19a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 19V8.5A1.5 1.5 0 016 7zm3 3.5v6.5m6-6.5v6.5"/>',
    car: '<path d="M19 17h2a1 1 0 001-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 002 12v4a1 1 0 001 1h2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
    shield: '<path d="M9 12.75 11.25 15 15 9.75m-3-7.04A12 12 0 013.6 6 12 12 0 003 9.75c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15c-3.2 0-6.1-1.25-8.25-3.29z"/>',
    id: '<path d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5a2.25 2.25 0 002.25 2.25z"/><path d="M10.5 9.375a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.3 6.34a6.72 6.72 0 01-3.17.79 6.72 6.72 0 01-3.17-.79 3.38 3.38 0 016.34 0z"/>',
    ticket: '<path d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18M6.75 12.75h4.5M6.75 15h3M3.375 5.25c-.62 0-1.125.5-1.125 1.125V9.4a3 3 0 010 5.2v3.03c0 .62.5 1.12 1.125 1.12h17.25c.62 0 1.125-.5 1.125-1.12v-3.03a3 3 0 010-5.2V6.375c0-.62-.5-1.125-1.125-1.125H3.375z"/>',
    doc: '<path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.62 0-1.125.5-1.125 1.125v17.25c0 .62.5 1.125 1.125 1.125h12.75c.62 0 1.125-.5 1.125-1.125V11.25a9 9 0 00-9-9z"/><path d="M8.25 15h7.5m-7.5 3H12"/>',
    food: '<path d="M3 2.5v6.5a2 2 0 002 2h3a2 2 0 002-2V2.5M7 2.5V21M21 15V4a5 5 0 00-4.5 5v4a2 2 0 002 2H21zm0 0v6"/>',
    clock: '<path d="M12 7v5h3.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    pin: '<path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.14-7.5 11.25-7.5 11.25S4.5 17.64 4.5 10.5a7.5 7.5 0 1115 0z"/>',
    camera: '<path d="M6.8 6.2A2.3 2.3 0 015.2 7.2c-.38.05-.76.11-1.13.18C3 7.58 2.25 8.5 2.25 9.57V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.57c0-1.07-.75-2-1.8-2.17-.38-.07-.75-.13-1.13-.18a2.3 2.3 0 01-1.64-1.05l-.82-1.32a2.19 2.19 0 00-1.74-1.04 48.8 48.8 0 00-5.23 0c-.7.04-1.35.44-1.74 1.04l-.82 1.32z"/><path d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/>',
    list: '<path d="m3 16.5 1.6 1.6 3-3M3 6.9l1.6 1.6 3-3M12 7.5h9M12 16.5h9"/>',
    wallet: '<path d="M21 12V7.5H5.25a2.25 2.25 0 010-4.5H19.5V7"/><path d="M3 5.25v13.5A2.25 2.25 0 005.25 21H21v-4.5"/><path d="M17.25 12a2.25 2.25 0 000 4.5H21V12h-3.75z"/>',
    cloud: '<path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.33-7.26 5.25 5.25 0 00-10.23-2.33A4.5 4.5 0 002.25 15z"/>',
    mail: '<path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.24a2.25 2.25 0 01-1.07 1.92l-7.5 4.62a2.25 2.25 0 01-2.36 0l-7.5-4.62a2.25 2.25 0 01-1.07-1.92v-.24"/>',
    sparkles: '<path d="M9.8 15.3 9 18l-.8-2.7a4.5 4.5 0 00-3-3L2.5 11.5l2.7-.8a4.5 4.5 0 003-3L9 5l.8 2.7a4.5 4.5 0 003 3l2.7.8-2.7.8a4.5 4.5 0 00-3 3zM18.3 8.6 18 9.75l-.3-1.15a2.63 2.63 0 00-1.8-1.8L14.75 6.5l1.15-.3a2.63 2.63 0 001.8-1.8L18 3.25l.3 1.15a2.63 2.63 0 001.8 1.8l1.15.3-1.15.3a2.63 2.63 0 00-1.8 1.8zM16.9 20.6l-.4 1.15-.4-1.15a2.25 2.25 0 00-1.4-1.4l-1.2-.45 1.2-.45a2.25 2.25 0 001.4-1.4l.4-1.15.4 1.15c.23.66.75 1.17 1.4 1.4l1.2.45-1.2.45a2.25 2.25 0 00-1.4 1.4z"/>',
    users: '<path d="M15 19.13a9.38 9.38 0 002.63.37 9.34 9.34 0 004.12-.95 4.13 4.13 0 00-7.53-2.29M15 19.13v-.03c0-.83-.21-1.6-.58-2.29m.58 2.32v.08a12.32 12.32 0 01-6.37 1.77c-2.31 0-4.47-.63-6.32-1.73l-.06-.12v-.03a6.38 6.38 0 0112.16-2.29M13.5 6.38a3.38 3.38 0 11-6.75 0 3.38 3.38 0 016.75 0zm7.5 2.25a2.63 2.63 0 11-5.25 0 2.63 2.63 0 015.25 0z"/>',
    lock: '<path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>',
    key: '<path d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.51-.09-1.05.02-1.42.38L11.25 16.5H9v2.25H6.75V21H3v-2.25c0-.6.24-1.17.66-1.59l6.5-6.5c.37-.37.47-.9.38-1.42a6 6 0 1111.21-3.49z"/>',
    download: '<path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>',
    upload: '<path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/>',
    sync: '<path d="M16.02 9.35h5.25V4.1m-.44 12.55a8.25 8.25 0 11-1.19-8.7l1.63 1.4"/>',
    plug: '<path d="M14.25 6v6.75a2.25 2.25 0 01-2.25 2.25h0a2.25 2.25 0 01-2.25-2.25V6m6.75 0h-9m9 0h1.5M8.25 6h-1.5M12 15v3m0 0v3m0-3h0"/>',
    link: '<path d="M13.19 8.69a4.5 4.5 0 016.36 6.36l-4.5 4.5a4.5 4.5 0 01-6.36-6.36l1.4-1.4m4.72-4.72-1.4 1.4a4.5 4.5 0 00-6.36-6.36l-4.5 4.5"/>',
    plus: '<path d="M12 4.5v15m7.5-7.5h-15"/>',
    folder: '<path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.38a1.5 1.5 0 01-1.06-.44z"/>',
    image: '<path d="m2.25 15.75 5.16-5.16a2.25 2.25 0 013.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 013.18 0l2.91 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.01v.01h-.01v-.01z"/>',
    trash: '<path d="m14.74 9-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17-1.06 13.83a2.25 2.25 0 01-2.24 2.08H8.08a2.25 2.25 0 01-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 00-3.48-.4m-12 .56c.34-.06.68-.12 1.02-.17m0 0a48.1 48.1 0 013.48-.4m7.5 0v-.92c0-1.18-.91-2.16-2.09-2.2a51.96 51.96 0 00-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.92m7.5 0a48.7 48.7 0 00-7.5 0"/>',
    ban: '<path d="M18.36 18.36A9 9 0 005.64 5.64m12.72 12.72A9 9 0 015.64 5.64m12.72 12.72L5.64 5.64"/>',
    flask: '<path d="M9.75 3v5.17c0 .6-.24 1.17-.66 1.6L4.3 14.55a2.25 2.25 0 001.59 3.84h12.22a2.25 2.25 0 001.59-3.84l-4.79-4.78a2.25 2.25 0 01-.66-1.6V3m-6 0h7.5M9 15h6"/>',
    heart: '<path d="M21 8.25c0-2.49-2.1-4.5-4.69-4.5-1.94 0-3.6 1.13-4.31 2.73a4.72 4.72 0 00-4.31-2.73C5.1 3.75 3 5.76 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>',
  };
  const icon = (name, cls = 'w-5 h-5') =>
    `<svg class="tn-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.doc}</svg>`;

  /* tint = pastel color-coding (proposal A+C): chrome stays indigo, categories/events get a hue */
  const DOC_CATEGORIES = [
    { id: 'flight', he: 'טיסות', emoji: '✈️', icon: 'plane', tint: 'bg-sky-100 text-sky-600' },
    { id: 'stay', he: 'לינה', emoji: '🏨', icon: 'bed', tint: 'bg-violet-100 text-violet-600' },
    { id: 'car', he: 'רכב', emoji: '🚗', icon: 'car', tint: 'bg-amber-100 text-amber-600' },
    { id: 'insurance', he: 'ביטוח', emoji: '🛡️', icon: 'shield', tint: 'bg-emerald-100 text-emerald-600' },
    { id: 'visa', he: 'ויזה ואשרות', emoji: '🪪', icon: 'id', tint: 'bg-indigo-100 text-indigo-600' },
    { id: 'passport', he: 'דרכון', emoji: '🛂', icon: 'id', tint: 'bg-indigo-100 text-indigo-600' },
    { id: 'attraction', he: 'אטרקציות', emoji: '🎟️', icon: 'ticket', tint: 'bg-rose-100 text-rose-600' },
    { id: 'other', he: 'אחר', emoji: '📄', icon: 'doc', tint: 'bg-slate-100 text-slate-500' },
  ];
  const cat = (id) => DOC_CATEGORIES.find(c => c.id === id) || DOC_CATEGORIES[DOC_CATEGORIES.length - 1];

  const EVENT_TYPES = [
    { id: 'flight', he: 'טיסה', emoji: '✈️', icon: 'plane', tint: 'bg-sky-100 text-sky-600' },
    { id: 'checkin', he: 'צ׳ק-אין מלון', emoji: '🏨', icon: 'bed', tint: 'bg-violet-100 text-violet-600' },
    { id: 'checkout', he: 'צ׳ק-אאוט', emoji: '🧳', icon: 'luggage', tint: 'bg-violet-100 text-violet-600' },
    { id: 'car', he: 'רכב', emoji: '🚗', icon: 'car', tint: 'bg-amber-100 text-amber-600' },
    { id: 'activity', he: 'אטרקציה', emoji: '🎟️', icon: 'ticket', tint: 'bg-rose-100 text-rose-600' },
    { id: 'food', he: 'אוכל', emoji: '🍽️', icon: 'food', tint: 'bg-orange-100 text-orange-600' },
    { id: 'deadline', he: 'מועד חשוב', emoji: '⏰', icon: 'clock', tint: 'bg-red-100 text-red-500' },
    { id: 'other', he: 'אחר', emoji: '📍', icon: 'pin', tint: 'bg-slate-100 text-slate-500' },
  ];
  const eventType = (id) => EVENT_TYPES.find(t => t.id === id) || EVENT_TYPES[EVENT_TYPES.length - 1];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* --- dates --- */
  const toDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = (iso) => { if (!iso) return ''; const d = toDate(iso); return `${d.getDate()} ב${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtDateShort = (iso) => { if (!iso) return ''; const d = toDate(iso); return `${d.getDate()} ${MONTHS_S[d.getMonth()]}`; };
  const fmtDayHeader = (iso) => { const d = toDate(iso); return `יום ${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`; };
  function fmtDateRange(a, b) {
    if (!a) return '';
    if (!b || a === b) return fmtDate(a);
    const da = toDate(a), db_ = toDate(b);
    if (da.getMonth() === db_.getMonth() && da.getFullYear() === db_.getFullYear())
      return `${da.getDate()}–${db_.getDate()} ב${MONTHS[da.getMonth()]} ${da.getFullYear()}`;
    return `${da.getDate()} ${MONTHS_S[da.getMonth()]} – ${db_.getDate()} ${MONTHS_S[db_.getMonth()]} ${db_.getFullYear()}`;
  }
  const daysUntil = (iso) => Math.ceil((toDate(iso) - toDate(todayISO())) / 86400000);
  function age(birthISO) {
    if (!birthISO) return null;
    const b = toDate(birthISO), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  const fmtMoney = (n, cur = '₪') => `${cur} ${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

  /* --- images --- */
  function fileToDataURL(file, maxDim = 512, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  const avatarHTML = (m, size = 'w-14 h-14', extra = '') => m.avatar
    ? `<img src="${m.avatar}" alt="${esc(m.nameHe)}" class="${size} rounded-full object-cover ring-1 ring-slate-200 ${extra}">`
    : `<div class="${size} rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center font-bold ring-1 ring-slate-200 ${extra}">${esc((m.nameHe || '?').slice(0, 2))}</div>`;

  /* accepts an ICONS name (preferred) or a literal emoji fallback */
  const emptyState = (ico, msg, sub = '') => `
    <div class="flex flex-col items-center justify-center py-10 text-center">
      ${ICONS[ico]
        ? `<div class="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">${icon(ico, 'w-7 h-7')}</div>`
        : `<div class="text-4xl mb-3">${ico}</div>`}
      <div class="text-slate-500 font-medium">${esc(msg)}</div>
      ${sub ? `<div class="text-slate-400 text-sm mt-1">${esc(sub)}</div>` : ''}
    </div>`;

  /* --- toast --- */
  function toast(msg, type = 'info', duration = 3200) {
    const colors = { success: 'bg-emerald-600', error: 'bg-red-600', warning: 'bg-amber-500', info: 'bg-slate-800' };
    const el = document.createElement('div');
    el.className = `toast ${colors[type] || colors.info} text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, duration);
  }

  /* --- modal --- */
  let _onConfirm = null;
  let _modalGen = 0; // bumped per openModal so a confirm that replaces the modal keeps the new label
  function openModal({ title, bodyHTML = '', confirmLabel = 'שמירה', onConfirm = null, hideConfirm = false, danger = false }) {
    _modalGen++;
    document.getElementById('modal-title').textContent = title || '';
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const btn = document.getElementById('modal-confirm');
    btn.textContent = confirmLabel;
    btn.classList.toggle('hidden', hideConfirm);
    btn.classList.toggle('bg-red-600', danger);
    btn.classList.toggle('bg-indigo-600', !danger);
    _onConfirm = onConfirm;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    _onConfirm = null;
  }
  function confirmDialog(msg, onYes) {
    openModal({
      title: 'אישור פעולה',
      bodyHTML: `<div class="flex items-start gap-3 bg-red-50 text-red-700 p-4 rounded-2xl"><span class="text-xl">⚠️</span><p class="text-sm leading-relaxed">${esc(msg)}</p></div>`,
      confirmLabel: 'אישור', danger: true, onConfirm: onYes,
    });
  }

  /* --- fullscreen document viewer --- */
  const viewer = {
    async open(doc) {
      const v = document.getElementById('viewer');
      document.getElementById('viewer-title').textContent = doc.fileName || 'מסמך';
      const body = document.getElementById('viewer-body');
      body.innerHTML = '<div class="flex justify-center py-16 text-slate-400">טוען…</div>';
      v.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');

      let blob = doc.blob;
      if (!blob && doc.driveFileId && window.G) {
        try { blob = await G.drive.downloadBlob(doc.driveFileId); doc.blob = blob; await DB.putRaw('documents', doc); }
        catch (e) { body.innerHTML = emptyState('cloud', 'המסמך בדרייב וטרם הורד למכשיר', 'התחברו ל-Google וסנכרנו כדי לצפות'); return; }
      }
      if (!blob) { body.innerHTML = emptyState('doc', 'אין קובץ לתצוגה'); return; }

      const dl = document.getElementById('viewer-download');
      dl.onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = doc.fileName || 'document';
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };

      const mt = doc.mimeType || blob.type || '';
      if (mt.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<img src="${url}" class="max-w-full mx-auto rounded-xl shadow-md">`;
      } else if (mt === 'application/pdf') {
        await renderPdf(blob, body);
      } else if (mt.startsWith('text/')) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<iframe src="${url}" sandbox="" class="w-full bg-white rounded-xl" style="height:75vh"></iframe>`;
      } else {
        body.innerHTML = emptyState('doc', 'לא ניתן להציג קובץ מסוג זה', 'ניתן להוריד אותו בכפתור למעלה');
      }
    },
    close() {
      document.getElementById('viewer').classList.add('hidden');
      document.getElementById('viewer-body').innerHTML = '';
      document.body.classList.remove('overflow-hidden');
    },
  };

  // PDFs with non-embedded fonts (e.g. bare Helvetica) render with missing
  // glyphs unless pdf.js is given its substitute font files; CJK/Hebrew CID
  // fonts likewise need the cMaps.
  const PDF_OPTS = {
    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true,
  };

  async function renderPdf(blob, container) {
    try {
      const data = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data, ...PDF_OPTS }).promise;
      container.innerHTML = '';
      const pages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const scale = Math.min(2, (container.clientWidth || 360) / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.className = 'w-full rounded-xl shadow-md mb-4 bg-white';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        // the app is dir=rtl, and canvas contexts inherit it — flipping fillText
        // anchoring so pdf.js paints glyph runs shifted and the PDF's clip rects
        // cut them off (missing letters). PDFs are always laid out explicitly.
        ctx.direction = 'ltr';
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      }
    } catch (e) {
      console.error(e);
      container.innerHTML = emptyState('doc', 'שגיאה בפתיחת ה-PDF');
    }
  }

  // extracts text from a PDF blob (for Gemini extraction)
  async function pdfText(blob, maxPages = 4) {
    const data = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data, ...PDF_OPTS }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      out += tc.items.map(it => it.str).join(' ') + '\n';
    }
    return out;
  }

  const spinner = '<span class="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin align-middle"></span>';

  // instant tap feedback for async buttons: spinner + lock against double-taps
  async function busy(btn, fn) {
    if (!btn || btn.disabled) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="tn-spin"></span>';
    try { return await fn(); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  }

  function init() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
    document.getElementById('modal-confirm').addEventListener('click', async (e) => {
      if (!_onConfirm) { closeModal(); return; }
      const btn = e.currentTarget, orig = btn.innerHTML, gen = _modalGen;
      btn.disabled = true; btn.innerHTML = spinner;
      try { const keep = await _onConfirm(); if (keep !== true) closeModal(); }
      catch (err) { console.error(err); toast(err.message || 'שגיאה בשמירה', 'error'); }
      finally { btn.disabled = false; if (gen === _modalGen) btn.innerHTML = orig; }
    });
    document.getElementById('viewer-close').addEventListener('click', viewer.close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!document.getElementById('viewer').classList.contains('hidden')) viewer.close();
        else if (!document.getElementById('modal-overlay').classList.contains('hidden')) closeModal();
      }
    });
  }

  return {
    esc, toast, openModal, closeModal, confirm: confirmDialog, viewer, pdfText,
    fmtDate, fmtDateShort, fmtDateRange, fmtDayHeader, daysUntil, age, todayISO, toDate, fmtMoney,
    fileToDataURL, avatarHTML, emptyState, spinner, busy, PDF_OPTS,
    DOC_CATEGORIES, cat, EVENT_TYPES, eventType, MONTHS, MONTHS_S, init, icon, ICONS,
  };
})();
window.UI = UI;
