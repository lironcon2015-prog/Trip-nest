/* TripNest — trip documents: upload/camera, categories, viewer, Gemini extraction, Gmail import. */
const Documents = (() => {

  const SOURCE_BADGE = {
    upload: ['העלאה', 'bg-slate-100 text-slate-500'],
    camera: ['צילום', 'bg-slate-100 text-slate-500'],
    email: ['מהמייל', 'bg-indigo-50 text-indigo-600'],
  };

  async function renderTab(trip, container) {
    const docs = await DB.byTrip('documents', trip.id);
    const counts = {};
    docs.forEach(d => counts[d.category || 'other'] = (counts[d.category || 'other'] || 0) + 1);

    const grid = UI.DOC_CATEGORIES.filter(c => ['flight', 'stay', 'car', 'insurance'].includes(c.id) || counts[c.id]).map(c => `
      <button class="doc-cat bg-white rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center gap-1.5 active:scale-95 transition" data-cat="${c.id}">
        <span class="text-2xl">${c.emoji}</span>
        <span class="text-sm font-semibold text-slate-700">${c.he}</span>
        <span class="text-[11px] text-slate-400">${counts[c.id] || 0} מסמכים</span>
      </button>`).join('');

    container.innerHTML = `
      <div class="grid grid-cols-2 gap-3 mb-5">${grid}</div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-800">כל המסמכים</h3>
        <button id="doc-email-import" class="text-xs bg-indigo-50 text-indigo-600 font-medium px-3 py-1.5 rounded-full">✉️ ייבוא מהמייל</button>
      </div>
      <div id="doc-list" class="space-y-2.5"></div>`;

    renderList(trip, docs, document.getElementById('doc-list'));
    container.querySelectorAll('.doc-cat').forEach(b =>
      b.addEventListener('click', () => renderList(trip, docs.filter(d => (d.category || 'other') === b.dataset.cat), document.getElementById('doc-list'), UI.cat(b.dataset.cat).he)));
    document.getElementById('doc-email-import').addEventListener('click', () => emailImport(trip));
  }

  function renderList(trip, docs, el, filterLabel = null) {
    if (!docs.length) { el.innerHTML = UI.emptyState('🗂️', filterLabel ? `אין מסמכים בקטגוריה ${filterLabel}` : 'אין עדיין מסמכים', 'הוסיפו עם כפתור ה-+ או ייבאו מהמייל'); return; }
    el.innerHTML = (filterLabel ? `<div class="text-xs text-slate-400 mb-1">מציג: ${filterLabel} · <button id="doc-clear-filter" class="text-indigo-600">הכל</button></div>` : '') +
      docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(d => {
        const c = UI.cat(d.category);
        const [srcTxt, srcCls] = SOURCE_BADGE[d.source] || SOURCE_BADGE.upload;
        const sub = d.extracted?.confirmation ? `קוד: ${UI.esc(d.extracted.confirmation)}` : (d.extracted?.provider || '');
        return `
        <div class="bg-white rounded-2xl p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-3">
          <button class="doc-open flex items-center gap-3 flex-1 min-w-0 text-right" data-id="${d.id}">
            <span class="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-xl shrink-0">${c.emoji}</span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-slate-800 truncate">${UI.esc(d.extracted?.title || d.fileName)}</span>
              <span class="block text-[11px] text-slate-400 truncate">${c.he}${sub ? ' · ' + sub : ''} ${d.blob ? '' : '· ☁️'}</span>
            </span>
          </button>
          <span class="text-[10px] px-2 py-1 rounded-full ${srcCls} shrink-0">${srcTxt}</span>
          <button class="doc-menu text-slate-300 text-xl px-1 shrink-0" data-id="${d.id}">⋯</button>
        </div>`;
      }).join('');
    el.querySelectorAll('.doc-open').forEach(b => b.addEventListener('click', async () =>
      UI.viewer.open(await DB.get('documents', b.dataset.id))));
    el.querySelectorAll('.doc-menu').forEach(b => b.addEventListener('click', () => docMenu(trip, b.dataset.id)));
    el.querySelector('#doc-clear-filter')?.addEventListener('click', () => renderTab(trip, el.closest('.tab-panel')));
  }

  async function docMenu(trip, docId) {
    const d = await DB.get('documents', docId);
    UI.openModal({
      title: UI.esc(d.extracted?.title || d.fileName),
      hideConfirm: true,
      bodyHTML: `
        <div class="space-y-2">
          <button id="dm-view" class="tn-menu-btn">👁️ הצגת המסמך</button>
          <button id="dm-extract" class="tn-menu-btn">✨ חילוץ נתונים עם AI</button>
          <div><label class="tn-label mt-2">קטגוריה</label>
          <select id="dm-cat" class="tn-input">${UI.DOC_CATEGORIES.map(c => `<option value="${c.id}" ${(d.category || 'other') === c.id ? 'selected' : ''}>${c.emoji} ${c.he}</option>`).join('')}</select></div>
          <button id="dm-delete" class="tn-menu-btn !bg-red-50 !text-red-600">🗑️ מחיקה</button>
        </div>`,
    });
    document.getElementById('dm-view').addEventListener('click', () => { UI.closeModal(); UI.viewer.open(d); });
    document.getElementById('dm-cat').addEventListener('change', async (e) => {
      d.category = e.target.value; await DB.put('documents', d); G.Sync.queue();
      UI.toast('הקטגוריה עודכנה', 'success'); document.dispatchEvent(new CustomEvent('tn-data-changed'));
    });
    document.getElementById('dm-extract').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '✨ מחלץ…';
      try { await extractDoc(trip, d); UI.closeModal(); }
      catch (err) { UI.toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = '✨ חילוץ נתונים עם AI'; }
    });
    document.getElementById('dm-delete').addEventListener('click', () =>
      UI.confirm('למחוק את המסמך? (יימחק גם מהדרייב המשותף בסנכרון הבא של המכשירים)', async () => {
        await DB.remove('documents', d.id); G.Sync.queue();
        UI.toast('המסמך נמחק', 'success'); document.dispatchEvent(new CustomEvent('tn-data-changed'));
      }));
  }

  /* --- add flow (file / camera) --- */
  function addFlow(trip, { capture = false } = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = capture ? 'image/*' : 'application/pdf,image/*,.eml,text/*';
    if (capture) input.capture = 'environment'; else input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return;
      const docs = [];
      for (const f of files) {
        docs.push(await DB.put('documents', {
          tripId: trip.id, fileName: f.name || `צילום-${Date.now()}.jpg`, mimeType: f.type,
          size: f.size, blob: f, category: guessCategory(f.name), source: capture ? 'camera' : 'upload',
        }));
      }
      UI.toast(`${docs.length} מסמכים נוספו ✓`, 'success');
      G.Sync.queue();
      document.dispatchEvent(new CustomEvent('tn-data-changed'));
      if (await Gemini.hasKey()) for (const d of docs) extractDoc(trip, d, { silent: true });
    });
    input.click();
  }

  function guessCategory(name = '') {
    const n = name.toLowerCase();
    if (/(flight|ticket|boarding|טיסה|כרטיס)/.test(n)) return 'flight';
    if (/(hotel|booking|airbnb|מלון|לינה)/.test(n)) return 'stay';
    if (/(insurance|ביטוח)/.test(n)) return 'insurance';
    if (/(car|rental|רכב|השכרה)/.test(n)) return 'car';
    if (/(passport|דרכון)/.test(n)) return 'passport';
    if (/(visa|ויזה)/.test(n)) return 'visa';
    return 'other';
  }

  /* --- Gemini extraction → structured data + proposed itinerary events --- */
  async function extractDoc(trip, doc, { silent = false } = {}) {
    if (!(await Gemini.hasKey())) { if (!silent) throw new Error('חסר מפתח Gemini — הוסיפו בהגדרות'); return; }
    try {
      let extracted = null;
      const mt = doc.mimeType || '';
      if (mt === 'application/pdf' && doc.blob) {
        const text = await UI.pdfText(doc.blob);
        extracted = text.trim().length > 40
          ? await Gemini.extractFromText(text, doc.fileName)
          : await pdfAsImageExtract(doc); // scanned PDF → try first page as image? fall back to filename
      } else if (mt.startsWith('image/') && doc.blob) {
        extracted = await Gemini.extractFromImage(doc.blob, doc.fileName);
      } else if (mt.startsWith('text/') && doc.blob) {
        extracted = await Gemini.extractFromText(await doc.blob.text(), doc.fileName);
      }
      if (!extracted) { if (!silent) UI.toast('לא הצלחתי לחלץ נתונים מהמסמך', 'warning'); return; }
      // passport → offer to create a family member; the photo moves to the
      // local-only vault and the doc never reaches the shared Drive folder
      if (extracted.category === 'passport') {
        doc.category = 'passport';
        await DB.put('documents', doc);
        Members.proposeFromPassport(doc, extracted.passport || {});
        return;
      }
      doc.extracted = extracted;
      if (extracted.category) doc.category = extracted.category;
      await DB.put('documents', doc);
      G.Sync.queue();
      document.dispatchEvent(new CustomEvent('tn-data-changed'));
      const proposed = Itinerary.eventsFromExtracted(trip, doc);
      if (proposed.length) proposeEvents(trip, doc, proposed);
      else if (!silent) UI.toast('הנתונים חולצו ✓', 'success');
    } catch (e) {
      console.error('extract failed', e);
      if (!silent) throw e;
    }
  }

  async function pdfAsImageExtract(doc) {
    try {
      const data = await doc.blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1.5 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
      return Gemini.extractFromImage(blob, doc.fileName);
    } catch { return null; }
  }

  function proposeEvents(trip, doc, proposed) {
    UI.openModal({
      title: '✨ נמצאו אירועים למסלול',
      confirmLabel: 'הוספה לתוכנית',
      bodyHTML: `
        <p class="text-sm text-slate-500 mb-3">מתוך "${UI.esc(doc.extracted?.title || doc.fileName)}":</p>
        <div class="space-y-2">${proposed.map((ev, i) => `
          <label class="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
            <input type="checkbox" class="pe-check accent-indigo-600 w-4 h-4" data-i="${i}" checked>
            <span class="text-lg">${UI.eventType(ev.type).emoji}</span>
            <span class="text-sm"><b>${UI.esc(ev.title)}</b><br><span class="text-xs text-slate-400">${UI.fmtDate(ev.date)}${ev.time ? ' · ' + ev.time : ''}</span></span>
          </label>`).join('')}</div>`,
      onConfirm: async () => {
        const checks = [...document.querySelectorAll('.pe-check')];
        let n = 0;
        for (const c of checks) if (c.checked) { await DB.put('events', proposed[+c.dataset.i]); n++; }
        if (n) { G.Sync.queue(); document.dispatchEvent(new CustomEvent('tn-data-changed')); }
        UI.toast(`${n} אירועים נוספו לתוכנית ✓`, 'success');
      },
    });
  }

  /* --- Gmail import --- */
  async function emailImport(trip) {
    const keywords = await G.gmail.keywords();
    const both = await G.hasPartnerBridge();
    UI.openModal({
      title: '✉️ ייבוא מהמייל',
      confirmLabel: 'סריקה',
      bodyHTML: `
        <p class="text-xs text-slate-500 mb-3">${both
          ? 'סורק את תיבות ה-Gmail של שניכם לפי מילות המפתח המשותפות (ניתן לערוך בהגדרות).'
          : 'סורק את תיבת ה-Gmail שלך לפי מילות המפתח המשותפות. כדי לסרוק גם את התיבה של בן/בת הזוג — הוסיפו את הגשר שלו/שלה בהגדרות.'}</p>
        <div class="flex flex-wrap gap-1.5 mb-4">${keywords.slice(0, 12).map(k => `<span class="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-full">${UI.esc(k)}</span>`).join('')}${keywords.length > 12 ? `<span class="text-[10px] text-slate-400">+${keywords.length - 12}</span>` : ''}</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="tn-label">מתאריך</label><input id="ei-after" type="date" class="tn-input" value="${defaultAfter(trip)}"></div>
          <div><label class="tn-label">עד תאריך</label><input id="ei-before" type="date" class="tn-input"></div>
        </div>`,
      onConfirm: async () => {
        const q = G.gmail.buildQuery(keywords, {
          after: document.getElementById('ei-after').value || null,
          before: document.getElementById('ei-before').value || null,
        });
        const results = await G.gmail.search(q);
        showEmailResults(trip, results);
        return true; // keep flow going — showEmailResults replaces the modal
      },
    });
  }

  function defaultAfter(trip) {
    const d = trip.startDate ? UI.toDate(trip.startDate) : new Date();
    d.setDate(d.getDate() - 90);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function showEmailResults(trip, results) {
    if (!results.length) {
      UI.openModal({ title: '✉️ תוצאות סריקה', hideConfirm: true, bodyHTML: UI.emptyState('📭', 'לא נמצאו מיילים תואמים', 'נסו להרחיב את טווח התאריכים או להוסיף מילות מפתח בהגדרות') });
      return;
    }
    UI.openModal({
      title: `✉️ נמצאו ${results.length} מיילים`,
      confirmLabel: 'ייבוא הנבחרים',
      bodyHTML: `<div class="space-y-2 max-h-[50vh] overflow-y-auto">${results.map((r, i) => `
        <label class="flex items-start gap-3 bg-slate-50 rounded-xl p-3">
          <input type="checkbox" class="em-check accent-indigo-600 w-4 h-4 mt-1" data-i="${i}">
          <span class="min-w-0 text-sm">
            <b class="block truncate">${r.mailbox === 'partner' ? '<span class="text-[10px] bg-purple-50 text-purple-500 px-1.5 py-0.5 rounded-full ml-1 align-middle">התיבה של בן/בת הזוג</span>' : ''}${UI.esc(r.subject || '(ללא נושא)')}</b>
            <span class="block text-xs text-slate-400 truncate">${UI.esc(r.from)}</span>
            <span class="block text-[11px] text-slate-400 mt-0.5">${UI.esc((r.snippet || '').slice(0, 90))}…</span>
          </span>
        </label>`).join('')}</div>`,
      onConfirm: async () => {
        const picked = [...document.querySelectorAll('.em-check')].filter(c => c.checked).map(c => results[+c.dataset.i]);
        if (!picked.length) throw new Error('לא נבחרו מיילים');
        let files = 0;
        for (const r of picked) {
          const full = await G.gmail.getFull(r.id);
          const parts = G.gmail.walkParts(full.payload);
          const newDocs = [];
          for (const att of parts.attachments) {
            const blob = await G.gmail.getAttachment(r.id, att);
            newDocs.push(await DB.put('documents', {
              tripId: trip.id, fileName: att.filename, mimeType: att.mimeType, size: blob.size,
              blob, category: guessCategory(att.filename), source: 'email',
              emailMeta: { subject: r.subject, from: r.from, mailbox: r.mailbox || 'me' },
            }));
            files++;
          }
          if (!parts.attachments.length && (parts.html || parts.text)) {
            const body = parts.html || `<pre>${UI.esc(parts.text)}</pre>`;
            const blob = new Blob([`<meta charset="utf-8">${body}`], { type: 'text/html' });
            newDocs.push(await DB.put('documents', {
              tripId: trip.id, fileName: `${(r.subject || 'email').slice(0, 60)}.html`, mimeType: 'text/html',
              size: blob.size, blob, category: 'other', source: 'email',
              emailMeta: { subject: r.subject, from: r.from, mailbox: r.mailbox || 'me' },
            }));
            files++;
          }
          if (await Gemini.hasKey()) for (const d of newDocs) extractDoc(trip, d, { silent: true });
        }
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast(`${files} מסמכים יובאו מהמייל ✓`, 'success');
      },
    });
  }

  return { renderTab, addFlow, extractDoc, emailImport, guessCategory };
})();
window.Documents = Documents;
