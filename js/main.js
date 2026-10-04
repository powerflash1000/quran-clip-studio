import * as Q from './quran.js';
import { RECITERS, findReciter, customReciter, ayahAudioUrls } from './reciters.js';
import { COLLECTIONS, collection, getHadith, searchHadith, extractMatn, assessGrade } from './hadith.js';
import { loadAudio, decode, buildTimeline, startRecording } from './audio.js';
import { ASPECTS, ensureFonts, drawBackground, drawOverlay, drawWave } from './slides.js';
import { exportAudio, exportVideo, exportFilmoraPackage, renderStill, makeSrt, download } from './exporter.js';
import { searchPexels, searchPixabay, downloadStock } from './stock.js';
import * as T from './templates.js';
import { getSettings, setSettings, load, save } from './storage.js';

const $ = s => document.querySelector(s);
const MAX_VIDEO_SECONDS = 180;
// يوتيوب بيحجب الشورتس الأطول من دقيقة لو عليها مطالبة Content ID
const SHORTS_SAFE_SECONDS = 60;

// ===== الحالة =====
const state = {
  style: T.lastStyle(),
  blocks: load('blocks', null) || [newQuranBlock(1, 1, 7)],
  media: null,        // { kind, file, el, url }
  ambient: null,      // { name, buffer }
  ambientVolume: 0.15,
  favorites: load('favorites', []),
  showAll: false,
  segIndex: 0,
  busy: false,
};

function uid() { return Math.random().toString(36).slice(2, 9); }
function newQuranBlock(surah = 1, from = 1, to = 1) {
  return { id: uid(), type: 'quran', surah, from, to, repeatAyah: 1, repeatRange: 1, basmala: false };
}
function newHadithBlock() {
  return { id: uid(), type: 'hadith', col: 'bukhari', number: 1, text: '', fullText: '', english: '', grades: [], fetched: false, showEnglish: false, audioMode: 'none', seconds: 8 };
}

// الصوت المسجّل/المرفوع للأحاديث مش بيتحفظ في localStorage
const hadithAudio = new Map(); // blockId -> { buffer, name, url }

function persist() {
  save('blocks', state.blocks.map(b => b.type === 'hadith' ? { ...b } : b));
  T.rememberStyle(state.style);
}

// ===== شريط الحالة =====
const statusEl = $('#status'), statusText = $('#status-text'), barFill = $('#bar-fill');
function status(msg, p = null, isError = false) {
  statusEl.hidden = !msg;
  statusEl.classList.toggle('error', isError);
  statusText.textContent = msg || '';
  barFill.style.width = p == null ? '0' : `${Math.round(p * 100)}%`;
  barFill.parentElement.hidden = p == null;
}

// ===== بناء المقاطع =====
// withAudio=false: نص بس (للمعاينة السريعة من غير تحميل)
async function buildSegments(withAudio, onProgress) {
  const st = state.style;
  const reciter = findReciter(st.reciter);
  const segs = [];
  const jobs = [];

  for (const b of state.blocks) {
    if (b.type === 'quran') {
      const s = Q.surah(b.surah);
      const from = clamp(b.from, 1, s.count), to = clamp(Math.max(b.to, from), from, s.count);
      for (let r = 0; r < Math.max(1, b.repeatRange); r++) {
        if (b.basmala && b.surah !== 1 && b.surah !== 9) {
          segs.push({ kind: 'basmala', text: Q.BASMALA, sub: '', label: `سورة ${s.ar}`, footer: `بصوت القارئ ${reciter.name}`, audioUrls: ayahAudioUrls(reciter, 1, 1, 1) });
        }
        for (let a = from; a <= to; a++) {
          for (let k = 0; k < Math.max(1, b.repeatAyah); k++) {
            segs.push({
              kind: 'ayah', s: b.surah, a,
              text: `${Q.ayahText(b.surah, a)}\u00A0${Q.arabicNum(a)}`,
              sub: '',
              label: `سورة ${s.ar} • الآية ${Q.arabicNum(a)}`,
              footer: `بصوت القارئ ${reciter.name}`,
              audioUrls: ayahAudioUrls(reciter, b.surah, a, Q.globalAyah(b.surah, a)),
            });
          }
        }
      }
    } else {
      const col = collection(b.col);
      const g = assessGrade(b.col, b.grades);
      const au = hadithAudio.get(b.id);
      const useAudio = b.audioMode !== 'none' && au?.buffer;
      segs.push({
        kind: 'hadith',
        text: b.text || '(اكتب نص الحديث أو اضغط «جلب الحديث»)',
        sub: b.showEnglish ? b.english : '',
        label: `${col.name} • ${Q.arabicNum(b.number)}`,
        footer: `${col.cite} • ${g.label}`,
        audio: useAudio ? au.buffer : null,
        silence: Number(b.seconds) || 8,
        hadithBlock: b,
      });
    }
  }

  // الترجمة
  if (st.showTranslation && st.translation) {
    await Promise.all(segs.filter(s => s.kind === 'ayah').map(async s => {
      try { s.sub = await Q.translation(st.translation, s.s, s.a); } catch { s.sub = ''; }
    }));
  }

  if (withAudio) {
    const need = segs.filter(s => s.audioUrls);
    let done = 0;
    const queue = [...need];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try {
          s.audio = await loadAudio(s.audioUrls);
        } catch (e) {
          const err = new Error(`تعذر تحميل تلاوة ${s.label}.\nجرّب قارئ تاني، أو اضبط «رابط الوسيط» من الإعدادات.`);
          err.cause = e;
          throw err;
        }
        done++;
        onProgress?.(done / need.length);
      }
    };
    for (let i = 0; i < 6; i++) jobs.push(worker());
    await Promise.all(jobs);
  }
  return segs;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));

async function buildProject() {
  status('تحميل التلاوات…', 0);
  const segments = await buildSegments(true, p => status('تحميل التلاوات…', p));
  if (!segments.length) throw new Error('ضيف آيات أو حديث الأول');
  const timeline = buildTimeline(segments, {
    gap: Number(state.style.gap) || 0,
    ambient: state.ambient?.buffer,
    ambientVolume: state.ambient ? state.ambientVolume : 0,
  });
  const { w, h } = ASPECTS[state.style.aspect];
  return { segments, timeline, style: state.style, media: state.style.bgType === 'media' ? state.media : null, W: w, H: h, quality: $('#quality').value };
}

// ===== المعاينة =====
const canvas = $('#preview');
const ctx = canvas.getContext('2d');
let previewSegs = [];
let player = null; // { ctx, src, analyser, segs, startAt, raf }

function sizeCanvas() {
  const { w, h } = ASPECTS[state.style.aspect];
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function bgMedia() {
  return state.style.bgType === 'media' ? state.media : null;
}

function drawFrame(seg, analyser) {
  sizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, W, H, state.style, bgMedia());
  drawOverlay(ctx, W, H, seg, state.style);
  if (analyser && state.style.waveform) drawWave(ctx, W, H, analyser, state.style.accent);
}

let refreshTimer = null;
function refreshPreview() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (player) return;
    try {
      previewSegs = await buildSegments(false);
    } catch { previewSegs = []; }
    const slider = $('#seg-slider');
    slider.max = Math.max(0, previewSegs.length - 1);
    state.segIndex = Math.min(state.segIndex, previewSegs.length - 1);
    slider.value = Math.max(0, state.segIndex);
    $('#seg-info').textContent = previewSegs.length ? segInfo(state.segIndex, previewSegs.length) : '';
    drawFrame(previewSegs[state.segIndex]);
  }, 120);
}

// الفيديو كخلفية بيتحرك في المعاينة
function idleLoop() {
  if (!player && bgMedia()?.kind === 'video') drawFrame(previewSegs[state.segIndex]);
  requestAnimationFrame(idleLoop);
}

async function play() {
  if (state.busy) return;
  stop();
  try {
    setBusy(true);
    const project = await buildProject();
    status('');
    const ac = new AudioContext({ sampleRate: 44100 });
    const buf = ac.createBuffer(2, project.timeline.left.length, 44100);
    buf.copyToChannel(project.timeline.left, 0);
    buf.copyToChannel(project.timeline.right, 1);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser).connect(ac.destination);
    const startAt = ac.currentTime + 0.05;
    src.start(startAt);
    if (bgMedia()?.kind === 'video') { bgMedia().el.currentTime = 0; bgMedia().el.play().catch(() => {}); }
    player = { ac, src, analyser, segs: project.segments, startAt };
    src.onended = () => stop();
    $('#btn-stop').disabled = false;
    const tick = () => {
      if (!player) return;
      const t = ac.currentTime - startAt;
      let i = 0;
      for (let k = 0; k < player.segs.length; k++) if (player.segs[k].start <= t + 0.05) i = k;
      if (i !== state.segIndex) {
        state.segIndex = i;
        $('#seg-slider').value = i;
        $('#seg-info').textContent = segInfo(i, player.segs.length);
      }
      drawFrame(player.segs[i], analyser);
      player.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    showError(e);
  } finally {
    setBusy(false);
  }
}

function stop() {
  if (!player) return;
  cancelAnimationFrame(player.raf);
  try { player.src.stop(); } catch { /* اتوقف */ }
  player.ac.close();
  player = null;
  $('#btn-stop').disabled = true;
  refreshPreview();
}

function setBusy(b) {
  state.busy = b;
  document.querySelectorAll('[data-export], #btn-play').forEach(el => { el.disabled = b; });
}

function showError(e) {
  console.error(e);
  status(e.message || String(e), null, true);
}

// ===== التصدير =====
function baseName() {
  const b = state.blocks[0];
  if (!b) return 'clip';
  if (b.type === 'quran') return `quran_${b.surah}_${b.from}-${b.to}_${state.style.reciter}`;
  return `hadith_${b.col}_${b.number}`;
}

// تحذير الأحاديث الضعيفة أو غير المعروفة درجتها قبل أي تصدير
function confirmGrades() {
  const bad = [], unknown = [];
  for (const b of state.blocks) {
    if (b.type !== 'hadith') continue;
    const g = assessGrade(b.col, b.grades);
    const name = `${collection(b.col).name} ${b.number}`;
    if (g.level === 'bad') bad.push(`${name}: ${g.label}\n  ${g.details.join('\n  ')}`);
    else if (g.level === 'unknown') unknown.push(name);
  }
  if (bad.length && !confirm(`⚠️ تنبيه: الأحاديث دي فيها تضعيف:\n\n${bad.join('\n\n')}\n\nنشر حديث ضعيف على إنه صحيح غلط شائع. تكمل التصدير برضه؟`)) return false;
  if (unknown.length && !confirm(`درجة الأحاديث دي مش متاحة في المصدر:\n${unknown.join('\n')}\n\nاتأكد من صحتها قبل النشر. تكمل؟`)) return false;
  return true;
}

async function doExport(kind) {
  if (state.busy) return;
  if (!confirmGrades()) return;
  stop();
  setBusy(true);
  const onLoad = p => status('تحميل محرك التحويل (مرة واحدة بس)…', p);
  try {
    if (kind === 'png') {
      const segs = await buildSegments(false);
      const { w, h } = ASPECTS[state.style.aspect];
      const blob = await renderStill(w, h, segs[state.segIndex], state.style, bgMedia());
      download(blob, `${baseName()}_${state.segIndex + 1}.png`);
      status('✅ الصورة اتحفظت');
      return;
    }
    const project = await buildProject();
    const d = project.timeline.duration;

    if (kind === 'srt') {
      download(new Blob(['﻿' + makeSrt(project.segments, 'text')], { type: 'application/x-subrip' }), `${baseName()}.srt`);
      if (project.segments.some(s => s.sub)) {
        download(new Blob(['﻿' + makeSrt(project.segments, 'sub')], { type: 'application/x-subrip' }), `${baseName()}_translation.srt`);
      }
      status('✅ ملفات الترجمة اتحفظت');
    } else if (['mp3', 'm4a', 'wav'].includes(kind)) {
      status(`تحويل الصوت إلى ${kind.toUpperCase()}…`, 0);
      const blob = await exportAudio(kind, project.timeline, p => status(`تحويل الصوت إلى ${kind.toUpperCase()}…`, p), onLoad);
      download(blob, `${baseName()}.${kind}`);
      status(`✅ ${kind.toUpperCase()} جاهز (${fmtDur(d)})`);
    } else if (kind === 'mp4') {
      if (d > MAX_VIDEO_SECONDS && !confirm(`مدة الفيديو ${fmtDur(d)}، وده أطول من ٣ دقايق.\nالتحويل في المتصفح هياخد وقت طويل وممكن الصفحة تقف.\n\nالأفضل تستخدم «حزمة Filmora». تكمل برضه؟`)) {
        status('');
        return;
      }
      if (state.style.aspect === '9:16' && d > SHORTS_SAFE_SECONDS && !confirm(`مدة الفيديو ${fmtDur(d)}، يعني أطول من دقيقة.\n\nعلى يوتيوب شورتس: لو التلاوة عليها مطالبة حقوق (Content ID)، الشورت اللي أطول من دقيقة بيتحجب.\nلو مش متأكد من القارئ، خلّي المقطع أقل من ٦٠ ثانية، أو افحصه وهو «خاص» الأول.\n\nتكمل التصدير؟`)) {
        status('');
        return;
      }
      let stage = '';
      const blob = await exportVideo(project, p => status(stage, p), onLoad, s => { stage = s; status(s, 0); });
      download(blob, `${baseName()}.mp4`);
      status(`✅ الفيديو جاهز (${fmtDur(d)})`);
    } else if (kind === 'filmora') {
      status('تجهيز حزمة Filmora…', null);
      const zip = await exportFilmoraPackage(project);
      download(zip, `${baseName()}_filmora.zip`);
      status('✅ حزمة Filmora جاهزة — افتح ملف «اقرأني.txt» جواها');
    }
  } catch (e) {
    showError(e);
  } finally {
    setBusy(false);
  }
}

const segInfo = (i, n) => `${i + 1} من ${n}`;
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ===== واجهة المحتوى (الكتل) =====
const blocksEl = $('#blocks');

function surahOptions(sel) {
  sel.innerHTML = Q.surahs().map(s => `<option value="${s.n}">${s.n}. ${s.ar} — ${s.tr} (${s.count})</option>`).join('');
}

function renderBlocks() {
  blocksEl.innerHTML = '';
  state.blocks.forEach((b, i) => blocksEl.appendChild(b.type === 'quran' ? quranBlockEl(b, i) : hadithBlockEl(b, i)));
  persist();
  refreshPreview();
}

function blockCommon(li, b, i) {
  li.querySelector('[data-act=up]').disabled = i === 0;
  li.querySelector('[data-act=down]').disabled = i === state.blocks.length - 1;
  li.querySelector('[data-act=up]').onclick = () => move(i, -1);
  li.querySelector('[data-act=down]').onclick = () => move(i, 1);
  li.querySelector('[data-act=remove]').onclick = () => {
    state.blocks.splice(i, 1);
    hadithAudio.delete(b.id);
    renderBlocks();
  };
}

function move(i, d) {
  const j = i + d;
  [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]];
  renderBlocks();
}

function quranBlockEl(b, i) {
  const li = $('#tpl-quran').content.firstElementChild.cloneNode(true);
  blockCommon(li, b, i);
  const f = name => li.querySelector(`[data-f=${name}]`);
  surahOptions(f('surah'));
  const title = li.querySelector('.block-title');
  const sync = () => {
    const s = Q.surah(b.surah);
    f('from').max = f('to').max = s.count;
    title.textContent = `${s.ar}: ${Q.arabicNum(b.from)}${b.to > b.from ? ' – ' + Q.arabicNum(b.to) : ''}`;
    f('basmala').disabled = b.surah === 1 || b.surah === 9;
    f('basmala').parentElement.title = b.surah === 1 ? 'البسملة هي أول آية في الفاتحة' : b.surah === 9 ? 'سورة التوبة من غير بسملة' : '';
  };
  f('surah').value = b.surah;
  f('from').value = b.from;
  f('to').value = b.to;
  f('repeatAyah').value = b.repeatAyah;
  f('repeatRange').value = b.repeatRange;
  f('basmala').checked = b.basmala;
  f('surah').onchange = () => {
    b.surah = Number(f('surah').value);
    b.from = 1; b.to = Math.min(Q.surah(b.surah).count, 3);
    f('from').value = b.from; f('to').value = b.to;
    sync(); persist(); refreshPreview();
  };
  const num = (name, after) => {
    f(name).oninput = () => {
      const s = Q.surah(b.surah);
      b[name] = clamp(f(name).value, 1, name.startsWith('repeat') ? 20 : s.count);
      after?.();
      sync(); persist(); refreshPreview();
    };
    f(name).onchange = () => { f(name).value = b[name]; };
  };
  num('from', () => { if (b.to < b.from) { b.to = b.from; f('to').value = b.to; } });
  num('to', () => { if (b.to < b.from) { b.from = b.to; f('from').value = b.from; } });
  num('repeatAyah');
  num('repeatRange');
  f('basmala').onchange = () => { b.basmala = f('basmala').checked; persist(); refreshPreview(); };
  sync();
  return li;
}

function hadithBlockEl(b, i) {
  const li = $('#tpl-hadith').content.firstElementChild.cloneNode(true);
  blockCommon(li, b, i);
  const f = name => li.querySelector(`[data-f=${name}]`);
  const el = name => li.querySelector(`[data-el=${name}]`);
  const act = name => li.querySelector(`[data-act=${name}]`);

  f('col').innerHTML = COLLECTIONS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  f('col').value = b.col;
  f('number').value = b.number;
  f('text').value = b.text;
  f('showEnglish').checked = b.showEnglish;
  f('seconds').value = b.seconds;
  li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.name = 'am-' + b.id; r.checked = r.value === b.audioMode; });

  const title = li.querySelector('.block-title');
  const gradeEl = li.querySelector('.grade');
  const sync = () => {
    title.textContent = `${collection(b.col).name} ${Q.arabicNum(b.number)}`;
    if (b.fetched) {
      const g = assessGrade(b.col, b.grades);
      gradeEl.textContent = g.label;
      gradeEl.className = 'grade ' + g.level;
      el('grade-details').textContent = g.details.length ? 'الدرجة: ' + g.details.join(' · ') : '';
    } else {
      gradeEl.textContent = ''; gradeEl.className = 'grade';
      el('grade-details').textContent = '';
    }
    const au = hadithAudio.get(b.id);
    el('audio-name').textContent = au ? `${au.name} (${au.buffer.duration.toFixed(1)} ث)` : '';
    el('audio-preview').hidden = !au?.url;
    if (au?.url && el('audio-preview').src !== au.url) el('audio-preview').src = au.url;
  };

  const loadOne = async () => {
    status('جلب الحديث…');
    try {
      const h = await getHadith(b.col, b.number, true);
      b.fullText = h.text;
      b.text = extractMatn(h.text);
      b.english = h.english;
      b.grades = h.grades;
      b.fetched = true;
      b.seconds = estimateSeconds(b.text);
      f('text').value = b.text;
      f('seconds').value = b.seconds;
      status('');
    } catch (e) {
      showError(new Error('تعذر جلب الحديث: ' + e.message));
    }
    sync(); persist(); refreshPreview();
  };

  f('col').onchange = () => { b.col = f('col').value; b.fetched = false; b.grades = []; sync(); persist(); };
  f('number').oninput = () => { b.number = clamp(f('number').value, 1, 99999); b.fetched = false; b.grades = []; sync(); persist(); };
  act('fetch').onclick = loadOne;
  f('number').onkeydown = e => { if (e.key === 'Enter') loadOne(); };

  const doSearch = async () => {
    const q = f('q').value.trim();
    if (q.length < 2) return;
    const box = el('results');
    box.hidden = false;
    box.textContent = 'جاري البحث… (أول مرة بيحمّل الكتاب كله)';
    try {
      const res = await searchHadith(b.col, q);
      box.innerHTML = res.length ? '' : '<div class="result">مفيش نتايج</div>';
      for (const r of res) {
        const d = document.createElement('div');
        d.className = 'result hadith-r';
        d.innerHTML = `<div class="ref"></div><div class="txt"></div>`;
        d.querySelector('.ref').textContent = `${collection(b.col).name} ${r.number}`;
        d.querySelector('.txt').textContent = r.text.length > 220 ? r.text.slice(0, 220) + '…' : r.text;
        d.onclick = () => { b.number = r.number; f('number').value = r.number; box.hidden = true; loadOne(); };
        box.appendChild(d);
      }
    } catch (e) {
      box.textContent = 'تعذر البحث: ' + e.message;
    }
  };
  act('search').onclick = doSearch;
  f('q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };

  f('text').oninput = () => { b.text = f('text').value; persist(); refreshPreview(); };
  act('matn').onclick = () => { if (b.fullText) { b.text = extractMatn(b.fullText); f('text').value = b.text; persist(); refreshPreview(); } };
  act('full').onclick = () => { if (b.fullText) { b.text = b.fullText; f('text').value = b.text; persist(); refreshPreview(); } };
  f('showEnglish').onchange = () => { b.showEnglish = f('showEnglish').checked; persist(); refreshPreview(); };
  f('seconds').oninput = () => { b.seconds = clamp(f('seconds').value, 2, 120); persist(); };
  li.querySelectorAll('[data-f=audioMode]').forEach(r => r.onchange = () => { b.audioMode = r.value; persist(); });

  // التسجيل
  let rec = null;
  act('record').onclick = async () => {
    if (!rec) {
      try {
        rec = await startRecording();
        act('record').textContent = '⏹ إيقاف التسجيل';
        act('record').classList.add('active');
      } catch (e) {
        showError(new Error('مقدرتش أفتح الميكروفون: ' + e.message));
      }
    } else {
      const { blob, buffer } = await rec.stop();
      rec = null;
      act('record').textContent = '⏺ ابدأ التسجيل';
      act('record').classList.remove('active');
      setHadithAudio(b, buffer, 'تسجيل', blob);
      b.audioMode = 'record';
      li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'record'; });
      sync(); persist();
    }
  };
  f('audioFile').onchange = async () => {
    const file = f('audioFile').files[0];
    if (!file) return;
    try {
      const buffer = await decode(await file.arrayBuffer());
      setHadithAudio(b, buffer, file.name, file);
      b.audioMode = 'upload';
      li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'upload'; });
      sync(); persist();
    } catch (e) {
      showError(new Error('الملف ده مش ملف صوت مدعوم'));
    }
  };

  sync();
  return li;
}

function setHadithAudio(b, buffer, name, blob) {
  const old = hadithAudio.get(b.id);
  if (old?.url) URL.revokeObjectURL(old.url);
  hadithAudio.set(b.id, { buffer, name, url: URL.createObjectURL(blob) });
}

function estimateSeconds(text) {
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  return Math.round(Math.min(30, Math.max(5, words * 0.45 + 2)) * 2) / 2;
}

// ===== البحث في القرآن =====
function setupAyahSearch() {
  const input = $('#ayah-search'), box = $('#ayah-results');
  let t = null;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const res = Q.search(input.value, 40);
      if (!input.value.trim()) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = res.length ? '' : '<div class="result">مفيش نتايج</div>';
      for (const r of res) {
        const d = document.createElement('div');
        d.className = 'result';
        d.innerHTML = `<div class="ref"></div><div class="txt"></div>`;
        d.querySelector('.ref').textContent = `سورة ${Q.surah(r.s).ar} • الآية ${Q.arabicNum(r.a)} — اضغط للإضافة`;
        d.querySelector('.txt').textContent = Q.ayahText(r.s, r.a);
        d.onclick = () => {
          state.blocks.push(newQuranBlock(r.s, r.a, r.a));
          box.hidden = true;
          input.value = '';
          renderBlocks();
        };
        box.appendChild(d);
      }
    }, 250);
  };
}

// ===== القراء =====
function renderReciters() {
  const sel = $('#reciter');
  const st = state.style;
  const favs = state.favorites;
  const list = state.showAll ? RECITERS : RECITERS.filter(r => r.featured || favs.includes(r.id) || r.id === st.reciter);
  const sorted = [...list].sort((a, b) => (favs.includes(b.id) - favs.includes(a.id)));
  let html = sorted.map(r => `<option value="${r.id}">${favs.includes(r.id) ? '★ ' : ''}${r.name}</option>`).join('');
  if (st.reciter.startsWith('custom:')) html = `<option value="${st.reciter}">${findReciter(st.reciter).name}</option>` + html;
  sel.innerHTML = html;
  sel.value = st.reciter;
  $('#fav').textContent = favs.includes(st.reciter) ? '★' : '☆';
  $('#fav').classList.toggle('active', favs.includes(st.reciter));
}

function setupReciters() {
  renderReciters();
  $('#reciter').onchange = () => { state.style.reciter = $('#reciter').value; renderReciters(); persist(); refreshPreview(); };
  $('#show-all-reciters').onchange = () => { state.showAll = $('#show-all-reciters').checked; renderReciters(); };
  $('#fav').onclick = () => {
    const id = state.style.reciter;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
    save('favorites', state.favorites);
    renderReciters();
  };
  $('#use-custom').onclick = () => {
    const folder = $('#custom-folder').value.trim().replace(/^\/+|\/+$/g, '');
    if (!folder) return;
    state.style.reciter = customReciter(folder).id;
    renderReciters(); persist(); refreshPreview();
  };
  let sample = null;
  $('#test-reciter').onclick = async () => {
    if (sample) { sample.pause(); sample = null; return; }
    const r = findReciter(state.style.reciter);
    const b = state.blocks.find(x => x.type === 'quran') || newQuranBlock(1, 1, 1);
    const urls = ayahAudioUrls(r, b.surah, b.from, Q.globalAyah(b.surah, b.from));
    sample = new Audio(urls[0]);
    sample.onended = () => { sample = null; };
    sample.play().catch(() => {
      showError(new Error('العينة مش شغالة للقارئ ده. ممكن الفولدر غلط أو الموقع واقف.'));
      sample = null;
    });
  };
}

// ===== الشكل =====
const STYLE_INPUTS = ['aspect', 'bgType', 'color1', 'color2', 'dim', 'textSize', 'labelScale', 'textColor', 'accent', 'subColor', 'gap', 'showLabel', 'showFooter', 'showTranslation', 'waveform', 'translation'];

function applyStyleToInputs() {
  const st = state.style;
  for (const k of STYLE_INPUTS) {
    const el = $('#' + k);
    if (el.type === 'checkbox') el.checked = !!st[k];
    else el.value = st[k];
  }
  $('#quality').value = st.quality || '1080';
  updateBgVisibility();
  renderReciters();
}

function updateBgVisibility() {
  const t = state.style.bgType;
  document.querySelectorAll('.when-gradient').forEach(e => { e.hidden = t !== 'gradient'; });
  document.querySelectorAll('.when-color').forEach(e => { e.hidden = t === 'media'; });
  document.querySelectorAll('.when-media').forEach(e => { e.hidden = t !== 'media'; });
}

function setupStyle() {
  $('#aspect').innerHTML = Object.entries(ASPECTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('#translation').innerHTML = Q.TRANSLATIONS.map(t => `<option value="${t.code}">${t.name}</option>`).join('');
  applyStyleToInputs();
  for (const k of STYLE_INPUTS) {
    const el = $('#' + k);
    el.addEventListener('input', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
      state.style[k] = v;
      if (k === 'bgType') updateBgVisibility();
      persist();
      refreshPreview();
    });
  }
  $('#quality').onchange = () => { state.style.quality = $('#quality').value; persist(); };

  $('#bg-file').onchange = () => {
    const file = $('#bg-file').files[0];
    if (file) setMedia(file);
  };

  $('#ambient-file').onchange = async () => {
    const file = $('#ambient-file').files[0];
    if (!file) return;
    try {
      state.ambient = { name: file.name, buffer: await decode(await file.arrayBuffer()) };
      $('#ambient-name').textContent = file.name;
    } catch {
      showError(new Error('الملف ده مش ملف صوت مدعوم'));
    }
  };
  $('#ambient-vol').oninput = () => { state.ambientVolume = Number($('#ambient-vol').value); };
}

function setMedia(file) {
  if (state.media?.url) URL.revokeObjectURL(state.media.url);
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');
  const el = isVideo ? document.createElement('video') : new Image();
  if (isVideo) {
    el.muted = true; el.loop = true; el.playsInline = true;
    el.onloadeddata = () => { el.play().catch(() => {}); refreshPreview(); };
  } else {
    el.onload = () => refreshPreview();
  }
  el.src = url;
  state.media = { kind: isVideo ? 'video' : 'image', file, el, url };
  state.style.bgType = 'media';
  $('#bgType').value = 'media';
  updateBgVisibility();
  $('#bg-name').textContent = `${isVideo ? '🎞️' : '🖼️'} ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;
  persist();
}

// ===== الخلفيات المجانية =====
function setupStock() {
  const dlg = $('#dlg-stock');
  $('#open-stock').onclick = () => dlg.showModal();
  $('#stock-close').onclick = () => dlg.close();
  const go = async () => {
    const box = $('#stock-results');
    box.textContent = 'جاري البحث…';
    try {
      const fn = $('#stock-provider').value === 'pexels' ? searchPexels : searchPixabay;
      const items = await fn($('#stock-q').value.trim() || 'nature', $('#stock-kind').value, state.style.aspect);
      box.innerHTML = items.length ? '' : 'مفيش نتايج';
      for (const it of items) {
        const d = document.createElement('div');
        d.className = 'stock-item';
        d.innerHTML = `<img alt="" loading="lazy"><span class="tag"></span>`;
        d.querySelector('img').src = it.thumb;
        d.querySelector('.tag').textContent = `${it.kind === 'video' ? '🎞️' : '🖼️'} ${it.credit || ''}`;
        d.onclick = async () => {
          d.style.opacity = .5;
          try {
            setMedia(await downloadStock(it));
            dlg.close();
          } catch (e) {
            alert('تعذر تحميل الملف: ' + e.message);
          }
          d.style.opacity = 1;
        };
        box.appendChild(d);
      }
    } catch (e) {
      box.textContent = e.message;
    }
  };
  $('#stock-go').onclick = go;
  $('#stock-q').onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ===== القوالب =====
function renderTemplates() {
  const all = T.listTemplates();
  $('#templates').innerHTML = Object.keys(all).map(n => `<option>${escapeHtml(n)}</option>`).join('');
}
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setupTemplates() {
  renderTemplates();
  $('#tpl-apply').onclick = () => {
    const tpl = T.listTemplates()[$('#templates').value];
    if (!tpl) return;
    state.style = { ...T.DEFAULT_STYLE, ...tpl, bgType: tpl.bgType === 'media' && !state.media ? 'gradient' : tpl.bgType };
    applyStyleToInputs();
    persist();
    refreshPreview();
  };
  $('#tpl-save').onclick = () => {
    const name = $('#tpl-name').value.trim();
    if (!name) { $('#tpl-name').focus(); return; }
    if (T.isBuiltin(name)) { alert('الاسم ده محجوز لقالب جاهز، اختار اسم تاني'); return; }
    T.saveTemplate(name, { ...state.style });
    renderTemplates();
    $('#templates').value = name;
    $('#tpl-name').value = '';
  };
  $('#tpl-delete').onclick = () => {
    const name = $('#templates').value;
    if (T.isBuiltin(name)) { alert('القوالب الجاهزة مينفعش تتحذف'); return; }
    if (confirm(`حذف القالب «${name}»؟`)) { T.deleteTemplate(name); renderTemplates(); }
  };
  $('#tpl-export').onclick = () => download(new Blob([T.exportTemplates()], { type: 'application/json' }), 'quran-clip-studio-templates.json');
  $('#tpl-import').onchange = async () => {
    const file = $('#tpl-import').files[0];
    if (!file) return;
    try {
      const n = T.importTemplates(await file.text());
      renderTemplates();
      alert(`اتضاف ${n} قالب`);
    } catch {
      alert('الملف ده مش ملف قوالب صحيح');
    }
  };
}

// ===== الإعدادات =====
function setupSettings() {
  const dlg = $('#dlg-settings');
  $('#btn-settings').onclick = () => {
    const s = getSettings();
    $('#set-pexels').value = s.pexelsKey;
    $('#set-pixabay').value = s.pixabayKey;
    $('#set-proxy').value = s.proxyUrl;
    dlg.showModal();
  };
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    setSettings({
      pexelsKey: $('#set-pexels').value.trim(),
      pixabayKey: $('#set-pixabay').value.trim(),
      proxyUrl: $('#set-proxy').value.trim(),
    });
  });
}

// ===== البداية =====
async function init() {
  status('تحميل نص المصحف…');
  await Promise.all([Q.loadQuran(), ensureFonts()]);
  status('');
  setupStyle();
  setupReciters();
  setupAyahSearch();
  setupStock();
  setupTemplates();
  setupSettings();
  renderBlocks();

  $('#add-quran').onclick = () => { state.blocks.push(newQuranBlock(1, 1, 1)); renderBlocks(); };
  $('#add-hadith').onclick = () => { state.blocks.push(newHadithBlock()); renderBlocks(); };
  $('#btn-play').onclick = play;
  $('#btn-stop').onclick = stop;
  $('#seg-slider').oninput = () => {
    if (player) return;
    state.segIndex = Number($('#seg-slider').value);
    $('#seg-info').textContent = segInfo(state.segIndex, previewSegs.length);
    drawFrame(previewSegs[state.segIndex]);
  };
  document.querySelectorAll('[data-export]').forEach(b => { b.onclick = () => doExport(b.dataset.export); });
  idleLoop();
}

init().catch(showError);

// للاختبار من الكونسول
window.__qcs = { state, buildProject };
