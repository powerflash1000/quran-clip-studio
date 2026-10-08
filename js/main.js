import * as Q from './quran.js';
import { RECITERS, findReciter, customReciter, ayahAudioUrls } from './reciters.js';
import { COLLECTIONS, collection, getHadith, searchHadith, extractMatn, assessGrade } from './hadith.js';
import { loadAudio, decode, buildTimeline, startRecording, trimSilence, bufferToWavBlob, sliceBuffer, enhanceVoice, ENHANCE_PRESETS } from './audio.js';
import { ASPECTS, ensureFonts, drawBackground, drawOverlay, drawWave } from './slides.js';
import { exportAudio, exportVideo, exportFilmoraPackage, renderStill, makeSrt, download } from './exporter.js';
import { PROVIDERS, downloadStock } from './stock.js';
import * as T from './templates.js';
import { getSettings, setSettings, load, save } from './storage.js';
import * as EL from './elevenlabs.js';
import * as SND from './sounds.js';
import * as WT from './words.js';
import { fetchFirst } from './net.js';
import { splitRange, chaptersText, chaptersWarnings } from './series.js';
import { parseRefs, embedFor } from './automation.js';
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
  return { id: uid(), type: 'hadith', col: 'bukhari', number: 1, text: '', fullText: '', english: '', grades: [], fetched: false, showEnglish: false, audioMode: 'none', seconds: 8, enhance: 'clean' };
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
      // تلاوة مرفوعة من ملف (قارئ مش في القايمة): بنقسم المقطع على الآيات
      const rec = b.rec && hadithAudio.get(b.id);
      const recName = rec ? (b.rec.name || 'قارئ') : reciter.name;
      const withBasmala = b.basmala && b.surah !== 1 && b.surah !== 9;
      const pieces = rec && withAudio ? recPieces(b, rec.buffer, from, to, withBasmala) : null;
      const footer = `بصوت القارئ ${recName}`;
      for (let r = 0; r < Math.max(1, b.repeatRange); r++) {
        let u = 0;
        if (withBasmala) {
          segs.push(rec
            ? { kind: 'basmala', text: Q.BASMALA, sub: '', label: `سورة ${s.ar}`, footer, audio: pieces?.[0] || null, silence: 3, custom: true, noGap: true }
            : { kind: 'basmala', qs: 1, qa: 1, text: Q.BASMALA, sub: '', label: `سورة ${s.ar}`, footer, audioUrls: ayahAudioUrls(reciter, 1, 1, 1) });
          u++;
        }
        for (let a = from; a <= to; a++, u++) {
          for (let k = 0; k < Math.max(1, b.repeatAyah); k++) {
            const seg = {
              kind: 'ayah', s: b.surah, a, qs: b.surah, qa: a,
              text: `${Q.ayahText(b.surah, a)}\u00A0${Q.arabicNum(a)}`,
              sub: '',
              label: `سورة ${s.ar} • الآية ${Q.arabicNum(a)}`,
              footer,
            };
            if (rec) Object.assign(seg, { audio: pieces?.[u] || null, silence: 4, custom: true, noGap: a < to || k < b.repeatAyah - 1 });
            else seg.audioUrls = ayahAudioUrls(reciter, b.surah, a, Q.globalAyah(b.surah, a));
            segs.push(seg);
          }
        }
      }
    } else if (b.type === 'zikr') {
      const au = hadithAudio.get(b.id);
      const useAudio = b.audioMode !== 'none' && au?.buffer;
      const n = Number(b.count) || 1;
      const zAudio = useAudio ? await enhanceVoice(au.buffer, b.enhance) : null;
      segs.push({
        kind: 'zikr',
        text: b.text || '(اختار الذكر أو اكتب النص)',
        sub: '',
        label: b.cat || 'ذكر',
        footer: [b.showCount && n > 1 ? `يُقال ${Q.arabicNum(n)} ${n <= 10 ? 'مرات' : 'مرة'}` : '', b.ref].filter(Boolean).join(' • '),
        audio: zAudio,
        silence: Number(b.seconds) || 8,
      });
    } else {
      const col = collection(b.col);
      const g = assessGrade(b.col, b.grades);
      const au = hadithAudio.get(b.id);
      const useAudio = b.audioMode !== 'none' && au?.buffer;
      const hAudio = useAudio ? await enhanceVoice(au.buffer, b.enhance) : null;
      segs.push({
        kind: 'hadith',
        text: b.text || '(اكتب نص الحديث أو اضغط «جلب الحديث»)',
        sub: b.showEnglish ? b.english : '',
        label: `${col.name} • ${Q.arabicNum(b.number)}`,
        footer: `${col.cite} • ${g.label}`,
        audio: hAudio,
        silence: Number(b.seconds) || 8,
        hadithBlock: b,
      });
    }
  }

  // الافتتاحية (Hook): جملة تشد في أول ثانية ونص
  if (st.intro && st.intro.trim() && segs.length) {
    segs.unshift({ kind: 'title', text: st.intro.trim(), sub: '', label: '', footer: '', silence: Number(st.introSeconds) || 1.6 });
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
        if ((s.kind !== 'hadith' && s.kind !== 'zikr' && !s.custom) || s.wordTimes) continue;
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
  const rc = b.rec && hadithAudio.get(b.id) ? 'custom' : state.style.reciter;
  if (b.type === 'quran' && ser) return `quran_${b.surah}_part${String(ser.index).padStart(2, '0')}_${b.from}-${b.to}_${rc}`;
  if (b.type === 'quran') return `quran_${b.surah}_${b.from}-${b.to}_${rc}`;
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
      logExperiment(`${baseName()}.mp4`, d);
      status(`✅ الفيديو جاهز (${fmtDur(d)})${project.usedFast ? ' — تصدير سريع ⚡' : ''}`);
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
  f('basmala').onchange = () => { b.basmala = f('basmala').checked; persist(); refreshPreview(); recSync(); };
  const recSync = wireRecitation(li, b);
  li.addEventListener('input', e => { if (['from', 'to'].includes(e.target.dataset.f)) recSync(); });
  sync();
  return li;
}

// ===== تلاوة من ملف (قارئ مش في القايمة) =====
const stripMarks = t => t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\s]/g, '');

function recUnits(b, from = b.from, to = b.to, withBasmala = b.basmala && b.surah !== 1 && b.surah !== 9) {
  const u = withBasmala ? [Q.BASMALA] : [];
  for (let a = from; a <= to; a++) u.push(Q.ayahText(b.surah, a));
  return u;
}

// بيقسم المقطع [start, end] على الآيات: بتوقيتاتك لو علّمتها، وإلا حسب طول كل آية
function recPieces(b, buffer, from, to, withBasmala) {
  const units = recUnits(b, from, to, withBasmala);
  const start = Math.max(0, Number(b.rec.start) || 0);
  const end = Math.min(buffer.duration, Number(b.rec.end) > start ? Number(b.rec.end) : buffer.duration);
  const marks = (b.rec.marks || []).filter(t => t > start && t < end).sort((x, y) => x - y);
  let cuts;
  if (marks.length >= units.length - 1) {
    cuts = [start, ...marks.slice(0, units.length - 1), end];
  } else {
    const w = units.map(t => stripMarks(t).length + 6);
    const total = w.reduce((x, y) => x + y, 0);
    cuts = [start];
    for (const x of w) cuts.push(cuts[cuts.length - 1] + (end - start) * x / total);
  }
  return units.map((_, i) => sliceBuffer(buffer, cuts[i], cuts[i + 1]));
}

function wireRecitation(li, b) {
  const f = name => li.querySelector(`[data-f=${name}]`);
  const el = name => li.querySelector(`[data-el=${name}]`);
  const act = name => li.querySelector(`[data-act=${name}]`);
  const player = el('recPlayer');
  const fmt = t => (Math.round(t * 10) / 10).toFixed(1);
  const sync = () => {
    const au = hadithAudio.get(b.id);
    const has = !!(b.rec && au);
    el('recBody').hidden = !has;
    f('recName').value = b.rec?.name || '';
    act('recClear').hidden = !b.rec;
    li.querySelector('.custom-rec summary').textContent = has
      ? `🎙️ تلاوة من ملف: ${b.rec.name || au.name}`
      : b.rec ? `⚠️ ارفع ملف التلاوة تاني (${b.rec.file || ''}) — الملفات مش بتتحفظ لما الصفحة تتقفل`
      : '🎙️ تلاوة من ملف (لقارئ مش في القايمة، زي الشيخ سيد سعيد)';
    if (b.rec && !has) li.querySelector('.custom-rec').open = true;
    if (!has) return;
    if (player.src !== au.url) player.src = au.url;
    f('recStart').value = fmt(b.rec.start || 0);
    f('recEnd').value = fmt(b.rec.end || au.buffer.duration);
    const need = recUnits(b).length - 1;
    const n = (b.rec.marks || []).length;
    el('recMarks').textContent = n
      ? `علّمت ${Q.arabicNum(Math.min(n, need))} من ${Q.arabicNum(need)}${n >= need ? ' ✅' : ''}`
      : 'من غير توقيتات: هيتقسم حسب طول الآيات';
  };
  const changed = () => { sync(); persist(); refreshPublish(true); refreshPreview(); };
  f('recFile').onchange = async () => {
    const file = f('recFile').files[0];
    f('recFile').value = '';
    if (!file) return;
    try {
      status('بيقرا ملف التلاوة…');
      const buffer = await decode(await file.arrayBuffer());
      setHadithAudio(b, buffer, file.name, file);
      const guess = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim();
      b.rec = { name: b.rec?.name || '', file: file.name, start: 0, end: buffer.duration, marks: [] };
      if (!b.rec.name && /[\u0600-\u06FF]/.test(guess)) b.rec.name = guess;
      status(`✅ اتحمّلت التلاوة (${fmtDur(buffer.duration)}). حدد البداية والنهاية.`);
      changed();
      if (!b.rec.name) f('recName').focus();
    } catch {
      showError(new Error('الملف ده مش ملف صوت مدعوم'));
    }
  };
  f('recName').oninput = () => { if (!b.rec) return; b.rec.name = f('recName').value.trim(); persist(); refreshPublish(true); };
  f('recName').onchange = changed;
  const num = (k, name) => {
    f(name).onchange = () => {
      const au = hadithAudio.get(b.id);
      if (!b.rec || !au) return;
      b.rec[k] = Math.min(au.buffer.duration, Math.max(0, Number(f(name).value) || 0));
      changed();
    };
  };
  num('start', 'recStart');
  num('end', 'recEnd');
  act('recSetStart').onclick = () => { if (!b.rec) return; b.rec.start = player.currentTime; b.rec.marks = []; changed(); };
  act('recSetEnd').onclick = () => { if (!b.rec) return; b.rec.end = player.currentTime; changed(); };
  act('recPlayRange').onclick = () => {
    if (!b.rec) return;
    player.currentTime = b.rec.start || 0;
    player.play().catch(() => {});
    const end = b.rec.end;
    const stopAt = () => { if (player.currentTime >= end) { player.pause(); player.removeEventListener('timeupdate', stopAt); } };
    player.addEventListener('timeupdate', stopAt);
  };
  act('recMark').onclick = () => {
    if (!b.rec) return;
    if (player.paused) { player.currentTime = b.rec.start || 0; player.play().catch(() => {}); status('اشتغلت من البداية — اضغط «الآية اللي بعدها» أول ما كل آية تبدأ'); return; }
    b.rec.marks = [...(b.rec.marks || []), player.currentTime].sort((x, y) => x - y);
    sync(); persist();
  };
  act('recMarksClear').onclick = () => { if (!b.rec) return; b.rec.marks = []; changed(); };
  act('recClear').onclick = () => {
    player.pause();
    delete b.rec;
    hadithAudio.delete(b.id);
    li.querySelector('.custom-rec').open = false;
    changed();
  };
  sync();
  return sync;
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
  f('enhance').innerHTML = Object.entries(ENHANCE_PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  f('enhance').value = b.enhance || '';
  f('enhance').onchange = () => { b.enhance = f('enhance').value; persist(); };
  let enhPlayer = null;
  act('enhancePreview').onclick = async () => {
    const au = hadithAudio.get(b.id);
    if (!au) { alert('سجّل أو ارفع صوت الأول'); return; }
    if (enhPlayer) { enhPlayer.pause(); URL.revokeObjectURL(enhPlayer.src); enhPlayer = null; }
    const btn = act('enhancePreview');
    btn.disabled = true;
    try {
      const out = await enhanceVoice(au.buffer, b.enhance);
      enhPlayer = new Audio(URL.createObjectURL(bufferToWavBlob(out)));
      enhPlayer.play().catch(() => {});
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false;
    }
  };

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
  const b = { id: uid(), type: 'zikr', cat, index, text: '', count: 1, ref: '', desc: '', showCount: true, audioMode: 'none', seconds: 8, enhance: 'clean' };
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

// ===== مكتبة الأذكار (نافذة) =====
const AZ_FIRST = ['أذكار الصباح', 'أذكار المساء', 'أذكار النوم', 'أذكار الاستيقاظ من النوم', 'الرقية الشرعية من القرآن الكريم',
  'الرقية الشرعية من السنة النبوية', 'الأذكار بعد السلام من الصلاة', 'دعاء الهم والحزن', 'دعاء الكرب',
  'الاستغفار و التوبة', 'التسبيح، التحميد، التهليل، التكبير', 'فضل الصلاة على النبي صلى الله عليه و سلم', 'دعاء السفر'];
const azNorm = t => (t || '').replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
let azCat = 'أذكار الصباح';

function focusLastBlock() {
  const li = blocksEl.lastElementChild;
  if (!li) return;
  li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1700);
}

function openAzkarLibrary() {
  if (!AZKAR?.categories.length) { alert('ملف الأذكار ماتحمّلش. اعمل Refresh للصفحة (Ctrl + Shift + R).'); return; }
  renderAzCats();
  renderAzItems();
  $('#dlg-azkar').showModal();
}

function sortedCats() {
  const cats = [...AZKAR.categories];
  const rank = c => { const i = AZ_FIRST.indexOf(c.name); return i === -1 ? 999 : i; };
  return cats.sort((a, b) => rank(a) - rank(b));
}

function renderAzCats() {
  const box = $('#az-cats');
  box.innerHTML = '';
  for (const c of sortedCats()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'az-cat';
    b.setAttribute('aria-selected', String(c.name === azCat && !$('#az-q').value.trim()));
    b.innerHTML = '<span></span><span class="n"></span>';
    b.firstChild.textContent = c.name;
    b.lastChild.textContent = c.items.length;
    b.onclick = () => { azCat = c.name; $('#az-q').value = ''; renderAzCats(); renderAzItems(); };
    box.appendChild(b);
  }
}

function renderAzItems() {
  const q = azNorm($('#az-q').value.trim());
  let list;
  if (q.length >= 2) {
    list = [];
    for (const c of AZKAR.categories) c.items.forEach((it, k) => {
      if (azNorm(it.t).includes(q) || azNorm(c.name).includes(q)) list.push({ cat: c.name, k, it });
    });
    $('#az-title').textContent = `نتايج البحث (${list.length})`;
    $('#az-add-all').hidden = true;
  } else {
    const c = AZKAR.categories.find(x => x.name === azCat) || AZKAR.categories[0];
    azCat = c.name;
    list = c.items.map((it, k) => ({ cat: c.name, k, it }));
    $('#az-title').textContent = `${c.name} (${c.items.length})`;
    $('#az-add-all').hidden = c.items.length < 2;
  }
  const box = $('#az-items');
  box.innerHTML = list.length ? '' : '<p class="muted">مفيش نتايج.</p>';
  for (const { cat, k, it } of list.slice(0, 150)) {
    const d = document.createElement('div');
    d.className = 'az-item';
    d.innerHTML = '<div class="cat"></div><div class="txt"></div><div class="meta"></div><button class="btn" type="button">＋ أضف للفيديو</button>';
    d.querySelector('.cat').textContent = q ? cat : '';
    d.querySelector('.txt').textContent = it.t;
    d.querySelector('.meta').textContent = [it.n > 1 && `🔁 ${it.n} مرات`, it.r && `📖 ${it.r}`, it.d && `💡 ${it.d}`].filter(Boolean).join('  •  ');
    d.querySelector('button').onclick = () => {
      state.blocks.push(newZikrBlock(cat, k));
      $('#dlg-azkar').close();
      renderBlocks();
      focusLastBlock();
      status(`✅ اتضاف: ${cat}`);
    };
    box.appendChild(d);
  }
}

function setupAzkarLibrary() {
  $('#az-close').onclick = () => $('#dlg-azkar').close();
  let t = null;
  $('#az-q').oninput = () => { clearTimeout(t); t = setTimeout(() => { renderAzCats(); renderAzItems(); }, 200); };
  $('#az-add-all').onclick = () => {
    const c = AZKAR.categories.find(x => x.name === azCat);
    if (!c) return;
    c.items.forEach((_, k) => state.blocks.push(newZikrBlock(c.name, k)));
    $('#dlg-azkar').close();
    renderBlocks();
    focusLastBlock();
    status(`✅ اتضاف ${c.items.length} ذكر من «${c.name}». القايمة الطويلة هتطلع فيديو طويل — الأنسب لها MP3 أو «حزمة Filmora»، أو فعّل «وضع السلسلة» لاحقًا.`);
  };
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
const STYLE_INPUTS = ['aspect', 'bgType', 'color1', 'color2', 'dim', 'textSize', 'labelScale', 'textColor', 'accent', 'subColor', 'gap', 'trimSilence', 'wordMode', 'intro', 'introSeconds', 'handle', 'handlePos', 'showLabel', 'showFooter', 'showTranslation', 'waveform', 'translation'];

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
  const prov = $('#stock-provider');
  prov.innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const st = getSettings();
  prov.value = load('stockProvider', null) || (st.pixabayKey ? 'pixabay' : st.pexelsKey ? 'pexels' : 'commons');
  prov.onchange = () => save('stockProvider', prov.value);
  $('#open-stock').onclick = () => dlg.showModal();
  $('#stock-close').onclick = () => dlg.close();
  const go = async () => {
    const box = $('#stock-results');
    box.textContent = 'جاري البحث…';
    try {
      const fn = PROVIDERS[prov.value].fn;
      const items = await fn($('#stock-q').value.trim() || 'nature', $('#stock-kind').value, state.style.aspect);
      box.innerHTML = items.length ? '' : 'مفيش نتايج';
      for (const it of items) {
        const d = document.createElement('div');
        d.className = 'stock-item';
        d.innerHTML = `<img alt="" loading="lazy"><span class="tag"></span>`;
        d.querySelector('img').src = it.thumb;
        d.querySelector('.tag').textContent = `${it.kind === 'video' ? '🎞️' : '🖼️'} ${it.credit || ''}${it.license ? ' · ' + it.license : ''}`;
        d.onclick = async () => {
          d.style.opacity = .5;
          try {
            setMedia(await downloadStock(it));
            dlg.close();
            if (it.license && /BY/i.test(it.license)) status(`الخلفية برخصة ${it.license}: اكتب في الوصف «الخلفية: ${it.credit || 'صاحبها'} — Wikimedia/Openverse (${it.license})»`);
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

// ===== التنظيم: الخطوات وشريط الموبايل =====
function showTab(name, scroll = true) {
  document.querySelectorAll('#steps [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  save('tab', name);
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (scroll) $('#steps').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const TABS = ['content', 'audio', 'look', 'export'];

function setupLayout() {
  $('#steps').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
  document.querySelectorAll('[data-next]').forEach(b => { b.onclick = () => showTab(b.dataset.next); });
  // رابط مباشر لأي خطوة: …/#content أو #audio أو #look أو #export
  const fromHash = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : null;
  showTab(fromHash() || load('tab', 'content'), false);
  window.addEventListener('hashchange', () => { const t = fromHash(); if (t) showTab(t); });
  // اختصارات: Alt + 1 / 2 / 3 / 4
  document.addEventListener('keydown', e => {
    if (!e.altKey) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i !== -1) { e.preventDefault(); showTab(TABS[i]); }
  });
  // زرار «السابق» جنب «التالي»
  document.querySelectorAll('[data-next]').forEach(b => {
    const panel = b.closest('.tab-panel').dataset.panel;
    const prev = TABS[TABS.indexOf(panel) - 1];
    if (!prev) return;
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'btn'; back.textContent = '→ السابق';
    back.onclick = () => showTab(prev);
    b.before(back);
  });
  const last = document.querySelector('.tab-panel[data-panel=export]');
  const row = document.createElement('div');
  row.className = 'btn-row end';
  row.innerHTML = '<button class="btn" type="button">→ السابق</button><button class="btn" type="button">↺ ابدأ فيديو جديد من الخطوة ١</button>';
  row.children[0].onclick = () => showTab('look');
  row.children[1].onclick = () => showTab('content');
  last.appendChild(row);
  $('#mb-play').onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); player ? stop() : play(); };
  $('#mb-export').onclick = () => { showTab('export'); };
  $('#mb-share').onclick = () => { showTab('export'); if (!$('#pub-share').disabled) $('#pub-share').click(); };
}

// ===== حفظ المشروع وفتحه =====
async function blobToDataUrl(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

function setupProject() {
  $('#proj-save').onclick = async () => {
    const audios = {};
    const blocks = structuredClone(state.blocks);
    for (const [id, au] of hadithAudio) {
      const b = blocks.find(x => x.id === id);
      if (!b) continue;
      let buf = au.buffer;
      // التلاوة المرفوعة: بنحفظ المقطع المختار بس مش السورة كلها
      if (b.type === 'quran' && b.rec) {
        const st = b.rec.start || 0, en = b.rec.end || buf.duration;
        buf = sliceBuffer(buf, st, en);
        b.rec = { ...b.rec, start: 0, end: buf.duration, marks: (b.rec.marks || []).map(t => t - st).filter(t => t > 0 && t < buf.duration) };
      }
      audios[id] = { name: au.name, data: await blobToDataUrl(bufferToWavBlob(buf)) };
    }
    const proj = { app: 'quran-clip-studio', version: 1, savedAt: new Date().toISOString(), blocks, style: state.style, series: state.series, audios };
    const first = state.blocks[0];
    const name = first?.type === 'quran' ? `${Q.surah(first.surah).tr}_${first.from}-${first.to}` : baseName();
    download(new Blob([JSON.stringify(proj)], { type: 'application/json' }), `مشروع_${name}.json`);
    status('✅ المشروع اتحفظ. افتحه بعدين من «📂 فتح». (الخلفية وصوت الخلفية مش بيتحفظوا — اختارهم تاني)');
  };
  $('#proj-open').onchange = async () => {
    const file = $('#proj-open').files[0];
    $('#proj-open').value = '';
    if (!file) return;
    try {
      const proj = JSON.parse(await file.text());
      if (proj.app !== 'quran-clip-studio' || !Array.isArray(proj.blocks)) throw new Error('ده مش ملف مشروع من البرنامج');
      stop();
      state.blocks = proj.blocks;
      state.style = { ...T.DEFAULT_STYLE, ...proj.style, bgType: proj.style?.bgType === 'media' && !state.media ? 'gradient' : proj.style?.bgType };
      if (proj.series) { Object.assign(state.series, proj.series); save('series', state.series); }
      hadithAudio.clear();
      for (const [id, au] of Object.entries(proj.audios || {})) {
        const blob = await (await fetch(au.data)).blob();
        setHadithAudio({ id }, await decode(await blob.arrayBuffer()), au.name, blob);
      }
      applyStyleToInputs();
      renderBlocks();
      refreshPublish(true);
      persist();
      showTab('content');
      status(`✅ اتفتح المشروع (${proj.blocks.length} مقطع)`);
    } catch (e) {
      showError(new Error('تعذر فتح المشروع: ' + e.message));
    }
  };
}

// ===== طابور التصدير =====
const queue = { items: load('queue', []), running: false, stopAfter: false };
const saveQueue = () => save('queue', queue.items.map(({ error, ...it }) => it));
const QUEUE_PLATFORMS = ['tiktok', 'instagram', 'facebook'];

function quranRefBlock(r, basmala) {
  const b = newQuranBlock(r.surah, r.from, r.to);
  b.basmala = basmala && r.from === 1 && r.surah !== 1 && r.surah !== 9;
  return b;
}

const refLabel = r => `${Q.surah(r.surah).ar} ${r.from === r.to ? Q.arabicNum(r.from) : `${Q.arabicNum(r.from)}–${Q.arabicNum(r.to)}`}`;

function blocksLabel(blocks) {
  const names = blocks.map(b => b.type === 'quran' ? refLabel(b)
    : b.type === 'zikr' ? 'ذكر' : `حديث ${collection(b.col)?.name || b.col} ${b.number}`);
  return names.length > 2 ? `${names.slice(0, 2).join(' + ')} + ${names.length - 2} كمان` : names.join(' + ');
}

function renderQueue() {
  const ol = $('#q-list');
  ol.innerHTML = '';
  queue.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'part' + (it.done ? ' done' : '') + (it.error ? ' err' : '') + (it.running ? ' running' : '');
    li.innerHTML = `<span class="pname"></span><span class="pinfo"></span>
      <button class="btn icon" type="button" data-a="open" title="افتح في المحرر">👁</button>
      <button class="btn icon" type="button" data-a="del" title="شيل من الطابور">✕</button>`;
    li.querySelector('.pname').textContent = `${Q.arabicNum(i + 1)}. ${it.label}`;
    li.querySelector('.pinfo').textContent = it.error ? `⚠️ ${it.error}` : it.running ? '⏳ بيتصدّر…' : it.done ? '✅ خلص' : '';
    li.querySelector('[data-a=open]').onclick = () => {
      if (queue.running) return;
      stop();
      state.blocks = structuredClone(it.blocks);
      renderBlocks();
      refreshPublish(true);
      showTab('content');
    };
    li.querySelector('[data-a=del]').onclick = () => {
      if (queue.running) return;
      queue.items.splice(i, 1);
      saveQueue();
      renderQueue();
    };
    ol.appendChild(li);
  });
  const pending = queue.items.filter(it => !it.done).length;
  $('#q-run').textContent = queue.running ? '⏳ شغّال…' : `▶ ابدأ الطابور${pending ? ` (${Q.arabicNum(pending)})` : ''}`;
  $('#q-run').disabled = queue.running || !pending;
  $('#q-stop').hidden = !queue.running;
}

function renderQueueTemplates() {
  const sel = $('#q-template'), cur = sel.value;
  sel.innerHTML = '<option value="">الشكل الحالي (الخطوة ٣)</option>' +
    Object.keys(T.listTemplates()).map(n => `<option>${escapeHtml(n)}</option>`).join('');
  sel.value = cur && T.listTemplates()[cur] ? cur : '';
}

async function runQueue() {
  if (state.busy || queue.running) return;
  const todo = queue.items.filter(it => !it.done);
  if (!todo.length) return;
  const kind = $('#q-kind').value;
  const tplName = $('#q-template').value;
  stop();
  const saved = { blocks: state.blocks, style: state.style, activeSeries: state.activeSeries };
  if (tplName) {
    const tpl = T.listTemplates()[tplName];
    state.style = { ...T.DEFAULT_STYLE, ...tpl, bgType: tpl.bgType === 'media' && !state.media ? 'gradient' : tpl.bgType };
  }
  queue.running = true;
  queue.stopAfter = false;
  setBusy(true);
  const onLoad = p => status('تحميل محرك التحويل (مرة واحدة بس)…', p);
  const captions = [];
  let n = 0;
  try {
    for (const it of todo) {
      if (queue.stopAfter) break;
      n++;
      const tag = `المقطع ${Q.arabicNum(n)} من ${Q.arabicNum(todo.length)}`;
      it.running = true;
      it.error = '';
      renderQueue();
      try {
        state.blocks = structuredClone(it.blocks);
        state.activeSeries = null;
        const project = await buildProject();
        const d = project.timeline.duration;
        const num = String(queue.items.indexOf(it) + 1).padStart(2, '0');
        const name = `${num}_${baseName()}`;
        if (kind !== 'mp3') {
          if (d > MAX_VIDEO_SECONDS) throw new Error(`مدته ${fmtDur(d)}، أطول من ٣ دقايق — صدّره MP3 أو حزمة Filmora`);
          let stage = '';
          const blob = await exportVideo(project, p => status(`${tag}: ${stage}`, p), onLoad, s => { stage = s; status(`${tag}: ${s}`, 0); });
          download(blob, `${name}.mp4`);
          setLastExport(blob, `${name}.mp4`, 'video/mp4');
          logExperiment(`${name}.mp4`, d);
        }
        if (kind !== 'mp4') {
          const blob = await exportAudio('mp3', project.timeline, p => status(`${tag}: MP3…`, p), onLoad);
          download(blob, `${name}.mp3`);
        }
        const g = await generate(it.blocks, state.style, Q.translation, null);
        captions.push({ name, label: it.label, dur: fmtDur(d), g });
        it.done = true;
      } catch (e) {
        console.error(e);
        it.error = e.message || String(e);
      }
      it.running = false;
      saveQueue();
      renderQueue();
    }
    if (captions.length) {
      let txt = `طابور التصدير — ${new Date().toLocaleString('ar-EG')}\nانسخ العنوان والوصف لكل فيديو وانت بتجدوله.\n\n`;
      for (const c of captions) {
        txt += `==================== ${c.name} — ${c.label} (${c.dur}) ====================\n`;
        for (const p of QUEUE_PLATFORMS) {
          const d = c.g[p];
          if (!d) continue;
          txt += `\n--- ${PLATFORMS[p].name} ---\n`;
          if (PLATFORMS[p].title && d.title) txt += `${d.title}\n\n`;
          txt += `${d.caption}\n`;
        }
        txt += '\n';
      }
      download(new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' }), 'queue_captions.txt');
    }
    const failed = todo.filter(it => it.error).length;
    status(`✅ خلص ${Q.arabicNum(captions.length)} مقطع${failed ? ` — و ${Q.arabicNum(failed)} فيهم مشكلة (مكتوبة جنبهم)` : ''}${queue.stopAfter ? ' — اتوقف بطلبك' : ''}`, null, !!failed && !captions.length);
  } finally {
    Object.assign(state, saved);
    queue.running = false;
    setBusy(false);
    renderBlocks(true);
    renderQueue();
  }
}

function setupQueue() {
  renderQueueTemplates();
  $('#q-template').onfocus = renderQueueTemplates;
  $('#q-add').onclick = () => {
    const { ok, bad } = parseRefs($('#q-input').value, Q.surahs());
    for (const r of ok) queue.items.push({ id: uid(), label: refLabel(r), blocks: [quranRefBlock(r, $('#q-basmala').checked)], done: false });
    $('#q-input').value = bad.join('\n');
    saveQueue();
    renderQueue();
    if (bad.length) status(`اتضاف ${Q.arabicNum(ok.length)}. السطور اللي فضلت في الخانة مش مفهومة — اكتبها زي «يوسف 4-6» أو «12:4-6»`, null, true);
    else if (ok.length) status(`✅ اتضاف ${Q.arabicNum(ok.length)} مقطع للطابور`);
  };
  $('#q-add-current').onclick = () => {
    if (!state.blocks.length) return;
    if (!confirmGrades()) return;
    queue.items.push({ id: uid(), label: blocksLabel(state.blocks), blocks: structuredClone(state.blocks), done: false });
    saveQueue();
    renderQueue();
    status('✅ المحتوى الحالي اتضاف للطابور');
  };
  $('#q-run').onclick = runQueue;
  $('#q-stop').onclick = () => { queue.stopAfter = true; status('هيقف بعد المقطع الحالي…'); };
  $('#q-clear-done').onclick = () => { if (queue.running) return; queue.items = queue.items.filter(it => !it.done); saveQueue(); renderQueue(); };
  $('#q-clear').onclick = () => {
    if (queue.running || !queue.items.length || !confirm('تفضّي الطابور كله؟')) return;
    queue.items = [];
    saveQueue();
    renderQueue();
  };
  renderQueue();
}

// ===== الفيديو المرجعي =====
const refs = { list: load('refs', []), current: null };
const REF_ICONS = { tiktok: '🎵', instagram: '📸', facebook: '📘', youtube: '▶️' };

function showRef(url) {
  const e = embedFor(url);
  const msg = $('#ref-msg');
  $('#ref-player').hidden = true;
  $('#ref-frame').removeAttribute('src');
  refs.current = null;
  if (!e) { msg.textContent = 'اللينك ده مش من تيك توك أو إنستجرام أو فيسبوك أو يوتيوب.'; return; }
  $('#ref-open').href = e.url;
  if (e.error) { msg.textContent = e.error; $('#ref-player').hidden = false; $('#ref-frame').hidden = true; return; }
  $('#ref-frame').hidden = false;
  $('#ref-frame').src = e.src;
  $('#ref-player').hidden = false;
  msg.textContent = `${e.name}: لو الفيديو ما ظهرش، يبقى صاحبه قافل التضمين أو الحساب خاص — افتح الأصلي.`;
  refs.current = e;
  const old = refs.list.find(r => r.url === e.url);
  if (old) { $('#ref-note').value = old.note || ''; $('#ref-ayat').value = old.ayat || ''; fillRecipe(old.recipe || {}); }
}

function renderRefs() {
  const box = $('#ref-saved');
  box.innerHTML = refs.list.length ? '<h3>المراجع المحفوظة</h3>' : '';
  refs.list.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'ref-item';
    d.innerHTML = `<span></span><span class="grow"></span><button class="btn icon" type="button" title="حذف">✕</button>`;
    d.children[0].textContent = REF_ICONS[r.platform] || '🎞️';
    d.children[1].textContent = r.recipe?.intro || r.note || r.ayat || r.url;
    d.title = r.url;
    d.onclick = e => {
      if (e.target.closest('button')) return;
      $('#ref-url').value = r.url;
      showRef(r.url);
    };
    d.querySelector('button').onclick = () => { refs.list.splice(i, 1); save('refs', refs.list); renderRefs(); };
    box.appendChild(d);
  });
}

function setupReference() {
  const dlg = $('#dlg-ref');
  const toggle = open => { open ? dlg.show() : dlg.close(); document.body.classList.toggle('ref-open', dlg.open); };
  $('#btn-ref').onclick = () => { toggle(!dlg.open); if (dlg.open) $('#ref-url').focus(); };
  $('#ref-close').onclick = () => { $('#ref-frame').removeAttribute('src'); toggle(false); };
  $('#ref-show').onclick = () => showRef($('#ref-url').value);
  $('#ref-url').onkeydown = e => { if (e.key === 'Enter') showRef($('#ref-url').value); };
  $('#ref-url').onpaste = () => setTimeout(() => showRef($('#ref-url').value), 0);
  $('#ref-load').onclick = () => {
    const { ok } = parseRefs($('#ref-ayat').value, Q.surahs());
    if (!ok.length) { status('اكتب الآيات زي «يوسف 4-6» أو «12:4-6»', null, true); return; }
    stop();
    state.blocks = ok.map(r => quranRefBlock(r, true));
    renderBlocks();
    refreshPublish(true);
    showTab('look');
    status(`✅ اتحمّل ${ok.map(refLabel).join(' + ')}. ظبّط الشكل زي المرجع، وبعدين احفظه كقالب.`);
  };
  $('#ref-save').onclick = () => {
    if (!refs.current) { status('اعرض فيديو الأول', null, true); return; }
    const entry = { url: refs.current.url, platform: refs.current.platform, note: $('#ref-note').value.trim(), ayat: $('#ref-ayat').value.trim(), recipe: readRecipe() };
    refs.list = [entry, ...refs.list.filter(r => r.url !== entry.url)].slice(0, 30);
    save('refs', refs.list);
    renderRefs();
    status('✅ المرجع اتحفظ');
  };
  renderRefs();
  setupRecipe();
}

// ===== وصفة الريل =====
const RC = { intro: 'rc-intro', wordMode: 'rc-wordMode', textSize: 'rc-size', reciter: 'rc-reciter', duration: 'rc-dur', bg: 'rc-bg' };
let recipeColors = null; // { color1, color2, textColor, accent }

function readRecipe() {
  const r = {};
  for (const [k, id] of Object.entries(RC)) { const v = $('#' + id).value.trim(); if (v) r[k] = v; }
  if (recipeColors) r.colors = recipeColors;
  return r;
}

function fillRecipe(r) {
  for (const [k, id] of Object.entries(RC)) $('#' + id).value = r[k] || '';
  recipeColors = r.colors || null;
  renderSwatches();
}

function renderSwatches() {
  const box = $('#rc-swatches');
  box.innerHTML = '';
  if (!recipeColors) return;
  for (const [k, c] of Object.entries(recipeColors)) {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c;
    sw.title = { color1: 'الخلفية ١', color2: 'الخلفية ٢', textColor: 'النص', accent: 'التمييز' }[k] + ' ' + c;
    box.appendChild(sw);
  }
}

// ألوان أساسية من صورة: بنصغرها ونجمع الألوان المتقاربة
async function paletteFromImage(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = 48; c.height = 85;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    bins.set(key, b);
  }
  const cols = [...bins.values()].map(b => ({ n: b.n, r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }))
    .map(c => ({ ...c, l: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, sat: Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) }))
    .sort((a, b) => b.n - a.n);
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const top = [];
  for (const c of cols) { if (top.every(t => dist(t, c) > 40)) top.push(c); if (top.length >= 8) break; }
  const dark = [...top].sort((a, b) => a.l - b.l);
  const bg1 = dark[0], bg2 = dark.find(c => c !== bg1 && c.l < 140) || dark[1] || bg1;
  const light = [...top].sort((a, b) => b.l - a.l)[0];
  const textColor = light && light.l > 170 ? hex(light) : '#ffffff';
  const acc = [...top].filter(c => c.l > 90).sort((a, b) => b.sat * b.n - a.sat * a.n)[0];
  return { color1: hex(bg1), color2: hex(bg2), textColor, accent: acc ? hex(acc) : '#f4d58d' };
}

function setupRecipe() {
  $('#rc-reciter').innerHTML = '<option value="">زي ما هو</option>' + $('#reciter').innerHTML;
  $('#rc-shot').onchange = async () => {
    const file = $('#rc-shot').files[0];
    $('#rc-shot').value = '';
    if (!file) return;
    try {
      recipeColors = await paletteFromImage(file);
      renderSwatches();
      status('✅ اتسحبت الألوان من الصورة — هتتطبق مع «طبّق الوصفة»');
    } catch (e) { showError(new Error('تعذر قراءة الصورة')); }
  };
  $('#rc-bg-go').onclick = () => {
    const q = $('#rc-bg').value.trim();
    if (!q) { $('#rc-bg').focus(); return; }
    $('#stock-q').value = q;
    $('#open-stock').click();
    $('#stock-go').click();
  };
  $('#rc-apply').onclick = () => {
    const r = readRecipe();
    const st = state.style;
    if (r.intro != null) st.intro = r.intro;
    if (r.wordMode) st.wordMode = r.wordMode;
    if (r.textSize) st.textSize = Number(r.textSize);
    if (r.reciter) st.reciter = r.reciter;
    if (r.colors) {
      Object.assign(st, r.colors);
      if (st.bgType === 'color' || (st.bgType === 'media' && !state.media)) st.bgType = 'gradient';
    }
    applyStyleToInputs();
    persist();
    refreshPreview();
    refreshPublish(true);
    let msg = '✅ الوصفة اتطبقت';
    if ($('#rc-save-tpl').checked) {
      const def = (r.intro || $('#ref-note').value.trim().split(/[،,\n]/)[0] || 'زي المرجع').slice(0, 30);
      const name = prompt('اسم القالب:', def);
      if (name && !T.isBuiltin(name)) {
        T.saveTemplate(name, { ...state.style });
        renderTemplates();
        renderQueueTemplates();
        msg += ` واتحفظت قالب «${name}»`;
      }
    }
    if (r.duration) msg += ` — هدفك ${r.duration} ثانية، اختار آيات على قدها`;
    status(msg);
  };
  renderLog();
  $('#log-csv').onclick = () => {
    const rows = [['التاريخ', 'الفيديو', 'المدة', 'المرجع', 'الافتتاحية', 'ظهور الآيات', 'القارئ', 'المشاهدات', 'اللايكات']];
    for (const e of expLog) rows.push([e.date, e.file, e.dur, e.ref, e.recipe?.intro || '', e.recipe?.wordMode || '', e.recipe?.reciter || '', e.views ?? '', e.likes ?? '']);
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'تجاربي.csv');
  };
}

// ===== سجل التجارب =====
const expLog = load('expLog', []);

function logExperiment(file, dur) {
  if (!refs.current || !$('#dlg-ref').open) return;
  expLog.unshift({
    id: uid(), date: new Date().toISOString().slice(0, 10), file, dur: fmtDur(dur),
    ref: refs.current.url, recipe: { ...readRecipe(), wordMode: state.style.wordMode, reciter: state.style.reciter, intro: state.style.intro },
  });
  save('expLog', expLog.slice(0, 200));
  renderLog();
}

function renderLog() {
  const box = $('#ref-log');
  box.innerHTML = expLog.length ? '' : '<p class="muted">لسه مفيش تجارب.</p>';
  const sorted = [...expLog].sort((a, b) => (Number(b.views) || -1) - (Number(a.views) || -1));
  const WM = { full: 'كاملة', reveal: 'كلمة كلمة', highlight: 'تظليل' };
  for (const e of sorted) {
    const d = document.createElement('div');
    d.className = 'log-row';
    d.innerHTML = `<div class="grow"><b></b><div class="muted"></div></div>
      <label>👁 <input type="number" min="0" data-k="views"></label>
      <label>❤ <input type="number" min="0" data-k="likes"></label>
      <button class="btn icon" type="button" title="حذف">✕</button>`;
    d.querySelector('b').textContent = e.file;
    d.querySelector('.muted').textContent = [e.date, e.dur, e.recipe?.intro && `«${e.recipe.intro}»`, WM[e.recipe?.wordMode], findReciter(e.recipe?.reciter || '')?.name].filter(Boolean).join(' · ');
    d.querySelectorAll('input').forEach(inp => {
      inp.value = e[inp.dataset.k] ?? '';
      inp.onchange = () => { e[inp.dataset.k] = inp.value === '' ? null : Number(inp.value); save('expLog', expLog); renderLog(); };
    });
    d.querySelector('button').onclick = () => { expLog.splice(expLog.indexOf(e), 1); save('expLog', expLog); renderLog(); };
    box.appendChild(d);
  }
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

  $('#add-quran').onclick = () => { state.blocks.push(newQuranBlock(1, 1, 1)); renderBlocks(); focusLastBlock(); };
  $('#add-hadith').onclick = () => { state.blocks.push(newHadithBlock()); renderBlocks(); focusLastBlock(); };
  $('#add-zikr').onclick = openAzkarLibrary;
  setupAzkarLibrary();
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
  setupLayout();
  setupProject();
  setupQueue();
  setupReference();
  idleLoop();
}

init().catch(showError);

// للاختبار من الكونسول
window.__qcs = { state, buildProject };
