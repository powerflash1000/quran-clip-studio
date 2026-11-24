// تخزين محلي آمن (المتصفح ممكن يمنع localStorage في الوضع الخاص)

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem('qcs:' + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem('qcs:' + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// الإعدادات: مفاتيح Pexels/Pixabay ورابط الوسيط (CORS proxy)
const DEFAULT_SETTINGS = { pexelsKey: '', pixabayKey: '', coverrKey: '', proxyUrl: '', elevenKey: '', elevenVoiceId: '', elevenModel: 'eleven_v4', freesoundKey: '', llmProvider: '', llmKey: '', llmModel: '', gttsKey: '', gttsModel: '', gttsVoice: 'Charon', gttsStyle: '', ytKey: '' };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}

export function setSettings(s) {
  save('settings', { ...getSettings(), ...s });
}

// ===== نسخة احتياطية في IndexedDB =====
// localStorage مساحته ~5 ميجا بس (اللوجو والقوالب والإحصائيات بياكلوها)، ولما يتملى الحفظ بيفشل من غير ما حد ياخد باله
// فبنكتب الكروت كمان في IndexedDB (مساحتها كبيرة) ونرجّع الأحدث عند الفتح
function kvDb() {
  return new Promise((res, rej) => { const r = indexedDB.open('qcs-kv', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function kvSet(key, value) {
  try { const db = await kvDb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); db.close(); return true; } catch { return false; }
}
export async function kvGet(key) {
  try { const db = await kvDb(); const v = await new Promise((res, rej) => { const r = db.transaction('kv', 'readonly').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); db.close(); return v ?? null; } catch { return null; }
}
