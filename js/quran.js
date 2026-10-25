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

// ترجمات إضافية من نفس المصدر (QuranEnc عن طريق quran-json على jsDelivr)
export const TRANSLATIONS = [
  { code: '', name: 'بدون ترجمة' },
  { code: 'muyassar', name: '📖 التفسير الميسّر (عربي)' },
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
const stripHtml = t => String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

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
const skel = w => strip(w).replace(/[اءٱ]/g, '').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[^\u0621-\u064A]/g, '').replace(/وه$/, 'ه');
let wordIndex = null;
// بيدوّر على أطول جزء متصل (3 كلمات أو أكتر) من النص موجود في آية واحدة — حتى لو النص فيه كلام زيادة
// (عنوان، «صدق الله العظيم»، مصدر…). بيرجّع { s, a, w1, w2, u1, u2, whole, all }:
// w1..w2 أرقام الكلمات في الآية، u1..u2 مكانها في النص، all = النص كله هو الجزء ده
export function findFragment(text) {
  const u = String(text || '').split(/\s+/).map(skel).filter(Boolean);
  if (u.length < 3 || u.length > 150) return null;
  if (!wordIndex) {
    wordIndex = [];
    data.verses.forEach((vs, si) => vs.forEach((v, ai) => wordIndex.push({ s: si + 1, a: ai + 1, w: v[0].split(/\s+/).map(skel) })));
  }
  let best = null;
  const prev = new Uint16Array(u.length + 1), cur = new Uint16Array(u.length + 1);
  for (const it of wordIndex) {
    const A = it.w;
    prev.fill(0);
    for (let i = 1; i <= A.length; i++) {
      cur[0] = 0;
      for (let j = 1; j <= u.length; j++) {
        cur[j] = A[i - 1] === u[j - 1] ? prev[j - 1] + 1 : 0;
        const len = cur[j];
        if (len >= 3 && (!best || len > best.len)) best = { s: it.s, a: it.a, w1: i - len + 1, w2: i, u1: j - len + 1, u2: j, len, n: A.length };
      }
      prev.set(cur);
    }
  }
  if (!best) return null;
  best.all = best.len === u.length;
  // لو النص فيه كلام تاني كتير: لازم الجزء يبقى واضح (5 كلمات، أو أغلب النص) عشان مانقولش إن دعاء عادي آية
  if (!best.all && best.len < 5 && best.len < u.length * 0.6) return null;
  best.whole = best.w1 === 1 && best.w2 === best.n;
  return best;
}

// علامات الوقف في المصحف: ۖ ۗ ۚ ۛ ۜ = وقف جائز أو لازم، ۙ = لا تقف
export const WAQF_STOP = /[\u06D6\u06D7\u06D8\u06DA\u06DB\u06DC]/;
export const WAQF_NO = /\u06D9/;

export const arabicNum = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
