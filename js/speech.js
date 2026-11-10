// 🎧 كلام من ملف صوت ← كروت على الشاشة بنفس الصوت
// التفريغ من Gemini (llm.js transcribeSpeech). القرآن عمره ما بيتعرض من التفريغ:
// بنلاقي الآيات في المصحف (Q.findFragments) ونعرض نص المصحف بالظبط، والكلام العادي بيبقى «نص خاص» تقدر تعدّله.
import * as Q from './quran.js';
import * as WT from './words.js';

// «1:23» أو «83» أو «1:02:03» ← ثواني
export function parseTime(s) {
  const t = String(s ?? '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[،,]/g, '.');
  if (!t) return NaN;
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(t)) return NaN;
  return t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// طاقة الصوت كل 20ms (قناة واحدة)
function energy(buf, a, b) {
  const sr = buf.sampleRate, d = buf.getChannelData(0), hop = Math.round(sr * 0.02);
  const i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(d.length, Math.floor(b * sr));
  const out = [];
  for (let i = i0; i + hop <= i1; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += d[k] * d[k];
    out.push(s / hop);
  }
  return out;
}

// أهدى نقطة حوالين t (عشان القصة ماتقعش في نص كلمة — توقيت Gemini تقريبي)
export function snap(buf, t, win = 0.6) {
  const a = Math.max(0, t - win), b = Math.min(buf.duration, t + win);
  const e = energy(buf, a, b);
  if (e.length < 3) return Math.max(0, Math.min(buf.duration, t));
  // متوسط متحرك 100ms
  let best = 0, bestV = Infinity;
  for (let i = 0; i < e.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(e.length - 1, i + 2); k++) { s += e[k]; n++; }
    const v = s / n * (1 + 0.15 * Math.abs(a + i * 0.02 - t)); // نفضّل الأقرب لو متساويين تقريبًا
    if (v < bestV) { bestV = v; best = i; }
  }
  return a + best * 0.02 + 0.01;
}

// تقسيم مقطع طويل لأجزاء ≤ max ثانية عند أهدى نقطة (عشان حد الطلب في Gemini)
export function chunkCuts(buf, a, b, max = 300) {
  const cuts = [a];
  let pos = a;
  while (b - pos > max) {
    const t = snap(buf, pos + max - 20, 20);
    cuts.push(t);
    pos = t;
  }
  cuts.push(b);
  return cuts;
}

// جزء من البافر ← WAV مونو 16kHz (base64) للتفريغ
export async function wav16k(buf, a, b) {
  const dur = b - a;
  const off = new OfflineAudioContext(1, Math.ceil(dur * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, a, dur);
  const r = await off.startRendering();
  const d = r.getChannelData(0), n = d.length, v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  const u = new Uint8Array(v.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

const nWords = (s, a) => WT.words(Q.ayahText(s, a)).length;

// كمّل كل جزء كلمة كلمة على الآيات اللي جنبه (الآيات القصيرة زي «اللَّهُ الصَّمَدُ» مابتتلاقاش لوحدها)
// u = هياكل كلمات التفريغ؛ الأجزاء فيها u1/u2 (من 1)
// تطابق متسامح لكلمة على حرف الآية: نفس الهيكل، أو بعد شيل الحروف المكررة (لل/ل)
const squeeze = w => String(w).replace(/(.)\1+/g, '$1');
const same = (a, b) => a === b || (a && b && squeeze(a) === squeeze(b));
function extendFrags(frags, u) {
  const used = new Uint8Array(u.length);
  for (const f of frags) for (let k = f.u1 - 1; k < f.u2; k++) used[k] = 1;
  const W = (s, a) => WT.words(Q.ayahText(s, a)).map(Q.skel);
  const out = frags.map(f => ({ ...f }));
  const added = [];
  for (const f of out) {
    // لقدام
    let s = f.s, a = f.a, w = f.w2, k = f.u2, cur = f;
    while (k < u.length && !used[k]) {
      let na = a, nw = w + 1;
      if (nw > W(s, a).length) { na = a + 1; nw = 1; if (na > Q.surah(s).count) break; }
      if (!same(W(s, na)[nw - 1], u[k])) break;
      used[k] = 1;
      if (na === cur.a) { cur.w2 = nw; cur.u2 = k + 1; } else { cur = { s, a: na, w1: 1, w2: 1, u1: k + 1, u2: k + 1 }; added.push(cur); }
      a = na; w = nw; k++;
    }
    // لورا
    a = f.a; w = f.w1; k = f.u1 - 2; cur = f;
    while (k >= 0 && !used[k]) {
      let pa = a, pw = w - 1;
      if (pw < 1) { pa = a - 1; if (pa < 1) break; pw = W(s, pa).length; }
      if (!same(W(s, pa)[pw - 1], u[k])) break;
      used[k] = 1;
      if (pa === cur.a) { cur.w1 = pw; cur.u1 = k + 1; } else { cur = { s, a: pa, w1: pw, w2: pw, u1: k + 1, u2: k + 1 }; added.push(cur); }
      a = pa; w = pw; k--;
    }
  }
  return [...out, ...added].sort((x, y) => x.u1 - y.u1);
}


// جمل التفريغ (بتوقيت الملف) ← عناصر:
// { kind: 'quran', s, from, to, part?, t0, t1 } — بنص المصحف
// { kind: 'text', type: 'dua'|'other', text, t0, t1 } — نص خاص
// { kind: 'hadith', text, t0, t1 } — مقفول افتراضيًا (الحديث لازم درجته تظهر)
// { kind: 'unknown', text, t0, t1 } — شكله قرآن ومش لاقيه في المصحف: مابيتحطش
export function planItems(segs) {
  // 1) جمل القرآن المتتالية بتتدوّر مع بعض (الآية ساعات بتتقسم على جملتين)،
  //    وكل كلمة ليها وقت تقريبي جوه جملتها
  const frags = [];
  const covered = segs.map(() => 0);
  const quranish = sg => sg.type === 'quran';
  for (let i = 0; i < segs.length;) {
    if (!quranish(segs[i])) { i++; continue; }
    let j = i;
    while (j + 1 < segs.length && quranish(segs[j + 1])) j++;
    const words = [];
    for (let k = i; k <= j; k++) {
      const sg = segs[k], ws = sg.text.split(/\s+/).filter(w => Q.skel(w));
      ws.forEach((w, n) => words.push({ w, seg: k,
        t0: sg.start + (sg.end - sg.start) * n / ws.length, t1: sg.start + (sg.end - sg.start) * (n + 1) / ws.length }));
    }
    const fr = Q.findFragments(words.map(x => x.w).join(' '), { loose: true });
    for (const f of extendFrags(fr.frags, words.map(x => Q.skel(x.w)))) {
      const a = words[f.u1 - 1], b = words[f.u2 - 1];
      if (!a || !b) continue;
      for (let u = f.u1 - 1; u < f.u2; u++) covered[words[u].seg]++;
      frags.push({ s: f.s, a: f.a, w1: f.w1, w2: f.w2, seg: b.seg, t0: a.t0, t1: b.t1 });
    }
    i = j + 1;
  }
  // دعاء فيه آيات («ربنا…»): بيتحوّل لنص المصحف لو أغلبه قرآن
  const frs = segs.map((sg, i) => {
    if (quranish(sg)) return covered[i] > 0;
    if (sg.type !== 'dua') return false;
    const fr = Q.findFragments(sg.text);
    if (!fr.frags.length || fr.rest > 2) return false;
    const total = fr.frags.reduce((a, f) => a + (f.w2 - f.w1 + 1), 0) || 1;
    let acc = 0;
    for (const f of fr.frags) {
      const len = f.w2 - f.w1 + 1;
      frags.push({ s: f.s, a: f.a, w1: f.w1, w2: f.w2, seg: i,
        t0: sg.start + (sg.end - sg.start) * acc / total, t1: sg.start + (sg.end - sg.start) * (acc + len) / total });
      acc += len;
    }
    return true;
  });
  frags.sort((x, y) => x.t0 - y.t0);
  // 3) دمج: نفس الآية متكمّلة على جملتين ← جزء واحد
  const merged = [];
  for (const f of frags) {
    const p = merged[merged.length - 1];
    if (p && p.s === f.s && p.a === f.a && f.w1 <= p.w2 + 1 && f.seg <= p.seg + 1) {
      p.w2 = Math.max(p.w2, f.w2); p.w1 = Math.min(p.w1, f.w1); p.t1 = f.t1; p.seg = f.seg;
    } else merged.push({ ...f });
  }
  for (const f of merged) f.whole = f.w1 === 1 && f.w2 === nWords(f.s, f.a);
  // 4) آيات كاملة متتالية ← كارت واحد
  const qItems = [];
  for (const f of merged) {
    const p = qItems[qItems.length - 1];
    if (p && !p.part && f.whole && p.s === f.s && f.a === p.to + 1 && f.seg <= p.seg + 1) {
      p.to = f.a; p.t1 = f.t1; p.seg = f.seg;
    } else {
      qItems.push({ kind: 'quran', s: f.s, from: f.a, to: f.a, part: f.whole ? null : { w1: f.w1, w2: f.w2 }, t0: f.t0, t1: f.t1, seg: f.seg });
    }
  }
  // 5) الباقي
  const items = [...qItems];
  segs.forEach((sg, i) => {
    if (frs[i]) return;
    const kind = sg.type === 'quran' ? 'unknown' : sg.type === 'hadith' ? 'hadith' : 'text';
    items.push({ kind, type: sg.type === 'dua' ? 'dua' : 'other', text: sg.text, t0: sg.start, t1: sg.end });
  });
  items.sort((a, b) => a.t0 - b.t0);
  for (const it of items) { it.on = it.kind === 'quran' || it.kind === 'text'; delete it.seg; }
  return items;
}

// حدود القص النهائية: على أهدى نقطة، ومن غير تداخل بين العناصر
export function placeCuts(buf, items, lo, hi) {
  for (const it of items) {
    it.a = snap(buf, Math.max(lo, it.t0 - 0.15), 0.5);
    it.b = snap(buf, Math.min(hi, it.t1 + 0.2), 0.7);
  }
  for (let i = 0; i + 1 < items.length; i++) {
    const x = items[i], y = items[i + 1];
    if (x.b > y.a) { const m = snap(buf, (x.b + y.a) / 2, 0.35); x.b = m; y.a = m; }
  }
  for (const it of items) {
    it.a = Math.max(lo, it.a); it.b = Math.min(hi, it.b);
    if (it.b - it.a < 0.4) it.on = false;
  }
  return items;
}

// نص المصحف لعنصر قرآن (للعرض في القايمة)
export function quranText(it) {
  if (it.part) return WT.words(Q.ayahText(it.s, it.from)).slice(it.part.w1 - 1, it.part.w2).join(' ');
  const t = [];
  for (let a = it.from; a <= it.to; a++) t.push(Q.ayahText(it.s, a));
  return t.join(' ۝ ');
}
