// 🖼️ وضع «اللوحة» (للتلفزيون): برواز حوالين الخلفية زي لوحة متعلقة على الحيطة،
// + حركة Ken Burns هادية جدًا، + زخرفة إسلامية خفيفة للخلفيات اللونية.
// كل الحركة هنا «دورية»: بترجع لنقطة البداية بالظبط في آخر الفيديو، فالمقطع يتكرر (Loop) من غير ما يبان القطع.

export const FRAMES = {
  '': 'من غير برواز',
  gold: 'برواز دهبي كلاسيك 🖼️',
  thin: 'خط دهبي رفيع (مودرن)',
  black: 'أسود بحافة دهبي',
  white: 'أبيض (زي المعارض)',
};
export const KEN_BURNS = {
  '': 'ثابتة',
  slow: 'حركة هادية جدًا (للتلفزيون)',
  soft: 'حركة هادية',
};
export const PATTERNS = {
  '': 'من غير زخرفة',
  stars: 'نجوم إسلامية خفيفة ✨',
  lattice: 'شبكة معيّنات خفيفة',
};

const FRAME_W = { gold: 0.03, thin: 0.007, black: 0.024, white: 0.028 };
const KB_AMT = { slow: 0.04, soft: 0.08 };
const KB_PERIOD = 45; // ثانية تقريبًا لكل «نَفَس» (بيتظبط عشان يقسم مدة الفيديو بالظبط)

// مكان البرواز واللوحة اللي جواه (بالبكسل) — null لو مفيش برواز
export function frameGeom(W, H, style) {
  const kind = style?.frame;
  if (!kind || !FRAME_W[kind]) return null;
  const u = Math.min(W, H);
  const m = Math.round(u * 0.045);               // هامش أمان من حافة الشاشة (التلفزيونات بتقص الأطراف أحيانًا)
  const fw = Math.max(2, Math.round(u * FRAME_W[kind]));
  const ox = m, oy = m, ow = W - 2 * m, oh = H - 2 * m;
  return { kind, u, fw, ox, oy, ow, oh, ix: ox + fw, iy: oy + fw, iw: ow - 2 * fw, ih: oh - 2 * fw };
}

// المساحة اللي الصورة/اللون بيترسموا فيها (جوه البرواز أو الشاشة كلها)
export function artRect(W, H, style) {
  const g = frameGeom(W, H, style);
  return g ? { x: g.ix, y: g.iy, w: g.iw, h: g.ih } : { x: 0, y: 0, w: W, h: H };
}

export const kbAmount = style => KB_AMT[style?.kenBurns] || 0;

// clock = { t, dur }: الزوم والتحريك في اللحظة t. الدورة بتقسم المدة بالظبط → أول إطار = بعد آخر إطار
export function kbAt(style, clock) {
  const amt = kbAmount(style);
  if (!amt) return null;
  const t = clock?.t || 0, dur = clock?.dur || 0;
  const P = dur > 0 ? dur / Math.max(1, Math.round(dur / KB_PERIOD)) : KB_PERIOD;
  const ph = 2 * Math.PI * (t / P);
  // الزوم مابيرجعش لـ ١ خالص، فدايمًا فيه مساحة صغيرة للتحريك من غير ما تبان حواف الصورة
  const s = 1 + amt * (0.35 + 0.65 * (1 - Math.cos(ph)) / 2);
  const slack = (1 - 1 / s) / 2;                 // أقصى إزاحة (كنسبة من العرض) قبل ما الحافة تبان
  return { s, dx: slack * 0.6 * Math.cos(ph), dy: slack * 0.45 * Math.sin(ph), max: amt };
}

// ===== الحيطة والبرواز =====

export function drawWall(ctx, W, H, style, g) {
  const wall = style.wall || '#0e0e0e';
  ctx.save();
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
  // نور خفيف في النص زي حيطة عليها سبوت
  const r = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
  r.addColorStop(0, 'rgba(255,255,255,0.06)'); r.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  // ضل البرواز على الحيطة
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = g.u * 0.035; ctx.shadowOffsetY = g.u * 0.012;
  ctx.fillStyle = wall; ctx.fillRect(g.ox, g.oy, g.ow, g.oh);
  ctx.restore();
}

const GOLD = [[0, '#6b4710'], [0.16, '#f7e6a6'], [0.34, '#c8952c'], [0.52, '#fff3c4'], [0.72, '#a9771b'], [1, '#553708']];
const BLACK = [[0, '#050505'], [0.25, '#2c2c2c'], [0.5, '#121212'], [0.8, '#262626'], [1, '#030303']];
const WHITE = [[0, '#cfc9be'], [0.2, '#ffffff'], [0.55, '#f1ede6'], [0.85, '#fbfaf7'], [1, '#bdb6aa']];
const THIN = [[0, '#8a6116'], [0.5, '#f6e2a0'], [1, '#8a6116']];

// ضلع واحد من البرواز (شبه منحرف عشان الزوايا تتقابل مايل زي البراويز الحقيقية) بتدرّج عرضي
function side(ctx, pts, from, to, stops, darken) {
  const gr = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fillStyle = gr; ctx.fill();
  if (darken) { ctx.fillStyle = `rgba(0,0,0,${darken})`; ctx.fill(); }
}

export function drawFrameBorder(ctx, W, H, style, g) {
  const { ox, oy, ow, oh, fw, ix, iy, iw, ih, u } = g;
  const stops = { gold: GOLD, black: BLACK, white: WHITE, thin: THIN }[g.kind];
  ctx.save();
  // ضل جوه اللوحة من البرواز (عمق)
  const sh = u * 0.018;
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, iy, 0, iy + sh, ix, iy, iw, sh);
  edge(ix, 0, ix + sh, 0, ix, iy, sh, ih);
  edge(ix + iw, 0, ix + iw - sh * 0.6, 0, ix + iw - sh * 0.6, iy, sh * 0.6, ih);
  edge(0, iy + ih, 0, iy + ih - sh * 0.6, ix, iy + ih - sh * 0.6, iw, sh * 0.6);
  // الأضلاع الأربعة: النور جاي من فوق شمال، فالتحت واليمين أغمق شوية
  const R = ox + ow, B = oy + oh;
  side(ctx, [[ox, oy], [R, oy], [R - fw, oy + fw], [ox + fw, oy + fw]], [0, oy], [0, oy + fw], stops, 0);
  side(ctx, [[ox, oy], [ox + fw, oy + fw], [ox + fw, B - fw], [ox, B]], [ox, 0], [ox + fw, 0], stops, 0.05);
  side(ctx, [[R, oy], [R, B], [R - fw, B - fw], [R - fw, oy + fw]], [R, 0], [R - fw, 0], stops, 0.16);
  side(ctx, [[ox, B], [R, B], [R - fw, B - fw], [ox + fw, B - fw]], [0, B], [0, B - fw], stops, 0.2);
  // خطوط الزوايا (الوصلات المايلة) والحافة الداخلية والخارجية
  ctx.lineWidth = Math.max(1, u * 0.0012);
  ctx.strokeStyle = g.kind === 'white' ? 'rgba(120,110,95,0.35)' : 'rgba(40,25,0,0.45)';
  ctx.beginPath();
  for (const [a, b] of [[[ox, oy], [ix, iy]], [[R, oy], [ix + iw, iy]], [[ox, B], [ix, iy + ih]], [[R, B], [ix + iw, iy + ih]]]) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  if (g.kind !== 'thin') {
    // حافة دهبي رفيعة جوه (للأسود والأبيض) أو خط نور (للدهبي)
    ctx.lineWidth = Math.max(1.5, u * 0.0035);
    ctx.strokeStyle = g.kind === 'gold' ? 'rgba(255,246,210,0.55)' : '#d6ad4f';
    const k = ctx.lineWidth / 2 + (g.kind === 'gold' ? fw * 0.18 : 0);
    ctx.strokeRect(ix - k, iy - k, iw + 2 * k, ih + 2 * k);
  }
  ctx.restore();
}

// ===== زخرفة إسلامية خفيفة (على الخلفيات اللونية بس) =====
function star(ctx, x, y, r) {
  // نجمة تُمانية = مربعين فوق بعض (واحد مايل ٤٥°)
  for (const rot of [0, Math.PI / 4]) {
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = rot + Math.PI / 4 + k * Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
}

export function drawPattern(ctx, W, H, style) {
  const kind = style?.pattern;
  if (!kind || !PATTERNS[kind] || typeof document === 'undefined') return;
  const u = Math.min(W, H), s = u * 0.11;
  // بنرسمها على طبقة لوحدها، ونمسح النص بالتدريج (عشان الآية تبان) — بيشتغل مع أي ألوان
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.strokeStyle = style.accent || '#c8952c';
  g.lineWidth = Math.max(1, u * 0.0016);
  const cols = Math.ceil(W / s) + 1, rows = Math.ceil(H / s) + 1;
  const x0 = (W - (cols - 1) * s) / 2, y0 = (H - (rows - 1) * s) / 2;
  if (kind === 'stars') {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = x0 + i * s, y = y0 + j * s;
      star(g, x, y, s * 0.36);
      g.beginPath(); g.arc(x, y, s * 0.1, 0, Math.PI * 2); g.stroke();
      // معيّن صغير بين كل ٤ نجوم
      const cx = x + s / 2, cy = y + s / 2, d = s * 0.12;
      g.beginPath(); g.moveTo(cx, cy - d); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d, cy); g.closePath(); g.stroke();
    }
  } else {
    g.beginPath();
    const n = Math.ceil((W + H) / s) + 2;
    for (let k = -n; k <= n; k++) {
      g.moveTo(x0 + k * s, 0); g.lineTo(x0 + k * s + H, H);
      g.moveTo(x0 + k * s, 0); g.lineTo(x0 + k * s - H, H);
    }
    g.stroke();
  }
  g.globalCompositeOperation = 'destination-out';
  const rad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) * 0.5);
  rad.addColorStop(0, 'rgba(0,0,0,0.95)'); rad.addColorStop(0.5, 'rgba(0,0,0,0.6)'); rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad; g.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}
