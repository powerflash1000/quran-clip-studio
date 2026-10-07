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
    t = seg.end + gap;
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
