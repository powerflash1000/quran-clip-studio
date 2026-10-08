import { encodeWav } from './audio.js';
import { getFFmpeg, run, cleanup } from './ffmpeg.js';
import { drawBackground, drawOverlay, canvasToPng } from './slides.js';
import { makeZip } from './zip.js';
import { fastConfig, fastExportVideo } from './fastexport.js';
import { bgSchedule } from './bglist.js';

export const FPS = 25;

// ===== الصوت =====
export async function exportAudio(format, timeline, onProgress, onLoad) {
  const wav = encodeWav(timeline);
  if (format === 'wav') return new Blob([wav], { type: 'audio/wav' });

  const ff = await getFFmpeg(onLoad);
  const out = format === 'mp3' ? 'out.mp3' : 'out.m4a';
  await ff.writeFile('in.wav', wav);
  const codec = format === 'mp3'
    ? ['-c:a', 'libmp3lame', '-b:a', '192k']
    : ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  try {
    await run(ff, ['-y', '-i', 'in.wav', ...codec, out], t => onProgress?.(t / timeline.duration));
    const data = await ff.readFile(out);
    return new Blob([data], { type: format === 'mp3' ? 'audio/mpeg' : 'audio/mp4' });
  } finally {
    await cleanup(ff, ['in.wav', out]);
  }
}

// ===== ملفات الترجمة SRT =====
const srtTime = s => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(ms % 1000, 3)}`;
};

export function makeSrt(segments, field = 'text') {
  return segments
    .filter(s => s[field])
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s[field]}\n`)
    .join('\n');
}

// ===== الطبقات (الخلفية والنص) كصور PNG =====
function newCanvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

export async function renderBackgroundPng(W, H, style, media) {
  const c = newCanvas(W, H);
  drawBackground(c.getContext('2d'), W, H, style, media?.kind === 'image' ? media : null);
  return canvasToPng(c);
}

export async function renderOverlayPng(W, H, seg, style) {
  const c = newCanvas(W, H);
  drawOverlay(c.getContext('2d'), W, H, seg, style);
  return canvasToPng(c);
}

// صورة ثابتة واحدة (منشور) = خلفية + نص
export async function renderStill(W, H, seg, style, media) {
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  drawBackground(ctx, W, H, style, media);
  drawOverlay(ctx, W, H, seg, style);
  return canvasToPng(c);
}

// لكل مقطع: صورة واحدة، أو صورة لكل كلمة لو خاصية «الكلمات مع التلاوة» شغالة
// كل صورة بتفضل ظاهرة لحد الصورة اللي بعدها
export function overlayFrames(segments, duration) {
  const frames = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const from = i === 0 ? 0 : seg.start;
    const to = i + 1 < segments.length ? segments[i + 1].start : duration;
    const wt = seg.wordTimes;
    if (!wt?.length) { frames.push({ seg, count: null, from, to }); continue; }
    // نقط التغيير: [عدد الكلمات الظاهرة, من]
    const pts = [[0, from]];
    for (let k = 1; k <= wt.length; k++) pts.push([k, Math.max(from, Math.min(to, seg.start + wt[k - 1]))]);
    // لو نقطتين قريبين جدًا، التانية بتغطي على الأولى (عشان مجموع المدد يفضل مظبوط)
    const kept = [];
    for (let j = 0; j < pts.length; j++) {
      const nextStart = j + 1 < pts.length ? pts[j + 1][1] : to;
      if (nextStart - pts[j][1] >= 0.02 || j === pts.length - 1) kept.push(pts[j]);
    }
    kept[0][1] = from;
    kept.forEach(([count, start], j) => {
      const end = j + 1 < kept.length ? kept[j + 1][1] : to;
      if (end > start) frames.push({ seg, count, from: start, to: end });
    });
    const last = frames[frames.length - 1];
    if (last && last.seg === seg) { last.to = to; last.count = Math.max(last.count, wt.length); }
  }
  return frames;
}

// ===== الفيديو =====
// project: { segments, timeline, style, media, W, H, quality }
export async function exportVideo(project, onProgress, onLoad, onStage) {
  const { segments, timeline, style, media } = project;
  let { W, H } = project;
  if (project.quality === '720') { const k = 720 / Math.min(W, H); W = Math.round(W * k / 2) * 2; H = Math.round(H * k / 2) * 2; }

  // الطريقة السريعة (WebCodecs) لما الجهاز يدعمها
  if (!project.forceFfmpeg) {
    try {
      const cfg = await fastConfig(W, H, !!project.silent);
      if (cfg) {
        project.usedFast = true;
        return await fastExportVideo(project, cfg, onProgress, onStage);
      }
    } catch (e) {
      console.warn('التصدير السريع فشل، هنكمل بـ ffmpeg', e);
      project.usedFast = false;
    }
  }
  project.usedFast = false;

  const ff = await getFFmpeg(onLoad);
  const files = [];
  const write = async (name, data) => {
    await ff.writeFile(name, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
    files.push(name);
  };

  try {
    onStage?.('تجهيز الصوت…');
    await write('audio.wav', encodeWav(timeline));

    onStage?.('رسم الخلفية والنصوص…');
    const bgList = project.mediaList || [];
    const multi = bgList.length > 1;
    const isVideoBg = multi || media?.kind === 'video';
    let bgInput, bgChain = null;
    if (multi) {
      // كل جزء من الجدول = مدخل لوحده، وبنلزقهم ورا بعض (من غير انتقال ناعم)
      const sched = bgSchedule(segments, timeline.duration, bgList.length, style);
      for (let i = 0; i < bgList.length; i++) {
        const m = bgList[i];
        await write(`bg${i}.` + (m.kind === 'video' ? (m.file.name?.split('.').pop() || 'mp4').toLowerCase() : 'png'),
          m.kind === 'video' ? m.file : await renderBackgroundPng(W, H, style, m));
      }
      const name = i => files.find(f => f.startsWith(`bg${i}.`));
      bgInput = sched.flatMap(c => bgList[c.k].kind === 'video'
        ? ['-stream_loop', '-1', '-t', (c.to - c.from).toFixed(3), '-i', name(c.k)]
        : ['-loop', '1', '-framerate', String(FPS), '-t', (c.to - c.from).toFixed(3), '-i', name(c.k)]);
      bgChain = sched.map((c, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${(c.to - c.from).toFixed(3)},setpts=PTS-STARTPTS[b${i}];`).join('')
        + sched.map((_, i) => `[b${i}]`).join('') + `concat=n=${sched.length}:v=1:a=0[bg];`;
      project._bgInputs = sched.length;
    } else if (isVideoBg) {
      const ext = (media.file.name?.split('.').pop() || 'mp4').toLowerCase();
      await write('bg.' + ext, media.file);
    } else {
      await write('bg.png', await renderBackgroundPng(W, H, style, media));
    }

    // كل مقطع ليه صورة شفافة بتفضل ظاهرة لحد بداية المقطع اللي بعده
    let list = '';
    const frames = overlayFrames(segments, timeline.duration);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const name = `ov${i}.png`;
      const seg = f.count == null ? f.seg : { ...f.seg, wordCount: f.count };
      await write(name, await renderOverlayPng(W, H, seg, style));
      list += `file '${name}'\nduration ${(f.to - f.from).toFixed(3)}\n`;
      onStage?.(`رسم النصوص… ${i + 1}/${frames.length}`);
    }
    if (frames.length) list += `file 'ov${frames.length - 1}.png'\n`;
    await write('list.txt', new TextEncoder().encode(list));

    if (!multi) {
      bgInput = isVideoBg
        ? ['-stream_loop', '-1', '-i', files.find(f => f.startsWith('bg.'))]
        : ['-loop', '1', '-framerate', String(FPS), '-i', 'bg.png'];
    }
    const nb = multi ? project._bgInputs : 1;
    const ovIn = nb, auIn = nb + 1;

    let filter =
      (bgChain || `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[bg];`) +
      `[${ovIn}:v]fps=${FPS},format=rgba,scale=${W}:${H}[ov];` +
      `[bg][ov]overlay=0:0:format=auto[v1]`;
    let last = 'v1';
    if (style.waveform && !project.silent) {
      const wh = Math.round(H * 0.1);
      const y = Math.round(H * (H > W ? 0.86 : 0.93) - wh / 2);
      const color = style.accent.replace('#', '0x');
      filter += `;[${auIn}:a]showwaves=s=${W}x${wh}:mode=cline:rate=${FPS}:colors=${color}@0.8,format=rgba[w];[v1][w]overlay=0:${y}[v2]`;
      last = 'v2';
    }
    filter += `;[${last}]format=yuv420p[v]`;

    onStage?.('تحويل الفيديو… (ممكن ياخد دقايق، سيب الصفحة مفتوحة)');
    const args = [
      '-y', ...bgInput,
      '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-i', 'audio.wav',
      '-filter_complex', filter,
      '-map', '[v]', ...(project.silent ? [] : ['-map', `${auIn}:a`]),
      '-t', timeline.duration.toFixed(3),
      '-r', String(FPS),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
      ...(isVideoBg ? [] : ['-tune', 'stillimage']),
      ...(project.silent ? ['-an'] : ['-c:a', 'aac', '-b:a', '192k']),
      '-movflags', '+faststart',
      'out.mp4',
    ];
    files.push('out.mp4');
    await run(ff, args, t => onProgress?.(Math.min(1, t / timeline.duration)));
    const data = await ff.readFile('out.mp4');
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    await cleanup(ff, files);
  }
}

// ===== حزمة Filmora =====
export async function exportFilmoraPackage(project, extras = {}) {
  const { segments, timeline, style, media, W, H } = project;
  const files = [];
  files.push({ name: 'audio.wav', data: encodeWav(timeline) });
  files.push({ name: 'subtitles_arabic.srt', data: '﻿' + makeSrt(segments, 'text') });
  if (segments.some(s => s.sub)) files.push({ name: 'subtitles_translation.srt', data: '﻿' + makeSrt(segments, 'sub') });

  const list = project.mediaList?.length ? project.mediaList : media ? [media] : [];
  list.forEach((m, i) => files.push({ name: `background/${String(i + 1).padStart(2, '0')}_${m.file.name || 'background'}`, data: m.file }));
  if (list.length > 1) {
    const sched = bgSchedule(segments, timeline.duration, list.length, style);
    files.push({ name: 'background/timing.csv', data: '\ufeffالخلفية,من,إلى\n' + sched.map(c => `${String(c.k + 1).padStart(2, '0')}_${list[c.k].file.name},${c.from.toFixed(2)},${c.to.toFixed(2)}`).join('\n') });
  }
  files.push({ name: 'background/background_' + W + 'x' + H + '.png', data: await renderBackgroundPng(W, H, style, media) });

  let timing = 'ملف,من,إلى,النص\n';
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const name = `overlays/${String(i + 1).padStart(3, '0')}.png`;
    files.push({ name, data: await renderOverlayPng(W, H, s, { ...style, dim: 0 }) });
    timing += `${name},${s.start.toFixed(2)},${s.end.toFixed(2)},"${(s.label || '').replace(/"/g, "'")}"\n`;
  }
  files.push({ name: 'overlays/timing.csv', data: '﻿' + timing });
  if (extras.video) files.push({ name: 'preview.mp4', data: extras.video });

  files.push({ name: 'اقرأني.txt', data: FILMORA_README(timeline.duration, W, H) });
  return makeZip(files);
}

const FILMORA_README = (d, W, H) => `حزمة مونتاج من استوديو مقاطع القرآن
=====================================
المدة: ${d.toFixed(1)} ثانية — المقاس: ${W}×${H}

طريقة الاستخدام في Filmora:
1) اعمل مشروع جديد بنفس المقاس (${W}×${H}) و 25 إطار في الثانية.
2) اسحب audio.wav على مسار الصوت من الثانية 0.
3) اسحب الخلفية من فولدر background (أو اختار خلفية من مكتبة Filmora Stock).
4) للنص عندك طريقتين:
   أ) File > Import > Import Subtitle File واختار subtitles_arabic.srt
      (وغيّر الخط لـ KFGQPC Uthmanic Script HAFS لو متسطب على جهازك).
   ب) أو اسحب صور فولدر overlays فوق الخلفية؛ توقيت كل صورة مكتوب في overlays/timing.csv.
5) لو فيه ترجمة: subtitles_translation.srt.

ملحوظة: الصور في overlays شفافة ومن غير تعتيم، فتقدر تتحكم في تعتيم الخلفية من Filmora.
`;

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
