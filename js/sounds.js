// أصوات خلفية مجانية: بحث في Freesound.org (محتاج مفتاح مجاني) + روابط لمكتبة Pixabay
import { getSettings } from './storage.js';
import { fetchFirst } from './net.js';

// كلمات جاهزة: الاسم بالعربي ← كلمة البحث بالإنجليزي
export const PRESETS = [
  ['🌧️ مطر', 'gentle rain'],
  ['🌊 بحر', 'ocean waves'],
  ['🍃 ريح', 'soft wind'],
  ['🐦 عصافير', 'birds morning'],
  ['💧 نهر', 'stream water'],
  ['🌙 ليل', 'night crickets'],
  ['🔥 نار', 'fireplace crackling'],
  ['⛈️ رعد بعيد', 'distant thunder rain'],
];

export const pixabayUrl = q => `https://pixabay.com/sound-effects/search/${encodeURIComponent(q.trim().replace(/\s+/g, '-'))}/`;

// cc0Only: الأصوات اللي رخصتها CC0 بس (مسموح بأي استخدام ومن غير ذكر اسم صاحبها)
export async function searchFreesound(query, { cc0Only = true } = {}) {
  const { freesoundKey } = getSettings();
  if (!freesoundKey) throw new Error('حط مفتاح Freesound في ⚙️ الإعدادات الأول (مجاني من freesound.org/apiv2/apply).');
  const filter = ['duration:[8 TO 900]'];
  if (cc0Only) filter.push('license:"Creative Commons 0"');
  const params = new URLSearchParams({
    query,
    filter: filter.join(' '),
    fields: 'id,name,previews,duration,license,username,url',
    sort: 'rating_desc',
    page_size: '24',
    token: freesoundKey,
  });
  const j = await fetchFirst([`https://freesound.org/apiv2/search/text/?${params}`], { as: 'json' })
    .catch(e => { throw new Error('تعذر البحث في Freesound. اتأكد من المفتاح، أو اضبط «رابط الوسيط». ' + (e.cause?.message || '')); });
  return (j.results || []).map(r => ({
    id: r.id,
    name: r.name,
    duration: r.duration,
    license: r.license,
    author: r.username,
    page: r.url,
    preview: r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3'],
  })).filter(r => r.preview);
}

export const licenseLabel = l => (/publicdomain\/zero|Creative Commons 0/i.test(l) ? 'CC0 (حر تمامًا)'
  : /by-nc/i.test(l) ? 'CC BY-NC (غير تجاري + ذكر الاسم)'
  : /by\//i.test(l) || /Attribution/i.test(l) ? 'CC BY (اذكر اسم صاحبه)' : l);
