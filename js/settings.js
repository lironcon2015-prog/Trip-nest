/* TripNest — settings: Google connection & shared folder, email keywords, Gemini & persona,
   family members, vault PIN, local backup, version. */
const Settings = (() => {

  async function render() {
    const el = document.getElementById('settings-body');
    const [clientId, apiKey, folderId, folderName, geminiKey, persona, lastSync] = await Promise.all([
      DB.settings.get('googleClientId'), DB.settings.get('googleApiKey'),
      DB.settings.get('driveFolderId'), DB.settings.get('driveFolderName'),
      DB.settings.get('geminiKey'), DB.settings.get('agentPersona'), DB.settings.get('lastSync'),
    ]);
    const keywords = await G.gmail.keywords();

    el.innerHTML = `
      <!-- Google -->
      <section class="tn-card">
        <h3 class="tn-card-title">☁️ חיבור Google (דרייב + Gmail)</h3>
        <div class="space-y-3">
          <div><label class="tn-label">OAuth Client ID</label>
            <input id="st-client-id" class="tn-input text-xs" dir="ltr" placeholder="xxxx.apps.googleusercontent.com" value="${UI.esc(clientId || '')}"></div>
          <div><label class="tn-label">API Key (לבוחר התיקיות)</label>
            <input id="st-api-key" class="tn-input text-xs" dir="ltr" placeholder="AIza..." value="${UI.esc(apiKey || '')}"></div>
          <button id="st-save-google" class="tn-btn-secondary w-full">שמירת פרטי חיבור</button>
          <div class="bg-slate-50 rounded-xl p-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 text-xs">תיקייה משותפת בדרייב:</span>
              <b class="text-slate-700 text-xs">${folderName ? UI.esc(folderName) : '— לא נבחרה —'}</b>
            </div>
            <div class="flex gap-2 mt-2">
              <button id="st-pick-folder" class="tn-btn-secondary flex-1 !text-xs">📂 בחירת תיקייה</button>
              <button id="st-create-folder" class="tn-btn-secondary flex-1 !text-xs">➕ יצירה ושיתוף</button>
            </div>
          </div>
          <button id="st-sync-now" class="tn-btn-primary w-full" ${folderId ? '' : 'disabled'}>🔄 סנכרון עכשיו</button>
          <div class="text-[11px] text-slate-400 text-center">${lastSync ? 'סנכרון אחרון: ' + new Date(lastSync).toLocaleString('he-IL') : 'טרם בוצע סנכרון'}</div>
        </div>
      </section>

      <!-- Keywords -->
      <section class="tn-card">
        <h3 class="tn-card-title">✉️ מילות מפתח לסריקת מייל</h3>
        <p class="text-[11px] text-slate-400 mb-3">משותפות לשניכם (מסתנכרנות דרך הדרייב). המיילים נסרקים לפי מילים אלה.</p>
        <div id="st-keywords" class="flex flex-wrap gap-1.5 mb-3">${keywords.map((k, i) => `
          <span class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 text-xs px-2.5 py-1 rounded-full">
            ${UI.esc(k)}<button class="kw-del text-indigo-300" data-i="${i}">✕</button></span>`).join('')}</div>
        <form id="st-kw-form" class="flex gap-2">
          <input id="st-kw-input" class="tn-input !py-2 text-sm flex-1" placeholder="מילת מפתח חדשה…">
          <button class="tn-btn-secondary">הוספה</button>
        </form>
        <button id="st-kw-reset" class="text-[11px] text-slate-400 mt-2">איפוס לברירת המחדל</button>
      </section>

      <!-- Gemini -->
      <section class="tn-card">
        <h3 class="tn-card-title">🤖 סוכן AI (Gemini)</h3>
        <div class="space-y-3">
          <div><label class="tn-label">Gemini API Key <span class="text-slate-300">(נשמר במכשיר בלבד)</span></label>
            <input id="st-gemini-key" type="password" class="tn-input text-xs" dir="ltr" placeholder="AIza..." value="${UI.esc(geminiKey || '')}"></div>
          <div><label class="tn-label">האישיות של הסוכן</label>
            <textarea id="st-persona" rows="6" class="tn-input text-xs leading-relaxed">${UI.esc(persona || Agent.DEFAULT_PERSONA)}</textarea>
            <p class="text-[11px] text-slate-400 mt-1">האישיות משותפת לשניכם — ערכו אותה יחד 💜</p></div>
          <button id="st-save-gemini" class="tn-btn-secondary w-full">שמירה</button>
        </div>
      </section>

      <!-- Members -->
      <section class="tn-card">
        <h3 class="tn-card-title">👨‍👩‍👧‍👦 בני המשפחה</h3>
        <div id="st-members" class="space-y-2 mb-3"></div>
        <button id="st-add-member" class="tn-btn-secondary w-full">+ בן משפחה חדש</button>
      </section>

      <!-- Vault & backup -->
      <section class="tn-card">
        <h3 class="tn-card-title">🔐 פרטיות וגיבוי</h3>
        <div class="space-y-2">
          <button id="st-vault-pin" class="tn-menu-btn">🔢 קוד גישה לכספת הדרכונים</button>
          <button id="st-export" class="tn-menu-btn">⬇️ ייצוא גיבוי מקומי (JSON)</button>
          <button id="st-import" class="tn-menu-btn">⬆️ שחזור מגיבוי</button>
          <input type="file" id="st-import-file" accept="application/json" class="hidden">
          <p class="text-[11px] text-slate-400">צילומי הדרכון לא נכללים בגיבוי — הם לא עוזבים את המכשיר.</p>
        </div>
      </section>

      <div class="text-center text-[11px] text-slate-300 pb-4">המזוודה · TripNest v<span id="st-version">${window._BUNDLE_VERSION || ''}</span></div>`;

    /* wiring */
    document.getElementById('st-save-google').addEventListener('click', async () => {
      await DB.settings.set('googleClientId', document.getElementById('st-client-id').value.trim());
      await DB.settings.set('googleApiKey', document.getElementById('st-api-key').value.trim());
      UI.toast('נשמר ✓ עכשיו אפשר לבחור תיקייה', 'success');
    });

    document.getElementById('st-pick-folder').addEventListener('click', async () => {
      try {
        const picked = await G.pickFolder();
        if (!picked) return;
        await DB.settings.set('driveFolderId', picked.id);
        await DB.settings.set('driveFolderName', picked.name);
        UI.toast(`נבחרה התיקייה "${picked.name}" ✓`, 'success');
        render();
        G.Sync.run({ silent: false });
      } catch (e) { UI.toast(e.message, 'error'); }
    });

    document.getElementById('st-create-folder').addEventListener('click', () => {
      UI.openModal({
        title: 'יצירת תיקייה משותפת',
        confirmLabel: 'יצירה ושיתוף',
        bodyHTML: `
          <div class="space-y-3">
            <div><label class="tn-label">שם התיקייה</label><input id="cf-name" class="tn-input" value="TripNest — המזוודה"></div>
            <div><label class="tn-label">אימייל של בן/בת הזוג לשיתוף</label><input id="cf-email" type="email" dir="ltr" class="tn-input" placeholder="partner@gmail.com"></div>
            <p class="text-[11px] text-slate-400">התיקייה תיווצר בדרייב שלך ותשותף לעריכה. במכשיר של בן/בת הזוג בוחרים אותה עם "בחירת תיקייה".</p>
          </div>`,
        onConfirm: async () => {
          const name = document.getElementById('cf-name').value.trim() || 'TripNest';
          const email = document.getElementById('cf-email').value.trim();
          const folder = await G.drive.createFolder(name);
          if (email) await G.drive.share(folder.id, email);
          await DB.settings.set('driveFolderId', folder.id);
          await DB.settings.set('driveFolderName', name);
          UI.toast('התיקייה נוצרה ושותפה ✓', 'success');
          render();
          G.Sync.run({ silent: false });
        },
      });
    });

    document.getElementById('st-sync-now').addEventListener('click', () => G.Sync.run({ silent: false }).then(render));

    /* keywords */
    document.querySelectorAll('.kw-del').forEach(b => b.addEventListener('click', async () => {
      const kw = await G.gmail.keywords();
      kw.splice(+b.dataset.i, 1);
      await DB.settings.set('keywords', kw); await DB.touchShared(); G.Sync.queue();
      render();
    }));
    document.getElementById('st-kw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('st-kw-input').value.trim();
      if (!val) return;
      const kw = await G.gmail.keywords();
      if (!kw.includes(val)) { kw.push(val); await DB.settings.set('keywords', kw); await DB.touchShared(); G.Sync.queue(); }
      render();
    });
    document.getElementById('st-kw-reset').addEventListener('click', async () => {
      await DB.settings.set('keywords', [...G.DEFAULT_KEYWORDS]); await DB.touchShared(); G.Sync.queue();
      UI.toast('מילות המפתח אופסו', 'success'); render();
    });

    /* gemini */
    document.getElementById('st-save-gemini').addEventListener('click', async () => {
      await DB.settings.set('geminiKey', document.getElementById('st-gemini-key').value.trim());
      await DB.settings.set('agentPersona', document.getElementById('st-persona').value.trim());
      await DB.touchShared(); G.Sync.queue();
      UI.toast('הסוכן עודכן ✓', 'success');
    });

    /* members */
    const members = await DB.all('members');
    document.getElementById('st-members').innerHTML = members.length ? members.map(m => `
      <button class="st-member w-full flex items-center gap-3 bg-slate-50 rounded-xl p-2.5 text-right" data-id="${m.id}">
        ${UI.avatarHTML(m, 'w-9 h-9')}
        <span class="text-sm font-medium text-slate-700 flex-1">${UI.esc(m.nameHe)}</span>
        <span class="text-[11px] text-slate-400">${UI.esc(m.nameEn || '')}</span>
      </button>`).join('') : '<p class="text-xs text-slate-400">אין עדיין בני משפחה</p>';
    document.querySelectorAll('.st-member').forEach(b => b.addEventListener('click', () => Members.openProfile(b.dataset.id)));
    document.getElementById('st-add-member').addEventListener('click', () => Members.editModal());

    /* vault + backup */
    document.getElementById('st-vault-pin').addEventListener('click', Vault.setPin);
    document.getElementById('st-export').addEventListener('click', async () => {
      const data = await DB.exportBackup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `tripnest-backup-${UI.todayISO()}.json`;
      a.click();
      UI.toast('הגיבוי ירד ✓', 'success');
    });
    document.getElementById('st-import').addEventListener('click', () => document.getElementById('st-import-file').click());
    document.getElementById('st-import-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      UI.confirm('לשחזר מהגיבוי? נתונים חדשים יותר באפליקציה יישמרו, נתונים חסרים יתווספו.', async () => {
        await DB.importBackup(JSON.parse(await f.text()));
        UI.toast('הגיבוי שוחזר ✓', 'success');
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        render();
      });
    });
  }

  return { render };
})();
window.Settings = Settings;
