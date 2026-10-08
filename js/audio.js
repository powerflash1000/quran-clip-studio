import { fetchFirst } from './net.js';

export const SAMPLE_RATE = 44100;

const decodeCtx = () => new OfflineAudioContext(2, 1, SAMPLE_RATE);

export async function decode(arrayBuffer) {
  // decodeAudioData بياخد ownership للـ buffer، فبنبعت نسخة
  return decodeCtx().decodeAudioData(arrayBuffer.slice(0));
}

const audioCache = new Map();

// تحميل وفك ملف صوت من أول رابط ينجح (مع كاش)
export function loadAudio(urls) {
  const key = urls[0];
  if (!audioCache.has(key)) {
    audioCache.set(key, fetchFirst(urls).then(decode).catch(e => { audioCache.delete(key); throw e; }));
  }
  return audioCache.get(key);
}

// يبني الشريط الصوتي الكامل من المقاطع.
// segments: [{ audio: AudioBuffer|null, silence: ثواني لو مفيش صوت, ... }]
// يرجع { left, right, duration } ويضيف start/end لكل مقطع
export function buildTimeline(segments, { gap = 0.6, leadIn = 0.3, tail = 0.8, ambient = null, ambientVolume = 0 } = {}) {
  let t = leadIn;
  for (const seg of segments) {
    const d = seg.audio ? seg.audio.duration : (seg.silence || 3);
    seg.start = t;
    seg.end = t + d;
    t = seg.end + (seg.noGap ? 0 : gap);
  }
  const duration = (segments.length ? segments[segments.length - 1].end : 0) + tail;
  const n = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  for (const seg of segments) {
    if (!seg.audio) continue;
    const off = Math.round(seg.start * SAMPLE_RATE);
    const a = seg.audio;
    const l = a.getChannelData(0);
    const r = a.numberOfChannels > 1 ? a.getChannelData(1) : l;
    const gain = seg.gain ?? 1;
    // تلاشي قصير جدًا (15ms) في أول وآخر كل مقطع عشان مفيش «تكّة» عند القص
    const fade = Math.min(Math.round(0.015 * SAMPLE_RATE), a.length >> 2);
    for (let i = 0; i < a.length && off + i < n; i++) {
      const g = gain * (i < fade ? i / fade : i > a.length - fade ? (a.length - i) / fade : 1);
      left[off + i] += l[i] * g;
      right[off + i] += r[i] * g;
    }
  }

  if (ambient && ambientVolume > 0) {
    const l = ambient.getChannelData(0);
    const r = ambient.numberOfChannels > 1 ? ambient.getChannelData(1) : l;
    const len = ambient.length;
    const fade = Math.min(SAMPLE_RATE * 2, n / 4);
    for (let i = 0; i < n; i++) {
      let g = ambientVolume;
      if (i < fade) g *= i / fade;
      else if (i > n - fade) g *= (n - i) / fade;
      left[i] += l[i % len] * g;
      right[i] += r[i % len] * g;
    }
  }

  // منع التشويه لو الصوت عدّى الحد
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > 0.99) {
    const k = 0.99 / peak;
    for (let i = 0; i < n; i++) { left[i] *= k; right[i] *= k; }
  }
  return { left, right, duration };
}

// ترميز WAV (16-bit PCM)
export function encodeWav({ left, right }) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, SAMPLE_RATE * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, left[i])) * 0x7fff, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, right[i])) * 0x7fff, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

// ===== التسجيل من الميكروفون =====
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise(resolve => {
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        resolve({ blob, buffer: await decode(await blob.arrayBuffer()) });
      };
      rec.stop();
    }),
  };
}

// قص السكوت من أول التسجيل وآخره (مع هامش صغير)
export function trimSilence(buffer, { threshold = 0.02, pad = 0.2 } = {}) {
  const ch = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
  const loud = i => ch.some(d => Math.abs(d[i]) > threshold);
  let start = 0, end = buffer.length - 1;
  while (start < end && !loud(start)) start++;
  while (end > start && !loud(end)) end--;
  if (end <= start) return buffer; // كله سكوت؛ سيبه زي ما هو
  const p = Math.round(pad * buffer.sampleRate);
  start = Math.max(0, start - p);
  end = Math.min(buffer.length - 1, end + p);
  const out = new AudioBuffer({ length: end - start + 1, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  ch.forEach((d, c) => out.copyToChannel(d.subarray(start, end + 1), c));
  out.trimStart = start / buffer.sampleRate; // بنحتاجه عشان نزق توقيت الكلمات
  return out;
}

export function bufferToWavBlob(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  return new Blob([encodeWav({ left, right })], { type: 'audio/wav' });
}

// قص جزء من ملف صوت (بالثواني)
export function sliceBuffer(buffer, from, to) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(buffer.length, Math.max(a + 1, Math.floor(to * sr)));
  const out = new AudioBuffer({ length: b - a, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(a, b), c);
  return out;
}

// ===== تحسين الصوت (لتسجيلات الصوت البشري: الأحاديث والأدعية) =====
// clean: تنظيف + دفا + وضوح + موازنة | room: + صدى غرفة | mosque: + صدى مسجد
export const ENHANCE_PRESETS = {
  '': 'بدون',
  clean: 'تنظيف ووضوح',
  room: 'تنظيف + صدى غرفة',
  mosque: 'تنظيف + صدى مسجد 🕌',
};
const REVERB = { room: { decay: 1.1, wet: 0.16, pre: 0.015 }, mosque: { decay: 3.2, wet: 0.3, pre: 0.045 } };

// بيوطّي الدوشة اللي بين الكلام (بوابة ناعمة حسب مستوى الدوشة في التسجيل نفسه)
function gateNoise(data, sr) {
  const win = Math.round(0.02 * sr);
  const frames = Math.ceil(data.length / win);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const end = Math.min(data.length, (f + 1) * win);
    for (let i = f * win; i < end; i++) s += data[i] * data[i];
    rms[f] = Math.sqrt(s / Math.max(1, end - f * win));
  }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(frames * 0.1)] || 0;
  const open = Math.max(floor * 3, 0.004);
  let g = 1;
  const att = 1 - Math.exp(-1 / (0.005 * sr)), rel = 1 - Math.exp(-1 / (0.12 * sr));
  for (let i = 0; i < data.length; i++) {
    const target = rms[Math.floor(i / win)] >= open ? 1 : 0.18;
    g += (target - g) * (target > g ? att : rel);
    data[i] *= g;
  }
}

function impulse(ctx, { decay, pre }) {
  const sr = ctx.sampleRate, len = Math.round((decay + pre) * sr), p = Math.round(pre * sr);
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = p; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - p) / (len - p), 2.2) * Math.exp(-3 * (i - p) / (len - p));
  }
  return ir;
}

const enhanceCache = new WeakMap();

export function enhanceVoice(buffer, preset) {
  if (!preset) return Promise.resolve(buffer);
  let m = enhanceCache.get(buffer);
  if (!m) enhanceCache.set(buffer, (m = new Map()));
  if (!m.has(preset)) m.set(preset, renderEnhanced(buffer, preset));
  return m.get(preset);
}

async function renderEnhanced(buffer, preset) {
  const sr = buffer.sampleRate;
  // مونو للتنظيف (صوت واحد بيتكلم)
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  gateNoise(mono, sr);
  const rv = REVERB[preset];
  const tail = rv ? rv.decay + rv.pre : 0.05;
  const ctx = new OfflineAudioContext(2, buffer.length + Math.round(tail * sr), sr);
  const src = ctx.createBufferSource();
  const inBuf = ctx.createBuffer(1, buffer.length, sr);
  inBuf.copyToChannel(mono, 0);
  src.buffer = inBuf;

  const chain = [
    Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }),
    Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' }),
    Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }),
    Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }),
    Object.assign(ctx.createBiquadFilter(), { type: 'highshelf' }),
  ];
  const set = (n, f, g, q) => { n.frequency.value = f; if (g != null) n.gain.value = g; if (q) n.Q.value = q; };
  set(chain[0], 85, null, 0.7);      // يشيل الزن والهمهمة
  set(chain[1], 180, 2.5);           // دفا
  set(chain[2], 380, -2.5, 1);       // يشيل «الكتمة»
  set(chain[3], 3200, 3.5, 0.9);     // وضوح الحروف
  set(chain[4], 9000, 2);            // هوا ولمعة
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.18;

  let node = src;
  for (const n of chain) { node.connect(n); node = n; }
  node.connect(comp);
  comp.connect(ctx.destination);
  if (rv) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, rv);
    const wet = ctx.createGain();
    wet.gain.value = rv.wet;
    comp.connect(conv); conv.connect(wet); wet.connect(ctx.destination);
  }
  src.start();
  const out = await ctx.startRendering();

  // موازنة: مستوى الكلام حوالي -16 dBFS، ومن غير ما يعدّي 0.95
  const L = out.getChannelData(0), R = out.getChannelData(1);
  let sum = 0, cnt = 0, peak = 0;
  for (let i = 0; i < L.length; i++) {
    const v = Math.abs(L[i]);
    peak = Math.max(peak, v, Math.abs(R[i]));
    if (v > 0.01) { sum += L[i] * L[i]; cnt++; }
  }
  const rms = Math.sqrt(sum / Math.max(1, cnt)) || 1e-4;
  const k = Math.min(0.158 / rms, 0.95 / Math.max(peak, 1e-4), 8);
  for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; }
  return out;
}
