// رسم الشرائح (النص فوق الخلفية) على Canvas.
// نفس الدوال بتتستخدم في المعاينة وفي تصدير الفيديو والصور.

export const ASPECTS = {
  '9:16': { w: 1080, h: 1920, name: 'رأسي 9:16 (ريلز / تيك توك / شورتس)' },
  '1:1': { w: 1080, h: 1080, name: 'مربع 1:1' },
  '16:9': { w: 1920, h: 1080, name: 'أفقي 16:9 (يوتيوب)' },
};

export const QURAN_FONT = 'UthmanicHafs';
export const TEXT_FONT = 'Amiri';

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load(`64px ${QURAN_FONT}`, 'بِسۡمِ'),
    document.fonts.load(`64px ${TEXT_FONT}`, 'حديث'),
    document.fonts.load(`bold 64px ${TEXT_FONT}`, 'حديث'),
  ]);
}

// ===== الخلفية =====
// media: { kind: 'image', el: HTMLImageElement } أو { kind: 'video', el: HTMLVideoElement }
export function drawBackground(ctx, W, H, style, media) {
  ctx.save();
  if (media && (media.kind === 'image' || media.kind === 'video')) {
    const el = media.el;
    const iw = el.naturalWidth || el.videoWidth;
    const ih = el.naturalHeight || el.videoHeight;
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
    const widths = words.map(w => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
    let x = cx + total / 2;
    const yy = y + size * lineH * (li + 0.5);
    words.forEach((w, k) => {
      if (idx < shown) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = mode === 'highlight' && idx === shown - 1 ? style.accent : style.textColor;
        ctx.fillText(w, x, yy);
      } else if (mode === 'highlight') {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = style.textColor;
        ctx.fillText(w, x, yy);
      }
      x -= widths[k] + space;
      idx++;
    });
  });
  ctx.globalAlpha = 1;
}

function drawLines(ctx, lines, x, y, size, lineH, dir) {
  ctx.direction = dir;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, y + size * lineH * (i + 0.5)));
}

// ===== طبقة النص (شفافة، بتتحط فوق الخلفية) =====
// seg: { kind: 'ayah'|'basmala'|'hadith'|'title', text, sub, label, footer, gradeLabel }
export function drawOverlay(ctx, W, H, seg, style) {
  ctx.save();
  if (style.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${style.dim})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (!seg) { ctx.restore(); return; }

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
    ctx.font = `bold ${Math.round(40 * unit * style.labelScale)}px ${TEXT_FONT}`;
    drawLines(ctx, [seg.label], W / 2, top - 40 * unit, 40 * unit * style.labelScale, 1.2, 'rtl');
  }
  // رقم الجزء في السلسلة (مثلًا: الجزء ٣ من ١٢)
  if (seg.badge) {
    ctx.fillStyle = style.subColor;
    const bs = Math.round(30 * unit * style.labelScale);
    ctx.font = `${bs}px ${TEXT_FONT}`;
    drawLines(ctx, [seg.badge], W / 2, top - 40 * unit - 62 * unit * style.labelScale, bs, 1.2, 'rtl');
  }

  const isQuran = seg.kind === 'ayah' || seg.kind === 'basmala';
  const mainFont = s => isQuran ? `${s}px ${QURAN_FONT}` : `${s}px ${TEXT_FONT}`;
  const lineH = isQuran ? 1.75 : 1.6;
  const hasSub = style.showTranslation && seg.sub;
  const subShare = hasSub ? 0.32 : 0;
  const area = bottom - top;

  const main = fit(ctx, seg.text, mainFont, Math.round(style.textSize * unit * (isQuran ? 1 : 0.8)),
    Math.round(22 * unit), boxW, area * (1 - subShare) - 30 * unit, lineH);

  let sub = null;
  const subSize = Math.round(style.textSize * unit * 0.42);
  if (hasSub) {
    const subDir = /[؀-ۿ]/.test(seg.sub) ? 'rtl' : 'ltr';
    ctx.direction = subDir;
    sub = fit(ctx, seg.sub, s => `${s}px ${TEXT_FONT}, sans-serif`, subSize, Math.round(18 * unit),
      boxW, area * subShare, 1.45);
    sub.dir = subDir;
  }

  const gapMS = hasSub ? 36 * unit : 0;
  const total = main.height + gapMS + (sub ? sub.height : 0);
  let y = top + (area - total) / 2;

  ctx.fillStyle = style.textColor;
  ctx.font = mainFont(main.size);
  if (seg.wordCount != null && style.wordMode && style.wordMode !== 'full') {
    drawWords(ctx, main.lines, W / 2, y, main.size, lineH, seg.wordCount, style.wordMode, style);
  } else {
    drawLines(ctx, main.lines, W / 2, y, main.size, lineH, 'rtl');
  }
  y += main.height + gapMS;

  if (sub) {
    ctx.fillStyle = style.subColor;
    ctx.font = `${sub.size}px ${TEXT_FONT}, sans-serif`;
    drawLines(ctx, sub.lines, W / 2, y, sub.size, 1.45, sub.dir);
  }

  // تحت: اسم القارئ أو مصدر الحديث ودرجته
  if (style.showFooter && seg.footer) {
    ctx.fillStyle = style.accent;
    const fs = Math.round(32 * unit * style.labelScale);
    ctx.font = `${fs}px ${TEXT_FONT}`;
    drawLines(ctx, [seg.footer], W / 2, bottom + 30 * unit, fs, 1.3, 'rtl');
  }
  // علامة الحساب (@اسم_حسابك) — خفيفة وظاهرة في كل الفيديو
  if (style.handle) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = style.textColor;
    const hs = Math.round(28 * unit);
    ctx.font = `${hs}px ${TEXT_FONT}, sans-serif`;
    const y = style.handlePos === 'top' ? top - 40 * unit - 130 * unit : bottom + 90 * unit;
    drawLines(ctx, [style.handle], W / 2, y, hs, 1.2, 'ltr');
    ctx.globalAlpha = 1;
  }
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

export function canvasToPng(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}
