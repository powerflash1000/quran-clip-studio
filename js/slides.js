import { lookLayers, lookVignette, drawBrand, drawBumper, drawCardTrans } from './brand.js';
import { currentZone, ZONE_SRC, SAFE_UI, safeUIOn } from './zone.js';
import { frameGeom, artRect, kbAt, kbAmount, drawWall, drawFrameBorder, drawPattern } from './frame.js';

// رسم الشرائح (النص فوق الخلفية) على Canvas.
// نفس الدوال بتتستخدم في المعاينة وفي تصدير الفيديو والصور.

export const ASPECTS = {
  '9:16': { w: 1080, h: 1920, name: 'رأسي 9:16 (ريلز / تيك توك / شورتس)' },
  '1:1': { w: 1080, h: 1080, name: 'مربع 1:1' },
  '16:9': { w: 1920, h: 1080, name: 'أفقي 16:9 (يوتيوب)' },
};

export const QURAN_FONT = 'UthmanicHafs';
export const TEXT_FONT = 'Amiri';

// خطوط الكلام (الأحاديث والأدعية والعناوين) — القرآن بيفضل دايمًا بخط المصحف (حفص)
export const TEXT_FONTS = {
  Amiri: 'أميري (نسخ كلاسيكي)',
  'Aref Ruqaa': 'رقعة',
  'Reem Kufi': 'كوفي',
  'El Messiri': 'المسيري (أنيق)',
  Cairo: 'القاهرة (حديث)',
  Tajawal: 'تجوال (بسيط)',
  Lalezar: 'لاله‌زار (عريض)',
};
export const textFont = style => (style?.textFont && TEXT_FONTS[style.textFont] ? `'${style.textFont}'` : TEXT_FONT);

export async function ensureFonts(style) {
  const tf = textFont(style);
  await Promise.all([
    document.fonts.load(`64px ${QURAN_FONT}`, 'بِسۡمِ'),
    document.fonts.load(`64px ${TEXT_FONT}`, 'حديث'),
    document.fonts.load(`bold 64px ${TEXT_FONT}`, 'حديث'),
    ...(tf !== TEXT_FONT ? [document.fonts.load(`64px ${tf}`, 'حديث'), document.fonts.load(`bold 64px ${tf}`, 'حديث')] : []),
  ].map(p => p.catch(() => null)));
}

// ===== تأثيرات الخط =====
export const TEXT_FX = {
  '': 'ظل عادي',
  outline: 'حدود سودا (واضح فوق أي خلفية)',
  glow: 'توهّج بلون التمييز ✨',
  gold: 'ذهبي 🌟',
  neon: 'نيون',
  card: 'كارت شفاف ورا النص',
  band: 'شريط ملوّن ورا النص',
};
// حركة دخول النص في الفيديو (لكل آية/كارت)
export const TEXT_ANIM = {
  '': 'من غير حركة',
  fade: 'ظهور ناعم',
  rise: 'طلوع من تحت',
  zoom: 'تكبير ناعم',
  blur: 'وضوح تدريجي',
};
export const ENTER_SECS = 0.7;
const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// الحدود/التوهج بيترسموا مع كل fillText (حتى الأقواس المتصلحة)
let PAINT = null;
function paint(ctx, t, x, y) {
  if (PAINT?.stroke) {
    const sc = ctx.shadowColor, sb = ctx.shadowBlur;
    ctx.lineJoin = 'round';
    ctx.lineWidth = PAINT.stroke;
    ctx.strokeStyle = PAINT.strokeColor;
    ctx.strokeText(t, x, y);
    if (PAINT.noShadowFill) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }
    ctx.fillText(t, x, y);
    ctx.shadowColor = sc; ctx.shadowBlur = sb;
    return;
  }
  ctx.fillText(t, x, y);
}

// ===== الخلفية =====
// media: { kind: 'image', el: HTMLImageElement } أو { kind: 'video', el: HTMLVideoElement }
// خلفية ثابتة (صورة/لون/تدرّج) مع لون سينمائي: بنرسمها مرة ونعيد استخدامها (الفيديو بيترسم كل إطار)
const bgCache = new Map();
const elIds = new WeakMap();
let elSeq = 0;
// 🖼️ البرواز والحيطة ثابتين: بيترسموا مرة واحدة في طبقة شفافة من النص، وكل فريم بيتلزقوا جاهزين
// (كانوا بيترسموا من الأول في كل فريم = تصدير أبطأ ١٠ مرات، خصوصًا مع 4K والحركة الهادية)
const frameLayers = new Map();
function frameLayer(W, H, style, fg, A) {
  const key = `${W}x${H}|${fg.kind}|${style.wall || ''}`;
  if (frameLayers.has(key)) return frameLayers.get(key);
  let c = null;
  try { c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : null); } catch { c = null; }
  if (!c) return null;
  const g = c.getContext('2d');
  drawWall(g, W, H, style, fg);
  g.clearRect(A.x, A.y, A.w, A.h);
  drawFrameBorder(g, W, H, style, fg);
  if (frameLayers.size > 6) frameLayers.clear();
  frameLayers.set(key, c);
  return c;
}

export function drawBackground(ctx, W, H, style, media, clock = null) {
  ZONE_SRC.el = media?.el || null; // 📐 مكان الكلام التلقائي بيحلل الخلفية دي
  const still = !media || media.kind === 'image';
  // 🖼️ برواز (لوحة) أو حركة Ken Burns: الخلفية بتترسم جوه مساحة اللوحة بس
  const fg = frameGeom(W, H, style);
  const amt = kbAmount(style);
  if (fg || amt) {
    const A = artRect(W, H, style);
    const kb = kbAt(style, clock);
    const layer = fg ? frameLayer(W, H, style, fg, A) : null;
    if (fg && !layer) drawWall(ctx, W, H, style, fg);
    ctx.save();
    ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
    const c = still && typeof document !== 'undefined' ? stillCache(Math.round(A.w * (1 + amt)), Math.round(A.h * (1 + amt)), style, media) : null;
    if (c) {
      // الصورة متجهزة أكبر شوية (1 + أقصى زوم)، فالزوم بيبقى قص من صورة حادة مش تكبير مغبّش
      const s = kb ? kb.s : 1, sw = c.width / s, sh = c.height / s;
      const sx = Math.min(c.width - sw, Math.max(0, (c.width - sw) / 2 + (kb ? kb.dx : 0) * c.width));
      const sy = Math.min(c.height - sh, Math.max(0, (c.height - sh) / 2 + (kb ? kb.dy : 0) * c.height));
      ctx.drawImage(c, sx, sy, sw, sh, A.x, A.y, A.w, A.h);
    } else {
      ctx.translate(A.x + A.w / 2, A.y + A.h / 2);
      if (kb) { ctx.scale(kb.s, kb.s); ctx.translate(-kb.dx * A.w, -kb.dy * A.h); }
      ctx.translate(-A.w / 2, -A.h / 2);
      paintBackground(ctx, Math.round(A.w), Math.round(A.h), style, media);
    }
    ctx.restore();
    if (layer) ctx.drawImage(layer, 0, 0);
    else if (fg) drawFrameBorder(ctx, W, H, style, fg);
    return;
  }
  if (still && (style?.look || style?.pattern) && typeof document !== 'undefined') {
    const c = stillCache(W, H, style, media);
    if (c) { ctx.drawImage(c, 0, 0); return; }
  }
  paintBackground(ctx, W, H, style, media);
}

// خلفية ثابتة مرسومة مرة واحدة (بالمقاس المطلوب) — null لو الصورة لسه ماتحمّلتش
function stillCache(W, H, style, media) {
  const el = media?.el;
  if (el && !el.naturalWidth) return null;
  if (el && !elIds.has(el)) elIds.set(el, ++elSeq);
  const key = [W, H, style.look, style.pattern, style.accent, style.bgType, style.color1, style.color2, el ? elIds.get(el) : 0, el?.naturalWidth || 0].join('|');
  let c = bgCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = W; c.height = H;
    paintBackground(c.getContext('2d'), W, H, style, media);
    bgCache.set(key, c);
    if (bgCache.size > 6) bgCache.delete(bgCache.keys().next().value);
  }
  return c;
}

function paintBackground(ctx, W, H, style, media) {
  ctx.save();

  if (media && (media.kind === 'image' || media.kind === 'video')) {
    const el = media.el;
    const iw = el.naturalWidth || el.videoWidth || el.width;
    const ih = el.naturalHeight || el.videoHeight || el.height;
    if (iw && ih) {
      const k = Math.max(W / iw, H / ih);
      const dw = iw * k, dh = ih * k;
      ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = style.color1; ctx.fillRect(0, 0, W, H);
    }
  } else if (style.bgType === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, style.color1);
    g.addColorStop(1, style.color2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = style.color1; ctx.fillRect(0, 0, W, H);
  }
  // زخرفة إسلامية خفيفة (على اللون/التدرّج بس — مش فوق الصور)
  if (!media && style?.pattern) drawPattern(ctx, W, H, style);
  // لون سينمائي (من الريلز) على الخلفية بس، مش على الكلام — طبقات تلوين سريعة
  if (style?.look) { lookLayers(ctx, W, H, style.look); lookVignette(ctx, W, H, style.look); }
  ctx.restore();
}

// ===== تقسيم النص على سطور =====
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\n+/)) {
    // بنقسم على المسافة العادية بس، عشان المسافة الثابتة (NBSP) تفضل لازقة رقم الآية بآخر كلمة
    const words = para.split(/[ \t]+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// يصغّر الخط لحد ما النص يدخل في المساحة
function fit(ctx, text, font, size, minSize, maxWidth, maxHeight, lineH) {
  let s = size;
  for (;;) {
    ctx.font = font(s);
    const lines = wrap(ctx, text, maxWidth);
    const h = lines.length * s * lineH;
    if (h <= maxHeight || s <= minSize) return { lines, size: s, height: h };
    s = Math.max(minSize, Math.floor(s * 0.92));
  }
}

// أقواس خط أميري بتترسم مقلوبة في النص العربي (القوس اللي في أول «((الحديث))» بيبص لبره) — مشكلة في الخط نفسه.
// الحل: كل قوس بيترسم لوحده بخط حفص (أقواسه سليمة) والكلام بالخط العادي، من اليمين للشمال.
const BR = /([()[\]{}])/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
const parenFont = ctx => ctx.font.replace(/(\d+(?:\.\d+)?px)\s.*$/, `$1 ${QURAN_FONT}`);
function rtlParts(ctx, text) {
  const base = ctx.font, pf = parenFont(ctx);
  const parts = String(text).split(BR).filter(Boolean).map(t => { const p = t.length === 1 && BR.test(t); ctx.font = p ? pf : base; return { t, p, w: ctx.measureText(t).width }; });
  ctx.font = base;
  return parts;
}
const needsFix = (ctx, text) => BR.test(text) && !ctx.font.includes(QURAN_FONT);
export function measureRtl(ctx, text) {
  return needsFix(ctx, text) ? rtlParts(ctx, text).reduce((a, b) => a + b.w, 0) : ctx.measureText(text).width;
}
export function fillRtl(ctx, text, x, y) {
  if (!needsFix(ctx, text)) return paint(ctx, text, x, y);
  const base = ctx.font, pf = parenFont(ctx), align = ctx.textAlign, parts = rtlParts(ctx, text);
  const total = parts.reduce((a, b) => a + b.w, 0);
  let cur = align === 'center' ? x + total / 2 : align === 'left' || align === 'end' ? x + total : x;
  ctx.textAlign = 'right';
  const dir = ctx.direction;
  // القوس بيترسم معكوس بإيدينا واتجاه ltr، عشان منعتمدش على عكس المتصفح (مش ثابت مع الكاش والأحجام)
  for (const s of parts) {
    ctx.font = s.p ? pf : base;
    ctx.direction = s.p ? 'ltr' : dir;
    paint(ctx, s.p ? MIRROR[s.t] : s.t, cur, y);
    cur -= s.w;
  }
  ctx.font = base; ctx.textAlign = align; ctx.direction = dir;
}

// رسم كلمة بكلمة في أماكنها الثابتة (عشان النص ميتحركش وهو بيظهر)
// shown = عدد الكلمات اللي اتقرت؛ mode: 'reveal' (الباقي مخفي) أو 'highlight' (الباقي باهت والحالية ملوّنة)
function drawWords(ctx, lines, cx, y, size, lineH, shown, mode, style) {
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const space = ctx.measureText(' ').width;
  let idx = 0;
  lines.forEach((line, li) => {
    const words = line.split(' ');
    const widths = words.map(w => measureRtl(ctx, w));
    const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
    let x = cx + total / 2;
    const yy = y + size * lineH * (li + 0.5);
    words.forEach((w, k) => {
      if (idx < shown) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = mode === 'highlight' && idx === shown - 1 ? style.accent : style.textColor;
        fillRtl(ctx, w, x, yy);
      } else if (mode === 'highlight') {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = style.textColor;
        fillRtl(ctx, w, x, yy);
      }
      x -= widths[k] + space;
      idx++;
    });
  });
  ctx.globalAlpha = 1;
}

// «الكلمة اللي بتتقال بس»: الشاشة فاضية إلا من الكلمة الحالية (now1) أو مجموعتها من ٢–٣ كلمات (now3).
// الكلام اللي اتقال بيختفي، واللي لسه ماجاش مابيظهرش. بخط أكبر في نص مكان الكلام.
export function liveChunk(all, shown, mode) {
  const cur = Math.max(0, Math.min(all.length - 1, shown - 1));
  if (mode === 'now1') return { a: cur, b: cur, cur };
  const n = all.length, size = 3;
  let a = Math.floor(cur / size) * size, b = Math.min(n - 1, a + size - 1);
  if (n - a === 1 && a >= size) a -= 1; // آخر كلمة لوحدها ← خليها مع اللي قبلها
  return { a, b, cur };
}
function drawLive(ctx, lines, cx, cy, boxW, baseSize, font, shown, mode, style, fx) {
  const all = lines.join(' ').split(' ').filter(Boolean);
  if (!all.length || shown <= 0) return;
  const { a, b, cur } = liveChunk(all, shown, mode);
  // اللي اتقال بس من المجموعة (اللي لسه ماتقالش مش بيظهر) — ومتوسّط
  const ws = all.slice(a, cur + 1);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  // المقاس على المجموعة كلها عشان الخط مايكبرش ويصغر مع كل كلمة
  const full = all.slice(a, b + 1);
  let size = Math.max(baseSize, Math.round(baseSize * (mode === 'now1' ? 2.1 : 1.6)));
  const widthOf = list => { ctx.font = font(size); const sp = ctx.measureText(' ').width; const w = list.map(x => measureRtl(ctx, x)); return { sp, w, total: w.reduce((p, q) => p + q, 0) + sp * Math.max(0, w.length - 1) }; };
  while (widthOf(full).total > boxW * 0.95 && size > baseSize * 0.6) size = Math.floor(size * 0.92);
  const m = widthOf(ws);
  if (fx === 'card' || fx === 'band') {
    const ph = size * 0.45, saved = ctx.fillStyle;
    ctx.fillStyle = fx === 'card' ? 'rgba(0,0,0,0.45)' : hexA(style.accent, 0.82);
    ctx.beginPath(); ctx.roundRect(cx - m.total / 2 - ph, cy - size * 0.8, m.total + ph * 2, size * 1.6, size * 0.3); ctx.fill();
    ctx.fillStyle = fx === 'band' ? bandInk(style.accent) : saved;
  }
  const base = ctx.fillStyle;
  let x = cx + m.total / 2;
  ws.forEach((w, k) => {
    ctx.fillStyle = mode !== 'now1' && k === ws.length - 1 && ws.length > 1 ? style.accent : base;
    fillRtl(ctx, w, x, cy);
    x -= m.w[k] + m.sp;
  });
  ctx.fillStyle = base;
}

// كل الآيات مرة واحدة: كل كلمة عارفة هي من أنهي آية، والآية اللي بتتقري بلون التمييز (والباقي أهدى) لو hi
function drawGroup(ctx, lines, cx, y, size, lineH, grp, style) {
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const owner = grp.texts.flatMap((t, i) => t.split(/[ \t]+/).filter(Boolean).map(() => i));
  const base = ctx.fillStyle, space = ctx.measureText(' ').width;
  let idx = 0;
  lines.forEach((line, li) => {
    const ws = line.split(' ');
    const widths = ws.map(w => measureRtl(ctx, w));
    let x = cx + (widths.reduce((a, b) => a + b, 0) + space * (ws.length - 1)) / 2;
    const yy = y + size * lineH * (li + 0.5);
    ws.forEach((w, k) => {
      const cur = owner[idx] === grp.idx;
      ctx.globalAlpha = grp.hi && !cur ? 0.55 : 1;
      ctx.fillStyle = grp.hi && cur ? style.accent : base;
      fillRtl(ctx, w, x, yy);
      x -= widths[k] + space;
      idx++;
    });
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = base;
}

function drawLines(ctx, lines, x, y, size, lineH, dir) {
  ctx.direction = dir;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => (dir === 'rtl' ? fillRtl : paint)(ctx, l, x, y + size * lineH * (i + 0.5)));
}

// ===== 📿 عدّاد الذكر =====
// c: { n: عدد المرات, viz: 'beads'|'wheel', wheel?: { labels, idx } } — rep: المرة الحالية (من ١)
const AR_NUM = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
function drawCounter(ctx, box, c, rep, style, unit, TF) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10 * unit; ctx.shadowOffsetY = 0;
  const y0 = box.y0 + (c.viz === 'wheel' ? 10 : 70) * unit; // مكان للشرّابة تحت العنوان
  const cx = (box.x0 + box.x1) / 2, cy = (y0 + box.y1) / 2;
  const R = Math.max(40 * unit, Math.min(box.x1 - box.x0, box.y1 - y0) / 2 - 8 * unit);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  if (c.viz === 'wheel' && c.wheel) drawWheel(ctx, cx, cy, R, c, rep, style, unit, TF);
  else drawBeads(ctx, cx, cy, R, c, rep, style, unit, TF);
  ctx.restore();
}

// سبحة: خرز في دايرة — اللي اتقال بلون التمييز، والحالية أكبر ومنوّرة. فوق: «الإمام» والشرّابة
function drawBeads(ctx, cx, cy, R, c, rep, style, unit, TF) {
  const n = c.n, ring = n <= 33 ? n : 33;            // العدد الكبير (١٠٠): سبحة ٣٣ بتلف أكتر من مرة
  const done = n <= 33 ? rep : ((rep - 1) % 33) + 1;
  const rr = R * 0.86;
  const bead = Math.min(R * 0.16, Math.PI * rr / ring * 0.82);
  // الخيط
  ctx.strokeStyle = hexA(style.textColor, 0.35); ctx.lineWidth = Math.max(1.5, 2.5 * unit);
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  // الإمام والشرّابة فوق
  const ty = cy - rr;
  ctx.fillStyle = style.accent;
  ctx.beginPath(); ctx.ellipse(cx, ty, bead * 0.75, bead * 1.15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = hexA(style.accent, 0.8); ctx.lineWidth = Math.max(1, 1.6 * unit);
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(cx, ty - bead); ctx.lineTo(cx + k * bead * 0.22, ty - bead * 1.9); ctx.stroke(); }
  // الخرز (مع عقارب الساعة من فوق، سايبين مكان الإمام)
  const gap = (bead * 2.4) / rr, span = Math.PI * 2 - gap;
  for (let i = 0; i < ring; i++) {
    const ang = -Math.PI / 2 + gap / 2 + span * (i + 0.5) / ring;
    const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
    const isCur = i === done - 1, isDone = i < done;
    const r = isCur ? bead * 1.25 : bead;
    if (isCur) { ctx.save(); ctx.shadowColor = style.accent; ctx.shadowBlur = 24 * unit; }
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    if (isDone) { g.addColorStop(0, '#fff6d6'); g.addColorStop(0.5, style.accent); g.addColorStop(1, darkenHex(style.accent, 0.45)); }
    else { g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0.12)'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (isCur) ctx.restore();
  }
  // العدّاد في النص
  ctx.fillStyle = style.textColor;
  ctx.font = `bold ${Math.round(R * 0.5)}px ${TF}`;
  ctx.fillText(AR_NUM(rep), cx, cy - R * 0.06);
  ctx.fillStyle = hexA(style.textColor, 0.75);
  ctx.font = `${Math.round(R * 0.15)}px ${TF}`;
  ctx.fillText(`من ${AR_NUM(n)}`, cx, cy + R * 0.32);
}

// ===== 🎡 عجلة الأذكار (تصميم ساعة فاخرة) =====
// ثيمات الألوان: القرص، الإطار المعدني، الكلام، اللون المميّز
export const WHEEL_THEMES = {
  gold: { name: 'دهبي على أسود فخم', disc: ['#2a2418', '#0d0b07'], rim: ['#6b4a0c', '#f8e3a0', '#c99a2e', '#fff4cc', '#8a6212'], ink: '#f4ead2', dim: 'rgba(244,234,210,0.42)', acc: '#f2c75c', glow: 'rgba(242,199,92,0.65)', hub: ['#fff4cc', '#c99a2e', '#5e4108'] },
  ivory: { name: 'عاجي ودهبي (فاتح)', disc: ['#fffaf0', '#e9dfcb'], rim: ['#8a6212', '#f8e3a0', '#c99a2e', '#fff4cc', '#7a560f'], ink: '#3a2c16', dim: 'rgba(58,44,22,0.38)', acc: '#b07c12', glow: 'rgba(176,124,18,0.45)', hub: ['#fff4cc', '#c99a2e', '#5e4108'] },
  emerald: { name: 'أخضر زمردي ودهبي', disc: ['#0f4a3a', '#06231b'], rim: ['#6b4a0c', '#f8e3a0', '#c99a2e', '#fff4cc', '#8a6212'], ink: '#eaf5ef', dim: 'rgba(234,245,239,0.4)', acc: '#f2c75c', glow: 'rgba(242,199,92,0.6)', hub: ['#fff4cc', '#c99a2e', '#5e4108'] },
  navy: { name: 'كحلي ليلي وفضي', disc: ['#16264a', '#070d1e'], rim: ['#55606f', '#f2f5f9', '#9aa6b5', '#ffffff', '#4b5563'], ink: '#eef2fa', dim: 'rgba(238,242,250,0.4)', acc: '#9fd3ff', glow: 'rgba(120,190,255,0.65)', hub: ['#ffffff', '#9aa6b5', '#3b4250'] },
  glass: { name: '🫧 إزاز شفاف غامق + دهبي (المنظر يبان)', alpha: 0.32, disc: ['#1c1c1c', '#000000'], rim: ['#6b4a0c', '#f8e3a0', '#c99a2e', '#fff4cc', '#8a6212'], ink: '#ffffff', dim: 'rgba(255,255,255,0.6)', acc: '#f6d47a', glow: 'rgba(246,212,122,0.7)', hub: ['#fff4cc', '#c99a2e', '#5e4108'] },
  glassLight: { name: '🫧 إزاز شفاف فاتح + دهبي', alpha: 0.4, disc: ['#ffffff', '#efefef'], rim: ['#8a6212', '#f8e3a0', '#c99a2e', '#fff4cc', '#7a560f'], ink: '#2b2116', dim: 'rgba(43,33,22,0.55)', acc: '#9a6a0c', glow: 'rgba(154,106,12,0.5)', hub: ['#fff4cc', '#c99a2e', '#5e4108'] },
  glassWhite: { name: '🫧 إزاز شفاف بإطار أبيض (مودرن)', alpha: 0.28, disc: ['#2a3540', '#0e151c'], rim: ['#c9d2db', '#ffffff', '#e6ebf0', '#ffffff', '#b8c2cc'], ink: '#ffffff', dim: 'rgba(255,255,255,0.65)', acc: '#ffffff', glow: 'rgba(255,255,255,0.8)', hub: ['#ffffff', '#e6ebf0', '#9aa6b5'] },
  rose: { name: 'روز جولد ناعم', disc: ['#fbefe9', '#efd7cc'], rim: ['#7a4a3a', '#f6d2c2', '#c98b74', '#fff0e8', '#8a5442'], ink: '#4a2a22', dim: 'rgba(74,42,34,0.38)', acc: '#b9654b', glow: 'rgba(185,101,75,0.45)', hub: ['#fff0e8', '#c98b74', '#6a3a2c'] },
};
const metal = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; };
function star8(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const a = rot + k * Math.PI / 8, rr = k % 2 ? r * 0.72 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function drawWheel(ctx, cx, cy, R, c, rep, style, unit, TF) {
  let T = WHEEL_THEMES[style.countTheme] || WHEEL_THEMES.gold;
  // لون الكتابة من اختيارك (لو محدد)، وشفافية القرص (المنظر الطبيعي يبان من وراه)
  if (style.countInk) T = { ...T, ink: style.countInk, dim: hexA(style.countInk, 0.55), acc: style.countAcc || T.acc };
  const alpha = Math.max(0.1, Math.min(1, Number(style.countAlpha) > 0 ? Number(style.countAlpha) : (T.alpha ?? 1)));
  const glassy = alpha < 0.7;
  const { labels, idx } = c.wheel, m = labels.length, n = c.n;
  const step = Math.PI * 2 / m, a0 = -Math.PI / 2;
  // حافة العجلة: metal = إطار معدني، thin = خط رفيع، none = من غير حافة (العجلة بتدوب في المنظر)
  const rim = style.countRim || 'none';
  const bez = R * (rim === 'metal' ? 0.07 : 0.025), Rd = R - bez; // عرض الحافة ونص قطر القرص
  const rIn = Rd * 0.42;                        // الدايرة اللي في النص
  ctx.save();
  // ضل العجلة كلها
  if (rim === 'metal') {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = R * 0.12; ctx.shadowOffsetY = R * 0.03;
    ctx.fillStyle = metal(ctx, cx - R, cy - R, cx + R, cy + R, T.rim);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, R - bez, 0, Math.PI * 2, true); ctx.fill();
    ctx.shadowColor = 'transparent';
    // حافة لامعة جوه الإطار
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.beginPath(); ctx.arc(cx, cy, R - bez * 0.35, 0, Math.PI * 2); ctx.stroke();
  } else if (rim === 'thin') {
    ctx.strokeStyle = T.dim; ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, Math.PI * 2); ctx.stroke();
  }
  // تقدّم الفيديو كله على الإطار (قوس منوّر)
  if (m > 1) {
    ctx.save();
    ctx.strokeStyle = T.acc; ctx.lineWidth = Math.max(bez * 0.32, R * 0.012); ctx.lineCap = 'round';
    ctx.shadowColor = T.glow; ctx.shadowBlur = R * 0.04;
    ctx.beginPath(); ctx.arc(cx, cy, R - bez * 0.55, a0, a0 + Math.PI * 2 * ((idx + rep / Math.max(1, n)) / m)); ctx.stroke();
    ctx.restore();
  }
  // القرص
  const dg = ctx.createRadialGradient(cx - Rd * 0.25, cy - Rd * 0.3, Rd * 0.05, cx, cy, Rd);
  if (rim === 'none') {
    // من غير حافة: القرص بيتلاشى بنعومة في المنظر عند الطرف
    dg.addColorStop(0, hexA(T.disc[0], alpha)); dg.addColorStop(0.78, hexA(T.disc[1], alpha)); dg.addColorStop(1, hexA(T.disc[1], 0));
  } else { dg.addColorStop(0, T.disc[0]); dg.addColorStop(1, T.disc[1]); }
  ctx.save(); ctx.globalAlpha = rim === 'none' ? 1 : alpha;
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // لمعة الإزاز (خط نور مايل من فوق)
  if (glassy) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, Math.PI * 2); ctx.clip();
    const sh = ctx.createLinearGradient(cx - Rd, cy - Rd, cx + Rd * 0.2, cy + Rd * 0.4);
    sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.05)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fillRect(cx - Rd, cy - Rd, Rd * 2, Rd * 2);
    ctx.restore();
  }
  // ظل داخلي خفيف تحت الإطار
  const ig = ctx.createRadialGradient(cx, cy, Rd * 0.85, cx, cy, Rd);
  ig.addColorStop(0, 'rgba(0,0,0,0)'); ig.addColorStop(1, `rgba(0,0,0,${glassy ? 0.12 : 0.28})`);
  if (rim !== 'none') { ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, Math.PI * 2); ctx.fill(); }
  // زخرفة نجوم خفيفة في الخلفية
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = T.dim; ctx.globalAlpha = 0.18; ctx.lineWidth = Math.max(1, R * 0.003);
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; star8(ctx, cx + Math.cos(a) * Rd * 0.97, cy + Math.sin(a) * Rd * 0.97, Rd * 0.09, a); ctx.stroke(); }
  ctx.restore();
  // علامات الدقايق (رفيعة) وفواصل الأذكار (أوضح)
  ctx.strokeStyle = T.dim; ctx.lineCap = 'round';
  for (let k = 0; k < 120; k++) {
    const a = k * Math.PI / 60, l = k % 10 ? Rd * 0.025 : Rd * 0.045;
    ctx.lineWidth = Math.max(1, R * (k % 10 ? 0.003 : 0.006));
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (Rd - Rd * 0.015), cy + Math.sin(a) * (Rd - Rd * 0.015)); ctx.lineTo(cx + Math.cos(a) * (Rd - l), cy + Math.sin(a) * (Rd - l)); ctx.stroke();
  }
  // القطاع الحالي منوّر
  ctx.save();
  const sg = ctx.createRadialGradient(cx, cy, rIn, cx, cy, Rd);
  sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, T.glow);
  ctx.fillStyle = sg; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Rd * 0.94, a0 + (idx - 0.5) * step, a0 + (idx + 0.5) * step); ctx.closePath(); ctx.fill();
  ctx.restore();
  // أسماء الأذكار
  const fs = Math.max(9 * unit, Math.min(Rd * 0.07, (Math.PI * 2 * Rd * 0.66 / m) * 0.62));
  const rLab = (rIn + Rd * 0.9) / 2, maxL = Rd * 0.9 - rIn - Rd * 0.06;
  for (let i = 0; i < m; i++) {
    const ang = a0 + i * step, cur = i === idx;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang);
    // فاصل رفيع بين القطاعات
    ctx.strokeStyle = T.dim; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1, R * 0.002);
    ctx.rotate(step / 2); ctx.beginPath(); ctx.moveTo(rIn + Rd * 0.03, 0); ctx.lineTo(Rd * 0.93, 0); ctx.stroke(); ctx.rotate(-step / 2);
    ctx.globalAlpha = 1;
    ctx.translate(rLab, 0);
    if (Math.cos(ang) < -0.01) ctx.rotate(Math.PI);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    ctx.font = `${cur ? 'bold ' : ''}${Math.round(fs * (cur ? 1.18 : 1))}px ${TF}`;
    if (cur) { ctx.shadowColor = T.glow; ctx.shadowBlur = fs * 0.9; }
    else if (glassy) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = fs * 0.35; } // الكلام يتقري فوق المنظر
    ctx.fillStyle = cur ? T.acc : i < idx ? T.dim : T.ink;
    fitText(ctx, labels[i], 0, 0, maxL);
    ctx.restore();
  }
  // الإبرة: مدبّبة ومنوّرة
  const a = a0 + idx * step;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(a);
  ctx.shadowColor = T.glow; ctx.shadowBlur = R * 0.05;
  ctx.fillStyle = metal(ctx, 0, -R * 0.02, 0, R * 0.02, T.hub);
  // سهم قصير من حافة الميناء بيشاور على الذكر (مايغطيش الكلام)
  ctx.beginPath(); ctx.moveTo(rIn * 0.95, -R * 0.03); ctx.lineTo(rIn + Rd * 0.07, 0); ctx.lineTo(rIn * 0.95, R * 0.03); ctx.closePath(); ctx.fill();
  // ونقطة منوّرة على الإطار عند الذكر الحالي
  ctx.beginPath(); ctx.arc(Rd * 0.965, 0, R * 0.018, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // الدايرة اللي في النص (زي ميناء الساعة) + حلقة مرات الذكر
  const hg = ctx.createRadialGradient(cx - rIn * 0.3, cy - rIn * 0.35, rIn * 0.1, cx, cy, rIn);
  hg.addColorStop(0, T.disc[0]); hg.addColorStop(1, T.disc[1]);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = R * 0.05;
  ctx.globalAlpha = Math.min(1, alpha + 0.3);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = rim === 'metal' ? metal(ctx, cx - rIn, cy - rIn, cx + rIn, cy + rIn, T.rim) : T.dim; ctx.lineWidth = rim === 'metal' ? Math.max(2, R * 0.014) : Math.max(1, R * 0.006);
  ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2); ctx.stroke();
  // حلقة المرات: قطع بعدد المرات (لحد ٣٣)، أو قوس متصل للعدد الكبير
  const rr = rIn * 0.86, lw = Math.max(3, rIn * 0.07);
  ctx.lineCap = 'round';
  if (n > 1 && n <= 33) {
    const gap = Math.min(0.12, Math.PI / n * 0.35), seg = Math.PI * 2 / n;
    for (let k = 0; k < n; k++) {
      ctx.save();
      ctx.strokeStyle = k < rep ? T.acc : T.dim; ctx.lineWidth = lw * (k === rep - 1 ? 1.25 : 1);
      if (k === rep - 1) { ctx.shadowColor = T.glow; ctx.shadowBlur = lw * 2; }
      ctx.globalAlpha = k < rep ? 1 : 0.35;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0 + k * seg + gap / 2, a0 + (k + 1) * seg - gap / 2); ctx.stroke();
      ctx.restore();
    }
  } else if (n > 33) {
    ctx.strokeStyle = T.dim; ctx.globalAlpha = 0.35; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.save(); ctx.strokeStyle = T.acc; ctx.shadowColor = T.glow; ctx.shadowBlur = lw * 2;
    ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + Math.PI * 2 * rep / n); ctx.stroke(); ctx.restore();
  }
  // الأرقام في النص
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  ctx.fillStyle = T.ink;
  ctx.font = `bold ${Math.round(rIn * (n > 1 ? 0.5 : 0.42))}px ${TF}`;
  if (n > 1) {
    ctx.save(); ctx.shadowColor = T.glow; ctx.shadowBlur = rIn * 0.15;
    ctx.fillText(AR_NUM(rep), cx, cy - rIn * 0.08); ctx.restore();
    ctx.fillStyle = T.dim; ctx.font = `${Math.round(rIn * 0.15)}px ${TF}`;
    ctx.fillText(`من ${AR_NUM(n)}`, cx, cy + rIn * 0.33);
  } else {
    ctx.fillText('✓', cx, cy - rIn * 0.06);
  }
  // رقم الذكر من كام (فوق الرقم)
  ctx.fillStyle = T.acc; ctx.font = `${Math.round(rIn * 0.13)}px ${TF}`;
  ctx.fillText(`الذكر ${AR_NUM(idx + 1)} من ${AR_NUM(m)}`, cx, cy - rIn * 0.52);
  // جوهرة صغيرة فوق العجلة (مكان البداية) — مع الإطار المعدني بس
  if (rim === 'metal') ctx.fillStyle = metal(ctx, cx, cy - R - R * 0.03, cx, cy - R + R * 0.06, T.hub);
  if (rim === 'metal') { ctx.beginPath(); ctx.moveTo(cx, cy - R + bez * 0.9); ctx.lineTo(cx - R * 0.035, cy - R - R * 0.02); ctx.lineTo(cx + R * 0.035, cy - R - R * 0.02); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
// نص في عرض معيّن (بيصغر لو أطول)
function fitText(ctx, t, x, y, maxW) {
  const w = measureRtl(ctx, t);
  if (w > maxW) { ctx.save(); ctx.translate(x, y); ctx.scale(maxW / w, maxW / w); fillRtl(ctx, t, 0, 0); ctx.restore(); }
  else fillRtl(ctx, t, x, y);
}
const darkenHex = (h, k) => { const [r, g, b] = hexRgb(h); return `rgb(${[r, g, b].map(v => Math.round(v * (1 - k))).join(',')})`; };

// ===== طبقة النص (شفافة، بتتحط فوق الخلفية) =====
// seg: { kind: 'ayah'|'basmala'|'hadith'|'title', text, sub, label, footer, gradeLabel }
export function drawOverlay(ctx, W, H, seg, style) {
  ctx.save();
  const TF = textFont(style);
  // 🖼️ مع البرواز: التعتيم والكلام واللوجو جوه اللوحة بس
  const R = artRect(W, H, style), framed = R.w !== W;
  if (style.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${style.dim})`;
    ctx.fillRect(R.x, R.y, R.w, R.h);
  }
  if (!seg) { ctx.restore(); return; }
  // مقدمة / خاتمة القناة
  if (seg.kind === 'bumper') { drawBumper(ctx, W, H, seg, style, TF); ctx.restore(); return; }
  // انتقال بين الكروت (ومضة نور / غمقان / شعاع) في أول لحظة من كل كارت
  if (seg.age != null) drawCardTrans(ctx, W, H, style, seg.age);

  const portrait = H > W;
  const unit = Math.min(W, H) / 1080;          // مقياس عام
  let padX = R.x + R.w * (portrait ? 0.08 : 0.1);
  let top = R.y + R.h * (portrait ? 0.12 : framed ? 0.13 : 0.1);
  let bottom = R.y + R.h * (portrait ? 0.78 : framed ? 0.87 : 0.86);   // بنسيب مكان تحت لأزرار التطبيقات
  let boxW = R.w - (padX - R.x) * 2;
  let cx = R.x + R.w / 2, labelY = top - 40 * unit, footerY = bottom + 30 * unit;
  // 📱 الطولي (ريلز/تيك توك/شورتس): الكلام بيبعد عن عمود الأزرار اللي على اليمين وعن الوصف اللي تحت،
  // ومتوسّط في المساحة اللي فاضلة — بنفس حجم الخط تقريبًا (العرض بيقل ~٨٪ بس)
  if (safeUIOn(style, W, H) && !framed) {
    padX = R.x + R.w * SAFE_UI.x0; boxW = R.w * (SAFE_UI.x1 - SAFE_UI.x0); cx = padX + boxW / 2;
    bottom = Math.min(bottom, R.y + R.h * (SAFE_UI.y1 - 0.03)); footerY = bottom + 30 * unit;
  }
  // 📐 مكان الكلام: مساحة معيّنة (تلقائي = أهدى مساحة في الخلفية)
  const zone = currentZone(style, Math.round(R.w), Math.round(R.h));
  let ink = null;
  if (zone) {
    const m = 26 * unit;
    const zx0 = R.x + zone.x0 * R.w + m, zx1 = R.x + zone.x1 * R.w - m;
    padX = zx0; boxW = Math.max(W * 0.25, zx1 - zx0); cx = (zx0 + zx1) / 2;
    const ls = 40 * unit * style.labelScale, fs = 32 * unit * style.labelScale;
    const zy0 = R.y + zone.y0 * R.h + m, zy1 = R.y + zone.y1 * R.h - m;
    labelY = zy0 + ls * 0.6; footerY = zy1 - fs * 0.65;
    top = zy0 + (style.showLabel && seg.label ? ls * 1.6 : 0);
    bottom = zy1 - (style.showFooter && seg.footer ? fs * 1.7 : 0);
    if (bottom - top < H * 0.12) { const c = (top + bottom) / 2; top = c - H * 0.06; bottom = c + H * 0.06; }
    // لون الكلام حسب إضاءة المساحة (بعد التعتيم)
    if (style.textInk === 'auto' && zone.lum != null) {
      const lum = zone.lum * (1 - (style.dim || 0));
      ink = lum > 0.58
        ? { text: '#2b211a', sub: '#4d4036', accent: darken(style.accent, 0.45), shadow: 'rgba(255,255,255,0.35)' }
        : { text: '#ffffff', sub: '#e9e4da', accent: style.accent, shadow: 'rgba(0,0,0,0.55)' };
    }
  }
  const brandStyle = style; // العلامة واللوجو مكانهم برّه المساحة، فبيفضلوا بألوانك
  if (ink) style = { ...style, textColor: ink.text, subColor: ink.sub, accent: ink.accent };

  // كلام غامق (على خلفية فاتحة): ضل فاتح خفيف بدل الضل الأسود اللي بيوسّخ الحروف
  const darkInk = ink ? ink.text !== '#ffffff' : luma(style.textColor) < 0.45;
  ctx.shadowColor = ink?.shadow || (darkInk ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.55)');
  ctx.shadowBlur = (darkInk ? 8 : 18) * unit;
  ctx.shadowOffsetY = (darkInk ? 0 : 3) * unit;

  // العنوان فوق (اسم السورة ورقم الآية)
  if (style.showLabel && seg.label) {
    ctx.fillStyle = style.accent;
    ctx.font = `bold ${Math.round(40 * unit * style.labelScale)}px ${TF}`;
    drawLines(ctx, [seg.label], cx, labelY, 40 * unit * style.labelScale, 1.2, 'rtl');
  }
  // رقم الجزء في السلسلة (مثلًا: الجزء ٣ من ١٢)
  if (seg.badge) {
    ctx.fillStyle = style.subColor;
    const bs = Math.round(30 * unit * style.labelScale);
    ctx.font = `${bs}px ${TF}`;
    drawLines(ctx, [seg.badge], cx, labelY - 62 * unit * style.labelScale, bs, 1.2, 'rtl');
  }

  // 📿 عدّاد الذكر (سبحة / عجلة): الرسمة فوق والذكر تحتها (في الأفقي: الرسمة شمال والذكر يمين)
  if (seg.counter) {
    const rep = Math.max(1, Math.min(seg.counter.n, seg.wordCount ?? 1));
    if (portrait || boxW < W * 0.5) {
      const vb = top + (bottom - top) * 0.5;
      drawCounter(ctx, { x0: padX, x1: padX + boxW, y0: top, y1: vb }, seg.counter, rep, style, unit, TF);
      top = vb + 28 * unit;
    } else {
      const half = boxW / 2;
      drawCounter(ctx, { x0: padX, x1: padX + half - 20 * unit, y0: top, y1: bottom }, seg.counter, rep, style, unit, TF);
      padX += half + 20 * unit; boxW = half - 20 * unit; cx = padX + boxW / 2;
    }
  }

  const isQuran = seg.kind === 'ayah' || seg.kind === 'basmala';
  const mainFont = s => isQuran ? `${s}px ${QURAN_FONT}` : `${s}px ${TF}`;
  const lineH = isQuran ? 1.75 : 1.6;
  const hasSub = style.showTranslation && seg.sub;
  const subShare = hasSub ? 0.32 : 0;
  const area = bottom - top;

  // كل آيات الكارت مرة واحدة (seg.group) — الكلمات مع التلاوة مش بتشتغل هنا
  const grp = seg.group && style.ayahLayout && style.ayahLayout !== 'one' ? seg.group : null;
  const main = fit(ctx, grp ? grp.texts.join(' ') : seg.text, mainFont, Math.round(style.textSize * unit * (isQuran ? 1 : 0.8)),
    Math.round(22 * unit), boxW, area * (1 - subShare) - 30 * unit, lineH);

  let sub = null;
  const subSize = Math.round(style.textSize * unit * 0.42);
  if (hasSub) {
    const subDir = /[؀-ۿ]/.test(seg.sub) ? 'rtl' : 'ltr';
    ctx.direction = subDir;
    sub = fit(ctx, seg.sub, s => `${s}px ${TF}, sans-serif`, subSize, Math.round(18 * unit),
      boxW, area * subShare, 1.45);
    sub.dir = subDir;
  }

  const gapMS = hasSub ? 36 * unit : 0;
  const total = main.height + gapMS + (sub ? sub.height : 0);
  let y = top + (area - total) / 2;

  // حركة الدخول: seg.age = الثواني من أول الكارت (في الفيديو والمعاينة والبث)
  const words = !grp && !seg.counter && seg.wordCount != null && style.wordMode && style.wordMode !== 'full';
  const live = words && /^now/.test(style.wordMode); // «الكلمة اللي بتتقال بس» (زي ترجمة الريلز)
  // مع «الآيات كلها مرة واحدة» الحركة بتحصل مرة واحدة بس في أول آية
  const anim = !words && !(grp && grp.idx > 0) && style.textAnim && seg.age != null && seg.age < ENTER_SECS ? ease(seg.age / ENTER_SECS) : null;
  ctx.save();
  if (anim != null) {
    const cy = y + total / 2;
    ctx.globalAlpha = anim;
    if (style.textAnim === 'rise') ctx.translate(0, (1 - anim) * 60 * unit);
    if (style.textAnim === 'zoom') { const k = 0.9 + 0.1 * anim; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
    if (style.textAnim === 'blur') ctx.filter = `blur(${((1 - anim) * 14 * unit).toFixed(1)}px)`;
  }
  // كارت أو شريط ورا النص
  const fx = style.textFx || '';
  if ((fx === 'card' || fx === 'band') && !live) {
    const ph = 34 * unit, bh = total + ph * 2, by = y - ph;
    const saved = [ctx.shadowColor, ctx.shadowBlur];
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30 * unit;
    ctx.fillStyle = fx === 'card' ? 'rgba(0,0,0,0.45)' : hexA(style.accent, 0.82);
    ctx.beginPath();
    if (fx === 'card') ctx.roundRect(padX - 30 * unit, by, boxW + 60 * unit, bh, 36 * unit);
    else ctx.rect(0, by, W, bh);
    ctx.fill();
    [ctx.shadowColor, ctx.shadowBlur] = saved;
  }
  ctx.font = mainFont(main.size);
  ctx.fillStyle = fx === 'band' ? bandInk(style.accent) : style.textColor;
  if (fx === 'outline') PAINT = { stroke: Math.max(3, main.size * 0.09), strokeColor: 'rgba(0,0,0,0.9)' };
  if (fx === 'glow') { ctx.shadowColor = style.accent; ctx.shadowBlur = 34 * unit; ctx.shadowOffsetY = 0; }
  if (fx === 'neon') { ctx.shadowColor = style.accent; ctx.shadowBlur = 26 * unit; ctx.shadowOffsetY = 0; PAINT = { stroke: Math.max(2, main.size * 0.05), strokeColor: style.accent, noShadowFill: false }; ctx.fillStyle = '#ffffff'; }
  if (fx === 'gold') {
    const g = ctx.createLinearGradient(0, y, 0, y + main.height);
    for (let k = 0; k < main.lines.length; k++) {
      const a = k / main.lines.length, b = (k + 1) / main.lines.length;
      g.addColorStop(a, '#fff4c2'); g.addColorStop(a + (b - a) * 0.5, '#e7c25a'); g.addColorStop(b - 0.001, '#a8781e');
    }
    ctx.fillStyle = g;
    PAINT = { stroke: Math.max(2, main.size * 0.035), strokeColor: 'rgba(60,35,0,0.85)' };
  }
  try {
    if (grp) drawGroup(ctx, main.lines, cx, y, main.size, lineH, grp, style);
    else if (live) drawLive(ctx, main.lines, cx, y + main.height / 2, boxW, main.size, mainFont, seg.wordCount, style.wordMode, style, fx);
    else if (words) drawWords(ctx, main.lines, cx, y, main.size, lineH, seg.wordCount, style.wordMode, style);
    else drawLines(ctx, main.lines, cx, y, main.size, lineH, 'rtl');
  } finally { PAINT = null; }
  y += main.height + gapMS;
  ctx.restore();
  ctx.save();
  if (anim != null) { ctx.globalAlpha = anim; if (style.textAnim === 'rise') ctx.translate(0, (1 - anim) * 60 * unit); }

  if (sub) {
    ctx.fillStyle = style.subColor;
    ctx.font = `${sub.size}px ${TF}, sans-serif`;
    drawLines(ctx, sub.lines, cx, y, sub.size, 1.45, sub.dir);
  }
  ctx.restore();

  // تحت: اسم القارئ أو مصدر الحديث ودرجته
  if (style.showFooter && seg.footer) {
    ctx.fillStyle = style.accent;
    const fs = Math.round(32 * unit * style.labelScale);
    ctx.font = `${fs}px ${TF}`;
    drawLines(ctx, [seg.footer], cx, footerY, fs, 1.3, 'rtl');
  }
  // اللوجو وعلامة الحساب (@اسم_حسابك) — الحجم والمكان والشفافية من «🎨 الهوية والجرافيك»
  if (framed) { ctx.translate(R.x, R.y); drawBrand(ctx, R.w, R.h, brandStyle, TF); } else drawBrand(ctx, W, H, brandStyle, TF);
  ctx.restore();
}

// موجة صوتية بسيطة للمعاينة (في الفيديو النهائي ffmpeg بيرسمها)
export function drawWave(ctx, W, H, analyser, color) {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 4;
  ctx.beginPath();
  const y0 = H * (H > W ? 0.86 : 0.93), amp = H * 0.05;
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * W;
    const y = y0 + ((data[i] - 128) / 128) * amp;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

const hexRgb = h => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(h || '') || [0, 'd4', 'af', '37']; return [1, 2, 3].map(i => parseInt(m[i], 16)); };
const luma = h => { const [r, g, b] = hexRgb(h); return (r * 0.299 + g * 0.587 + b * 0.114) / 255; };
const hexA = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
// لون الكلام فوق الشريط: غامق لو الشريط فاتح
const bandInk = h => { const [r, g, b] = hexRgb(h); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#141414' : '#ffffff'; };

export function canvasToPng(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}
// لون أغمق (عشان لون التمييز الدهبي يبان على خلفية فاتحة)
function darken(h, k) { return `rgb(${hexRgb(h).map(v => Math.round(v * (1 - k))).join(',')})`; }
