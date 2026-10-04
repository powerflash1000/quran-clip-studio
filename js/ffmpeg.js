import { FFmpeg } from '../vendor/ffmpeg/index.js';

// ffmpeg-core (حوالي 32MB) بيتحمل مرة واحدة من CDN والمتصفح بيحتفظ بيه في الكاش
const CORE_VERSION = '0.12.10';
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

let instance = null;
let loading = null;
let progressCb = null;
let logLines = [];

async function toBlobURL(url, type, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total ? got / total : 0);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

export function getFFmpeg(onLoadProgress) {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;
  loading = (async () => {
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => {
      logLines.push(message);
      if (logLines.length > 200) logLines.shift();
    });
    ff.on('progress', ({ time }) => progressCb && progressCb(time / 1e6));
    let lastErr;
    for (const base of CORE_BASES) {
      try {
        const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', onLoadProgress);
        await ff.load({ coreURL, wasmURL });
        instance = ff;
        return ff;
      } catch (e) {
        lastErr = e;
      }
    }
    loading = null;
    throw new Error('تعذر تحميل محرك التحويل (ffmpeg): ' + (lastErr?.message || ''));
  })();
  return loading;
}

// تشغيل أمر ffmpeg مع متابعة التقدم (بالثواني)
export async function run(ff, args, onTime) {
  progressCb = onTime;
  logLines = [];
  const code = await ff.exec(args);
  progressCb = null;
  if (code !== 0) {
    const tail = logLines.slice(-12).join('\n');
    throw new Error('فشل التحويل:\n' + tail);
  }
}

export async function cleanup(ff, files) {
  for (const f of files) {
    try { await ff.deleteFile(f); } catch { /* الملف مش موجود */ }
  }
}
