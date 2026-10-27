// 🎛️ غرفة التحكم في البث: مؤثرات وطبقات بتترسم فوق شاشة البث وانت بتبث
// كله رسم على الـ canvas (من غير مكتبات تقيلة)، ماعدا Lottie وكود QR بيتحمّلوا وقت الحاجة بس
import { TEXT_FONT } from './slides.js';

// ===== تحميل سكريبت كلاسيكي مرة واحدة =====
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { loaded.delete(src); rej(new Error('تعذر تحميل ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

// ===== مؤثرات الجزيئات =====
export const PARTICLES = {
  none: 'من غير',
  dust: '✨ غبار ذهبي',
  stars: '⭐ نجوم بتلمع',
  bokeh: '🔆 نور ناعم',
  snow: '❄️ ثلج',
  rain: '🌧️ مطر',
  petals: '🌸 ورد بيقع',
};
const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor() { this.type = 'none'; this.items = []; this.W = 0; this.H = 0; this.last = 0; }
  set(type, density = 1) {
    if (type === this.type && density === this.density) return;
    this.type = type; this.density = density; this.items = [];
  }
  spawn(W, H, init) {
    const t = this.type, u = Math.min(W, H) / 1080;
    const p = { x: rnd(0, W), y: init ? rnd(0, H) : -20 * u, life: 0 };
    if (t === 'dust') Object.assign(p, { y: init ? rnd(0, H) : H + 10, r: rnd(1.5, 4) * u, vx: rnd(-8, 8) * u, vy: rnd(-25, -8) * u, a: rnd(0.3, 0.9), tw: rnd(0, 6) });
    if (t === 'stars') Object.assign(p, { y: rnd(0, H * 0.7), r: rnd(1, 3) * u, vx: 0, vy: 0, a: rnd(0.3, 1), tw: rnd(0, 6), sp: rnd(1, 3) });
    if (t === 'bokeh') Object.assign(p, { y: rnd(0, H), r: rnd(30, 110) * u, vx: rnd(-6, 6) * u, vy: rnd(-6, 6) * u, a: rnd(0.05, 0.16), hue: rnd(30, 50) });
    if (t === 'snow') Object.assign(p, { r: rnd(2, 6) * u, vx: rnd(-15, 15) * u, vy: rnd(30, 80) * u, a: rnd(0.5, 0.95), tw: rnd(0, 6) });
    if (t === 'rain') Object.assign(p, { r: rnd(18, 34) * u, vx: -60 * u, vy: rnd(900, 1300) * u, a: rnd(0.2, 0.45) });
    if (t === 'petals') Object.assign(p, { r: rnd(6, 12) * u, vx: rnd(-30, 30) * u, vy: rnd(40, 90) * u, a: rnd(0.6, 0.95), rot: rnd(0, 6), vr: rnd(-2, 2), tw: rnd(0, 6) });
    return p;
  }
  draw(g, W, H, now) {
    if (this.type === 'none') return;
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    const base = { dust: 70, stars: 90, bokeh: 14, snow: 120, rain: 160, petals: 35 }[this.type] || 60;
    const want = Math.round(base * (this.density || 1) * (W * H) / (1920 * 1080));
    if (this.W !== W || this.H !== H) { this.items = []; this.W = W; this.H = H; }
    while (this.items.length < want) this.items.push(this.spawn(W, H, this.items.length < want * 0.9 && !this.started));
    this.started = true;
    if (this.items.length > want) this.items.length = want;
    g.save();
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const off = p.y > H + 60 || p.y < -60 * 4 || p.x < -150 || p.x > W + 150;
      if (off && this.type !== 'stars' && this.type !== 'bokeh') { this.items[i] = this.spawn(W, H, false); continue; }
      if (this.type === 'bokeh' && (p.x < -p.r || p.x > W + p.r || p.y < -p.r || p.y > H + p.r)) { p.vx *= -1; p.vy *= -1; }
      const tw = p.tw != null ? 0.55 + 0.45 * Math.sin(now / 1000 * (p.sp || 1.5) + p.tw) : 1;
      if (this.type === 'rain') {
        g.strokeStyle = `rgba(200,220,255,${p.a})`; g.lineWidth = Math.max(1, p.r / 18);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.vx * 0.03, p.y + p.r); g.stroke();
      } else if (this.type === 'bokeh') {
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        gr.addColorStop(0, `hsla(${p.hue},90%,75%,${p.a})`); gr.addColorStop(1, `hsla(${p.hue},90%,75%,0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      } else if (this.type === 'petals') {
        p.rot += p.vr * dt; p.x += Math.sin(now / 700 + p.tw) * 20 * dt;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = p.a;
        g.fillStyle = '#f7b7c8'; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.restore();
      } else {
        const color = this.type === 'dust' ? '255,215,140' : '255,255,255';
        if (this.type === 'snow') p.x += Math.sin(now / 900 + p.tw) * 12 * dt;
        g.fillStyle = `rgba(${color},${p.a * tw})`;
        if (this.type === 'dust' || this.type === 'stars') { g.shadowColor = `rgba(${color},0.9)`; g.shadowBlur = p.r * 4; }
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }
    }
    g.restore();
  }
}

// ===== زووم بطيء على الخلفية (Ken Burns) =====
export function kenBurns(g, W, H, t, draw) {
  const cyc = 24, k = (t % cyc) / cyc, s = 1 + 0.08 * (k < 0.5 ? k * 2 : (1 - k) * 2);
  g.save();
  g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-W / 2, -H / 2);
  draw();
  g.restore();
}

// ===== أدوات رسم =====
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function fitText(g, text, maxW, size, weight = 700) {
  let s = size;
  do { g.font = `${weight} ${Math.round(s)}px ${TEXT_FONT}`; s *= 0.94; } while (g.measureText(text).width > maxW && s > 10);
}

// ===== الشريط السفلي (Lower third) =====
// st = { on, title, sub, since } — بيدخل بحركة لما يتشغّل
export function drawLowerThird(g, W, H, st, accent, now) {
  if (!st?.on || !st.title) return;
  const u = Math.min(W, H) / 1080, k = ease((now - (st.since || 0)) / 600);
  const portrait = H > W;
  const w = W * (portrait ? 0.84 : 0.42), h = (st.sub ? 150 : 104) * u;
  const x = W - 48 * u - w + (1 - k) * (w + 60 * u), y = H * (portrait ? 0.7 : 0.74);
  g.save();
  g.globalAlpha = k;
  g.fillStyle = 'rgba(8,12,20,0.72)'; roundRect(g, x, y, w, h, 16 * u); g.fill();
  g.fillStyle = accent; g.fillRect(x + w - 10 * u, y + 14 * u, 6 * u, h - 28 * u);
  g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  fitText(g, st.title, w - 70 * u, 46 * u);
  g.fillText(st.title, x + w - 34 * u, st.sub ? y + 52 * u : y + h / 2);
  if (st.sub) { g.fillStyle = accent; fitText(g, st.sub, w - 70 * u, 34 * u, 500); g.fillText(st.sub, x + w - 34 * u, y + 108 * u); }
  g.restore();
}

// ===== شريط الأخبار المتحرك (Ticker) =====
export function drawTicker(g, W, H, st, accent, now) {
  if (!st?.on || !st.text) return;
  const u = Math.min(W, H) / 1080, h = 64 * u, y = st.top ? 0 : H - h;
  g.save();
  g.fillStyle = 'rgba(8,12,20,0.78)'; g.fillRect(0, y, W, h);
  g.fillStyle = accent; g.fillRect(0, st.top ? y + h - 4 * u : y, W, 4 * u);
  g.font = `600 ${Math.round(34 * u)}px ${TEXT_FONT}`;
  g.direction = 'rtl'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
  const text = st.text.replace(/\s+/g, ' ') + '   ✦   ';
  const tw = g.measureText(text).width;
  const speed = (st.speed || 1) * 90 * u;
  // العربي بيدخل من الشمال ويمشي يمين
  let x = ((now / 1000) * speed) % tw - tw;
  for (; x < W; x += tw) g.fillText(text, x, y + h / 2 + 2 * u);
  g.restore();
}

// ===== الساعة + الأذان الجاي =====
export function drawClock(g, W, H, st, accent, now, prayer, dy = 0) {
  if (!st?.on && !prayer) return 0;
  const u = Math.min(W, H) / 1080;
  const lines = [];
  if (st?.on) lines.push(new Date(now).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: st.tz || undefined }));
  if (prayer) lines.push(prayer);
  g.save();
  g.font = `600 ${Math.round(30 * u)}px ${TEXT_FONT}`;
  const w = Math.max(...lines.map(l => g.measureText(l).width)) + 40 * u, h = (lines.length * 42 + 18) * u;
  const x = 28 * u, y = 28 * u + dy;
  g.fillStyle = 'rgba(8,12,20,0.6)'; roundRect(g, x, y, w, h, 14 * u); g.fill();
  g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.fillStyle = i ? accent : '#fff'; g.fillText(l, x + w / 2, y + (30 + i * 42) * u); });
  g.restore();
  return h + 12 * u; // الارتفاع اللي اتشغل (عشان اللي تحته)
}

// ===== صورة (لوجو أو QR أو ملصق) في ركن — off = { t, b } مسافة زيادة فوق/تحت عشان ماتركبش على طبقة تانية =====
export function cornerRect(W, H, iw, ih, pos, size, off = {}) {
  const u = Math.min(W, H), s = u * size, m = u * 0.03, k = s / Math.max(iw, ih);
  const w = iw * k, h = ih * k;
  if (pos === 'c') return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  const x = pos.includes('l') ? m : W - m - w;
  const y = pos.includes('t') ? m + (off.t || 0) : H - m - h - (off.b || 0);
  return { x, y, w, h };
}
export function drawCornerImage(g, W, H, img, pos = 'tr', size = 0.12, alpha = 0.9, off = {}) {
  if (!img || !(img.naturalWidth || img.width)) return;
  const r = cornerRect(W, H, img.naturalWidth || img.width, img.naturalHeight || img.height, pos, size, off);
  g.save(); g.globalAlpha = alpha; g.drawImage(img, r.x, r.y, r.w, r.h); g.restore();
}

// ===== كود QR =====
export async function qrCanvas(text, px = 360) {
  await loadScript('vendor/qrcode/qrcode.js');
  const qr = window.qrcode(0, 'M');
  qr.addData(unescape(encodeURIComponent(text))); // UTF-8 للينكات العربي
  qr.make();
  const n = qr.getModuleCount(), cell = Math.floor(px / (n + 4)), c = document.createElement('canvas');
  c.width = c.height = cell * (n + 4);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect((col + 2) * cell, (r + 2) * cell, cell, cell);
  return c;
}

// ===== كارت «اعرض دلوقتي» (إعلان أو دعاء على الشاشة كلها) =====
export function drawCard(g, W, H, card, style, now) {
  if (!card || now > card.until) return;
  const fadeIn = ease((now - card.since) / 500), fadeOut = ease((card.until - now) / 500);
  const a = Math.min(fadeIn, fadeOut), u = Math.min(W, H) / 1080;
  g.save();
  g.globalAlpha = a;
  g.fillStyle = 'rgba(5,8,14,0.82)'; g.fillRect(0, 0, W, H);
  g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = style.accent || '#f4d58d';
  g.font = `700 ${Math.round(44 * u)}px ${TEXT_FONT}`;
  if (card.title) g.fillText(card.title, W / 2, H * 0.3);
  g.fillStyle = '#fff';
  const size = Math.round(Math.min(78, Math.max(40, 2400 / Math.max(20, card.text.length))) * u);
  g.font = `700 ${size}px ${TEXT_FONT}`;
  const words = card.text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > W * 0.82 && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  const lh = size * 1.5, top = H / 2 - (lines.length - 1) * lh / 2 + (card.title ? 30 * u : 0);
  lines.forEach((l, i) => g.fillText(l, W / 2, top + i * lh));
  g.restore();
}

// ===== Lottie (ملصقات وعناوين متحركة من LottieFiles) =====
// بيرسم على canvas صغير لوحده، وبعدين بنحطه في المكان المطلوب
export async function lottieSticker(json) {
  await loadScript('vendor/lottie/lottie_light_canvas.min.js');
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const c = document.createElement('canvas');
  c.width = data.w || 512; c.height = data.h || 512;
  const anim = window.lottie.loadAnimation({ renderer: 'canvas', loop: true, autoplay: false, animationData: data, rendererSettings: { context: c.getContext('2d'), clearCanvas: true } });
  const fr = data.fr || 30, total = (data.op || 60) - (data.ip || 0);
  return {
    canvas: c,
    frameAt: t => { anim.goToAndStop(((t * fr) % total), true); return c; },
    destroy: () => anim.destroy(),
  };
}

// ===== مواقيت الصلاة (AlAdhan — مجاني) =====
const PRAYERS = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
let prayerCache = null;
export async function loadPrayer(city = 'Makkah', country = 'SA') {
  const key = `${city}|${country}|${new Date().toDateString()}`;
  if (prayerCache?.key === key) return prayerCache;
  const r = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=4`);
  const j = await r.json();
  if (!r.ok || !j.data) throw new Error('تعذر جلب مواقيت الصلاة');
  prayerCache = { key, timings: j.data.timings, tz: j.data.meta?.timezone || 'Asia/Riyadh', cityName: city };
  return prayerCache;
}
// «أذان المغرب بعد ١٢ د» بتوقيت المدينة
export function nextPrayerText(pc, now = Date.now()) {
  if (!pc) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: pc.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const cur = (+parts.hour % 24) * 60 + +parts.minute + +parts.second / 60;
  let best = null;
  for (const [k, name] of Object.entries(PRAYERS)) {
    const [h, m] = String(pc.timings[k] || '').split(':').map(Number);
    if (Number.isNaN(h)) continue;
    let d = h * 60 + m - cur;
    if (d < 0) d += 1440;
    if (!best || d < best.d) best = { d, name };
  }
  if (!best) return '';
  const h = Math.floor(best.d / 60), m = Math.ceil(best.d % 60);
  const ar = n => String(n).replace(/\d/g, x => '٠١٢٣٤٥٦٧٨٩'[x]);
  return `🕌 أذان ${best.name} بعد ${h ? `${ar(h)} س ` : ''}${ar(m)} د`;
}
