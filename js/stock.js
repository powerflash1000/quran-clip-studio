import { getSettings } from './storage.js';

// بحث خلفيات مجانية من Pexels و Pixabay (محتاج مفتاح مجاني لكل موقع، بيتحط في الإعدادات)
// يرجع: [{ id, kind: 'video'|'image', thumb, url, width, height, credit, page }]

const orient = aspect => (aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape');

// أنسب ملف فيديو: أصغر ملف ضلعه الصغير >= 720 (عشان التحويل في المتصفح يفضل سريع)
function pickPexelsFile(files) {
  const mp4 = files.filter(f => f.file_type === 'video/mp4' && f.width && f.height);
  mp4.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  return mp4.find(f => Math.min(f.width, f.height) >= 720) || mp4[mp4.length - 1];
}

export async function searchPexels(query, kind, aspect) {
  const { pexelsKey } = getSettings();
  if (!pexelsKey) throw new Error('حط مفتاح Pexels في الإعدادات الأول');
  const o = orient(aspect);
  const url = kind === 'video'
    ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=24`
    : `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=24`;
  const res = await fetch(url, { headers: { Authorization: pexelsKey } });
  if (!res.ok) throw new Error('Pexels: ' + res.status);
  const j = await res.json();
  if (kind === 'video') {
    return (j.videos || []).map(v => {
      const f = pickPexelsFile(v.video_files || []);
      return f && { id: 'px' + v.id, kind: 'video', thumb: v.image, url: f.link, width: f.width, height: f.height, credit: v.user?.name, page: v.url };
    }).filter(Boolean);
  }
  return (j.photos || []).map(p => ({
    id: 'px' + p.id, kind: 'image', thumb: p.src.medium,
    url: aspect === '9:16' ? p.src.portrait : p.src.large2x,
    credit: p.photographer, page: p.url,
  }));
}

export async function searchPixabay(query, kind, aspect) {
  const { pixabayKey } = getSettings();
  if (!pixabayKey) throw new Error('حط مفتاح Pixabay في الإعدادات الأول');
  const q = encodeURIComponent(query);
  if (kind === 'video') {
    const res = await fetch(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${q}&safesearch=true&per_page=24`);
    if (!res.ok) throw new Error('Pixabay: ' + res.status);
    const j = await res.json();
    return (j.hits || []).map(h => {
      const f = h.videos.medium?.url ? h.videos.medium : h.videos.large || h.videos.small;
      return { id: 'pb' + h.id, kind: 'video', thumb: h.videos.tiny?.thumbnail || h.videos.small?.thumbnail || '', url: f.url, width: f.width, height: f.height, credit: h.user, page: h.pageURL };
    });
  }
  const o = aspect === '9:16' ? 'vertical' : aspect === '16:9' ? 'horizontal' : 'all';
  const res = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${q}&image_type=photo&orientation=${o}&safesearch=true&per_page=24`);
  if (!res.ok) throw new Error('Pixabay: ' + res.status);
  const j = await res.json();
  return (j.hits || []).map(h => ({ id: 'pb' + h.id, kind: 'image', thumb: h.previewURL, url: h.largeImageURL, credit: h.user, page: h.pageURL }));
}

export async function downloadStock(item) {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error('تعذر تحميل الملف: ' + res.status);
  const blob = await res.blob();
  const ext = item.ext || (item.kind === 'video' ? 'mp4' : 'jpg');
  return new File([blob], `${item.id}.${ext}`, { type: blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
}

// ===== مصادر من غير مفتاح =====

// Wikimedia Commons: صور وفيديوهات برخص حرة (بعضها محتاج ذكر صاحبها — الرخصة بتظهر على كل نتيجة)
const stripTags = s => (s || '').replace(/<[^>]+>/g, '').trim();

export async function searchCommons(query, kind, aspect) {
  const type = kind === 'video' ? 'filetype:video' : 'filetype:bitmap';
  const w = kind === 'video' ? 320 : 1080;
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + `&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=${encodeURIComponent(`${type} ${query}`)}`
    + `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=${w}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wikimedia: ' + res.status);
  const j = await res.json();
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const m = ii.extmetadata || {};
    const credit = stripTags(m.Artist?.value).slice(0, 40);
    const license = stripTags(m.LicenseShortName?.value);
    if (kind === 'video') {
      if (!/^video\//.test(ii.mime) || ii.size > 80e6 || (ii.duration && ii.duration > 120)) continue;
      out.push({ id: 'wm' + p.pageid, kind: 'video', thumb: ii.thumburl, url: ii.url, width: ii.width, height: ii.height, credit, license, page: ii.descriptionurl, ext: ii.url.split('.').pop() });
    } else {
      if (!/^image\/(jpeg|png|webp)/.test(ii.mime)) continue;
      if (aspect === '9:16' && ii.width > ii.height * 1.2) continue;
      out.push({ id: 'wm' + p.pageid, kind: 'image', thumb: ii.thumburl, url: ii.thumburl || ii.url, credit, license, page: ii.descriptionurl });
    }
  }
  return out.slice(0, 24);
}

// Openverse (صور بس): ملايين الصور برخص حرة مسموح استخدامها تجاريًا
export async function searchOpenverse(query, kind, aspect) {
  if (kind === 'video') throw new Error('Openverse فيه صور بس — اختار «صورة» أو مصدر تاني للفيديو');
  const ar = aspect === '9:16' ? '&aspect_ratio=tall' : aspect === '16:9' ? '&aspect_ratio=wide' : '';
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&page_size=24&mature=false${ar}`);
  if (!res.ok) throw new Error('Openverse: ' + res.status);
  const j = await res.json();
  return (j.results || []).map(r => ({
    id: 'ov' + r.id.slice(0, 8), kind: 'image',
    thumb: r.thumbnail || `https://api.openverse.org/v1/images/${r.id}/thumb/`,
    url: `https://api.openverse.org/v1/images/${r.id}/thumb/?full_size=true&compressed=false`,
    credit: r.creator || '', license: `${(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), page: r.foreign_landing_url,
  }));
}

export const PROVIDERS = {
  pixabay: { name: 'Pixabay (مفتاح مجاني)', fn: searchPixabay },
  commons: { name: 'Wikimedia (من غير مفتاح)', fn: searchCommons },
  openverse: { name: 'Openverse — صور (من غير مفتاح)', fn: searchOpenverse },
  pexels: { name: 'Pexels (لو عندك مفتاح قديم)', fn: searchPexels },
};
