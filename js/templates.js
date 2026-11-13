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
  textFont: 'Amiri',       // خط الأحاديث والأدعية والعناوين (القرآن دايمًا بخط المصحف)
  textFx: '',              // تأثير الخط: حدود / توهج / ذهبي / نيون / كارت / شريط
  textZone: '',            // 📐 مكان الكلام: '' النص / auto أهدى مساحة / top / bottom / right / left
  textInk: '',             // لون الكلام: '' ألواني / auto حسب الخلفية
  textAnim: '',            // حركة دخول النص في الفيديو
  recFx: '',               // صدى على صوت التلاوة (غرفة / مسجد / قاعة كبيرة)
  trimSilence: true,       // قص السكوت من أول وآخر ملف كل آية
  ayahLayout: 'one',       // one (آية آية) | all (الآيات كلها مرة واحدة) | allHi (كلها + الآية الحالية منوّرة)
  script: 'uthmani',        // uthmani (رسم المصحف) | imlaei (إملائي حديث من Tanzil)
  wordMode: 'full',        // full | reveal (الكلمات بتظهر مع التلاوة) | highlight (تظليل الكلمة الحالية)
  countTheme: 'gold',      // ألوان العجلة: gold | ivory | emerald | navy | rose
  countViz: '',             // '' | beads (📿 سبحة) | wheel (🎡 عجلة الأذكار) — عدّاد مرات الذكر
  countTick: true,         // صوت مع العدّ (لو الكارت من غير صوت)
  countSound: 'wood',      // صوت كل مرة: wood | beads | drop | soft | none
  countNext: 'whoosh',     // لما الذكر يتغيّر: whoosh | knock | double | none
  quality: '1080',
  intro: '',               // جملة افتتاحية في أول الفيديو (فاضية = من غير)
  introSeconds: 1.6,
  handle: '@tilawat.alaa',// @اسم_حسابك على الفيديو (فاضي = من غير علامة)
  handlePos: 'bottom',      // bottom | top | br | bl | tr | tl | custom
  handleSize: 1, handleOpacity: 0.6, handleX: 50, handleY: 90,
  logoOn: false, logoData: '', logoPos: 'tr', logoSize: 0.14, logoOpacity: 0.9, logoX: 85, logoY: 8,
  look: '',                 // لون سينمائي للخلفية
  light: '', lightAmount: 1, // إضاءة: أشعة / تسريب نور / توهج / بوكيه / ذرات / نجوم
  cardTrans: '',            // انتقال بين الكروت: ومضة / غمقان / شعاع
  bumper: '', channelName: 'قرآن يريح القلب 🤍', outroText: 'تابعنا لمزيد من التلاوات', bumperSecs: 2.5, subCard: '', subCardPos: 'center',
  bgSwitch: 'ayah',         // ayah | seconds — لو فيه أكتر من خلفية
  bgEvery: 6,
  bgFade: true,
  // 🖼️ لوحة للتلفزيون
  frame: '',                // برواز: gold | thin | black | white
  wall: '#0e0e0e',          // لون الحيطة حوالين البرواز
  pattern: '',              // زخرفة إسلامية خفيفة على اللون/التدرّج
  kenBurns: '',             // حركة الخلفية الهادية (بتلف وترجع لأولها)
  loop: false,              // مقطع بيتكرر من غير ما يبان القطع
};

const BUILTIN = {
  'ريلز ليلي': { ...DEFAULT_STYLE },
  'يوتيوب أفقي': { ...DEFAULT_STYLE, aspect: '16:9', color1: '#1b1b2f', color2: '#3a3a6a', textSize: 70 },
  'لوحة للتلفزيون 16:9 🖼️': {
    ...DEFAULT_STYLE, aspect: '16:9', bgType: 'gradient', color1: '#f6f0e4', color2: '#e7dbc6', dim: 0,
    textColor: '#2b211a', subColor: '#5b4a37', accent: '#a8781e', textSize: 92, ayahLayout: 'all',
    showFooter: false, showTranslation: false, frame: 'mirror', pattern: 'stars', kenBurns: 'slow', loop: true, handleOpacity: 0.45,
  },
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

// اسم الحساب الصح @tilawat.alaa — اللي كان محفوظ بتلات حروف a بيتصلّح لوحده (في الشكل الأخير والقوالب)
const OLD_HANDLE = '@tilawat.alaaa';
const fixHandle = st => (st && st.handle === OLD_HANDLE ? { ...st, handle: DEFAULT_STYLE.handle } : st);

export function lastStyle() {
  const st = load('lastStyle', {});
  if (st.handle === OLD_HANDLE) save('lastStyle', fixHandle(st));
  const user = load('templates', {});
  if (Object.values(user).some(t => t?.handle === OLD_HANDLE)) {
    save('templates', Object.fromEntries(Object.entries(user).map(([k, t]) => [k, fixHandle(t)])));
  }
  return { ...DEFAULT_STYLE, ...fixHandle(st) };
}

export function rememberStyle(style) {
  save('lastStyle', style);
}
