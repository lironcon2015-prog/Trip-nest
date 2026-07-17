/* TripNest — passport vault. Photos live ONLY in this device's IndexedDB:
   never uploaded to Drive, never sent to Gemini, excluded from local backups. */
const Vault = (() => {
  let _unlocked = false;

  async function requirePin() {
    const pin = await DB.settings.get('vaultPin');
    if (!pin || _unlocked) return true;
    return new Promise((resolve) => {
      UI.openModal({
        title: 'כספת דרכונים',
        confirmLabel: 'פתיחה',
        bodyHTML: `<input id="vault-pin" type="password" inputmode="numeric" class="tn-input text-center tracking-widest" placeholder="קוד גישה" autofocus>`,
        onConfirm: async () => {
          const entered = document.getElementById('vault-pin').value;
          const hash = await sha256(entered);
          if (hash !== pin) throw new Error('קוד שגוי');
          _unlocked = true;
          resolve(true);
        },
      });
    });
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function open() {
    if (!(await requirePin())) return;
    const members = await DB.all('members');
    const shots = await DB.allRaw('vault');

    const rows = members.map(m => {
      const mine = shots.filter(v => v.memberId === m.id);
      return `
        <div class="bg-white rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div class="flex items-center gap-3 mb-3">
            ${UI.avatarHTML(m, 'w-10 h-10')}
            <div class="flex-1"><div class="font-semibold text-slate-800 text-sm">${UI.esc(m.nameHe)}</div>
            <div class="text-[11px] text-slate-400">${mine.length ? `${mine.length} צילומים במכשיר` : 'אין צילום במכשיר הזה'}</div></div>
            <button class="vault-add text-xs bg-indigo-50 text-indigo-600 font-medium px-3 py-1.5 rounded-full" data-member="${m.id}">${UI.icon('camera', 'w-3.5 h-3.5')} הוספה</button>
          </div>
          ${mine.length ? `<div class="grid grid-cols-3 gap-2">${mine.map(v => `
            <div class="relative group">
              <button class="vault-view w-full" data-id="${v.id}"><img data-vimg="${v.id}" class="w-full h-20 object-cover rounded-xl ring-1 ring-slate-200"></button>
              <button class="vault-del absolute top-1 left-1 bg-black/60 text-white w-6 h-6 rounded-full text-xs" data-id="${v.id}">✕</button>
              ${v.expiryDate ? `<span class="absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded-md ${expiryClass(v.expiryDate)}">${v.expiryDate.slice(0, 7)}</span>` : ''}
            </div>`).join('')}</div>` : ''}
        </div>`;
    }).join('');

    UI.openModal({
      title: 'כספת דרכונים',
      hideConfirm: true,
      bodyHTML: `
        <div class="bg-amber-50 text-amber-700 text-xs p-3 rounded-xl mb-4 flex gap-2 items-start">
          <span class="shrink-0">${UI.icon('lock', 'w-4 h-4')}</span><span>הצילומים נשמרים <b>במכשיר הזה בלבד</b> — לא עולים לדרייב, לא נשלחים ל-AI ולא נכללים בגיבויים.</span>
        </div>
        <button id="vault-new-passport" class="tn-btn-primary w-full mb-4">${UI.icon('id', 'w-4 h-4')} העלאת דרכונים — זיהוי ושיוך אוטומטי</button>
        <div class="space-y-3">${rows || UI.emptyState('users', 'אין עדיין בני משפחה', 'העלו דרכון בכפתור למעלה — בן המשפחה ייווצר אוטומטית מהפרטים שבו')}</div>`,
    });

    document.getElementById('vault-new-passport').addEventListener('click', newFromPassport);

    const all = await DB.allRaw('vault');
    all.forEach(v => {
      const img = document.querySelector(`[data-vimg="${v.id}"]`);
      if (img && v.blob) img.src = URL.createObjectURL(v.blob);
    });
    document.querySelectorAll('.vault-add').forEach(b => b.addEventListener('click', () => capture(b.dataset.member)));
    document.querySelectorAll('.vault-view').forEach(b => b.addEventListener('click', async () => {
      const v = await DB.get('vault', b.dataset.id);
      const m = members.find(x => x.id === v.memberId);
      UI.viewer.open({ fileName: `דרכון — ${m?.nameHe || ''}`, mimeType: v.blob?.type || 'image/jpeg', blob: v.blob });
    }));
    document.querySelectorAll('.vault-del').forEach(b => b.addEventListener('click', () =>
      UI.confirm('למחוק את צילום הדרכון מהמכשיר?', async () => { await DB.remove('vault', b.dataset.id); UI.toast('נמחק', 'success'); open(); })));
  }

  function expiryClass(expiry) {
    const months = (UI.toDate(expiry) - new Date()) / (86400000 * 30.4);
    if (months < 6) return 'bg-red-600 text-white';
    if (months < 12) return 'bg-amber-500 text-white';
    return 'bg-black/60 text-white';
  }

  // on-device OCR takes seconds per passport (and the first run also loads the OCR
  // engine) — a blocking progress modal keeps the upload from looking like a no-op
  function readingModal(total) {
    UI.openModal({
      title: '🛂 קריאת דרכונים',
      hideConfirm: true,
      bodyHTML: `
        <div class="flex flex-col items-center gap-4 py-6 text-center">
          <span class="inline-block w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></span>
          <div id="mrz-progress" class="text-sm font-medium text-slate-700">${total === 1 ? 'קורא את הדרכון במכשיר…' : `קורא דרכון 1 מתוך ${total}…`}</div>
          <p class="text-[11px] text-slate-400 leading-relaxed">הזיהוי רץ מקומית במכשיר (OCR), בלי לשלוח את הצילום לשום מקום — זה עשוי לקחת כמה שניות לכל דרכון.</p>
        </div>`,
    });
    return (i) => {
      const el = document.getElementById('mrz-progress');
      if (el) el.textContent = `קורא דרכון ${i} מתוך ${total}…`;
    };
  }

  /* passport → family member: local MRZ read. Single file opens the review modal;
     multiple files open one assignment screen — every passport gets a thumbnail and
     a member selector (best match preselected), and nothing is saved before the
     user confirms, so existing members are never recreated behind their back. */
  function newFromPassport() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return;
      if (files.length === 1) {
        const f = files[0];
        readingModal(1);
        let p = null;
        try { p = await MRZ.fromImage(f, { thorough: true }); } catch { }
        if (!p) UI.toast('לא הצלחתי לקרוא את שורות ה-MRZ — מלאו את הפרטים ידנית', 'warning');
        Members.proposeFromPassport({ blob: f, mimeType: f.type }, p || {}, { onDone: () => open() });
        return;
      }
      const tick = readingModal(files.length);
      const members = Members.sorted(await DB.all('members'));
      const shots = await DB.allRaw('vault');
      const rows = [];
      for (const [i, f] of files.entries()) {
        tick(i + 1);
        let p = null;
        try { p = await MRZ.fromImage(f, { thorough: true }); } catch { }
        rows.push({ f, p, match: p ? Members.matchPassport(members, shots, p) : null });
      }
      assignModal(rows, members);
    });
    input.click();
  }

  // one screen for the whole batch: thumbnail + what the MRZ said + member selector.
  // Even an unreadable photo can be assigned by eye thanks to the thumbnail.
  function assignModal(rows, members) {
    UI.openModal({
      title: 'שיוך דרכונים לבני משפחה',
      confirmLabel: 'שמירה בכספת',
      bodyHTML: `
        <p class="text-xs text-slate-500 mb-3">בדקו את השיוך של כל דרכון ותקנו אם צריך — שום דבר לא נשמר לפני האישור. הצילומים נשמרים <b>בכספת במכשיר הזה בלבד</b>.</p>
        <div class="space-y-2">
          ${rows.map((r, i) => `
            <div class="flex items-center gap-3 bg-slate-50 rounded-2xl p-2 pl-3">
              <img id="pa-img-${i}" class="w-16 h-11 object-cover rounded-lg ring-1 ring-slate-200 shrink-0">
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium ${r.p ? 'text-slate-700' : 'text-amber-600'} truncate" dir="ltr">${r.p ? UI.esc(r.p.nameEn) : `${UI.esc(r.f.name)} — לא זוהו שורות MRZ`}</div>
                <select id="pa-sel-${i}" class="tn-input mt-1 !py-1.5 text-sm">
                  ${members.map(m => `<option value="${m.id}" ${r.match && r.match.id === m.id ? 'selected' : ''}>${UI.esc(m.nameHe)}${m.nameEn ? ` — ${UI.esc(m.nameEn)}` : ''}</option>`).join('')}
                  ${r.p ? `<option value="__new" ${r.match ? '' : 'selected'}>➕ בן משפחה חדש (${UI.esc(r.p.nameEn)})</option>` : ''}
                  <option value="__skip" ${!r.p && !r.match ? 'selected' : ''}>דילוג — בלי לשמור</option>
                </select>
              </div>
            </div>`).join('')}
        </div>`,
      onConfirm: async () => {
        let saved = 0, created = 0;
        for (const [i, r] of rows.entries()) {
          const sel = document.getElementById(`pa-sel-${i}`).value;
          if (sel === '__skip') continue;
          let member;
          if (sel === '__new') {
            member = await DB.put('members', { nameHe: r.p.nameHe || r.p.nameEn, nameEn: r.p.nameEn || '', birthDate: r.p.birthDate || null });
            created++;
          } else {
            member = await DB.get('members', sel);
            if (!member) continue;
            if (!member.birthDate && r.p?.birthDate) member.birthDate = r.p.birthDate;
            if (!member.nameEn && r.p?.nameEn) member.nameEn = r.p.nameEn;
            await DB.put('members', member);
          }
          await DB.putRaw('vault', {
            id: DB.uid(), memberId: member.id, blob: r.f, mimeType: r.f.type,
            expiryDate: r.p?.expiryDate || null, passportNumber: r.p?.passportNumber || null, createdAt: Date.now(),
          });
          saved++;
        }
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast(`${saved} דרכונים נשמרו בכספת 🔒${created ? ` (+${created} בני משפחה חדשים)` : ''}`, 'success');
        open();
      },
    });
    rows.forEach((r, i) => {
      const img = document.getElementById(`pa-img-${i}`);
      if (img) img.src = URL.createObjectURL(r.f);
    });
  }

  function capture(memberId) {
    const input = document.createElement('input');
    // no `capture` attribute — the OS offers both camera and photo/file upload
    input.type = 'file'; input.accept = 'image/*';
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      UI.openModal({
        title: 'שמירת צילום דרכון',
        confirmLabel: 'שמירה בכספת',
        bodyHTML: `
          <img id="vc-preview" class="w-full max-h-60 object-contain rounded-2xl bg-slate-100 mb-4">
          <label class="tn-label">תוקף הדרכון (לא חובה — משמש להתרעות)</label>
          <input id="vc-expiry" type="date" class="tn-input">
          <p id="vc-mrz-hint" class="text-[11px] text-indigo-400 mt-1"></p>
          <p class="text-[11px] text-slate-400 mt-3">🔐 נשמר במכשיר הזה בלבד.</p>`,
        onConfirm: async () => {
          await DB.putRaw('vault', {
            id: DB.uid(), memberId, blob: f, mimeType: f.type,
            expiryDate: document.getElementById('vc-expiry').value || null, createdAt: Date.now(),
          });
          UI.toast('צילום הדרכון נשמר בכספת 🔒', 'success');
          document.dispatchEvent(new CustomEvent('tn-data-changed'));
        },
      });
      document.getElementById('vc-preview').src = URL.createObjectURL(f);
      // local MRZ read (on-device) to prefill the expiry date
      MRZ.fromImage(f, { thorough: true }).then(p => {
        const el = document.getElementById('vc-expiry');
        if (p?.expiryDate && el && !el.value) {
          el.value = p.expiryDate;
          const hint = document.getElementById('vc-mrz-hint');
          if (hint) hint.textContent = '✓ התוקף זוהה מקומית מהדרכון';
        }
      }).catch(() => { });
    });
    input.click();
  }

  // passport expiry alerts for a trip's actual travelers (device-local knowledge)
  async function alertsForTrip(trip) {
    const out = [];
    const shots = await DB.allRaw('vault');
    const members = await DB.all('members');
    for (const mid of (trip.memberIds || [])) {
      const m = members.find(x => x.id === mid);
      if (!m) continue;
      const withExpiry = shots.filter(v => v.memberId === mid && v.expiryDate);
      for (const v of withExpiry) {
        const sixMonthsAfterTrip = new Date(UI.toDate(trip.endDate || trip.startDate));
        sixMonthsAfterTrip.setMonth(sixMonthsAfterTrip.getMonth() + 6);
        if (UI.toDate(v.expiryDate) < sixMonthsAfterTrip)
          out.push({ level: UI.toDate(v.expiryDate) < UI.toDate(trip.startDate) ? 'error' : 'warning', text: `הדרכון של ${m.nameHe} בתוקף עד ${UI.fmtDate(v.expiryDate)} — פחות מ-6 חודשים אחרי "${trip.name}"` });
      }
    }
    return out;
  }

  async function setPin() {
    UI.openModal({
      title: 'קוד גישה לכספת',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <input id="pin-new" type="password" inputmode="numeric" class="tn-input text-center tracking-widest" placeholder="קוד חדש (השאירו ריק לביטול)">
        <p class="text-[11px] text-slate-400 mt-2">הקוד מגן על פתיחת הכספת במכשיר הזה.</p>`,
      onConfirm: async () => {
        const val = document.getElementById('pin-new').value;
        if (!val) { await DB.settings.del('vaultPin'); UI.toast('הקוד הוסר', 'success'); }
        else { await DB.settings.set('vaultPin', await sha256(val)); UI.toast('קוד נשמר 🔒', 'success'); }
        _unlocked = false;
      },
    });
  }

  return { open, capture, alertsForTrip, setPin };
})();
window.Vault = Vault;
