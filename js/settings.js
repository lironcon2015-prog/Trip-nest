/* TripNest — settings: Google bridge & shared folder, email keywords, Gemini & persona,
   family members, vault PIN, local backup, version. */
const Settings = (() => {

  async function render() {
    const el = document.getElementById('settings-body');
    const [bridgeUrl, bridgeToken, partnerUrl, partnerToken, folderId, folderName, geminiKey, persona, lastSync] = await Promise.all([
      DB.settings.get('bridgeUrl'), DB.settings.get('bridgeToken'),
      DB.settings.get('partnerBridgeUrl'), DB.settings.get('partnerBridgeToken'),
      DB.settings.get('driveFolderId'), DB.settings.get('driveFolderName'),
      DB.settings.get('geminiKey'), DB.settings.get('agentPersona'), DB.settings.get('lastSync'),
    ]);
    const keywords = await G.gmail.keywords();
    const negKeywords = await G.gmail.negKeywords();
    const geminiModels = await Gemini.models();

    el.innerHTML = `
      <!-- Google bridge -->
      <section class="tn-card">
        <h3 class="tn-card-title">☁️ גשר Google (דרייב + Gmail)</h3>
        <p class="text-[11px] text-slate-400 mb-3">הגשר הוא סקריפט קטן שרץ בחשבון Google שלכם (ראו README). הדביקו כאן את כתובתו ואת הטוקן הסודי שהגדרתם בו.</p>
        <div class="space-y-3">
          <div><label class="tn-label">כתובת הגשר (Web app URL)</label>
            <input id="st-bridge-url" class="tn-input text-xs" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${UI.esc(bridgeUrl || '')}"></div>
          <div><label class="tn-label">טוקן סודי</label>
            <input id="st-bridge-token" type="password" class="tn-input text-xs" dir="ltr" placeholder="הטוקן שהגדרתם ב-bridge.gs" value="${UI.esc(bridgeToken || '')}"></div>
          <div class="flex gap-2">
            <button id="st-save-bridge" class="tn-btn-secondary flex-1">שמירה</button>
            <button id="st-ping-bridge" class="tn-btn-secondary flex-1">🔌 בדיקת חיבור</button>
          </div>
          <div class="bg-slate-50 rounded-xl p-3">
            <div class="text-xs font-medium text-slate-600 mb-1">💞 הגשר של בן/בת הזוג</div>
            <p class="text-[11px] text-slate-400 mb-2">כדי שכל סריקת מייל תכסה את שתי התיבות — הדביקו כאן את כתובת הגשר והטוקן מהמכשיר של בן/בת הזוג.</p>
            <div class="space-y-2">
              <input id="st-partner-url" class="tn-input text-xs" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${UI.esc(partnerUrl || '')}">
              <input id="st-partner-token" type="password" class="tn-input text-xs" dir="ltr" placeholder="הטוקן של הגשר שלו/שלה" value="${UI.esc(partnerToken || '')}">
              <button id="st-ping-partner" class="tn-btn-secondary w-full !text-xs">🔌 בדיקת חיבור לתיבה השנייה</button>
            </div>
          </div>
          <div class="bg-slate-50 rounded-xl p-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 text-xs">תיקייה משותפת בדרייב:</span>
              <b class="text-slate-700 text-xs">${folderName ? UI.esc(folderName) : '— לא הוגדרה —'}</b>
            </div>
            <div class="flex gap-2 mt-2">
              <button id="st-create-folder" class="tn-btn-secondary flex-1 !text-xs">➕ צור ושתף (מכשיר ראשון)</button>
              <button id="st-connect-folder" class="tn-btn-secondary flex-1 !text-xs">🔗 התחבר לקיימת (מכשיר שני)</button>
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
        <div class="mt-4 pt-4 border-t border-slate-100">
          <div class="text-xs font-semibold text-slate-600 mb-1">🚫 סינון החוצה</div>
          <p class="text-[11px] text-slate-400 mb-2">מיילים שמכילים מילים אלה יוסתרו מהתוצאות — למשל שמות חנויות שמציפות אתכם ("זארה", "קולנוע").</p>
          <div class="flex flex-wrap gap-1.5 mb-2">${negKeywords.map((k, i) => `
            <span class="inline-flex items-center gap-1 bg-red-50 text-red-500 text-xs px-2.5 py-1 rounded-full">
              ${UI.esc(k)}<button class="nkw-del text-red-300" data-i="${i}">✕</button></span>`).join('') || '<span class="text-[11px] text-slate-300">אין מילות סינון</span>'}</div>
          <form id="st-nkw-form" class="flex gap-2">
            <input id="st-nkw-input" class="tn-input !py-2 text-sm flex-1" placeholder="מילה לסינון…">
            <button class="tn-btn-secondary">הוספה</button>
          </form>
        </div>
      </section>

      <!-- Gemini -->
      <section class="tn-card">
        <h3 class="tn-card-title">🤖 סוכן AI (Gemini)</h3>
        <div class="space-y-3">
          <div><label class="tn-label">Gemini API Key <span class="text-slate-300">(נשמר במכשיר בלבד)</span></label>
            <input id="st-gemini-key" type="password" class="tn-input text-xs" dir="ltr" placeholder="AIza..." value="${UI.esc(geminiKey || '')}"></div>
          <div><label class="tn-label">מפל מודלים <span class="text-slate-300">(לפי הסדר, מופרדים בפסיק)</span></label>
            <input id="st-gemini-models" class="tn-input text-xs" dir="ltr" value="${UI.esc(geminiModels.join(', '))}">
            <button id="st-test-models" class="text-[11px] text-indigo-400 font-medium mt-1">🧪 בדיקת המודלים</button>
            <div id="st-models-result" class="text-[11px] mt-1 space-y-0.5"></div></div>
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

      <div class="text-center pb-4">
        <div class="text-[11px] text-slate-300">צ׳קין · TripNest v<span id="st-version">${window._BUNDLE_VERSION || ''}</span></div>
        <button id="st-check-update" class="text-[11px] text-indigo-400 font-medium mt-1.5">🔄 בדיקת עדכון גרסה</button>
      </div>`;

    /* wiring */
    const saveBridgeInputs = async () => {
      await DB.settings.set('bridgeUrl', document.getElementById('st-bridge-url').value.trim());
      await DB.settings.set('bridgeToken', document.getElementById('st-bridge-token').value.trim());
      await DB.settings.set('partnerBridgeUrl', document.getElementById('st-partner-url').value.trim());
      await DB.settings.set('partnerBridgeToken', document.getElementById('st-partner-token').value.trim());
    };

    document.getElementById('st-save-bridge').addEventListener('click', async () => {
      await saveBridgeInputs();
      UI.toast('נשמר ✓ עכשיו אפשר לבדוק חיבור', 'success');
    });

    document.getElementById('st-ping-bridge').addEventListener('click', (e) => UI.busy(e.currentTarget, async () => {
      try {
        await saveBridgeInputs();
        const out = await G.ping();
        UI.toast(`מחובר ✓ ${out.email || ''} (גשר v${out.version || '?'})`, 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));

    document.getElementById('st-ping-partner').addEventListener('click', (e) => UI.busy(e.currentTarget, async () => {
      try {
        await saveBridgeInputs();
        const out = await G.ping({ account: 'partner' });
        UI.toast(`התיבה השנייה מחוברת ✓ ${out.email || ''}`, 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));

    document.getElementById('st-create-folder').addEventListener('click', () => {
      UI.openModal({
        title: 'יצירת תיקייה משותפת (מכשיר ראשון)',
        confirmLabel: 'יצירה ושיתוף',
        bodyHTML: `
          <div class="space-y-3">
            <div><label class="tn-label">שם התיקייה</label><input id="cf-name" class="tn-input" value="TripNest — צ׳קין"></div>
            <div><label class="tn-label">אימייל של בן/בת הזוג לשיתוף</label><input id="cf-email" type="email" dir="ltr" class="tn-input" placeholder="partner@gmail.com"></div>
            <p class="text-[11px] text-slate-400">התיקייה תיווצר בדרייב שלך ותשותף לעריכה. במכשיר השני לוחצים "🔗 התחבר לקיימת".</p>
          </div>`,
        onConfirm: async () => {
          const name = document.getElementById('cf-name').value.trim() || 'TripNest';
          const email = document.getElementById('cf-email').value.trim();
          const out = await G.setup.create({ name, partnerEmail: email || null });
          UI.toast(`התיקייה "${out.folderName}" נוצרה ושותפה ✓`, 'success');
          render();
          G.Sync.run({ silent: false });
        },
      });
    });

    document.getElementById('st-connect-folder').addEventListener('click', () => {
      UI.openModal({
        title: 'התחברות לתיקייה קיימת (מכשיר שני)',
        confirmLabel: 'חיפוש והתחברות',
        bodyHTML: `
          <div class="space-y-3">
            <div><label class="tn-label">שם התיקייה (כפי שנוצרה במכשיר הראשון)</label><input id="cn-name" class="tn-input" value="TripNest — צ׳קין"></div>
            <p class="text-[11px] text-slate-400">הגשר יאתר את התיקייה ששותפה אליך בדרייב ויתחבר אליה.</p>
          </div>`,
        onConfirm: async () => {
          const name = document.getElementById('cn-name').value.trim() || null;
          const out = await G.setup.connect({ name });
          UI.toast(`מחובר לתיקייה "${out.folderName}" ✓`, 'success');
          render();
          G.Sync.run({ silent: false });
        },
      });
    });

    document.getElementById('st-sync-now').addEventListener('click', (e) =>
      UI.busy(e.currentTarget, () => G.Sync.run({ silent: false })).then(render));

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
    document.querySelectorAll('.nkw-del').forEach(b => b.addEventListener('click', async () => {
      const kw = await G.gmail.negKeywords();
      kw.splice(+b.dataset.i, 1);
      await DB.settings.set('negKeywords', kw); await DB.touchShared(); G.Sync.queue();
      render();
    }));
    document.getElementById('st-nkw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('st-nkw-input').value.trim();
      if (!val) return;
      const kw = await G.gmail.negKeywords();
      if (!kw.includes(val)) { kw.push(val); await DB.settings.set('negKeywords', kw); await DB.touchShared(); G.Sync.queue(); }
      render();
    });

    /* gemini */
    document.getElementById('st-save-gemini').addEventListener('click', async () => {
      await DB.settings.set('geminiKey', document.getElementById('st-gemini-key').value.trim());
      const models = document.getElementById('st-gemini-models').value.split(',').map(s => s.trim()).filter(Boolean);
      await Gemini.setModels(models.length ? models : Gemini.DEFAULT_MODELS.slice());
      await DB.settings.set('agentPersona', document.getElementById('st-persona').value.trim());
      await DB.touchShared(); G.Sync.queue();
      UI.toast('הסוכן עודכן ✓', 'success');
    });

    document.getElementById('st-test-models').addEventListener('click', async (e) => {
      const out = document.getElementById('st-models-result');
      e.target.disabled = true;
      out.innerHTML = '<span class="text-slate-400">בודק…</span>';
      try {
        await DB.settings.set('geminiKey', document.getElementById('st-gemini-key').value.trim());
        const models = document.getElementById('st-gemini-models').value.split(',').map(s => s.trim()).filter(Boolean);
        if (models.length) await Gemini.setModels(models);
        const results = await Gemini.testModels();
        out.innerHTML = results.map(r => r.ok
          ? `<div class="text-emerald-600">✓ ${UI.esc(r.model)} · ${r.ms}ms</div>`
          : `<div class="text-red-500">✗ ${UI.esc(r.model)} · ${UI.esc(r.error)}</div>`).join('');
      } catch (err) { out.innerHTML = `<div class="text-red-500">${UI.esc(err.message)}</div>`; }
      e.target.disabled = false;
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

    /* updates */
    document.getElementById('st-check-update').addEventListener('click', (e) => {
      e.target.textContent = '🔄 בודק…';
      App.checkForUpdate().finally(() => { e.target.textContent = '🔄 בדיקת עדכון גרסה'; });
    });

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
