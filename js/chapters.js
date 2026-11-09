// ⏱️ فصول يوتيوب (Chapters) من توقيت الآيات الحقيقي في الفيديو
// العنوان = السورة + رقم الآيات + أول كلمات الآية من نص المصحف نفسه (من غير ما الذكاء الاصطناعي يكتب كلام عن المعاني)
// شروط يوتيوب: أول فصل 00:00، ٣ فصول على الأقل، وكل فصل ١٠ ثواني أو أكتر
import * as Q from './quran.js';

const MIN = 10;
export const stamp = t => {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
};
const firstWords = (s, a, n = 5) => {
  const w = Q.ayahText(s, a).split(/\s+/).filter(x => x && !/^[ۖ-ۭ]+$/.test(x));
  return w.slice(0, n).join(' ') + (w.length > n ? '…' : '');
};

// segments فيها start (بعد buildTimeline) — بيرجّع { lines, text, error }
export function youtubeChapters(segments, duration) {
  const segs = segments.filter(s => s.start != null && s.kind !== 'bumper');
  // نقط البداية الممكنة: أول كل آية، وأول كل دعاء/حديث/ذكر
  const pts = [];
  for (const s of segs) {
    if (s.kind === 'ayah') {
      const last = pts[pts.length - 1];
      if (last?.kind === 'ayah' && last.s === s.s && last.a === s.a) continue;
      pts.push({ kind: 'ayah', s: s.s, a: s.a, t: s.start });
    } else if (['zikr', 'hadith'].includes(s.kind)) pts.push({ kind: s.kind, t: s.start, label: s.label || (s.kind === 'hadith' ? 'حديث' : 'ذكر') });
  }
  if (!pts.length) return { error: 'مفيش آيات أو أدعية في الفيديو' };
  const target = Math.max(20, Math.min(240, duration / 12));
  const chaps = [];
  for (const p of pts) {
    const cur = chaps[chaps.length - 1];
    if (!cur) { chaps.push({ ...p, t: 0, end: p }); continue; }
    const since = p.t - cur.t;
    const newSurah = p.kind === 'ayah' && (cur.kind !== 'ayah' || cur.s !== p.s);
    const newKind = p.kind !== 'ayah' || cur.kind !== 'ayah';
    if (since >= MIN && (newSurah || newKind || since >= target)) chaps.push({ ...p, end: p });
    else if (p.kind === cur.kind && (p.kind !== 'ayah' || p.s === cur.s)) cur.end = p;
  }
  // آخر فصل لازم يبقى ١٠ ثواني لحد آخر الفيديو
  while (chaps.length > 1 && duration - chaps[chaps.length - 1].t < MIN) {
    const x = chaps.pop(), prev = chaps[chaps.length - 1];
    if (x.kind === 'ayah' && prev.kind === 'ayah' && prev.s === x.s) prev.end = x.end;
  }
  const title = c => {
    if (c.kind !== 'ayah') return c.label;
    const sn = `سورة ${Q.surah(c.s).ar}`, b = c.end?.a ?? c.a;
    const range = b > c.a ? `${Q.arabicNum(c.a)}–${Q.arabicNum(b)}` : Q.arabicNum(c.a);
    return `${sn} (${range}) ﴿${firstWords(c.s, c.a)}﴾`;
  };
  const lines = chaps.map(c => `${stamp(c.t)} ${title(c)}`);
  if (lines.length < 3) return { lines, error: 'يوتيوب محتاج ٣ فصول على الأقل، كل واحد ١٠ ثواني — الفيديو ده قصير، الفصول بتنفع في الفيديوهات الطويلة (سورة كاملة مثلًا).' };
  return { lines, text: '⏱️ الفصول\n' + lines.join('\n') };
}
