import { load, save } from './storage.js';

// القالب = إعدادات الشكل والقارئ (من غير ملفات الخلفية نفسها)
export const DEFAULT_STYLE = {
  aspect: '9:16',
  reciter: 'alafasy',
  translation: '',
  bgType: 'gradient',        // color | gradient | media
  color1: '#0f2027',
  color2: '#2c5364',
  dim: 0.35,
  textColor: '#ffffff',
  subColor: '#e6e6e6',
  accent: '#f4d58d',
  textSize: 78,
  labelScale: 1,
  showLabel: true,
  showFooter: true,
  showTranslation: true,
  waveform: false,
  gap: 0.25,
  trimSilence: true,       // قص السكوت من أول وآخر ملف كل آية
  wordMode: 'full',        // full | reveal (الكلمات بتظهر مع التلاوة) | highlight (تظليل الكلمة الحالية)
  quality: '1080',
  intro: '',               // جملة افتتاحية في أول الفيديو (فاضية = من غير)
  introSeconds: 1.6,
  handle: '@tilawat.alaa', // @اسم_حسابك على الفيديو (فاضي = من غير علامة)
  handlePos: 'bottom',
};

const BUILTIN = {
  'ريلز ليلي': { ...DEFAULT_STYLE },
  'يوتيوب أفقي': { ...DEFAULT_STYLE, aspect: '16:9', color1: '#1b1b2f', color2: '#3a3a6a', textSize: 70 },
  'منشور مربع': { ...DEFAULT_STYLE, aspect: '1:1', bgType: 'color', color1: '#14332c', accent: '#d4af37' },
};

export function listTemplates() {
  return { ...BUILTIN, ...load('templates', {}) };
}

export function saveTemplate(name, style) {
  const user = load('templates', {});
  user[name] = style;
  save('templates', user);
}

export function deleteTemplate(name) {
  const user = load('templates', {});
  delete user[name];
  save('templates', user);
}

export const isBuiltin = name => name in BUILTIN;

export function exportTemplates() {
  return JSON.stringify({ app: 'quran-clip-studio', templates: load('templates', {}) }, null, 2);
}

export function importTemplates(json) {
  const obj = JSON.parse(json);
  const incoming = obj.templates || obj;
  const user = load('templates', {});
  let n = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (v && typeof v === 'object') { user[k] = { ...DEFAULT_STYLE, ...v }; n++; }
  }
  save('templates', user);
  return n;
}

export function lastStyle() {
  return { ...DEFAULT_STYLE, ...load('lastStyle', {}) };
}

export function rememberStyle(style) {
  save('lastStyle', style);
}
