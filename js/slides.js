import { lookFilter, lookVignette, drawBrand, drawBumper, drawCardTrans } from './brand.js';

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
export function drawBackground(ctx, W, H, style, media) {
  ctx.save();
  // لون سينمائي (من الريلز) على الخلفية بس، مش على الكلام
  if (style?.look) ctx.filter = lookFilter(style.look);
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
  ctx.filter = 'none';
  if (style?.look) lookVignette(ctx, W, H, style.look);
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

// ===== طبقة النص (شفافة، بتتحط فوق الخلفية) =====
// seg: { kind: 'ayah'|'basmala'|'hadith'|'title', text, sub, label, footer, gradeLabel }
export function drawOverlay(ctx, W, H, seg, style) {
  ctx.save();
  const TF = textFont(style);
  if (style.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${style.dim})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (!seg) { ctx.restore(); return; }
  // مقدمة / خاتمة القناة
  if (seg.kind === 'bumper') { drawBumper(ctx, W, H, seg, style, TF); ctx.restore(); return; }
  // انتقال بين الكروت (ومضة نور / غمقان / شعاع) في أول لحظة من كل كارت
  if (seg.age != null) drawCardTrans(ctx, W, H, style, seg.age);

  const portrait = H > W;
  const unit = Math.min(W, H) / 1080;          // مقياس عام
  const padX = W * (portrait ? 0.08 : 0.1);
  const top = H * (portrait ? 0.12 : 0.1);
  const bottom = H * (portrait ? 0.78 : 0.86);   // بنسيب مكان تحت لأزرار التطبيقات
  const boxW = W - padX * 2;

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18 * unit;
  ctx.shadowOffsetY = 3 * unit;

  // العنوان فوق (اسم السورة ورقم الآية)
  if (style.showLabel && seg.label) {
    ctx.fillStyle = style.accent;
    ctx.font = `bold ${Math.round(40 * unit * style.labelScale)}px ${TF}`;
    drawLines(ctx, [seg.label], W / 2, top - 40 * unit, 40 * unit * style.labelScale, 1.2, 'rtl');
  }
  // رقم الجزء في السلسلة (مثلًا: الجزء ٣ من ١٢)
  if (seg.badge) {
    ctx.fillStyle = style.subColor;
    const bs = Math.round(30 * unit * style.labelScale);
    ctx.font = `${bs}px ${TF}`;
    drawLines(ctx, [seg.badge], W / 2, top - 40 * unit - 62 * unit * style.labelScale, bs, 1.2, 'rtl');
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
  const words = !grp && seg.wordCount != null && style.wordMode && style.wordMode !== 'full';
  // مع «الآيات كلها مرة واحدة» الحركة بتحصل مرة واحدة بس في أول آية
  const anim = !words && !(grp && grp.idx > 0) && style.textAnim && seg.age != null && seg.age < ENTER_SECS ? ease(seg.age / ENTER_SECS) : null;
  ctx.save();
  if (anim != null) {
    const cy = y + total / 2;
    ctx.globalAlpha = anim;
    if (style.textAnim === 'rise') ctx.translate(0, (1 - anim) * 60 * unit);
    if (style.textAnim === 'zoom') { const k = 0.9 + 0.1 * anim; ctx.translate(W / 2, cy); ctx.scale(k, k); ctx.translate(-W / 2, -cy); }
    if (style.textAnim === 'blur') ctx.filter = `blur(${((1 - anim) * 14 * unit).toFixed(1)}px)`;
  }
  // كارت أو شريط ورا النص
  const fx = style.textFx || '';
  if (fx === 'card' || fx === 'band') {
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
    if (grp) drawGroup(ctx, main.lines, W / 2, y, main.size, lineH, grp, style);
    else if (words) drawWords(ctx, main.lines, W / 2, y, main.size, lineH, seg.wordCount, style.wordMode, style);
    else drawLines(ctx, main.lines, W / 2, y, main.size, lineH, 'rtl');
  } finally { PAINT = null; }
  y += main.height + gapMS;
  ctx.restore();
  ctx.save();
  if (anim != null) { ctx.globalAlpha = anim; if (style.textAnim === 'rise') ctx.translate(0, (1 - anim) * 60 * unit); }

  if (sub) {
    ctx.fillStyle = style.subColor;
    ctx.font = `${sub.size}px ${TF}, sans-serif`;
    drawLines(ctx, sub.lines, W / 2, y, sub.size, 1.45, sub.dir);
  }
  ctx.restore();

  // تحت: اسم القارئ أو مصدر الحديث ودرجته
  if (style.showFooter && seg.footer) {
    ctx.fillStyle = style.accent;
    const fs = Math.round(32 * unit * style.labelScale);
    ctx.font = `${fs}px ${TF}`;
    drawLines(ctx, [seg.footer], W / 2, bottom + 30 * unit, fs, 1.3, 'rtl');
  }
  // اللوجو وعلامة الحساب (@اسم_حسابك) — الحجم والمكان والشفافية من «🎨 الهوية والجرافيك»
  drawBrand(ctx, W, H, style, TF);
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
const hexA = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
// لون الكلام فوق الشريط: غامق لو الشريط فاتح
const bandInk = h => { const [r, g, b] = hexRgb(h); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#141414' : '#ffffff'; };

export function canvasToPng(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}
