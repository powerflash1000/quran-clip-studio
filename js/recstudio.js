// 🎛️ استوديو «اقرا ورا الشيخ» — صفحة لوحدها: تقسيم الآيات على أماكن الوقف، كذا تسجيل take لكل حتة، قص، مؤثرات صوت، تجميع، وإرسال للكارت.
// صوت الشيخ للتعلّم بس — مش بيدخل في الملف. مفيش ذكاء اصطناعي ولا تحويل أصوات: الصوت صوتك أنت، والمؤثرات معالجة صوت عادية (EQ/ضغط/صدى).
import * as Q from './quran.js';
import { findReciter, ayahAudioUrls } from './reciters.js';
import { startRecording, decode, bufferToWavBlob, micError, SILENT_PEAK, silentMsg } from './audio.js';
import { load, save, getSettings, setSettings } from './storage.js';
import * as AL from './audiolib.js';
import * as WT from './words.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => Q.arabicNum(n);
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const status = (t, err) => { const e = $('#rs-status'); e.textContent = t || ''; e.classList.toggle('err', !!err); };

// ===== المؤثرات =====
export const FX_PRESETS = {
  natural: { name: 'طبيعي — تنظيف بس', gate: 0.5, hp: 80, bass: 0, presence: 1, air: 1, deess: 0.3, comp: 0.3, reverb: '', wet: 0, echo: 0, gain: 0 },
  studio: { name: '🎙️ استوديو — واضح ودافي', gate: 0.6, hp: 90, bass: 2, presence: 3, air: 2.5, deess: 0.5, comp: 0.55, reverb: 'room', wet: 0.12, echo: 0, gain: 0 },
  mosque: { name: '🕌 مسجد', gate: 0.6, hp: 90, bass: 2, presence: 2.5, air: 2, deess: 0.5, comp: 0.5, reverb: 'mosque', wet: 0.28, echo: 0, gain: 0 },
  haram: { name: '🕋 قاعة كبيرة — زي الحرم', gate: 0.6, hp: 100, bass: 1.5, presence: 2.5, air: 2.5, deess: 0.5, comp: 0.55, reverb: 'hall', wet: 0.34, echo: 0.15, gain: 0 },
  warm: { name: '☕ دافي وقريب', gate: 0.5, hp: 70, bass: 4, presence: 1, air: 0.5, deess: 0.4, comp: 0.6, reverb: 'room', wet: 0.08, echo: 0, gain: 0 },
  bright: { name: '✨ لامع — للموبايل', gate: 0.6, hp: 120, bass: 0, presence: 4, air: 4, deess: 0.6, comp: 0.6, reverb: 'room', wet: 0.1, echo: 0, gain: 0 },
};
const REVERBS = { '': 'من غير صدى', room: 'غرفة', mosque: 'مسجد 🕌', hall: 'قاعة كبيرة' };
const RV = { room: { decay: 1.0, pre: 0.012 }, mosque: { decay: 3.0, pre: 0.04 }, hall: { decay: 4.6, pre: 0.06 } };
const FX_SLIDERS = [
  ['gate', 'تنظيف الدوشة بين الكلام', 0, 1, 0.05, v => `${Math.round(v * 100)}%`],
  ['hp', 'شيل الطنين التقيل — Hz', 40, 200, 5, v => `${v} Hz`],
  ['bass', 'تقل / دفء الصوت', -6, 8, 0.5, v => `${v > 0 ? '+' : ''}${v} dB`],
  ['presence', 'وضوح الحروف', -4, 8, 0.5, v => `${v > 0 ? '+' : ''}${v} dB`],
  ['air', 'لمعة / هوا', -4, 8, 0.5, v => `${v > 0 ? '+' : ''}${v} dB`],
  ['deess', 'تهدية السين والصاد — De-esser', 0, 1, 0.05, v => `${Math.round(v * 100)}%`],
  ['comp', 'ضغط — يساوي العالي والواطي', 0, 1, 0.05, v => `${Math.round(v * 100)}%`],
  ['wet', 'كمية الصدى', 0, 0.6, 0.02, v => `${Math.round(v * 100)}%`],
  ['echo', 'ترديد — Echo', 0, 0.5, 0.02, v => `${Math.round(v * 100)}%`],
  ['gain', 'علو الصوت النهائي', -6, 6, 0.5, v => `${v > 0 ? '+' : ''}${v} dB`],
];

function impulse(ctx, { decay, pre }) {
  const sr = ctx.sampleRate, len = Math.round((decay + pre) * sr), p = Math.round(pre * sr);
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = p; i < len; i++) { const x = (i - p) / (len - p); d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.4) * Math.exp(-2.5 * x); }
  }
  return ir;
}
function gate(data, sr, amount) {
  if (amount <= 0) return;
  const win = Math.round(0.02 * sr), frames = Math.ceil(data.length / win), rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; const e = Math.min(data.length, (f + 1) * win); for (let i = f * win; i < e; i++) s += data[i] * data[i]; rms[f] = Math.sqrt(s / Math.max(1, e - f * win)); }
  const floor = Float32Array.from(rms).sort()[Math.floor(frames * 0.1)] || 0, open = Math.max(floor * 3, 0.004), low = 1 - 0.85 * amount;
  let g = 1; const att = 1 - Math.exp(-1 / (0.005 * sr)), rel = 1 - Math.exp(-1 / (0.12 * sr));
  for (let i = 0; i < data.length; i++) { const t = rms[Math.floor(i / win)] >= open ? 1 : low; g += (t - g) * (t > g ? att : rel); data[i] *= g; }
}
// المعالجة الكاملة (Offline): تنظيف ← EQ ← De-esser ← ضغط ← صدى/ترديد ← تطبيع + ليميتر
export async function renderFx(buffer, fx) {
  const sr = buffer.sampleRate;
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels; }
  gate(mono, sr, fx.gate);
  const rv = fx.reverb && RV[fx.reverb];
  const tail = (rv ? rv.decay + rv.pre : 0) + (fx.echo > 0 ? 1.2 : 0) + 0.05;
  const ctx = new OfflineAudioContext(2, buffer.length + Math.round(tail * sr), sr);
  const src = ctx.createBufferSource(); const ib = ctx.createBuffer(1, buffer.length, sr); ib.copyToChannel(mono, 0); src.buffer = ib;
  const bq = (type, f, g = 0, q = 0.8) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.gain.value = g; n.Q.value = q; return n; };
  const chain = [bq('highpass', fx.hp, 0, 0.7), bq('lowshelf', 180, fx.bass), bq('peaking', 3200, fx.presence, 0.9), bq('highshelf', 9500, fx.air), bq('peaking', 6800, -10 * fx.deess, 3)];
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12 - 22 * fx.comp; comp.ratio.value = 1.5 + 4.5 * fx.comp; comp.knee.value = 8; comp.attack.value = 0.006; comp.release.value = 0.18;
  let node = src; for (const n of chain) { node.connect(n); node = n; } node.connect(comp);
  const out = ctx.createGain(); out.connect(ctx.destination);
  comp.connect(out); // الصوت الجاف
  if (rv && fx.wet > 0) { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, rv); const w = ctx.createGain(); w.gain.value = fx.wet * 2.2; comp.connect(cv); cv.connect(w); w.connect(out); }
  if (fx.echo > 0) { const d = ctx.createDelay(1); d.delayTime.value = 0.32; const fb = ctx.createGain(); fb.gain.value = 0.35; const w = ctx.createGain(); w.gain.value = fx.echo; const lp = bq('lowpass', 3500); comp.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(w); w.connect(out); }
  src.start();
  const r = await ctx.startRendering();
  // تطبيع لـ −1 dB + ليميتر ناعم + علو نهائي
  let peak = 0; for (let c = 0; c < 2; c++) { const d = r.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const k = (peak > 0 ? 0.89 / peak : 1) * Math.pow(10, fx.gain / 20);
  for (let c = 0; c < 2; c++) { const d = r.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = d[i] * k; d[i] = Math.abs(x) < 0.85 ? x : Math.sign(x) * (0.85 + 0.15 * Math.tanh((Math.abs(x) - 0.85) / 0.15)); } }
  return r;
}

// ===== تقسيم الآيات =====
// كل حتة = آية كاملة، أو لحد علامة وقف جايز (ۖ ۗ ۚ ۛ …) — عشان تقرا بنَفَس مريح
function buildSegs(units, mode, maxWords) {
  const out = [];
  units.forEach((u, ui) => {
    const ws = WT.words(u.text);
    if (mode === 'ayah' || ws.length <= 3) { out.push({ ui, w1: 1, w2: ws.length, text: ws.join(' ') }); return; }
    let start = 0;
    for (let i = 0; i < ws.length; i++) {
      const stop = Q.WAQF_STOP.test(ws[i]) && !Q.WAQF_NO.test(ws[i]);
      const long = maxWords && i - start + 1 >= maxWords && mode === 'long';
      if ((stop || long) && i < ws.length - 1 && ws.length - 1 - i >= 2) { out.push({ ui, w1: start + 1, w2: i + 1, text: ws.slice(start, i + 1).join(' ') }); start = i + 1; }
    }
    out.push({ ui, w1: start + 1, w2: ws.length, text: ws.slice(start).join(' ') });
  });
  return out.map(s => ({ ...s, key: `${units[s.ui].s}:${units[s.ui].a}:${s.w1}-${s.w2}` }));
}

// ===== حفظ التسجيلات (IndexedDB) عشان الريفرش مايضيعهاش =====
const DB = 'qcs-recstudio', ST = 'takes';
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function dbPut(rec) { try { const db = await idb(); const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put(rec); await new Promise(r => { tx.oncomplete = r; tx.onerror = r; }); db.close(); } catch { /* */ } }
async function dbDel(id) { try { const db = await idb(); const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).delete(id); await new Promise(r => { tx.oncomplete = r; tx.onerror = r; }); db.close(); } catch { /* */ } }
async function dbAll(blockId) { try { const db = await idb(); const all = await new Promise(r => { const q = db.transaction(ST).objectStore(ST).getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); }); db.close(); return all.filter(x => x.block === blockId); } catch { return []; } }

// ===== الحالة =====
const S = { block: null, units: [], segs: [], i: 0, takes: {}, fx: { ...FX_PRESETS.studio }, preset: 'studio', rec: null, player: null, ac: null, src: null, mode: 'waqf', gapPiece: 0.12, gapAyah: 0.45 };
const segTakes = () => (S.takes[S.segs[S.i]?.key] ||= []);
const chosen = key => { const L = S.takes[key] || []; return L.find(t => t.star) || L[L.length - 1] || null; };

function stopAll() {
  if (S.player) { S.player.onended = S.player.onerror = null; S.player.pause(); S.player = null; }
  if (S.src) { try { S.src.stop(); } catch { /* */ } S.src = null; }
}
function playBuffer(buf, onEnd) {
  stopAll();
  S.ac ||= new AudioContext();
  const s = S.ac.createBufferSource(); s.buffer = buf; s.connect(S.ac.destination); s.start(); S.src = s;
  s.onended = () => { if (S.src === s) S.src = null; onEnd?.(); };
}
function trimmed(t) { const sr = t.buffer.sampleRate, a = Math.round(t.trim[0] * sr), b = Math.round(t.trim[1] * sr); const o = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: 1, sampleRate: sr }); o.copyToChannel(t.buffer.getChannelData(0).slice(a, b), 0); return o; }
function autoTrim(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, w = Math.round(sr * 0.01); let pk = 0; for (let i = 0; i < d.length; i += 4) pk = Math.max(pk, Math.abs(d[i]));
  const th = Math.max(0.01, pk * 0.06); let a = 0, b = d.length;
  for (let i = 0; i < d.length; i += w) { let m = 0; for (let j = i; j < Math.min(d.length, i + w); j++) m = Math.max(m, Math.abs(d[j])); if (m > th) { a = i; break; } }
  for (let i = d.length - w; i > 0; i -= w) { let m = 0; for (let j = i; j < Math.min(d.length, i + w); j++) m = Math.max(m, Math.abs(d[j])); if (m > th) { b = i + w; break; } }
  return [Math.max(0, a / sr - 0.08), Math.min(buf.duration, b / sr + 0.15)];
}

// ===== صوت الشيخ =====
function listen() {
  if (S.rec) return;
  stopAll();
  const seg = S.segs[S.i], u = S.units[seg.ui];
  const r = findReciter($('#rs-reciter').value);
  const urls = ayahAudioUrls(r, u.s, u.a, Q.globalAyah(u.s, u.a));
  let k = 0;
  const next = () => {
    if (k >= urls.length) { status('⚠️ مقدرتش أشغّل صوت الشيخ — جرّب قارئ تاني من فوق، أو سجّل من غير ما تسمع.', true); return; }
    const p = new Audio(urls[k++]); S.player = p;
    p.playbackRate = Number($('#rs-rate').value) || 1;
    p.onerror = next;
    p.onended = () => { S.player = null; if ($('#rs-loop').checked) listen(); else if ($('#rs-autorec').checked) record(); };
    p.play().catch(next);
  };
  next();
  const part = seg.w1 > 1 || seg.w2 < WT.words(u.text).length;
  status(`🔊 الشيخ بيقرا ${u.s === 1 && u.a === 1 && S.units[0] === u && S.block.surah !== 1 ? 'البسملة' : `الآية ${N(u.a)}`}${part ? ' كاملة — أنت اقرا الحتة المكتوبة بس' : ''}…`);
}

// ===== التسجيل =====
const beep = (f = 880, d = 0.1) => { try { S.ac ||= new AudioContext(); const o = S.ac.createOscillator(), g = S.ac.createGain(); o.frequency.value = f; g.gain.value = 0.12; o.connect(g).connect(S.ac.destination); o.start(); o.stop(S.ac.currentTime + d); } catch { /* */ } };
async function record() {
  if (S.rec) return stopRec();
  stopAll();
  if ($('#rs-count').checked) {
    for (const n of [3, 2, 1]) { status(`⏳ ${N(n)}…`); beep(660); await new Promise(r => setTimeout(r, 650)); }
  }
  try { S.rec = await startRecording(); } catch (e) { status(micError(e), true); return; }
  beep(990, 0.08);
  render();
  const r = S.rec, meter = $('#rs-meter');
  const tick = () => { if (S.rec !== r) { meter.style.width = '0'; return; } const l = r.level(); meter.style.width = `${Math.round(l * 100)}%`; meter.classList.toggle('clip', l > 0.95); status(`🔴 بيسجّل… اقرا الحتة المكتوبة، ولما تخلص دوس «⏹» أو المسافة.${l > 0.95 ? ' ⚠️ الصوت عالي أوي — بعّد عن المايك شوية' : ''}`); requestAnimationFrame(tick); };
  tick();
}
async function stopRec() {
  const r = S.rec; S.rec = null;
  const res = await r.stop();
  if (res.peak < SILENT_PEAK) { status(silentMsg(res.label), true); render(); return; }
  const mono = new AudioBuffer({ length: res.buffer.length, numberOfChannels: 1, sampleRate: res.buffer.sampleRate });
  const d = new Float32Array(res.buffer.length); for (let c = 0; c < res.buffer.numberOfChannels; c++) { const x = res.buffer.getChannelData(c); for (let i = 0; i < x.length; i++) d[i] += x[i] / res.buffer.numberOfChannels; }
  mono.copyToChannel(d, 0);
  const seg = S.segs[S.i];
  const t = { id: `t${Date.now().toString(36)}`, buffer: mono, trim: autoTrim(mono), star: false };
  segTakes().forEach(x => { x.star = false; }); t.star = true; // آخر تسجيل هو المختار (تقدر تغيّره بـ ⭐)
  segTakes().push(t);
  await dbPut({ id: `${S.block.id}|${t.id}`, block: S.block.id, seg: seg.key, tid: t.id, trim: t.trim, star: true, blob: bufferToWavBlob(mono) });
  for (const x of segTakes()) if (x !== t) dbPut({ id: `${S.block.id}|${x.id}`, block: S.block.id, seg: seg.key, tid: x.id, trim: x.trim, star: false, blob: x.blob || (x.blob = bufferToWavBlob(x.buffer)) });
  status(`✅ تسجيل رقم ${N(segTakes().length)} للحتة دي — اسمعه — P، ولو تمام روح للي بعدها ←.`);
  if ($('#rs-autonext').checked && S.i < S.segs.length - 1) { S.i++; render(); if ($('#rs-autolisten').checked) listen(); return; }
  render();
}

// ===== الموجة + القص =====
function drawWave(cv, t) {
  const g = cv.getContext('2d'), W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = 70 * devicePixelRatio;
  const d = t.buffer.getChannelData(0), step = Math.max(1, Math.floor(d.length / W)), dur = t.buffer.duration;
  g.fillStyle = '#10161f'; g.fillRect(0, 0, W, H);
  const xa = t.trim[0] / dur * W, xb = t.trim[1] / dur * W;
  g.fillStyle = 'rgba(80,200,140,.12)'; g.fillRect(xa, 0, xb - xa, H);
  for (let x = 0; x < W; x++) { let m = 0; for (let j = x * step; j < Math.min(d.length, (x + 1) * step); j++) m = Math.max(m, Math.abs(d[j])); const h = m * H * 0.95; g.fillStyle = x >= xa && x <= xb ? '#5fd39b' : '#45506a'; g.fillRect(x, (H - h) / 2, 1, Math.max(1, h)); }
  g.fillStyle = '#ffcf4a'; g.fillRect(xa - 1.5 * devicePixelRatio, 0, 3 * devicePixelRatio, H); g.fillRect(xb - 1.5 * devicePixelRatio, 0, 3 * devicePixelRatio, H);
}
function waveDrag(cv, t) {
  let which = null;
  const at = e => { const r = cv.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * t.buffer.duration; };
  cv.onpointerdown = e => { const x = at(e); which = Math.abs(x - t.trim[0]) < Math.abs(x - t.trim[1]) ? 0 : 1; cv.setPointerCapture(e.pointerId); move(e); };
  const move = e => { if (which == null) return; const x = at(e); t.trim[which] = which === 0 ? Math.min(x, t.trim[1] - 0.2) : Math.max(x, t.trim[0] + 0.2); drawWave(cv, t); cv.nextElementSibling.textContent = `من ${fmt(t.trim[0])} لـ ${fmt(t.trim[1])}`; };
  cv.onpointermove = move;
  cv.onpointerup = () => { if (which == null) return; which = null; const seg = S.segs[S.i]; dbPut({ id: `${S.block.id}|${t.id}`, block: S.block.id, seg: seg.key, tid: t.id, trim: t.trim, star: t.star, blob: t.blob || (t.blob = bufferToWavBlob(t.buffer)) }); };
}

// ===== الواجهة =====
function render() {
  const seg = S.segs[S.i]; if (!seg) return;
  const u = S.units[seg.ui];
  const isBas = S.block.basmala && seg.ui === 0 && u.s === 1 && S.block.surah !== 1;
  $('#rs-where').textContent = `${isBas ? 'البسملة' : `سورة ${Q.surah(u.s).ar} • الآية ${N(u.a)}`} — الحتة ${N(S.i + 1)} من ${N(S.segs.length)}`;
  $('#rs-text').textContent = seg.text;
  $('#rs-rec').textContent = S.rec ? '⏹ خلصت — مسافة' : segTakes().length ? '🔴 سجّل تاني — مسافة' : '🔴 سجّل — مسافة';
  $('#rs-rec').classList.toggle('danger', !!S.rec);
  for (const id of ['#rs-listen', '#rs-prev', '#rs-next', '#rs-play']) $(id).disabled = !!S.rec;
  $('#rs-prev').disabled ||= S.i === 0; $('#rs-next').disabled ||= S.i === S.segs.length - 1; $('#rs-play').disabled ||= !chosen(seg.key);
  // التسجيلات
  const box = $('#rs-takes'); box.innerHTML = '';
  segTakes().forEach((t, k) => {
    const row = document.createElement('div'); row.className = 'rs-take' + (t.star ? ' star' : '');
    row.innerHTML = `<div class="rs-take-head"><b>تسجيل ${N(k + 1)}</b>${t.star ? ' ⭐ المختار' : ''}<span class="grow"></span>
      <button class="btn icon" data-a="play" title="اسمع">▶</button><button class="btn icon" data-a="fx" title="اسمعه بالمؤثرات">🎛️</button>
      <button class="btn icon" data-a="star" title="اختار ده">⭐</button><button class="btn icon" data-a="auto" title="قص السكوت أوتوماتيك">✂️</button>
      <button class="btn icon" data-a="del" title="امسح">🗑</button></div>
      <div dir="ltr"><canvas class="rs-wave"></canvas><small class="muted">من ${fmt(t.trim[0])} لـ ${fmt(t.trim[1])}</small></div>`;
    box.appendChild(row);
    const cv = row.querySelector('canvas'); requestAnimationFrame(() => drawWave(cv, t)); waveDrag(cv, t);
    row.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'play') playBuffer(trimmed(t));
      if (a === 'fx') { status('🎛️ بيجهّز…'); playBuffer(await renderFx(trimmed(t), S.fx)); status('🎛️ ده تسجيلك بالمؤثرات اللي على اليمين.'); }
      if (a === 'star') { segTakes().forEach(x => { x.star = x === t; }); for (const x of segTakes()) dbPut({ id: `${S.block.id}|${x.id}`, block: S.block.id, seg: seg.key, tid: x.id, trim: x.trim, star: x.star, blob: x.blob || (x.blob = bufferToWavBlob(x.buffer)) }); render(); }
      if (a === 'auto') { t.trim = autoTrim(t.buffer); render(); }
      if (a === 'del') { if (!confirm('تمسح التسجيل ده؟')) return; S.takes[seg.key] = segTakes().filter(x => x !== t); if (t.star && segTakes().length) segTakes()[segTakes().length - 1].star = true; dbDel(`${S.block.id}|${t.id}`); render(); }
    };
  });
  if (!segTakes().length) box.innerHTML = '<p class="muted">لسه مفيش تسجيل للحتة دي. اسمع الشيخ — L وبعدين سجّل — مسافة.</p>';
  // شريط الحتت
  const dots = $('#rs-dots'); dots.innerHTML = '';
  S.segs.forEach((s, k) => { const d = document.createElement('button'); d.type = 'button'; d.className = 'fl-dot' + (S.takes[s.key]?.length ? ' ok' : '') + (k === S.i ? ' cur' : ''); d.textContent = N(k + 1); d.title = s.text; d.onclick = () => { if (S.rec) return; S.i = k; render(); }; dots.appendChild(d); });
  const done = S.segs.filter(s => chosen(s.key)).length;
  $('#rs-progress').textContent = `${N(done)} من ${N(S.segs.length)} حتة متسجّلة`;
  $('#rs-apply').disabled = done < S.segs.length || !!S.rec;
  $('#rs-mix').disabled = $('#rs-wav').disabled = !done || !!S.rec;
}

function fxUi() {
  $('#rs-preset').innerHTML = Object.entries(FX_PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('') + '<option value="custom">✏️ مخصّص</option>';
  $('#rs-preset').value = S.preset;
  $('#rs-reverb').innerHTML = Object.entries(REVERBS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#rs-reverb').value = S.fx.reverb;
  const box = $('#rs-sliders'); box.innerHTML = '';
  for (const [k, label, mn, mx, st, f] of FX_SLIDERS) {
    const l = document.createElement('label');
    l.innerHTML = `${label} — <b>${f(S.fx[k])}</b><input type="range" min="${mn}" max="${mx}" step="${st}" value="${S.fx[k]}">`;
    l.querySelector('input').oninput = e => { S.fx[k] = Number(e.target.value); l.querySelector('b').textContent = f(S.fx[k]); S.preset = 'custom'; $('#rs-preset').value = 'custom'; save('recFx', { preset: S.preset, fx: S.fx }); };
    box.appendChild(l);
  }
}

// ===== التجميع =====
async function assemble(withFx) {
  const pieces = S.segs.map(s => ({ s, t: chosen(s.key) })).filter(x => x.t);
  if (!pieces.length) return null;
  const sr = pieces[0].t.buffer.sampleRate, fade = Math.round(0.01 * sr);
  const bufs = pieces.map(x => trimmed(x.t));
  const gaps = pieces.map((x, k) => k === 0 ? 0 : Math.round((x.s.ui !== pieces[k - 1].s.ui ? S.gapAyah : S.gapPiece) * sr));
  const total = bufs.reduce((a, b) => a + b.length, 0) + gaps.reduce((a, b) => a + b, 0);
  const out = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: sr }), d = out.getChannelData(0), marks = [];
  let pos = 0;
  bufs.forEach((b, k) => {
    if (gaps[k]) { if (pieces[k].s.ui !== pieces[k - 1].s.ui) marks.push((pos + gaps[k] / 2) / sr); pos += gaps[k]; }
    const x = b.getChannelData(0);
    for (let i = 0; i < x.length; i++) { const f = i < fade ? i / fade : i > x.length - fade ? (x.length - i) / fade : 1; d[pos + i] = x[i] * f; }
    pos += x.length;
  });
  return { buffer: withFx ? await renderFx(out, S.fx) : out, marks, full: pieces.length === S.segs.length };
}

async function applyToCard() {
  status('⏳ بيجمّع ويطبّق المؤثرات…');
  const m = await assemble(true);
  if (!m?.full) { status('لسه فيه حتت مش متسجّلة.', true); return; }
  const name = $('#rs-name').value.trim(); setSettings({ myName: name });
  const blob = bufferToWavBlob(m.buffer);
  const id = await AL.addClip({ name: 'تلاوتي — الاستوديو', kind: 'record', text: S.units.map(u => u.text).join(' '), voice: `studio:${Date.now()}`, dur: m.buffer.duration, blob });
  if (!id) { status('⚠️ الملف ما اتحفظش على الجهاز — المساحة؟. نزّله WAV وارفعه في الكارت بنفسك.', true); return; }
  const rec = { name: name || 'تلاوتي', file: 'تسجيلي من الاستوديو', own: true, studio: true, start: 0, end: +m.buffer.duration.toFixed(2), marks: m.marks.map(x => +x.toFixed(3)) };
  // نحفظ في الكروت (لو البرنامج مقفول) ونبلّغ البرنامج المفتوح يحدّث الكارت
  const blocks = load('blocks', []); const b = blocks.find(x => x.id === S.block.id);
  if (b) { b.rec = rec; b.audioId = id; save('blocks', blocks); }
  try { new BroadcastChannel('qcs-studio').postMessage({ type: 'applied', id: S.block.id, rec, audioId: id }); } catch { /* */ }
  status(`✅ تلاوتك — ${fmt(m.buffer.duration)} — اتحطت في الكارت — ارجع لتاب البرنامج واسمع المعاينة. صوت الشيخ مش داخل فيها.`);
}

// ===== البداية =====
async function init() {
  await Q.loadQuran();
  const id = new URLSearchParams(location.search).get('b');
  const blocks = load('blocks', []);
  S.block = blocks.find(b => b.id === id && b.type === 'quran') || blocks.find(b => b.type === 'quran');
  if (!S.block) { $('#rs-main').innerHTML = '<p>مفيش كارت آيات — ارجع للبرنامج وضيف آيات الأول، وافتح الاستوديو من «🎧 اقرا ورا الشيخ».</p>'; return; }
  const b = S.block, s = Q.surah(b.surah), from = clamp(b.from, 1, s.count), to = clamp(Math.max(b.to, from), from, s.count);
  if (b.basmala && b.surah !== 1 && b.surah !== 9) S.units.push({ s: 1, a: 1, text: Q.BASMALA });
  for (let a = from; a <= to; a++) S.units.push({ s: b.surah, a, text: Q.ayahText(b.surah, a) });
  $('#rs-title').textContent = `🎛️ استوديو التسجيل — سورة ${s.ar} ${from === to ? `الآية ${N(from)}` : `${N(from)}–${N(to)}`}`;
  const style = load('lastStyle', {}) || {};
  const { RECITERS } = await import('./reciters.js');
  $('#rs-reciter').innerHTML = RECITERS.filter(r => r.everyayah || r.islamic).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  $('#rs-reciter').value = style.reciter && RECITERS.some(r => r.id === style.reciter) ? style.reciter : $('#rs-reciter').value;
  $('#rs-name').value = getSettings().myName || '';
  const fxSaved = load('recFx', null); if (fxSaved?.fx) { S.fx = { ...FX_PRESETS.studio, ...fxSaved.fx }; S.preset = fxSaved.preset || 'custom'; }
  const opt = load('recStudio', {}) || {};
  S.mode = opt.mode || 'waqf'; S.gapPiece = opt.gapPiece ?? 0.12; S.gapAyah = opt.gapAyah ?? 0.45;
  $('#rs-mode').value = S.mode; $('#rs-gp').value = S.gapPiece; $('#rs-ga').value = S.gapAyah;
  for (const k of ['count', 'autonext', 'autolisten', 'autorec', 'loop']) if (opt[k] != null) $('#rs-' + k).checked = opt[k];
  S.segs = buildSegs(S.units, S.mode, 12);
  // التسجيلات القديمة للكارت ده
  for (const r of await dbAll(b.id)) {
    try { const buf = await decode(await r.blob.arrayBuffer()); (S.takes[r.seg] ||= []).push({ id: r.tid, buffer: buf, trim: r.trim, star: r.star, blob: r.blob }); } catch { /* */ }
  }
  for (const L of Object.values(S.takes)) L.sort((x, y) => x.id.localeCompare(y.id));
  const n = Object.values(S.takes).reduce((a, L) => a + L.length, 0);
  fxUi(); render();
  status(n ? `رجعت ${N(n)} تسجيل من المرة اللي فاتت.` : 'ابدأ: «▶️ اسمع الشيخ» — L وبعدين «🔴 سجّل» — مسافة. كل حتة صغيرة لحد علامة وقف — عشان النَّفَس يكفي.');
  wire();
}

function saveOpt() { save('recStudio', { mode: S.mode, gapPiece: S.gapPiece, gapAyah: S.gapAyah, ...Object.fromEntries(['count', 'autonext', 'autolisten', 'autorec', 'loop'].map(k => [k, $('#rs-' + k).checked])) }); }

function wire() {
  $('#rs-listen').onclick = listen;
  $('#rs-rec').onclick = record;
  $('#rs-play').onclick = () => { const t = chosen(S.segs[S.i].key); if (t) playBuffer(trimmed(t)); };
  $('#rs-stop').onclick = () => { stopAll(); status(''); };
  $('#rs-prev').onclick = () => { if (S.rec || !S.i) return; S.i--; stopAll(); render(); };
  $('#rs-next').onclick = () => { if (S.rec || S.i >= S.segs.length - 1) return; S.i++; stopAll(); render(); if ($('#rs-autolisten').checked) listen(); };
  $('#rs-mode').onchange = () => {
    const had = Object.values(S.takes).some(L => L.length);
    if (had && !confirm('تغيير التقسيم بيخلّي التسجيلات اللي اتعملت على التقسيم القديم مش ظاهرة (بتفضل محفوظة لو رجعت له). تكمل؟')) { $('#rs-mode').value = S.mode; return; }
    S.mode = $('#rs-mode').value; S.segs = buildSegs(S.units, S.mode, 12); S.i = 0; saveOpt(); render();
  };
  for (const k of ['count', 'autonext', 'autolisten', 'autorec', 'loop']) $('#rs-' + k).onchange = saveOpt;
  $('#rs-gp').oninput = e => { S.gapPiece = Number(e.target.value); $('#rs-gp-v').textContent = `${S.gapPiece.toFixed(2)} ث`; saveOpt(); };
  $('#rs-ga').oninput = e => { S.gapAyah = Number(e.target.value); $('#rs-ga-v').textContent = `${S.gapAyah.toFixed(2)} ث`; saveOpt(); };
  $('#rs-gp-v').textContent = `${S.gapPiece.toFixed(2)} ث`; $('#rs-ga-v').textContent = `${S.gapAyah.toFixed(2)} ث`;
  $('#rs-preset').onchange = e => { const k = e.target.value; if (FX_PRESETS[k]) { S.fx = { ...FX_PRESETS[k] }; S.preset = k; save('recFx', { preset: k, fx: S.fx }); fxUi(); } };
  $('#rs-reverb').onchange = e => { S.fx.reverb = e.target.value; S.preset = 'custom'; $('#rs-preset').value = 'custom'; save('recFx', { preset: S.preset, fx: S.fx }); };
  $('#rs-mix').onclick = async () => { status('⏳ بيجمّع…'); const m = await assemble($('#rs-mixfx').checked); if (!m) return; playBuffer(m.buffer, () => status('')); status(`🎧 التلاوة كلها — ${fmt(m.buffer.duration)}${m.full ? '' : ' — من غير الحتت اللي لسه مش متسجّلة'}.`); };
  $('#rs-wav').onclick = async () => { status('⏳ بيجهّز الملف…'); const m = await assemble(true); if (!m) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bufferToWavBlob(m.buffer)); a.download = `تلاوتي_${Q.surah(S.block.surah).tr || S.block.surah}.wav`; a.click(); status('✅ الملف نزل — WAV بأعلى جودة.'); };
  $('#rs-apply').onclick = () => applyToCard().catch(e => status('❌ ' + (e.message || e), true));
  document.addEventListener('keydown', e => {
    if (e.target.closest('input[type=text],textarea,select')) return;
    if (e.code === 'Space') { e.preventDefault(); record(); }
    else if (e.key === 'l' || e.key === 'L' || e.key === 'م') listen();
    else if (e.key === 'p' || e.key === 'P' || e.key === 'ح') $('#rs-play').click();
    else if (e.key === 'ArrowLeft') $('#rs-next').click();
    else if (e.key === 'ArrowRight') $('#rs-prev').click();
    else if (e.key === 'Escape') { stopAll(); status(''); }
  });
}

init().catch(e => status('❌ ' + (e.message || e), true));
