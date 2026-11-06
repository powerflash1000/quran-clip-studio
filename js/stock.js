import { getSettings } from './storage.js';
import { fetchFirst } from './net.js';

// بحث خلفيات مجانية من Pexels و Pixabay (محتاج مفتاح مجاني لكل موقع، بيتحط في الإعدادات)
// يرجع: [{ id, kind: 'video'|'image', thumb, url, width, height, credit, page }]

const orient = aspect => (aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape');

// أنسب ملف فيديو: أصغر ملف ضلعه الصغير >= 720 (عشان التحويل في المتصفح يفضل سريع)
function pickPexelsFile(files) {
  const mp4 = files.filter(f => f.file_type === 'video/mp4' && f.width && f.height);
  mp4.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  return mp4.find(f => Math.min(f.width, f.height) >= 720) || mp4[mp4.length - 1];
}

// opts: { page, order: 'relevance'|'popular'|'latest', editors }
// كل مصدر بيرجع { items, total, pages, hasMore } — items: [{ id, kind, thumb, url, width, height, duration, likes, views, credit, license, page }]
const PER = 30;
const pagesOf = (total, per = PER) => (total ? Math.max(1, Math.ceil(total / per)) : null);

export async function searchPexels(query, kind, aspect, opts = {}) {
  const { pexelsKey } = getSettings();
  if (!pexelsKey) throw new Error('حط مفتاح Pexels في الإعدادات الأول');
  const o = orient(aspect);
  const page = opts.page || 1;
  const base = kind === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
  const res = await fetch(`${base}?query=${encodeURIComponent(query)}&orientation=${o}&per_page=${PER}&page=${page}`, { headers: { Authorization: pexelsKey } });
  if (!res.ok) throw new Error('Pexels: ' + res.status);
  const j = await res.json();
  const items = kind === 'video'
    ? (j.videos || []).map(v => {
      const f = pickPexelsFile(v.video_files || []);
      return f && { id: 'px' + v.id, kind: 'video', thumb: v.image, url: f.link, width: f.width, height: f.height, duration: v.duration, credit: v.user?.name, page: v.url };
    }).filter(Boolean)
    : (j.photos || []).map(p => ({ id: 'px' + p.id, kind: 'image', thumb: p.src.medium, url: aspect === '9:16' ? p.src.portrait : p.src.large2x, width: p.width, height: p.height, credit: p.photographer, page: p.url }));
  return { items, total: j.total_results ?? null, pages: pagesOf(j.total_results), hasMore: !!j.next_page };
}

export async function searchPixabay(query, kind, aspect, opts = {}) {
  const { pixabayKey } = getSettings();
  if (!pixabayKey) throw new Error('حط مفتاح Pixabay في الإعدادات الأول');
  const q = encodeURIComponent(query);
  const page = opts.page || 1;
  const order = opts.order === 'latest' ? 'latest' : 'popular';
  const extra = `&safesearch=true&per_page=${PER}&page=${page}&order=${order}${opts.editors ? '&editors_choice=true' : ''}`;
  let j;
  if (kind === 'video') {
    const res = await fetch(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${q}${extra}`);
    if (!res.ok) throw new Error(res.status === 400 && page > 1 ? 'مفيش صفحات أكتر' : 'Pixabay: ' + res.status);
    j = await res.json();
    const items = (j.hits || []).map(h => {
      const f = h.videos.medium?.url ? h.videos.medium : h.videos.large || h.videos.small;
      return { id: 'pb' + h.id, kind: 'video', thumb: h.videos.tiny?.thumbnail || h.videos.small?.thumbnail || '', url: f.url, width: f.width, height: f.height, duration: h.duration, likes: h.likes, views: h.views, credit: h.user, page: h.pageURL };
    });
    // Pixabay بيرجّع لحد ٥٠٠ نتيجة بس
    const total = Math.min(j.totalHits || 0, 500);
    return { items, total: j.total ?? null, pages: pagesOf(total), hasMore: page * PER < total };
  }
  const o = aspect === '9:16' ? 'vertical' : aspect === '16:9' ? 'horizontal' : 'all';
  const res = await fetch(`https://pixabay.com/api/?key=${pixabayKey}&q=${q}&image_type=photo&orientation=${o}${extra}`);
  if (!res.ok) throw new Error(res.status === 400 && page > 1 ? 'مفيش صفحات أكتر' : 'Pixabay: ' + res.status);
  j = await res.json();
  const total = Math.min(j.totalHits || 0, 500);
  const items = (j.hits || []).map(h => ({ id: 'pb' + h.id, kind: 'image', thumb: h.webformatURL || h.previewURL, url: h.largeImageURL, width: h.imageWidth, height: h.imageHeight, likes: h.likes, views: h.views, credit: h.user, page: h.pageURL }));
  return { items, total: j.total ?? null, pages: pagesOf(total), hasMore: page * PER < total };
}

export async function downloadStock(item) {
  // مباشرة الأول، ولو المتصفح منع (CORS) عن طريق الوسيط
  const blob = await fetchFirst([item.url], { as: 'blob' });
  const ext = item.ext || (item.kind === 'video' ? 'mp4' : 'jpg');
  return new File([blob], `${item.id}.${ext}`, { type: blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
}

// ===== مصادر من غير مفتاح =====

// Wikimedia Commons: صور وفيديوهات برخص حرة (بعضها محتاج ذكر صاحبها — الرخصة بتظهر على كل نتيجة)
const stripTags = s => (s || '').replace(/<[^>]+>/g, '').trim();

export async function searchCommons(query, kind, aspect, opts = {}) {
  const type = kind === 'video' ? 'filetype:video' : 'filetype:bitmap';
  const w = kind === 'video' ? 320 : 1080;
  const page = opts.page || 1;
  const sort = opts.order === 'latest' ? 'create_timestamp_desc' : opts.order === 'popular' ? 'incoming_links_desc' : 'relevance';
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + `&generator=search&gsrnamespace=6&gsrlimit=${PER}&gsroffset=${(page - 1) * PER}&gsrsort=${sort}&gsrsearch=${encodeURIComponent(`${type} ${query}`)}`
    + `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=${w}`
    + `&list=search&srsearch=${encodeURIComponent(`${type} ${query}`)}&srnamespace=6&srlimit=1&srinfo=totalhits&srprop=`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wikimedia: ' + res.status);
  const j = await res.json();
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const items = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const m = ii.extmetadata || {};
    const credit = stripTags(m.Artist?.value).slice(0, 40);
    const license = stripTags(m.LicenseShortName?.value);
    if (kind === 'video') {
      if (!/^video\//.test(ii.mime) || ii.size > 80e6 || (ii.duration && ii.duration > 120)) continue;
      items.push({ id: 'wm' + p.pageid, kind: 'video', thumb: ii.thumburl, url: ii.url, width: ii.width, height: ii.height, duration: ii.duration, credit, license, page: ii.descriptionurl, ext: ii.url.split('.').pop() });
    } else {
      if (!/^image\/(jpeg|png|webp)/.test(ii.mime)) continue;
      items.push({ id: 'wm' + p.pageid, kind: 'image', thumb: ii.thumburl, url: ii.thumburl || ii.url, width: ii.width, height: ii.height, credit, license, page: ii.descriptionurl });
    }
  }
  const total = j.query?.searchinfo?.totalhits ?? null;
  return { items, total, pages: pagesOf(total), hasMore: !!j.continue?.gsroffset };
}

// Openverse (صور بس): ملايين الصور برخص حرة مسموح استخدامها تجاريًا
export async function searchOpenverse(query, kind, aspect, opts = {}) {
  if (kind === 'video') throw new Error('Openverse فيه صور بس — اختار «صورة» أو مصدر تاني للفيديو');
  const ar = aspect === '9:16' ? '&aspect_ratio=tall' : aspect === '16:9' ? '&aspect_ratio=wide' : '';
  const page = opts.page || 1;
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&page_size=20&page=${page}&mature=false${ar}`);
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'مفيش صفحات أكتر من غير حساب في Openverse' : 'Openverse: ' + res.status);
  const j = await res.json();
  const items = (j.results || []).map(r => ({
    id: 'ov' + r.id.slice(0, 8), kind: 'image',
    thumb: r.thumbnail || `https://api.openverse.org/v1/images/${r.id}/thumb/`,
    url: `https://api.openverse.org/v1/images/${r.id}/thumb/?full_size=true&compressed=false`,
    width: r.width, height: r.height,
    credit: r.creator || '', license: `${(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), page: r.foreign_landing_url,
  }));
  return { items, total: j.result_count ?? null, pages: j.page_count ?? null, hasMore: page < (j.page_count || 0) };
}

// Coverr: فيديو ستوك (مفتاح مجاني ~50 بحث في الساعة). المفتاح من إعدادات البرنامج ده أو من برنامج الأخبار (نفس الموقع)
function coverrKey() {
  const k = getSettings().coverrKey;
  if (k) return k;
  try { return JSON.parse(localStorage.getItem('nrs:settings') || '{}').coverrKey || ''; } catch { return ''; }
}
export async function searchCoverr(query, kind, aspect, opts = {}) {
  const key = coverrKey();
  if (!key) throw new Error('حط مفتاح Coverr في الإعدادات الأول');
  if (kind === 'image') return { items: [], total: 0, pages: 0, hasMore: false };
  const page = opts.page || 1;
  const base = `https://api.coverr.co/videos?query=${encodeURIComponent(query)}&page=${page - 1}`;
  const tries = [[base + '&urls=true', { Authorization: 'Bearer ' + key }], [base, { Authorization: 'Bearer ' + key }], [base + '&api_key=' + encodeURIComponent(key), {}]];
  let res, msg = '';
  for (const [u, headers] of tries) {
    try { res = await fetch(u, { headers }); }
    catch {
      const { proxyUrl } = getSettings();
      if (!proxyUrl) throw new Error('Coverr: المتصفح منع الاتصال، اضبط رابط الوسيط');
      res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(u)}`, { headers });
    }
    if (res.ok || [401, 403, 429].includes(res.status)) break;
    msg = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  if (res.status === 429) throw new Error('Coverr: خلص حد البحث (حوالي 50 في الساعة)');
  if (!res.ok) throw new Error('Coverr: ' + res.status + (msg ? ' — ' + msg : ''));
  const j = await res.json();
  const list = j.hits || j.videos || j.data || [];
  const items = list.map(v => {
    const u = v.urls || {};
    const file = (typeof u === 'string' ? u : u.mp4_download || u.mp4 || u.mp4_preview) || '';
    return file && { id: 'cv' + (v.id || file), kind: 'video', thumb: v.thumbnail || v.poster || '', url: file, width: v.max_width || v.width, height: v.max_height || v.height, duration: Number(v.duration) || null, credit: 'Coverr', page: v.slug ? `https://coverr.co/videos/${v.slug}` : 'https://coverr.co' };
  }).filter(Boolean);
  const pages = j.pages || null;
  return { items, total: j.total ?? null, pages, hasMore: pages ? page < pages : items.length >= 20 };
}

export const PROVIDERS = {
  pixabay: { name: 'Pixabay (مفتاح مجاني)', short: 'Pixabay', key: s => s.pixabayKey, fn: searchPixabay, editors: true, order: ['popular', 'latest'] },
  commons: { name: 'Wikimedia (من غير مفتاح)', short: 'Wikimedia', fn: searchCommons, order: ['relevance', 'popular', 'latest'] },
  openverse: { name: 'Openverse — صور (من غير مفتاح)', short: 'Openverse', imageOnly: true, fn: searchOpenverse, order: [] },
  pexels: { name: 'Pexels (لو عندك مفتاح قديم)', short: 'Pexels', key: s => s.pexelsKey, fn: searchPexels, order: [] },
  coverr: { name: 'Coverr — فيديو (مفتاح مجاني)', short: 'Coverr', key: () => coverrKey(), fn: searchCoverr, order: [], videoOnly: true },
};
