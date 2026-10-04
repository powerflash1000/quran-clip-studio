import { fetchJson } from './net.js';

// المصدر: https://github.com/fawazahmed0/hadith-api (مجاني ومن غير مفتاح)
export const COLLECTIONS = [
  { id: 'bukhari', name: 'صحيح البخاري', cite: 'رواه البخاري', sahihByDefault: true },
  { id: 'muslim', name: 'صحيح مسلم', cite: 'رواه مسلم', sahihByDefault: true },
  { id: 'nawawi', name: 'الأربعون النووية', cite: 'الأربعون النووية' },
  { id: 'qudsi', name: 'الأحاديث القدسية (الأربعون)', cite: 'حديث قدسي' },
  { id: 'abudawud', name: 'سنن أبي داود', cite: 'رواه أبو داود' },
  { id: 'tirmidhi', name: 'جامع الترمذي', cite: 'رواه الترمذي' },
  { id: 'nasai', name: 'سنن النسائي', cite: 'رواه النسائي' },
  { id: 'ibnmajah', name: 'سنن ابن ماجه', cite: 'رواه ابن ماجه' },
  { id: 'malik', name: 'موطأ مالك', cite: 'رواه مالك في الموطأ' },
];

export const collection = id => COLLECTIONS.find(c => c.id === id);

const bases = path => [
  `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/${path}`,
  `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/${path}`,
];

export async function getHadith(colId, number, withEnglish = false) {
  const ar = await fetchJson(bases(`editions/ara-${colId}/${number}.min.json`))
    .catch(() => fetchJson(bases(`editions/ara-${colId}/${number}.json`)));
  const h = ar.hadiths?.[0];
  if (!h) throw new Error('الحديث غير موجود');
  let english = '';
  if (withEnglish) {
    try {
      const en = await fetchJson(bases(`editions/eng-${colId}/${number}.min.json`));
      english = en.hadiths?.[0]?.text || '';
    } catch { /* الترجمة اختيارية */ }
  }
  return { colId, number, text: h.text.trim(), english, grades: h.grades || [], reference: h.reference };
}

// البحث بكلمة: بيحمّل الكتاب كله مرة واحدة (حجمه من 50KB لـ 9MB)
const bookCache = new Map();

export async function searchHadith(colId, query, limit = 30) {
  if (!bookCache.has(colId)) {
    bookCache.set(colId, fetchJson(bases(`editions/ara-${colId}.min.json`)).catch(e => { bookCache.delete(colId); throw e; }));
  }
  const book = await bookCache.get(colId);
  const q = normalize(query);
  if (q.length < 2) return [];
  const out = [];
  for (const h of book.hadiths) {
    if (normalize(h.text).includes(q)) {
      out.push({ number: h.hadithnumber, text: h.text, grades: h.grades || [] });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function normalize(t) {
  return (t || '')
    .replace(/[ؐ-ًؚ-ٰٟ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .trim();
}

// استخراج المتن من غير السند: أول كلام بين علامتي تنصيص (أو من أول علامة لآخر النص).
// ده تخمين، والمستخدم بيراجع النص ويعدّله قبل التصدير.
export function extractMatn(text) {
  const t = text.replace(/[‏‎]/g, '').trim();
  const first = t.indexOf('"');
  if (first === -1) return t;
  const next = t.indexOf('"', first + 1);
  const matn = (next === -1 ? t.slice(first + 1) : t.slice(first + 1, next)).trim().replace(/[\s.،]+$/, '');
  if (matn.length < 8) return t;
  return 'قال رسول الله ﷺ: «' + matn + '»';
}

// ===== درجة الحديث =====
const GRADE_AR = [
  [/maudu|mawdu|fabricated/i, 'موضوع', 'bad'],
  [/munkar/i, 'منكر', 'bad'],
  [/shadh/i, 'شاذ', 'bad'],
  [/da'?if|daif|da‘if|weak/i, 'ضعيف', 'bad'],
  [/hasan\s*sahih/i, 'حسن صحيح', 'good'],
  [/sahih/i, 'صحيح', 'good'],
  [/hasan/i, 'حسن', 'good'],
];

export function translateGrade(g) {
  for (const [re, ar] of GRADE_AR) if (re.test(g)) return ar;
  return g;
}

// يرجع { label, level: 'good' | 'bad' | 'unknown', details: [...] }
export function assessGrade(colId, grades) {
  const col = collection(colId);
  if (!grades || grades.length === 0) {
    if (col?.sahihByDefault) return { label: 'صحيح', level: 'good', details: [col.name] };
    return { label: 'غير محددة', level: 'unknown', details: [] };
  }
  const details = grades.map(g => `${g.name}: ${translateGrade(g.grade)}`);
  const levels = grades.map(g => {
    for (const [re, , lvl] of GRADE_AR) if (re.test(g.grade)) return lvl;
    return 'unknown';
  });
  const anyBad = levels.includes('bad');
  const anyGood = levels.includes('good');
  if (anyBad && !anyGood) return { label: 'ضعيف', level: 'bad', details };
  if (anyBad && anyGood) return { label: 'مختلف في درجته', level: 'bad', details };
  if (anyGood) return { label: translateGrade(grades.find((g, i) => levels[i] === 'good').grade), level: 'good', details };
  return { label: 'غير محددة', level: 'unknown', details };
}
