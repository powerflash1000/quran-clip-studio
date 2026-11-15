// 📥 قرّاء أكتر من mp3quran.net — الواجهة الرسمية المفتوحة (v3): ٢٤٤ قارئ، السورة كاملة في ملف واحد،
// وعند كتير منهم توقيت بداية ونهاية كل آية جاهز (فالآيات بتتقسم بالظبط من غير تحليل).
// الحقوق حسب الموقع: «جميع الحقوق متاحة للجميع ويحق لأي زائر أو مطور استخدام أي مادة أو رابط».
// surahquran.com مش مصدر: بيجمّع لينكات من archive.org وmp3quran، وشروطه بتمنع الاستخدام التجاري.
import { getSettings } from './storage.js';
import { RECITERS } from './reciters.js';

const API = 'https://www.mp3quran.net/api/v3';
const DAY = 864e5;
const pad3 = n => String(n).padStart(3, '0');

// JSON من الواجهة: مباشرة (بتبعت CORS *) وإلا عن طريق الوسيط، ومتخزّن يوم
async function api(path) {
  const key = 'mp3q:' + path;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < DAY) return c.v;
  } catch {}
  const url = API + path;
  const v = await getJson(url);
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  return v;
}

async function getJson(url) {
  const { proxyUrl } = getSettings();
  const tries = [url];
  if (proxyUrl) tries.push(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`);
  let err;
  for (const u of tries) {
    try { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { err = e; }
  }
  throw new Error('مش قادر أوصل لـ mp3quran.net (' + (err?.message || 'network') + ') — لو فاتح VPN اقفله وجرّب تاني.');
}

// تطبيع الأسماء عشان نعرف القارئ موجود في قايمة البرنامج ولا جديد
const norm = s => s.replace(/\(.*?\)/g, '').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/عبد\s+/g, 'عبد').replace(/\s+/g, ' ').trim();
const KNOWN = RECITERS.map(r => norm(r.name).split(' '));
export function isKnown(name) {
  const w = norm(name).split(' ');
  return KNOWN.some(k => k[0] === w[0] && k[k.length - 1] === w[w.length - 1]);
}

// كل المصاحف (قارئ × رواية) اللي فيها السورة دي، بالحروف
export async function moshafsFor(surah) {
  const [{ reciters }, timed] = await Promise.all([api('/reciters?language=ar'), timedReads()]);
  const out = [];
  for (const r of reciters || []) {
    for (const m of r.moshaf || []) {
      const list = String(m.surah_list || '').split(',').map(Number);
      if (!list.includes(surah)) continue;
      out.push({
        reciter: r.name, moshafId: m.id, moshaf: m.name, server: m.server,
        url: m.server + pad3(surah) + '.mp3', timed: timed.has(m.id), known: isKnown(r.name),
        hafs: /حفص/.test(m.name), multi: r.moshaf.length > 1,
      });
    }
  }
  return out.sort((a, b) => a.reciter.localeCompare(b.reciter, 'ar') || (b.hafs - a.hafs));
}

// المصاحف اللي ليها توقيت آيات (رقم «read» هو رقم المصحف مش القارئ)
async function timedReads() {
  try {
    const j = await api('/ayat_timing/reads');
    return new Set((Array.isArray(j) ? j : j?.reads || []).map(x => x.id));
  } catch { return new Set(); }
}

// توقيت كل آية بالثواني: [{ayah, start, end}] — أو null لو مش موجود
export async function ayahTiming(moshafId, surah, count) {
  try {
    const j = await api(`/ayat_timing?surah=${surah}&read=${moshafId}`);
    const rows = (Array.isArray(j) ? j : []).filter(x => x.ayah >= 1 && x.ayah <= count)
      .map(x => ({ ayah: x.ayah, start: x.start_time / 1000, end: x.end_time / 1000 })).sort((a, b) => a.ayah - b.ayah);
    if (rows.length !== count || rows.some((x, i) => x.ayah !== i + 1 || !(x.end > x.start))) return null;
    return rows;
  } catch { return null; }
}

// تحميل ملف السورة بنسبة تقدّم: مباشرة، وإلا عن طريق الوسيط
export async function downloadSurah(url, onProgress) {
  const { proxyUrl } = getSettings();
  const tries = [url];
  if (proxyUrl) tries.push(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`);
  let err;
  for (const u of tries) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body?.getReader) return await res.blob();
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        onProgress?.(got, total);
      }
      return new Blob(parts, { type: 'audio/mpeg' });
    } catch (e) { err = e; }
  }
  const e = new Error(proxyUrl
    ? 'مش قادر أحمّل الملف — حدّث كود الوسيط من tools/cors-proxy-worker.js (فيه دومين mp3quran) أو جرّب تاني.'
    : 'المتصفح منع التحميل المباشر — اعمل «الوسيط» من ⚙️ الإعدادات، أو نزّل الملف (⬇️) وارفعه من «🎧 كلام من ملف صوت».');
  e.cause = err;
  throw e;
}
