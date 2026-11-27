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
  return { colId, number, text: h.text.trim(), english, grades: h.grades || [], reference: h.reference, famous: h.arabicnumber || '' };
}

// البحث بكلمة: بيحمّل الكتاب كله مرة واحدة (حجمه من 50KB لـ 9MB)
const bookCache = new Map();

function loadBook(colId) {
  if (!bookCache.has(colId)) {
    bookCache.set(colId, fetchJson(bases(`editions/ara-${colId}.min.json`)).then(book => {
      // نسخة متطبّعة من كل حديث مرة واحدة (البحث بعد كده فوري)
      book.norm = book.hadiths.map(h => normalize(h.text));
      return book;
    }).catch(e => { bookCache.delete(colId); throw e; }));
  }
  return bookCache.get(colId);
}

// البحث: كل الكلمات لازم تكون موجودة (بأي ترتيب)، والجملة بالظبط بتطلع الأول
function match(book, query, limit) {
  const q = normalize(query);
  const words = q.split(' ').filter(w => w.length >= 2);
  if (!words.length) return [];
  const exact = [], loose = [];
  book.hadiths.forEach((h, i) => {
    const t = book.norm[i];
    if (!words.every(w => t.includes(w))) return;
    (t.includes(q) ? exact : loose).push({ number: h.hadithnumber, famous: h.arabicnumber || '', text: h.text, grades: h.grades || [], exact: t.includes(q) });
  });
  return [...exact, ...loose].slice(0, limit);
}

// الرقم المشهور (زي ما مكتوب في جوجل والدرر السنية — ترقيم عبد الباقي في مسلم مثلًا) ← رقم الحديث في ترقيم البرنامج
export async function findFamous(colId, famous) {
  const book = await loadBook(colId);
  const n = String(famous).trim();
  const h = book.hadiths.find(x => String(x.arabicnumber ?? '').trim() === n) || book.hadiths.find(x => parseInt(x.arabicnumber, 10) === parseInt(n, 10));
  return h ? h.hadithnumber : null;
}

export async function searchHadith(colId, query, limit = 30) {
  return match(await loadBook(colId), query, limit);
}

// 🔎 البحث في كل الكتب مرة واحدة: بيحمّل الكتب (٣ في نفس الوقت) ويرجّع النتايج كتاب كتاب أول ما يجهز
// onBook({col, results, done, total, error}) — بيرجّع كل النتايج مرتبة (الجملة بالظبط الأول، وبترتيب الكتب)
export async function searchHadithAll(query, { perBook = 12, onBook } = {}) {
  const all = [];
  let done = 0, i = 0;
  const worker = async () => {
    while (i < COLLECTIONS.length) {
      const c = COLLECTIONS[i++];
      let results = [], error = null;
      try { results = match(await loadBook(c.id), query, perBook).map(r => ({ ...r, col: c.id })); } catch (e) { error = e.message || String(e); }
      all.push(...results);
      done++;
      onBook?.({ col: c.id, results, done, total: COLLECTIONS.length, error });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const order = Object.fromEntries(COLLECTIONS.map((c, k) => [c.id, k]));
  return all.sort((a, b) => (b.exact - a.exact) || order[a.col] - order[b.col]);
}

function normalize(t) {
  return (t || '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\u0621-\u064A0-9a-z ]+/gi, ' ').replace(/\s+/g, ' ')
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
