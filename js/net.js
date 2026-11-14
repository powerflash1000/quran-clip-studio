import { getSettings } from './storage.js';

// يجرب كل رابط مباشرة، ولو فشل (غالبًا بسبب CORS) يجربه عن طريق الوسيط لو متضبط
export async function fetchFirst(urls, { as = 'arrayBuffer' } = {}) {
  const { proxyUrl } = getSettings();
  const attempts = [...urls];
  if (proxyUrl) {
    const base = proxyUrl.replace(/\/+$/, '');
    for (const u of urls) attempts.push(`${base}/?url=${encodeURIComponent(u)}`);
  }
  let lastErr;
  for (const url of attempts) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res[as]();
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error('تعذر تحميل الملف من كل المصادر');
  err.cause = lastErr;
  err.urls = urls;
  throw err;
}

export async function fetchJson(urls) {
  return fetchFirst(Array.isArray(urls) ? urls : [urls], { as: 'json' });
}

// 🖼️ صورة من أي رابط عن طريق الوسيط (وضع الصور بس ?img=1): لو اللينك صفحة، الوسيط بيطلّع صورتها الرئيسية
export async function imageViaProxy(url) {
  const { proxyUrl } = getSettings();
  if (!proxyUrl) return null;
  const res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/?img=1&url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const why = await res.text().catch(() => '');
    if (res.status === 403 || res.status === 400 && !why) throw new Error('الوسيط بتاعك قديم ومش بيدعم «صورة من رابط» — حدّث كوده من tools/cors-proxy-worker.js (Edit code ← الصق ← Deploy).');
    if (res.status === 404) throw new Error('الصفحة دي مافيهاش صورة رئيسية واضحة. افتحها، وكليك يمين على الصورة ← «نسخ الصورة» والصقها بـ 📋.');
    if (res.status === 415) throw new Error('الرابط ده مش صورة. لو فيديو، نزّله وارفعه من جهازك.');
    throw new Error(`الموقع رفض حتى عن طريق الوسيط (${res.status}). انسخ الصورة نفسها والصقها بـ 📋.`);
  }
  return res.blob();
}
