// مخطط النشر: التاريخ الهجري، المواسم الجاية، سجل اللي اتنشر، تحذير التكرار، والمواعيد المقترحة

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
const hijriLong = new Intl.DateTimeFormat('ar-EG-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

export function hijri(date) {
  const p = Object.fromEntries(hijriFmt.formatToParts(date).map(x => [x.type, x.value]));
  return { d: Number(p.day), m: Number(p.month), y: Number(p.year) };
}
export const hijriText = date => hijriLong.format(date);
export const dayText = date => dayFmt.format(date);

// ref: نص بيفهمه parseRefs (يتحمّل في المحرر بضغطة)
const HIJRI = [
  { m: 9, from: 1, to: 30, title: 'رمضان', ref: 'البقرة 183-186', tip: 'آيات الصيام، ودعاء «اللهم إنك عفو» في العشر الأواخر' },
  { m: 9, days: [21, 23, 25, 27, 29], title: 'ليلة وتر من العشر الأواخر', ref: 'القدر', tip: 'سورة القدر، ودعاء ليلة القدر' },
  { m: 10, from: 1, to: 1, title: 'عيد الفطر', ref: 'الأعلى 14-15', tip: 'تكبيرات العيد وتهنئة' },
  { m: 12, from: 1, to: 8, title: 'العشر من ذي الحجة', ref: 'الحج 27-29', tip: 'فضل العشر والتكبير والذكر' },
  { m: 12, from: 9, to: 9, title: 'يوم عرفة', ref: 'المائدة 3', tip: 'خير الدعاء دعاء يوم عرفة' },
  { m: 12, from: 10, to: 10, title: 'عيد الأضحى', ref: 'الصافات 102-107', tip: 'قصة الذبح العظيم' },
  { m: 1, from: 1, to: 1, title: 'رأس السنة الهجرية', ref: 'التوبة 40', tip: 'الهجرة: «إذ يقول لصاحبه لا تحزن»' },
  { m: 1, from: 9, to: 10, title: 'تاسوعاء وعاشوراء', ref: 'الشعراء 61-63', tip: 'نجاة موسى عليه السلام — وصيام اليوم' },
  { m: 7, from: 27, to: 27, title: 'ليلة الإسراء والمعراج (على المشهور)', ref: 'الإسراء 1', tip: 'أول سورة الإسراء' },
];

// المواسم في الأيام الجاية (افتراضي ١٤ يوم)
export function upcoming(from = new Date(), days = 14) {
  const out = [];
  const start = new Date(from); start.setHours(12, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const h = hijri(d);
    const list = [];
    if (d.getDay() === 5) list.push({ title: 'الجمعة', ref: 'الكهف 1-10', tip: 'سورة الكهف يوم الجمعة — من أقوى أيام المحتوى ده', weekly: true });
    if (d.getDay() === 4) list.push({ title: 'ليلة الجمعة (الخميس بالليل)', ref: 'الكهف 1-10', tip: 'جهّز فيديو الكهف وجدوله الصبح بدري', weekly: true });
    for (const o of HIJRI) {
      if (o.m !== h.m) continue;
      if (o.days ? o.days.includes(h.d) : h.d >= o.from && h.d <= o.to) list.push(o);
    }
    if (h.d >= 13 && h.d <= 15) list.push({ title: 'الأيام البيض', tip: 'تذكير بصيام الأيام البيض', weekly: true });
    if (list.length) out.push({ date: d, hijri: h, items: list });
  }
  return out;
}

// ===== سجل النشر =====
// post: { id, at (ISO), platform, title, keys: ['12:4-6'], surahs: [12] }
export function postFromBlocks(blocks, platform, title) {
  const q = blocks.filter(b => b.type === 'quran');
  return {
    id: Math.random().toString(36).slice(2, 9),
    at: new Date().toISOString(),
    platform, title: title || '',
    keys: q.map(b => `${b.surah}:${b.from}-${b.to}`),
    surahs: [...new Set(q.map(b => b.surah))],
    other: blocks.filter(b => b.type !== 'quran').map(b => b.type === 'zikr' ? `zikr:${b.cat}:${b.index}` : `hadith:${b.col}:${b.number}`),
  };
}

const DAY = 864e5;

// تحذيرات قبل النشر: نفس الآيات خلال ١٤ يوم، نفس السورة خلال ٧ أيام، أو آخر نشر من أقل من ٤ ساعات
export function checkBlocks(blocks, posts, now = Date.now()) {
  const warn = [];
  const q = blocks.filter(b => b.type === 'quran');
  for (const b of q) {
    for (const p of posts) {
      const age = now - Date.parse(p.at);
      if (age < 0) continue;
      const overlap = p.keys.some(k => {
        const [s, r] = k.split(':'); const [f, t] = r.split('-').map(Number);
        return Number(s) === b.surah && f <= b.to && t >= b.from;
      });
      if (overlap && age < 14 * DAY) { warn.push({ level: 'high', surah: b.surah, days: Math.floor(age / DAY), kind: 'same' }); break; }
      if (p.surahs.includes(b.surah) && age < 7 * DAY) { warn.push({ level: 'mid', surah: b.surah, days: Math.floor(age / DAY), kind: 'surah' }); break; }
    }
  }
  const other = blocks.filter(b => b.type !== 'quran').map(b => b.type === 'zikr' ? `zikr:${b.cat}:${b.index}` : `hadith:${b.col}:${b.number}`);
  if (other.length && posts.some(p => now - Date.parse(p.at) < 14 * DAY && p.other?.some(o => other.includes(o)))) warn.push({ level: 'high', kind: 'other' });
  const last = posts.reduce((m, p) => Math.max(m, Date.parse(p.at)), 0);
  if (last && now - last < 4 * 36e5) warn.push({ level: 'mid', kind: 'spacing', hours: (now - last) / 36e5 });
  return warn;
}

// المواعيد الجاية المقترحة: من أوقاتك المفضلة، بحد أقصى perDay في اليوم، وبينها ٤ ساعات على الأقل
export function nextSlots(posts, times = ['14:00', '20:00', '22:30'], perDay = 2, count = 6, now = new Date()) {
  const taken = posts.map(p => Date.parse(p.at));
  const out = [];
  const sorted = [...times].map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t)).sort();
  for (let day = 0; day < 10 && out.length < count; day++) {
    const base = new Date(now); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + day);
    const dayEnd = base.getTime() + DAY;
    let used = taken.filter(t => t >= base.getTime() && t < dayEnd).length;
    for (const t of sorted) {
      if (used >= perDay || out.length >= count) break;
      const [h, m] = t.split(':').map(Number);
      const at = new Date(base); at.setHours(h, m, 0, 0);
      if (at.getTime() < now.getTime() + 15 * 6e4) continue;
      const all = [...taken, ...out.map(o => o.getTime())];
      if (all.some(x => Math.abs(x - at.getTime()) < 4 * 36e5)) continue;
      out.push(at);
      used++;
    }
  }
  return out;
}
