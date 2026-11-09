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
const ALLOWED_SUFFIXES = ['pinterest.com', 'pin.it', 'pinimg.com', 'mixkit.co', 'coverr.co', 'pexels.com', 'pixabay.com', 'facebook.com', 'fb.watch'];
const allowed = h => ALLOWED_HOSTS.includes(h) || ALLOWED_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
// بعض المواقع (زي Pinterest) بترجع صفحة ناقصة للبرامج، فبنطلب زي المتصفح العادي
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// الهيدرز اللي بتتبعت للخدمة الأصلية (مفتاح ElevenLabs ونوع المحتوى)
const FORWARD_HEADERS = ['xi-api-key', 'content-type', 'accept'];

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
