// 🎨 الهوية والجرافيك: لوجو وعلامة الحساب (حجم/مكان/شفافية)، ألوان سينمائية، إضاءة، مقدمة وخاتمة، انتقالات بين الكروت
// الألوان والمقدمة والانتقالات متاخدة من استوديو الريلز (news-reels-studio) ومتظبطة على محتوى القرآن
// كل الرسم هنا دالة في الوقت t (من غير حالة) — عشان يطلع نفس الشكل في المعاينة والتصدير والبث

export const POSITIONS = {
  bottom: 'تحت في النص', top: 'فوق في النص',
  br: 'تحت يمين', bl: 'تحت شمال', tr: 'فوق يمين', tl: 'فوق شمال',
  custom: 'مكان أختاره (أفقي/رأسي)',
};

// ألوان سينمائية (Color grade) — من الريلز
export const LOOKS = {
  '': 'من غير',
  cinematic: 'سينمائي',
  warm: 'دافي',
  cool: 'بارد',
  golden: 'ذهبي (ساعة الغروب)',
  vintage: 'قديم (فينتدج)',
  vivid: 'ألوان زاهية',
  bw: 'أبيض وأسود',
};
const LOOK_FILTER = {
  cinematic: 'contrast(1.12) saturate(0.85) brightness(0.95)',
  warm: 'sepia(0.22) saturate(1.2) brightness(1.02)',
  cool: 'hue-rotate(-14deg) saturate(0.9) brightness(0.98)',
  golden: 'sepia(0.35) saturate(1.35) brightness(1.04) contrast(1.05)',
  vintage: 'sepia(0.55) contrast(0.92) brightness(0.95) saturate(0.85)',
  vivid: 'saturate(1.4) contrast(1.06)',
  bw: 'grayscale(1) contrast(1.12)',
};
export const lookFilter = look => LOOK_FILTER[look] || 'none';
// نفس الألوان بطبقات تلوين سريعة (بدل ctx.filter اللي بيبطّأ الرسم ٤ مرات مع الفيديو)
const LOOK_LAYERS = {
  cinematic: [['overlay', 'rgba(128,128,128,.22)'], ['soft-light', 'rgba(20,70,90,.35)'], ['saturation', 'rgba(128,128,128,.15)']],
  warm: [['soft-light', 'rgba(255,150,60,.35)']],
  cool: [['soft-light', 'rgba(60,140,255,.35)']],
  golden: [['soft-light', 'rgba(255,170,40,.5)'], ['overlay', 'rgba(255,200,120,.12)']],
  vintage: [['saturation', 'rgba(128,128,128,.45)'], ['soft-light', 'rgba(170,110,40,.45)']],
  vivid: [['overlay', 'rgba(128,128,128,.18)'], ['saturation', 'hsla(0,100%,50%,.18)']],
  bw: [['saturation', 'rgb(128,128,128)'], ['overlay', 'rgba(128,128,128,.15)']],
};
export function lookLayers(ctx, W, H, look) {
  const layers = LOOK_LAYERS[look];
  if (!layers) return;
  ctx.save();
  for (const [op, col] of layers) { ctx.globalCompositeOperation = op; ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
export function lookVignette(ctx, W, H, look) {
  if (!['cinematic', 'vintage', 'golden'].includes(look)) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, look === 'vintage' ? 'rgba(40,25,5,.55)' : look === 'golden' ? 'rgba(60,30,0,.4)' : 'rgba(0,0,0,.5)');
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

// ===== الإضاءة =====
export const LIGHTS = {
  '': 'من غير',
  rays: 'أشعة نور من فوق ☀️',
  leak: 'تسريب نور دافي',
  glow: 'توهّج هادي في النص',
  bokeh: 'أنوار ناعمة (بوكيه)',
  dust: 'ذرات نور طالعة ✨',
  stars: 'نجوم بتلمع 🌙',
};
// رقم شبه عشوائي ثابت (عشان كل إطار يطلع نفس الأماكن)
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hexRgb = h => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(h || '') || [0, 'f4', 'd5', '8d']; return [1, 2, 3].map(i => parseInt(m[i], 16)); };
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;

export function drawLight(ctx, W, H, style, t = 0) {
  const kind = style?.light;
  if (!kind) return;
  const u = Math.min(W, H) / 1080, k = Math.max(0, Math.min(1.5, style.lightAmount ?? 1));
  const acc = style.accent || '#f4d58d';
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  if (kind === 'rays') {
    // أشعة نازلة من فوق: الزاوية من الاتجاه لتحت
    const cx = W * (0.5 + 0.08 * Math.sin(t * 0.15)), cy = -H * 0.06, n = 9, len = Math.hypot(W, H) * 1.15;
    for (let i = 0; i < n; i++) {
      const ang = (i / (n - 1) - 0.5) * 1.25 + 0.05 * Math.sin(t * 0.3 + i);
      const wdt = 0.035 + 0.03 * rnd(i), a = (0.12 + 0.1 * rnd(i + 9)) * (0.7 + 0.3 * Math.sin(t * 0.8 + i * 1.7)) * k;
      const dir = a2 => [cx + Math.sin(a2) * len, cy + Math.cos(a2) * len];
      const [ex, ey] = dir(ang);
      const g = ctx.createLinearGradient(cx, cy, cx + (ex - cx) * 0.75, cy + (ey - cy) * 0.75);
      g.addColorStop(0, `rgba(255,244,214,${a})`); g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      const [x1, y1] = dir(ang - wdt), [x2, y2] = dir(ang + wdt);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
    }
    const top = ctx.createRadialGradient(cx, 0, 0, cx, 0, H * 0.35);
    top.addColorStop(0, `rgba(255,244,214,${0.25 * k})`); top.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, W, H);
  } else if (kind === 'leak') {
    const spots = [['255,150,60', 0.0], ['255,90,120', 2.1], ['255,210,120', 4.2]];
    spots.forEach(([c, ph], i) => {
      const x = W * (0.5 + 0.55 * Math.sin(t * 0.11 + ph)), y = H * (0.3 + 0.45 * Math.cos(t * 0.09 + ph * 1.3));
      const r = Math.max(W, H) * (0.45 + 0.1 * Math.sin(t * 0.2 + i));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},${0.28 * k})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
  } else if (kind === 'glow') {
    const p = 0.75 + 0.25 * Math.sin(t * 0.9), r = Math.min(W, H) * 0.65;
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, r);
    g.addColorStop(0, rgba(acc, 0.32 * p * k)); g.addColorStop(1, rgba(acc, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (kind === 'bokeh') {
    for (let i = 0; i < 16; i++) {
      const x = ((rnd(i) * W + Math.sin(t * 0.07 + i) * 60 * u) % W + W) % W;
      const y = ((rnd(i + 50) * H - t * (6 + 10 * rnd(i + 7)) * u) % H + H) % H;
      const r = (40 + 90 * rnd(i + 3)) * u, a = (0.06 + 0.1 * rnd(i + 5)) * (0.7 + 0.3 * Math.sin(t * 0.6 + i)) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(i % 3 ? acc : '#ffffff', a)); g.addColorStop(0.7, rgba(i % 3 ? acc : '#ffffff', a * 0.6)); g.addColorStop(1, rgba(acc, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'dust' || kind === 'stars') {
    // نقطة نور مرسومة مرة واحدة (sprite) وبنكررها — shadowBlur لكل نقطة كان بيوقّف البرنامج
    const spr = glowSprite();
    const n = kind === 'dust' ? 70 : 90;
    for (let i = 0; i < n; i++) {
      let x = rnd(i) * W, y = rnd(i + 99) * H;
      if (kind === 'dust') { y = ((y - t * (15 + 30 * rnd(i + 3)) * u) % H + H) % H; x += Math.sin(t * 0.5 + i) * 12 * u; } else y *= 0.75;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + 2 * rnd(i + 11)) + i);
      const r = (kind === 'dust' ? 1.5 + 2.5 * rnd(i + 21) : 0.8 + 2 * rnd(i + 21)) * u * 4;
      ctx.globalAlpha = Math.min(1, (0.35 + 0.6 * tw) * k);
      ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

let sprite = null;
function glowSprite() {
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const g = sprite.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,252,240,1)'); gr.addColorStop(0.18, 'rgba(255,248,225,.95)'); gr.addColorStop(0.45, 'rgba(255,240,200,.25)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return sprite;
}

// ===== انتقال بين الكروت (أول ثانية من كل آية/كارت) =====
export const CARD_TRANS = { '': 'من غير', flash: 'ومضة نور ✨', dip: 'غمقان سريع', sweep: 'شعاع نور بيعدّي' };
export const TRANS_SECS = 0.45;
export function drawCardTrans(ctx, W, H, style, age) {
  const kind = style?.cardTrans;
  if (!kind || age == null || age < 0 || age >= TRANS_SECS) return;
  const p = age / TRANS_SECS, a = 1 - p;
  ctx.save();
  if (kind === 'flash') {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.7);
    g.addColorStop(0, `rgba(255,250,235,${0.6 * a})`); g.addColorStop(1, `rgba(255,250,235,${0.15 * a})`);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (kind === 'dip') {
    ctx.fillStyle = `rgba(0,0,0,${0.65 * a})`; ctx.fillRect(0, 0, W, H);
  } else if (kind === 'sweep') {
    const x = -W * 0.4 + W * 1.8 * p, wdt = W * 0.35;
    const g = ctx.createLinearGradient(x - wdt, 0, x + wdt, 0);
    g.addColorStop(0, 'rgba(255,245,220,0)'); g.addColorStop(0.5, `rgba(255,245,220,${0.35 * Math.sin(Math.PI * p)})`); g.addColorStop(1, 'rgba(255,245,220,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// ===== اللوجو =====
const logoCache = new Map();
export function logoImage(data) {
  if (!data) return null;
  let im = logoCache.get(data);
  if (!im) { im = new Image(); im.src = data; logoCache.set(data, im); }
  return im.complete && im.naturalWidth ? im : null;
}
export function ensureLogo(style) {
  if (!style?.logoOn || !style.logoData) return Promise.resolve();
  logoImage(style.logoData);
  const im = logoCache.get(style.logoData);
  if (im.complete) return Promise.resolve();
  return new Promise(r => { im.onload = im.onerror = () => r(); setTimeout(r, 3000); });
}

// مكان عنصر بعرض w وارتفاع h — m = هامش؛ الأماكن في النص بتحترم مكان الأزرار تحت في التطبيقات
function place(pos, w, h, W, H, style, prefix, m) {
  const portrait = H > W;
  if (pos === 'custom') {
    const num = (v, d) => (v === '' || v == null || !Number.isFinite(+v) ? d : +v);
    const x = num(style[prefix + 'X'], 50) / 100, y = num(style[prefix + 'Y'], 90) / 100;
    return { x: Math.max(0, Math.min(W - w, x * W - w / 2)), y: Math.max(0, Math.min(H - h, y * H - h / 2)) };
  }
  const left = m, right = W - m - w, cx = (W - w) / 2;
  const top = H * (portrait ? 0.045 : 0.04), bottom = H * (portrait ? 0.86 : 0.92) - h;
  return {
    top: { x: cx, y: top }, bottom: { x: cx, y: bottom },
    tl: { x: left, y: top }, tr: { x: right, y: top },
    bl: { x: left, y: bottom }, br: { x: right, y: bottom },
  }[pos] || { x: cx, y: bottom };
}

// اللوجو + علامة الحساب (لو في نفس المكان: العلامة تحت اللوجو فوق، وفوقه تحت)
export function drawBrand(ctx, W, H, style, textFontName) {
  const u = Math.min(W, H) / 1080, m = 44 * u;
  const logo = style.logoOn ? logoImage(style.logoData) : null;
  let lb = null;
  ctx.save();
  if (logo) {
    const lw = W * Math.max(0.04, Math.min(0.45, Number(style.logoSize) || 0.14));
    const lh = lw * logo.naturalHeight / logo.naturalWidth;
    const p = place(style.logoPos || 'tr', lw, lh, W, H, style, 'logo', m);
    ctx.globalAlpha = Math.max(0.1, Math.min(1, style.logoOpacity ?? 0.9));
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12 * u;
    ctx.drawImage(logo, p.x, p.y, lw, lh);
    lb = { ...p, w: lw, h: lh, pos: style.logoPos || 'tr' };
  }
  if (style.handle) {
    const hs = Math.round(28 * u * Math.max(0.4, Math.min(3, Number(style.handleSize) || 1)));
    ctx.font = `600 ${hs}px ${textFontName}, sans-serif`;
    ctx.direction = 'ltr'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(style.handle).width, th = hs * 1.3;
    const pos = style.handlePos || 'bottom';
    let p = place(pos, tw, th, W, H, style, 'handle', m);
    if (lb && lb.pos === pos && pos !== 'custom') {
      const isTop = pos === 'top' || pos.startsWith('t');
      const ax = pos.endsWith('l') ? lb.x : pos.endsWith('r') ? lb.x + lb.w - tw : lb.x + (lb.w - tw) / 2;
      p = { x: ax, y: isTop ? lb.y + lb.h + 8 * u : lb.y - th - 8 * u };
    }
    ctx.globalAlpha = Math.max(0.1, Math.min(1, style.handleOpacity ?? 0.6));
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8 * u;
    ctx.fillStyle = style.textColor || '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(style.handle, p.x, p.y + th / 2);
  }
  ctx.restore();
}

// ===== مقدمة وخاتمة (Bumper) — زي الريلز: لوجو + اسم القناة + خط بلون التمييز + الحساب، بحركة دخول ناعمة =====
export const BUMPERS = { '': 'من غير', intro: 'مقدمة بس', outro: 'خاتمة بس', both: 'مقدمة وخاتمة' };
const easeOut = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
export function drawBumper(ctx, W, H, seg, style, textFontName) {
  const u = Math.min(W, H) / 1080, age = seg.age ?? 1, dur = seg.silence || 2.5;
  const a = easeOut(age / 0.6), out = Math.min(1, Math.max(0, (dur - age) / 0.35));
  const col = style.accent || '#f4d58d';
  const cx = W / 2, cy = H * 0.43;
  ctx.save();
  ctx.globalAlpha = a * (seg.age == null ? 1 : out);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
  g.addColorStop(0, rgba(col, 0.38)); g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let y = cy;
  const logo = style.logoOn ? logoImage(style.logoData) : null;
  if (logo) {
    const s = 0.86 + 0.14 * a, lw = Math.min(W * 0.36, 380 * u) * s, lh = lw * logo.naturalHeight / logo.naturalWidth;
    ctx.drawImage(logo, cx - lw / 2, cy - lh * 0.75, lw, lh);
    y = cy + lh * 0.25 + 80 * u;
  }
  const main = seg.text || '';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  let size = 96 * u;
  ctx.font = `800 ${size}px ${textFontName}`;
  while (ctx.measureText(main).width > W - 160 * u && size > 36 * u) { size -= 4 * u; ctx.font = `800 ${size}px ${textFontName}`; }
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 20 * u;
  ctx.fillStyle = '#fff';
  ctx.fillText(main, cx, y + (1 - a) * 30 * u);
  ctx.shadowBlur = 0;
  const lw = Math.min(W * 0.5, 520 * u) * a;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.roundRect(cx - lw / 2, y + size * 0.75, lw, 10 * u, 5 * u); ctx.fill();
  if (seg.sub) {
    ctx.font = `600 ${Math.round(46 * u)}px ${textFontName}`;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(seg.sub, cx, y + size * 0.75 + 70 * u);
  }
  if (style.handle) {
    ctx.font = `700 ${Math.round(44 * u)}px ${textFontName}, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.direction = 'ltr';
    ctx.fillText(style.handle, cx, y + size * 0.75 + (seg.sub ? 140 : 70) * u);
  }
  ctx.restore();
}
