import { fetchJson } from './net.js';

let data = null;
let prefix = null; // prefix[s] = عدد الآيات قبل السورة s (لحساب رقم الآية العام)

export async function loadQuran() {
  if (data) return data;
  const res = await fetch('data/quran.json');
  data = await res.json();
  prefix = [0];
  for (const s of data.surahs) prefix.push(prefix[prefix.length - 1] + s.count);
  return data;
}

export const surahs = () => data.surahs;
export const surah = n => data.surahs[n - 1];
export const ayahText = (s, a) => data.verses[s - 1][a - 1][0];
export const ayahEnglish = (s, a) => data.verses[s - 1][a - 1][1];
export const globalAyah = (s, a) => prefix[s - 1] + a;

export const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

// ===== شكل الكتابة في الفيديو: «رسم المصحف» (العثماني — الافتراضي) أو «إملائي حديث»
// الإملائي = نص Tanzil «Simple» بالتشكيل (من غير أي تعديل في الكلمات)، متقسّم على كلمات المصحف العثماني
// (عشان «جزء من آية» وظهور الكلمات مع التلاوة يفضلوا مظبوطين). الآيات اللي ما اتطابقتش بتفضل بالرسم العثماني.
export const BASMALA_IMLAEI = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
let imlaei = null, imlaeiP = null, script = 'uthmani';
export function loadImlaei() {
  if (!imlaeiP) imlaeiP = fetch('data/quran-imlaei.json').then(r => r.json()).then(j => { imlaei = j.verses; })
    .catch(e => { imlaeiP = null; throw e; });
  return imlaeiP;
}
export async function setScript(v) {
  script = v === 'imlaei' ? 'imlaei' : 'uthmani';
  if (script === 'imlaei') await loadImlaei();
}
export const scriptOf = () => script;
// قطع العرض لكل كلمة من كلمات المصحف (null = اعرض الرسم العثماني)
export const showPieces = (s, a) => (script === 'imlaei' && imlaei && imlaei[s - 1]?.[a - 1]) || null;
export const showText = (s, a) => { const p = showPieces(s, a); return p ? p.filter(Boolean).join(' ') : ayahText(s, a); };
export const showSlice = (s, a, w1, w2) => {
  const p = showPieces(s, a) || String(ayahText(s, a)).split(/[ \t\n]+/).filter(Boolean);
  return p.slice(w1 - 1, w2).filter(Boolean).join(' ');
};
export const showBasmala = () => script === 'imlaei' && imlaei ? BASMALA_IMLAEI : BASMALA;

// ترجمات إضافية من نفس المصدر (QuranEnc عن طريق quran-json على jsDelivr)
export const TRANSLATIONS = [
  { code: '', name: 'بدون ترجمة' },
  { code: 'muyassar', name: '📖 التفسير الميسّر (عربي)' },
  { code: 'mukhtasar', name: '📖 المختصر في التفسير (عربي)' },
  { code: 'jalalayn', name: '📖 تفسير الجلالين (عربي)' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ur', name: 'اردو' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ru', name: 'Русский' },
  { code: 'sv', name: 'Svenska' },
  { code: 'zh', name: '中文' },
];

const trCache = new Map();

// التفسير الميسّر (مجمع الملك فهد) — من مصدرين مفتوحين، بالسورة كلها مرة واحدة
const tafsirCache = new Map();
// أول آية في بعض الكتب فيها مقدمة السورة (تسميتها ومقاصدها) قبل «[التفسير]» — بناخد التفسير نفسه بس
const onlyTafsir = t => { const s = String(t || ''); const i = s.indexOf('[التفسير]'); return i >= 0 ? s.slice(i + 9) : s; };
const stripHtml = t => onlyTafsir(String(t || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// كتب التفسير (نص عربي من spa5k/tafsir_api — مصدره Quran.com). القصيرة تنفع تحت الآية في الفيديو، والطويلة للقراية والنسخ
export const TAFSIRS = [
  { code: 'muyassar', slug: 'ar-tafsir-muyassar', name: 'التفسير الميسّر', by: 'مجمع الملك فهد', short: true },
  { code: 'mukhtasar', slug: 'ar-tafsir-al-mukhtasar', name: 'المختصر في التفسير', by: 'مركز تفسير للدراسات القرآنية', short: true },
  { code: 'jalalayn', slug: 'ar-tafsir-al-jalalayn', name: 'تفسير الجلالين', by: 'المحلّي والسيوطي', short: true },
  { code: 'saadi', slug: 'ar-tafseer-al-saddi', name: 'تفسير السعدي', by: 'عبد الرحمن السعدي' },
  { code: 'wasit', slug: 'ar-tafsir-al-wasit', name: 'التفسير الوسيط', by: 'محمد سيد طنطاوي' },
  { code: 'baghawi', slug: 'ar-tafsir-al-baghawi', name: 'تفسير البغوي', by: 'البغوي' },
  { code: 'ibnkathir', slug: 'ar-tafsir-ibn-kathir', name: 'تفسير ابن كثير', by: 'ابن كثير' },
  { code: 'qurtubi', slug: 'ar-tafseer-al-qurtubi', name: 'تفسير القرطبي', by: 'القرطبي' },
  { code: 'tabari', slug: 'ar-tafsir-al-tabari', name: 'تفسير الطبري', by: 'الطبري' },
];
export const tafsirInfo = code => TAFSIRS.find(t => t.code === code);

// بيرجع { text, from } — from = رقم الآية اللي التفسير مكتوب عندها (بعض الكتب بتفسّر كذا آية مع بعض)
const tafCache = new Map();
export async function tafsirOf(code, s, a) {
  const t = tafsirInfo(code);
  if (!t) return { text: '', from: a };
  const key = `${t.slug}:${s}`;
  if (!tafCache.has(key)) {
    tafCache.set(key, fetchJson([
      `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${t.slug}/${s}.json`,
      `https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir/${t.slug}/${s}.json`,
    ]).then(j => {
      const map = new Map();
      for (const it of (Array.isArray(j) ? j : j.ayahs || [])) map.set(Number(it.ayah), onlyTafsir(String(it.text || '').replace(/<[^>]+>/g, '')).trim());
      return map;
    }).catch(e => { tafCache.delete(key); throw e; }));
  }
  const map = await tafCache.get(key);
  for (let k = a; k >= 1 && k >= a - 12; k--) if (map.get(k)) return { text: map.get(k), from: k };
  return { text: '', from: a };
}

async function muyassar(s, a) {
  if (!tafsirCache.has(s)) {
    tafsirCache.set(s, (async () => {
      const map = new Map();
      try {
        const j = await fetchJson([
          `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/ar-tafsir-muyassar/${s}.json`,
          `https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir/ar-tafsir-muyassar/${s}.json`,
        ]);
        const arr = j.ayahs || j.verses || j.tafsirs || (Array.isArray(j) ? j : []);
        for (const it of arr) map.set(Number(it.ayah ?? it.verse ?? it.ayah_number), stripHtml(it.text));
      } catch { /* جرّب Quran.com */ }
      if (!map.size) {
        const j = await fetchJson(`https://api.quran.com/api/v4/tafsirs/16/by_chapter/${s}?per_page=300`);
        for (const it of j.tafsirs || []) map.set(Number(String(it.verse_key).split(':')[1]), stripHtml(it.text));
      }
      return map;
    })().catch(e => { tafsirCache.delete(s); throw e; }));
  }
  return (await tafsirCache.get(s)).get(a) || '';
}

export async function translation(code, s, a) {
  if (!code) return '';
  if (code === 'muyassar') return muyassar(s, a);
  if (tafsirInfo(code)) { const r = await tafsirOf(code, s, a); return r.from === a ? r.text.replace(/\s+/g, ' ') : ''; }
  if (code === 'en') return ayahEnglish(s, a);
  const key = `${code}:${s}`;
  if (!trCache.has(key)) {
    trCache.set(key, fetchJson([
      `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/${code}/${s}.json`,
      `https://unpkg.com/quran-json@3.1.2/dist/chapters/${code}/${s}.json`,
    ]).catch(e => { trCache.delete(key); throw e; }));
  }
  const ch = await trCache.get(key);
  return ch.verses[a - 1]?.translation || '';
}

// بحث بسيط في نص القرآن (من غير تشكيل) وفي الترجمة الإنجليزية
const strip = t => t
  .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g, '')
  .replace(/[ٱأإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/ـ/g, '');

let index = null;

export function search(query, limit = 50) {
  const q = strip(query.trim()).toLowerCase();
  if (q.length < 2) return [];
  if (!index) {
    index = [];
    data.verses.forEach((vs, si) => vs.forEach((v, ai) => {
      index.push({ s: si + 1, a: ai + 1, ar: strip(v[0]), en: v[1].toLowerCase() });
    }));
  }
  const out = [];
  for (const it of index) {
    if (it.ar.includes(q) || it.en.includes(q)) {
      out.push({ s: it.s, a: it.a });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// جزء من آية: بيدوّر على النص (3 كلمات أو أكتر) جوه آية واحدة، ويرجّع { s, a, w1, w2 } (أرقام الكلمات من 1)
// المقارنة على «هيكل» الكلمة: من غير تشكيل ولا ألفات ولا همزات، عشان الرسم العثماني يطابق الإملاء العادي
// (الصلوة/الصلاة، الزكوة/الزكاة، الحيوة/الحياة: الواو قبل التاء المربوطة بتتشال من الناحيتين)
// الرسم العثماني بيكتب ىٰ / وٰ مكان الألف في نص الكلمة: «وَضُحَىٰهَا» = «وضحاها»، «ٱلصَّلَوٰةَ» = «الصلاة»
// (في آخر الكلمة زي «عَلَىٰ» بتفضل ى زي الإملائي). و«ٱلَّيۡلِ» في المصحف بلام واحدة = «الليل».
// والهمزة بكل كراسيها (ء ؤ ئ) بتتشال: «جَزَٰٓؤُاْ» = «جزاء»، «ٱلسَّيِّـَٔاتِ» = «السيئات»
export const skel = w => strip(String(w).replace(/[\u0649\u0648]\u0670(?=[\u0621-\u064A])/g, 'ا')).replace(/[اءٱؤئ]/g, '').replace(/[^\u0621-\u064A]/g, '').replace(/وه$/, 'ه').replace(/للي/g, 'لي');
let wordIndex = null;
function buildWordIndex() {
  if (!wordIndex) {
    wordIndex = [];
    data.verses.forEach((vs, si) => vs.forEach((v, ai) => wordIndex.push({ s: si + 1, a: ai + 1, w: v[0].split(/\s+/).map(skel) })));
  }
}

// أطول جزء متصل من u (مع تجاهل الكلمات المستخدمة) موجود جوه آية واحدة
function longestRun(u, used) {
  let best = null;
  const prev = new Uint16Array(u.length + 1), cur = new Uint16Array(u.length + 1);
  for (const it of wordIndex) {
    const A = it.w;
    prev.fill(0);
    for (let i = 1; i <= A.length; i++) {
      cur[0] = 0;
      for (let j = 1; j <= u.length; j++) {
        cur[j] = !used[j - 1] && A[i - 1] === u[j - 1] ? prev[j - 1] + 1 : 0;
        const len = cur[j];
        if (len >= 3 && (!best || len > best.len)) best = { s: it.s, a: it.a, w1: i - len + 1, w2: i, u1: j - len + 1, u2: j, len, n: A.length };
      }
      prev.set(cur);
    }
  }
  return best;
}

const RABBANA = new Set(['ربن', 'رب']);
// كل أجزاء القرآن اللي في النص (كل سطر لوحده عشان مانوصلش سطرين ببعض)، بترتيب ظهورها.
// كل جزء: { s, a, w1, w2, whole } — ولو الكلمة اللي قبل الجزء في الآية «ربنا» أو «رب» بنضمها
// (صور الأدعية بتكتب «ربنا» في عمود لوحده). rest = عدد الكلمات اللي مش من القرآن
export function findFragments(text, opt = {}) {
  const lines = String(text || '').split(/\n+/).map(l => l.split(/\s+/).map(skel).filter(Boolean)).filter(l => l.length);
  const total = lines.reduce((a, l) => a + l.length, 0);
  if (total < 3 || total > 400) return { frags: [], rest: total };
  buildWordIndex();
  const frags = [];
  let used = 0, order = 0;
  for (const u of lines) {
    const mask = new Uint8Array(u.length);
    const found = [];
    for (;;) {
      const r = longestRun(u, mask);
      // جزء قصير جوه سطر أغلبه مش قرآن: غالبًا دعاء عادي فيه كلمات تشبه آية
      // (opt.loose: نص كله قرآن متفرّغ من صوت — أي ٣ كلمات متصلة تتقبل)
      if (!r || (!opt.loose && r.len < 5 && r.len < u.length * 0.6)) break;
      for (let k = r.u1 - 1; k < r.u2; k++) mask[k] = 1;
      const A = wordIndex.find(x => x.s === r.s && x.a === r.a).w;
      if (r.w1 > 1 && RABBANA.has(A[r.w1 - 2])) {
        r.w1--;
        if (r.u1 > 1 && u[r.u1 - 2] === A[r.w1 - 1]) { mask[r.u1 - 2] = 1; r.u1--; }
      }
      found.push(r);
    }
    for (const r of found.sort((x, y) => x.u1 - y.u1)) frags.push({ s: r.s, a: r.a, w1: r.w1, w2: r.w2, whole: r.w1 === 1 && r.w2 === r.n, order: order++, u1: r.u1, u2: r.u2 });
    used += mask.reduce((a, v) => a + v, 0);
  }
  // سطور «ربنا» لوحدها اتحسبت مع الأجزاء
  const rest = lines.reduce((a, l) => a + l.filter(w => !RABBANA.has(w)).length, 0) - frags.reduce((a, f) => a + (f.w2 - f.w1 + 1), 0) + 0;
  return { frags, rest: Math.max(0, rest), used };
}

// علامات الوقف في المصحف: ۖ ۗ ۚ ۛ ۜ = وقف جائز أو لازم، ۙ = لا تقف
export const WAQF_STOP = /[\u06D6\u06D7\u06D8\u06DA\u06DB\u06DC]/;
export const WAQF_NO = /\u06D9/;

export const arabicNum = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
