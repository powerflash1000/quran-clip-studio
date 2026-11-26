// ✨ الكلمة المفتاحية: في كل آية/دعاء كلمة واحدة (أو اتنين في النص الطويل) هي قلب المعنى، وبتنوّر لحظة ما بتتقال.
// الاختيار بالترتيب: اختيارك بإيدك ← اختيار الذكاء (محفوظ) ← قاموس معاني جوه البرنامج (بيشتغل من غير نت ولا مفتاح).
// النص نفسه مابيتغيّرش أبدًا — بنحدد رقم الكلمة بس.

import { load, save } from './storage.js';

// ألوان كل معنى: core = لون الحروف وهي منوّرة، glow = لون الهالة
export const KEY_CATS = {
  mercy:   { name: 'رحمة ومغفرة وجنة', core: '#fff0bf', glow: '#f2b440' },
  light:   { name: 'نور وهداية',        core: '#fffdf5', glow: '#8fd0ff' },
  water:   { name: 'ماء ومطر وبحر',     core: '#e3f6ff', glow: '#3fa9ff' },
  fire:    { name: 'نار وعذاب',          core: '#ffd9b0', glow: '#ff4d12' },
  growth:  { name: 'زرع وشجر وأرض',     core: '#e8ffd6', glow: '#4fcf6a' },
  sky:     { name: 'سما وليل ونجوم',     core: '#eef1ff', glow: '#8d9cff' },
  heart:   { name: 'قلب وصبر وشكر',      core: '#ffe6ec', glow: '#ff7d9c' },
  majesty: { name: 'جلال وعظمة وحمد',    core: '#fff3cf', glow: '#d9a62e' },
};

// ===== تطبيع الكلمة العربي (من غير تشكيل ولا علامات وقف، والألفات واحدة) =====
export function bare(w) {
  return String(w || '')
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^ء-ي]/g, '');
}
// الكلمة من غير «و/ف» و«ال/بال/لل/…» في أولها — بنجرّب كل الاحتمالات
function forms(w) {
  const out = new Set([w]);
  const add = x => { if (x.length >= 2) out.add(x); };
  for (const a of [w, w.replace(/^[وف]/, '')]) {
    add(a);
    for (const p of ['بال', 'كال', 'فال', 'وال', 'لل', 'ال', 'ب', 'ل', 'ك']) if (a.startsWith(p) && a.length - p.length >= 2) add(a.slice(p.length));
  }
  return [...out];
}

// قاموس المعاني: [بداية الكلمة, المعنى]. الأولوية بترتيب KEY_PRI (الصور القوية الأول، و«الله/رب» آخر حاجة)
const DICT = [
  // نار
  ['نار', 'fire'], ['جهنم', 'fire'], ['عذاب', 'fire'], ['سعير', 'fire'], ['جحيم', 'fire'], ['حريق', 'fire'], ['لظي', 'fire'], ['سقر', 'fire'],
  // ماء
  ['ماء', 'water'], ['مطر', 'water'], ['بحر', 'water'], ['انهار', 'water'], ['نهر', 'water'], ['غيث', 'water'], ['سحاب', 'water'], ['عيون', 'water'], ['ودق', 'water'], ['ماءا', 'water'], ['فرات', 'water'], ['كوثر', 'water'],
  // نور
  ['نور', 'light'], ['هدي', 'light'], ['هدى', 'light'], ['اهد', 'light'], ['يهد', 'light'], ['ضياء', 'light'], ['سراج', 'light'], ['فجر', 'light'], ['صبح', 'light'], ['اشرق', 'light'], ['مصباح', 'light'],
  // زرع
  ['زرع', 'growth'], ['شجر', 'growth'], ['نبات', 'growth'], ['انبت', 'growth'], ['ثمر', 'growth'], ['نوي', 'growth'], ['حبه', 'growth'], ['سنبل', 'growth'], ['نخل', 'growth'], ['زيتون', 'growth'], ['جنتين', 'growth'],
  // سما
  ['سماء', 'sky'], ['سماوات', 'sky'], ['سموات', 'sky'], ['ليل', 'sky'], ['اليل', 'sky'], ['غاسق', 'sky'], ['صباح', 'light'], ['نجم', 'sky'], ['نجوم', 'sky'], ['قمر', 'sky'], ['شمس', 'sky'], ['كواكب', 'sky'], ['بروج', 'sky'], ['فلق', 'sky'], ['نهار', 'sky'], ['ضحي', 'sky'], ['شفق', 'sky'],
  // رحمة
  ['رحم', 'mercy'], ['يرحم', 'mercy'], ['ارحم', 'mercy'], ['رحيم', 'mercy'], ['غفر', 'mercy'], ['يغفر', 'mercy'], ['اغفر', 'mercy'], ['استغفر', 'mercy'], ['مغفر', 'mercy'], ['غفور', 'mercy'],
  ['جنه', 'mercy'], ['جنات', 'mercy'], ['فردوس', 'mercy'], ['رضوان', 'mercy'], ['فضل', 'mercy'], ['عفو', 'mercy'], ['توب', 'mercy'], ['تواب', 'mercy'], ['كريم', 'mercy'], ['بشري', 'mercy'], ['يبشر', 'mercy'], ['نعيم', 'mercy'], ['نعمه', 'mercy'], ['رزق', 'mercy'], ['فرج', 'mercy'], ['يسر', 'mercy'],
  // قلب
  ['قلب', 'heart'], ['قلوب', 'heart'], ['صبر', 'heart'], ['اصبر', 'heart'], ['صابر', 'heart'], ['شكر', 'heart'], ['ذكر', 'heart'], ['اذكر', 'heart'], ['خشع', 'heart'], ['خاشع', 'heart'], ['تقوي', 'heart'], ['اتق', 'heart'], ['يحب', 'heart'], ['حب', 'heart'], ['ود', 'heart'], ['دعاء', 'heart'], ['ادع', 'heart'], ['توكل', 'heart'], ['اطمئن', 'heart'], ['تطمئن', 'heart'], ['سكينه', 'heart'], ['امن', 'heart'], ['خوف', 'heart'], ['بكي', 'heart'],
  // جلال
  ['عظيم', 'majesty'], ['عرش', 'majesty'], ['ملك', 'majesty'], ['مالك', 'majesty'], ['عزيز', 'majesty'], ['حكيم', 'majesty'], ['قدير', 'majesty'], ['اكبر', 'majesty'], ['سبح', 'majesty'], ['حمد', 'majesty'], ['علي', 'majesty'], ['قيوم', 'majesty'], ['حي', 'majesty'], ['احد', 'majesty'], ['صمد', 'majesty'], ['رحمن', 'mercy'],
];
// كلمات لو مالقيناش غيرها
const LOW = [['الله', 'majesty'], ['لله', 'majesty'], ['بالله', 'majesty'], ['رب', 'majesty']];
const KEY_PRI = ['fire', 'water', 'light', 'growth', 'sky', 'mercy', 'heart', 'majesty'];
// كلمات ممنوعة حتى لو بتبدأ بنفس الحروف (حروف/ضماير)
const STOP = new Set(['علي', 'ملك', 'حي', 'امن', 'ود', 'حب', 'يسر', 'فضل', 'ذكر']); // بنقبلها بس لو الكلمة كلها هي نفسها مش جزء من كلمة أطول

function dictCat(word) {
  const b = bare(word);
  if (b.length < 2) return null;
  let best = null;
  for (const f of forms(b)) {
    for (const [stem, cat] of DICT) {
      const hit = STOP.has(stem) ? (f === stem || f === stem + 'ه' || f === stem + 'ا') : f.startsWith(stem);
      if (!hit) continue;
      const r = KEY_PRI.indexOf(cat);
      if (!best || r < best.r) best = { cat, r };
    }
  }
  return best?.cat || null;
}

// ===== الكلمات (نفس تقسيم words.js / التوقيت: على المسافة العادية، والـ NBSP بيفضل لازق رقم الآية) =====
export const tokens = text => String(text || '').split(/[ \t\n]+/).filter(Boolean);
const isWord = t => bare(String(t).split(' ')[0]).length >= 2;

// اختيار القاموس (بيتحفظ في الذاكرة)
const memo = new Map();
export function dictKeys(text) {
  if (memo.has(text)) return memo.get(text);
  const tk = tokens(text);
  const found = [];
  tk.forEach((t, w) => {
    if (!isWord(t)) return;
    const c = dictCat(t.split(' ')[0]);
    if (c) found.push({ w, c, r: KEY_PRI.indexOf(c) });
  });
  if (!found.length) {
    tk.forEach((t, w) => { const b = bare(t.split(' ')[0]); for (const [s, c] of LOW) if (b === s || b === 'و' + s || b === 'ف' + s) { found.push({ w, c, r: 99 }); break; } });
  }
  const want = tk.length > 18 ? 2 : 1;
  const out = found.sort((a, b) => a.r - b.r || a.w - b.w).filter((k, i, arr) => arr.findIndex(x => x.c === k.c) === i || i < want)
    .slice(0, want).map(({ w, c }) => ({ w, c })).sort((a, b) => a.w - b.w);
  memo.set(text, out);
  return out;
}

// ===== المحفوظ: اختيار الذكاء واختيارك بإيدك (localStorage) =====
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); };
let store = null;
const st = () => (store ||= load('keyWords', { ai: {}, me: {} }));
let ver = 0;
export const keysVersion = () => ver;
export function keysFor(text) {
  if (!text) return [];
  const h = hash(text), s = st();
  return s.me[h] || s.ai[h] || dictKeys(text);
}
export function keySource(text) {
  const h = hash(text), s = st();
  return s.me[h] ? 'me' : s.ai[h] ? 'ai' : 'dict';
}
function persist() { ver++; try { save('keyWords', store); } catch { /* المساحة خلصت — بيفضل في الذاكرة */ } }
export function setAiKeys(text, keys) {
  const tk = tokens(text);
  const ok = (keys || []).filter(k => Number.isInteger(k.w) && k.w >= 0 && k.w < tk.length && isWord(tk[k.w]) && KEY_CATS[k.c]).slice(0, 2);
  if (ok.length) st().ai[hash(text)] = ok; else delete st().ai[hash(text)]; // رد مش صالح ← نرجع للقاموس
  // نخلي المحفوظ صغير (آخر ٤٠٠ نص)
  const ks = Object.keys(store.ai); if (ks.length > 400) for (const k of ks.slice(0, ks.length - 400)) delete store.ai[k];
  persist();
}
export function setMyKeys(text, keys) {
  if (keys == null) delete st().me[hash(text)]; else st().me[hash(text)] = keys;
  persist();
}
export function guessCat(word) { return dictCat(word) || 'mercy'; }
