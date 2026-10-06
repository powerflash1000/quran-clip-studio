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
const DEFAULT_SETTINGS = { pexelsKey: '', pixabayKey: '', proxyUrl: '', elevenKey: '', elevenVoiceId: '', elevenModel: 'eleven_multilingual_v2', freesoundKey: '' };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}

export function setSettings(s) {
  save('settings', { ...getSettings(), ...s });
}
