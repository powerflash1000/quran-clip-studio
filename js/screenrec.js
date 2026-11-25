// 🖥️ تسجيل جزء من الشاشة (زي Print Screen): بنسجّل التاب ده نفسه (preferCurrentTab — Chrome بيسأل «تسمح؟» بس من غير قايمة تابات)،
// وبعدين ترسم مربع على اللي قدامك، والتسجيل بيتقص عليه. بيرجّع File (webm) + إطارات JPEG اتاخدت وقت التسجيل.
// مش بيشتغل غير على Chrome/Edge على الكمبيوتر (الموبايل مابيسمحش بتسجيل الشاشة من المتصفح).

export const supported = () => !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';

function css(el, s) { el.style.cssText = s; return el; }

// يرسم المربع: بيرجّع {x,y,w,h} بالـ CSS px أو null لو اتلغى
function pickRect(host, hint) {
  return new Promise(res => {
    const ov = css(document.createElement('div'), 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,.35);user-select:none;touch-action:none');
    const box = css(document.createElement('div'), 'position:fixed;border:3px dashed #ffd43b;background:rgba(255,212,59,.08);display:none;pointer-events:none');
    const tip = css(document.createElement('div'), 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:12px;font:600 15px system-ui;z-index:2147483647;display:flex;gap:10px;align-items:center;direction:rtl');
    tip.innerHTML = '<span>✏️ ارسم مربع على الفيديو اللي عايز تسجّله</span>';
    const btn = (t, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.style.cssText = 'font:600 14px system-ui;padding:6px 12px;border-radius:9px;border:0;cursor:pointer'; b.onclick = e => { e.stopPropagation(); f(); }; tip.appendChild(b); return b; };
    const done = r => { ov.remove(); box.remove(); tip.remove(); res(r); };
    if (hint) btn('🎯 مربع الفيديو المعروض', () => done(hint));
    btn('🖥️ الشاشة كلها', () => done({ x: 0, y: 0, w: innerWidth, h: innerHeight }));
    btn('✕ إلغاء', () => done(null));
    let a = null;
    ov.onpointerdown = e => { a = { x: e.clientX, y: e.clientY }; box.style.display = 'block'; ov.setPointerCapture(e.pointerId); };
    ov.onpointermove = e => {
      if (!a) return;
      const x = Math.min(a.x, e.clientX), y = Math.min(a.y, e.clientY);
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - a.x) + 'px', height: Math.abs(e.clientY - a.y) + 'px' });
    };
    ov.onpointerup = e => {
      if (!a) return;
      const r = { x: Math.min(a.x, e.clientX), y: Math.min(a.y, e.clientY), w: Math.abs(e.clientX - a.x), h: Math.abs(e.clientY - a.y) };
      a = null;
      if (r.w < 40 || r.h < 40) { box.style.display = 'none'; return; }
      done(r);
    };
    host.append(ov, box, tip);
  });
}

// opts: { host (العنصر اللي الطبقات بتتحط جواه — لازم يبقى dialog المفتوح عشان يبقى فوق), hint: {x,y,w,h}, onStatus, maxSecs }
export async function recordRegion({ host = document.body, hint = null, onStatus = () => {}, maxSecs = 180 } = {}) {
  if (!supported()) throw new Error('المتصفح ده مش بيسمح بتسجيل الشاشة — استخدم Chrome أو Edge على الكمبيوتر، أو سجّل شاشة الموبايل وارفع الملف.');
  onStatus('اختار «سماح» في رسالة Chrome (وخلّي «شارك صوت التاب» متعلّم)…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 }, audio: true,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude', systemAudio: 'include',
    });
  } catch (e) { throw new Error(e?.name === 'NotAllowedError' ? 'اتلغى — محتاج توافق على مشاركة الشاشة.' : 'مقدرتش أبدأ التسجيل: ' + (e?.message || e)); }
  const vt = stream.getVideoTracks()[0];
  const stopAll = () => stream.getTracks().forEach(t => t.stop());
  const rect = await pickRect(host, hint);
  if (!rect) { stopAll(); throw new Error('اتلغى'); }

  // فيديو المصدر → قص المربع على canvas → تسجيل
  const src = document.createElement('video');
  src.muted = true; src.playsInline = true; src.srcObject = stream;
  await src.play();
  await new Promise(r => (src.videoWidth ? r() : (src.onloadedmetadata = r)));
  const k = src.videoWidth / innerWidth; // الصورة الملتقطة مقاسها غير الـ CSS px
  const sx = Math.max(0, rect.x * k), sy = Math.max(0, rect.y * k), sw = Math.min(src.videoWidth - sx, rect.w * k), sh = Math.min(src.videoHeight - sy, rect.h * k);
  const scale = Math.min(1, 1280 / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * scale / 2) * 2; cv.height = Math.round(sh * scale / 2) * 2;
  const g = cv.getContext('2d');
  const out = cv.captureStream(30);
  stream.getAudioTracks().forEach(t => out.addTrack(t));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  // إطار المربع (بيظهر وقت التسجيل ومش بيتسجل لأنه برّه المربع) + شريط التحكم
  const frameEl = css(document.createElement('div'), `position:fixed;left:${rect.x - 3}px;top:${rect.y - 3}px;width:${rect.w + 6}px;height:${rect.h + 6}px;border:3px solid #ff3b5c;border-radius:6px;pointer-events:none;z-index:2147483646;box-sizing:border-box`);
  const bar = css(document.createElement('div'), 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:12px;font:600 15px system-ui;z-index:2147483647;display:flex;gap:10px;align-items:center;direction:rtl');
  const lbl = document.createElement('span');
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button'; stopBtn.textContent = '⏹ خلاص'; stopBtn.style.cssText = 'font:700 14px system-ui;padding:6px 14px;border-radius:9px;border:0;background:#ff3b5c;color:#fff;cursor:pointer';
  bar.append(lbl, stopBtn);
  host.append(frameEl, bar);

  const frames = [];
  let raf = 0, t0 = performance.now(), lastShot = -1;
  const tick = () => {
    g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const s = (performance.now() - t0) / 1000;
    lbl.textContent = `⏺ بيسجّل ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')} — شغّل الفيديو، ولما يخلص دوس`;
    if (Math.floor(s / 1.5) > lastShot && frames.length < 24) { lastShot = Math.floor(s / 1.5); frames.push({ t: s, img: cv.toDataURL('image/jpeg', 0.75).split(',')[1] }); }
    if (s >= maxSecs) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  let stopped = null;
  const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop(); };
  const finished = new Promise(r => { rec.onstop = r; });
  stopBtn.onclick = stop;
  vt.addEventListener('ended', stop); // لو وقف المشاركة من Chrome نفسه
  rec.start(1000);
  tick();
  onStatus('⏺ بيسجّل — شغّل الفيديو في المربع، ولما يخلص دوس «⏹ خلاص» فوق');
  await finished;
  frameEl.remove(); bar.remove(); stopAll();
  const secs = (performance.now() - t0) / 1000;
  if (secs < 1.5 || !chunks.length) throw new Error('التسجيل قصير أوي');
  const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
  const file = new File([blob], `screen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`, { type: blob.type });
  // الإطارات اللي اتاخدت وقت التسجيل (ملفات MediaRecorder مالهاش مدة مظبوطة، فالقص منها بعدين بيبقى مش مضمون)
  const pick = frames.length > 10 ? frames.filter((_, i) => i % Math.ceil(frames.length / 10) === 0) : frames;
  file.frames = pick.map(f => f.img);
  file.secs = secs;
  return file;
}
