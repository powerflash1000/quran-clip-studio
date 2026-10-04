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
  const ext = item.kind === 'video' ? 'mp4' : 'jpg';
  return new File([blob], `${item.id}.${ext}`, { type: blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
}
