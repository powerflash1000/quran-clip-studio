// 📐 مكان الكلام: بيدوّر في الخلفية على أهدى مساحة كبيرة (حيطة/سما/مساحة فاضية) ويحط الكلام فيها
// التحليل على نسخة صغيرة من الصورة (≈ 27 × 48 مربع): لكل مربع «زحمة» = تغيّر الإضاءة واللون مع الجيران،
// وبعدين أكبر مستطيل مربعاته هادية. نتيجته بتتحفظ لكل صورة/فيديو ومقاس، فمش بتتحسب كل إطار
export const ZONES = {
  '': 'النص (العادي)',
  auto: '🪄 تلقائي — أهدى مساحة في الخلفية',
  top: 'فوق', bottom: 'تحت', right: 'يمين', left: 'شمال',
};
export const INKS = { '': 'ألواني أنا', auto: '🪄 تلقائي حسب الخلفية' };

// المساحات الثابتة (كنِسَب من العرض والطول)
const FIXED = {
  top: { x0: 0.07, y0: 0.07, x1: 0.93, y1: 0.45 },
  bottom: { x0: 0.07, y0: 0.47, x1: 0.93, y1: 0.84 },
  right: { x0: 0.5, y0: 0.1, x1: 0.95, y1: 0.82 },
  left: { x0: 0.05, y0: 0.1, x1: 0.5, y1: 0.82 },
};

const cache = new WeakMap();
// el = الصورة/الفيديو، بيرجّع { x0, y0, x1, y1, lum } أو null
export function analyzeZone(el, W, H) {
  if (!el || typeof document === 'undefined') return null;
  const iw = el.naturalWidth || el.videoWidth || el.width, ih = el.naturalHeight || el.videoHeight || el.height;
  if (!iw || !ih) return null;
  const key = `${W}x${H}`;
  let m = cache.get(el);
  if (m?.has(key)) return m.get(key);
  const gw = 27, gh = Math.max(12, Math.round(gw * H / W));
  const c = document.createElement('canvas'); c.width = gw * 4; c.height = gh * 4;
  const g = c.getContext('2d', { willReadFrequently: true });
  const k = Math.max(c.width / iw, c.height / ih);
  g.drawImage(el, (c.width - iw * k) / 2, (c.height - ih * k) / 2, iw * k, ih * k);
  let px;
  try { px = g.getImageData(0, 0, c.width, c.height).data; } catch { return null; } // صورة من موقع تاني من غير إذن
  const PW = c.width, PH = c.height;
  const lumAt = (x, y) => { const i = (y * PW + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
  const colAt = (x, y) => { const i = (y * PW + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  // زحمة كل بكسل صغير = فرق اللون مع اللي جنبه واللي تحته
  const busyPx = new Float32Array(PW * PH), lumPx = new Float32Array(PW * PH);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const a = colAt(x, y), r = colAt(Math.min(PW - 1, x + 1), y), d = colAt(x, Math.min(PH - 1, y + 1));
    busyPx[y * PW + x] = (Math.abs(a[0] - r[0]) + Math.abs(a[1] - r[1]) + Math.abs(a[2] - r[2]) + Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) + Math.abs(a[2] - d[2])) / 6;
    lumPx[y * PW + x] = lumAt(x, y);
  }
  // لكل مربع: أعلى زحمة جواه (عشان فرع رفيع ما يضيعش في المتوسط) + متوسط الإضاءة
  const busy = new Float32Array(gw * gh), lum = new Float32Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    let mx = 0, sum = 0, ls = 0;
    for (let y = cy * 4; y < cy * 4 + 4; y++) for (let x = cx * 4; x < cx * 4 + 4; x++) { const b = busyPx[y * PW + x]; mx = Math.max(mx, b); sum += b; ls += lumPx[y * PW + x]; }
    busy[cy * gw + cx] = mx * 0.6 + (sum / 16) * 0.4;
    lum[cy * gw + cx] = ls / 16;
  }
  // هامش حوالين أي حاجة مزحومة (مربع واحد) عشان الكلام ما يلزقش في الوردة
  const dil = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) v = Math.max(v, busy[yy * gw + xx]);
    }
    dil[y * gw + x] = v;
  }
  // «هادي» = أقل من حد بيتظبط حسب الصورة نفسها (الصور اللي فيها حبيبات/ملمس الحد بيعلى)
  const sorted = Array.from(dil).sort((a, b) => a - b);
  const T = Math.max(9, Math.min(28, sorted[Math.floor(sorted.length * 0.3)] * 1.8));
  // مجموع تراكمي للزحمة عشان نحسب أي مستطيل بسرعة
  const I = new Float32Array((gw + 1) * (gh + 1)), L = new Float32Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const bad = dil[y * gw + x] > T ? 1 : 0;
    const j = (y + 1) * (gw + 1) + x + 1;
    I[j] = bad + I[j - 1] + I[j - gw - 1] - I[j - gw - 2];
    L[j] = lum[y * gw + x] + L[j - 1] + L[j - gw - 1] - L[j - gw - 2];
  }
  const rs = (A, x0, y0, x1, y1) => A[y1 * (gw + 1) + x1] - A[y0 * (gw + 1) + x1] - A[y1 * (gw + 1) + x0] + A[y0 * (gw + 1) + x0];
  // المنطقة المسموحة: بعيد عن أزرار التطبيقات تحت وعن أعلى الشاشة
  const portrait = H > W;
  const yMin = Math.round(gh * (portrait ? 0.06 : 0.05)), yMax = Math.round(gh * (portrait ? 0.84 : 0.92));
  const minW = Math.ceil(gw * 0.34), minH = Math.ceil(gh * (portrait ? 0.14 : 0.22));
  let best = null;
  for (let y0 = yMin; y0 < yMax - minH; y0++) for (let y1 = y0 + minH; y1 <= yMax; y1++) {
    for (let x0 = 0; x0 <= gw - minW; x0++) for (let x1 = x0 + minW; x1 <= gw; x1++) {
      const n = (x1 - x0) * (y1 - y0);
      if (rs(I, x0, y0, x1, y1) > n * 0.03) continue;
      const wf = (x1 - x0) / gw, hf = (y1 - y0) / gh;
      // أكبر مساحة، مع تفضيل العرض (الكلام العربي محتاج عرض) والقرب من النص شوية
      const score = wf * hf * Math.min(1, wf / 0.6) * (1 - 0.15 * Math.abs((y0 + y1) / 2 / gh - 0.45));
      if (!best || score > best.score) best = { x0, y0, x1, y1, score };
    }
  }
  let out = null;
  if (best) {
    const n = (best.x1 - best.x0) * (best.y1 - best.y0);
    out = { x0: best.x0 / gw, y0: best.y0 / gh, x1: best.x1 / gw, y1: best.y1 / gh, lum: rs(L, best.x0, best.y0, best.x1, best.y1) / n / 255, auto: true };
  }
  if (!m) { m = new Map(); cache.set(el, m); }
  m.set(key, out);
  return out;
}

// مصدر الخلفية الحالية (slides.js بيسجّله وهو بيرسم الخلفية)
export const ZONE_SRC = { el: null };

// المساحة اللي هيترسم فيها الكلام دلوقتي (كنِسَب)، أو null = العادي
// 📱 في الطولي: الكلام مايدخلش تحت عمود أزرار التطبيق (يمين) ولا تحت الوصف (تحت)
export const SAFE_UI = { x0: 0.05, x1: 0.84, y1: 0.75 };
export const safeUIOn = (style, W, H) => H > W && style?.safeUI !== false;
export function currentZone(style, W, H) {
  const z = style?.textZone;
  if (!z) return null;
  const r = z === 'auto' ? analyzeZone(ZONE_SRC.el, W, H) : FIXED[z] || null;
  if (!r || !safeUIOn(style, W, H)) return r;
  const c = { ...r, x0: Math.max(r.x0, SAFE_UI.x0), x1: Math.min(r.x1, SAFE_UI.x1), y1: Math.min(r.y1, SAFE_UI.y1) };
  if (c.x1 - c.x0 < 0.3) { c.x0 = Math.max(SAFE_UI.x0, c.x1 - 0.3); }
  if (c.y1 - c.y0 < 0.15) c.y0 = Math.max(0.05, c.y1 - 0.15);
  return c;
}
