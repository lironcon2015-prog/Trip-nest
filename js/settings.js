/* TripNest — settings: Google bridge & shared folder, email keywords, Gemini & persona,
   family members, vault PIN, local backup, version. */
const Settings = (() => {

  async function render() {
    const el = document.getElementById('settings-body');
    const [bridgeUrl, bridgeToken, partnerUrl, partnerToken, folderId, folderName, geminiKey, persona, lastSync, myEmail, partnerEmail, foodProfile, foodFavorites, foodView] = await Promise.all([
      DB.settings.get('bridgeUrl'), DB.settings.get('bridgeToken'),
      DB.settings.get('partnerBridgeUrl'), DB.settings.get('partnerBridgeToken'),
      DB.settings.get('driveFolderId'), DB.settings.get('driveFolderName'),
      DB.settings.get('geminiKey'), DB.settings.get('agentPersona'), DB.settings.get('lastSync'),
      DB.settings.get('myEmail'), DB.settings.get('partnerEmail'),
      Food.profile(), Food.favoritesRaw(), Food.viewMode(),
    ]);
    const geminiModels = await Gemini.models();

    el.innerHTML = `
      <!-- Google bridge -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('cloud', 'w-[18px] h-[18px] text-indigo-500')} גשר Google (דרייב + Gmail)</h3>
        <p class="text-[11px] text-slate-400 mb-3">הגשר הוא סקריפט קטן שרץ בחשבון Google שלכם (ראו README). הדביקו כאן את כתובתו ואת הטוקן הסודי שהגדרתם בו.</p>
        <div class="space-y-3">
          ${myEmail ? `<div class="flex items-center justify-between bg-emerald-50 text-emerald-700 text-xs rounded-xl p-2.5"><span>המכשיר הזה מחובר בתור:</span><b dir="ltr">${UI.esc(myEmail)}</b></div>`
        : `<div class="bg-slate-50 text-slate-400 text-[11px] rounded-xl p-2.5">${bridgeUrl && bridgeToken ? 'מזהה את החשבון המחובר…' : 'הגדירו את הגשר כדי לזהות את החשבון המחובר'}</div>`}
          <div><label class="tn-label">כתובת הגשר (Web app URL)</label>
            <input id="st-bridge-url" class="tn-input text-xs" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${UI.esc(bridgeUrl || '')}"></div>
          <div><label class="tn-label">טוקן סודי</label>
            <input id="st-bridge-token" type="password" class="tn-input text-xs" dir="ltr" placeholder="הטוקן שהגדרתם ב-bridge.gs" value="${UI.esc(bridgeToken || '')}"></div>
          <div class="flex gap-2">
            <button id="st-save-bridge" class="tn-btn-secondary flex-1">שמירה</button>
            <button id="st-ping-bridge" class="tn-btn-secondary flex-1">${UI.icon('plug', 'w-4 h-4')} בדיקת חיבור</button>
          </div>
          <div class="bg-slate-50 rounded-xl p-3">
            <div class="text-xs font-medium text-slate-600 mb-1">הגשר של בן/בת הזוג</div>
            <p class="text-[11px] text-slate-400 mb-2">כדי שכל סריקת מייל תכסה את שתי התיבות — הדביקו כאן את כתובת הגשר והטוקן מהמכשיר של בן/בת הזוג.</p>
            <div class="space-y-2">
              <input id="st-partner-url" class="tn-input text-xs" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${UI.esc(partnerUrl || '')}">
              <input id="st-partner-token" type="password" class="tn-input text-xs" dir="ltr" placeholder="הטוקן של הגשר שלו/שלה" value="${UI.esc(partnerToken || '')}">
              <button id="st-ping-partner" class="tn-btn-secondary w-full !text-xs">${UI.icon('plug', 'w-4 h-4')} בדיקת חיבור לתיבה השנייה</button>
              ${partnerEmail ? `<div class="flex items-center justify-between text-[11px] text-slate-500 px-1"><span>התיבה של בן/בת הזוג:</span><b dir="ltr">${UI.esc(partnerEmail)}</b></div>` : ''}
            </div>
          </div>
          <div class="bg-slate-50 rounded-xl p-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 text-xs">תיקייה משותפת בדרייב:</span>
              <b class="text-slate-700 text-xs">${folderName ? UI.esc(folderName) : '— לא הוגדרה —'}</b>
            </div>
            <div class="flex gap-2 mt-2">
              <button id="st-create-folder" class="tn-btn-secondary flex-1 !text-xs">${UI.icon('plus', 'w-3.5 h-3.5')} צור ושתף (מכשיר ראשון)</button>
              <button id="st-connect-folder" class="tn-btn-secondary flex-1 !text-xs">${UI.icon('link', 'w-3.5 h-3.5')} התחבר לקיימת (מכשיר שני)</button>
            </div>
          </div>
          <button id="st-sync-now" class="tn-btn-primary w-full" ${folderId ? '' : 'disabled'}>${UI.icon('sync', 'w-4 h-4')} סנכרון עכשיו</button>
          <div class="text-[11px] text-slate-400 text-center">${lastSync ? 'סנכרון אחרון: ' + new Date(lastSync).toLocaleString('he-IL') : 'טרם בוצע סנכרון'}</div>
        </div>
      </section>

      <!-- Email scan (Navigo label) -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('mail', 'w-[18px] h-[18px] text-indigo-500')} סריקת מייל — תווית Navigo</h3>
        <p class="text-[11px] text-slate-400 leading-relaxed">הסריקה מביאה רק מיילים שסומנו ב-Gmail בתווית שמכילה את המילה <b>Navigo</b> — גם ‎@Navigo וכדומה (דורש גשר v1.4.0+) — בלי ניחושים ובלי זבל. מייל שכבר יובא לא ייובא שוב. איך מסמנים:</p>
        <ul class="text-[11px] text-slate-400 leading-relaxed list-disc pr-4 mt-1.5 space-y-1">
          <li><b>ידנית</b>: פתיחת המייל ב-Gmail ← תפריט ⋮ ← "שינוי תוויות" ← Navigo (יוצרים את התווית בפעם הראשונה).</li>
          <li><b>אוטומטית</b>: ב-Gmail — חיפוש שולח קבוע (למשל Booking או חברת תעופה) ← "יצירת פילטר" ← "החלת התווית Navigo". מאותו רגע כל מייל כזה מסומן לבד.</li>
          <li>עושים זאת בכל תיבה שנסרקת — שלך ושל בן/בת הזוג.</li>
        </ul>
        <p class="text-[11px] text-slate-400 mt-1.5">חיפוש חופשי בכל התיבה עדיין זמין דרך "חיפוש חד-פעמי" במסך הייבוא.</p>
      </section>

      <!-- Gemini -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('sparkles', 'w-[18px] h-[18px] text-indigo-500')} סוכן AI (Gemini)</h3>
        <div class="space-y-3">
          <div><label class="tn-label">Gemini API Key <span class="text-slate-300">(נשמר במכשיר בלבד)</span></label>
            <input id="st-gemini-key" type="password" class="tn-input text-xs" dir="ltr" placeholder="AIza..." value="${UI.esc(geminiKey || '')}"></div>
          <div><label class="tn-label">מפל מודלים <span class="text-slate-300">(לפי הסדר, מופרדים בפסיק)</span></label>
            <input id="st-gemini-models" class="tn-input text-xs" dir="ltr" value="${UI.esc(geminiModels.join(', '))}">
            <button id="st-test-models" class="text-[11px] text-indigo-400 font-medium mt-1">${UI.icon('flask', 'w-3.5 h-3.5')} בדיקת המודלים</button>
            <div id="st-models-result" class="text-[11px] mt-1 space-y-0.5"></div></div>
          <div><label class="tn-label">האישיות של הסוכן</label>
            <textarea id="st-persona" rows="6" class="tn-input text-xs leading-relaxed">${UI.esc(persona || Agent.DEFAULT_PERSONA)}</textarea>
            <p class="text-[11px] text-slate-400 mt-1">האישיות משותפת לשניכם — ערכו אותה יחד 💜</p></div>
          <button id="st-save-gemini" class="tn-btn-secondary w-full">שמירה</button>
        </div>
      </section>

      <!-- Food -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('food', 'w-[18px] h-[18px] text-indigo-500')} אוכל ותזונה</h3>
        <div class="space-y-3">
          <div><label class="tn-label">פרופיל התזונה המשפחתי <span class="text-slate-300">(משותף לשניכם, מוזרק לסוכן)</span></label>
            <textarea id="st-food-profile" rows="4" class="tn-input text-xs leading-relaxed" placeholder="למשל: לא אוכלים בשר ועוף לא כשרים. בעיקר צמחוני — פיצה נפוליטנית, פסטה וצ׳יפס לילדים, גם סלמון. ארוחת בוקר במלון.">${UI.esc(foodProfile)}</textarea></div>
          <div><label class="tn-label">חיפושים מהירים — "רעבים עכשיו" <span class="text-slate-300">(מופרדים בפסיק)</span></label>
            <input id="st-food-favs" class="tn-input text-xs" value="${UI.esc(foodFavorites)}"></div>
          <div><label class="tn-label">תצוגת תוכנית האוכל <span class="text-slate-300">(במכשיר הזה)</span></label>
            <select id="st-food-view" class="tn-input">
              <option value="tab" ${foodView === 'tab' ? 'selected' : ''}>טאב "אוכל" נפרד בטיול</option>
              <option value="timeline" ${foodView === 'timeline' ? 'selected' : ''}>משולב בתוך ציר הזמן</option>
            </select></div>
          <button id="st-save-food" class="tn-btn-secondary w-full">שמירה</button>
        </div>
      </section>

      <!-- Members -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('users', 'w-[18px] h-[18px] text-indigo-500')} בני המשפחה</h3>
        <div id="st-members" class="space-y-2 mb-3"></div>
        <button id="st-add-member" class="tn-btn-secondary w-full">+ בן משפחה חדש</button>
      </section>

      <!-- Vault & backup -->
      <section class="tn-card">
        <h3 class="tn-card-title">${UI.icon('lock', 'w-[18px] h-[18px] text-indigo-500')} פרטיות וגיבוי</h3>
        <div class="space-y-2">
          <button id="st-vault-pin" class="tn-menu-btn">${UI.icon('key', 'w-4 h-4')} קוד גישה לכספת הדרכונים</button>
          <button id="st-export" class="tn-menu-btn">${UI.icon('download', 'w-4 h-4')} ייצוא גיבוי מלא (JSON)</button>
          <button id="st-export-partner" class="tn-menu-btn">${UI.icon('heart', 'w-4 h-4')} קובץ חיבור לבן/בת הזוג (קטן — הנתונים יימשכו מהדרייב)</button>
          <button id="st-import" class="tn-menu-btn">${UI.icon('upload', 'w-4 h-4')} שחזור מגיבוי</button>
          <input type="file" id="st-import-file" accept="application/json" class="hidden">
          <p class="text-[11px] text-slate-400">"גיבוי מלא" כולל את כל הנתונים ומשחזר את <b>המכשיר הזה</b>. "קובץ חיבור" הוא קובץ קטן לבן/בת הזוג: רק החיבורים והמפתחות, בתפקיד הנכון (הגשר שלו/שלה כראשי) — מרימים אותו במכשיר שלו/שלה דרך "שחזור מגיבוי", וכל הנתונים והמסמכים נמשכים אוטומטית מתיקיית הדרייב המשותפת. צילומי הדרכון לא נכללים באף גיבוי — הם לא עוזבים את המכשיר.</p>
        </div>
      </section>

      <div class="text-center pb-4">
        <div class="text-[11px] text-slate-300">Navigo v<span id="st-version">${window._BUNDLE_VERSION || ''}</span></div>
        <button id="st-check-update" class="text-[11px] text-indigo-400 font-medium mt-1.5">${UI.icon('sync', 'w-3.5 h-3.5')} בדיקת עדכון גרסה</button>
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

    // auto-identify the connected accounts in the background (no tap needed);
    // stored once, then shown on every render
    const autoDetect = async (settingKey, account) => {
      const em = await G.accountEmail({ account }).catch(() => null);
      if (em) { await DB.settings.set(settingKey, em); render(); }
      return em;
    };
    if (!myEmail && bridgeUrl && bridgeToken) autoDetect('myEmail', 'me');
    if (!partnerEmail && partnerUrl && partnerToken) autoDetect('partnerEmail', 'partner');

    // very last resort (e.g. a mailbox with no sent mail): ask once and store
    const askEmail = (settingKey, title) => UI.openModal({
      title,
      confirmLabel: 'שמירה',
      bodyHTML: `
        <p class="text-xs text-slate-500 mb-3">החיבור תקין, אבל הגשר בגרסה הזו לא מדווח את כתובת החשבון. הזינו אותה פעם אחת — היא תוצג בהגדרות לזיהוי המכשיר. (פריסה מחדש של גשר עדכני תזהה אותה אוטומטית.)</p>
        <input id="ae-email" type="email" dir="ltr" class="tn-input" placeholder="you@gmail.com">`,
      onConfirm: async () => {
        const v = document.getElementById('ae-email').value.trim();
        if (!v) throw new Error('חסרה כתובת');
        await DB.settings.set(settingKey, v);
        UI.toast('נשמר ✓', 'success');
        render();
      },
    });

    document.getElementById('st-ping-bridge').addEventListener('click', (e) => UI.busy(e.currentTarget, async () => {
      try {
        await saveBridgeInputs();
        const out = await G.ping();
        UI.toast(`מחובר ✓ ${out.email || ''} (גשר v${out.version || '?'})`, 'success');
        if (out.email) { await DB.settings.set('myEmail', out.email); render(); }
        else if (!(await DB.settings.get('myEmail')) && !(await autoDetect('myEmail', 'me')))
          askEmail('myEmail', 'איזה חשבון Google מחובר כאן?');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));

    document.getElementById('st-ping-partner').addEventListener('click', (e) => UI.busy(e.currentTarget, async () => {
      try {
        await saveBridgeInputs();
        const out = await G.ping({ account: 'partner' });
        UI.toast(`התיבה השנייה מחוברת ✓ ${out.email || ''}`, 'success');
        if (out.email) { await DB.settings.set('partnerEmail', out.email); render(); }
        else if (!(await DB.settings.get('partnerEmail')) && !(await autoDetect('partnerEmail', 'partner')))
          askEmail('partnerEmail', 'איזה חשבון מחובר בתיבה השנייה?');
      } catch (err) { UI.toast(err.message, 'error'); }
    }));

    document.getElementById('st-create-folder').addEventListener('click', () => {
      UI.openModal({
        title: 'יצירת תיקייה משותפת (מכשיר ראשון)',
        confirmLabel: 'יצירה ושיתוף',
        bodyHTML: `
          <div class="space-y-3">
            <div><label class="tn-label">שם התיקייה</label><input id="cf-name" class="tn-input" value="TripNest — Navigo"></div>
            <div><label class="tn-label">אימייל של בן/בת הזוג לשיתוף</label><input id="cf-email" type="email" dir="ltr" class="tn-input" placeholder="partner@gmail.com"></div>
            <p class="text-[11px] text-slate-400">התיקייה תיווצר בדרייב שלך ותשותף לעריכה. במכשיר השני לוחצים "התחבר לקיימת".</p>
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
            <div><label class="tn-label">שם התיקייה (כפי שנוצרה במכשיר הראשון)</label><input id="cn-name" class="tn-input" value="TripNest — Navigo"></div>
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

    /* gemini */
    document.getElementById('st-save-gemini').addEventListener('click', async () => {
      await DB.settings.set('geminiKey', document.getElementById('st-gemini-key').value.trim());
      const models = document.getElementById('st-gemini-models').value.split(',').map(s => s.trim()).filter(Boolean);
      await Gemini.setModels(models.length ? models : Gemini.DEFAULT_MODELS.slice());
      await DB.settings.set('agentPersona', document.getElementById('st-persona').value.trim());
      await DB.touchShared(); G.Sync.queue();
      UI.toast('הסוכן עודכן ✓', 'success');
    });

    /* food */
    document.getElementById('st-save-food').addEventListener('click', async () => {
      await DB.settings.set('foodProfile', document.getElementById('st-food-profile').value.trim());
      await DB.settings.set('foodFavorites', document.getElementById('st-food-favs').value.trim());
      await DB.settings.set('foodView', document.getElementById('st-food-view').value);
      await DB.touchShared(); G.Sync.queue();
      UI.toast('הגדרות האוכל נשמרו ✓', 'success');
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
    const download = (data, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = name;
      a.click();
    };
    document.getElementById('st-export').addEventListener('click', async () => {
      download(await DB.exportBackup(), `navigo-backup-${UI.todayISO()}.json`);
      UI.toast('הגיבוי ירד ✓', 'success');
    });

    // a small connections-only profile for the partner's device: bridges with roles
    // swapped (their bridge becomes "mine", ours becomes "partner"), shared folder and
    // Gemini key. No data payload — everything syncs down from the shared Drive folder,
    // so the file stays WhatsApp-sized. This device's local secrets (vault PIN) stay out.
    document.getElementById('st-export-partner').addEventListener('click', async (e) => UI.busy(e.currentTarget, async () => {
      const [bu, bt, pu, pt, fid, fname, gk, gm] = await Promise.all([
        DB.settings.get('bridgeUrl'), DB.settings.get('bridgeToken'),
        DB.settings.get('partnerBridgeUrl'), DB.settings.get('partnerBridgeToken'),
        DB.settings.get('driveFolderId'), DB.settings.get('driveFolderName'),
        DB.settings.get('geminiKey'), DB.settings.get('geminiModels'),
      ]);
      if (!pu || !pt) { UI.toast('קודם הגדירו את הגשר של בן/בת הזוג — הוא יהיה הגשר הראשי אצלו/אצלה', 'warning'); return; }
      let email = await DB.settings.get('myEmail');
      if (!email) { email = await G.accountEmail().catch(() => null); if (email) await DB.settings.set('myEmail', email); }
      // access is part of the file's promise: make sure the partner's Google
      // account can already open the shared Drive folder
      let access = null;
      if (fid) {
        let pEmail = await DB.settings.get('partnerEmail');
        if (!pEmail) { pEmail = await G.accountEmail({ account: 'partner' }).catch(() => null); if (pEmail) await DB.settings.set('partnerEmail', pEmail); }
        access = await G.setup.ensurePartnerAccess({ folderId: fid, partnerEmail: pEmail });
      }
      // push the latest local data to Drive first, so the partner's first sync sees everything
      await G.Sync.run({ silent: true }).catch(() => {});
      const profile = {
        app: 'TripNest', version: 2, type: 'partner-profile', exported: new Date().toISOString(),
        settingsLocal: {
          bridgeUrl: pu, bridgeToken: pt,
          partnerBridgeUrl: bu, partnerBridgeToken: bt, partnerEmail: email,
          driveFolderId: fid, driveFolderName: fname,
          geminiKey: gk, geminiModels: gm,
        },
      };
      download(profile, `navigo-partner-setup-${UI.todayISO()}.json`);
      if (access === 'manual')
        UI.toast('הקובץ ירד, אבל לא הצלחתי לוודא גישה לתיקייה בדרייב — שתפו אותה עם החשבון של בן/בת הזוג (או פרסו גשר מעודכן ונסו שוב)', 'warning');
      else
        UI.toast(`קובץ החיבור ירד ✓${access === 'granted' ? ' הגישה לתיקייה בדרייב הוענקה עכשיו.' : ''} במכשיר שלו/שלה: הגדרות ← שחזור מגיבוי — והכול יימשך מהדרייב`, 'success');
    }));

    document.getElementById('st-import').addEventListener('click', () => document.getElementById('st-import-file').click());
    document.getElementById('st-import-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      UI.confirm('לשחזר מהקובץ? נתונים חדשים יותר באפליקציה יישמרו, נתונים חסרים יתווספו.', async () => {
        await DB.importBackup(JSON.parse(await f.text()));
        UI.toast('שוחזר ✓', 'success');
        document.dispatchEvent(new CustomEvent('tn-data-changed'));
        render();
        // a connection profile / full backup restores the bridge+folder — pull the shared data now
        if (await DB.settings.get('driveFolderId')) G.Sync.run({ silent: true });
      });
    });
  }

  return { render };
})();
window.Settings = Settings;
