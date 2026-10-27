// تتبع المنافسين: بيانات قنوات يوتيوب العامة (YouTube Data API v3 بمفتاح المستخدم المجاني) + تقدير الأرباح
// الأرباح الحقيقية سرية عند صاحب القناة — هنا تقدير بس: المشاهدات × متوسط الربح لكل 1000 مشاهدة
const API = 'https://www.googleapis.com/youtube/v3';

// ربح تقريبي لكل 1000 مشاهدة بالدولار [أقل، أكتر] — قنوات قرآن بالعربي، من غير Claim
export const RPM = {
  gulf: { name: 'خليجي', long: [1.5, 5], shorts: [0.04, 0.12] },
  mixed: { name: 'مختلط (خليج + مصر + غيرهم)', long: [0.7, 2.5], shorts: [0.02, 0.07] },
  egypt: { name: 'مصري', long: [0.3, 1], shorts: [0.01, 0.04] },
};
// منصات تانية (تقريبي جدًا): تيك توك بيدفع على الفيديوهات أطول من دقيقة بس، وفيسبوك متغيّر
export const OTHER_RPM = {
  tiktok: { name: 'تيك توك (Creator Rewards — فيديوهات أطول من دقيقة)', rpm: [0.2, 1] },
  facebook: { name: 'فيسبوك (ريلز وفيديوهات)', rpm: [0.05, 0.5] },
};

async function get(path, params, key) {
  const q = new URLSearchParams({ ...params, key });
  const r = await fetch(`${API}/${path}?${q}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.error?.message || r.statusText;
    if (/API key not valid|API_KEY_INVALID/i.test(m)) throw new Error('مفتاح YouTube غلط — انسخه تاني من Google Cloud');
    if (/has not been used|is disabled|accessNotConfigured/i.test(m)) throw new Error('فعّل «YouTube Data API v3» في نفس مشروع جوجل اللي طلّعت منه المفتاح (اللينك تحت الخانة)، واستنى دقيقة');
    if (/quota/i.test(m)) throw new Error('خلّصت الحد المجاني بتاع النهارده (10,000 وحدة) — بيتجدد بكرة');
    throw new Error(`YouTube ${r.status}: ${m}`);
  }
  return j;
}

// لينك أو @handle أو رقم القناة أو اسم ← رقم القناة
export async function resolveChannel(input, key) {
  const s = String(input || '').trim();
  let m = s.match(/(UC[\w-]{22})/);
  if (m) return m[1];
  let dec = s;
  try { dec = decodeURIComponent(s); } catch { /* مش متشفّر */ }
  // الـ handle ممكن يبقى عربي أو فيه رموز: بناخد اللي بعد @ لحد / أو ? أو مسافة
  m = dec.match(/@([^\s/?#&]+)/) || dec.match(/youtube\.com\/(?:c\/|user\/)([^\s/?#&]+)/i);
  if (m) {
    const j = await get('channels', { part: 'id', forHandle: '@' + m[1] }, key);
    if (j.items?.[0]) return j.items[0].id;
    const u = await get('channels', { part: 'id', forUsername: m[1] }, key);
    if (u.items?.[0]) return u.items[0].id;
    throw new Error(`مالقيتش القناة @${m[1]} — اتأكد من الاسم، أو الصق لينك أي فيديو منها`);
  }
  // فيديو: نجيب قناته
  m = s.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/);
  if (m) {
    const v = await get('videos', { part: 'snippet', id: m[1] }, key);
    if (v.items?.[0]) return v.items[0].snippet.channelId;
  }
  // اسم: بحث (بيكلّف 100 وحدة من الحد اليومي) — بس لو مكتوب اسم فعلًا مش لينك
  const q = dec.replace(/https?:\/\/\S+/g, '').trim();
  if (!q) throw new Error('اللينك ده مش لقناة يوتيوب — الصق لينك القناة (فيه @) أو لينك أي فيديو منها');
  const r = await get('search', { part: 'snippet', type: 'channel', q, maxResults: 1 }, key);
  if (r.items?.[0]) return r.items[0].snippet.channelId;
  throw new Error('مالقيتش القناة دي — الصق لينك القناة أو لينك أي فيديو منها');
}

// ISO 8601 (PT1M5S) ← ثواني
const isoSecs = d => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '') || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };

// بيانات القناة + آخر 50 فيديو
export async function fetchChannel(id, key) {
  const c = (await get('channels', { part: 'snippet,statistics,contentDetails', id }, key)).items?.[0];
  if (!c) throw new Error('القناة مش موجودة');
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  let videos = [];
  if (uploads) {
    const pl = await get('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50 }, key);
    const ids = (pl.items || []).map(i => i.contentDetails.videoId).join(',');
    if (ids) {
      const vs = await get('videos', { part: 'snippet,statistics,contentDetails,liveStreamingDetails', id: ids }, key);
      videos = (vs.items || []).map(v => {
        const secs = isoSecs(v.contentDetails?.duration);
        return {
          id: v.id,
          title: v.snippet.title,
          date: v.snippet.publishedAt,
          views: +v.statistics?.viewCount || 0,
          likes: +v.statistics?.likeCount || 0,
          comments: +v.statistics?.commentCount || 0,
          secs,
          live: !!v.liveStreamingDetails,
          short: !v.liveStreamingDetails && secs > 0 && secs <= 180,
        };
      });
    }
  }
  return {
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl || '',
    thumb: c.snippet.thumbnails?.default?.url || '',
    country: c.snippet.country || '',
    created: c.snippet.publishedAt,
    subs: c.statistics.hiddenSubscriberCount ? null : +c.statistics.subscriberCount || 0,
    views: +c.statistics.viewCount || 0,
    count: +c.statistics.videoCount || 0,
    videos,
  };
}

// تحليل: مشاهدات الشهر (من الفرق بين قراءتين لو موجود، وإلا من فيديوهات آخر 30 يوم) + معدل النشر + التقدير
export function analyze(ch, snaps, region = 'mixed') {
  const now = Date.now(), day = 86400000;
  const recent = ch.videos.filter(v => now - Date.parse(v.date) <= 30 * day);
  const recentViews = recent.reduce((a, v) => a + v.views, 0);
  const shortsViews = ch.videos.filter(v => v.short).reduce((a, v) => a + v.views, 0);
  const allViews = ch.videos.reduce((a, v) => a + v.views, 0) || 1;
  const shortsShare = shortsViews / allViews;
  // من القراءات المحفوظة: أقدم قراءة عمرها يوم على الأقل
  const old = (snaps || []).filter(s => now - s.t >= day * 0.9).sort((a, b) => a.t - b.t)[0];
  let monthly, source;
  if (old && ch.views > old.views) {
    monthly = (ch.views - old.views) / ((now - old.t) / day) * 30;
    source = `من الفرق في إجمالي المشاهدات من ${Math.round((now - old.t) / day)} يوم (الأدق)`;
  } else {
    monthly = recentViews;
    source = 'من فيديوهات آخر 30 يوم بس (أقل من الحقيقي — ارجع بعد يوم للتقدير الأدق)';
  }
  const r = RPM[region] || RPM.mixed;
  const lo = monthly / 1000 * (r.long[0] * (1 - shortsShare) + r.shorts[0] * shortsShare);
  const hi = monthly / 1000 * (r.long[1] * (1 - shortsShare) + r.shorts[1] * shortsShare);
  const dates = ch.videos.map(v => Date.parse(v.date)).sort((a, b) => b - a);
  const span = dates.length > 1 ? (dates[0] - dates[dates.length - 1]) / day : 0;
  const perWeek = span > 0 ? (dates.length - 1) / span * 7 : 0;
  const subsDelta = old && ch.subs != null && old.subs != null ? ch.subs - old.subs : null;
  return {
    monthly, source, lo, hi, shortsShare, perWeek, subsDelta, sinceDays: old ? Math.round((now - old.t) / day) : 0,
    recentCount: recent.length,
    top: [...ch.videos].sort((a, b) => b.views - a.views).slice(0, 10),
    avgViews: ch.videos.length ? allViews / ch.videos.length : 0,
  };
}

export const fmtNum = n => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
export const fmtUsd = n => '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n >= 10 ? 0 : 2));
