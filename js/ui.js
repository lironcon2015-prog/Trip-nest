/* TripNest — UI helpers: toasts, modals, formatters, document viewer. */
const UI = (() => {
  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const MONTHS_S = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  const DOC_CATEGORIES = [
    { id: 'flight', he: 'טיסות', emoji: '✈️' },
    { id: 'stay', he: 'לינה', emoji: '🏨' },
    { id: 'car', he: 'רכב', emoji: '🚗' },
    { id: 'insurance', he: 'ביטוח', emoji: '🛡️' },
    { id: 'visa', he: 'ויזה ואשרות', emoji: '🪪' },
    { id: 'passport', he: 'דרכון', emoji: '🛂' },
    { id: 'attraction', he: 'אטרקציות', emoji: '🎟️' },
    { id: 'other', he: 'אחר', emoji: '📄' },
  ];
  const cat = (id) => DOC_CATEGORIES.find(c => c.id === id) || DOC_CATEGORIES[DOC_CATEGORIES.length - 1];

  const EVENT_TYPES = [
    { id: 'flight', he: 'טיסה', emoji: '✈️' },
    { id: 'checkin', he: 'צ׳ק-אין מלון', emoji: '🏨' },
    { id: 'checkout', he: 'צ׳ק-אאוט', emoji: '🧳' },
    { id: 'car', he: 'רכב', emoji: '🚗' },
    { id: 'activity', he: 'אטרקציה', emoji: '🎟️' },
    { id: 'food', he: 'אוכל', emoji: '🍽️' },
    { id: 'deadline', he: 'מועד חשוב', emoji: '⏰' },
    { id: 'other', he: 'אחר', emoji: '📍' },
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

  const emptyState = (emoji, msg, sub = '') => `
    <div class="flex flex-col items-center justify-center py-10 text-center">
      <div class="text-4xl mb-3">${emoji}</div>
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
  function openModal({ title, bodyHTML = '', confirmLabel = 'שמירה', onConfirm = null, hideConfirm = false, danger = false }) {
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
        catch (e) { body.innerHTML = emptyState('☁️', 'המסמך בדרייב וטרם הורד למכשיר', 'התחברו ל-Google וסנכרנו כדי לצפות'); return; }
      }
      if (!blob) { body.innerHTML = emptyState('📄', 'אין קובץ לתצוגה'); return; }

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
        body.innerHTML = emptyState('📎', 'לא ניתן להציג קובץ מסוג זה', 'ניתן להוריד אותו בכפתור למעלה');
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
      container.innerHTML = emptyState('📄', 'שגיאה בפתיחת ה-PDF');
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
      const btn = e.currentTarget, orig = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = spinner;
      try { const keep = await _onConfirm(); if (keep !== true) closeModal(); }
      catch (err) { console.error(err); toast(err.message || 'שגיאה בשמירה', 'error'); }
      finally { btn.disabled = false; btn.innerHTML = orig; }
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
    DOC_CATEGORIES, cat, EVENT_TYPES, eventType, MONTHS, init,
  };
})();
window.UI = UI;
