// أكتر من خلفية في نفس الفيديو: جدول التبديل + رسم الخلفية في لحظة معينة

// بيرجع [{ k, from, to }]: k = رقم الخلفية في القايمة
// style.bgSwitch: 'ayah' (مع كل آية/مقطع) | 'seconds' (كل bgEvery ثانية)
// durs (اختياري): مدة كل خلفية بالثواني لوضع 'custom'
export function bgSchedule(segments, duration, n, style, durs = []) {
  if (n <= 1) return [{ k: 0, from: 0, to: duration }];
  const out = [];
  if (style.bgSwitch === 'custom') {
    const def = Math.max(0.5, Number(style.bgEvery) || 6);
    for (let t = 0, k = 0, guard = 0; t < duration - 0.01 && guard < 2000; k = (k + 1) % n, guard++) {
      const d = Math.max(0.5, Number(durs[k]) || def);
      out.push({ k, from: t, to: Math.min(duration, t + d) });
      t += d;
    }
    return out;
  }
  if (style.bgSwitch === 'seconds') {
    const every = Math.max(1, Number(style.bgEvery) || 6);
    for (let t = 0, k = 0; t < duration - 0.01; t += every, k++) out.push({ k: k % n, from: t, to: Math.min(duration, t + every) });
    return out;
  }
  // مع كل آية: الافتتاحية بتاخد نفس خلفية أول آية، والآية المكررة بتفضل على نفس الخلفية
  let k = 0, lastKey = null;
  segments.forEach((s, i) => {
    const key = s.kind === 'title' && i === 0 ? null : s.kind === 'ayah' ? `${s.s}:${s.a}` : `${s.kind}:${i}`;
    if (i === 0) { out.push({ k: 0, from: 0, to: duration }); lastKey = key; return; }
    if (key === lastKey) return;
    if (lastKey === null) { lastKey = key; return; }
    k = (k + 1) % n;
    out[out.length - 1].to = s.start;
    out.push({ k, from: s.start, to: duration });
    lastKey = key;
  });
  if (!out.length) out.push({ k: 0, from: 0, to: duration });
  return out;
}

// الخلفية الحالية + اللي قبلها لو احنا جوه الانتقال الناعم
export function pickBg(sched, t, fade = 0) {
  let i = sched.length - 1;
  for (let j = 0; j < sched.length; j++) if (t < sched[j].to) { i = j; break; }
  const cur = sched[i];
  const into = t - cur.from;
  if (fade > 0 && i > 0 && into < fade) return { cur, prev: sched[i - 1], alpha: Math.max(0, into / fade) };
  return { cur, prev: null, alpha: 1 };
}

// ===== إطارات الفيديو وقت التصدير (بنقدّم الفيديو للحظة المطلوبة ونرسمها) =====
export async function loadVideoSource(url) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = url;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('الفيديو ماتحمّلش')), 15000);
    v.onloadeddata = () => { clearTimeout(to); res(); };
    v.onerror = () => { clearTimeout(to); rej(new Error('صيغة الفيديو مش مدعومة في المتصفح')); };
  });
  return v;
}

export function seekVideo(v, t) {
  const d = v.duration || 1;
  const target = Math.min(Math.max(0, t % d), Math.max(0, d - 0.04));
  if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return Promise.resolve();
  return new Promise((res, rej) => {
    const to = setTimeout(() => { v.removeEventListener('seeked', on); rej(new Error('seek timeout')); }, 3000);
    const on = () => { clearTimeout(to); v.removeEventListener('seeked', on); res(); };
    v.addEventListener('seeked', on);
    v.currentTime = target;
  });
}
