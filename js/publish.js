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
  includeText: false,        // نص الآيات كامل في الوصف (السطر الأول فيه مقتطف دايمًا)
  includeTranslation: true,
  includeCredits: false,     // المصادر واسم القارئ — مقفولة: الوصف عام ومن غير تكرار
};

// الإعدادات القديمة كانت بتكتب المصادر والنص كامل؛ النسخة ٢ بتبدأ نضيفة مرة واحدة
export const getPublishSettings = () => {
  const saved = load('publish', {});
  if (!saved.v) { Object.assign(saved, { includeCredits: false, includeText: false, v: 2 }); save('publish', saved); }
  return { ...DEFAULTS, ...saved };
};
export const setPublishSettings = s => save('publish', { ...getPublishSettings(), ...s, v: 2 });

// أسماء مشهورة لبعض المقاطع
const FAMOUS = [
  { s: 2, from: 255, to: 255, name: 'آية الكرسي' },
  { s: 2, from: 285, to: 286, name: 'خواتيم سورة البقرة' },
  { s: 59, from: 22, to: 24, name: 'خواتيم سورة الحشر' },
];

const tag = t => '#' + String(t).replace(/\(.*?\)/g, '').trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
const N = Q.arabicNum;
const plain = t => String(t || '').replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي');
const words = (t, n) => { const w = String(t).replace(/[ۖ-ۜ۞۩]/g, '').split(/\s+/).filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };

// موضوع المقطع من كلمات الآيات نفسها (من غير ذكاء اصطناعي) — أول تطابق هو الأقوى
const TOPICS = [
  { rx: /نبا|قصص|اذ قال|ابني ادم|فلما|قالوا يا/, name: 'قصة من القرآن', tag: 'قصص_القرآن', kw: 'قصص القرآن' },
  { rx: /^ربنا|^رب |ربنا لا|ربنا اتنا|رب اغفر|رب اشرح/, name: 'دعاء من القرآن', tag: 'دعاء_من_القرآن', kw: 'أدعية من القرآن' },
  { rx: /تطمئن القلوب|ذكر الله|السكينه|لا تحزن|يسرا|اليسر/, name: 'آيات الطمأنينة', tag: 'راحة_نفسية', kw: 'راحة نفسية' },
  { rx: /الصبر|اصبروا|الصابرين|صبر/, name: 'آيات الصبر', tag: 'آيات_الصبر', kw: 'آيات عن الصبر' },
  { rx: /غفور|يغفر|المغفره|التوبه|توبوا|رحمه|الرحيم/, name: 'آيات الرحمة والمغفرة', tag: 'رحمة_الله', kw: 'آيات الرحمة' },
  { rx: /الجنه|جنات|الفردوس|نعيم/, name: 'آيات عن الجنة', tag: 'الجنة', kw: 'آيات عن الجنة' },
  { rx: /القيامه|الساعه|النار|جهنم|الصور|يوم الدين/, name: 'آيات عن يوم القيامة', tag: 'يوم_القيامة', kw: 'آيات مؤثرة' },
  { rx: /السماوات|الارض|الليل|النهار|خلق/, name: 'آيات من عظمة الخلق', tag: 'تدبر_القرآن', kw: 'تدبر القرآن' },
];
const topicOf = text => TOPICS.find(t => t.rx.test(plain(text).replace(/\s+/g, ' ')));

// مقتطف للسطر الأول: آية قصيرة كاملة، وإلا الجملة اللي بتخلص عند علامة وقف (غالبًا خلاصة الآية
// زي «ألا بذكر الله تطمئن القلوب»)، وإلا أول كلمات أول آية — كله من نص المصحف كما هو
const WAQF = /[ۖ-ۛ]/;
const clean = t => t.replace(/[ۖ-ۜ۞۩]/g, '').replace(/\s+/g, ' ').trim();
const wc = t => clean(t).split(' ').filter(Boolean).length;
function hookAyah(b) {
  let short = null;
  for (let a = b.from; a <= b.to; a++) { const t = Q.ayahText(b.surah, a); if (wc(t) >= 4 && t.length <= 60 && (!short || t.length < short.length)) short = t; }
  if (short) return clean(short);
  for (let a = b.from; a <= b.to; a++) {
    const segs = Q.ayahText(b.surah, a).split(WAQF).map(clean).filter(Boolean);
    if (segs.length > 1) { const last = segs[segs.length - 1]; if (wc(last) >= 3 && wc(last) <= 10) return last; }
  }
  return words(Q.ayahText(b.surah, b.from), 9);
}

// دعوات للإرسال والحفظ (أقوى إشارتين) — من غير وعود ولا «اكتب آمين»
const CTA = {
  quran: ['ابعتها لحد محتاجها النهارده 🌿 واحفظها عشان ترجعلها', 'احفظها وارجعلها كل ما قلبك يتعب 🤍 وابعتها لحد بتحبه', 'شاركها مع حد محتاج يسمعها النهارده 🌿'],
  dua: ['احفظ الدعاء ده وادعي بيه 🤍 وابعته لحد محتاجه', 'ابعته لحد بتحبه وادعوا لبعض 🌿'],
  hadith: ['احفظه واعمل بيه 🤍 وابعته لحد ينتفع بيه'],
};
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…';
}

// يرجع { title, caption, tags } لكل منصة — نفس الشكل في كل مكان (النشر والسلاسل والتصدير):
// ١) سطر يشد: مقتطف من الآية + موضوعها  ٢) كلمات البحث  ٣) دعوة للإرسال/الحفظ  ٤) هاشتاجات قليلة مرتبطة
// من غير اسم القارئ ولا المصادر (إلا لو فعّلت «ذكر المصادر»)
// series (اختياري): { index, total } لو المقطع جزء من سلسلة
export async function generate(blocks, style, translationOf, series = null) {
  // وصف «لوحة للتلفزيون» بس لما تعلّم عليه بنفسك (مش من شكل الفيديو)
  if (style?.tvPublish) return tvArt(blocks, style);
  const ps = getPublishSettings();
  const quran = blocks.filter(b => b.type === 'quran');
  const hadith = blocks.filter(b => b.type === 'hadith');
  const zikr = blocks.filter(b => b.type === 'zikr');
  const allText = [...quran.flatMap(b => { const t = []; for (let a = b.from; a <= b.to; a++) t.push(Q.ayahText(b.surah, a)); return t; }), ...zikr.map(z => z.text || ''), ...hadith.map(h => h.text || '')].join(' ');
  const topic = topicOf(allText);
  const seed = quran[0] ? quran[0].surah * 1000 + quran[0].from : (allText.length || 1);

  // ===== السطر الأول + العنوان =====
  let hook, title, kind;
  if (quran.length) {
    kind = 'quran';
    const b = quran[0], s = Q.surah(b.surah);
    const famous = FAMOUS.find(f => f.s === b.surah && f.from === b.from && f.to === b.to);
    const whole = b.from === 1 && b.to === s.count;
    const about = famous ? famous.name : topic ? topic.name : 'آيات تريح القلب';
    hook = `﴿${famous ? words(Q.ayahText(b.surah, b.from), 8) : hookAyah(b)}﴾ 🤍\n${about} من سورة ${s.ar}`;
    title = series
      ? `سورة ${s.ar} | الجزء ${N(series.index)} من ${N(series.total)} | ${about}`
      : whole ? `سورة ${s.ar} كاملة | تلاوة خاشعة تريح القلب`
        : famous ? `${famous.name} | تلاوة خاشعة تريح القلب`
          : `﴿${words(hookAyah(b), 6)}﴾ | ${about} | سورة ${s.ar}`;
  } else if (zikr.length) {
    kind = 'dua';
    const z = zikr[0];
    hook = `«${words(z.text || '', 12)}» 🤍`;
    title = `${words(z.text || '', 8)} | ${z.custom ? (z.label || 'دعاء') : z.cat}`;
  } else if (hadith.length) {
    kind = 'hadith';
    const h = hadith[0];
    hook = `«${words(h.text || '', 14)}» 🤍`;
    title = `${words(h.text || '', 8)} | حديث شريف`;
  } else {
    kind = 'quran';
    hook = 'آيات تريح القلب 🤍';
    title = 'تلاوة خاشعة تريح القلب';
  }
  // (وصف «لوحة للتلفزيون» بقى اختيار صريح — tvArt() فوق — مش من شكل الفيديو)

  // ===== كلمات البحث (سطر واحد) =====
  const kw = [];
  if (quran.length) {
    kw.push('تلاوة خاشعة', topic?.kw || 'راحة نفسية', 'قرآن قبل النوم');
    for (const b of quran) kw.push(`سورة ${Q.surah(b.surah).ar}`);
  } else if (zikr.length) kw.push('دعاء', 'أذكار', topic?.kw || 'راحة نفسية');
  else kw.push('حديث شريف', 'السنة النبوية');
  const kwLine = [...new Set(kw)].join(' | ');

  // ===== النص الكامل (اختياري) =====
  const body = [];
  if (ps.includeText) {
    for (const b of blocks) {
      if (b.type === 'quran') {
        const ayat = [], trs = [];
        for (let a = b.from; a <= b.to; a++) {
          ayat.push(`${Q.ayahText(b.surah, a)} ${N(a)}`);
          if (ps.includeTranslation && style.showTranslation && style.translation) {
            try { trs.push(await translationOf(style.translation, b.surah, a)); } catch { /* اختياري */ }
          }
        }
        body.push(`﴿${ayat.join(' ')}﴾`);
        if (trs.length) body.push(trs.join(' '));
      } else if (b.text) body.push(b.text);
    }
  }

  // ===== سطور لازمة بس =====
  const info = [];
  // إفصاح مطلوب على يوتيوب وغيره لو فيه صوت مولّد بالذكاء الاصطناعي
  if ([...hadith, ...zikr].some(b => b.audioMode === 'ai')) info.push('🔊 صوت قراءة الحديث مولّد بتقنية الذكاء الاصطناعي (نسخة من صوتي)');
  else if ([...hadith, ...zikr].some(b => b.audioMode === 'gtts')) info.push('🔊 صوت القراءة مولّد بتقنية الذكاء الاصطناعي');
  if (series) {
    info.push(series.index < series.total
      ? `📌 الجزء ${N(series.index)} من ${N(series.total)} — تابع باقي الأجزاء`
      : `📌 الجزء الأخير — السلسلة كاملة على القناة`);
  }
  const credits = [];
  if (ps.includeCredits) {
    if (quran.length) {
      const custom = quran.find(b => b.rec?.name);
      const r = custom ? custom.rec.name : findReciter(style.reciter)?.name?.replace(/\s*\(.*?\)\s*/g, '');
      if (r) credits.push(`🎙️ ${r}`);
      credits.push('نص المصحف: مجمع الملك فهد (QuranEnc)');
    }
    if (hadith.length) credits.push(`📚 ${hadith.map(h => `${collection(h.col).cite} (${N(h.number)}) • ${assessGrade(h.col, h.grades).label}`).join(' — ')}`);
  }

  // ===== هاشتاجات قليلة ومرتبطة =====
  const base = [];
  if (quran.length) {
    base.push('#قرآن_كريم', '#تلاوة_خاشعة');
    base.push(tag('سورة ' + Q.surah(quran[0].surah).ar));
    base.push('#' + (topic?.tag || 'راحة_نفسية'));
  } else if (zikr.length) base.push('#دعاء', '#أذكار', '#' + (topic?.tag || 'راحة_نفسية'), '#ذكر_الله');
  else base.push('#حديث_شريف', '#السنة_النبوية', '#ذكر_الله');
  const user = ps.extraHashtags.split(/[\s,،]+/).filter(Boolean).map(h => (h.startsWith('#') ? h : '#' + h));
  const cta = pick(CTA[kind], seed);

  const out = {};
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const hs = [...new Set([...(p.extra || []), ...base, ...user])].slice(0, Math.min(p.hashtags, 4 + (p.extra?.length || 0) + user.length));
    const head = [hook, kwLine].join('\n');
    const tail = [cta, info.join('\n'), ps.signature, credits.join('\n'), hs.join(' ')].filter(Boolean).join('\n\n');
    const room = p.captionMax - head.length - tail.length - 4;
    const text = body.length && room > 40 ? clip(body.join('\n\n'), room) : '';
    const caption = [head, text, tail].filter(Boolean).join('\n\n');

    const res = { caption: clip(caption, p.captionMax) };
    if (p.title) {
      let t = title;
      if (id === 'shorts' && t.length + 8 <= p.titleMax) t += ' #shorts';
      res.title = clip(t, p.titleMax);
    }
    if (p.tags) {
      const ws = [...new Set([...kw, ...base.map(h => h.replace(/^#/, '').replace(/_/g, ' ')), ...user.map(h => h.replace(/^#/, ''))])];
      if (quran.length) ws.push('قرآن كريم', 'تلاوة قرآن', 'quran recitation');
      let tags = '';
      for (const w of [...new Set(ws)]) {
        const next = tags ? `${tags}, ${w}` : w;
        if (next.length > p.tagsMax) break;
        tags = next;
      }
      res.tags = tags;
    }
    // اسم الصوت المقترح (تيك توك / إنستجرام)
    if (id === 'tiktok' || id === 'instagram') res.sound = quran.length ? `تلاوة خاشعة – سورة ${Q.surah(quran[0].surah).ar}${topic ? ' – ' + topic.name : ''}` : (zikr.length ? 'دعاء يريح القلب' : 'حديث شريف');
    out[id] = res;
  }
  return out;
}

// ===== 🖼️ لوحة للتلفزيون (TV Art Frame) =====
// عنوان عربي + كلمات البحث العالمية (TV Art / Frame TV / Screensaver) ومدة النسخة الطويلة،
// وصف عربي وإنجليزي بيقول إنها لوحة للشاشة، وتاجز TV Art — زي قنوات اللوحات
const FRAME_EN = { gold: 'Golden Frame', thin: 'Minimal Gold Frame', black: 'Black & Gold Frame', white: 'White Gallery Frame' };
const FRAME_AR = { gold: 'برواز دهبي', thin: 'برواز دهبي رفيع', black: 'برواز أسود بحافة دهبي', white: 'برواز أبيض زي المعارض' };
const durEn = m => (m >= 60 ? `${m / 60 === 1 ? '1 Hour' : `${+(m / 60).toFixed(1)} Hours`}` : `${m} Minutes`);
const durAr = m => ({ 30: 'نص ساعة', 60: 'ساعة', 120: 'ساعتين', 180: '٣ ساعات' }[m] || `${N(m)} دقيقة`);
function tvArt(blocks, style) {
  const quran = blocks.filter(b => b.type === 'quran');
  const zikr = blocks.filter(b => b.type !== 'quran' && b.text);
  const mins = Number(style.tvMins) || 120, silent = !!style.tvSilent;
  const hd = style.quality === '2160' ? '4K' : style.quality === '720' ? 'HD' : 'Full HD';
  const fr = style.frame || 'gold';
  let ar, verse = '', ref = '';
  if (quran.length) {
    const b = quran[0], s = Q.surah(b.surah);
    const famous = FAMOUS.find(f => f.s === b.surah && f.from === b.from && f.to === b.to);
    ar = famous ? famous.name : b.from === 1 && b.to === s.count ? `سورة ${s.ar}` : `﴿${words(hookAyah(b), 6)}﴾`;
    const t = []; for (let a = b.from; a <= Math.min(b.to, b.from + 4); a++) t.push(`${Q.ayahText(b.surah, a)} ${N(a)}`);
    verse = `﴿${t.join(' ')}${b.to > b.from + 4 ? ' …' : ''}﴾`;
    ref = `سورة ${s.ar} ${b.from === b.to ? N(b.from) : `${N(b.from)}–${N(b.to)}`}`;
  } else if (zikr.length) {
    ar = words(zikr[0].text, 6);
    verse = `«${zikr[0].text.trim()}»`;
  } else ar = 'لوحة إسلامية';
  const kind = quran.length ? 'Quran Verse' : 'Islamic Dua';
  const tail = `${durEn(mins)} ${hd}${silent ? ' (No Sound)' : ''} ✨`;
  let title = `${ar} | ${kind} TV Art – Islamic Calligraphy ${FRAME_EN[fr] || 'Frame'} ${tail}`;
  if (title.length > 100) title = `${ar} | ${kind} TV Art – ${FRAME_EN[fr] || 'Frame'} ${tail}`;
  if (title.length > 100) title = `${ar} | Islamic TV Art ${tail}`;
  title = clip(title, 100);
  const descAr = `${verse}${ref ? `
— ${ref}` : ''}

🖼️ لوحة ${quran.length ? 'قرآنية' : 'إسلامية'} للتلفزيون (TV Art Frame): ${quran.length ? (quran[0].to > quran[0].from ? 'آيات' : 'آية') : 'ذكر'} بخط عربي جميل في ${FRAME_AR[fr] || 'برواز'}، بحركة هادية جدًا${silent ? '، من غير صوت' : ' وتلاوة هادية'}.
شغّلها على شاشة البيت كأنها لوحة متعلقة على الحيطة — للصالة والمجلس وأوقات الهدوء ورمضان.
⏱️ المدة: ${durAr(mins)} • ${hd} • 16:9`;
  const descEn = `🖼️ ${kind} TV Art for your Smart TV — elegant Arabic calligraphy in a ${(FRAME_EN[fr] || 'frame').toLowerCase()} with very slow, gentle motion${silent ? ', no sound' : ' and calm Quran recitation'}. Turn your TV into a piece of Islamic wall art: perfect as a TV screensaver or art mode for your living room, Ramadan gatherings or quiet moments.
${durEn(mins)} • ${hd} • 16:9`;
  const hs = ['#tvart', '#islamicart', '#tvscreensaver', '#frametv', '#islamiccalligraphy'];
  const tags = ['tv art', 'frame tv art', 'tv screensaver', 'smart tv art', 'art mode', 'islamic tv art', 'islamic art', 'islamic wall art', 'quran calligraphy', 'arabic calligraphy', 'islamic screensaver', 'ramadan decor', 'tv wallpaper',
    quran.length ? `surah ${Q.surah(quran[0].surah).en || ''}`.trim() : 'islamic dua', 'لوحة قرآنية', 'لوحات إسلامية', 'خلفية تلفزيون', 'آيات قرآنية', 'خط عربي',
    ...(quran.length ? [`سورة ${Q.surah(quran[0].surah).ar}`] : ['دعاء'])].filter(Boolean);
  const out = {};
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const short = id !== 'youtube';
    const caption = short
      ? `${verse}${ref ? `
— ${ref}` : ''}

🖼️ لوحة للتلفزيون (TV Art) — النسخة الكاملة ${durAr(mins)} على يوتيوب 🤍

${[...(p.extra || []), ...hs.slice(0, 4)].join(' ')}`
      : `${descAr}

${descEn}

${hs.slice(0, 3).join(' ')}`;
    const res = { caption: clip(caption, p.captionMax) };
    if (p.title) res.title = id === 'shorts' ? clip(`${ar} | Islamic TV Art ✨ #shorts`, 100) : title;
    if (p.tags) { let t = ''; for (const w of [...new Set(tags)]) { const n = t ? `${t}, ${w}` : w; if (n.length > p.tagsMax) break; t = n; } res.tags = t; }
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
