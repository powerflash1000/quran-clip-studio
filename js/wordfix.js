// ✏️ صلّح كلمة في صوت متولّد (ElevenLabs أو Gemini) من غير ما تولّد الكلام كله تاني:
// بتدوس على الكلمة (أو كذا كلمة ورا بعض) ← البرنامج بيحدد مكانها في الصوت (وتقدر تظبطه بالسحب وتسمع)
// ← تكتب النطق اللي عايزه (بتشكيل مثلًا) وتختار المولّد ← بيتولّد الحتة دي بس (كام حرف)
// ← بتسمعها جوه الجملة وتعتمدها، وتقدر تجرّب كذا نسخة وتختار. الكود ده مستقل (نفس الملف في برنامج الريلز).

const FADE = 0.012;
const strip = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ«»"“”()[\]{}]/g, '');
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };

// ===== مكان كل كلمة في الصوت (تقدير) =====
// الوقت بيتوزّع على الكلام الفعلي بس (السكتات مش محسوبة) حسب طول كل كلمة، وبعد علامات الوقف
// (، . ؟ ! : …) حدود الكلمة بتلزق على أقرب سكتة. التقدير بيتظبط بإيدك لو محتاج.
export function estimateWords(buffer, text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const d = buffer.getChannelData(0), sr = buffer.sampleRate, hop = Math.round(sr * 0.01);
  const env = [];
  for (let i = 0; i + hop <= d.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j += 2) s += d[j] * d[j]; env.push(Math.sqrt(s / (hop / 2))); }
  let pk = 1e-6; for (const v of env) if (v > pk) pk = v;
  const voiced = env.map(v => v > pk * 0.06);
  let s0 = voiced.indexOf(true), e0 = voiced.lastIndexOf(true) + 1;
  if (s0 < 0) { s0 = 0; e0 = env.length; }
  // السكتات جوه الكلام: الطويلة (١٥٠ ملّي) بعد علامات الوقف، والقصيرة (٦٠ ملّي) بين الكلمات
  const gaps = [];
  for (let i = s0, st = -1; i <= e0; i++) {
    const v = i < e0 ? voiced[i] : true;
    if (!v && st < 0) st = i;
    if (v && st >= 0) { if (i - st >= 6) gaps.push([st / 100, i / 100, (i - st) / 100]); st = -1; }
  }
  // لو السكتات الواضحة (٨٠ ملّي أو أكتر) عددها = عدد الفواصل بين الكلمات بالظبط: كل سكتة هي حد كلمة — ده أدق تقسيم ممكن
  const clear = gaps.filter(g => g[2] >= 0.08);
  if (words.length > 1 && clear.length === words.length - 1) {
    return words.map((x, i) => ({ text: x, start: i ? clear[i - 1][1] : s0 / 100, end: i < clear.length ? clear[i][0] : e0 / 100 }));
  }
  // الوقت المنطوق التراكمي (من غير السكتات)
  const cum = [0]; for (let i = 0; i < env.length; i++) cum.push(cum[i] + (voiced[i] ? 0.01 : 0));
  const vAt = t => cum[Math.max(0, Math.min(env.length, Math.round(t * 100)))];
  const tAt = v => { let lo = s0, hi = e0; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < v) lo = m + 1; else hi = m; } return lo / 100; };
  const w = words.map(x => strip(x).length + 1);
  // نقط ثابتة: أول الكلام وآخره، وكل علامة وقف لازقة على أقرب سكتة طويلة
  const anchors = [[0, s0 / 100], [words.length, e0 / 100]];
  const totW = w.reduce((a, b) => a + b, 0), totV = vAt(e0 / 100) - vAt(s0 / 100);
  let c = 0;
  words.forEach((x, i) => {
    c += w[i];
    if (i === words.length - 1 || !/[،,.؟?!:؛…]$/.test(x)) return;
    const guess = tAt(vAt(s0 / 100) + totV * c / totW);
    let best = null, bd = 1.2;
    for (const g of gaps) if (g[2] >= 0.15) { const dd = Math.abs((g[0] + g[1]) / 2 - guess); if (dd < bd) { bd = dd; best = g; } }
    if (best) anchors.push([i + 1, best[1], best[0]]);
  });
  anchors.sort((a, b) => a[0] - b[0]);
  const out = words.map(x => ({ text: x, start: 0, end: 0 }));
  for (let k = 0; k < anchors.length - 1; k++) {
    const [i0, t0] = anchors[k], [i1, t1b, t1e] = anchors[k + 1];
    const t1 = t1e ?? t1b; // نهاية الجزء = أول السكتة
    const v0 = vAt(t0), v1 = vAt(t1), ww = w.slice(i0, i1), tw = ww.reduce((a, b) => a + b, 0) || 1;
    let cc = 0;
    for (let i = i0; i < i1; i++) { out[i].start = tAt(v0 + (v1 - v0) * cc / tw); cc += w[i]; out[i].end = tAt(v0 + (v1 - v0) * cc / tw); }
    if (i0 < i1) { out[i0].start = t0; out[i1 - 1].end = t1; }
  }
  // حدود الكلمات بتلزق على السكتات القصيرة القريبة (لو فيه)
  for (let i = 0; i < out.length - 1; i++) {
    const bnd = out[i].end; let best = null, bd = 0.22;
    for (const g of gaps) { const dd = Math.abs((g[0] + g[1]) / 2 - bnd); if (dd < bd) { bd = dd; best = g; } }
    if (best && best[0] > out[i].start + 0.05 && best[1] < out[i + 1].end - 0.05) { out[i].end = best[0]; out[i + 1].start = best[1]; }
  }
  for (let i = 1; i < out.length; i++) { if (out[i].start < out[i - 1].end) out[i].start = out[i - 1].end; if (out[i].end < out[i].start + 0.05) out[i].end = out[i].start + 0.05; }
  return out;
}

// ===== أدوات صوت =====
function copyBuf(b) {
  const o = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(b.getChannelData(c), c);
  return o;
}
function slice(b, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * b.sampleRate)), z = Math.min(b.length, Math.ceil(t1 * b.sampleRate));
  const o = new AudioBuffer({ length: Math.max(1, z - a), numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(b.getChannelData(c).subarray(a, z), c);
  return o;
}
async function conform(snip, like) {
  // نفس معدّل العيّنات وعدد القنوات بتوع الصوت الأصلي
  const len = Math.ceil(snip.duration * like.sampleRate);
  const oc = new OfflineAudioContext(like.numberOfChannels, Math.max(1, len), like.sampleRate);
  const src = oc.createBufferSource(); src.buffer = snip; src.connect(oc.destination); src.start();
  return oc.startRendering();
}
function trimEdges(b, pad = 0.03) {
  const d = b.getChannelData(0); let pk = 0;
  for (let i = 0; i < d.length; i += 4) pk = Math.max(pk, Math.abs(d[i]));
  const thr = Math.max(0.004, pk * 0.05);
  let s = 0, e = d.length - 1;
  while (s < e && Math.abs(d[s]) < thr) s++;
  while (e > s && Math.abs(d[e]) < thr) e--;
  const p = Math.round(pad * b.sampleRate);
  return slice(b, Math.max(0, s - p) / b.sampleRate, Math.min(d.length, e + p) / b.sampleRate);
}
const rms = (b, t0 = 0, t1 = b.duration) => {
  const d = b.getChannelData(0), a = Math.floor(t0 * b.sampleRate), z = Math.min(d.length, Math.floor(t1 * b.sampleRate));
  let s = 0, n = 0; for (let i = a; i < z; i += 2) { if (Math.abs(d[i]) > 0.003) { s += d[i] * d[i]; n++; } }
  return n ? Math.sqrt(s / n) : 0;
};
// بيحط الحتة الجديدة مكان [a,b] بفيد صغير في الطرفين وبعلو قريب من الأصل
export function splice(orig, snip, a, b) {
  const sr = orig.sampleRate, A = Math.round(a * sr), Bz = Math.round(b * sr), F = Math.round(FADE * sr);
  const g = (() => { const r0 = rms(orig, a, b), r1 = rms(snip); return r0 && r1 ? Math.min(2, Math.max(0.5, r0 / r1)) : 1; })();
  const len = A + snip.length + (orig.length - Bz);
  const out = new AudioBuffer({ length: len, numberOfChannels: orig.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < orig.numberOfChannels; c++) {
    const o = orig.getChannelData(c), s = snip.getChannelData(Math.min(c, snip.numberOfChannels - 1)), d = out.getChannelData(c);
    d.set(o.subarray(0, A), 0);
    for (let i = 0; i < snip.length; i++) d[A + i] = s[i] * g * Math.min(1, i / F, (snip.length - 1 - i) / F);
    d.set(o.subarray(Bz), A + snip.length);
    for (let i = 0; i < F && A - 1 - i >= 0; i++) d[A - 1 - i] *= i / F;               // الكلام اللي قبلها بيخفت
    for (let i = 0; i < F && A + snip.length + i < len; i++) d[A + snip.length + i] *= i / F; // واللي بعدها بيعلى
  }
  return out;
}

// ===== الواجهة =====
let css = false;
function injectCss() {
  if (css) return; css = true;
  const st = document.createElement('style');
  st.textContent = `
  .wf-dlg{max-width:920px;width:calc(100vw - 32px)}
  .wf-words{display:flex;flex-wrap:wrap;gap:.3rem;direction:rtl;line-height:1.9;padding:.6rem;border:1px solid var(--line,#ccc);border-radius:10px;max-height:30vh;overflow:auto}
  .wf-w{padding:.1rem .45rem;border-radius:7px;cursor:pointer;border:1px solid transparent;font-size:1.05rem;user-select:none}
  .wf-w:hover{border-color:var(--line,#bbb)}
  .wf-w.sel{background:var(--accent,#1f6f5c);color:#fff}
  .wf-w.done{box-shadow:inset 0 -3px 0 #d98b00}
  .wf-cv{display:block;width:100%;height:110px;direction:ltr;border-radius:8px;margin-top:.6rem;cursor:ew-resize;touch-action:none}
  .wf-row{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-top:.55rem}
  .wf-row input[type=text]{flex:1;min-width:200px;font-size:1.1rem}
  .wf-takes{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.4rem}
  .wf-takes .btn.on{background:var(--accent,#1f6f5c);color:#fff}
  .wf-t{direction:ltr;font-variant-numeric:tabular-nums;font-weight:700}
  .wf-hint{font-size:.85rem;opacity:.8;margin:.4rem 0 0}`;
  document.head.appendChild(st);
}

// opts: { buffer, text, words?:[{text,start,end}] (توقيت جاهز زي ElevenLabs with-timestamps), providers:[{id,name,speak:async text=>Blob, note?}], provider, decode:async ab=>AudioBuffer, onApply:(buffer, words)=>void|Promise }
export function openWordFix(opts) {
  injectCss();
  const { text, providers, decode, onApply } = opts;
  let work = copyBuf(opts.buffer);
  let words = opts.words?.length ? opts.words.map(w => ({ text: w.text, start: w.start, end: w.end })) : estimateWords(work, text);
  let selA = -1, selB = -1, A = 0, B = 0, takes = [], take = -1, changed = 0, drag = null, actx = null, playing = null;
  const dlg = document.createElement('dialog');
  dlg.className = 'wf-dlg';
  dlg.innerHTML = `<div class="dlg">
    <div class="row"><h2 class="grow" style="margin:0">✏️ صلّح كلمة في الصوت</h2><button class="btn icon" data-x="close" type="button" title="اقفل">✕</button></div>
    <p class="wf-hint">١) دوس على الكلمة اللي اتنطقت غلط (ولو أكتر من كلمة: دوس على الأولى وبعدين Shift + الأخيرة). ٢) اسمع واتأكد إن الحتة المعلّمة هي الكلمة بالظبط (اسحب الطرفين لو محتاج). ٣) اكتب النطق الصح — والتشكيل بيفرق جدًا — واختار المولّد ودوس «🔁 ولّد الحتة دي بس».</p>
    <div class="wf-words" data-x="words"></div>
    <canvas class="wf-cv" data-x="cv" height="110"></canvas>
    <div class="wf-row">
      <button class="btn" data-x="playCtx" type="button">▶ اسمعها في الجملة</button>
      <button class="btn" data-x="playSel" type="button">▶ الكلمة لوحدها</button>
      <span>من <span class="wf-t" data-x="ta"></span> لـ <span class="wf-t" data-x="tb"></span></span>
      <span>البداية <button class="btn icon" data-n="A,-0.05" type="button" title="البداية لورا شوية">−</button><button class="btn icon" data-n="A,0.05" type="button" title="البداية لقدام شوية">+</button></span>
      <span>النهاية <button class="btn icon" data-n="B,-0.05" type="button" title="النهاية لورا شوية">−</button><button class="btn icon" data-n="B,0.05" type="button" title="النهاية لقدام شوية">+</button></span>
    </div>
    <div class="wf-row">
      <input type="text" data-x="say" placeholder="النطق الصح للحتة دي (بتشكيل)" dir="rtl">
      <select data-x="prov">${providers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
      <button class="btn primary" data-x="gen" type="button">🔁 ولّد الحتة دي بس</button>
    </div>
    <p class="wf-hint" data-x="provNote"></p>
    <div class="wf-takes" data-x="takes"></div>
    <div class="wf-row">
      <button class="btn" data-x="playNew" type="button" disabled>▶ اسمع بعد التصليح</button>
      <button class="btn primary" data-x="accept" type="button" disabled>✅ اعتمد التصليح ده</button>
    </div>
    <p class="wf-hint" data-x="status"></p>
    <div class="wf-row" style="border-top:1px solid var(--line,#ddd);padding-top:.6rem">
      <button class="btn primary" data-x="save" type="button" disabled>💾 احفظ الصوت المصلّح في الكارت</button>
      <button class="btn ghost" data-x="close2" type="button">اقفل من غير حفظ</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  const q = k => dlg.querySelector(`[data-x=${k}]`);
  const status = t => { q('status').textContent = t; };
  q('prov').value = opts.provider && providers.some(p => p.id === opts.provider) ? opts.provider : providers[0]?.id;
  const provNote = () => { q('provNote').textContent = providers.find(p => p.id === q('prov').value)?.note || ''; };
  q('prov').onchange = provNote; provNote();

  const renderWords = () => {
    q('words').innerHTML = words.map((w, i) => `<span class="wf-w${i >= selA && i <= selB ? ' sel' : ''}${w.fixed ? ' done' : ''}" data-i="${i}">${w.text}</span>`).join('');
  };
  q('words').onclick = e => {
    const i = Number(e.target.dataset?.i);
    if (!Number.isFinite(i)) return;
    if (e.shiftKey && selA >= 0) { selA = Math.min(selA, i); selB = Math.max(selB, i); } else { selA = selB = i; }
    A = words[selA].start; B = words[selB].end;
    q('say').value = words.slice(selA, selB + 1).map(w => w.text).join(' ');
    takes = []; take = -1;
    renderWords(); renderTakes(); ui();
    play(Math.max(0, A - 1.2), Math.min(work.duration, B + 1), work);
  };

  // الموجة: حتة حوالين الكلمة، والطرفين بيتسحبوا
  const view = () => { const pad = Math.max(1.2, (B - A) * 0.6); return [Math.max(0, A - pad), Math.min(work.duration, B + pad)]; };
  let vw = [0, 1];
  const draw = () => {
    const cv = q('cv'), dpr = devicePixelRatio || 1, w = cv.clientWidth || 600, h = 110;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(127,127,127,.15)'; g.fillRect(0, 0, w, h);
    if (selA < 0) { g.fillStyle = '#888'; g.font = '14px system-ui'; g.textAlign = 'center'; g.fillText('دوس على كلمة من فوق', w / 2, h / 2); return; }
    if (!drag) vw = view();
    const [v0, v1] = vw, x = t => (t - v0) / (v1 - v0) * w, dd = work.getChannelData(0), sr = work.sampleRate;
    g.fillStyle = 'rgba(31,111,92,.18)'; g.fillRect(x(A), 0, x(B) - x(A), h);
    for (let i = 0; i < w; i++) {
      const t0 = v0 + i / w * (v1 - v0), t1 = v0 + (i + 1) / w * (v1 - v0);
      let m = 0; for (let j = Math.floor(t0 * sr); j < Math.min(dd.length, t1 * sr); j += 4) m = Math.max(m, Math.abs(dd[j]));
      const v = Math.min(1, m * 1.6) * (h / 2 - 8);
      g.fillStyle = t0 >= A && t0 <= B ? '#1f6f5c' : '#999'; g.fillRect(i, h / 2 - v, 1, Math.max(1, v * 2));
    }
    g.font = '12px system-ui'; g.textAlign = 'center';
    for (const wd of words) if (wd.start > v0 && wd.start < v1) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x(wd.start), 0, 1, 10); }
    for (const t of [A, B]) { g.fillStyle = '#1f6f5c'; g.fillRect(x(t) - 1.5, 0, 3, h); }
    if (playing && actx) { const t = playing.t0 + (actx.currentTime - playing.at); if (t >= v0 && t <= v1 && playing.buf === work) { g.fillStyle = '#e33'; g.fillRect(x(t) - 1, 0, 2, h); } }
  };
  const ui = () => {
    q('ta').textContent = fmt(A); q('tb').textContent = fmt(B);
    const on = selA >= 0;
    for (const k of ['playCtx', 'playSel', 'gen']) q(k).disabled = !on;
    q('playNew').disabled = q('accept').disabled = take < 0;
    q('save').disabled = !changed;
    const p = providers.find(x => x.id === q('prov').value);
    q('gen').textContent = `🔁 ولّد الحتة دي بس${on && p ? ` (${q('say').value.length} حرف)` : ''}`;
    draw();
  };
  q('say').oninput = ui;
  const tOf = e => { const r = q('cv').getBoundingClientRect(); return vw[0] + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (vw[1] - vw[0]); };
  q('cv').onpointerdown = e => {
    if (selA < 0) return;
    const t = tOf(e), tol = (vw[1] - vw[0]) / q('cv').clientWidth * 10;
    if (Math.abs(t - A) < tol) drag = 'A'; else if (Math.abs(t - B) < tol) drag = 'B';
    else { play(t, Math.min(work.duration, t + 2), work); return; }
    q('cv').setPointerCapture(e.pointerId);
  };
  q('cv').onpointermove = e => { if (!drag) return; const t = tOf(e); if (drag === 'A') A = Math.min(t, B - 0.05); else B = Math.max(t, A + 0.05); takes = []; take = -1; renderTakes(); ui(); };
  q('cv').onpointerup = q('cv').onpointercancel = () => { if (drag) { drag = null; play(A, B, work); ui(); } };
  dlg.querySelectorAll('[data-n]').forEach(b => { b.onclick = () => { const [k, d] = b.dataset.n.split(','); if (k === 'A') A = Math.max(0, Math.min(B - 0.05, A + +d)); else B = Math.min(work.duration, Math.max(A + 0.05, B + +d)); takes = []; take = -1; renderTakes(); ui(); play(A, B, work); }; });

  // تشغيل
  const stop = () => { try { playing?.src.stop(); } catch {} playing = null; };
  const play = (t0, t1, buf) => {
    actx = actx || new AudioContext(); stop();
    const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
    src.start(0, Math.max(0, t0), Math.max(0.05, t1 - t0));
    playing = { src, t0, at: actx.currentTime, buf };
    src.onended = () => { if (playing?.src === src) playing = null; draw(); };
    const loop = () => { if (!playing) return; draw(); requestAnimationFrame(loop); }; loop();
  };
  q('playCtx').onclick = () => play(Math.max(0, A - 1.5), Math.min(work.duration, B + 1.2), work);
  q('playSel').onclick = () => play(A, B, work);

  // التوليد: الحتة بس، وكل نسخة بتتحفظ تختار منها
  const renderTakes = () => {
    q('takes').innerHTML = takes.map((t, i) => `<button class="btn${i === take ? ' on' : ''}" data-t="${i}" type="button">▶ نسخة ${i + 1} — ${t.prov}</button>`).join('');
    q('takes').querySelectorAll('[data-t]').forEach(b => { b.onclick = () => { take = +b.dataset.t; renderTakes(); ui(); playPatched(); }; });
  };
  const patched = () => takes[take] && splice(work, takes[take].buf, A, B);
  const playPatched = () => { const p = patched(); if (!p) return; const len = takes[take].buf.duration; play(Math.max(0, A - 1.5), Math.min(p.duration, A + len + 1.2), p); };
  q('gen').onclick = async () => {
    const p = providers.find(x => x.id === q('prov').value), say = q('say').value.trim();
    if (!p || !say) return;
    const btn = q('gen'); btn.disabled = true; status(`⏳ بيولّد «${say}» بـ ${p.name}…`);
    try {
      const blob = await p.speak(say);
      const raw = await decode(await blob.arrayBuffer());
      const buf = trimEdges(await conform(raw, work));
      takes.push({ buf, prov: p.name.split(' ')[0] }); take = takes.length - 1;
      renderTakes(); ui(); playPatched();
      status('اسمعها في الجملة. لو مش مظبوطة: عدّل التشكيل أو جرّب المولّد التاني ودوس «🔁» تاني — كل نسخة بتفضل هنا تختار منها.');
    } catch (e) { status('❌ ' + (e.message || e)); } finally { btn.disabled = false; ui(); }
  };
  q('playNew').onclick = playPatched;
  q('accept').onclick = () => {
    const p = patched(); if (!p) return;
    const len = takes[take].buf.duration, delta = len - (B - A);
    work = p; changed++;
    // الكلمات اللي بعد الحتة بتتزق بفرق الطول، والحتة نفسها بتاخد طولها الجديد
    words.forEach((w, i) => { if (i > selB) { w.start += delta; w.end += delta; } });
    const n = selB - selA + 1;
    for (let i = selA; i <= selB; i++) { words[i].start = A + (i - selA) * len / n; words[i].end = A + (i - selA + 1) * len / n; words[i].fixed = true; }
    B = A + len; takes = []; take = -1;
    renderWords(); renderTakes(); ui();
    status(`✅ اتصلّحت. تقدر تصلّح كلمة تانية، وفي الآخر دوس «💾 احفظ الصوت المصلّح في الكارت». (اتصلّح ${changed})`);
  };
  const close = () => { stop(); dlg.close(); dlg.remove(); };
  q('close').onclick = q('close2').onclick = () => { if (!changed || confirm('فيه تصليحات مش محفوظة — تقفل من غير حفظ؟')) close(); };
  q('save').onclick = async () => {
    q('save').disabled = true; status('⏳ بيحفظ…');
    try { await onApply(work, words.map(w => ({ text: w.text, start: w.start, end: w.end }))); close(); } catch (e) { status('❌ ' + (e.message || e)); q('save').disabled = false; }
  };
  dlg.addEventListener('cancel', e => { e.preventDefault(); q('close').onclick(); });
  renderWords(); ui();
  dlg.showModal();
  new ResizeObserver(draw).observe(q('cv'));
}
