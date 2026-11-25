// 🎨 موشن جرافيك بالذكاء الاصطناعي: الكود اللي الموديل كتبه بيشتغل في iframe معزول (sandbox من غير same-origin،
// ومن غير نت بالـ CSP) — مايقدرش يوصل لمفاتيحك ولا لأي حاجة في البرنامج. بيرسم على OffscreenCanvas ويرجّع صورة لكل إطار.
// المعاينة: آخر صورة جاهزة + طلب الإطار الجاي (async). التصدير: prepare(t) بيستنى الإطار بالظبط قبل الرسم.

const SANDBOX = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
<script>
let fn = null, cv = null, g = null;
const rand = n => { let x = (Math.floor(n) + 1) * 2654435761 >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const clamp = x => Math.max(0, Math.min(1, x));
const ease = { clamp, in: x => clamp(x) ** 2, out: x => 1 - (1 - clamp(x)) ** 2, inOut: x => { x = clamp(x); return x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; }, back: x => { x = clamp(x); const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; } };
onmessage = e => {
  const m = e.data || {};
  if (m.type === 'load') {
    try { fn = new Function('ctx', 'W', 'H', 't', 'info', 'rand', 'ease', '"use strict";' + m.code); parent.postMessage({ type: 'loaded', id: m.id }, '*'); }
    catch (err) { fn = null; parent.postMessage({ type: 'loaded', id: m.id, error: String(err && err.message || err) }, '*'); }
  } else if (m.type === 'frame') {
    try {
      if (!fn) throw new Error('no scene');
      if (!cv || cv.width !== m.W || cv.height !== m.H) { cv = new OffscreenCanvas(m.W, m.H); g = cv.getContext('2d'); }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.filter = 'none';
      g.clearRect(0, 0, m.W, m.H);
      g.save(); fn(g, m.W, m.H, m.t, m.info, rand, ease); g.restore();
      const bmp = cv.transferToImageBitmap();
      parent.postMessage({ type: 'frame', id: m.id, bmp }, '*', [bmp]);
    } catch (err) { parent.postMessage({ type: 'frame', id: m.id, error: String(err && err.message || err) }, '*'); }
  }
};
<\/script>`;

let frame = null, loadedCode = null, seq = 0;
const waiters = new Map();
let last = null;          // { bmp, t, W, H }
let inflight = false, wanted = null;
let segStarts = [], totalDur = 0;
export let lastError = '';
let onReady = null; // المعاينة بتتعاد لما إطار جديد يجهز
export const setOnReady = fn => { onReady = fn; };

function ensureFrame() {
  if (frame && frame.isConnected) return frame;
  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
  frame.srcdoc = SANDBOX;
  document.body.appendChild(frame);
  return frame;
}
addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  const w = waiters.get(m.id);
  if (w) { waiters.delete(m.id); clearTimeout(w.to); w.res(m); }
});
function call(msg, ms = 4000) {
  const f = ensureFrame();
  const id = ++seq;
  return new Promise(res => {
    const to = setTimeout(() => { waiters.delete(id); res({ id, error: 'الإطار خد وقت طويل (الكود تقيل أو فيه لفّة مالهاش آخر)' }); }, ms);
    waiters.set(id, { res, to });
    const send = () => f.contentWindow.postMessage({ ...msg, id }, '*');
    if (f.dataset.ok) send(); else f.addEventListener('load', () => { f.dataset.ok = '1'; send(); }, { once: true });
  });
}

// تحميل كود مشهد — بيرجّع '' لو تمام أو رسالة الغلط
export async function load(code) {
  if (!code) { loadedCode = null; last = null; return 'مفيش كود'; }
  if (code === loadedCode) return lastError;
  last = null;
  const r = await call({ type: 'load', code });
  loadedCode = code;
  lastError = r.error || '';
  return lastError;
}
export const hasScene = () => !!loadedCode && !lastError;

// توقيت الكروت (بدايات الجمل) عشان المشهد يتطور جملة بجملة
export function setTimeline(starts, dur) { segStarts = (starts || []).slice(); totalDur = dur || 0; }
export function infoAt(t, W, H, dur = totalDur) {
  const D = dur || totalDur || 10;
  let seg = 0;
  for (let i = 0; i < segStarts.length; i++) if (segStarts[i] <= t + 1e-6) seg = i;
  const s0 = segStarts[seg] ?? 0, s1 = segStarts[seg + 1] ?? D;
  return { dur: D, p: Math.max(0, Math.min(1, t / D)), seg, segCount: Math.max(1, segStarts.length), segP: Math.max(0, Math.min(1, (t - s0) / Math.max(0.01, s1 - s0))), segStarts: segStarts.slice(), text: { x: W * 0.06, y: H * 0.2, w: W * 0.88, h: H * 0.45 } };
}

// إطار بالظبط (للتصدير والاختبار)
export async function render(t, W, H, dur) {
  if (!hasScene()) return null;
  const r = await call({ type: 'frame', t, W, H, info: infoAt(t, W, H, dur) });
  if (r.error) { lastError = r.error; return null; }
  if (last?.bmp && last.bmp !== r.bmp) last.bmp.close?.();
  last = { bmp: r.bmp, t, W, H };
  return r.bmp;
}
export const prepare = render;

// المعاينة: نرسم آخر صورة جاهزة ونطلب الإطار المطلوب في الخلفية — بيرجّع true لو رسم حاجة
export function draw(ctx, W, H, t) {
  if (!hasScene()) return false;
  const want = Math.max(0, t || 0);
  if (!last || Math.abs(last.t - want) > 1 / 60 || last.W !== W || last.H !== H) request(want, W, H);
  if (!last?.bmp) return false;
  ctx.drawImage(last.bmp, 0, 0, W, H);
  return true;
}
function request(t, W, H) {
  wanted = { t, W, H };
  if (inflight) return;
  inflight = true;
  const go = async () => {
    const w = wanted; wanted = null;
    const changed = !last || Math.abs(last.t - w.t) > 1 / 60 || last.W !== w.W || last.H !== w.H;
    if (changed) await render(w.t, w.W, w.H);
    if (wanted) return go();
    inflight = false;
    if (changed) onReady?.();
  };
  go();
}

// فحص سريع: ٣ إطارات (أول/نص/آخر) — '' لو تمام
export async function selfTest(W = 270, H = 480, dur = 10) {
  for (const t of [0, dur / 2, dur * 0.95]) {
    const b = await render(t, W, H, dur);
    if (!b) return lastError || 'المشهد مارسمش حاجة';
  }
  return '';
}
