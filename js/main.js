import * as Q from './quran.js';
import { RECITERS, findReciter, customReciter, ayahAudioUrls } from './reciters.js';
import { COLLECTIONS, collection, getHadith, searchHadith, extractMatn, assessGrade } from './hadith.js';
import { loadAudio, decode, buildTimeline, startRecording, trimSilence, bufferToWavBlob } from './audio.js';
import { ASPECTS, ensureFonts, drawBackground, drawOverlay, drawWave } from './slides.js';
import { exportAudio, exportVideo, exportFilmoraPackage, renderStill, makeSrt, download } from './exporter.js';
import { searchPexels, searchPixabay, downloadStock } from './stock.js';
import * as T from './templates.js';
import { getSettings, setSettings, load, save } from './storage.js';
import * as EL from './elevenlabs.js';
import * as SND from './sounds.js';
import * as WT from './words.js';
import { fetchFirst } from './net.js';
import { splitRange, chaptersText, chaptersWarnings } from './series.js';
import { PLATFORMS, generate, getPublishSettings, setPublishSettings, canShareFile, shareFile } from './publish.js';

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
  activeSeries: null, // { index, total, endSlide, endSeconds }
  series: { surah: 12, from: 1, to: 111, mode: 'duration', max: 58, count: 5, sizes: '5, 7, 6', basmala: true, end: true, endSec: 2.5, ...load('series', {}) },
  parts: [],
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
// series: { index, total, endSlide, endSeconds } لو المقطع جزء من سلسلة
async function buildSegments(withAudio, onProgress, blocks = state.blocks, series = state.activeSeries) {
  const st = state.style;
  const reciter = findReciter(st.reciter);
  const wordSync = st.wordMode && st.wordMode !== 'full';
  const segs = [];
  const jobs = [];

  for (const b of blocks) {
    if (b.type === 'quran') {
      const s = Q.surah(b.surah);
      const from = clamp(b.from, 1, s.count), to = clamp(Math.max(b.to, from), from, s.count);
      for (let r = 0; r < Math.max(1, b.repeatRange); r++) {
        if (b.basmala && b.surah !== 1 && b.surah !== 9) {
          segs.push({ kind: 'basmala', qs: 1, qa: 1, text: Q.BASMALA, sub: '', label: `سورة ${s.ar}`, footer: `بصوت القارئ ${reciter.name}`, audioUrls: ayahAudioUrls(reciter, 1, 1, 1) });
        }
        for (let a = from; a <= to; a++) {
          for (let k = 0; k < Math.max(1, b.repeatAyah); k++) {
            segs.push({
              kind: 'ayah', s: b.surah, a, qs: b.surah, qa: a,
              text: `${Q.ayahText(b.surah, a)}\u00A0${Q.arabicNum(a)}`,
              sub: '',
              label: `سورة ${s.ar} • الآية ${Q.arabicNum(a)}`,
              footer: `بصوت القارئ ${reciter.name}`,
              audioUrls: ayahAudioUrls(reciter, b.surah, a, Q.globalAyah(b.surah, a)),
            });
          }
        }
      }
    } else if (b.type === 'zikr') {
      const au = hadithAudio.get(b.id);
      const useAudio = b.audioMode !== 'none' && au?.buffer;
      const n = Number(b.count) || 1;
      segs.push({
        kind: 'zikr',
        text: b.text || '(اختار الذكر أو اكتب النص)',
        sub: '',
        label: b.cat || 'ذكر',
        footer: [b.showCount && n > 1 ? `يُقال ${Q.arabicNum(n)} ${n <= 10 ? 'مرات' : 'مرة'}` : '', b.ref].filter(Boolean).join(' • '),
        audio: useAudio ? au.buffer : null,
        silence: Number(b.seconds) || 8,
      });
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

  if (series) {
    const badge = `الجزء ${Q.arabicNum(series.index)} من ${Q.arabicNum(series.total)}`;
    for (const s of segs) s.badge = badge;
    if (series.endSlide) {
      const q = blocks.find(b => b.type === 'quran');
      const last = series.index === series.total;
      segs.push({
        kind: 'title',
        text: last ? 'تمّت السورة بحمد الله 🤍' : 'تابع الجزء التالي ⬅️',
        sub: '',
        label: q ? `سورة ${Q.surah(q.surah).ar}` : '',
        footer: last ? '' : `التالي: الجزء ${Q.arabicNum(series.index + 1)} من ${Q.arabicNum(series.total)}`,
        badge,
        silence: Number(series.endSeconds) || 2.5,
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
          // ظهور الكلمات مع التلاوة: لو القارئ له توقيت على Quran.com بنستخدم ملف الصوت بتاعهم عشان التوقيت يطابق
          let qc = null;
          if (wordSync && reciter.qurancom && s.qs) {
            try {
              qc = (await WT.quranComChapter(reciter.qurancom, s.qs)).get(s.qa) || null;
              if (qc) s.audio = await loadAudio([qc.url]);
            } catch { qc = null; }
          }
          if (!qc) s.audio = await loadAudio(s.audioUrls);
          // ملفات التلاوة فيها سكوت في أولها وآخرها؛ بنقصه عشان الآيات تبان متصلة
          if (st.trimSilence && s.kind !== 'title') s.audio = trimSilence(s.audio, { threshold: 0.008, pad: 0.06 });
          if (wordSync) {
            const n = WT.words(s.text).length;
            const exact = qc && WT.timesFromSegments(qc.segments, n, s.audio.trimStart || 0);
            s.wordTimes = exact || WT.approxTimes(s.text, s.audio.duration);
            s.wordExact = !!exact;
          }
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
    // الأحاديث (بصوت أو من غير): تقسيم تقريبي على مدتها
    if (wordSync) {
      for (const s of segs) {
        if ((s.kind !== 'hadith' && s.kind !== 'zikr') || s.wordTimes) continue;
        s.wordTimes = WT.approxTimes(s.text, s.audio ? s.audio.duration : (s.silence || 3));
      }
    }
  }
  return segs;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));

async function buildProject(blocks = state.blocks, series = state.activeSeries) {
  status('تحميل التلاوات…', 0);
  const segments = await buildSegments(true, p => status('تحميل التلاوات…', p), blocks, series);
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
    refreshPublish();
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
      const seg = player.segs[i];
      const shown = seg.wordTimes ? { ...seg, wordCount: WT.shownAt(seg.wordTimes, t - seg.start) } : seg;
      drawFrame(shown, analyser);
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
  const ser = state.activeSeries;
  if (b.type === 'quran' && ser) return `quran_${b.surah}_part${String(ser.index).padStart(2, '0')}_${b.from}-${b.to}_${state.style.reciter}`;
  if (b.type === 'quran') return `quran_${b.surah}_${b.from}-${b.to}_${state.style.reciter}`;
  if (b.type === 'zikr') return `zikr_${b.index + 1}`;
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
      setLastExport(blob, `${baseName()}_${state.segIndex + 1}.png`, 'image/png');
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
      // فيديو من غير صوت: الصوت هيتضاف من المنصة («استخدم هذا الصوت»)
      if ($('#silent').checked) {
        project.silent = true;
        const target = Number($('#silent-dur').value);
        if (target > 0) stretchProject(project, target);
      }
      const d = project.timeline.duration;
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
      setLastExport(blob, `${baseName()}.mp4`, 'video/mp4');
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

// بنمط توقيت المقاطع كله عشان الفيديو ياخد المدة المطلوبة (لما يكون من غير صوت)
function stretchProject(project, target) {
  const k = target / project.timeline.duration;
  for (const s of project.segments) {
    s.start *= k;
    s.end *= k;
    if (s.wordTimes) s.wordTimes = s.wordTimes.map(t => t * k);
  }
  project.timeline.duration = target;
}

const segInfo = (i, n) => `${i + 1} من ${n}`;
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ===== واجهة المحتوى (الكتل) =====
const blocksEl = $('#blocks');

function surahOptions(sel) {
  sel.innerHTML = Q.surahs().map(s => `<option value="${s.n}">${s.n}. ${s.ar} — ${s.tr} (${s.count})</option>`).join('');
}

// أي تغيير في ترتيب أو عدد الكتل بيلغي «الجزء الحالي من السلسلة»
function renderBlocks(keepSeries = false) {
  if (!keepSeries && state.activeSeries) { state.activeSeries = null; markParts(); }
  blocksEl.innerHTML = '';
  state.blocks.forEach((b, i) => blocksEl.appendChild(b.type === 'quran' ? quranBlockEl(b, i) : b.type === 'zikr' ? zikrBlockEl(b, i) : hadithBlockEl(b, i)));
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
  wireAudioControls(li, b, sync);
  sync();
  return li;
}

// أزرار الصوت المشتركة (حديث أو ذكر): من غير صوت / تسجيل / ملف / ElevenLabs
function wireAudioControls(li, b, sync) {
  const f = name => li.querySelector(`[data-f=${name}]`);
  const el = name => li.querySelector(`[data-el=${name}]`);
  const act = name => li.querySelector(`[data-act=${name}]`);
  li.querySelectorAll('[data-f=audioMode]').forEach(r => r.onchange = () => { b.audioMode = r.value; persist(); });

  // التسجيل بشاشة قراءة
  act('record').onclick = async () => {
    const res = await openPrompter(b.text || '');
    if (!res) return;
    setHadithAudio(b, res.buffer, 'تسجيل', res.blob);
    b.audioMode = 'record';
    li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'record'; });
    sync(); persist();
  };
  // قراءة بصوتك عن طريق ElevenLabs
  act('ai').onclick = async () => {
    if (!EL.isConfigured()) {
      alert('حط مفتاح ElevenLabs ورقم صوتك الأول من ⚙️ الإعدادات ← ElevenLabs.');
      return;
    }
    const text = EL.prepareText(b.text || '');
    if (text.length < 3) { alert('اكتب النص الأول.'); return; }
    if (!confirm(`هيتبعت ${text.length} حرف لـ ElevenLabs، وده هيتخصم من رصيدك هناك (تقريبًا حرف = كريديت).\n\nبعد التوليد لازم تسمع الصوت كله وتتأكد من النطق والتشكيل.\nتكمل؟`)) return;
    const btn = act('ai');
    btn.disabled = true; btn.textContent = '⏳ بيولّد…';
    try {
      const blob = await EL.speak(text);
      const buffer = await decode(await blob.arrayBuffer());
      setHadithAudio(b, trimSilence(buffer), 'ElevenLabs', blob);
      b.audioMode = 'ai';
      li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'ai'; });
      sync(); persist(); refreshPublish(true);
      el('audio-preview').hidden = false;
      el('audio-preview').play().catch(() => {});
      status('✅ الصوت اتولّد. اسمعه كله وراجع النطق والتشكيل قبل التصدير. ولو فيه غلط، عدّل النص وولّد تاني.');
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false; btn.textContent = '🤖 ولّد بصوتي';
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

// ===== الأذكار والأدعية (حصن المسلم) =====
let AZKAR = null;
async function loadAzkar() {
  try { AZKAR = await (await fetch('data/azkar.json')).json(); } catch { AZKAR = { categories: [] }; }
}

function newZikrBlock(cat = 'أذكار الصباح', index = 0) {
  const b = { id: uid(), type: 'zikr', cat, index, text: '', count: 1, ref: '', desc: '', showCount: true, audioMode: 'none', seconds: 8 };
  fillZikr(b);
  return b;
}

function fillZikr(b) {
  const c = AZKAR?.categories.find(x => x.name === b.cat);
  const it = c?.items[b.index];
  if (!it) return;
  b.text = it.t;
  b.count = it.n;
  b.ref = it.r;
  b.desc = it.d;
  b.seconds = estimateSeconds(it.t);
}

function zikrBlockEl(b, i) {
  const li = $('#tpl-zikr').content.firstElementChild.cloneNode(true);
  blockCommon(li, b, i);
  const f = name => li.querySelector(`[data-f=${name}]`);
  const el = name => li.querySelector(`[data-el=${name}]`);
  const cats = AZKAR?.categories || [];
  f('cat').innerHTML = cats.map(c => `<option>${escapeHtml(c.name)}</option>`).join('');
  f('cat').value = b.cat;
  const fillItems = () => {
    const c = cats.find(x => x.name === b.cat);
    f('item').innerHTML = (c?.items || []).map((it, k) => {
      const first = it.t.replace(/\s+/g, ' ').slice(0, 45);
      return `<option value="${k}">${k + 1}. ${escapeHtml(first)}${it.t.length > 45 ? '…' : ''}${it.n > 1 ? ` (×${it.n})` : ''}</option>`;
    }).join('');
    f('item').value = b.index;
  };
  const sync = () => {
    li.querySelector('.block-title').textContent = b.cat;
    el('meta').textContent = [b.ref && `📖 ${b.ref}`, b.count > 1 && `🔁 ${b.count} مرات`, b.desc && `💡 ${b.desc}`].filter(Boolean).join('  •  ');
    const au = hadithAudio.get(b.id);
    el('audio-name').textContent = au ? `${au.name} (${au.buffer.duration.toFixed(1)} ث)` : '';
    el('audio-preview').hidden = !au?.url;
    if (au?.url && el('audio-preview').src !== au.url) el('audio-preview').src = au.url;
  };
  fillItems();
  f('text').value = b.text;
  f('showCount').checked = b.showCount;
  f('seconds').value = b.seconds;
  li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.name = 'am-' + b.id; r.checked = r.value === b.audioMode; });
  f('cat').onchange = () => { b.cat = f('cat').value; b.index = 0; fillZikr(b); fillItems(); f('text').value = b.text; f('seconds').value = b.seconds; sync(); persist(); refreshPreview(); };
  f('item').onchange = () => { b.index = Number(f('item').value); fillZikr(b); f('text').value = b.text; f('seconds').value = b.seconds; sync(); persist(); refreshPreview(); };
  f('text').oninput = () => { b.text = f('text').value; persist(); refreshPreview(); };
  f('showCount').onchange = () => { b.showCount = f('showCount').checked; persist(); refreshPreview(); };
  f('seconds').oninput = () => { b.seconds = clamp(f('seconds').value, 2, 120); persist(); };
  wireAudioControls(li, b, sync);
  sync();
  return li;
}

// قوايم جاهزة من القرآن بصوت القارئ اللي مختاره
const PRESETS = {
  // الآيات اللي في أذكار الصباح والمساء: آية الكرسي، والمعوذات ٣ مرات
  morning: [[2, 255, 255, 1], [112, 1, 4, 3], [113, 1, 5, 3], [114, 1, 6, 3]],
  // آيات الرقية الشرعية المشهورة
  ruqyah: [
    [1, 1, 7], [2, 1, 5], [2, 255, 257], [2, 285, 286], [3, 18, 19], [7, 117, 122], [10, 79, 82],
    [20, 65, 69], [23, 115, 118], [37, 1, 10], [46, 29, 32], [55, 33, 36], [59, 21, 24],
    [72, 1, 9], [112, 1, 4], [113, 1, 5], [114, 1, 6],
  ],
};

function applyPreset(name) {
  const list = PRESETS[name];
  if (!list) return;
  if (state.blocks.length && !confirm('هيتم استبدال المحتوى الحالي بالقايمة الجاهزة. تكمل؟')) return;
  state.blocks = list.map(([s, from, to, rep]) => {
    const b = newQuranBlock(s, from, to);
    b.repeatRange = rep || 1;
    b.basmala = from === 1 && s !== 1 && s !== 9;
    return b;
  });
  renderBlocks();
  refreshPublish(true);
  const total = list.reduce((n, [, a, z, r]) => n + (z - a + 1) * (r || 1), 0);
  status(`✅ اتضاف ${list.length} مقطع (${total} آية). الرقية والسور الطويلة هتطلع أطول من ٣ دقايق — الأنسب لها «حزمة Filmora» أو تصدير صوت MP3.`);
}

// ===== شاشة القراءة والتسجيل =====
// بترجع { buffer, blob } لو المستخدم اختار التسجيل، أو null لو قفل
function openPrompter(text) {
  const dlg = $('#dlg-prompter');
  const el = id => $('#pr-' + id);
  el('text').textContent = text || '(اكتب نص الحديث الأول أو اضغط «جلب الحديث»)';
  el('size').value = load('prompterSize', 38);
  el('text').style.fontSize = el('size').value + 'px';
  el('size').oninput = () => { el('text').style.fontSize = el('size').value + 'px'; save('prompterSize', Number(el('size').value)); };

  let rec = null, result = null, timer = null, cancelled = false;
  const setStatus = (msg, cls = '') => { el('status').textContent = msg; el('status').className = 'pr-status ' + cls; };
  const show = (...ids) => { for (const id of ['start', 'stop', 'redo', 'use']) el(id).hidden = !ids.includes(id); };
  const reset = () => {
    result = null;
    el('audio').hidden = true;
    el('audio').removeAttribute('src');
    setStatus('جاهز. اضغط «ابدأ التسجيل» واقرا النص بهدوء.');
    show('start');
  };
  reset();

  const start = async () => {
    cancelled = false;
    show();
    for (const n of ['٣', '٢', '١']) {
      setStatus(n, 'count');
      await new Promise(r => setTimeout(r, 800));
      if (cancelled) return;
    }
    try {
      rec = await startRecording();
    } catch (e) {
      setStatus('مقدرتش أفتح الميكروفون: ' + e.message + ' — اسمح للموقع باستخدام الميكروفون من شريط العنوان.', 'rec');
      show('start');
      return;
    }
    const t0 = Date.now();
    const tick = () => setStatus(`● بيسجّل… ${((Date.now() - t0) / 1000).toFixed(0)} ث`, 'rec');
    tick();
    timer = setInterval(tick, 500);
    el('text').scrollTop = 0;
    show('stop');
  };

  const stopRec = async () => {
    clearInterval(timer);
    if (!rec) return;
    setStatus('بيجهز التسجيل…');
    let { buffer } = await rec.stop();
    rec = null;
    if (el('trim').checked) buffer = trimSilence(buffer);
    const blob = bufferToWavBlob(buffer);
    result = { buffer, blob };
    el('audio').src = URL.createObjectURL(blob);
    el('audio').hidden = false;
    setStatus(`تم ✔ (${buffer.duration.toFixed(1)} ث). اسمع التسجيل، ولو تمام اضغط «استخدم».`);
    show('redo', 'use');
  };

  return new Promise(resolve => {
    const finish = val => {
      cancelled = true;
      clearInterval(timer);
      if (rec) { rec.stop().catch(() => {}); rec = null; }
      el('audio').pause();
      dlg.close();
      resolve(val);
    };
    el('start').onclick = start;
    el('stop').onclick = stopRec;
    el('redo').onclick = () => { reset(); start(); };
    el('use').onclick = () => finish(result);
    el('close').onclick = () => finish(null);
    dlg.oncancel = e => { e.preventDefault(); finish(null); };
    dlg.showModal();
  });
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
const STYLE_INPUTS = ['aspect', 'bgType', 'color1', 'color2', 'dim', 'textSize', 'labelScale', 'textColor', 'accent', 'subColor', 'gap', 'trimSilence', 'wordMode', 'showLabel', 'showFooter', 'showTranslation', 'waveform', 'translation'];

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
  $('#silent').onchange = () => { $('#silent-dur-wrap').hidden = !$('#silent').checked; };

  $('#bg-file').onchange = () => {
    const file = $('#bg-file').files[0];
    if (file) setMedia(file);
  };

  $('#ambient-file').onchange = async () => {
    const file = $('#ambient-file').files[0];
    if (!file) return;
    try {
      setAmbient(file.name, await decode(await file.arrayBuffer()));
    } catch {
      showError(new Error('الملف ده مش ملف صوت مدعوم'));
    }
  };
  $('#ambient-vol').oninput = () => { state.ambientVolume = Number($('#ambient-vol').value); };
  setupSoundSearch();
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

function setAmbient(name, buffer) {
  state.ambient = { name, buffer };
  $('#ambient-name').textContent = `${name} (${fmtDur(buffer.duration)})`;
}

// ===== أصوات الخلفية: Freesound + Pixabay =====
function setupSoundSearch() {
  const box = $('#snd-results');
  let preview = null;
  const stopPreview = () => { if (preview) { preview.pause(); preview = null; } };
  $('#snd-presets').innerHTML = SND.PRESETS.map(([ar, en]) => `<button type="button" class="chip" data-q="${en}">${ar}</button>`).join('');
  const syncPixabay = q => { $('#snd-pixabay').href = q ? SND.pixabayUrl(q) : 'https://pixabay.com/sound-effects/'; };
  const go = async q => {
    q = (q ?? $('#snd-q').value).trim();
    if (!q) return;
    $('#snd-q').value = q;
    syncPixabay(q);
    stopPreview();
    box.innerHTML = '<li class="muted">جاري البحث…</li>';
    try {
      const res = await SND.searchFreesound(q, { cc0Only: $('#snd-cc0').checked });
      box.innerHTML = res.length ? '' : '<li class="muted">مفيش نتايج — جرّب كلمة تانية أو شيل فلتر CC0.</li>';
      for (const r of res) {
        const li = document.createElement('li');
        li.className = 'snd-item';
        li.innerHTML = `<button class="btn icon" type="button" data-a="play" title="اسمع">▶</button>
          <span class="snd-name"></span><span class="muted snd-meta"></span>
          <button class="btn" type="button" data-a="use">استخدم</button>`;
        li.querySelector('.snd-name').textContent = r.name;
        li.querySelector('.snd-meta').textContent = `${fmtDur(r.duration)} • ${SND.licenseLabel(r.license)} • ${r.author}`;
        const play = li.querySelector('[data-a=play]');
        play.onclick = () => {
          const same = preview && preview.dataset.id === String(r.id);
          stopPreview();
          box.querySelectorAll('[data-a=play]').forEach(b => { b.textContent = '▶'; });
          if (same) return;
          preview = new Audio(r.preview);
          preview.dataset.id = r.id;
          preview.volume = 0.6;
          preview.play().catch(() => {});
          preview.onended = () => { play.textContent = '▶'; };
          play.textContent = '⏸';
        };
        li.querySelector('[data-a=use]').onclick = async e => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = '…';
          try {
            const buf = await decode(await fetchFirst([r.preview]));
            setAmbient(r.name, buf);
            if (!/publicdomain\/zero|Creative Commons 0/i.test(r.license)) {
              alert(`الصوت ده رخصته ${SND.licenseLabel(r.license)}.\nاكتب في وصف الفيديو: «صوت الخلفية: ${r.name} — ${r.author} (freesound.org)».`);
            }
            status(`✅ صوت الخلفية: ${r.name}`);
            btn.textContent = '✓';
          } catch (err) {
            showError(new Error('تعذر تحميل الصوت: ' + err.message));
            btn.textContent = 'استخدم';
          } finally {
            btn.disabled = false;
          }
        };
        box.appendChild(li);
      }
    } catch (e) {
      box.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = e.message;
      box.appendChild(li);
    }
  };
  $('#snd-presets').onclick = e => { const c = e.target.closest('.chip'); if (c) go(c.dataset.q); };
  $('#snd-go').onclick = () => go();
  $('#snd-q').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#snd-q').oninput = () => syncPixabay($('#snd-q').value);
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
    $('#set-freesound').value = s.freesoundKey;
    $('#set-eleven-key').value = s.elevenKey;
    $('#set-eleven-voice').value = s.elevenVoiceId;
    $('#set-eleven-model').innerHTML = EL.MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    $('#set-eleven-model').value = s.elevenModel;
    $('#set-eleven-voices').hidden = true;
    dlg.showModal();
  };
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    setSettings({
      pexelsKey: $('#set-pexels').value.trim(),
      pixabayKey: $('#set-pixabay').value.trim(),
      proxyUrl: $('#set-proxy').value.trim(),
      freesoundKey: $('#set-freesound').value.trim(),
      elevenKey: $('#set-eleven-key').value.trim(),
      elevenVoiceId: $('#set-eleven-voice').value.trim(),
      elevenModel: $('#set-eleven-model').value,
    });
  });
  // جلب الأصوات من حساب ElevenLabs (بالمفتاح المكتوب حاليًا في الخانة)
  $('#set-eleven-load').onclick = async () => {
    const btn = $('#set-eleven-load');
    const prev = getSettings();
    setSettings({ elevenKey: $('#set-eleven-key').value.trim() });
    btn.disabled = true; btn.textContent = '…';
    try {
      const voices = await EL.listVoices();
      const sel = $('#set-eleven-voices');
      sel.innerHTML = '<option value="">— اختار صوتك —</option>' + voices
        .sort((a, b) => (b.category === 'cloned') - (a.category === 'cloned'))
        .map(v => `<option value="${v.id}">${v.category === 'cloned' ? '🎙️ ' : ''}${escapeHtml(v.name)}</option>`).join('');
      sel.hidden = false;
      sel.onchange = () => { if (sel.value) $('#set-eleven-voice').value = sel.value; };
    } catch (e) {
      alert(e.message);
    } finally {
      setSettings({ elevenKey: prev.elevenKey });
      btn.disabled = false; btn.textContent = 'جيب أصواتي';
    }
  };
}

// ===== النشر (العنوان والوصف والمشاركة) =====
const PLATFORM_URLS = {
  youtube: 'https://www.youtube.com/upload',
  shorts: 'https://www.youtube.com/upload',
  tiktok: 'https://www.tiktok.com/upload',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
};
const pub = { platform: load('pubPlatform', 'shorts'), data: null, edited: false, lastFile: null };

function setLastExport(blob, name, type) {
  pub.lastFile = new File([blob], name, { type });
  const btn = $('#pub-share');
  const ok = canShareFile(pub.lastFile);
  btn.disabled = !ok;
  btn.title = ok ? `مشاركة ${name}` : 'المتصفح ده مش بيدعم مشاركة الملفات — ارفع الملف من فولدر التنزيلات';
  $('#pub-share-hint').textContent = ok
    ? `جاهز للمشاركة: ${name}. انسخ الوصف الأول، وبعدين اضغط «مشاركة» واختار التطبيق.`
    : `اتحفظ ${name} في التنزيلات. المشاركة المباشرة بتشتغل من الموبايل؛ على الكمبيوتر افتح المنصة وارفع الملف.`;
}

async function refreshPublish(force = false) {
  if (pub.edited && !force) return;
  try {
    pub.data = await generate(state.blocks, state.style, Q.translation, state.activeSeries);
    pub.edited = false;
    renderPublish();
  } catch (e) {
    console.error(e);
  }
}

function renderPublish() {
  document.querySelectorAll('#pub-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.p === pub.platform)));
  const p = PLATFORMS[pub.platform];
  const d = pub.data?.[pub.platform] || {};
  const limits = { title: p.titleMax, caption: p.captionMax, tags: p.tagsMax };
  for (const f of ['title', 'caption', 'tags']) {
    const wrap = document.querySelector(`[data-pf=${f}]`);
    const has = f === 'caption' || !!p[f];
    wrap.hidden = !has;
    if (!has) continue;
    const el = wrap.querySelector('[data-pv]');
    if (document.activeElement !== el) el.value = d[f] || '';
    updateCount(f, limits[f]);
  }
  $('#pub-open').href = PLATFORM_URLS[pub.platform];
  $('#pub-open').textContent = `↗ افتح ${p.name}`;
}

function updateCount(f, max) {
  const wrap = document.querySelector(`[data-pf=${f}]`);
  const len = [...wrap.querySelector('[data-pv]').value].length;
  const c = wrap.querySelector('.count');
  c.textContent = `${len} / ${max}`;
  c.classList.toggle('over', len > max);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = '✅'; setTimeout(() => { btn.textContent = o; }, 1200); }
}

function setupPublish() {
  $('#pub-tabs').innerHTML = Object.entries(PLATFORMS)
    .map(([id, p]) => `<button type="button" class="tab" role="tab" data-p="${id}">${p.name}</button>`).join('');
  $('#pub-tabs').onclick = e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    pub.platform = t.dataset.p;
    save('pubPlatform', pub.platform);
    renderPublish();
  };
  for (const f of ['title', 'caption', 'tags']) {
    const el = document.querySelector(`[data-pv=${f}]`);
    el.oninput = () => {
      pub.data[pub.platform][f] = el.value;
      pub.edited = true;
      const p = PLATFORMS[pub.platform];
      updateCount(f, { title: p.titleMax, caption: p.captionMax, tags: p.tagsMax }[f]);
    };
  }
  document.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => copyText(document.querySelector(`[data-pv=${b.dataset.copy}]`).value, b);
  });
  $('#pub-copy-all').onclick = () => {
    const p = PLATFORMS[pub.platform];
    const d = pub.data[pub.platform];
    const parts = [p.title && d.title, d.caption, p.tags && d.tags && `Tags: ${d.tags}`].filter(Boolean);
    copyText(parts.join('\n\n'), $('#pub-copy-all'));
  };
  $('#pub-regen').onclick = () => refreshPublish(true);
  $('#pub-share').onclick = async () => {
    if (!pub.lastFile) return;
    const d = pub.data?.[pub.platform] || {};
    await copyText([d.title, d.caption].filter(Boolean).join('\n\n'));
    try {
      await shareFile(pub.lastFile, d.caption);
    } catch (e) {
      if (e.name !== 'AbortError') showError(new Error('المشاركة مش متاحة: ' + e.message));
    }
  };

  const ps = getPublishSettings();
  $('#pub-signature').value = ps.signature;
  $('#pub-hashtags').value = ps.extraHashtags;
  for (const k of ['includeText', 'includeTranslation', 'includeCredits']) $('#pub-' + k).checked = ps[k];
  const saveSettings = () => {
    setPublishSettings({
      signature: $('#pub-signature').value,
      extraHashtags: $('#pub-hashtags').value,
      includeText: $('#pub-includeText').checked,
      includeTranslation: $('#pub-includeTranslation').checked,
      includeCredits: $('#pub-includeCredits').checked,
    });
    refreshPublish(true);
  };
  ['#pub-signature', '#pub-hashtags'].forEach(id => { $(id).onchange = saveSettings; });
  ['includeText', 'includeTranslation', 'includeCredits'].forEach(k => { $('#pub-' + k).onchange = saveSettings; });
  refreshPublish(true);
}

// ===== وضع السلسلة =====
const partsWord = n => (n >= 3 && n <= 10 ? `${n} أجزاء` : n === 2 ? 'جزأين' : `${n} جزء`);
const SER_INPUTS = { surah: 'ser-surah', from: 'ser-from', to: 'ser-to', mode: 'ser-mode', max: 'ser-max', count: 'ser-count', sizes: 'ser-sizes', basmala: 'ser-basmala', end: 'ser-end', endSec: 'ser-endsec' };

function seriesMeta(i) {
  const ser = state.series;
  return { index: i + 1, total: state.parts.length, endSlide: ser.end, endSeconds: ser.endSec };
}

function partBlock(i) {
  const ser = state.series, p = state.parts[i];
  const b = newQuranBlock(ser.surah, p.from, p.to);
  b.basmala = i === 0 && ser.basmala && p.from === 1;
  return b;
}

// مدة كل آية بالثواني (بيحمّل التلاوات، وبتتحفظ في الكاش)
async function ayahDurations(surah, from, to) {
  const reciter = findReciter(state.style.reciter);
  const out = {};
  const list = [];
  for (let a = from; a <= to; a++) list.push(a);
  let done = 0;
  const worker = async () => {
    while (list.length) {
      const a = list.shift();
      const buf = await loadAudio(ayahAudioUrls(reciter, surah, a, Q.globalAyah(surah, a)));
      out[a] = (state.style.trimSilence ? trimSilence(buf, { threshold: 0.008, pad: 0.06 }) : buf).duration;
      status('قياس مدة الآيات…', ++done / (to - from + 1));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  let basmala = 0;
  try { basmala = (await loadAudio(ayahAudioUrls(reciter, 1, 1, 1))).duration; } catch { /* اختياري */ }
  return { durations: out, basmala };
}

async function doSplit() {
  const ser = state.series;
  const s = Q.surah(ser.surah);
  ser.from = clamp(ser.from, 1, s.count);
  ser.to = clamp(Math.max(ser.to, ser.from), ser.from, s.count);
  const gap = Number(state.style.gap) || 0;
  const overhead = 0.3 + 0.8 - gap + (ser.end ? Number(ser.endSec) + gap : 0);
  let durations = null, basmalaSec = 0;
  setBusy(true);
  try {
    try {
      const d = await ayahDurations(ser.surah, ser.from, ser.to);
      durations = d.durations;
      if (ser.basmala && ser.from === 1 && ser.surah !== 1 && ser.surah !== 9) basmalaSec = d.basmala + gap;
    } catch (e) {
      if (ser.mode === 'duration') throw new Error('التقسيم بالمدة محتاج يحمّل التلاوات، والتحميل فشل. جرّب «عدد آيات ثابت»، أو اضبط رابط الوسيط.');
    }
    state.parts = splitRange({ from: ser.from, to: ser.to, mode: ser.mode, count: ser.count, sizes: ser.sizes, maxSec: Number(ser.max) || 58, durations, gap, overhead, basmalaSec });
    status(`✅ اتقسمت لـ ${partsWord(state.parts.length)}`);
    renderParts();
  } catch (e) {
    showError(e);
  } finally {
    setBusy(false);
  }
}

function renderParts() {
  const ol = $('#ser-parts');
  ol.innerHTML = '';
  const total = state.parts.length;
  const short = state.style.aspect === '9:16';
  state.parts.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'part';
    li.dataset.i = i;
    const range = p.from === p.to ? `الآية ${Q.arabicNum(p.from)}` : `الآيات ${Q.arabicNum(p.from)}–${Q.arabicNum(p.to)}`;
    li.innerHTML = `<span class="pname"></span><span class="pinfo"></span><span class="pdur"></span>
      <button class="btn icon" type="button" data-a="open" title="افتح في المحرر والمعاينة">👁</button>
      <button class="btn icon" type="button" data-a="mp4" title="صدّر الجزء ده فيديو">🎬</button>
      <button class="btn icon" type="button" data-a="mp3" title="صدّر الجزء ده MP3">🎵</button>`;
    li.querySelector('.pname').textContent = `الجزء ${Q.arabicNum(i + 1)} من ${Q.arabicNum(total)}`;
    li.querySelector('.pinfo').textContent = range;
    const dur = li.querySelector('.pdur');
    if (p.duration != null) {
      dur.textContent = fmtDur(p.duration);
      if (short && p.duration > SHORTS_SAFE_SECONDS) { dur.classList.add('over'); dur.title = 'أطول من دقيقة'; }
    }
    li.querySelector('[data-a=open]').onclick = () => loadPart(i);
    li.querySelector('[data-a=mp4]').onclick = () => { loadPart(i); doExport('mp4'); };
    li.querySelector('[data-a=mp3]').onclick = () => { loadPart(i); doExport('mp3'); };
    ol.appendChild(li);
  });
  $('#ser-actions').hidden = !total;
  $('#ser-hint').hidden = !total;
  markParts();
}

function markParts(doneSet) {
  document.querySelectorAll('#ser-parts .part').forEach(li => {
    const i = Number(li.dataset.i);
    li.classList.toggle('active', state.activeSeries?.index === i + 1);
    if (doneSet?.has(i)) li.classList.add('done');
  });
}

function loadPart(i) {
  stop();
  state.blocks = [partBlock(i)];
  renderBlocks(true);
  state.activeSeries = seriesMeta(i);
  state.segIndex = 0;
  markParts();
  refreshPreview();
  refreshPublish(true);
}

async function exportAllParts() {
  if (state.busy || !state.parts.length) return;
  const n = state.parts.length;
  const long = state.parts.filter(p => p.duration != null && p.duration > SHORTS_SAFE_SECONDS).length;
  if (state.style.aspect === '9:16' && long && !confirm(`${long} جزء أطول من دقيقة. لو التلاوة عليها مطالبة حقوق، الشورتس دي هتتحجب على يوتيوب.\n\nتكمل؟`)) return;
  if (!confirm(`هيتصدّر ${partsWord(n)} (فيديو لكل جزء) ورا بعض. سيب الصفحة مفتوحة لحد ما يخلصوا.\nتبدأ؟`)) return;
  stop();
  setBusy(true);
  const done = new Set();
  const onLoad = p => status('تحميل محرك التحويل (مرة واحدة بس)…', p);
  try {
    for (let i = 0; i < n; i++) {
      loadPart(i);
      const project = await buildProject();
      let stage = '';
      const blob = await exportVideo(project, p => status(`الجزء ${i + 1} من ${n}: ${stage}`, p), onLoad, s => { stage = s; status(`الجزء ${i + 1} من ${n}: ${s}`, 0); });
      download(blob, `${baseName()}.mp4`);
      setLastExport(blob, `${baseName()}.mp4`, 'video/mp4');
      done.add(i);
      markParts(done);
    }
    status(`✅ اتصدّر ${partsWord(n)}. بيتجهز ملف الأوصاف والفصول…`);
    setBusy(false);
    await seriesInfo();
  } catch (e) {
    showError(e);
  } finally {
    setBusy(false);
  }
}

// ملف نصي فيه عنوان ووصف كل جزء + فصول الفيديو الطويل
async function seriesInfo() {
  if (!state.parts.length) return;
  const ser = state.series;
  const name = `سورة ${Q.surah(ser.surah).ar}`;
  const platform = pub.platform;
  const n = state.parts.length;
  let txt = `${name} — سلسلة من ${partsWord(n)}\nالمنصة: ${PLATFORMS[platform].name}\n\n`;
  try {
    for (let i = 0; i < n; i++) {
      const d = (await generate([partBlock(i)], state.style, Q.translation, seriesMeta(i)))[platform];
      txt += `==================== الجزء ${i + 1} ====================\n`;
      if (d.title) txt += `العنوان:\n${d.title}\n\n`;
      txt += `الوصف:\n${d.caption}\n\n`;
      if (d.tags) txt += `Tags:\n${d.tags}\n\n`;
    }

    // الفصول: بنبني النطاق كله كفيديو واحد ونقيس بداية كل جزء
    status('حساب توقيت الفصول…');
    const full = newQuranBlock(ser.surah, state.parts[0].from, state.parts[n - 1].to);
    full.basmala = ser.basmala;
    const segs = await buildSegments(true, p => status('حساب توقيت الفصول…', p), [full], null);
    const tl = buildTimeline(segs, { gap: Number(state.style.gap) || 0 });
    const starts = state.parts.map(p => (segs.find(sg => sg.kind === 'ayah' && sg.a === p.from) || segs[0]).start);
    starts[0] = 0;
    txt += `==================== فصول الفيديو الطويل (Chapters) ====================\n`;
    txt += `انسخ السطور دي في وصف فيديو السورة كاملة على يوتيوب:\n\n`;
    txt += chaptersText(state.parts, starts, name, Q.arabicNum) + '\n';
    const warn = chaptersWarnings(starts, tl.duration);
    if (warn.length) txt += `\n⚠️ ${warn.join('\n⚠️ ')}\n`;
    txt += `\nمدة الفيديو الطويل: ${fmtDur(tl.duration)} — صدّره من زرار «حمّل النطاق كله في المحرر»؛ ولو أطول من ٣ دقايق استخدم «حزمة Filmora».\n`;
    status('✅ ملف الأوصاف والفصول جاهز');
  } catch (e) {
    txt += `\n(تعذر حساب الفصول: ${e.message})\n`;
    showError(e);
  }
  download(new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' }), `quran_${ser.surah}_series_info.txt`);
}

function setupSeries() {
  surahOptions($('#ser-surah'));
  const ser = state.series;
  const apply = () => {
    for (const [k, id] of Object.entries(SER_INPUTS)) {
      const el = $('#' + id);
      if (el.type === 'checkbox') el.checked = !!ser[k]; else el.value = ser[k];
    }
    document.querySelectorAll('.ser-when').forEach(el => { el.hidden = el.dataset.mode !== ser.mode; });
    $('#ser-basmala').disabled = ser.surah === 1 || ser.surah === 9;
  };
  apply();
  for (const [k, id] of Object.entries(SER_INPUTS)) {
    const el = $('#' + id);
    el.addEventListener('change', () => {
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      if (k === 'surah') { v = Number(v); ser.from = 1; ser.to = Q.surah(v).count; }
      ser[k] = v;
      save('series', ser);
      apply();
    });
  }
  // التفعيل اختياري: لما يتقفل، البرنامج بيرجع يشتغل عادي من غير «الجزء ٣ من ١٢» ولا شاشة النهاية
  const setEnabled = on => {
    ser.enabled = on;
    save('series', ser);
    $('#ser-enabled').checked = on;
    $('#ser-body').hidden = !on;
    if (!on && state.activeSeries) {
      state.activeSeries = null;
      markParts();
      refreshPreview();
      refreshPublish(true);
    }
  };
  setEnabled(!!ser.enabled);
  $('#ser-enabled').onchange = () => setEnabled($('#ser-enabled').checked);
  $('#ser-split').onclick = doSplit;
  $('#ser-full').onclick = () => {
    const b = newQuranBlock(ser.surah, ser.from, ser.to);
    b.basmala = ser.basmala && ser.from === 1;
    state.blocks = [b];
    renderBlocks();
    refreshPublish(true);
    status(`اتحمّل ${Q.surah(ser.surah).ar} (${ser.from}–${ser.to}) في المحرر. للفيديو الطويل اختار مقاس 16:9.`);
  };
  $('#ser-export-all').onclick = exportAllParts;
  $('#ser-info').onclick = async () => {
    if (state.busy) return;
    setBusy(true);
    try { await seriesInfo(); } finally { setBusy(false); }
  };
}

// ===== البداية =====
async function init() {
  status('تحميل نص المصحف…');
  await Promise.all([Q.loadQuran(), ensureFonts(), loadAzkar()]);
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
  $('#add-zikr').onclick = () => { state.blocks.push(newZikrBlock()); renderBlocks(); };
  document.querySelectorAll('[data-preset]').forEach(btn => { btn.onclick = () => applyPreset(btn.dataset.preset); });
  $('#btn-play').onclick = play;
  $('#btn-stop').onclick = stop;
  $('#seg-slider').oninput = () => {
    if (player) return;
    state.segIndex = Number($('#seg-slider').value);
    $('#seg-info').textContent = segInfo(state.segIndex, previewSegs.length);
    drawFrame(previewSegs[state.segIndex]);
  };
  document.querySelectorAll('[data-export]').forEach(b => { b.onclick = () => doExport(b.dataset.export); });
  setupPublish();
  setupSeries();
  idleLoop();
}

init().catch(showError);

// للاختبار من الكونسول
window.__qcs = { state, buildProject };
