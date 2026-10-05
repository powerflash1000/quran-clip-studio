// وضع السلسلة: تقسيم سورة (أو جزء منها) لمقاطع متتالية

// mode: 'count' (عدد آيات ثابت) | 'manual' (أعداد مكتوبة: 5,7,6) | 'duration' (أقصى مدة بالثواني)
// durations: مدة كل آية بالثواني (مطلوبة في وضع المدة بس) — durations[a] للآية a
// overhead: الوقت الثابت في كل جزء (البداية والنهاية والشاشة الأخيرة)
export function splitRange({ from, to, mode, count, sizes, maxSec, durations, gap, overhead, basmalaSec = 0 }) {
  const parts = [];
  if (mode === 'duration') {
    let start = from, total = overhead + basmalaSec;
    for (let a = from; a <= to; a++) {
      const d = durations[a] + gap;
      if (a > start && total + d > maxSec) {
        parts.push({ from: start, to: a - 1, duration: total });
        start = a;
        total = overhead;
      }
      total += d;
    }
    parts.push({ from: start, to, duration: total });
    return parts;
  }

  let list = mode === 'manual'
    ? String(sizes).split(/[^\d]+/).map(Number).filter(n => n > 0)
    : [Math.max(1, Number(count) || 5)];
  if (!list.length) list = [5];
  let a = from, i = 0;
  while (a <= to) {
    const n = list[Math.min(i, list.length - 1)]; // بعد آخر رقم بيكرر نفس الرقم
    const end = Math.min(to, a + n - 1);
    let duration = null;
    if (durations) {
      duration = overhead + (i === 0 ? basmalaSec : 0);
      for (let k = a; k <= end; k++) duration += durations[k] + gap;
    }
    parts.push({ from: a, to: end, duration });
    a = end + 1;
    i++;
  }
  return parts;
}

// فصول يوتيوب: starts = [ثواني بداية كل جزء في الفيديو الطويل]
export function chaptersText(parts, starts, surahName, arabicNum) {
  const ts = s => {
    const t = Math.max(0, Math.floor(s));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  };
  return parts.map((p, i) => {
    const range = p.from === p.to ? `الآية ${arabicNum(p.from)}` : `الآيات ${arabicNum(p.from)}–${arabicNum(p.to)}`;
    return `${ts(i === 0 ? 0 : starts[i])} ${surahName} | الجزء ${arabicNum(i + 1)}: ${range}`;
  }).join('\n');
}

// شروط يوتيوب للفصول: أول فصل 00:00، و 3 فصول على الأقل، وكل فصل 10 ثواني أو أكتر
export function chaptersWarnings(starts, totalDuration) {
  const w = [];
  if (starts.length < 3) w.push('يوتيوب محتاج ٣ فصول على الأقل عشان يعرضها.');
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : totalDuration;
    if (end - starts[i] < 10) { w.push('فيه جزء أقل من ١٠ ثواني، ويوتيوب ممكن ميعرضش الفصول.'); break; }
  }
  return w;
}
