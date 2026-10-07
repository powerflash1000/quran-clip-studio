// توليد العنوان والوصف والهاشتاجات لكل منصة (من قوالب ثابتة — من غير ذكاء اصطناعي)
import * as Q from './quran.js';
import { findReciter } from './reciters.js';
import { collection, assessGrade } from './hadith.js';
import { load, save } from './storage.js';

// الحدود الرسمية وقت كتابة الكود؛ captionMax لتيك توك متحفظ (الحد الفعلي ممكن يكون أكبر)
export const PLATFORMS = {
  youtube: { name: 'يوتيوب', title: true, titleMax: 100, captionMax: 5000, tags: true, tagsMax: 500, hashtags: 8 },
  shorts: { name: 'يوتيوب شورتس', title: true, titleMax: 100, captionMax: 5000, tags: true, tagsMax: 500, hashtags: 6, extra: ['#shorts'] },
  tiktok: { name: 'تيك توك', captionMax: 2200, hashtags: 8 },
  instagram: { name: 'إنستجرام', captionMax: 2200, hashtags: 5 },
  facebook: { name: 'فيسبوك', captionMax: 5000, hashtags: 5 },
};

const DEFAULTS = {
  signature: '',
  extraHashtags: '',
  includeText: true,
  includeTranslation: true,
  includeCredits: true,
};

export const getPublishSettings = () => ({ ...DEFAULTS, ...load('publish', {}) });
export const setPublishSettings = s => save('publish', { ...getPublishSettings(), ...s });

// أسماء مشهورة لبعض المقاطع
const FAMOUS = [
  { s: 2, from: 255, to: 255, name: 'آية الكرسي' },
  { s: 2, from: 285, to: 286, name: 'خواتيم سورة البقرة' },
  { s: 59, from: 22, to: 24, name: 'خواتيم سورة الحشر' },
];

const tag = t => '#' + String(t).replace(/\(.*?\)/g, '').trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
const reciterShort = r => r.name.replace(/\s*\(.*?\)\s*/g, '').replace(/^مخصص:\s*/, '').trim();
const N = Q.arabicNum;

function rangeLabel(b) {
  return b.from === b.to ? `الآية ${N(b.from)}` : `الآيات ${N(b.from)}–${N(b.to)}`;
}

function quranTitle(b, reciter, extra) {
  const s = Q.surah(b.surah);
  const famous = FAMOUS.find(f => f.s === b.surah && f.from === b.from && f.to === b.to);
  const whole = b.from === 1 && b.to === s.count;
  const what = famous ? famous.name : whole ? `سورة ${s.ar} كاملة` : `سورة ${s.ar} | ${rangeLabel(b)}`;
  return `${what}${extra} | ${reciterShort(reciter)}`;
}

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…';
}

// يرجع { title, caption, tags } لكل منصة
// series (اختياري): { index, total } لو المقطع جزء من سلسلة
export async function generate(blocks, style, translationOf, series = null) {
  const ps = getPublishSettings();
  const reciter = findReciter(style.reciter);
  const quran = blocks.filter(b => b.type === 'quran');
  const hadith = blocks.filter(b => b.type === 'hadith');
  const zikr = blocks.filter(b => b.type === 'zikr');

  // ===== العنوان =====
  let title;
  if (quran.length) {
    const extra = (quran.length > 1 ? ' وآيات أخرى' : '') + (hadith.length ? ' + حديث شريف' : '');
    title = series
      ? `سورة ${Q.surah(quran[0].surah).ar} | الجزء ${N(series.index)} من ${N(series.total)} (${rangeLabel(quran[0])}) | ${reciterShort(reciter)}`
      : quranTitle(quran[0], reciter, extra);
  } else if (hadith.length) {
    const h = hadith[0];
    title = `حديث شريف | ${collection(h.col).name} ${N(h.number)}`;
  } else if (zikr.length) {
    const first = zikr[0].text.replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' ');
    title = `${zikr[0].cat} | ${first}…`;
  } else {
    title = 'تلاوة قرآنية';
  }

  // ===== أجزاء الوصف =====
  const body = [];   // النصوص (الآيات والأحاديث) — أول حاجة بتتقص لو الوصف طويل
  const info = [];   // معلومات المقطع
  for (const b of blocks) {
    if (b.type === 'quran') {
      const s = Q.surah(b.surah);
      if (ps.includeText) {
        const ayat = [];
        const trs = [];
        for (let a = b.from; a <= b.to; a++) {
          ayat.push(`${Q.ayahText(b.surah, a)} ${N(a)}`);
          if (ps.includeTranslation && style.showTranslation && style.translation) {
            try { trs.push(await translationOf(style.translation, b.surah, a)); } catch { /* اختياري */ }
          }
        }
        body.push(`﴿${ayat.join(' ')}﴾`);
        if (trs.length) body.push(trs.join(' '));
      }
      info.push(`📖 سورة ${s.ar} • ${rangeLabel(b)}`);
    } else if (b.type === 'zikr') {
      if (ps.includeText && b.text) body.push(b.text);
      info.push(`📿 ${b.cat}${b.count > 1 ? ` — يُقال ${N(b.count)} ${b.count <= 10 ? 'مرات' : 'مرة'}` : ''}${b.ref ? ` (${b.ref})` : ''}`);
    } else {
      const col = collection(b.col);
      const g = assessGrade(b.col, b.grades);
      if (ps.includeText && b.text) body.push(b.text);
      info.push(`📚 ${col.cite} (${N(b.number)}) • الدرجة: ${g.label}`);
    }
  }
  if (quran.length) info.push(`🎙️ بصوت القارئ: ${reciterShort(reciter)}`);
  // إفصاح مطلوب على يوتيوب وغيره لو فيه صوت مولّد بالذكاء الاصطناعي
  if ([...hadith, ...zikr].some(b => b.audioMode === 'ai')) info.push('🔊 صوت قراءة الحديث مولّد بتقنية الذكاء الاصطناعي (نسخة من صوتي)');
  if (series) {
    info.push(series.index < series.total
      ? `📌 الجزء ${N(series.index)} من ${N(series.total)} — تابع باقي الأجزاء في قائمة التشغيل`
      : `📌 الجزء الأخير (${N(series.total)} من ${N(series.total)}) — السلسلة كاملة في قائمة التشغيل`);
  }

  const credits = [];
  if (ps.includeCredits) {
    if (quran.length) credits.push('نص المصحف: مجمع الملك فهد (QuranEnc) • التلاوة: EveryAyah.com');
    if (hadith.length) credits.push('نص الحديث: hadith-api (fawazahmed0)');
    if (zikr.length) credits.push('الأذكار: حصن المسلم');
  }

  // ===== الهاشتاجات =====
  const base = [];
  if (quran.length) {
    base.push('#قرآن', '#القرآن_الكريم', '#تلاوة');
    for (const b of quran) base.push(tag('سورة ' + Q.surah(b.surah).ar));
    base.push(tag(reciterShort(reciter)));
  }
  if (zikr.length) {
    base.push('#أذكار', '#دعاء', '#ذكر_الله', '#حصن_المسلم');
    for (const b of zikr) base.push(tag(b.cat));
  }
  if (hadith.length) {
    base.push('#حديث', '#السنة_النبوية');
    for (const b of hadith) base.push(tag(collection(b.col).name));
  }
  const user = ps.extraHashtags.split(/[\s,،]+/).filter(Boolean).map(h => (h.startsWith('#') ? h : '#' + h));
  const latin = quran.length ? ['#quran', '#islam'] : zikr.length && !hadith.length ? ['#dua', '#islam'] : ['#hadith', '#islam'];

  const out = {};
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const hs = [...new Set([...(p.extra || []), ...user, ...base, ...latin])].slice(0, p.hashtags);
    const tail = [info.join('\n'), ps.signature, credits.join('\n'), hs.join(' ')].filter(Boolean).join('\n\n');
    const room = p.captionMax - tail.length - 2;
    const text = body.length && room > 40 ? clip(body.join('\n\n'), room) : '';
    const caption = [text, tail].filter(Boolean).join('\n\n');

    const res = { caption: clip(caption, p.captionMax) };
    if (p.title) {
      let t = title;
      if (id === 'shorts' && t.length + 8 <= p.titleMax) t += ' #shorts';
      res.title = clip(t, p.titleMax);
    }
    if (p.tags) {
      const words = [...new Set([...base, ...user, ...latin].map(h => h.replace(/^#/, '').replace(/_/g, ' ')))];
      if (quran.length) words.push('قران كريم', 'تلاوة خاشعة', 'quran recitation');
      let tags = '';
      for (const w of words) {
        const next = tags ? `${tags}, ${w}` : w;
        if (next.length > p.tagsMax) break;
        tags = next;
      }
      res.tags = tags;
    }
    out[id] = res;
  }
  return out;
}

// مشاركة ملف لتطبيقات الموبايل (تيك توك، إنستجرام، ...) لو المتصفح بيدعم ده
export function canShareFile(file) {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

export async function shareFile(file, text) {
  await navigator.share({ files: [file], text });
}
