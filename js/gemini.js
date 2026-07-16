/* TripNest — Gemini API client (key is stored locally in settings, never synced).
   Transport = model cascade: try each model in order, falling back to the next
   only on overload/unavailability (429/503/RESOURCE_EXHAUSTED/UNAVAILABLE);
   any other error (bad key, bad model name, safety block) throws immediately —
   a config error will fail on the next model too, so falling back only hides it. */
const Gemini = (() => {
  const API = 'https://generativelanguage.googleapis.com/v1beta/models';
  const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

  async function key() {
    const k = await DB.settings.get('geminiKey');
    if (!k) throw new Error('חסר מפתח Gemini — הוסיפו אותו בהגדרות');
    return k;
  }
  const hasKey = async () => !!(await DB.settings.get('geminiKey'));

  async function models() {
    const stored = await DB.settings.get('geminiModels');
    if (Array.isArray(stored) && stored.length) {
      const cleaned = stored.map(s => String(s || '').trim()).filter(Boolean);
      if (cleaned.length) return cleaned;
    }
    return DEFAULT_MODELS.slice();
  }
  const setModels = (list) => DB.settings.set('geminiModels', list);

  // API key travels in a header, not the query string — URLs get logged
  // by proxies/CDNs; headers don't.
  const post = async (model, apiKey, payload) => fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });

  async function call(payload) {
    const apiKey = await key();
    for (const model of await models()) {
      const res = await post(model, apiKey, payload);
      // Non-JSON error bodies (proxy/HTML 5xx) must not abort the cascade.
      let data = null;
      try { data = await res.json(); } catch { }
      if (res.ok && data) return data;
      const msg = data?.error?.message || `שגיאת API (HTTP ${res.status})`;
      const status = data?.error?.status || '';
      const shouldFallback = res.status === 429 || res.status === 503
        || status === 'RESOURCE_EXHAUSTED' || status === 'UNAVAILABLE';
      if (!shouldFallback) throw new Error(msg);
    }
    throw new Error('כל המודלים עמוסים כרגע – נסו שוב בעוד דקה');
  }

  // diagnostics: run a test prompt against every model → [{model, ok, ms, reply|error}]
  async function testModels(promptText = 'ענה במילה אחת: שלום') {
    const apiKey = await key();
    const results = [];
    for (const model of await models()) {
      const startedAt = performance.now();
      try {
        const res = await post(model, apiKey, { contents: [{ parts: [{ text: promptText }] }] });
        let data = null;
        try { data = await res.json(); } catch { }
        const ms = Math.round(performance.now() - startedAt);
        if (res.ok && data) {
          results.push({ model, ok: true, ms, reply: data.candidates?.[0]?.content?.parts?.[0]?.text || '' });
        } else {
          results.push({ model, ok: false, ms, error: data?.error?.message || `HTTP ${res.status}` });
        }
      } catch (e) {
        results.push({ model, ok: false, ms: Math.round(performance.now() - startedAt), error: e.message || 'Network error' });
      }
    }
    return results;
  }

  const textOf = (data) =>
    (data.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('');

  async function json(prompt, { inlineData = null } = {}) {
    const parts = [{ text: prompt }];
    if (inlineData) parts.push({ inlineData });
    const data = await call({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    const t = textOf(data);
    try { return JSON.parse(t); } catch { return null; }
  }

  // one full chat turn; history = [{role:'user'|'model', parts:[...]}]
  function chat(history, { system, tools } = {}) {
    const payload = { contents: history, generationConfig: { temperature: 0.6 } };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) payload.tools = [{ functionDeclarations: tools }];
    return call(payload);
  }

  const EXTRACT_PROMPT = `אתה מחלץ נתונים ממסמכי נסיעות (כרטיסי טיסה, הזמנות מלון, ביטוח, שוברים).
נתח את המסמך והחזר JSON בלבד במבנה הבא (השמט שדות שאין להם מידע, תאריכים בפורמט YYYY-MM-DD, שעות HH:MM):
{
 "category": "flight|stay|car|insurance|visa|attraction|other",
 "title": "כותרת קצרה בעברית למסמך",
 "provider": "חברה/ספק",
 "confirmation": "קוד הזמנה/PNR",
 "flights": [{"flightNo":"", "airline":"", "from":"", "to":"", "depDate":"", "depTime":"", "arrDate":"", "arrTime":""}],
 "checkIn": "", "checkOut": "", "address": "",
 "dates": [{"date":"", "time":"", "label":"תיאור קצר בעברית"}],
 "notes": ""
}`;

  async function extractFromText(text, fileName = '') {
    return json(`${EXTRACT_PROMPT}\n\nשם הקובץ: ${fileName}\n\nתוכן המסמך:\n${text.slice(0, 14000)}`);
  }

  async function extractFromImage(blob, fileName = '') {
    const dataUrl = await DB.blobToDataURL(blob);
    const base64 = dataUrl.split(',')[1];
    return json(`${EXTRACT_PROMPT}\n\nשם הקובץ: ${fileName}\nחלץ מהתמונה המצורפת.`,
      { inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } });
  }

  return { call, chat, json, textOf, hasKey, extractFromText, extractFromImage, models, setModels, testModels, DEFAULT_MODELS };
})();
window.Gemini = Gemini;
