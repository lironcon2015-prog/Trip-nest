/* TripNest — Gemini API client (key is stored locally in settings, never synced). */
const Gemini = (() => {
  const MODEL = 'gemini-2.5-flash';

  async function key() {
    const k = await DB.settings.get('geminiKey');
    if (!k) throw new Error('חסר מפתח Gemini — הוסיפו אותו בהגדרות');
    return k;
  }
  const hasKey = async () => !!(await DB.settings.get('geminiKey'));

  async function call(payload) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${await key()}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini error ${res.status}`);
    }
    return res.json();
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

  return { call, chat, json, textOf, hasKey, extractFromText, extractFromImage, MODEL };
})();
window.Gemini = Gemini;
