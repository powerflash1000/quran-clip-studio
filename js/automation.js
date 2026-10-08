// أدوات الأتمتة: قراءة قايمة مقاطع مكتوبة بإيد المستخدم + روابط التضمين الرسمية للفيديو المرجعي

const AR_DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };

const SKIP_WORDS = new Set(['سورة', 'سوره', 'الآيات', 'الايات', 'آيات', 'ايات', 'الآية', 'الاية', 'آية', 'اية', 'من', 'surah', 'sura']);
const TO_WORDS = new Set(['الى', 'إلى', 'لحد', 'ل', 'to']);

export const normName = t => t
  .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
  .replace(/[ٱأإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[ـ\s'`’\-]/g, '')
  .toLowerCase()
  .replace(/^(ال|al|an|ar|as|at|ad|adh|az|ash)(?=.{3})/, '');

function findSurah(name, surahs) {
  const q = normName(name);
  if (!q) return null;
  const keys = surahs.map(s => [s, normName(s.ar), normName(s.tr)]);
  return (keys.find(([, a, t]) => a === q || t === q)
    || keys.find(([, a, t]) => a.startsWith(q) || t.startsWith(q))
    || [null])[0];
}

// كل سطر مقطع: «يوسف 4-6» أو «2:255» أو «الملك ١-٤» أو «سورة الإخلاص» (السورة كلها)
export function parseRefs(text, surahs) {
  const ok = [], bad = [];
  for (const raw of text.split(/[\n،;؛]+/)) {
    const line = raw.trim();
    if (!line) continue;
    let t = line.replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d])
      .replace(/[–—~]/g, '-')
      .split(/\s+/)
      .map(w => (TO_WORDS.has(w) ? '-' : w))
      .filter(w => !SKIP_WORDS.has(w))
      .join(' ')
      .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
      .trim();
    let surah = null, from = null, to = null;
    let m = t.match(/^(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
    if (m) {
      surah = surahs[Number(m[1]) - 1];
      from = Number(m[2]);
      to = m[3] ? Number(m[3]) : from;
    } else if ((m = t.match(/^(.*?[^\d\s-].*?)\s*(?:(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/))) {
      surah = findSurah(m[1], surahs);
      if (m[2]) { from = Number(m[2]); to = m[3] ? Number(m[3]) : from; }
    } else if ((m = t.match(/^(\d{1,3})$/))) {
      surah = surahs[Number(m[1]) - 1];
    }
    if (!surah) { bad.push(line); continue; }
    if (from == null) { from = 1; to = surah.count; }
    if (to < from) [from, to] = [to, from];
    if (from < 1 || to > surah.count) { bad.push(line); continue; }
    ok.push({ surah: surah.n, from, to, line });
  }
  return { ok, bad };
}

// التضمين الرسمي (Embed) — الفيديو بيفضل على منصته، ومحتاج يكون عام
export function embedFor(link) {
  let u;
  try { u = new URL(link.trim()); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|web)\./, '');
  if (h.endsWith('tiktok.com')) {
    const m = u.pathname.match(/\/video\/(\d+)/);
    if (m) return { platform: 'tiktok', name: 'تيك توك', src: `https://www.tiktok.com/embed/v2/${m[1]}`, url: u.href };
    return { platform: 'tiktok', name: 'تيك توك', url: u.href, error: 'ده لينك مختصر. افتحه في المتصفح وانسخ اللينك الكامل اللي فيه /video/ ورقم.' };
  }
  if (h === 'instagram.com') {
    const m = u.pathname.match(/\/(reels?|p|tv)\/([\w-]+)/);
    if (m) return { platform: 'instagram', name: 'إنستجرام', src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, url: u.href };
  }
  if (h === 'facebook.com' || h === 'fb.watch') {
    return { platform: 'facebook', name: 'فيسبوك', src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u.href)}&show_text=false`, url: u.href };
  }
  // Pinterest: التضمين الرسمي للـ Pin (للإلهام بس — الصور هناك ملك أصحابها)
  if (h.endsWith('pinterest.com') || h.startsWith('pinterest.') || h === 'pin.it') {
    const m = u.pathname.match(/\/pin\/(?:[\w-]*--)?(\d+)/);
    if (m) return { platform: 'pinterest', name: 'Pinterest', src: `https://assets.pinterest.com/ext/embed.html?id=${m[1]}`, url: u.href };
    return { platform: 'pinterest', name: 'Pinterest', url: u.href, error: 'افتح الـ Pin في المتصفح وانسخ اللينك اللي فيه /pin/ ورقم.' };
  }
  let yt = null;
  if (h === 'youtu.be') yt = u.pathname.slice(1);
  else if (h.endsWith('youtube.com')) yt = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1];
  if (yt) return { platform: 'youtube', name: 'يوتيوب', src: `https://www.youtube.com/embed/${yt}`, url: u.href };
  return null;
}
