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
