// تحديد بدايات الآيات أوتوماتيك في تلاوة مرفوعة (سورة كاملة مثلًا)
// الفكرة: القارئ بيقف بين الآيات. بنلاقي كل الوقفات في الصوت، وبعدين نختار منها
// الوقفات اللي توزيعها أقرب لطول الآيات (الآية الطويلة بتاخد وقت أطول) — بالبرمجة الديناميكية.
// كله جوه المتصفح، من غير نت ولا ذكاء اصطناعي، وبيخلص في أقل من ثانية.

const FRAME = 0.02; // 20ms

// مستوى الصوت لكل 20ms في المقطع [start, end]
function envelope(buffer, start, end) {
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.round(FRAME * sr));
  const a = Math.floor(start * sr), b = Math.min(buffer.length, Math.floor(end * sr));
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const out = new Float32Array(Math.max(0, Math.floor((b - a) / hop)));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const i0 = a + f * hop;
    for (let i = i0; i < i0 + hop; i++) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v /= chans.length;
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / hop);
  }
  return out;
}

const pct = (arr, p) => {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0;
};

// كل الوقفات (سكوت ≥ minPause ثانية): [{ from, to, len }] بالثواني من بداية الملف
export function findPauses(buffer, start, end, minPause = 0.25) {
  const env = envelope(buffer, start, end);
  if (!env.length) return [];
  const floor = pct(env, 0.1), voice = pct(env, 0.7);
  const thr = floor + Math.max(0.12 * (voice - floor), 0.002);
  const pauses = [];
  let run = -1;
  for (let f = 0; f <= env.length; f++) {
    const quiet = f < env.length && env[f] < thr;
    if (quiet && run < 0) run = f;
    if (!quiet && run >= 0) {
      const len = (f - run) * FRAME;
      // بنتجاهل السكوت في أول وآخر المقطع (مش وقفة بين آيتين)
      if (len >= minPause && run > 0 && f < env.length) pauses.push({ from: start + run * FRAME, to: start + f * FRAME, len });
      run = -1;
    }
  }
  return pauses;
}

// weights: طول كل آية (عدد الحروف مثلًا). بيرجع { marks, pauses } — marks = بداية كل آية من التانية لآخر آية
export function autoMarks(buffer, start, end, weights) {
  const K = weights.length - 1;
  if (K <= 0) return { marks: [], pauses: 0 };
  const pauses = findPauses(buffer, start, end);
  const M = pauses.length;
  if (M < K) return { marks: null, pauses: M };
  const D = end - start;
  const total = weights.reduce((a, b) => a + b, 0);
  const expDur = weights.map(w => D * w / total);
  // نقطة القطع = قبل ما الصوت يرجع بشوية (عشان الآية تظهر مع أول حرف)
  const cut = pauses.map(p => Math.max(p.from, p.to - 0.08));
  const segCost = (d, e) => { const r = (d - e) / e; return r * r; };
  const bonus = p => 0.35 * Math.min(p.len, 1.5); // الوقفة الأطول أرجح إنها بين آيتين

  // dp[k][j] = أقل تكلفة لو القطع رقم k (من 0) هو الوقفة j
  const INF = 1e18;
  let prev = new Float64Array(M).fill(INF);
  const back = [];
  for (let j = 0; j < M; j++) prev[j] = segCost(cut[j] - start, expDur[0]) - bonus(pauses[j]);
  back.push(null);
  for (let k = 1; k < K; k++) {
    const cur = new Float64Array(M).fill(INF);
    const bk = new Int32Array(M).fill(-1);
    for (let j = k; j < M - (K - 1 - k); j++) {
      let best = INF, bi = -1;
      for (let i = k - 1; i < j; i++) {
        if (prev[i] >= INF) continue;
        const c = prev[i] + segCost(cut[j] - cut[i], expDur[k]);
        if (c < best) { best = c; bi = i; }
      }
      if (bi >= 0) { cur[j] = best - bonus(pauses[j]); bk[j] = bi; }
    }
    prev = cur;
    back.push(bk);
  }
  // الآية الأخيرة لحد النهاية
  let bestJ = -1, best = INF;
  for (let j = K - 1; j < M; j++) {
    if (prev[j] >= INF) continue;
    const c = prev[j] + segCost(end - cut[j], expDur[K]);
    if (c < best) { best = c; bestJ = j; }
  }
  if (bestJ < 0) return { marks: null, pauses: M };
  const idx = [bestJ];
  for (let k = K - 1; k >= 1; k--) idx.unshift(back[k][idx[0]]);
  return { marks: idx.map(j => cut[j]), pauses: M };
}
