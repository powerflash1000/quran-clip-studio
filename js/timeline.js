// 🎚️ تايم لاين التلاوة (تحت المعاينة): موجة صوت الملف كله فوق (تحدد منها «من هنا لهنا»)،
// وتحتها تكبير على الحتة المختارة: تسحب البداية والنهاية (تريم) وحدود الآيات، وتسمع، وتطبّق
// على الكارت أو تضيف الحتة كارت جديد. الوقت بيتكتب دقيقة:ثانية (مثلًا 12:34.5).

export const fmtT = t => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
export function parseT(v) {
  const s = String(v ?? '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,]/g, '.').replace(/[؛;]/g, ':');
  if (!s) return null;
  const p = s.split(':').map(Number);
  if (p.some(x => !Number.isFinite(x)) || p.length > 3) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}

// الآيات اللي جوه الحتة [A,B]: الآية بتتحسب لو أكتر من نصها جوه
// al = { starts:[بداية الآية k−1], ends:[آخر صوت قبل الآية k−1], n, lead }
export function rangeAyat(al, dur, A, B) {
  const { starts, ends, n } = al;
  const endOf = k => (k < n ? ends[k] : dur);
  const inside = k => (Math.min(B, endOf(k)) - Math.max(A, starts[k - 1])) / Math.max(0.01, endOf(k) - starts[k - 1]);
  let from = 1;
  while (from < n && inside(from) < 0.5) from++;
  let to = n;
  while (to > from && inside(to) < 0.5) to--;
  const basmala = !!al.lead && from === 1 && A < starts[0] - 1.5;
  return { from, to, basmala };
}

const peakCache = new WeakMap();
function overviewPeaks(buffer, bins = 2000) {
  let p = peakCache.get(buffer);
  if (p) return p;
  const d = buffer.getChannelData(0), per = d.length / bins, step = Math.max(1, Math.floor(per / 48));
  p = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    let m = 0;
    for (let j = Math.floor(i * per), e = Math.min(d.length, Math.floor((i + 1) * per)); j < e; j += step) { const v = Math.abs(d[j]); if (v > m) m = v; }
    p[i] = m;
  }
  let mx = 0;
  for (const v of p) if (v > mx) mx = v;
  if (mx > 0) for (let i = 0; i < bins; i++) p[i] /= mx;
  peakCache.set(buffer, p);
  return p;
}
function rangePeaks(buffer, a, b, w) {
  const d = buffer.getChannelData(0), sr = buffer.sampleRate, out = new Float32Array(w);
  const s0 = a * sr, per = (b - a) * sr / w, step = Math.max(1, Math.floor(per / 64));
  let mx = 0;
  for (let i = 0; i < w; i++) {
    let m = 0;
    for (let j = Math.max(0, Math.floor(s0 + i * per)), e = Math.min(d.length, Math.floor(s0 + (i + 1) * per)); j < e; j += step) { const v = Math.abs(d[j]); if (v > m) m = v; }
    out[i] = m; if (m > mx) mx = m;
  }
  if (mx > 0) for (let i = 0; i < w; i++) out[i] = Math.min(1, out[i] / mx * 1.1);
  return out;
}

// api: { cards() → [{b,label}], audio(b) → {buffer,url}|null, align(b) → al|null, apply(b,A,B,marks), add(b,A,B), current() → blockId, arabicNum, surahName(b) }
export function setupTimeline(api) {
  const $ = s => document.querySelector(s);
  const panel = $('#tl-panel'), over = $('#tl-over'), det = $('#tl-detail');
  const audio = new Audio();
  let drag0 = null, b = null, au = null, al = null, A = 0, B = 0, marks = [], view = [0, 1], drag = null, raf = 0;
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim();
  const dirty = () => b?.rec && (Math.abs(A - (b.rec.start || 0)) > 0.04 || Math.abs(B - (b.rec.end || 0)) > 0.04);

  const setView = () => {
    const pad = Math.max(1.5, (B - A) * 0.08);
    view = [Math.max(0, A - pad), Math.min(au.buffer.duration, B + pad)];
  };
  const load = id => {
    const list = api.cards();
    const sel = $('#tl-card');
    sel.innerHTML = list.map(c => `<option value="${c.b.id}">${c.label}</option>`).join('');
    const pickId = list.some(c => c.b.id === id) ? id : list.some(c => c.b.id === b?.id) ? b.id : list[0]?.b.id;
    sel.value = pickId || '';
    b = list.find(c => c.b.id === pickId)?.b || null;
    au = b ? api.audio(b) : null;
    $('#tl-body').hidden = !au;
    $('#tl-empty').hidden = !!au;
    if (!au) return;
    al = null;
    try { al = api.align(b); } catch { al = null; }
    A = Math.max(0, Number(b.rec.start) || 0);
    B = Math.min(au.buffer.duration, Number(b.rec.end) > A ? Number(b.rec.end) : au.buffer.duration);
    marks = [...(b.rec.marks || [])];
    if (audio.src !== au.url) { const a0 = A; audio.src = au.url; audio.addEventListener('loadedmetadata', () => { audio.currentTime = a0; ui(); }, { once: true }); }
    setView();
    $('#tl-snap').disabled = !al;
    ui();
  };
  const ui = () => {
    if (!au) return;
    $('#tl-a').textContent = fmtT(A);
    $('#tl-b').textContent = fmtT(B);
    $('#tl-now').textContent = fmtT(audio.currentTime);
    let txt = `المدة ${fmtT(B - A)}`;
    if (al) {
      const r = rangeAyat(al, au.buffer.duration, A, B);
      txt = `${r.basmala ? 'البسملة + ' : ''}${r.from === r.to ? 'الآية ' + api.arabicNum(r.from) : `الآيات ${api.arabicNum(r.from)}–${api.arabicNum(r.to)}`} من سورة ${api.surahName(b)} · ${txt}`;
    } else txt += ' · (الملف مش متقسّم آيات — هيتقسم حسب طول الآيات اللي في الكارت)';
    $('#tl-info').textContent = txt + (dirty() ? ' · ✏️ فيه تغيير لسه مش متطبّق' : '');
    $('#tl-apply').disabled = !dirty();
    draw();
  };

  const size = c => {
    const dpr = window.devicePixelRatio || 1, w = Math.max(50, c.clientWidth), h = c.clientHeight || Number(c.getAttribute('height')) || 60;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  };
  const draw = () => {
    if (!au || panel.hidden) return;
    const dur = au.buffer.duration, accent = css('--accent') || '#1f6f5c', ink = css('--text') || '#222', muted = css('--muted') || '#888';
    // فوق: الملف كله
    {
      const { g, w, h } = size(over), p = overviewPeaks(au.buffer), x = t => t / dur * w;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(127,127,127,.12)'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(127,127,127,.25)'; g.fillRect(x(view[0]), 0, Math.max(1, x(view[1]) - x(view[0])), h);
      g.fillStyle = accent; g.globalAlpha = 0.28; g.fillRect(x(A), 0, Math.max(2, x(B) - x(A)), h); g.globalAlpha = 1;
      g.fillStyle = muted;
      for (let i = 0; i < w; i++) { const v = p[Math.floor(i / w * p.length)] * (h / 2 - 3); g.fillRect(i, h / 2 - v, 1, Math.max(1, v * 2)); }
      if (al) { g.fillStyle = ink; g.globalAlpha = 0.35; for (const s of al.starts) g.fillRect(x(s), h - 5, 1, 5); g.globalAlpha = 1; }
      g.fillStyle = accent; g.fillRect(x(A) - 1, 0, 3, h); g.fillRect(x(B) - 1, 0, 3, h);
      // علامات الدقايق
      g.fillStyle = muted; g.font = '10px system-ui'; const stepM = dur > 3600 ? 600 : dur > 1200 ? 300 : dur > 300 ? 60 : 10;
      for (let t = stepM; t < dur; t += stepM) { g.fillRect(x(t), 0, 1, 4); g.fillText(fmtT(t).replace(/\.0$/, ''), x(t) + 2, 10); }
      g.fillStyle = audio.paused ? ink : '#e33'; g.fillRect(x(audio.currentTime) - 1, 0, 2, h);
    }
    // تحت: تكبير على الحتة
    {
      const { g, w, h } = size(det), [v0, v1] = view, x = t => (t - v0) / (v1 - v0) * w, p = rangePeaks(au.buffer, v0, v1, Math.round(w));
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(127,127,127,.18)'; g.fillRect(0, 0, w, h);
      g.fillStyle = accent; g.globalAlpha = 0.14; g.fillRect(x(A), 0, x(B) - x(A), h); g.globalAlpha = 1;
      for (let i = 0; i < p.length; i++) {
        const t = v0 + (i / p.length) * (v1 - v0), v = p[i] * (h / 2 - 14);
        g.fillStyle = t >= A && t <= B ? accent : muted;
        g.fillRect(i, h / 2 - v, 1, Math.max(1, v * 2));
      }
      g.font = 'bold 12px system-ui'; g.textAlign = 'center';
      // أرقام الآيات (من التقسيم)
      if (al) {
        g.fillStyle = ink;
        al.starts.forEach((s, k) => { if (s > v0 && s < v1) { g.globalAlpha = 0.25; g.fillRect(x(s), 14, 1, h - 28); g.globalAlpha = 0.8; g.fillText(api.arabicNum(k + 1), x(s) + 8, 12); g.globalAlpha = 1; } });
      }
      // حدود الآيات في الكارت (تتسحب)
      if (!dirty()) {
        g.fillStyle = '#d98b00';
        for (const m of marks) if (m > v0 && m < v1) { g.fillRect(x(m) - 1, 14, 2, h - 28); g.beginPath(); g.moveTo(x(m) - 5, h - 14); g.lineTo(x(m) + 5, h - 14); g.lineTo(x(m), h - 6); g.fill(); }
      }
      // البداية والنهاية
      for (const [t, lab] of [[A, 'من'], [B, 'إلى']]) {
        g.fillStyle = accent; g.fillRect(x(t) - 1.5, 0, 3, h);
        const lx = Math.max(17, Math.min(w - 17, x(t)));
        g.beginPath(); g.roundRect ? g.roundRect(lx - 16, h - 16, 32, 16, 4) : g.rect(lx - 16, h - 16, 32, 16); g.fill();
        g.fillStyle = '#fff'; g.fillText(lab, lx, h - 4);
      }
      g.textAlign = 'left'; g.fillStyle = muted; g.font = '10px system-ui';
      g.fillText(fmtT(v0), 3, h - 3); g.textAlign = 'right'; g.fillText(fmtT(v1), w - 3, h - 3); g.textAlign = 'left';
      if (audio.currentTime >= v0 && audio.currentTime <= v1) { g.fillStyle = audio.paused ? ink : '#e33'; g.fillRect(x(audio.currentTime) - 1, 0, 2, h); }
    }
  };
  // free = تشغيل عادي (بتسمع وتعلّم «ابدأ من هنا» / «لحد هنا»)، وإلا بيقف لوحده عند «إلى»
  let free = false;
  const labels = () => {
    const on = !audio.paused;
    $('#tl-free').textContent = on && free ? '⏸ وقّف' : '▶ شغّل';
    $('#tl-play').textContent = on && !free ? '■ وقّف' : '▶ اسمع الحتة اللي اخترتها';
  };
  const tick = () => {
    $('#tl-now').textContent = fmtT(audio.currentTime);
    if (audio.paused) { raf = 0; labels(); draw(); return; }
    if (!free && audio.currentTime >= B) audio.pause();
    draw(); raf = requestAnimationFrame(tick);
  };
  const play = (from, isFree = false) => {
    free = isFree;
    if (from != null) audio.currentTime = from;
    audio.play().then(() => { labels(); if (!raf) raf = requestAnimationFrame(tick); }).catch(() => {});
  };
  const seek = t => { audio.currentTime = Math.max(0, Math.min(au.buffer.duration, t)); $('#tl-now').textContent = fmtT(audio.currentTime); draw(); };
  const snap = (t, which) => {
    if (!al || !$('#tl-snap').checked) return t;
    const dur = au.buffer.duration;
    const cands = which === 'A' ? [0, ...al.starts] : [...al.ends.slice(1).map(e => Math.min(dur, e + 0.25)), dur];
    let best = t, bd = Math.max(1.2, (view[1] - view[0]) * 0.02);
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  };
  const clampAB = () => {
    const dur = au.buffer.duration;
    A = Math.max(0, Math.min(A, dur - 0.2));
    B = Math.max(A + 0.2, Math.min(B, dur));
  };

  // السحب على الملف كله: حتة جديدة، أو تحريك طرف، أو تحريك الحتة كلها
  const tOf = (c, e, v) => { const r = c.getBoundingClientRect(); return v[0] + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (v[1] - v[0]); };
  over.onpointerdown = e => {
    if (!au) return;
    const dur = au.buffer.duration, v = [0, dur], t = tOf(over, e, v), tol = dur / over.clientWidth * 6;
    if (Math.abs(t - A) < tol) drag = { c: over, v, k: 'A' };
    else if (Math.abs(t - B) < tol) drag = { c: over, v, k: 'B' };
    else if (t > A && t < B && B - A < dur * 0.7) drag = { c: over, v, k: 'move', t0: t, A0: A, B0: B };
    else { drag0 = { A, B, t }; A = B = t; drag = { c: over, v, k: 'new', t0: t }; }
    over.setPointerCapture(e.pointerId);
  };
  det.onpointerdown = e => {
    if (!au) return;
    const v = [...view], t = tOf(det, e, v), tol = (v[1] - v[0]) / det.clientWidth * 8;
    if (Math.abs(t - A) < tol) drag = { c: det, v, k: 'A' };
    else if (Math.abs(t - B) < tol) drag = { c: det, v, k: 'B' };
    else {
      const mi = dirty() ? -1 : marks.findIndex(m => Math.abs(m - t) < tol);
      if (mi >= 0) drag = { c: det, v, k: 'mark', i: mi };
      else { if (!audio.paused && free) seek(t); else play(Math.max(A, Math.min(t, B - 0.1))); return; }
    }
    det.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag) return;
    const t = tOf(drag.c, e, drag.v);
    if (drag.k === 'A') A = Math.min(t, B - 0.2);
    else if (drag.k === 'B') B = Math.max(t, A + 0.2);
    else if (drag.k === 'new') { A = Math.min(drag.t0, t); B = Math.max(drag.t0, t); }
    else if (drag.k === 'move') { const d = t - drag.t0, dur = au.buffer.duration, len = drag.B0 - drag.A0; A = Math.max(0, Math.min(dur - len, drag.A0 + d)); B = A + len; }
    else if (drag.k === 'mark') { const lo = marks[drag.i - 1] ?? A, hi = marks[drag.i + 1] ?? B; marks[drag.i] = Math.max(lo + 0.2, Math.min(hi - 0.2, t)); }
    ui();
  };
  const up = () => {
    if (!drag) return;
    const k = drag.k;
    drag = null;
    if (k === 'mark') { api.apply(b, A, B, marks.map(m => +m.toFixed(2))); ui(); return; }
    if (k === 'new' && B - A < 0.5) { A = drag0.A; B = drag0.B; seek(drag0.t); ui(); return; } // دوسة من غير سحب = نط للمكان ده
    if (k === 'A' || k === 'new' || k === 'move') A = snap(A, 'A');
    if (k === 'B' || k === 'new' || k === 'move') B = snap(B, 'B');
    clampAB();
    setView(); ui();
  };
  for (const c of [over, det]) { c.onpointermove = move; c.onpointerup = up; c.onpointercancel = up; }

  $('#tl-play').onclick = () => (audio.paused || free ? play(A) : audio.pause());
  $('#tl-free').onclick = () => (audio.paused || !free ? play(null, true) : audio.pause());
  $('#tl-back').onclick = () => seek(audio.currentTime - 5);
  $('#tl-fwd').onclick = () => seek(audio.currentTime + 5);
  // «ابدأ من هنا» / «لحد هنا»: من مكان التشغيل دلوقتي
  $('#tl-setA').onclick = () => {
    if (!au) return;
    const dur = au.buffer.duration, len = Math.max(5, B - A);
    A = snap(audio.currentTime, 'A');
    if (B <= A + 0.2) B = Math.min(dur, A + len);
    clampAB(); setView(); ui();
  };
  $('#tl-setB').onclick = () => {
    if (!au) return;
    const t = snap(audio.currentTime, 'B');
    if (t <= A + 0.2) { $('#tl-info').textContent = '⚠️ «لحد هنا» لازم تبقى بعد «ابدأ من هنا» — شغّل لحد آخر الحتة ودوس تاني.'; return; }
    B = t;
    if (free) audio.pause();
    clampAB(); setView(); ui();
  };
  panel.querySelectorAll('[data-nudge]').forEach(btn => {
    btn.onclick = () => {
      const [k, d] = btn.dataset.nudge.split(','); if (k === 'A') A += Number(d); else B += Number(d);
      clampAB(); setView(); ui();
      if (audio.paused || !free) play(k === 'A' ? A : Math.max(A, B - 3));
    };
  });
  $('#tl-reset').onclick = () => load(b?.id);
  $('#tl-apply').onclick = () => { if (!b) return; audio.pause(); api.apply(b, A, B); load(b.id); };
  $('#tl-add').onclick = async () => { if (!b) return; audio.pause(); const nb = await api.add(b, A, B); if (nb) load(nb.id); };
  $('#tl-card').onchange = () => load($('#tl-card').value);
  $('#tl-close').onclick = () => toggle(false);
  new ResizeObserver(() => draw()).observe(panel);

  const toggle = (on, id) => {
    panel.hidden = !on;
    $('#pv-tl')?.classList.toggle('on', on);
    if (!on) { audio.pause(); return; }
    load(id ?? api.current() ?? b?.id);
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return {
    open: id => toggle(true, id),
    toggle: () => toggle(panel.hidden),
    refresh: () => { if (!panel.hidden && !drag) load(b?.id); },
    follow: id => { if (!panel.hidden && !drag && audio.paused && id && id !== b?.id && api.cards().some(c => c.b.id === id)) load(id); },
  };
}
