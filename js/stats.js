// لوحة الأرقام: قراءة تقرير الفيديوهات (CSV من TikTok Studio أو غيره) + سجل التجارب، وتطلع إيه اللي بينجح

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t'
    : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const COLS = {
  views: /^(total )?(video )?views?$|play|مشاهد/i,
  likes: /like|إعجاب|اعجاب/i,
  comments: /comment|تعليق/i,
  shares: /share|مشارك/i,
  title: /title|caption|description|text|عنوان|وصف|المحتوى/i,
  date: /post(ed)? ?(time|date|on)|created|publish|date|time|تاريخ|وقت|نشر/i,
  duration: /duration|length|مدة/i,
};

export const num = v => {
  const s = String(v ?? '').trim().replace(/,/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const m = s.match(/^([\d.]+)\s*([kKmM]?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1));
};

const secs = v => {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// يرجع [{ title, views, likes, comments, shares, date: Date|null, dur }]
export function rowsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('الملف فاضي أو مش CSV');
  const head = rows[0].map(h => h.trim());
  const idx = {};
  for (const [k, re] of Object.entries(COLS)) {
    const i = head.findIndex((h, j) => re.test(h) && !Object.values(idx).includes(j));
    if (i !== -1) idx[k] = i;
  }
  if (idx.views == null) throw new Error('مش لاقي عمود المشاهدات (Views) في الملف');
  return rows.slice(1).map(r => {
    const d = idx.date != null ? new Date(r[idx.date]) : null;
    return {
      title: idx.title != null ? r[idx.title] : '',
      views: num(r[idx.views]),
      likes: idx.likes != null ? num(r[idx.likes]) : null,
      comments: idx.comments != null ? num(r[idx.comments]) : null,
      shares: idx.shares != null ? num(r[idx.shares]) : null,
      date: d && !isNaN(d) ? d : null,
      dur: idx.duration != null ? secs(r[idx.duration]) : null,
    };
  }).filter(r => r.views != null);
}

// ===== التحليل =====
// helpers: { findSurahIn(title) -> surahName|null, reciterIn(title) -> name|null }
export function analyze(rows, helpers) {
  const enrich = rows.map(r => {
    const t = (r.title || '').trim();
    return {
      ...r,
      surah: r.surah || helpers.findSurahIn(t),
      reciter: r.reciter || helpers.reciterIn(t),
      hookFirst: r.hookFirst ?? (t && !/^(سور[ةه]|﴿|\(|«?قال)/.test(t)),
      hour: r.date && (r.date.getHours() || r.date.getMinutes()) ? r.date.getHours() : null,
      weekday: r.date ? r.date.getDay() : null,
    };
  });
  const total = enrich.reduce((s, r) => s + r.views, 0);
  const likes = enrich.reduce((s, r) => s + (r.likes || 0), 0);
  const avg = enrich.length ? total / enrich.length : 0;
  const group = (key, label) => {
    const m = new Map();
    for (const r of enrich) {
      const k = key(r);
      if (k == null || k === '') continue;
      const g = m.get(k) || { k, label: label ? label(k) : k, n: 0, views: 0, likes: 0 };
      g.n++; g.views += r.views; g.likes += r.likes || 0;
      m.set(k, g);
    }
    return [...m.values()].map(g => ({ ...g, avg: g.views / g.n, likeRate: g.views ? g.likes / g.views : 0 }))
      .sort((a, b) => b.avg - a.avg);
  };
  const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  const hourLabel = h => { const b = Math.floor(h / 3) * 3; const f = x => `${((x + 11) % 12) + 1}${x < 12 ? 'ص' : 'م'}`; return `${f(b)}–${f((b + 3) % 24)}`; };
  return {
    count: enrich.length, total, avg, likeRate: total ? likes / total : 0,
    top: [...enrich].sort((a, b) => b.views - a.views).slice(0, 5),
    bottom: [...enrich].sort((a, b) => a.views - b.views).slice(0, 3),
    byHour: group(r => r.hour == null ? null : Math.floor(r.hour / 3) * 3, hourLabel),
    byDay: group(r => r.weekday, d => DAYS[d]),
    bySurah: group(r => r.surah),
    byReciter: group(r => r.reciter),
    byHook: group(r => (r.title ? (r.hookFirst ? 'hook' : 'plain') : null), k => (k === 'hook' ? 'بيبدأ بافتتاحية تشد' : 'بيبدأ باسم السورة/النص')),
    byDur: group(r => r.dur == null ? null : r.dur < 30 ? 'a' : r.dur <= 60 ? 'b' : 'c', k => ({ a: 'أقل من ٣٠ث', b: '٣٠–٦٠ث', c: 'أكتر من دقيقة' }[k])),
    byWordMode: group(r => r.wordMode, k => ({ full: 'الآية كاملة', reveal: 'كلمة كلمة', highlight: 'تظليل' }[k] || k)),
  };
}
