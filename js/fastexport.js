// تصدير سريع بالـ WebCodecs (بيستخدم كارت الشاشة / مُرمّز الجهاز) بدل ffmpeg.wasm
// بيشتغل في Chrome و Edge لما الجهاز يدعم H.264 + AAC. لو مش مدعوم بنرجع لـ ffmpeg تلقائيًا.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';
import { drawBackground, drawOverlay } from './slides.js';
import { overlayFrames, FPS } from './exporter.js';
import { SAMPLE_RATE } from './audio.js';

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
  const bg = newCanvas(W, H);
  drawBackground(bg.getContext('2d'), W, H, style, media?.kind === 'image' ? media : null);

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
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encodeError = e; },
  });
  venc.configure(cfg.video.config);

  // الصوت
  if (cfg.audio) {
    onStage?.('ترميز الصوت…');
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
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
  const totalFrames = Math.ceil(timeline.duration * FPS);
  const frameDur = 1e6 / FPS;
  let fi = -1;
  const waveform = style.waveform && !silent;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / FPS;
    let next = fi;
    while (next + 1 < frames.length && frames[next + 1].from <= t + 1e-6) next++;
    if (next !== fi) {
      fi = next;
      const f = frames[Math.max(0, fi)];
      octx.clearRect(0, 0, W, H);
      if (f) drawOverlay(octx, W, H, f.count == null ? f.seg : { ...f.seg, wordCount: f.count }, style);
    }
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(ov, 0, 0);
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
  await venc.flush();
  venc.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  onProgress?.(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}
