// 📖 قصص الأنبياء لابن كثير — من ويكي مصدر (ar.wikisource.org)، النص بيتجاب من الـ API مباشرة من المتصفح (CORS مفتوح)
// الكتاب مجلدين، وكل نبي/حدث قسم (===عنوان===) جوه صفحة المجلد. ويكيميديا بيحدّ عدد الطلبات، فبنحفظ اللي اتجاب
const API = 'https://ar.wikisource.org/w/api.php';
export const VOLUMES = [
  { title: 'قصص الأنبياء لابن كثير/الجزء الأول', name: 'الجزء الأول' },
  { title: 'قصص الأنبياء لابن كثير/الجزء الثاني', name: 'الجزء الثاني' },
];
export const PAGE_URL = 'https://ar.wikisource.org/wiki/' + encodeURIComponent('قصص الأنبياء لابن كثير');
export const CREDIT = 'قصص الأنبياء لابن كثير — ويكي مصدر (ar.wikisource.org)';

const mem = new Map();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('qcs:story:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('qcs:story:' + k, JSON.stringify(v)); } catch { /* المساحة خلصت: نكمّل من غير حفظ */ } },
};

// طلب واحد مع إعادة المحاولة لو الموقع قال «استنى» (429)
async function api(params) {
  const q = new URLSearchParams({ ...params, format: 'json', origin: '*', formatversion: '2' });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}?${q}`);
    if (r.status === 429 || r.status === 503) { await new Promise(res => setTimeout(res, (Number(r.headers.get('retry-after')) || 3) * 1000 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`ويكي مصدر ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.info || 'ويكي مصدر رفض الطلب');
    return j;
  }
  throw new Error('ويكي مصدر مشغول دلوقتي (طلبات كتير) — جرّب كمان دقيقة');
}

// الأقسام (القصص) في كل مجلد: [{ vol, index, title, level }]
export async function listStories() {
  const key = 'sections:v1';
  if (mem.has(key)) return mem.get(key);
  let all = store.get(key);
  if (!all) {
    all = [];
    for (const [vi, v] of VOLUMES.entries()) {
      const j = await api({ action: 'parse', page: v.title, prop: 'sections' });
      for (const s of j.parse?.sections || []) all.push({ vol: vi, index: s.index, title: clean(s.line).replace(/[:：]\s*$/, ''), level: Number(s.level) || 3 });
    }
    if (all.length) store.set(key, all);
  }
  mem.set(key, all);
  return all;
}

// نص القصة (قسم واحد) كفقرات نظيفة
export async function storyText(vol, index) {
  const key = `text:${vol}:${index}`;
  if (mem.has(key)) return mem.get(key);
  let paras = store.get(key);
  if (!paras) {
    const j = await api({ action: 'parse', page: VOLUMES[vol].title, prop: 'wikitext', section: index });
    paras = toParagraphs(j.parse?.wikitext || '');
    store.set(key, paras);
  }
  mem.set(key, paras);
  return paras;
}

// تنظيف الويكي: القوالب والروابط والتنسيق
function clean(s) {
  return String(s || '')
    .replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/\{\{\s*بسملة\s*\}\}/g, 'بسم الله الرحمن الرحيم')
    .replace(/\{\{\s*(صل|ص|صلى)\s*\}\}/g, 'ﷺ')
    .replace(/\{\{\s*(عليه السلام|ع)\s*\}\}/g, 'عليه السلام')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
function toParagraphs(wt) {
  return clean(wt.replace(/^=+[^=\n]+=+\s*$/gm, '\n'))
    .split(/\n\s*\n|\n(?=\S)/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(p => p.length > 1 && !/^(تصنيف|تصنيف:)/.test(p));
}
