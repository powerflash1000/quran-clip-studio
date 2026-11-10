// تصدير سريع بالـ WebCodecs (بيستخدم كارت الشاشة / مُرمّز الجهاز) بدل ffmpeg.wasm
// بيشتغل في Chrome و Edge لما الجهاز يدعم H.264 + AAC. لو مش مدعوم بنرجع لـ ffmpeg تلقائيًا.
import { Muxer, ArrayBufferTarget, StreamTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';
import { drawBackground, drawOverlay, ENTER_SECS, textFont } from './slides.js';
import { drawLight, drawLightLoop, TRANS_SECS, subCardAge, drawSubCard } from './brand.js';
import { kbAmount } from './frame.js';
import { ZONE_SRC } from './zone.js';
import { overlayFrames, FPS } from './exporter.js';
import { SAMPLE_RATE } from './audio.js';
import { bgSchedule, pickBg, loadVideoSource, seekVideo } from './bglist.js';
import { videoFrames } from './vframes.js';

const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.640032', 'avc1.42e028'];

// للاختبار بس: window.__qcsTestCodecs = true بيسمح بـ VP9/Opus (متصفحات من غير H.264)
function testCodecs() {
  return typeof window !== 'undefined' && window.__qcsTestCodecs;
}

// بيرجع إعدادات الترميز المناسبة أو null لو الجهاز مش بيدعم التصدير السريع
export async function fastConfig(W, H, silent) {
  if (typeof VideoEncoder === 'undefined' || (!silent && typeof AudioEncoder === 'undefined')) return null;
  const bitrate = Math.min(W, H) >= 1080 ? 6_000_000 : 3_500_000;
  const candidates = AVC_CODECS.map(codec => ({ mux: 'avc', codec }));
  if (testCodecs()) candidates.push({ mux: 'vp9', codec: 'vp09.00.40.08' });
  let video = null;
  for (const c of candidates) {
    const config = { codec: c.codec, width: W, height: H, bitrate, framerate: FPS, ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) { video = { mux: c.mux, config: r.config }; break; }
    } catch { /* جرّب اللي بعده */ }
  }
  if (!video) return null;
  if (silent) return { video, audio: null };

  const audioCandidates = [{ mux: 'aac', codec: 'mp4a.40.2' }];
  if (testCodecs()) audioCandidates.push({ mux: 'opus', codec: 'opus' });
  for (const a of audioCandidates) {
    const config = { codec: a.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000 };
    try {
      const r = await AudioEncoder.isConfigSupported(config);
      if (r.supported) return { video, audio: { mux: a.mux, config: r.config } };
    } catch { /* مش مدعوم */ }
  }
  return null;
}

function newCanvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

// موجة صوتية من عينات الصوت حوالين اللحظة t (شبه showwaves في ffmpeg)
function drawWaveAt(ctx, W, H, timeline, t, color) {
  const n = 1200;
  const center = Math.floor(t * SAMPLE_RATE);
  const start = Math.max(0, center - n / 2);
  const L = timeline.left;
  const y0 = H * (H > W ? 0.86 : 0.93);
  const amp = H * 0.05;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(2, W / 400);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = L[start + i] || 0;
    const x = (i / (n - 1)) * W;
    const y = y0 + v * amp * 1.6;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

export async function fastExportVideo(project, cfg, onProgress, onStage) {
  const { segments, timeline, style, media, silent } = project;
  let { W, H } = project;
  if (project.quality === '720') { const k = 720 / Math.min(W, H); W = Math.round(W * k / 2) * 2; H = Math.round(H * k / 2) * 2; }

  onStage?.('تجهيز الخلفية…');
  const totalFrames = Math.ceil(timeline.duration * FPS);
  // 🔁 مدة الدورة = عدد الإطارات بالظبط، فالحركة (Ken Burns / الإضاءة) بترجع لأول إطار بعد آخر إطار
  const D = totalFrames / FPS;
  const moving = kbAmount(style) > 0;
  const bg = newCanvas(W, H);
  drawBackground(bg.getContext('2d'), W, H, style, media?.kind === 'image' ? media : null);
  // خلفيات متعددة أو فيديو: بنرسم الخلفية لكل إطار
  const list = project.mediaList?.length ? project.mediaList : media ? [media] : [];
  const dynamic = list.length > 1 || list.some(m => m.kind === 'video');
  let sched = null, sources = null;
  if (dynamic) {
    sched = bgSchedule(segments, timeline.duration, list.length, style, list.map(m => m.secs));
    sources = await Promise.all(list.map(async m => m.kind === 'video' ? { kind: 'video', el: await loadVideoSource(m.url) } : m));
  }
  const fade = dynamic && style.bgFade !== false ? 0.6 : 0;
  // فيديوهات الخلفية: بنحسب مسبقًا كل الإطارات المطلوبة من كل فيديو بالترتيب، ونفكها بـ Mediabunny.
  // لو فشل (صيغة مش مدعومة مثلًا) بنرجع للطريقة القديمة (seek لكل إطار).
  if (dynamic && sources.some(m => m.kind === 'video') && !globalThis.__noMB) { // __noMB: للاختبار (يقارن بالطريقة القديمة)
    const reqs = sources.map(() => []);
    for (let i = 0; i < totalFrames; i++) {
      const t = i / FPS, p = pickBg(sched, t, fade);
      if (p.prev) reqs[p.prev.k].push(t - p.prev.from);
      reqs[p.cur.k].push(t - p.cur.from);
    }
    await Promise.all(sources.map(async (m, k) => {
      if (m.kind !== 'video' || !reqs[k].length) return;
      try { m.frames = await videoFrames(list[k].url, reqs[k]); } catch (e) { console.warn('mediabunny → seek', e); }
    }));
  }
  let clock = { t: 0, dur: D };
  const drawItemAt = async (c, m, local) => {
    if (m.frames) {
      const fr = await m.frames.next();
      drawBackground(c, W, H, style, fr ? { kind: 'video', el: fr } : null, clock);
      if (m.el) ZONE_SRC.el = m.el; // 📐 مكان الكلام يتحسب من الفيديو نفسه (ثابت)، مش من كل فريم
      return;
    }
    if (m.kind === 'video') await seekVideo(m.el, local);
    drawBackground(c, W, H, style, m, clock);
  };

  const frames = overlayFrames(segments, timeline.duration);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: cfg.video.mux, width: W, height: H, frameRate: FPS },
    audio: cfg.audio ? { codec: cfg.audio.mux, sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError = null;
  // 🔁 مقطع Loop: بنحتفظ بالإطارات المترمّزة عشان «النسخة الطويلة» تتعمل منها من غير ترميز تاني
  const keep = style.loop ? { video: [], audio: [] } : null;
  const raw = (list, chunk, meta) => {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    list.push({ data, type: chunk.type, ts: chunk.timestamp, dur: chunk.duration ?? 0, meta: meta?.decoderConfig ? meta : undefined });
  };
  const venc = new VideoEncoder({
    output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); if (keep) raw(keep.video, chunk, meta); },
    error: e => { encodeError = e; },
  });
  venc.configure(cfg.video.config);

  // الصوت
  if (cfg.audio) {
    onStage?.('ترميز الصوت…');
    const aenc = new AudioEncoder({
      output: (chunk, meta) => { muxer.addAudioChunk(chunk, meta); if (keep) raw(keep.audio, chunk, meta); },
      error: e => { encodeError = e; },
    });
    aenc.configure(cfg.audio.config);
    const total = timeline.left.length;
    const step = 4096;
    for (let off = 0; off < total; off += step) {
      const n = Math.min(step, total - off);
      const data = new Float32Array(n * 2);
      data.set(timeline.left.subarray(off, off + n), 0);
      data.set(timeline.right.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / SAMPLE_RATE * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (encodeError) throw encodeError;
  }

  // الصورة: خلفية + طبقة النص (صورة لكل تغيير) + موجة اختيارية
  onStage?.('تحويل الفيديو (سريع)…');
  const canvas = newCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const ov = newCanvas(W, H);
  const octx = ov.getContext('2d');
  const frameDur = 1e6 / FPS;
  let fi = -1;
  const waveform = style.waveform && !silent;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / FPS;
    let next = fi;
    while (next + 1 < frames.length && frames[next + 1].from <= t + 1e-6) next++;
    // حركة دخول النص: بنعيد رسم الطبقة كل إطار في أول ENTER_SECS من كل كارت
    const fr = frames[Math.max(0, next)];
    const age = fr && fr.seg.start != null ? t - fr.seg.start : null;
    // + المقدمة/الخاتمة والانتقال بين الكروت بيتحركوا كل إطار
    const animWin = fr?.seg.kind === 'bumper' ? 9e9 : Math.max(style.textAnim ? ENTER_SECS : 0, style.cardTrans ? TRANS_SECS : 0);
    const entering = animWin > 0 && fr && fr.count == null && age != null && age >= 0 && age < animWin + 1 / FPS;
    if (next !== fi || entering) {
      fi = next;
      const f = frames[Math.max(0, fi)];
      octx.clearRect(0, 0, W, H);
      if (f) drawOverlay(octx, W, H, f.count == null ? { ...f.seg, age: entering ? age : null } : { ...f.seg, wordCount: f.count }, style);
    }
    clock = { t, dur: D };
    if (!dynamic) {
      if (moving) drawBackground(ctx, W, H, style, media?.kind === 'image' ? media : null, clock);
      else ctx.drawImage(bg, 0, 0);
    } else {
      const p = pickBg(sched, t, fade);
      if (p.prev) await drawItemAt(ctx, sources[p.prev.k], t - p.prev.from);
      ctx.globalAlpha = p.alpha;
      await drawItemAt(ctx, sources[p.cur.k], t - p.cur.from);
      ctx.globalAlpha = 1;
    }
    if (style.light) { if (style.loop) drawLightLoop(ctx, W, H, style, t, D); else drawLight(ctx, W, H, style, t); }
    ctx.drawImage(ov, 0, 0);
    const sa = style.subCard ? subCardAge(style, timeline.duration, t) : null;
    if (sa != null) drawSubCard(ctx, W, H, style, sa, textFont(style));
    if (waveform) drawWaveAt(ctx, W, H, timeline, t, style.accent);

    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (encodeError) throw encodeError;
    // منع تراكم الإطارات في الذاكرة
    while (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
    if (i % 10 === 0) {
      onProgress?.(i / totalFrames);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  sources?.forEach(m => m.frames?.close());
  await venc.flush();
  venc.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  lastLoop = keep ? { ...keep, D: Math.round(D * 1e6), W, H, video: keep.video, vmux: cfg.video.mux, amux: cfg.audio?.mux || null } : null;
  onProgress?.(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// ===== ⏩ النسخة الطويلة من مقطع Loop (ساعة / ساعتين للتلفزيون) =====
// بنكرر نفس الإطارات المترمّزة بتوقيت جديد (من غير ترميز تاني): سريع، ونفس الجودة بالظبط.
// الملف بيتكتب على الهارد على طول (مش في الذاكرة) — محتاج Chrome/Edge على الكمبيوتر.
let lastLoop = null;
export const loopReady = () => (lastLoop ? { secs: lastLoop.D / 1e6, W: lastLoop.W, H: lastLoop.H, bytes: [...lastLoop.video, ...lastLoop.audio].reduce((n, c) => n + c.data.byteLength, 0) } : null);

export async function exportLongLoop(totalSecs, writable, onProgress) {
  const L = lastLoop;
  if (!L) throw new Error('صدّر مقطع Loop الأول (فيديو MP4 والـ 🔁 Loop شغال)');
  const reps = Math.max(1, Math.round(totalSecs * 1e6 / L.D));
  let chain = Promise.resolve(), werr = null;
  const target = new StreamTarget({
    onData: (data, position) => {
      const copy = data.slice();
      chain = chain.then(() => writable.write({ type: 'write', position, data: copy })).catch(e => { werr = werr || e; });
    },
    chunked: true,
  });
  const muxer = new Muxer({
    target,
    video: { codec: L.vmux, width: L.W, height: L.H, frameRate: FPS },
    audio: L.amux && L.audio.length ? { codec: L.amux, sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : undefined,
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  // الصوت اللي بيعدّي آخر الدورة بيتشال (أقل من ٢٥ مللي ثانية) عشان التوقيت مايتداخلش
  const items = [
    ...L.video.map(c => ({ ...c, v: true })),
    ...(L.amux ? L.audio.filter(c => c.ts + c.dur <= L.D + 1000).map(c => ({ ...c, v: false })) : []),
  ].sort((a, b) => a.ts - b.ts || (a.v ? -1 : 1));
  for (let r = 0; r < reps; r++) {
    const off = r * L.D;
    for (const c of items) {
      if (c.v) muxer.addVideoChunkRaw(c.data, c.type, c.ts + off, c.dur, r === 0 ? c.meta : undefined);
      else muxer.addAudioChunkRaw(c.data, c.type, c.ts + off, c.dur, r === 0 ? c.meta : undefined);
    }
    await chain;
    if (werr) throw werr;
    onProgress?.((r + 1) / reps);
    await new Promise(res => setTimeout(res, 0));
  }
  muxer.finalize();
  await chain;
  if (werr) throw werr;
  await writable.close();
  return { secs: reps * L.D / 1e6, reps };
}
