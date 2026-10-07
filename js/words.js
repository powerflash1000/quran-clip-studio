// توقيت ظهور كل كلمة مع التلاوة
// - للقراء اللي ليهم رقم على Quran.com: توقيت دقيق لكل كلمة من Quran.com (ومعاه ملف الصوت بتاعهم عشان التوقيت يطابق)
// - لأي حاجة تانية: تقسيم تقريبي للمدة على الكلمات حسب طول كل كلمة
import { fetchJson } from './net.js';

export const words = text => String(text).split(/[ \t\n]+/).filter(Boolean);

const chapterCache = new Map();

// بيرجع Map: رقم الآية → { url, segments: [[رقم الكلمة, من ms, إلى ms], ...] }
export function quranComChapter(recitationId, surah) {
  const key = `${recitationId}:${surah}`;
  if (!chapterCache.has(key)) {
    chapterCache.set(key, fetchJson([
      `https://api.quran.com/api/v4/recitations/${recitationId}/by_chapter/${surah}?per_page=300`,
    ]).then(j => {
      const map = new Map();
      for (const f of j.audio_files || []) {
        const ayah = Number(String(f.verse_key).split(':')[1]);
        let url = f.url || '';
        if (url.startsWith('//')) url = 'https:' + url;
        else if (!/^https?:/.test(url)) url = 'https://verses.quran.com/' + url.replace(/^\/+/, '');
        // الصيغة ممكن تكون [كلمة, من, إلى] أو [ترتيب, كلمة, من, إلى]؛ بناخد آخر 3 أرقام
        const segments = (f.segments || [])
          .filter(sg => Array.isArray(sg) && sg.length >= 3)
          .map(sg => sg.slice(-3).map(Number));
        map.set(ayah, { url, segments });
      }
      return map;
    }).catch(e => { chapterCache.delete(key); throw e; }));
  }
  return chapterCache.get(key);
}

// توقيت دقيق من Quran.com؛ بيرجع null لو البيانات مش مطابقة لعدد الكلمات
export function timesFromSegments(segments, wordCount, trimStart = 0) {
  if (!segments?.length || !wordCount) return null;
  const starts = new Array(wordCount).fill(null);
  for (const [w, s] of segments) {
    if (w >= 1 && w <= wordCount && starts[w - 1] == null) starts[w - 1] = s / 1000 - trimStart;
  }
  const known = starts.filter(v => v != null).length;
  if (known < wordCount * 0.7) return null; // بيانات ناقصة أو عدد الكلمات مختلف
  // نملا الفراغات بالتقريب بين الكلمة اللي قبلها واللي بعدها
  for (let i = 0; i < wordCount; i++) {
    if (starts[i] != null) continue;
    const prev = i > 0 ? starts[i - 1] : 0;
    let j = i + 1;
    while (j < wordCount && starts[j] == null) j++;
    const next = j < wordCount ? starts[j] : prev + 0.4 * (j - i);
    starts[i] = prev + (next - prev) / (j - i + 1);
  }
  return monotonic(starts.map(t => Math.max(0, t)));
}

// تقسيم تقريبي: كل كلمة ليها وقت على قد طولها (من غير التشكيل)
const bare = w => w.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ٠-٩ ]/g, '');
export function approxTimes(text, duration) {
  const ws = words(text);
  if (!ws.length) return [];
  const weights = ws.map(w => bare(w).length + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = duration * 0.94;
  let acc = 0;
  return ws.map((_, i) => {
    const t = (acc / total) * usable;
    acc += weights[i];
    return t;
  });
}

function monotonic(ts) {
  for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1] + 0.05) ts[i] = ts[i - 1] + 0.05;
  return ts;
}

// كام كلمة المفروض تكون ظاهرة عند الثانية t (من بداية المقطع)
export function shownAt(wordTimes, t) {
  let n = 0;
  while (n < wordTimes.length && wordTimes[n] <= t + 0.02) n++;
  return n;
}
