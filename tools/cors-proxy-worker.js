// وسيط CORS صغير على Cloudflare Workers (مجاني حتى 100 ألف طلب في اليوم).
// استخدمه لو ملفات القراء أو الأحاديث مش بتتحمل، أو عشان تجيب صور وفيديوهات بلينك من Pinterest و Mixkit و Coverr،
// وعشان لينكات فيسبوك المختصرة (fb.watch و facebook.com/share) تشتغل في «الفيديو المرجعي».
// لو عامله قبل كده: افتحه تاني ← Edit code ← الصق الكود الجديد ده مكان القديم ← Deploy.
// الطريقة: dash.cloudflare.com ← Workers & Pages ← Create ← Hello World ← Edit code
// الصق الكود ده ← Deploy ← انسخ الرابط وحطه في «رابط الوسيط» في إعدادات البرنامج.

// بيسمح بس بالمواقع دي، عشان محدش يستخدم الوسيط بتاعك في حاجة تانية
const ALLOWED_HOSTS = [
  'everyayah.com',
  'cdn.islamic.network',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
  'verses.quran.com',
  'api.quran.com',
  'api.elevenlabs.io',
  'freesound.org',
  'cdn.freesound.org',
];
// مواقع الصور والفيديوهات: الدومين نفسه وأي دومين فرعي منه (زي ar.pinterest.com و i.pinimg.com)
const ALLOWED_SUFFIXES = ['pinterest.com', 'pin.it', 'pinimg.com', 'mixkit.co', 'coverr.co', 'pexels.com', 'pixabay.com', 'facebook.com', 'fb.watch', 'fbcdn.net'];
const allowed = h => ALLOWED_HOSTS.includes(h) || ALLOWED_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
// بعض المواقع (زي Pinterest) بترجع صفحة ناقصة للبرامج، فبنطلب زي المتصفح العادي
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// الهيدرز اللي بتتبعت للخدمة الأصلية (مفتاح ElevenLabs ونوع المحتوى)
const FORWARD_HEADERS = ['xi-api-key', 'content-type', 'accept'];

// ===== 🖼️ «صورة من رابط» (?img=1&url=…) =====
// بيقبل أي موقع، بس بيرجّع صورة وبس (مش وسيط مفتوح لأي حاجة):
// - لو الرابط صورة ← بيرجّعها.
// - لو الرابط صفحة (منتج على Trendyol/Amazon/Noon، بوست، مقال…) ← بيطلّع صورتها الرئيسية (og:image) ويرجّعها.
// - أي حاجة تانية (فيديو، ملف، API…) ← مرفوضة.
const MAX_IMG = 15e6, MAX_HTML = 3e6;
const PRIVATE = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|::1)/i;
function pickImage(html, base) {
  const meta = p => (new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)`, 'i').exec(html)
    || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i').exec(html))?.[1];
  let u = meta('og:image(?::secure_url|:url)?') || meta('twitter:image(?::src)?');
  if (!u) u = /"image"\s*:\s*(?:\[\s*)?(?:\{[^{}]*?"(?:url|contentUrl)"\s*:\s*)?"(https?:[^"]+)"/i.exec(html)?.[1];
  if (!u) u = /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i.exec(html)?.[1];
  if (!u) return null;
  u = u.replace(/&amp;/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  try { return new URL(u, base).toString(); } catch { return null; }
}
async function imageOnly(url, cors) {
  const fail = (msg, status) => new Response(msg, { status, headers: cors });
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) return fail('bad url', 400);
  const get = u => fetch(u, { redirect: 'follow', headers: { 'user-agent': BROWSER_UA, accept: 'text/html,image/avif,image/webp,image/*,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9,ar;q=0.8' } });
  let r = await get(url.toString());
  let type = (r.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('text/html') || type.includes('xhtml')) {
    if (Number(r.headers.get('content-length') || 0) > MAX_HTML) return fail('page too big', 413);
    const img = pickImage((await r.text()).slice(0, MAX_HTML), r.url || url.toString());
    if (!img) return fail('no image found on page', 404);
    const iu = new URL(img);
    if (PRIVATE.test(iu.hostname)) return fail('bad url', 400);
    r = await get(img);
    type = (r.headers.get('content-type') || '').toLowerCase();
  }
  if (!r.ok) return fail(`upstream ${r.status}`, 502);
  if (!type.startsWith('image/')) return fail('not an image', 415);
  if (Number(r.headers.get('content-length') || 0) > MAX_IMG) return fail('image too big', 413);
  return new Response(r.body, { status: 200, headers: { ...cors, 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-final-url': r.url, 'Access-Control-Expose-Headers': 'x-final-url' } });
}

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': FORWARD_HEADERS.join(', '),
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('missing ?url=', { status: 400, headers: cors }); }
    if (new URL(request.url).searchParams.get('img') === '1' && request.method === 'GET') return imageOnly(url, cors);
    if (url.protocol !== 'https:' || !allowed(url.hostname)) {
      return new Response('host not allowed', { status: 403, headers: cors });
    }

    let upstream;
    if (request.method === 'POST') {
      const fwd = new Headers();
      for (const h of FORWARD_HEADERS) if (request.headers.get(h)) fwd.set(h, request.headers.get(h));
      upstream = await fetch(url.toString(), { method: 'POST', headers: fwd, body: request.body });
    } else if (url.hostname === 'api.elevenlabs.io') {
      const fwd = new Headers();
      for (const h of FORWARD_HEADERS) if (request.headers.get(h)) fwd.set(h, request.headers.get(h));
      upstream = await fetch(url.toString(), { headers: fwd });
    } else {
      const media = ALLOWED_SUFFIXES.some(s => url.hostname === s || url.hostname.endsWith('.' + s));
      upstream = await fetch(url.toString(), media
        ? { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' }
        : { cf: { cacheEverything: true, cacheTtl: 86400 } });
    }
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    // اللينك النهائي بعد التحويلات (للينكات المختصرة زي fb.watch و facebook.com/share)
    headers.set('x-final-url', upstream.url || url.toString());
    headers.set('Access-Control-Expose-Headers', 'x-final-url');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
