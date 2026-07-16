/* TripNest — local passport MRZ reader. OCR runs entirely on-device
   (Tesseract.js/WASM, assets cached by the SW) — the passport photo is
   never sent to Gemini or any server. Parses ICAO 9303 TD3 (2×44 lines)
   and validates all check digits, so a bad read fails instead of lying. */
const MRZ = (() => {
  const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

  /* --- check digits (weights 7,3,1; A=10..Z=35, '<'=0) --- */
  const charVal = (c) => c === '<' ? 0 : (c >= '0' && c <= '9' ? +c : c.charCodeAt(0) - 55);
  function checkDigit(s) {
    const w = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += charVal(s[i]) * w[i % 3];
    return String(sum % 10);
  }
  const checks = (s, d) => checkDigit(s) === (d === '<' ? '0' : d);

  // OCR misreads in strictly numeric positions
  const fixNum = (s) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/S/g, '5');

  function yyToDate(yymmdd, { birth = false } = {}) {
    const s = fixNum(yymmdd);
    if (!/^\d{6}$/.test(s)) return null;
    const yy = +s.slice(0, 2);
    const century = birth ? (yy > (new Date().getFullYear() % 100) ? 1900 : 2000) : 2000;
    return `${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }

  const cleanName = (s) => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();

  /* --- TD3 parse: [line1, line2] each 44 chars → fields or null --- */
  function parse(lines) {
    if (!lines || lines.length < 2) return null;
    const l1 = lines[0].toUpperCase().padEnd(44, '<').slice(0, 44);
    const l2 = lines[1].toUpperCase().padEnd(44, '<').slice(0, 44);
    if (l1[0] !== 'P') return null;

    const number = l2.slice(0, 9);
    const numberCk = fixNum(l2[9]);
    const birth = fixNum(l2.slice(13, 19));
    const birthCk = fixNum(l2[19]);
    const expiry = fixNum(l2.slice(21, 27));
    const expiryCk = fixNum(l2[27]);
    const personal = l2.slice(28, 42);
    const personalCk = l2[42];

    // mandatory check digits — reject a bad read rather than guess
    if (!checks(number, numberCk) || !checks(birth, birthCk) || !checks(expiry, expiryCk)) return null;
    const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
    if (!checks(composite, fixNum(l2[43]))) return null;
    if (personal.replace(/</g, '') && !checks(personal, personalCk)) return null;

    const [surname, given] = l1.slice(5).split('<<');
    return {
      nameEn: cleanName(`${cleanName(given || '')} ${cleanName(surname || '')}`),
      surname: cleanName(surname || ''),
      givenNames: cleanName(given || ''),
      passportNumber: number.replace(/</g, ''),
      nationality: l2.slice(10, 13).replace(/</g, ''),
      issuingCountry: l1.slice(2, 5).replace(/</g, ''),
      birthDate: yyToDate(birth, { birth: true }),
      sex: l2[20] === '<' ? '' : l2[20],
      expiryDate: yyToDate(expiry),
    };
  }

  /* --- find an MRZ pair inside raw OCR text --- */
  function fromText(text) {
    const lines = (text || '').toUpperCase().split('\n')
      .map(l => l.replace(/\s/g, '').replace(/[«]/g, '<'))
      .filter(l => l.length >= 30 && /^[A-Z0-9<]+$/.test(l));
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith('P')) continue;
      const parsed = parse([lines[i], lines[i + 1]]);
      if (parsed) return parsed;
    }
    return null;
  }

  /* --- OCR (lazy-loaded Tesseract.js, module-level worker reuse) --- */
  let _workerP = null;
  function worker() {
    if (_workerP) return _workerP;
    _workerP = (async () => {
      if (!window.Tesseract) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          s.onload = res; s.onerror = () => rej(new Error('טעינת רכיב ה-OCR נכשלה'));
          document.head.appendChild(s);
        });
      }
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: CHARSET });
      return w;
    })();
    _workerP.catch(() => { _workerP = null; }); // allow retry after a failed load
    return _workerP;
  }

  async function toCanvas(blob, { bottomFrac = 1 } = {}) {
    const bmp = await createImageBitmap(blob);
    const sy = Math.round(bmp.height * (1 - bottomFrac));
    const sh = bmp.height - sy;
    const scale = Math.min(2, 1600 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.3)';
    ctx.drawImage(bmp, 0, sy, bmp.width, sh, 0, 0, c.width, c.height);
    bmp.close();
    return c;
  }

  // thorough=true (filename hints a passport) also tries the full frame
  async function fromImage(blob, { thorough = false } = {}) {
    const w = await worker();
    const attempts = thorough ? [0.45, 1] : [0.45];
    for (const bottomFrac of attempts) {
      try {
        const { data } = await w.recognize(await toCanvas(blob, { bottomFrac }));
        const parsed = fromText(data.text);
        if (parsed) return parsed;
      } catch { }
    }
    return null;
  }

  return { parse, fromText, fromImage, checkDigit };
})();
window.MRZ = MRZ;
