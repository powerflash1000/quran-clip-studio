// وسيط CORS صغير على Cloudflare Workers (مجاني حتى 100 ألف طلب في اليوم).
// استخدمه بس لو ملفات القراء أو الأحاديث مش بتتحمل في البرنامج.
// الطريقة: dash.cloudflare.com ← Workers & Pages ← Create ← Hello World ← Edit code
// الصق الكود ده ← Deploy ← انسخ الرابط وحطه في «رابط الوسيط» في إعدادات البرنامج.

// بيسمح بس بالمواقع دي، عشان محدش يستخدم الوسيط بتاعك في حاجة تانية
const ALLOWED_HOSTS = [
  'everyayah.com',
  'cdn.islamic.network',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
  'verses.quran.com',
];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('missing ?url=', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('host not allowed', { status: 403, headers: cors });
    }

    const upstream = await fetch(url.toString(), { cf: { cacheEverything: true, cacheTtl: 86400 } });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
