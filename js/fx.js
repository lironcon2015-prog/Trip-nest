/* TripNest — fx: local-currency converter. Enter the rate before the trip, convert prices during it. */
window.FX = (function () {
  const LAST_KEY = 'tn-fx-last'; // { tripId: currency } — remembers the currency picked per trip, device-local

  const lastCur = (tripId) => {
    try { return (JSON.parse(localStorage.getItem(LAST_KEY) || '{}'))[tripId] || null; } catch { return null; }
  };
  const rememberCur = (tripId, cur) => {
    try {
      const m = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
      m[tripId] = cur;
      localStorage.setItem(LAST_KEY, JSON.stringify(m));
    } catch { /* private mode / blocked storage — the converter still works, just forgets */ }
  };

  /* currency whose rate is set; otherwise the one remembered, otherwise the first foreign currency */
  const defaultCur = (trip) => {
    const rates = trip.fxRates || {};
    const foreign = UI.CURRENCIES.filter(c => c !== '₪');
    const remembered = lastCur(trip.id);
    if (remembered && foreign.includes(remembered)) return remembered;
    return foreign.find(c => Number(rates[c]) > 0) || foreign[0];
  };

  const fmtNum = (n) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 });

  /* live two-way converter; the rate is editable here and saved to the trip on confirm */
  function converterModal(trip) {
    const rates = { ...(trip.fxRates || {}) };
    let cur = defaultCur(trip);

    UI.openModal({
      title: 'מחשבון המרה',
      confirmLabel: 'שמירת השער',
      bodyHTML: `
        <div class="space-y-4">
          <div class="flex gap-1.5">
            ${UI.CURRENCIES.filter(c => c !== '₪').map(c => `
              <button class="fx-cur flex-1 py-2 rounded-xl text-sm font-semibold ${c === cur ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}" data-cur="${c}">${c}</button>`).join('')}
          </div>
          <div class="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2.5 text-sm text-slate-500" dir="ltr">
            <span class="shrink-0"><span id="fx-rate-cur">${cur}</span>1 =</span>
            <input id="fx-rate" type="number" step="0.001" min="0" inputmode="decimal" class="flex-1 min-w-0 bg-transparent outline-none font-semibold text-slate-700" value="${rates[cur] ?? ''}" placeholder="שער">
            <span class="shrink-0">₪</span>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <label class="block">
              <span class="tn-label" id="fx-lbl-for">מחיר ב<span id="fx-cur-name">${cur}</span></span>
              <input id="fx-for" type="number" step="0.01" min="0" inputmode="decimal" class="tn-input text-center font-bold" dir="ltr" placeholder="0">
            </label>
            <span class="text-slate-300 pt-5">⇄</span>
            <label class="block">
              <span class="tn-label">בשקלים</span>
              <input id="fx-ils" type="number" step="0.01" min="0" inputmode="decimal" class="tn-input text-center font-bold" dir="ltr" placeholder="0">
            </label>
          </div>
          <div id="fx-hint" class="text-[11px] text-slate-400 text-center leading-relaxed"></div>
        </div>`,
      onConfirm: async () => {
        stash(); // the field showing now may hold an unsaved edit
        const fx = {};
        for (const c of UI.CURRENCIES) if (Number(rates[c]) > 0) fx[c] = Number(rates[c]);
        trip.fxRates = fx;
        await DB.put('trips', trip);
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
      },
    });

    const rateEl = document.getElementById('fx-rate');
    const forEl = document.getElementById('fx-for');
    const ilsEl = document.getElementById('fx-ils');
    const hintEl = document.getElementById('fx-hint');
    const rate = () => Number(rateEl.value) || 0;
    /* keep an edited rate when switching currency, so nothing typed is lost */
    const stash = () => { const v = parseFloat(rateEl.value); if (v > 0) rates[cur] = v; else delete rates[cur]; };

    function hint() {
      if (!(rate() > 0)) { hintEl.innerHTML = 'הזינו את שער ההמרה כדי לחשב מחירים'; return; }
      // a short reference table makes eyeballing a price tag in a shop quick
      hintEl.innerHTML = [10, 50, 100].map(n => `${cur}${n} ≈ ₪${fmtNum(n * rate())}`).join(' · ');
    }
    const fromFor = () => { ilsEl.value = rate() > 0 && forEl.value !== '' ? +(Number(forEl.value) * rate()).toFixed(2) : ''; };
    const fromIls = () => { forEl.value = rate() > 0 && ilsEl.value !== '' ? +(Number(ilsEl.value) / rate()).toFixed(2) : ''; };

    forEl.addEventListener('input', fromFor);
    ilsEl.addEventListener('input', fromIls);
    rateEl.addEventListener('input', () => { hint(); fromFor(); });
    document.querySelectorAll('.fx-cur').forEach(b => b.addEventListener('click', () => {
      stash();
      cur = b.dataset.cur;
      rememberCur(trip.id, cur);
      document.querySelectorAll('.fx-cur').forEach(o => {
        const on = o.dataset.cur === cur;
        o.className = `fx-cur flex-1 py-2 rounded-xl text-sm font-semibold ${on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`;
      });
      document.getElementById('fx-rate-cur').textContent = cur;
      document.getElementById('fx-cur-name').textContent = cur;
      rateEl.value = rates[cur] ?? '';
      hint(); fromFor();
    }));
    hint();
    forEl.focus();
  }

  return { converterModal, defaultCur };
})();
