/* TripNest — family members: avatar strip, profile card (Hebrew/English name, age, passport). */
const Members = (() => {

  async function strip(containerId) {
    const el = document.getElementById(containerId);
    const members = await DB.all('members');
    el.innerHTML = members.map(m => `
      <button class="flex flex-col items-center gap-1.5 shrink-0" data-member="${m.id}">
        ${UI.avatarHTML(m, 'w-14 h-14')}
        <span class="text-xs text-slate-500">${UI.esc(m.nameHe)}</span>
      </button>`).join('') + `
      <button id="${containerId}-add" class="flex flex-col items-center gap-1.5 shrink-0">
        <span class="w-14 h-14 rounded-full border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center text-2xl font-light">+</span>
        <span class="text-xs text-slate-400">הוספה</span>
      </button>`;
    el.querySelectorAll('[data-member]').forEach(b =>
      b.addEventListener('click', () => openProfile(b.dataset.member)));
    document.getElementById(`${containerId}-add`).addEventListener('click', () => editModal());
  }

  async function openProfile(memberId) {
    const m = await DB.get('members', memberId);
    if (!m) return;
    const shots = (await DB.allRaw('vault')).filter(v => v.memberId === memberId);
    const a = UI.age(m.birthDate);

    const passportHTML = shots.length
      ? `<div class="grid grid-cols-2 gap-3">${shots.map(v => `
          <button class="relative rounded-2xl overflow-hidden ring-1 ring-slate-200" data-vault="${v.id}">
            <img src="" data-vault-img="${v.id}" class="w-full h-28 object-cover">
            ${v.expiryDate ? `<span class="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-lg">בתוקף עד ${UI.fmtDateShort(v.expiryDate)} ${v.expiryDate.slice(0, 4)}</span>` : ''}
          </button>`).join('')}</div>`
      : `<div class="bg-slate-50 rounded-2xl p-4 text-center text-sm text-slate-500">
           אין צילום דרכון במכשיר הזה.<br><span class="text-xs text-slate-400">ייתכן שהוא שמור מקומית במכשיר אחר במשפחה.</span>
         </div>`;

    UI.openModal({
      title: '',
      hideConfirm: true,
      bodyHTML: `
        <div class="flex flex-col items-center text-center -mt-2">
          ${UI.avatarHTML(m, 'w-24 h-24', 'shadow-md')}
          <h3 class="mt-3 text-xl font-bold text-slate-800">${UI.esc(m.nameHe)}</h3>
          <div class="text-slate-400 text-sm">${UI.esc(m.nameEn || '')}</div>
          ${a != null ? `<span class="mt-2 bg-indigo-50 text-indigo-600 text-xs font-medium px-3 py-1 rounded-full">גיל ${a}</span>` : ''}
        </div>
        <div class="mt-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold text-slate-700">🛂 דרכון <span class="text-[10px] font-normal text-slate-400">(מקומי בלבד)</span></span>
            <button id="profile-add-passport" class="text-xs text-indigo-600 font-medium">📷 צילום / העלאת דרכון</button>
          </div>
          ${passportHTML}
        </div>
        <div class="mt-5 flex gap-2">
          <button id="profile-edit" class="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium">✏️ עריכה</button>
          <button id="profile-delete" class="py-2.5 px-4 rounded-xl bg-red-50 text-red-600 text-sm font-medium">מחיקה</button>
        </div>`,
    });

    // vault blobs → object URLs
    shots.forEach(v => {
      const img = document.querySelector(`[data-vault-img="${v.id}"]`);
      if (img && v.blob) img.src = URL.createObjectURL(v.blob);
    });
    document.querySelectorAll('[data-vault]').forEach(b =>
      b.addEventListener('click', () => {
        const v = shots.find(x => x.id === b.dataset.vault);
        if (v) UI.viewer.open({ fileName: `דרכון — ${m.nameHe}`, mimeType: v.blob?.type || 'image/jpeg', blob: v.blob });
      }));
    document.getElementById('profile-add-passport').addEventListener('click', () => { UI.closeModal(); Vault.capture(memberId); });
    document.getElementById('profile-edit').addEventListener('click', () => editModal(m));
    document.getElementById('profile-delete').addEventListener('click', () =>
      UI.confirm(`למחוק את ${m.nameHe}? צילומי הדרכון המקומיים שלו יימחקו גם כן.`, async () => {
        for (const v of (await DB.allRaw('vault')).filter(v => v.memberId === m.id)) await DB.remove('vault', v.id);
        await DB.remove('members', m.id);
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('בן המשפחה נמחק', 'success');
      }));
  }

  function editModal(m = null) {
    let avatar = m?.avatar || null;
    UI.openModal({
      title: m ? 'עריכת בן משפחה' : 'בן משפחה חדש',
      confirmLabel: 'שמירה',
      bodyHTML: `
        <div class="space-y-4">
          <div class="flex justify-center">
            <button type="button" id="mf-avatar-btn" class="relative">
              <span id="mf-avatar-preview">${avatar
          ? `<img src="${avatar}" class="w-20 h-20 rounded-full object-cover ring-1 ring-slate-200">`
          : '<span class="w-20 h-20 rounded-full border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center text-3xl">🙂</span>'}</span>
              <span class="absolute -bottom-1 -left-1 bg-indigo-600 text-white w-7 h-7 rounded-full flex items-center justify-center text-sm shadow">📷</span>
            </button>
            <input type="file" id="mf-avatar" accept="image/*" class="hidden">
          </div>
          <p class="text-center text-xs text-slate-400">אוואטאר (אפשר להכין עם Gemini ולהעלות כאן)</p>
          <div><label class="tn-label">שם בעברית *</label><input id="mf-name-he" class="tn-input" value="${UI.esc(m?.nameHe || '')}"></div>
          <div><label class="tn-label">שם באנגלית (כמו בדרכון)</label><input id="mf-name-en" class="tn-input" dir="ltr" value="${UI.esc(m?.nameEn || '')}"></div>
          <div><label class="tn-label">תאריך לידה</label><input id="mf-birth" type="date" class="tn-input" value="${m?.birthDate || ''}"></div>
        </div>`,
      onConfirm: async () => {
        const nameHe = document.getElementById('mf-name-he').value.trim();
        if (!nameHe) throw new Error('חסר שם בעברית');
        await DB.put('members', {
          ...(m || {}), nameHe,
          nameEn: document.getElementById('mf-name-en').value.trim(),
          birthDate: document.getElementById('mf-birth').value || null,
          avatar,
        });
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast('נשמר ✓', 'success');
      },
    });
    document.getElementById('mf-avatar-btn').addEventListener('click', () => document.getElementById('mf-avatar').click());
    document.getElementById('mf-avatar').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      avatar = await UI.fileToDataURL(f, 256);
      document.getElementById('mf-avatar-preview').innerHTML = `<img src="${avatar}" class="w-20 h-20 rounded-full object-cover ring-1 ring-slate-200">`;
    });
  }

  // avatar multi-select used by the trip form
  async function pickerHTML(selectedIds = []) {
    const members = await DB.all('members');
    if (!members.length) return '<p class="text-xs text-slate-400">אין עדיין בני משפחה — הוסיפו במסך הבית</p>';
    return `<div class="flex gap-3 flex-wrap">${members.map(m => `
      <button type="button" class="tn-member-pick flex flex-col items-center gap-1 ${selectedIds.includes(m.id) ? 'picked' : ''}" data-id="${m.id}">
        ${UI.avatarHTML(m, 'w-12 h-12')}
        <span class="text-[11px] text-slate-500">${UI.esc(m.nameHe)}</span>
      </button>`).join('')}</div>`;
  }
  function wirePicker(container) {
    container.querySelectorAll('.tn-member-pick').forEach(b =>
      b.addEventListener('click', () => b.classList.toggle('picked')));
  }
  const pickedIds = (container) => [...container.querySelectorAll('.tn-member-pick.picked')].map(b => b.dataset.id);

  /* --- passport upload → auto family member (photo goes to the local vault)
     source = { blob, mimeType, docId? } — docId is removed from documents on confirm --- */
  function proposeFromPassport(source, p, { onDone } = {}) {
    UI.openModal({
      title: '🛂 זוהה דרכון!',
      confirmLabel: 'יצירת בן משפחה',
      bodyHTML: `
        <div class="space-y-3">
          <p class="text-xs text-slate-500">הפרטים חולצו <b>מקומית במכשיר</b> (קריאת MRZ, בלי AI חיצוני) — בדקו והשלימו:</p>
          <div><label class="tn-label">שם בעברית *</label><input id="pp-name-he" class="tn-input" value="${UI.esc(p.nameHe || '')}"></div>
          <div><label class="tn-label">שם באנגלית (כמו בדרכון)</label><input id="pp-name-en" class="tn-input" dir="ltr" value="${UI.esc(p.nameEn || '')}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="tn-label">תאריך לידה</label><input id="pp-birth" type="date" class="tn-input" value="${p.birthDate || ''}"></div>
            <div><label class="tn-label">תוקף הדרכון</label><input id="pp-expiry" type="date" class="tn-input" value="${p.expiryDate || ''}"></div>
          </div>
          <div><label class="tn-label">מספר דרכון</label><input id="pp-number" class="tn-input" dir="ltr" value="${UI.esc(p.passportNumber || '')}"></div>
          <p class="text-[11px] text-slate-400">🔐 צילום הדרכון יישמר <b>בכספת במכשיר הזה בלבד</b> ויוסר מהמסמכים — הוא לא יעלה לדרייב.</p>
        </div>`,
      onConfirm: async () => {
        const nameHe = document.getElementById('pp-name-he').value.trim();
        const nameEn = document.getElementById('pp-name-en').value.trim();
        if (!nameHe && !nameEn) throw new Error('חסר שם');
        // אם בן המשפחה כבר קיים (לפי שם) — מצרפים אליו את הדרכון במקום ליצור כפול
        const members = await DB.all('members');
        let member = members.find(m =>
          (nameEn && (m.nameEn || '').toLowerCase() === nameEn.toLowerCase()) ||
          (nameHe && m.nameHe === nameHe));
        const existed = !!member;
        if (member) {
          if (!member.birthDate && document.getElementById('pp-birth').value) member.birthDate = document.getElementById('pp-birth').value;
          if (!member.nameEn && nameEn) member.nameEn = nameEn;
          await DB.put('members', member);
        } else {
          member = await DB.put('members', {
            nameHe: nameHe || nameEn, nameEn,
            birthDate: document.getElementById('pp-birth').value || null,
          });
        }
        if (source.blob) {
          await DB.putRaw('vault', {
            id: DB.uid(), memberId: member.id, blob: source.blob, mimeType: source.mimeType,
            expiryDate: document.getElementById('pp-expiry').value || null,
            passportNumber: document.getElementById('pp-number').value.trim() || null,
            createdAt: Date.now(),
          });
        }
        if (source.docId) await DB.remove('documents', source.docId);
        G.Sync.queue();
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        UI.toast(existed ? `הדרכון צורף ל${member.nameHe} ✓` : `${member.nameHe} נוסף למשפחה + דרכון בכספת 🔒`, 'success');
        if (onDone) onDone();
      },
    });
  }

  return { strip, openProfile, editModal, pickerHTML, wirePicker, pickedIds, proposeFromPassport };
})();
window.Members = Members;
