// توقيت ظهور كل كلمة مع التلاوة
// - للقراء اللي ليهم رقم على Quran.com: توقيت دقيق لكل كلمة من Quran.com (ومعاه ملف الصوت بتاعهم عشان التوقيت يطابق)
// - توقيت quran-align (CC BY 4.0) محفوظ جوه البرنامج لـ 12 تلاوة من EveryAyah — بيشتغل من غير أي API
// - لأي حاجة تانية: تقسيم تقريبي للمدة على الكلمات حسب طول كل كلمة
import { fetchJson } from './net.js';

export const words = text => String(text).split(/[ \t\n]+/).filter(Boolean);

const chapterCache = new Map();

// ===== quran-align: data/wbw/<فولدر EveryAyah>/<السورة>.json → { "رقم الآية": [بداية كل كلمة بالـ 1/100 ثانية، -1 = مش معروفة] }
export const ALIGNED = new Set([
  'Abdul_Basit_Mujawwad_128kbps', 'Abdul_Basit_Murattal_64kbps', 'Abdurrahmaan_As-Sudais_192kbps',
  'Abu_Bakr_Ash-Shaatree_128kbps', 'Alafasy_128kbps', 'Hani_Rifai_192kbps', 'Husary_64kbps',
  'Husary_Muallim_128kbps', 'Minshawy_Mujawwad_192kbps', 'Minshawy_Murattal_128kbps',
  'Mohammad_al_Tablaway_128kbps', 'Saood_ash-Shuraym_128kbps',
]);

// اسم ملف التوقيت للقارئ (نفس التسجيل ممكن يكون بجودة صوت مختلفة على EveryAyah)
export const alignFolder = reciter => reciter?.align || (ALIGNED.has(reciter?.everyayah) ? reciter.everyayah : null);

const alignCache = new Map();
export function alignChapter(folder, surah) {
  const key = `${folder}/${surah}`;
  if (!alignCache.has(key)) {
    alignCache.set(key, fetch(`data/wbw/${folder}/${surah}.json`)
      .then(r => { if (!r.ok) throw new Error('no align data'); return r.json(); })
      .catch(e => { alignCache.delete(key); throw e; }));
  }
  return alignCache.get(key);
}

// بيحوّل بدايات الكلمات لنفس صيغة Quran.com [رقم الكلمة, من ms, إلى ms] عشان نستخدم نفس الحساب
export async function alignSegments(folder, surah, ayah) {
  const starts = (await alignChapter(folder, surah))[ayah];
  if (!starts) return null;
  const segs = [];
  starts.forEach((cs, i) => { if (cs >= 0) segs.push([i + 1, cs * 10, cs * 10]); });
  return segs;
}

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
