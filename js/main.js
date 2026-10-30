import * as Q from './quran.js';
import { RECITERS, findReciter, customReciter, ayahAudioUrls } from './reciters.js';
import { COLLECTIONS, collection, getHadith, searchHadith, extractMatn, assessGrade } from './hadith.js';
import { loadAudio, decode, buildTimeline, startRecording, trimSilence, bufferToWavBlob, sliceBuffer, enhanceVoice, ENHANCE_PRESETS } from './audio.js';
import { autoMarks } from './automark.js';
import { ASPECTS, TEXT_FONT, ensureFonts, drawBackground, drawOverlay, drawWave } from './slides.js';
import { exportAudio, exportVideo, exportFilmoraPackage, renderStill, makeSrt, download } from './exporter.js';
import { PROVIDERS, downloadStock } from './stock.js';
import * as T from './templates.js';
import { getSettings, setSettings, load, save } from './storage.js';
import * as EL from './elevenlabs.js';
import * as GT from './geminitts.js';
import * as AL from './audiolib.js';
import { EMOTIONS, emotion } from './emotions.js';
import { THUMB_SIZES, THUMB_STYLES, drawThumb } from './thumbs.js';
import * as CP from './competitors.js';
import * as FX from './livefx.js';
import { OBS } from './obs.js';
import { THEMES, pick as pickOne } from './themes.js';
import * as LLM from './llm.js';
import * as SND from './sounds.js';
import * as WT from './words.js';
import { fetchFirst } from './net.js';
import { bgSchedule, pickBg } from './bglist.js';
import { saveMediaList, loadMediaList, saveLiveVideo, loadLiveVideo, deleteLiveVideo } from './mediastore.js';
import { splitRange, chaptersText, chaptersWarnings } from './series.js';
import { parseRefs, embedFor, surahInText } from './automation.js';
import * as PL from './planner.js';
import * as ST from './stats.js';
import { PLATFORMS, generate, getPublishSettings, setPublishSettings, canShareFile, shareFile } from './publish.js';

const $ = s => document.querySelector(s);
const MAX_VIDEO_SECONDS = 180;
// يوتيوب بيحجب الشورتس الأطول من دقيقة لو عليها مطالبة Content ID
const SHORTS_SAFE_SECONDS = 60;

// ===== الحالة =====
const state = {
  style: T.lastStyle(),
  blocks: load('blocks', null) || [newQuranBlock(1, 1, 7)],
  media: null,        // { kind, file, el, url } = أول خلفية
  mediaList: [],      // كل الخلفيات بالترتيب
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

  for (const [bi, b] of blocks.entries()) {
    // كارت فاضي (نص خاص أو ذكر أو حديث من غير نص): الجملة الإرشادية بتظهر في المعاينة بس، مش في الفيديو ولا البث
    if (withAudio && b.type !== 'quran' && !String(b.text || '').trim()) continue;
    const n0 = segs.length;
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
        // جزء من آية (كلمات معيّنة): بيتقص من صوت القارئ بتوقيت الكلمات
        // (مع تلاوتك أنت من «اقرا ورا الشيخ» الجزء متسجّل لوحده، فبيفضل شغال)
        const part = (!rec || b.rec.own) && from === to && ayahPart(b);
        for (let a = from; a <= to; a++, u++) {
          for (let k = 0; k < Math.max(1, b.repeatAyah); k++) {
            const full = `${Q.ayahText(b.surah, a)}\u00A0${Q.arabicNum(a)}`;
            const seg = {
              kind: 'ayah', s: b.surah, a, qs: b.surah, qa: a,
              text: part ? WT.words(Q.ayahText(b.surah, a)).slice(part.w1 - 1, part.w2).join(' ') : full,
              sub: '',
              label: part ? `سورة ${s.ar} • من الآية ${Q.arabicNum(a)}` : `سورة ${s.ar} • الآية ${Q.arabicNum(a)}`,
              footer,
            };
            if (part) Object.assign(seg, { part, fullText: full });
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
        text: b.text || (b.custom ? '(اكتب النص بتاعك)' : '(اختار الذكر أو اكتب النص)'),
        sub: '',
        label: b.custom ? (b.label || '') : (b.cat || 'ذكر'),
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
    for (let j = n0; j < segs.length; j++) segs[j].bi = bi;
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
    await Promise.all(segs.filter(s => s.kind === 'ayah' && !s.part).map(async s => {
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
          // ظهور الكلمات مع التلاوة:
          // ١) توقيت quran-align المحفوظ جوه البرنامج (لنفس ملفات EveryAyah) — أضمن، ومن غير API
          // ٢) توقيت Quran.com (بملف الصوت بتاعهم عشان التوقيت يطابق)
          let qc = null;
          const needTimes = wordSync || s.part;
          const af = needTimes && s.qs ? WT.alignFolder(reciter) : null;
          if (af) {
            try {
              const segments = await WT.alignSegments(af, s.qs, s.qa);
              if (segments) { s.audio = await loadAudio(s.audioUrls); qc = { segments, align: true }; }
            } catch { qc = null; }
          }
          if (!qc && needTimes && reciter.qurancom && s.qs) {
            try {
              qc = (await WT.quranComChapter(reciter.qurancom, s.qs)).get(s.qa) || null;
              if (qc) s.audio = await loadAudio([qc.url]);
            } catch { qc = null; }
          }
          if (!s.audio) s.audio = await loadAudio(s.audioUrls);
          // ملفات التلاوة فيها سكوت في أولها وآخرها؛ بنقصه عشان الآيات تبان متصلة
          if (st.trimSilence && s.kind !== 'title') s.audio = trimSilence(s.audio, { threshold: 0.008, pad: 0.06 });
          if (s.part) {
            // نقص الكلمات المطلوبة: من بداية أول كلمة لبداية الكلمة اللي بعد آخر كلمة
            const n = WT.words(s.fullText).length;
            const exact = qc && WT.timesFromSegments(qc.segments, n, s.audio.trimStart || 0);
            if (!exact) throw new Error(`القارئ ${reciter.name} مالوش توقيت كلمات للآية دي، فمش هقدر أقص «جزء من الآية». اختار قارئ عليه ⏱️.`);
            const t1 = Math.max(0, exact[s.part.w1 - 1] - 0.06);
            const t2 = s.part.w2 < n ? Math.max(t1 + 0.3, exact[s.part.w2] - 0.03) : s.audio.duration;
            s.audio = sliceBuffer(s.audio, t1, t2);
            if (wordSync) {
              s.wordTimes = exact.slice(s.part.w1 - 1, s.part.w2).map(t => Math.max(0, t - t1));
              s.wordExact = true;
              s.wordSource = qc.align ? 'quran-align' : 'Quran.com';
            }
          } else if (wordSync) {
            const n = WT.words(s.text).length;
            const exact = qc && WT.timesFromSegments(qc.segments, n, s.audio.trimStart || 0);
            s.wordTimes = exact || WT.approxTimes(s.text, s.audio.duration);
            s.wordExact = !!exact;
            s.wordSource = exact ? (qc.align ? 'quran-align' : 'Quran.com') : 'تقريبي';
          }
        } catch (e) {
          if (s.part && /توقيت كلمات/.test(e.message)) throw e;
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
// جزء الآية المختار (لو صالح): { w1, w2 } أرقام الكلمات من 1
function ayahPart(b) {
  const p = b.part;
  if (!p || b.from !== b.to) return null;
  const n = WT.words(Q.ayahText(b.surah, b.from)).length;
  const w1 = clamp(p.w1, 1, n), w2 = clamp(p.w2, w1, n);
  return w1 === 1 && w2 === n ? null : { w1, w2 };
}
// القارئ ده عنده توقيت كلمات دقيق؟ (لازم عشان «جزء من الآية»)
const exactWords = r => !!(WT.alignFolder(r) || r?.qurancom);

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
  const isMedia = state.style.bgType === 'media';
  return { segments, timeline, style: state.style, media: isMedia ? state.media : null, mediaList: isMedia ? [...state.mediaList] : [], W: w, H: h, quality: $('#quality').value };
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

// الخلفية اللي المفروض تظهر دلوقتي في المعاينة (لو فيه أكتر من خلفية)
function previewBg(t) {
  const list = state.style.bgType === 'media' ? state.mediaList : [];
  if (list.length <= 1) return { cur: bgMedia(), prev: null, alpha: 1 };
  if (player && t != null) {
    const sched = player.bgSched || (player.bgSched = bgSchedule(player.segs, player.duration, list.length, state.style, list.map(m => m.secs)));
    const p = pickBg(sched, t, state.style.bgFade !== false ? 0.6 : 0);
    return { cur: list[p.cur.k], prev: p.prev && list[p.prev.k], alpha: p.alpha };
  }
  // لو المدة اتحسبت: نستخدم التوقيت الحقيقي لنص المقطع الحالي
  const dc = durCache;
  if (dc && dc.segs.length === previewSegs.length && dc.segs[state.segIndex]) {
    const sg = dc.segs[state.segIndex];
    const sched = bgSchedule(dc.segs, dc.duration, list.length, state.style, list.map(m => m.secs));
    return { cur: list[pickBg(sched, (sg.start + sg.end) / 2).cur.k], prev: null, alpha: 1 };
  }
  const segs = previewSegs.map((s, i) => ({ ...s, start: i }));
  const sched = bgSchedule(segs, segs.length, list.length, state.style.bgSwitch !== 'ayah' ? { bgSwitch: 'ayah' } : state.style);
  return { cur: list[pickBg(sched, state.segIndex + 0.01).cur.k], prev: null, alpha: 1 };
}

function drawFrame(seg, analyser, t = null) {
  sizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const pb = previewBg(t);
  if (pb.prev) drawBackground(ctx, W, H, state.style, pb.prev);
  ctx.globalAlpha = pb.alpha;
  drawBackground(ctx, W, H, state.style, pb.cur);
  ctx.globalAlpha = 1;
  drawOverlay(ctx, W, H, seg, state.style);
  if (analyser && state.style.waveform) drawWave(ctx, W, H, analyser, state.style.accent);
}

// مصدر توقيت الكلمات للقارئ الحالي (بيظهر تحت «ظهور الآية»)
function updateWordSrc() {
  const el = $('#word-src');
  if (!el) return;
  const mode = state.style.wordMode;
  if (!mode || mode === 'full') { el.textContent = ''; return; }
  const r = findReciter(state.style.reciter);
  el.textContent = WT.alignFolder(r) ? '⏱️ توقيت دقيق لكل كلمة (quran-align — محفوظ في البرنامج)'
    : r.qurancom ? '⏱️ توقيت دقيق لكل كلمة (من Quran.com — محتاج نت)'
      : 'ℹ️ القارئ ده مالوش توقيت كلمات — هيتقسم تقريبي. القرّاء اللي جنبهم ⏱️ أدق.';
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
    updateWordSrc();
    refreshPublish();
    if (typeof updateDupWarn === 'function') updateDupWarn();
    scheduleDuration();
  }, 120);
}

// الفيديو كخلفية بيتحرك في المعاينة
function idleLoop() {
  if (!player && state.style.bgType === 'media' && state.mediaList.some(m => m.kind === 'video')) drawFrame(previewSegs[state.segIndex]);
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
    for (const m of state.mediaList) if (m.kind === 'video') { m.el.currentTime = 0; m.el.play().catch(() => {}); }
    player = { ac, src, analyser, segs: project.segments, startAt, duration: project.timeline.duration };
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
      drawFrame(shown, analyser, t);
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
  if (b.type === 'zikr') return b.custom ? 'dua' : `zikr_${b.index + 1}`;
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
      const blob = await withProject(await exportVideo(project, p => status(stage, p), onLoad, s => { stage = s; status(s, 0); }));
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
const fmtDur = s => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };

// ===== مدة المحتوى (بتتحسب في الخلفية بعد أي تعديل) =====
let durCache = null; // { duration, segs: [{kind,s,a,start,end,bi}], perBlock: Map(id -> sec) }
let durVer = 0, durTimer = null;

function fillBlockDurs() {
  const lis = blocksEl.children;
  state.blocks.forEach((b, i) => {
    const el = lis[i]?.querySelector('[data-el=dur]');
    if (!el) return;
    const d = durCache?.perBlock.get(b.id);
    el.textContent = d != null ? `⏱ ${fmtDur(d)}` : '';
  });
}

function renderDuration(pending = false) {
  const el = $('#dur-total'), note = $('#dur-note');
  if (!el) return;
  if (pending && !durCache) { el.textContent = '⏱ …'; return; }
  if (!durCache) { el.textContent = ''; note.hidden = true; return; }
  const d = durCache.duration;
  el.textContent = `⏱ ${fmtDur(d)}${pending ? ' …' : ''}`;
  el.title = 'المدة الكلية للفيديو (مع الافتتاحية والفواصل)';
  el.classList.toggle('over', d > 60);
  const msgs = [];
  if (d > MAX_VIDEO_SECONDS) msgs.push(`المدة ${fmtDur(d)} — أطول من ٣ دقايق: التصدير في المتصفح هيبقى تقيل. استخدم «حزمة Filmora» أو «وضع السلسلة».`);
  else if (d > 90) msgs.push(`المدة ${fmtDur(d)} — للريلز اليومية الأحسن ٢٠–٦٠ ثانية. (ولو هدفك برنامج أرباح تيك توك، الفيديو لازم يبقى أطول من دقيقة.)`);
  note.hidden = !msgs.length;
  note.textContent = msgs.join(' ');
  fillBlockDurs();
  if (state.mediaList.length > 1) renderBgList();
}

function scheduleDuration() {
  clearTimeout(durTimer);
  const v = ++durVer;
  renderDuration(true);
  durTimer = setTimeout(async () => {
    if (state.busy) { durTimer = setTimeout(() => { if (v === durVer) scheduleDuration(); }, 3000); return; }
    try {
      const segs = await buildSegments(true, null);
      if (v !== durVer) return;
      const gap = Number(state.style.gap) || 0;
      const tl = buildTimeline(segs, { gap });
      const perBlock = new Map();
      segs.forEach((sg, j) => {
        if (sg.bi == null) return;
        const id = state.blocks[sg.bi]?.id;
        if (!id) return;
        const next = segs[j + 1];
        const span = (next ? next.start : sg.end) - sg.start;
        perBlock.set(id, (perBlock.get(id) || 0) + span);
      });
      durCache = { duration: tl.duration, segs: segs.map(sg => ({ kind: sg.kind, s: sg.s, a: sg.a, start: sg.start, end: sg.end, bi: sg.bi })), perBlock };
      renderDuration();
    } catch (e) {
      if (v !== durVer) return;
      durCache = null;
      $('#dur-total').textContent = '⏱ ؟';
      $('#dur-total').title = 'مش قادر أحسب المدة — التلاوات مش بتتحمّل (جرّب قارئ تاني أو اضبط الوسيط)';
    }
  }, 1200);
}

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
  fillBlockDurs();
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
  const el = name => li.querySelector(`[data-el=${name}]`);
  // ✂️ جزء من الآية: اضغط أول كلمة وبعدين آخر كلمة
  let pickEnd = false;
  const partUi = () => {
    const single = b.from === b.to && !b.rec;
    el('partRow').hidden = !single;
    const on = single && !!b.part;
    f('partOn').checked = on;
    el('partBox').hidden = !on;
    if (!on) { el('partInfo').textContent = ''; return; }
    const ws = WT.words(Q.ayahText(b.surah, b.from));
    const p = ayahPart(b) || { w1: 1, w2: ws.length };
    const box = el('partBox');
    box.innerHTML = '';
    ws.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = w;
      if (i + 1 >= p.w1 && i + 1 <= p.w2) btn.classList.add('sel');
      if (Q.WAQF_STOP.test(w)) { btn.classList.add('stop'); btn.title = 'علامة وقف — ينفع تقف هنا'; }
      if (Q.WAQF_NO.test(w)) btn.title = 'علامة «لا» — ماتقفش هنا';
      btn.onclick = () => {
        const k = i + 1;
        if (!pickEnd) { b.part = { w1: k, w2: k }; pickEnd = true; }
        else { b.part = { w1: Math.min(b.part.w1, k), w2: Math.max(b.part.w1, k) }; pickEnd = false; }
        partUi(); sync(); persist(); refreshPreview();
      };
      box.appendChild(btn);
    });
    const notes = [pickEnd ? '👆 دلوقتي اضغط آخر كلمة.' : 'اضغط أول كلمة وبعدين آخر كلمة. الكلمات اللي تحتها نقط عندها علامة وقف.'];
    if (!exactWords(findReciter(state.style.reciter))) notes.push('⚠️ القارئ الحالي مالوش توقيت كلمات — اختار قارئ عليه ⏱️ عشان القص يشتغل.');
    if (p.w2 < ws.length && Q.WAQF_NO.test(ws[p.w2 - 1])) notes.push('⛔ آخر كلمة عليها «لا» — ماينفعش تقف هنا.');
    else if (p.w2 < ws.length && !Q.WAQF_STOP.test(ws[p.w2 - 1])) notes.push('⚠️ آخر كلمة مش عند علامة وقف — اتأكد إن المعنى مكتمل.');
    if (p.w1 > 1 && !Q.WAQF_STOP.test(ws[p.w1 - 2])) notes.push('⚠️ البداية مش بعد علامة وقف — اتأكد إن المعنى مايتغيّرش.');
    el('partInfo').textContent = notes.join(' ');
  };
  f('partOn').onchange = () => {
    if (f('partOn').checked) { b.part = { w1: 1, w2: WT.words(Q.ayahText(b.surah, b.from)).length }; pickEnd = false; }
    else delete b.part;
    partUi(); sync(); persist(); refreshPreview();
  };
  const sync = () => {
    const s = Q.surah(b.surah);
    f('from').max = f('to').max = s.count;
    title.textContent = `${s.ar}: ${Q.arabicNum(b.from)}${b.to > b.from ? ' – ' + Q.arabicNum(b.to) : ''}${ayahPart(b) ? ' (جزء)' : ''}`;
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
    delete b.part;
    f('from').value = b.from; f('to').value = b.to;
    partUi(); sync(); persist(); refreshPreview();
  };
  const num = (name, after) => {
    f(name).oninput = () => {
      const s = Q.surah(b.surah);
      const old = b[name];
      b[name] = clamp(f(name).value, 1, name.startsWith('repeat') ? 20 : s.count);
      after?.();
      if ((name === 'from' || name === 'to') && old !== b[name]) { delete b.part; partUi(); }
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
  li.addEventListener('change', e => { if (e.target.dataset.f === 'recFile') setTimeout(partUi, 500); });
  li.querySelector('[data-act=follow]').onclick = () => openFollow(b);
  partUi();
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
      ? (b.rec.own ? `🎧 تلاوتك أنت (${b.rec.name}) — من «اقرا ورا الشيخ»` : `🎙️ تلاوة من ملف: ${b.rec.name || au.name}`)
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
  act('recAuto').onclick = () => {
    const au = hadithAudio.get(b.id);
    if (!b.rec || !au) return;
    const units = recUnits(b);
    if (units.length < 2) { status('آية واحدة بس — مش محتاجة توقيتات'); return; }
    const start = Math.max(0, Number(b.rec.start) || 0);
    const end = Math.min(au.buffer.duration, Number(b.rec.end) > start ? Number(b.rec.end) : au.buffer.duration);
    const { marks, pauses } = autoMarks(au.buffer, start, end, units.map(t => stripMarks(t).length + 6));
    if (!marks) {
      showError(new Error(`لقيت ${Q.arabicNum(pauses)} وقفة بس، والمطلوب ${Q.arabicNum(units.length - 1)}. اتأكد إن البداية والنهاية مظبوطين على الآيات اللي اخترتها، أو علّم بإيدك.`));
      return;
    }
    b.rec.marks = marks;
    changed();
    status(`🪄 حدّدت ${Q.arabicNum(marks.length)} بداية آية — اسمع المعاينة، ولو فيه آية مش في مكانها امسح وعلّم بإيدك`);
  };
  act('recMarksClear').onclick = () => { if (!b.rec) return; b.rec.marks = []; changed(); };
  act('recClear').onclick = () => {
    player.pause();
    delete b.rec;
    delete b.audioId; // تلاوتك بتفضل في 📚 مكتبة الأصوات
    hadithAudio.delete(b.id);
    li.querySelector('.custom-rec').open = false;
    changed();
  };
  sync();
  return sync;
}

// ===== 🎧 اقرا ورا الشيخ: صوت القارئ للتعلّم بس، والفيديو بيطلع بصوتك أنت =====
// كل آية: تسمع الشيخ ← تقرا أنت ← بيتسجّل. في الآخر التسجيلات بتتجمع كـ «تلاوة من ملف» بتوقيتات الآيات.
let follow = null;
function followUnits(b) {
  const s = Q.surah(b.surah);
  const from = clamp(b.from, 1, s.count), to = clamp(Math.max(b.to, from), from, s.count);
  const part = from === to && ayahPart(b);
  const u = b.basmala && b.surah !== 1 && b.surah !== 9 ? [{ s: 1, a: 1, text: Q.BASMALA }] : [];
  for (let a = from; a <= to; a++) {
    const ws = WT.words(Q.ayahText(b.surah, a));
    u.push({ s: b.surah, a, text: part ? ws.slice(part.w1 - 1, part.w2).join(' ') : ws.join(' '), part: !!part });
  }
  return u;
}

function openFollow(b) {
  const units = followUnits(b);
  if (units.length > 25 && !confirm(`المقطع ده ${Q.arabicNum(units.length)} آية — هتسجّلهم واحدة واحدة. الأسهل تقسّمه لكروت أصغر. تكمل؟`)) return;
  follow = { b, units, takes: units.map(() => null), i: 0, rec: null, player: null, reciter: findReciter(state.style.reciter) };
  $('#fl-name').value = getSettings().myName || '';
  renderFollow();
  flState('دوس «▶️ اسمع الشيخ» — ولما يخلص، اقرا أنت.');
  $('#dlg-follow').showModal();
}

const flState = msg => { $('#fl-state').textContent = msg; };

function flStopAudio() {
  const p = follow?.player;
  if (!p) return;
  p.onended = p.onerror = null;
  p.pause();
  follow.player = null;
}

function flBeep() {
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.12);
    o.onended = () => ac.close();
  } catch { /* مش مهم */ }
}

function flListen() {
  if (follow.rec) return;
  flStopAudio();
  const u = follow.units[follow.i];
  const urls = ayahAudioUrls(follow.reciter, u.s, u.a, Q.globalAyah(u.s, u.a));
  const p = new Audio();
  follow.player = p;
  let k = 0;
  const tryNext = () => {
    if (k >= urls.length) { follow.player = null; flState('⚠️ مقدرتش أشغّل صوت الشيخ (النت أو القارئ) — تقدر تسجّل من غير ما تسمع.'); return; }
    p.src = urls[k++];
    p.play().catch(() => {});
  };
  p.onerror = tryNext;
  p.onended = () => {
    follow.player = null;
    if ($('#fl-auto').checked) flRecord();
    else flState('دورك 🎙️ — دوس «🔴 سجّل» واقرا.');
  };
  flState(`🔊 الشيخ ${follow.reciter.name} بيقرا${u.part ? ' الآية كاملة — أنت اقرا الجزء المكتوب بس' : ''}…`);
  tryNext();
}

async function flRecord() {
  if (follow.rec) { await flStop(); return; }
  flStopAudio();
  flBeep();
  await new Promise(r => setTimeout(r, 250)); // عشان الصفارة ماتتسجلش
  try { follow.rec = await startRecording(); } catch {
    showError(new Error('المتصفح مش سامح بالمايك — اسمح له من علامة القفل 🔒 جنب العنوان، وجرّب تاني.'));
    return;
  }
  renderFollow();
  flState('🔴 بيسجّل… اقرا، ولما تخلص دوس «⏹ خلصت» (أو زرار المسافة).');
}

async function flStop() {
  const r = follow.rec;
  follow.rec = null;
  renderFollow();
  if (!r) return;
  const { buffer } = await r.stop();
  const t = trimSilence(buffer);
  const old = follow.takes[follow.i];
  if (old?.url) URL.revokeObjectURL(old.url);
  follow.takes[follow.i] = { buffer: t, url: URL.createObjectURL(bufferToWavBlob(t)) };
  const last = follow.i === follow.units.length - 1;
  flState(`✅ اتسجّلت (${t.duration.toFixed(1)} ث). اسمعها، ولو مش عاجباك سجّل تاني. ${last ? 'دي آخر واحدة — دوس «✅ استخدم تلاوتي».' : 'لو تمام دوس «التالية».'}`);
  renderFollow();
}

function flGo(d) {
  if (follow.rec) return;
  flStopAudio();
  follow.i = clamp(follow.i + d, 0, follow.units.length - 1);
  renderFollow();
  // في الوضع التلقائي: الآية الجديدة اللي لسه ماتسجّلتش بتبدأ بصوت الشيخ على طول
  if ($('#fl-auto').checked && !follow.takes[follow.i]) flListen();
  else flState(follow.takes[follow.i] ? 'الآية دي متسجّلة — تقدر تسمعها أو تسجّلها تاني.' : 'دوس «▶️ اسمع الشيخ».');
}

function renderFollow() {
  const { units, takes, i } = follow;
  const u = units[i];
  $('#fl-step').textContent = `${i + 1} من ${units.length} • ${u.s === 1 && u.a === 1 && u.text === Q.BASMALA ? 'البسملة' : `سورة ${Q.surah(u.s).ar} • الآية ${Q.arabicNum(u.a)}${u.part ? ' (جزء)' : ''}`}`;
  $('#fl-text').textContent = u.text;
  $('#fl-rec').textContent = follow.rec ? '⏹ خلصت' : takes[i] ? '🔴 سجّل تاني' : '🔴 سجّل';
  $('#fl-rec').classList.toggle('danger', !!follow.rec);
  $('#fl-listen').disabled = !!follow.rec;
  $('#fl-play').hidden = !takes[i] || !!follow.rec;
  $('#fl-prev').disabled = i === 0 || !!follow.rec;
  $('#fl-next').disabled = i === units.length - 1 || !!follow.rec;
  const n = takes.filter(Boolean).length;
  $('#fl-done').disabled = n < units.length || !!follow.rec;
  $('#fl-done').textContent = n < units.length ? `✅ استخدم تلاوتي (${n} من ${units.length})` : '✅ استخدم تلاوتي في الفيديو';
  const dots = $('#fl-dots');
  dots.innerHTML = '';
  units.forEach((_, k) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'fl-dot' + (takes[k] ? ' ok' : '') + (k === i ? ' cur' : '');
    d.textContent = k + 1;
    d.onclick = () => flGo(k - follow.i);
    dots.appendChild(d);
  });
}

// تجميع التسجيلات في ملف واحد بسكتة قصيرة بين الآيات، والتوقيتات في نص السكتة
async function flDone() {
  const { b, units, takes } = follow;
  if (takes.some(t => !t)) return;
  const rate = takes[0].buffer.sampleRate, gap = Math.round(0.35 * rate);
  const total = takes.reduce((x, t) => x + t.buffer.length, 0) + gap * (takes.length - 1);
  const out = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: rate });
  const data = out.getChannelData(0), marks = [];
  let pos = 0;
  takes.forEach((t, k) => {
    if (k) { marks.push((pos + gap / 2) / rate); pos += gap; }
    const src = t.buffer.getChannelData(0);
    data.set(src.subarray(0, Math.min(src.length, total - pos)), pos);
    pos += src.length;
  });
  const name = $('#fl-name').value.trim();
  setSettings({ myName: name });
  const blob = bufferToWavBlob(out);
  setHadithAudio(b, out, 'تلاوتي', blob, 'record');
  b.rec = { name: name || 'تلاوتي', file: 'تسجيلي', own: true, start: 0, end: out.duration, marks };
  b.audioId = await AL.addClip({ name: 'تلاوتي', kind: 'record', text: units.map(u => u.text).join(' '), voice: '', dur: out.duration, blob });
  $('#dlg-follow').close();
  persist();
  renderBlocks();
  refreshPublish(true);
  refreshPreview();
  status(`✅ الكارت ده بقى بصوتك أنت (${fmtDur(out.duration)}) — صوت الشيخ مش داخل في الفيديو خالص. اسمع المعاينة.`);
}

function setupFollow() {
  const dlg = $('#dlg-follow');
  $('#fl-listen').onclick = flListen;
  $('#fl-rec').onclick = flRecord;
  $('#fl-play').onclick = () => {
    const t = follow.takes[follow.i];
    if (!t) return;
    flStopAudio();
    const p = new Audio(t.url);
    follow.player = p;
    p.play().catch(() => {});
  };
  $('#fl-prev').onclick = () => flGo(-1);
  $('#fl-next').onclick = () => flGo(1);
  $('#fl-done').onclick = () => flDone().catch(showError);
  $('#fl-close').onclick = () => dlg.close();
  dlg.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.target.matches('input, textarea')) return;
    e.preventDefault();
    document.activeElement?.blur?.(); // عشان المسافة ماتدوسش الزرار اللي عليه الفوكس كمان
    flRecord();
  });
  dlg.onclose = async () => {
    if (!follow) return;
    flStopAudio();
    if (follow.rec) { const r = follow.rec; follow.rec = null; await r.stop().catch(() => {}); }
    follow.takes.forEach(t => t?.url && URL.revokeObjectURL(t.url));
    follow = null;
  };
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
    el('audioTools').hidden = !au;
    act('regen').hidden = !['ai', 'gtts'].includes(au?.kind);
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

// ===== أصوات ElevenLabs (بتتحفظ عشان القايمة تظهر على طول) =====
let elVoices = load('elVoices', []);
let elLoading = null;
function fillVoiceSelect(sel, value) {
  const def = getSettings().elevenVoiceId;
  const defName = elVoices.find(v => v.id === def)?.name;
  const cloned = elVoices.filter(v => v.category === 'cloned' || v.category === 'professional' || v.category === 'generated');
  const other = elVoices.filter(v => !cloned.includes(v));
  const opt = v => `<option value="${v.id}">${v.category === 'cloned' || v.category === 'professional' ? '🎙️ ' : ''}${escapeHtml(v.name)}</option>`;
  sel.innerHTML = `<option value="">${def ? `الافتراضي${defName ? `: ${escapeHtml(defName)}` : ' (من الإعدادات)'}` : '— اختار صوت —'}</option>`
    + (cloned.length ? `<optgroup label="أصواتي">${cloned.map(opt).join('')}</optgroup>` : '')
    + (other.length ? `<optgroup label="أصوات ElevenLabs">${other.map(opt).join('')}</optgroup>` : '')
    + '<option value="__add">＋ أضف صوت برقمه (Voice ID)…</option>';
  sel.value = elVoices.some(v => v.id === value) ? value : '';
  sel.hidden = !EL.hasKey();
}
// لو المفتاح مالوش صلاحية قراءة الأصوات: تضيف الصوت برقمه من موقع ElevenLabs
function addVoiceManually() {
  const id = (prompt('الصق رقم الصوت (Voice ID) من ElevenLabs:\n(من Voices ← اختار الصوت ← ⋯ ← Copy voice ID)') || '').trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) { if (id) alert('الرقم ده مش شكل Voice ID'); return null; }
  const name = (prompt('اسم للصوت ده (يظهر في القايمة):', 'صوتي') || 'صوتي').trim();
  const v = { id, name, category: 'cloned', preview: '', manual: true };
  elVoices = [v, ...elVoices.filter(x => x.id !== id)];
  save('elVoices', elVoices);
  document.querySelectorAll('[data-f=elVoice]').forEach(sel => { const cur = sel.value === '__add' ? '' : sel.value; fillVoiceSelect(sel, cur); });
  status(`✅ اتضاف «${name}» لقايمة الأصوات`);
  return v;
}

async function refreshVoices(btn, quiet = false) {
  if (!EL.hasKey()) { if (!quiet) alert('حط مفتاح ElevenLabs الأول من ⚙️ الإعدادات ← ElevenLabs.'); return; }
  if (elLoading) return elLoading;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  elLoading = (async () => {
    try {
      const fetched = await EL.listVoices();
      elVoices = [...fetched, ...elVoices.filter(v => v.manual && !fetched.some(x => x.id === v.id))];
      save('elVoices', elVoices);
      document.querySelectorAll('[data-f=elVoice]').forEach(sel => {
        const li = sel.closest('li');
        const blk = state.blocks.find(x => x.id === li?.dataset.id);
        fillVoiceSelect(sel, blk?.elVoice || sel.value);
      });
      if (!quiet) status(`✅ اتجابت ${Q.arabicNum(elVoices.length)} صوت من حسابك`);
    } catch (e) {
      if (/voices_read|missing the permission/i.test(e.message)) {
        if (!quiet) alert('مفتاح ElevenLabs ده مالوش صلاحية «قراءة الأصوات».\n\nالحل (دقيقة):\nElevenLabs ← Developers ← API Keys ← عدّل المفتاح (أو اعمل مفتاح جديد) ← فعّل:\n• Voices: Read\n• Text to Speech: Access\nوبعدين حط المفتاح في ⚙️ الإعدادات واضغط ↻.\n\nأو من غير ما تغيّر المفتاح: اختار «＋ أضف صوت برقمه» من القايمة والصق الـ Voice ID.');
      } else if (!quiet) showError(e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻'; }
      elLoading = null;
    }
  })();
  return elLoading;
}

// أزرار الصوت المشتركة (حديث أو ذكر): من غير صوت / تسجيل / ملف / ElevenLabs
function wireAudioControls(li, b, sync) {
  li.dataset.id = b.id;
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
    setHadithAudio(b, res.buffer, 'تسجيل', res.blob, 'record');
    b.audioMode = 'record';
    li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'record'; });
    sync(); persist();
    libSave(b, 'record', res.blob, res.buffer, 'تسجيل');
  };
  // اختيار الصوت من أصواتك في ElevenLabs (لكل مقطع لوحده)
  fillVoiceSelect(f('elVoice'), b.elVoice || '');
  f('elVoice').onchange = () => {
    if (f('elVoice').value === '__add') {
      const v = addVoiceManually();
      fillVoiceSelect(f('elVoice'), v ? v.id : b.elVoice || '');
      if (!v) return;
    }
    b.elVoice = f('elVoice').value; persist();
  };
  act('elVoices').onclick = () => refreshVoices(act('elVoices'));
  let sample = null;
  act('elPreview').onclick = () => {
    const id = f('elVoice').value || getSettings().elevenVoiceId;
    const v = elVoices.find(x => x.id === id);
    if (sample) { sample.pause(); sample = null; return; }
    if (!v?.preview) { alert(v ? 'الصوت ده مالوش عينة جاهزة في ElevenLabs — ولّد جملة قصيرة وجرّبه.' : 'اضغط ↻ الأول عشان أجيب أصواتك.'); return; }
    sample = new Audio(v.preview);
    sample.onended = () => { sample = null; };
    sample.play().catch(() => { sample = null; });
  };
  if (EL.hasKey() && !elVoices.length) refreshVoices(null, true);
  // قراءة بصوتك عن طريق ElevenLabs
  const useAudio = (kind, buffer, name, blob, id, msg) => {
    setHadithAudio(b, buffer, name, blob, kind);
    b.audioMode = kind;
    b.audioId = id;
    li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === b.audioMode; });
    sync(); persist(); refreshPublish(true);
    el('audio-preview').hidden = false;
    el('audio-preview').play().catch(() => {});
    if (msg) status(msg);
  };
  // 🎭 أداء الصوت: المشاعر والثبات والسرعة (لـ ElevenLabs و Gemini)
  f('emo').innerHTML = EMOTIONS.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  f('emo').value = b.emo || '';
  f('perfStab').value = b.perfStab ?? '';
  f('perfSpeed').value = b.perfSpeed ?? 1;
  f('perfStyle').value = b.perfStyle ?? 0;
  const perfLabel = () => { el('perfInfo').textContent = `السرعة ${(+f('perfSpeed').value).toFixed(2)}× • التعبير ${Math.round(f('perfStyle').value * 100)}%${b.emo ? ' • في ElevenLabs المشاعر بتستخدم موديل Eleven v3' : ''}`; };
  f('emo').onchange = () => { b.emo = f('emo').value; persist(); perfLabel(); };
  f('perfStab').onchange = () => { b.perfStab = f('perfStab').value === '' ? undefined : +f('perfStab').value; persist(); };
  f('perfSpeed').oninput = () => { b.perfSpeed = +f('perfSpeed').value; persist(); perfLabel(); };
  f('perfStyle').oninput = () => { b.perfStyle = +f('perfStyle').value; persist(); perfLabel(); };
  perfLabel();
  const perfOf = () => ({ emotion: b.emo || '', stability: b.perfStab, speed: b.perfSpeed ?? 1, style: b.perfStyle ?? 0 });
  // صوت اتولّد قبل كده لنفس النص بنفس الصوت: نستخدمه بدل ما نولّد تاني (من غير رصيد)
  const reuse = async (kind, text, voice) => {
    const c = await AL.findSame(kind, text, voice);
    const full = c && await AL.getClip(c.id);
    if (!full) return false;
    const buffer = await decode(await full.blob.arrayBuffer());
    useAudio(kind, trimSilence(buffer), kind === 'gtts' ? 'Gemini' : 'ElevenLabs', full.blob, full.id, '♻️ الصوت ده اتولّد قبل كده لنفس النص — استخدمته من المكتبة (من غير ما يتخصم حاجة). عايز نسخة جديدة؟ اضغط «🔁 ولّد تاني».');
    return true;
  };
  act('ai').onclick = async e => {
    const force = e?.detail === 'force';
    const voiceId = f('elVoice').value || getSettings().elevenVoiceId;
    if (!EL.hasKey() || !voiceId) {
      alert(EL.hasKey() ? 'اختار صوت من القايمة (أو اضغط ↻ عشان أجيب أصواتك).' : 'حط مفتاح ElevenLabs الأول من ⚙️ الإعدادات ← ElevenLabs.');
      return;
    }
    const text = EL.prepareText(b.text || '');
    if (text.length < 3) { alert('اكتب النص الأول.'); return; }
    const perf = perfOf();
    const perfKey = `${voiceId}|${b.emo || ''}|${perf.stability ?? ''}|${perf.speed}|${perf.style}`;
    if (!force && await reuse('ai', text, perfKey)) return;
    if (!confirm(`هيتبعت ${text.length} حرف لـ ElevenLabs، وده هيتخصم من رصيدك هناك (تقريبًا حرف = كريديت).\n\nبعد التوليد لازم تسمع الصوت كله وتتأكد من النطق والتشكيل.\nتكمل؟`)) return;
    const btn = act('ai');
    btn.disabled = true; btn.textContent = '⏳ بيولّد…';
    try {
      const blob = await EL.speak(text, voiceId, perf);
      const buffer = await decode(await blob.arrayBuffer());
      const id = await AL.addClip({ name: `ElevenLabs — ${elVoices.find(v => v.id === voiceId)?.name || 'صوتي'}${b.emo ? ' — ' + emotion(b.emo).name : ''}`, kind: 'ai', text, voice: perfKey, dur: buffer.duration, blob });
      useAudio('ai', trimSilence(buffer), 'ElevenLabs', blob, id, '✅ الصوت اتولّد واتحفظ في 📚 المكتبة. اسمعه كله وراجع النطق والتشكيل قبل التصدير. ولو فيه غلط، عدّل النص وولّد تاني.');
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false; btn.textContent = '🤖 ولّد بصوتي';
    }
  };
  // قراءة بصوت Gemini (مجاني بمفتاح من مشروع من غير حساب دفع)
  f('gVoice').innerHTML = `<option value="">الافتراضي (من الإعدادات)</option>` + GT.VOICES.map(v => `<option value="${v.id}">${v.id} — ${v.desc}</option>`).join('');
  f('gVoice').value = b.gVoice || '';
  f('gVoice').onchange = () => { b.gVoice = f('gVoice').value; persist(); };
  act('gtts').onclick = async e => {
    const force = e?.detail === 'force';
    const text = EL.prepareText(b.text || '');
    if (text.length < 3) { alert('اكتب النص الأول.'); return; }
    const voice = b.gVoice || getSettings().gttsVoice || 'Charon';
    const gKey = b.emo ? `${voice}|${b.emo}` : voice;
    if (!force && await reuse('gtts', text, gKey)) return;
    if (!GT.hasKey()) { alert('حط مفتاح Gemini الأول من ⚙️ الإعدادات ← 🔊 صوت Gemini.'); return; }
    const btn = act('gtts');
    btn.disabled = true; btn.textContent = '⏳ بيولّد…';
    try {
      const blob = await GT.speak(text, b.gVoice, emotion(b.emo).say || '');
      const buffer = await decode(await blob.arrayBuffer());
      const id = await AL.addClip({ name: `Gemini — ${voice}${b.emo ? ' — ' + emotion(b.emo).name : ''}`, kind: 'gtts', text, voice: gKey, dur: buffer.duration, blob });
      useAudio('gtts', trimSilence(buffer), 'Gemini', blob, id, '✅ الصوت اتولّد واتحفظ في 📚 المكتبة. اسمعه كله وراجع النطق والتشكيل قبل التصدير. ولو فيه غلط، عدّل النص أو جرّب صوت تاني.');
    } catch (e) {
      showError(e);
    } finally {
      btn.disabled = false; btn.textContent = '🆓 ولّد بصوت Gemini';
    }
  };
  // أدوات الصوت الجاهز: ولّد تاني (بنفس المزوّد) أو احذف
  act('regen').onclick = () => {
    const kind = hadithAudio.get(b.id)?.kind;
    // detail = 'force': ولّد نسخة جديدة فعلًا (مش من المكتبة)
    if (kind === 'gtts') act('gtts').onclick({ detail: 'force' });
    else if (kind === 'ai') act('ai').onclick({ detail: 'force' });
  };
  act('audioDel').onclick = () => {
    if (!confirm('تحذف الصوت ده؟')) return;
    const au = hadithAudio.get(b.id);
    if (au?.url) URL.revokeObjectURL(au.url);
    hadithAudio.delete(b.id);
    delete b.audioId; // الصوت بيفضل في 📚 المكتبة لو احتجته تاني
    el('audio-preview').pause();
    el('audio-preview').removeAttribute('src');
    b.audioMode = 'none';
    li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'none'; });
    sync(); persist(); refreshPublish(true); refreshPreview();
    status('🗑️ الصوت اتحذف — المقطع هيظهر بالمدة المكتوبة.');
  };
  act('audioLib').onclick = () => openAudioLib(b, useAudio);
  f('audioFile').onchange = async () => {
    const file = f('audioFile').files[0];
    if (!file) return;
    try {
      const buffer = await decode(await file.arrayBuffer());
      setHadithAudio(b, buffer, file.name, file, 'upload');
      b.audioMode = 'upload';
      li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.checked = r.value === 'upload'; });
      sync(); persist();
      libSave(b, 'upload', file, buffer, file.name);
    } catch (e) {
      showError(new Error('الملف ده مش ملف صوت مدعوم'));
    }
  };

}

// بيحفظ صوت المقطع في 📚 المكتبة، والمقطع بيفتكر رقمه (عشان يرجع بعد Refresh)
async function libSave(b, kind, blob, buffer, name) {
  b.audioId = await AL.addClip({ name, kind, text: b.text || '', voice: '', dur: buffer.duration, blob });
  persist();
}

// الأصوات اللي اتحفظت للمقاطع بترجع لوحدها بعد ما الصفحة تتفتح تاني
async function restoreBlockAudio() {
  let n = 0;
  for (const b of state.blocks) {
    if (!b.audioId || hadithAudio.has(b.id)) continue;
    const c = await AL.getClip(b.audioId);
    if (!c) continue;
    try {
      const buf = await decode(await c.blob.arrayBuffer());
      setHadithAudio(b, c.kind === 'ai' || c.kind === 'gtts' ? trimSilence(buf) : buf, c.kind === 'gtts' ? 'Gemini' : c.kind === 'ai' ? 'ElevenLabs' : c.name, c.blob, c.kind);
      n++;
    } catch { /* ملف بايظ */ }
  }
  if (n) { renderBlocks(); refreshPreview(); }
}

// 📚 مكتبة الأصوات: اختار صوت اتعمل قبل كده للمقطع ده
const KIND_ICON = { gtts: '🆓 Gemini', ai: '🤖 ElevenLabs', record: '🎙️ تسجيل', upload: '📁 ملف' };
let libPlayer = null;
async function openAudioLib(b, useAudio) {
  const dlg = $('#dlg-audiolib');
  const all = await AL.listClips();
  const key = AL.textKey(b.text);
  const draw = () => {
    const q = AL.textKey($('#al-search').value);
    const ol = $('#al-list');
    ol.innerHTML = '';
    const items = all.filter(c => !q || c.key.includes(q) || (c.name || '').includes(q))
      .sort((x, y) => (y.key === key) - (x.key === key) || y.date - x.date);
    $('#al-empty').hidden = items.length > 0;
    $('#al-count').textContent = `${Q.arabicNum(all.length)} صوت — ${(all.reduce((a, c) => a + (c.size || 0), 0) / 1048576).toFixed(1)} MB`;
    for (const c of items) {
      const li = document.createElement('li');
      li.className = 'part';
      li.innerHTML = `<button class="btn icon" type="button" data-a="play" title="اسمع">▶</button>
        <span class="pname"></span><span class="pinfo"></span>
        <button class="btn" type="button" data-a="use">استخدمه</button>
        <button class="btn icon" type="button" data-a="del" title="امسحه من المكتبة">🗑</button>`;
      li.querySelector('.pname').textContent = `${c.key === key ? '✅ ' : ''}${KIND_ICON[c.kind] || ''}${c.voice && c.kind === 'gtts' ? ` (${c.voice})` : ''}`;
      li.querySelector('.pinfo').textContent = `${(c.text || c.name || '').slice(0, 70)}${(c.text || '').length > 70 ? '…' : ''} • ${fmtDur(c.dur || 0)} • ${((c.size || 0) / 1024).toFixed(0)} KB • ${new Date(c.date).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}`;
      li.querySelector('[data-a=play]').onclick = async () => {
        if (libPlayer) { libPlayer.pause(); URL.revokeObjectURL(libPlayer.src); libPlayer = null; }
        const full = await AL.getClip(c.id);
        if (!full) return;
        libPlayer = new Audio(URL.createObjectURL(full.blob));
        libPlayer.play().catch(() => {});
      };
      li.querySelector('[data-a=use]').onclick = async () => {
        const full = await AL.getClip(c.id);
        if (!full) return;
        const buf = await decode(await full.blob.arrayBuffer());
        const ai = c.kind === 'ai' || c.kind === 'gtts';
        useAudio(c.kind, ai ? trimSilence(buf) : buf, c.kind === 'gtts' ? 'Gemini' : c.kind === 'ai' ? 'ElevenLabs' : c.name, full.blob, c.id,
          `✅ اتحط الصوت من المكتبة${c.key !== key ? ' — ⚠️ النص بتاعه مختلف عن نص المقطع، اتأكد إنه مطابق' : ''}.`);
        dlg.close();
      };
      li.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm('تمسح الصوت ده من المكتبة نهائيًا؟')) return;
        await AL.deleteClip(c.id);
        all.splice(all.indexOf(c), 1);
        draw();
      };
      ol.appendChild(li);
    }
  };
  $('#al-search').value = '';
  $('#al-search').oninput = draw;
  $('#al-close').onclick = () => dlg.close();
  dlg.onclose = () => { if (libPlayer) { libPlayer.pause(); libPlayer = null; } };
  draw();
  dlg.showModal();
}

// kind: 'ai' (ElevenLabs) أو 'gtts' (Gemini) أو 'record' أو 'upload' — عشان «ولّد تاني» يعرف يولّد بإيه
function setHadithAudio(b, buffer, name, blob, kind = '') {
  const old = hadithAudio.get(b.id);
  if (old?.url) URL.revokeObjectURL(old.url);
  hadithAudio.set(b.id, { buffer, name, url: URL.createObjectURL(blob), kind });
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

// رابط ← نص: صورة مباشرة، أو صفحة فيها صورة رئيسية (og:image زي بنترست)، أو صفحة فيها النص نفسه
async function readFromUrl(url) {
  let blob;
  try { blob = await fetchFirst([url], { as: 'blob' }); } catch {
    throw new Error('الموقع ده مش بيسمح للبرنامج يفتحه (CORS).\nالأسهل: افتح الصورة ← كليك يمين ← Copy image ← والصقها في خانة النص بـ Ctrl+V. أو احفظها وارفعها بـ «📷 من صورة».\n(أو اضبط «رابط الوسيط» في الإعدادات.)');
  }
  if (blob.type.startsWith('image/')) return LLM.readImage(blob);
  const html = await blob.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]')?.content;
  if (og) {
    try {
      const img = await fetchFirst([new URL(og, url).href], { as: 'blob' });
      if (img.type.startsWith('image/')) return LLM.readImage(img);
    } catch { /* نكمّل بنص الصفحة */ }
  }
  doc.querySelectorAll('script, style, noscript, nav, header, footer').forEach(n => n.remove());
  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) throw new Error('مالقيتش صورة ولا نص في الرابط ده. جرّب تنسخ الصورة وتلصقها بـ Ctrl+V.');
  return LLM.readPageText(text);
}

// نص خاص: دعاء أو كلام من عند المستخدم مش موجود في المكتبة — نفس كتلة الذكر (صوت ومدة) من غير مكتبة
function newCustomBlock() {
  return { id: uid(), type: 'zikr', custom: true, cat: '', index: 0, label: 'دعاء', text: '', count: 1, ref: '', desc: '', showCount: false, audioMode: 'none', seconds: 8, secondsManual: false, enhance: 'clean' };
}

function fillZikr(b) {
  if (b.custom) return;
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
  const act = name => li.querySelector(`[data-act=${name}]`);
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
  if (b.custom) {
    el('libRow').hidden = true;
    el('customRow').hidden = false;
    el('customTools').hidden = false;
    el('badge').textContent = 'نص خاص';
    el('textHint').textContent = '(اكتب الدعاء أو الكلام بتاعك)';
    f('customLabel').value = b.label || '';
    f('customRef').value = b.ref || '';
    f('text').placeholder = 'اكتب النص هنا…';
    f('customLabel').oninput = () => { b.label = f('customLabel').value.trim(); sync(); persist(); refreshPreview(); };
    f('customRef').oninput = () => { b.ref = f('customRef').value.trim(); persist(); refreshPreview(); };
    // الزرار بيقول «ضيف صورة تانية» لما يبقى فيه نص، عشان يبان إن الجديد بيتضاف تحت
    const ocrLabel = () => { el('ocrLabel').textContent = f('text').value.trim() ? '📷 ＋ ضيف من صورة تانية' : '📷 من صورة'; };
    ocrLabel();
    f('text').addEventListener('input', ocrLabel);
    // استخلاص النص من صورة أو رابط (بدل الكتابة)
    // النص بيتحط في الخانة على طول (من غير نافذة تأكيد) — والتنبيهات في شريط الحالة
    const useExtract = r => {
      const old = b.text.trim();
      b.text = old ? `${old}\n\n${r.text}` : r.text; // لو فيه نص قبل كده، الجديد بيتضاف تحته
      f('text').value = b.text;
      if (r.title && (!b.label || b.label === 'دعاء')) { b.label = r.title.slice(0, 40); f('customLabel').value = b.label; }
      if (r.source && !b.ref) { b.ref = r.source.slice(0, 60); f('customRef').value = b.ref; }
      if (!b.secondsManual) { b.seconds = estimateSeconds(b.text); f('seconds').value = b.seconds; }
      sync(); persist(); refreshPreview();
      checkFragment();
      ocrLabel();
      f('text').focus();
      const warn = r.kind === 'quran' ? ' ⚠️ ده شكله آيات — الأفضل «＋ آيات» عشان النص يبقى من المصحف بالظبط.'
        : r.kind === 'hadith' ? ' ⚠️ ده شكله حديث — الأفضل «＋ حديث» عشان درجته تظهر.' : '';
      const unclear = r.text.includes('[؟]') ? ' فيه كلمات مش واضحة مكانها [؟] — صلّحها.' : '';
      status(`✅ النص اتحط في الخانة${old ? ' (تحت النص اللي كان موجود)' : ''}. راجعه وعدّل براحتك.${unclear}${warn}`, null, !!(warn || unclear));
    };
    const extract = async (job, btn) => {
      if (!LLM.canRead()) { needLLM(); return; }
      const prev = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = '⏳ بيقرا…'; }
      status('بيقرا النص…');
      try { useExtract(await job()); status(''); } catch (err) { showError(err); }
      if (btn) { btn.disabled = false; btn.textContent = prev; }
    };
    // كذا صورة مرة واحدة: كل صورة بتتقري وتتضاف تحت اللي قبلها بالترتيب
    f('ocrFile').onchange = async () => {
      const files = [...f('ocrFile').files];
      f('ocrFile').value = '';
      for (const [i, file] of files.entries()) {
        if (files.length > 1) status(`بيقرا صورة ${i + 1} من ${files.length}…`);
        await extract(() => LLM.readImage(file));
      }
    };
    f('text').addEventListener('paste', e => {
      const file = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      extract(() => LLM.readImage(file));
    });
    act('ocrUrl').onclick = e => {
      const url = (prompt('الصق رابط الصورة أو الصفحة اللي فيها الدعاء:') || '').trim();
      if (!/^https?:\/\//i.test(url)) { if (url) alert('ده مش رابط'); return; }
      extract(() => readFromUrl(url), e.currentTarget);
    };
    li.querySelector('[data-act=polish]').onclick = async e => {
      const btn = e.currentTarget;
      if (!b.text.trim()) { status('اكتب النص الأول'); return; }
      if (!LLM.isReady()) { needLLM(); return; }
      const prev = btn.textContent;
      btn.disabled = true; btn.textContent = '…';
      try {
        const out = await LLM.polishText(b.text);
        if (confirm(`النص بعد التحسين:\n\n${out}\n\nأستخدمه بدل النص الحالي؟`)) {
          b.text = out; f('text').value = out;
          if (!b.secondsManual) { b.seconds = estimateSeconds(out); f('seconds').value = b.seconds; }
          persist(); refreshPreview();
        }
      } catch (err) { showError(err); }
      btn.disabled = false; btn.textContent = prev;
    };
  }
  const sync = () => {
    li.querySelector('.block-title').textContent = b.custom ? (b.label || 'نص خاص') : b.cat;
    el('meta').textContent = [b.ref && `📖 ${b.ref}`, b.count > 1 && `🔁 ${b.count} مرات`, b.desc && `💡 ${b.desc}`].filter(Boolean).join('  •  ');
    const au = hadithAudio.get(b.id);
    el('audio-name').textContent = au ? `${au.name} (${au.buffer.duration.toFixed(1)} ث)` : '';
    el('audio-preview').hidden = !au?.url;
    el('audioTools').hidden = !au;
    act('regen').hidden = !['ai', 'gtts'].includes(au?.kind);
    if (au?.url && el('audio-preview').src !== au.url) el('audio-preview').src = au.url;
  };
  fillItems();
  f('text').value = b.text;
  f('showCount').checked = b.showCount;
  f('seconds').value = b.seconds;
  li.querySelectorAll('[data-f=audioMode]').forEach(r => { r.name = 'am-' + b.id; r.checked = r.value === b.audioMode; });
  f('cat').onchange = () => { b.cat = f('cat').value; b.index = 0; fillZikr(b); fillItems(); f('text').value = b.text; f('seconds').value = b.seconds; sync(); persist(); refreshPreview(); };
  f('item').onchange = () => { b.index = Number(f('item').value); fillZikr(b); f('text').value = b.text; f('seconds').value = b.seconds; sync(); persist(); refreshPreview(); };
  f('text').oninput = () => {
    b.text = f('text').value;
    // النص الخاص: المدة بتتظبط لوحدها على طول النص لحد ما المستخدم يغيّرها بإيده
    if (b.custom && !b.secondsManual) { b.seconds = estimateSeconds(b.text); f('seconds').value = b.seconds; }
    persist(); refreshPreview();
    if (b.custom) checkFragment();
  };
  // النص الخاص لو فيه آيات أو أجزاء من آيات (حتى كذا واحدة، زي صور «ربنا…»): نعرض «اقراها بصوت القارئ»
  let fragTimer = null, frags = [], fragRest = 0;
  function checkFragment() {
    clearTimeout(fragTimer);
    fragTimer = setTimeout(() => {
      const r = b.custom ? Q.findFragments(b.text) : { frags: [], rest: 0 };
      frags = r.frags;
      fragRest = r.rest;
      el('fragRow').hidden = !frags.length;
      if (!frags.length) return;
      const ref = x => `${Q.surah(x.s).ar} ${Q.arabicNum(x.a)}`;
      if (frags.length === 1) {
        const x = frags[0], ws = WT.words(Q.ayahText(x.s, x.a));
        el('fragText').textContent = x.whole ? `📖 فيه آية كاملة: سورة ${Q.surah(x.s).ar} • الآية ${Q.arabicNum(x.a)}`
          : `📖 فيه جزء من سورة ${Q.surah(x.s).ar} • الآية ${Q.arabicNum(x.a)} (من «${ws[x.w1 - 1]}» لـ «${ws[x.w2 - 1]}»)`;
      } else {
        el('fragText').textContent = `📖 لقيت ${Q.arabicNum(frags.length)} مقاطع من القرآن: ${frags.map(ref).join('، ')}`;
      }
      if (fragRest > 2) el('fragText').textContent += ' — وفيه كلام تاني مش من القرآن هيفضل في الكارت ده';
      act('fragUse').textContent = frags.length > 1 ? `📖 اقراهم بصوت القارئ (${Q.arabicNum(frags.length)} كروت)` : '📖 اقراها بصوت القارئ';
    }, 350);
  }
  act('fragUse').onclick = () => {
    if (!frags.length) return;
    const i = state.blocks.indexOf(b);
    if (i < 0) return;
    const qs = frags.map(x => {
      const q = newQuranBlock(x.s, x.a, x.a);
      if (!x.whole) q.part = { w1: x.w1, w2: x.w2 };
      return q;
    });
    // لو فيه كلام تاني مش قرآن (عنوان، دعاء عادي) بنسيب الكارت ده بعد الآيات عشان تراجعه
    const keep = fragRest > 2;
    state.blocks.splice(i, keep ? 0 : 1, ...qs);
    if (!keep) hadithAudio.delete(b.id);
    renderBlocks();
    refreshPublish(true);
    const r = findReciter(state.style.reciter);
    const parts = frags.some(x => !x.whole);
    status(`✅ اتعمل ${Q.arabicNum(qs.length)} ${qs.length > 1 ? 'كروت آيات' : 'كارت آيات'} بنص المصحف بصوت ${r.name}.${keep ? ' الكارت الخاص فضل تحتهم فيه الكلام التاني — راجعه أو امسحه.' : ''}${parts && !exactWords(r) ? ' ⚠️ القارئ ده مالوش توقيت كلمات — اختار قارئ عليه ⏱️ عشان الأجزاء تتقص صح.' : ''}`);
  };
  if (b.custom) checkFragment();
  f('showCount').onchange = () => { b.showCount = f('showCount').checked; persist(); refreshPreview(); };
  f('seconds').oninput = () => { b.seconds = clamp(f('seconds').value, 2, 120); b.secondsManual = true; persist(); };
  wireAudioControls(li, b, sync);
  sync();
  return li;
}

// ===== مساعد الكتابة (LLM اختياري) =====
function needLLM() {
  status('✨ مساعد الكتابة محتاج مفتاح: ⚙️ الإعدادات ← «مساعد الكتابة»');
  $('#btn-settings')?.click();
  const d = $('#set-llm-provider')?.closest('details');
  if (d) d.open = true;
}

// ملخص محتوى الفيديو للمساعد (للفهم بس — بنقوله ماينقلش منه)
function contentSummary() {
  const lines = [];
  for (const b of state.blocks) {
    if (b.type === 'quran') {
      const s = Q.surah(b.surah);
      const ayat = [];
      for (let a = b.from; a <= Math.min(b.to, b.from + 6); a++) ayat.push(Q.ayahText(b.surah, a));
      lines.push(`آيات من سورة ${s.ar} (${b.from}–${b.to}): ${ayat.join(' ')}`);
    } else if (b.type === 'zikr') {
      lines.push(`${b.custom ? (b.label || 'دعاء') : b.cat}: ${String(b.text || '').slice(0, 400)}`);
    } else {
      lines.push(`حديث (${collection(b.col)?.name || b.col}): ${String(b.text || '').slice(0, 400)}`);
    }
  }
  const rec = state.blocks.find(b => b.rec?.name)?.rec.name || findReciter(state.style.reciter).name;
  if (state.blocks.some(b => b.type === 'quran')) lines.push(`القارئ: ${rec}`);
  return lines.join('\n') || 'فيديو قرآن قصير';
}

function setupLLM() {
  const box = $('#ai-hooks-list');
  $('#ai-hooks').onclick = async () => {
    if (!LLM.isReady()) { needLLM(); return; }
    const btn = $('#ai-hooks');
    btn.disabled = true; $('#ai-hooks-status').textContent = 'بيفكّر…';
    try {
      const hooks = await LLM.suggestHooks({ summary: contentSummary() });
      box.innerHTML = '';
      for (const h of hooks) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'chip'; c.textContent = h;
        c.onclick = () => { $('#intro').value = h; $('#intro').dispatchEvent(new Event('input', { bubbles: true })); $('#intro').dispatchEvent(new Event('change', { bubbles: true })); };
        box.appendChild(c);
      }
      $('#ai-hooks-status').textContent = hooks.length ? 'اضغط على أي واحدة عشان تستخدمها' : 'مارجعش اقتراحات — جرّب تاني';
    } catch (e) { $('#ai-hooks-status').textContent = ''; showError(e); }
    btn.disabled = false;
  };

  $('#pub-ai').onclick = async () => {
    if (!LLM.isReady()) { needLLM(); return; }
    const btn = $('#pub-ai'); const prev = btn.textContent;
    btn.disabled = true; btn.textContent = '✨ بيكتب…';
    try {
      if (!pub.data) await refreshPublish(true);
      const p = PLATFORMS[pub.platform];
      const ai = await LLM.writeCaption({ summary: contentSummary() }, p.name);
      const d = pub.data[pub.platform];
      // الوصف: كلام المساعد فوق، وتحته المعلومات والمصادر والهاشتاجات اللي البرنامج بيولّدها
      d.caption = [ai.caption, d.caption].filter(Boolean).join('\n\n');
      if (p.title && ai.title) d.title = ai.title;
      // الهاشتاجات: هاشتاجات المساعد الأول وبعدها اللي البرنامج حطها، في آخر الوصف (يوتيوب ليه خانة Tags لوحدها فبنسيبها)
      if (ai.tags.length && !p.tags) {
        const tail = d.caption.match(/(?:#\S+\s*)+$/u);
        const existing = tail ? tail[0].split(/\s+/).filter(Boolean) : [];
        const merged = [...new Set([...ai.tags, ...existing])].slice(0, p.hashtags || 8);
        d.caption = (tail ? d.caption.slice(0, tail.index) : d.caption).trimEnd() + '\n\n' + merged.join(' ');
      }
      pub.edited = true;
      renderPublish();
      status('✨ الوصف اتكتب — راجعه وعدّل اللي يعجبك قبل النشر');
    } catch (e) { showError(e); }
    btn.disabled = false; btn.textContent = prev;
  };
}

// ===== مكتبة الأذكار (نافذة) =====
const AZ_FIRST = ['أذكار الصباح', 'أذكار المساء', 'أذكار النوم', 'أذكار الاستيقاظ من النوم', 'الرقية الشرعية من القرآن الكريم',
  'الرقية الشرعية من السنة النبوية', 'الأذكار بعد السلام من الصلاة', 'دعاء الهم والحزن', 'دعاء الكرب',
  'الاستغفار و التوبة', 'التسبيح، التحميد، التهليل، التكبير', 'فضل الصلاة على النبي صلى الله عليه و سلم', 'دعاء السفر'];
const azNorm = t => (t || '').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
let azCat = 'أذكار الصباح';

function focusLastBlock() {
  const li = blocksEl.lastElementChild;
  if (!li) return;
  li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1700);
}

// أدعية إضافية (data/duas.json — بيتبني بـ tools/build_duas.py): أدعية القرآن بصوت القارئ + أدعية صحيحة من كتب السنة
let DUAS = null;
async function loadDuas() {
  if (DUAS) return DUAS;
  try { DUAS = await (await fetch('data/duas.json')).json(); } catch { DUAS = { quran: [], sunnah: [] }; }
  return DUAS;
}
const DUA_Q = '📖 من القرآن: ', DUA_S = '🌿 من السنة: ';
// نص دعاء القرآن من المصحف (جزء الآية لو محدد)
function quranDuaText(it) {
  return it.parts.map(p => {
    if (p.b) return Array.from({ length: p.b - p.a + 1 }, (_, k) => Q.ayahText(p.s, p.a + k)).join(' ۝ ');
    const ws = WT.words(Q.ayahText(p.s, p.a));
    return p.w1 ? ws.slice(p.w1 - 1, p.w2).join(' ') : ws.join(' ');
  }).join(' ۝ ');
}
const quranDuaRef = it => {
  const p = it.parts[0], last = it.parts[it.parts.length - 1], end = last.b || last.a;
  return `سورة ${Q.surah(p.s).ar} ${p.s === last.s && end !== p.a ? `${Q.arabicNum(p.a)}–${Q.arabicNum(end)}` : Q.arabicNum(p.a)}`;
};
const gradeNote = g => (/الألباني/.test(g) ? (/حسن/.test(g) ? 'حسّنه الألباني' : 'صحّحه الألباني') : '');
// كل الأقسام: حصن المسلم + أقسام القرآن + أقسام السنة
function allAzCats() {
  const cats = sortedCats().map(c => ({ ...c, kind: 'azkar' }));
  const group = (list, prefix, kind) => {
    const by = new Map();
    for (const it of list || []) { if (!by.has(it.topic)) by.set(it.topic, []); by.get(it.topic).push(it); }
    return [...by].map(([topic, items]) => ({ name: prefix + topic, items, kind }));
  };
  return [...group(DUAS?.quran, DUA_Q, 'quran'), ...cats, ...group(DUAS?.sunnah, DUA_S, 'sunnah')];
}
const duaText = (c, it) => (c.kind === 'quran' ? quranDuaText(it) : it.t);

// إضافة دعاء من أي قسم كـ كروت في الفيديو
function addLibItem(c, k, it) {
  if (c.kind === 'quran') {
    for (const p of it.parts) {
      const q = newQuranBlock(p.s, p.a, p.b || p.a);
      if (p.w1) q.part = { w1: p.w1, w2: p.w2 };
      state.blocks.push(q);
    }
  } else if (c.kind === 'sunnah') {
    const b = newCustomBlock();
    b.text = it.t;
    b.ref = [it.r, gradeNote(it.g)].filter(Boolean).join(' — ');
    b.seconds = estimateSeconds(it.t);
    state.blocks.push(b);
  } else state.blocks.push(newZikrBlock(c.name, k));
}

async function openAzkarLibrary() {
  if (!AZKAR?.categories.length) { alert('ملف الأذكار ماتحمّلش. اعمل Refresh للصفحة (Ctrl + Shift + R).'); return; }
  await loadDuas();
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
  let kind = '';
  for (const c of allAzCats()) {
    if (c.kind !== kind) {
      kind = c.kind;
      const h = document.createElement('div');
      h.className = 'az-group';
      h.textContent = { quran: '📖 أدعية القرآن — بصوت القارئ', azkar: '📿 حصن المسلم', sunnah: '🌿 أدعية صحيحة من السنة' }[kind];
      box.appendChild(h);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'az-cat';
    b.setAttribute('aria-selected', String(c.name === azCat && !$('#az-q').value.trim()));
    b.innerHTML = '<span></span><span class="n"></span>';
    b.firstChild.textContent = c.name.replace(DUA_Q, '').replace(DUA_S, '');
    b.lastChild.textContent = c.items.length;
    b.onclick = () => { azCat = c.name; $('#az-q').value = ''; renderAzCats(); renderAzItems(); };
    box.appendChild(b);
  }
}

function renderAzItems() {
  const q = azNorm($('#az-q').value.trim());
  const cats = allAzCats();
  let list;
  if (q.length >= 2) {
    list = [];
    for (const c of cats) c.items.forEach((it, k) => {
      if (azNorm(duaText(c, it)).includes(q) || azNorm(c.name).includes(q)) list.push({ c, k, it });
    });
    $('#az-title').textContent = `نتايج البحث (${list.length})`;
    $('#az-add-all').hidden = true;
  } else {
    const c = cats.find(x => x.name === azCat) || cats.find(x => x.kind === 'azkar') || cats[0];
    azCat = c.name;
    list = c.items.map((it, k) => ({ c, k, it }));
    $('#az-title').textContent = `${c.name} (${c.items.length})`;
    $('#az-add-all').hidden = c.items.length < 2;
  }
  const box = $('#az-items');
  box.innerHTML = list.length ? '' : '<p class="muted">مفيش نتايج.</p>';
  for (const { c, k, it } of list.slice(0, 150)) {
    const d = document.createElement('div');
    d.className = 'az-item' + (c.kind === 'quran' ? ' quran' : '');
    d.innerHTML = '<div class="cat"></div><div class="txt"></div><div class="meta"></div><div class="row wrap"><button class="btn" type="button" data-a="add"></button><button class="btn ghost" type="button" data-a="copy">📋 انسخ</button></div>';
    const text = duaText(c, it);
    d.querySelector('.cat').textContent = q ? c.name : '';
    d.querySelector('.txt').textContent = c.kind === 'quran' ? `﴿ ${text} ﴾` : text;
    const meta = c.kind === 'quran' ? [`📖 ${quranDuaRef(it)}`, 'بيتقري بصوت القارئ اللي مختاره']
      : c.kind === 'sunnah' ? [`📚 ${it.r}`, `✅ ${it.g}`]
        : [it.n > 1 && `🔁 ${it.n} مرات`, it.r && `📖 ${it.r}`, it.d && `💡 ${it.d}`];
    d.querySelector('.meta').textContent = meta.filter(Boolean).join('  •  ');
    const add = d.querySelector('[data-a=add]');
    add.textContent = c.kind === 'quran' && it.parts.length > 1 ? `＋ أضف للفيديو (${Q.arabicNum(it.parts.length)} كروت)` : '＋ أضف للفيديو';
    add.onclick = () => {
      addLibItem(c, k, it);
      $('#dlg-azkar').close();
      renderBlocks();
      focusLastBlock();
      status(`✅ اتضاف: ${c.name}`);
    };
    d.querySelector('[data-a=copy]').onclick = async e => {
      const ref = c.kind === 'quran' ? `[${quranDuaRef(it)}]` : c.kind === 'sunnah' ? `${it.r}${gradeNote(it.g) ? ' — ' + gradeNote(it.g) : ''}` : it.r || '';
      const body = c.kind === 'quran' ? `﴿ ${text} ﴾` : text;
      try {
        await navigator.clipboard.writeText(ref ? `${body}\n${ref}` : body);
        e.target.textContent = '✅ اتنسخ';
        setTimeout(() => { e.target.textContent = '📋 انسخ'; }, 1500);
      } catch { status('⚠️ المتصفح منع النسخ — حدّد النص وانسخه بـ Ctrl+C'); }
    };
    box.appendChild(d);
  }
}

function setupAzkarLibrary() {
  $('#az-close').onclick = () => $('#dlg-azkar').close();
  let t = null;
  $('#az-q').oninput = () => { clearTimeout(t); t = setTimeout(() => { renderAzCats(); renderAzItems(); }, 200); };
  $('#az-add-all').onclick = () => {
    const c = allAzCats().find(x => x.name === azCat);
    if (!c) return;
    c.items.forEach((it, k) => addLibItem(c, k, it));
    $('#dlg-azkar').close();
    renderBlocks();
    focusLastBlock();
    status(`✅ اتضاف ${c.items.length} من «${c.name}». القايمة الطويلة هتطلع فيديو طويل — الأنسب لها MP3 أو «حزمة Filmora»، أو فعّل «وضع السلسلة» لاحقًا.`);
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
  // ⏱️ = توقيت دقيق لكل كلمة (للظهور كلمة كلمة / التظليل)
  const timed = r => WT.alignFolder(r) || r.qurancom;
  let html = sorted.map(r => `<option value="${r.id}">${favs.includes(r.id) ? '★ ' : ''}${r.name}${timed(r) ? ' ⏱️' : ''}</option>`).join('');
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
const STYLE_INPUTS = ['aspect', 'bgType', 'color1', 'color2', 'dim', 'textSize', 'labelScale', 'textColor', 'accent', 'subColor', 'gap', 'trimSilence', 'wordMode', 'intro', 'introSeconds', 'handle', 'handlePos', 'showLabel', 'showFooter', 'showTranslation', 'waveform', 'translation', 'bgSwitch', 'bgEvery', 'bgFade'];

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
  $('#bgEvery-wrap').hidden = st.bgSwitch === 'ayah';
  $('#bgEvery-lbl').textContent = st.bgSwitch === 'custom' ? 'المدة الافتراضية (ث)' : 'كل (ث)';
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
      if (k === 'bgSwitch') { $('#bgEvery-wrap').hidden = v === 'ayah'; $('#bgEvery-lbl').textContent = v === 'custom' ? 'المدة الافتراضية (ث)' : 'كل (ث)'; }
      if (['bgSwitch', 'bgEvery'].includes(k)) renderBgList();
      persist();
      refreshPreview();
    });
  }
  $('#quality').onchange = () => { state.style.quality = $('#quality').value; persist(); };
  $('#silent').onchange = () => { $('#silent-dur-wrap').hidden = !$('#silent').checked; };

  // الرفع بيضيف للقايمة (مش بيمسح اللي قبله) — والمسح من ✕ أو «امسح كل الخلفيات»
  $('#bg-file').onchange = () => {
    for (const f of $('#bg-file').files) setMedia(f, true);
    $('#bg-file').value = '';
  };
  $('#bg-shuffle').onclick = () => {
    const list = state.mediaList;
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    state.media = list[0];
    persistMedia(); renderBgList(); refreshPreview();
  };
  $('#bg-reverse').onclick = () => { state.mediaList.reverse(); state.media = state.mediaList[0]; persistMedia(); renderBgList(); refreshPreview(); };
  $('#bg-clear').onclick = () => {
    if (!confirm(`تمسح الـ ${Q.arabicNum(state.mediaList.length)} خلفيات؟`)) return;
    for (const m of state.mediaList) URL.revokeObjectURL(m.url);
    state.mediaList = []; state.media = null;
    persistMedia(); renderBgList(); refreshPreview();
  };
  $('#bg-add').onchange = () => {
    for (const f of $('#bg-add').files) setMedia(f, true);
    $('#bg-add').value = '';
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

// صورة مصغرة لفيديو: من جوه الفيديو (مش أول فريم، لأنه غالبًا أسود)، ولو طلعت سودا نجرب نص الفيديو
async function videoThumb(url) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const once = (ev, ms = 8000) => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout')), ms);
    v.addEventListener(ev, () => { clearTimeout(to); res(); }, { once: true });
  });
  try {
    await once('loadedmetadata');
    const c = document.createElement('canvas'); c.width = 68; c.height = 108;
    const x = c.getContext('2d', { willReadFrequently: true });
    const d = v.duration || 2;
    for (const t of [Math.min(1, d * 0.15), d * 0.5, d * 0.8]) {
      v.currentTime = t;
      await once('seeked');
      const k = Math.max(68 / v.videoWidth, 108 / v.videoHeight);
      x.drawImage(v, (68 - v.videoWidth * k) / 2, (108 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
      const px = x.getImageData(0, 0, 68, 108).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 16) sum += px[i] + px[i + 1] + px[i + 2];
      if (sum / (px.length / 16) > 30) break; // مش سودا
    }
    return c.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  } finally {
    v.removeAttribute('src'); v.load();
  }
}

function makeMediaItem(file) {
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');
  const el = isVideo ? document.createElement('video') : new Image();
  const item = { id: uid(), kind: isVideo ? 'video' : 'image', file, el, url, thumb: isVideo ? null : url };
  if (isVideo) {
    el.muted = true; el.loop = true; el.playsInline = true;
    el.onloadeddata = () => { el.play().catch(() => {}); refreshPreview(); };
    videoThumb(url).then(t => {
      if (t) { item.thumb = t; renderBgList(); return; }
      // لو المتصفح رفض يقدّم الفيديو: ناخد لقطة من الفيديو اللي شغال في المعاينة
      setTimeout(() => {
        try {
          const c = document.createElement('canvas'); c.width = 68; c.height = 108;
          const k = Math.max(68 / el.videoWidth, 108 / el.videoHeight);
          c.getContext('2d').drawImage(el, (68 - el.videoWidth * k) / 2, (108 - el.videoHeight * k) / 2, el.videoWidth * k, el.videoHeight * k);
          item.thumb = c.toDataURL('image/jpeg', 0.75); renderBgList();
        } catch { /* هيفضل 🎞️ */ }
      }, 1500);
    });
  } else {
    el.onload = () => { refreshPreview(); };
  }
  el.src = url;
  return item;
}

const persistMedia = () => saveMediaList(state.mediaList);

// append = true: ضيفها جنب الخلفيات الموجودة بدل ما تستبدلهم
function setMedia(file, append = false, secs = null) {
  const item = makeMediaItem(file);
  if (secs != null) item.secs = secs;
  if (append && state.mediaList.length) state.mediaList.push(item);
  else {
    for (const m of state.mediaList) URL.revokeObjectURL(m.url);
    state.mediaList = [item];
  }
  state.media = state.mediaList[0];
  state.style.bgType = 'media';
  $('#bgType').value = 'media';
  updateBgVisibility();
  renderBgList();
  persist();
  persistMedia();
  refreshPreview();
}

let bgDragging = false; // وقت السحب ماينفعش القايمة تترسم من جديد (حساب المدة بيرسمها لوحده)
function renderBgList() {
  if (bgDragging) return;
  const list = state.mediaList;
  const ol = $('#bg-list');
  ol.innerHTML = '';
  $('#bg-name').hidden = list.length > 0;
  $('#bg-switch-row').hidden = list.length < 2;
  $('#bg-list-actions').hidden = list.length < 2;
  if (!list.length) $('#bg-name').textContent = 'مفيش خلفية مختارة — ارفع صورة/فيديو أو اختار من الخلفيات المجانية';
  const custom = state.style.bgSwitch === 'custom';
  const tm = $('#bg-timing');
  tm.hidden = list.length < 2;
  let sched = null;
  if (list.length > 1 && durCache) sched = bgSchedule(durCache.segs, durCache.duration, list.length, state.style, list.map(m => m.secs));
  if (list.length > 1) {
    if (custom) {
      const def = Number(state.style.bgEvery) || 6;
      const sum = list.reduce((a, m) => a + (Number(m.secs) || def), 0);
      tm.textContent = durCache
        ? `مجموع الخلفيات ${fmtDur(sum)} — الفيديو ${fmtDur(durCache.duration)}${sum < durCache.duration - 0.5 ? ' (هترجع تلف من الأول)' : sum > durCache.duration + 0.5 ? ' (اللي بعد آخر الفيديو مش هيظهر)' : ' ✅ مظبوط'}`
        : `مجموع الخلفيات ${fmtDur(sum)}`;
    } else tm.textContent = durCache ? `الفيديو ${fmtDur(durCache.duration)} — التوقيت جنب كل خلفية` : '';
  }
  if (!list.length) return;
  list.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = 'bg-item';
    // ⠿ اسحب وحط: بالماوس أو بالصباع (pointer events عشان يشتغل على الموبايل كمان)
    if (list.length > 1) {
      const h = document.createElement('span');
      h.className = 'bg-drag';
      h.textContent = '⠿';
      h.title = 'اسحبها لفوق أو لتحت';
      h.onpointerdown = e => {
        e.preventDefault();
        ol.querySelectorAll('.bg-peek').forEach(x => x.remove());
        bgDragging = true;
        li.classList.add('dragging');
        // خط بيوضح هتنزل فين (العنصر نفسه مابيتحركش لحد ما تسيب، عشان السحب مايتقطعش)
        const mark = document.createElement('li');
        mark.className = 'bg-drop';
        let to = i;
        const move = ev => {
          const items = [...ol.querySelectorAll('.bg-item')];
          let k = items.findIndex(it => ev.clientY < it.getBoundingClientRect().top + it.offsetHeight / 2);
          if (k < 0) k = items.length;
          if (k < items.length) ol.insertBefore(mark, items[k]); else ol.appendChild(mark);
          to = k > i ? k - 1 : k;
          if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
        };
        const end = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', end);
          removeEventListener('pointercancel', end);
          mark.remove();
          li.classList.remove('dragging');
          bgDragging = false;
          moveBg(i, to);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', end);
        addEventListener('pointercancel', end);
      };
      li.appendChild(h);
    }
    let th;
    if (m.thumb) { th = document.createElement('img'); th.src = m.thumb; th.className = 'bg-thumb'; th.alt = ''; }
    else { th = document.createElement('span'); th.className = 'bg-thumb-ph'; th.textContent = m.kind === 'video' ? '🎞️' : '🖼️'; }
    th.title = 'اضغط تشوف الخلفية دي';
    th.style.cursor = 'pointer';
    th.onclick = () => {
      const open = ol.querySelector(`.bg-peek[data-id="${m.id}"]`);
      ol.querySelectorAll('.bg-peek').forEach(x => x.remove());
      if (open) return;
      const pk = document.createElement('li');
      pk.className = 'bg-peek'; pk.dataset.id = m.id;
      const media = m.kind === 'video' ? Object.assign(document.createElement('video'), { muted: true, loop: true, autoplay: true, playsInline: true, controls: true }) : document.createElement('img');
      media.src = m.url;
      pk.appendChild(media);
      li.after(pk);
    };
    li.appendChild(th);
    const name = document.createElement('span');
    name.className = 'grow';
    name.textContent = `${Q.arabicNum(i + 1)}. ${m.kind === 'video' ? '🎞️' : '🖼️'} ${m.file.name}`;
    name.title = `${m.file.name} (${(m.file.size / 1048576).toFixed(1)} MB)`;
    li.appendChild(name);
    const mk = (txt, title, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn icon'; b.textContent = txt; b.title = title; b.disabled = !!dis; b.onclick = fn; li.appendChild(b); };
    const swap = j => { [list[i], list[j]] = [list[j], list[i]]; state.media = list[0]; persistMedia(); renderBgList(); refreshPreview(); };
    if (custom && list.length > 1) {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0.5'; inp.max = '120'; inp.step = '0.5';
      inp.className = 'bg-secs';
      inp.placeholder = String(state.style.bgEvery || 6);
      inp.title = 'المدة بالثواني';
      inp.value = m.secs ?? '';
      inp.onchange = () => { m.secs = inp.value === '' ? null : Math.max(0.5, Number(inp.value)); persistMedia(); renderBgList(); refreshPreview(); };
      li.appendChild(inp);
      const u = document.createElement('span'); u.className = 'muted'; u.textContent = 'ث'; li.appendChild(u);
    }
    if (sched && list.length > 1) {
      const mine = sched.filter(c => c.k === i && c.to - c.from >= 0.5);
      const r = document.createElement('span');
      r.className = 'bg-when';
      r.textContent = mine.length ? mine.slice(0, 2).map(c => `${fmtDur(c.from)}–${fmtDur(c.to)}`).join('، ') + (mine.length > 2 ? '…' : '') : 'مش هتظهر';
      li.appendChild(r);
    }
    if (list.length > 2) mk('⤒', 'خليها الأولى', () => moveBg(i, 0), i === 0);
    mk('▲', 'لفوق', () => swap(i - 1), i === 0);
    mk('▼', 'لتحت', () => swap(i + 1), i === list.length - 1);
    if (list.length > 2) mk('⤓', 'خليها الأخيرة', () => moveBg(i, list.length - 1), i === list.length - 1);
    mk('✕', 'شيلها', () => { URL.revokeObjectURL(m.url); list.splice(i, 1); state.media = list[0] || null; persistMedia(); renderBgList(); refreshPreview(); });
    ol.appendChild(li);
  });
}

// نقل خلفية من مكان لمكان (السحب، أو ⤒ ⤓)
function moveBg(from, to) {
  const list = state.mediaList;
  if (to < 0 || to === from || from < 0 || from >= list.length) { renderBgList(); return; }
  const [m] = list.splice(from, 1);
  list.splice(Math.min(to, list.length), 0, m);
  state.media = list[0];
  persistMedia(); renderBgList(); refreshPreview();
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
const stockSel = new Map(); // id -> item (اختيار متعدد)
function openStock(query) {
  stockSel.clear();
  $('#stock-replace').checked = false;
  updateStockBar();
  if (query) $('#stock-q').value = query;
  $('#dlg-stock').showModal();
  if (query) $('#stock-go').click();
}

function updateStockBar() {
  const n = stockSel.size, have = state.mediaList.length;
  $('#stock-count').textContent = n
    ? `✅ اخترت ${Q.arabicNum(n)} ${n === 1 ? 'خلفية' : 'خلفيات'}${have && !$('#stock-replace').checked ? ` — هيتضافوا للـ ${Q.arabicNum(have)} اللي عندك` : ''}`
    : `اضغط على الخلفيات اللي عايزها (تقدر تختار أكتر من واحدة)${have ? ` — عندك حاليًا ${Q.arabicNum(have)}` : ''}`;
  $('#stock-done').textContent = n ? `✓ تم — أضف ${Q.arabicNum(n)}` : '✓ تم';
  $('#stock-replace').parentElement.hidden = !have;
  document.querySelectorAll('#stock-results .stock-item').forEach(d => {
    const order = [...stockSel.keys()].indexOf(d.dataset.id);
    d.classList.toggle('picked', order !== -1);
    let num = d.querySelector('.num');
    if (order !== -1) { if (!num) { num = document.createElement('span'); num.className = 'num'; d.appendChild(num); } num.textContent = Q.arabicNum(order + 1); }
    else num?.remove();
  });
}

function setupStock() {
  const dlg = $('#dlg-stock');
  const prov = $('#stock-provider');
  prov.innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const st = getSettings();
  prov.value = load('stockProvider', null) || (st.pixabayKey ? 'pixabay' : st.pexelsKey ? 'pexels' : 'commons');
  prov.onchange = () => save('stockProvider', prov.value);
  $('#open-stock').onclick = () => openStock();
  $('#stock-close').onclick = () => dlg.close();
  $('#stock-replace').onchange = updateStockBar;
  $('#stock-clear-sel').onclick = () => { stockSel.clear(); updateStockBar(); };
  $('#stock-done').onclick = async () => {
    const items = [...stockSel.values()];
    if (!items.length) { dlg.close(); return; }
    const btn = $('#stock-done');
    btn.disabled = true;
    let ok = 0, replace = $('#stock-replace').checked;
    const credits = [];
    for (const [i, it] of items.entries()) {
      $('#stock-count').textContent = `⏳ بيحمّل ${Q.arabicNum(i + 1)} من ${Q.arabicNum(items.length)}…`;
      try {
        setMedia(await downloadStock(it), !replace);
        replace = false;
        ok++;
        if (it.license && /BY/i.test(it.license)) credits.push(`${it.credit || 'صاحبها'} (${it.license})`);
      } catch (e) {
        console.warn(e);
      }
    }
    btn.disabled = false;
    stockSel.clear();
    dlg.close();
    showTab('look', false);
    const failed = items.length - ok;
    status(`✅ اتضاف ${Q.arabicNum(ok)} — عندك ${Q.arabicNum(state.mediaList.length)} خلفيات${failed ? ` (و ${Q.arabicNum(failed)} ماتحمّلتش)` : ''}${credits.length ? ` • اكتب في الوصف: الخلفيات: ${credits.join('، ')}` : ''}`, null, !ok);
  };
  // ===== الفلاتر والصفحات =====
  const ORDER_NAMES = { relevance: 'الأنسب للبحث', popular: 'الأشهر', latest: 'الأحدث' };
  const sf = { order: '', dur: '', vertical: false, editors: false, hd: false, ...load('stockFilters', {}) };
  const syncFilterUi = () => {
    const P = PROVIDERS[prov.value];
    const orders = P.order || [];
    $('#sf-order').innerHTML = orders.map(o => `<option value="${o}">${ORDER_NAMES[o]}</option>`).join('');
    if (!orders.includes(sf.order)) sf.order = orders[0] || '';
    $('#sf-order').value = sf.order;
    $('#sf-order-wrap').hidden = !orders.length;
    $('#sf-editors-wrap').hidden = !P.editors;
    $('#sf-dur-wrap').hidden = $('#stock-kind').value !== 'video';
    $('#sf-dur').value = sf.dur;
    $('#sf-vertical').checked = sf.vertical;
    $('#sf-editors').checked = sf.editors;
    $('#sf-hd').checked = sf.hd;
  };
  const passes = it => {
    if (sf.dur && it.kind === 'video' && it.duration != null) {
      const [lo, hi] = sf.dur.split('-').map(Number);
      if (it.duration < lo || it.duration > hi) return false;
    }
    if (sf.vertical && it.width && it.height && it.height <= it.width) return false;
    if (sf.hd && it.width && it.height && Math.min(it.width, it.height) < 720) return false;
    return true;
  };
  let last = null; // { items, total, pages, hasMore, page }
  const fmtN = n => Q.arabicNum(Number(n).toLocaleString('en-US'));
  const render = () => {
    const box = $('#stock-results');
    box.innerHTML = '';
    if (!last) return;
    const shown = last.items.filter(passes);
    const hidden = last.items.length - shown.length;
    $('#stock-info').textContent = [
      last.total != null ? `النتايج: ${fmtN(last.total)}` : '',
      last.pages ? `الصفحة ${Q.arabicNum(last.page)} من ${Q.arabicNum(last.pages)}` : `الصفحة ${Q.arabicNum(last.page)}`,
      hidden ? `اتخبى ${Q.arabicNum(hidden)} بسبب الفلاتر` : '',
    ].filter(Boolean).join(' • ');
    if (!shown.length) box.textContent = last.items.length ? 'كل نتايج الصفحة دي اتخبت بسبب الفلاتر — جرّب الصفحة اللي بعدها أو خفّف الفلاتر.' : 'مفيش نتايج';
    for (const it of shown) {
      const d = document.createElement('div');
      d.className = 'stock-item';
      d.dataset.id = it.id;
      d.innerHTML = `<img alt="" loading="lazy"><div class="meta"></div><span class="tag"></span>`;
      d.querySelector('img').src = it.thumb;
      const meta = [];
      if (it.duration != null) meta.push(`⏱ ${fmtDur(it.duration)}`);
      if (it.width && it.height) meta.push(`${Math.min(it.width, it.height) >= 1080 ? 'FHD' : Math.min(it.width, it.height) >= 720 ? 'HD' : 'SD'} ${it.height > it.width ? '▯' : '▭'}`);
      if (it.likes != null) meta.push(`❤ ${it.likes >= 1000 ? (it.likes / 1000).toFixed(1) + 'k' : it.likes}`);
      d.querySelector('.meta').innerHTML = meta.map(m => `<span>${m}</span>`).join('');
      d.querySelector('.tag').textContent = `${it.kind === 'video' ? '🎞️' : '🖼️'} ${it.credit || ''}${it.license ? ' · ' + it.license : ''}`;
      d.onclick = () => {
        if (stockSel.has(it.id)) stockSel.delete(it.id); else stockSel.set(it.id, it);
        updateStockBar();
      };
      box.appendChild(d);
    }
    // أرقام الصفحات
    const pg = $('#stock-pager');
    pg.innerHTML = '';
    const cur = last.page;
    const maxP = last.pages || (last.hasMore ? cur + 1 : cur);
    if (maxP <= 1) return;
    const btn = (label, page, current = false, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = label;
      if (current) b.setAttribute('aria-current', 'page');
      b.disabled = disabled;
      b.onclick = () => go(page);
      pg.appendChild(b);
    };
    btn('‹ السابق', cur - 1, false, cur <= 1);
    const nums = new Set([1, maxP, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter(n => n >= 1 && n <= maxP));
    let prev = 0;
    for (const n of [...nums].sort((x, y) => x - y)) {
      if (n - prev > 1) { const sp = document.createElement('span'); sp.className = 'muted'; sp.textContent = '…'; pg.appendChild(sp); }
      btn(Q.arabicNum(n), n, n === cur);
      prev = n;
    }
    btn('التالي ›', cur + 1, false, !(last.hasMore || (last.pages && cur < last.pages)));
  };
  const go = async (page = 1) => {
    const box = $('#stock-results');
    box.textContent = 'جاري البحث…';
    $('#stock-pager').innerHTML = '';
    try {
      const fn = PROVIDERS[prov.value].fn;
      const r = await fn($('#stock-q').value.trim() || 'nature', $('#stock-kind').value, state.style.aspect, { page, order: sf.order, editors: sf.editors });
      last = { ...r, page };
      render();
      updateStockBar();
      $('#stock-results').scrollTop = 0;
    } catch (e) {
      box.textContent = e.message;
      $('#stock-info').textContent = '';
    }
  };
  const saveSf = () => save('stockFilters', sf);
  $('#sf-order').onchange = () => { sf.order = $('#sf-order').value; saveSf(); go(1); };
  $('#sf-editors').onchange = () => { sf.editors = $('#sf-editors').checked; saveSf(); go(1); };
  $('#sf-dur').onchange = () => { sf.dur = $('#sf-dur').value; saveSf(); render(); updateStockBar(); };
  $('#sf-vertical').onchange = () => { sf.vertical = $('#sf-vertical').checked; saveSf(); render(); updateStockBar(); };
  $('#sf-hd').onchange = () => { sf.hd = $('#sf-hd').checked; saveSf(); render(); updateStockBar(); };
  prov.addEventListener('change', () => { syncFilterUi(); last = null; render(); $('#stock-info').textContent = ''; $('#stock-pager').innerHTML = ''; });
  $('#stock-kind').addEventListener('change', syncFilterUi);
  syncFilterUi();
  $('#stock-go').onclick = () => go(1);
  $('#stock-q').onkeydown = e => { if (e.key === 'Enter') go(1); };
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
    const keepMedia = state.mediaList.length > 0 && state.style.bgType === 'media';
    state.style = { ...T.DEFAULT_STYLE, ...tpl, bgType: keepMedia ? 'media' : tpl.bgType === 'media' && !state.media ? 'gradient' : tpl.bgType };
    applyStyleToInputs();
    persist();
    refreshPreview();
    if (keepMedia) status('✅ القالب اتطبّق، والخلفيات اللي اخترتها فضلت زي ما هي.');
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
    $('#set-llm-provider').innerHTML = '<option value="">— مش مفعّل —</option>' + Object.entries(LLM.PROVIDERS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');
    $('#set-llm-provider').value = s.llmProvider || '';
    $('#set-llm-key').value = s.llmKey || '';
    $('#set-gtts-key').value = s.gttsKey || '';
    $('#set-gtts-voice').innerHTML = GT.VOICES.map(v => `<option value="${v.id}">${v.id} — ${v.desc}</option>`).join('');
    $('#set-gtts-voice').value = s.gttsVoice || 'Charon';
    $('#set-gtts-style').value = s.gttsStyle || '';
    $('#set-gtts-style').placeholder = GT.STYLE_HINT;
    $('#set-gtts-model').dataset.want = s.gttsModel || '';
    $('#set-gtts-status').textContent = '';
    loadGttsModels();
    $('#set-llm-model').dataset.want = s.llmModel || '';
    $('#set-llm-status').textContent = '';
    syncLlmFields();
    loadLlmModels();
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
      ...llmFields(),
      ...gttsFields(),
    });
  });
  const llmFields = () => ({ llmProvider: $('#set-llm-provider').value, llmKey: $('#set-llm-key').value.trim(), llmModel: $('#set-llm-model').value });
  // قايمة واحدة للموديلات: بتتملي لوحدها من المفتاح، والمجاني 🆓 فوق
  let llmLoad = 0;
  async function loadLlmModels() {
    const sel = $('#set-llm-model'), st = $('#set-llm-status');
    const f = llmFields(), want = sel.dataset.want || f.llmModel;
    const auto = f.llmProvider === 'gemini' ? 'تلقائي — أحدث Flash 🆓' : f.llmProvider === 'openrouter' ? 'تلقائي — أول موديل 🆓' : 'تلقائي';
    sel.innerHTML = `<option value="">${auto}</option>` + (want ? `<option value="${want}">${want}</option>` : '');
    sel.value = want;
    if (!f.llmProvider || !f.llmKey) return;
    const my = ++llmLoad, before = getSettings();
    setSettings(f);
    st.textContent = 'بجيب الموديلات…';
    try {
      const ids = await LLM.listModels();
      if (my !== llmLoad) return;
      sel.innerHTML = `<option value="">${auto}</option>` + ids.map(m => `<option value="${m.id}">${m.tag.label} — ${m.id}</option>`).join('');
      if (want && !ids.some(m => m.id === want)) sel.insertAdjacentHTML('beforeend', `<option value="${want}">${want}</option>`);
      sel.value = want;
      const nFree = ids.filter(m => m.tag.free).length;
      st.textContent = ids.length ? `${ids.length} موديل${nFree ? ` — ${nFree} مجاني 🆓 فوق` : ''}` : 'مالقيتش موديلات للمفتاح ده';
    } catch (e) { if (my === llmLoad) st.textContent = '❌ ' + e.message; }
    setSettings({ llmProvider: before.llmProvider, llmKey: before.llmKey, llmModel: before.llmModel });
  }
  function syncLlmFields() {
    const p = LLM.PROVIDERS[$('#set-llm-provider').value];
    $('#set-llm-keyurl').href = p ? p.keyUrl : LLM.PROVIDERS.gemini.keyUrl;
  }
  $('#set-llm-model').onchange = () => { $('#set-llm-model').dataset.want = $('#set-llm-model').value; };
  $('#set-llm-provider').onchange = () => { $('#set-llm-model').dataset.want = ''; $('#set-llm-model').value = ''; syncLlmFields(); loadLlmModels(); };
  $('#set-llm-key').onchange = () => { loadLlmModels(); loadGttsModels(); };
  // صوت Gemini: الموديلات بتتملي من المفتاح (أو مفتاح مساعد الكتابة)
  const gttsFields = () => {
    const st = $('#set-gtts-style').value.trim();
    return { gttsKey: $('#set-gtts-key').value.trim(), gttsModel: $('#set-gtts-model').value, gttsVoice: $('#set-gtts-voice').value, gttsStyle: /^read the following arabic text/i.test(st) ? '' : st };
  };
  const gttsKeyNow = () => $('#set-gtts-key').value.trim() || ($('#set-llm-provider').value === 'gemini' ? $('#set-llm-key').value.trim() : '');
  let gttsLoad = 0;
  async function loadGttsModels() {
    const sel = $('#set-gtts-model'), st = $('#set-gtts-status');
    const want = sel.dataset.want ?? '';
    sel.innerHTML = '<option value="">تلقائي — أحدث Flash 🆓</option>' + (want ? `<option value="${want}">${want}</option>` : '');
    sel.value = want;
    const k = gttsKeyNow();
    if (!k) return;
    const my = ++gttsLoad;
    try {
      const list = await GT.listModels(k);
      if (my !== gttsLoad) return;
      sel.innerHTML = '<option value="">تلقائي — أحدث Flash 🆓</option>' + list.map(m => `<option value="${m.id}">${m.label} — ${m.id}</option>`).join('');
      if (want && !list.some(m => m.id === want)) sel.insertAdjacentHTML('beforeend', `<option value="${want}">${want}</option>`);
      sel.value = want;
      st.textContent = list.length ? '' : 'مفتاحك مفيهوش موديلات صوت';
    } catch (e) { if (my === gttsLoad) st.textContent = '❌ ' + e.message; }
  }
  $('#set-gtts-model').onchange = () => { $('#set-gtts-model').dataset.want = $('#set-gtts-model').value; };
  $('#set-gtts-key').onchange = () => loadGttsModels();
  let gttsPlayer = null;
  $('#set-gtts-test').onclick = async () => {
    const st = $('#set-gtts-status'), btn = $('#set-gtts-test');
    const before = getSettings();
    setSettings({ ...gttsFields(), ...(!$('#set-gtts-key').value.trim() ? llmFields() : {}) });
    btn.disabled = true; st.textContent = '…';
    try {
      const blob = await GT.speak('اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي');
      if (gttsPlayer) { gttsPlayer.pause(); URL.revokeObjectURL(gttsPlayer.src); }
      gttsPlayer = new Audio(URL.createObjectURL(blob));
      gttsPlayer.play().catch(() => {});
      st.textContent = '✅ شغال';
    } catch (e) { st.textContent = '❌ ' + e.message; }
    finally { btn.disabled = false; setSettings(before); }
  };
  $('#set-llm-test').onclick = async () => {
    const st = $('#set-llm-status');
    const before = getSettings();
    setSettings(llmFields());
    st.textContent = '…';
    try { await LLM.ping(); st.textContent = '✅ شغال'; }
    catch (e) { st.textContent = '❌ ' + e.message; setSettings({ llmProvider: before.llmProvider, llmKey: before.llmKey, llmModel: before.llmModel }); }
  };
  // جلب الأصوات من حساب ElevenLabs (بالمفتاح المكتوب حاليًا في الخانة)
  $('#set-eleven-load').onclick = async () => {
    const btn = $('#set-eleven-load');
    const prev = getSettings();
    setSettings({ elevenKey: $('#set-eleven-key').value.trim() });
    btn.disabled = true; btn.textContent = '…';
    try {
      const voices = await EL.listVoices();
      elVoices = voices; save('elVoices', voices);
      const sel = $('#set-eleven-voices');
      sel.innerHTML = '<option value="">— اختار صوتك —</option>' + voices
        .sort((a, b) => (b.category === 'cloned') - (a.category === 'cloned'))
        .map(v => `<option value="${v.id}">${v.category === 'cloned' ? '🎙️ ' : ''}${escapeHtml(v.name)}</option>`).join('');
      sel.hidden = false;
      sel.onchange = () => { if (sel.value) $('#set-eleven-voice').value = sel.value; };
    } catch (e) {
      alert(/voices_read|missing the permission/i.test(e.message)
        ? 'المفتاح ده مالوش صلاحية «Voices: Read». فعّلها من ElevenLabs ← Developers ← API Keys، أو الصق رقم صوتك (Voice ID) في الخانة بإيدك.'
        : e.message);
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
const pub = { platform: load('pubPlatform', 'tiktok'), data: null, edited: false, lastFile: null };

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
      const blob = await withProject(await exportVideo(project, p => status(`الجزء ${i + 1} من ${n}: ${stage}`, p), onLoad, s => { stage = s; status(`الجزء ${i + 1} من ${n}: ${s}`, 0); }));
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

// المشروع كله (المقاطع والشكل والأصوات) كـ object — للحفظ في ملف أو جوه الفيديو
async function projectData() {
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
      audios[id] = { name: au.name, kind: au.kind || '', data: await blobToDataUrl(bufferToWavBlob(buf)) };
    }
    return { app: 'quran-clip-studio', version: 1, savedAt: new Date().toISOString(), blocks, style: state.style, series: state.series, audios };
}

// ===== المشروع جوه ملف الـ MP4 =====
// بنحط المشروع في «free box» في آخر الملف: البرامج والمنصات بتتجاهله، والفيديو بيشتغل عادي.
// ولما ترفع الفيديو تاني من «📂 فتح» البرنامج بيرجّع المشروع منه.
const PROJ_MAGIC = 'QCSPROJ1';
async function withProject(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...head.slice(4, 8)) !== 'ftyp') return blob; // مش MP4
    const json = new TextEncoder().encode(PROJ_MAGIC + JSON.stringify(await projectData()));
    const box = new Uint8Array(8 + json.length);
    new DataView(box.buffer).setUint32(0, box.length);
    box.set([0x66, 0x72, 0x65, 0x65], 4); // 'free'
    box.set(json, 8);
    return new Blob([blob, box], { type: blob.type || 'video/mp4' });
  } catch (e) {
    console.warn('تعذر حفظ المشروع جوه الفيديو', e);
    return blob;
  }
}

// بيمشي على صناديق الـ MP4 من غير ما يقرا الملف كله، ويدوّر على صندوق المشروع
async function projectFromVideo(file) {
  let off = 0;
  for (let guard = 0; off + 8 <= file.size && guard < 10000; guard++) {
    const h = new DataView(await file.slice(off, off + 16).arrayBuffer());
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) size = Number(h.getBigUint64(8));
    else if (size === 0) size = file.size - off;
    if (size < 8) return null;
    if (type === 'free' && size > 8 + PROJ_MAGIC.length) {
      const magic = await file.slice(off + 8, off + 8 + PROJ_MAGIC.length).text();
      if (magic === PROJ_MAGIC) return JSON.parse(await file.slice(off + 8 + PROJ_MAGIC.length, off + size).text());
    }
    off += size;
  }
  return null;
}

async function openProject(proj) {
      if (proj.app !== 'quran-clip-studio' || !Array.isArray(proj.blocks)) throw new Error('ده مش ملف مشروع من البرنامج');
      stop();
      state.blocks = proj.blocks;
      state.style = { ...T.DEFAULT_STYLE, ...proj.style, bgType: state.mediaList.length && state.style.bgType === 'media' ? 'media' : proj.style?.bgType === 'media' && !state.media ? 'gradient' : proj.style?.bgType };
      if (proj.series) { Object.assign(state.series, proj.series); save('series', state.series); }
      hadithAudio.clear();
      for (const [id, au] of Object.entries(proj.audios || {})) {
        const blob = await (await fetch(au.data)).blob();
        setHadithAudio({ id }, await decode(await blob.arrayBuffer()), au.name, blob, au.kind || '');
      }
      applyStyleToInputs();
      renderBlocks();
      refreshPublish(true);
      persist();
      showTab('content');
}

function setupProject() {
  $('#proj-save').onclick = async () => {
    const proj = await projectData();
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
      // فيديو متصدّر من البرنامج: المشروع جواه
      if (/^video\//.test(file.type) || /\.(mp4|m4v|mov)$/i.test(file.name)) {
        const proj = await projectFromVideo(file).catch(() => null);
        if (!proj) {
          if (confirm(`الفيديو «${file.name}» مفيهوش بيانات مشروع (اتصدّر قبل التحديث ده، أو من برنامج تاني، أو اتنزّل من المنصة بعد ما اتعدّل).\n\nتحب تستخدمه كخلفية بدل كده؟`)) {
            await setMedia(file, true);
            showTab('look');
            status(`✅ «${file.name}» اتضاف للخلفيات.`);
          }
          return;
        }
        await openProject(proj);
        status(`✅ رجّعت المشروع من الفيديو «${file.name}» (${proj.blocks.length} مقطع) — عدّل وصدّر تاني.`);
        return;
      }
      const proj = JSON.parse(await file.text());
      await openProject(proj);
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
    : b.type === 'zikr' ? (b.custom ? (b.label || 'نص خاص') : 'ذكر') : `حديث ${collection(b.col)?.name || b.col} ${b.number}`);
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
  if (posts) updateDupWarn();
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
        const wantMp4 = ['mp4', 'both', 'mp4+filmora'].includes(kind);
        const wantMp3 = ['mp3', 'both'].includes(kind);
        if (kind.includes('filmora')) {
          status(`${tag}: حزمة Filmora…`, null);
          download(await exportFilmoraPackage(project), `${name}_filmora.zip`);
        }
        if (wantMp4) {
          if (d > MAX_VIDEO_SECONDS) throw new Error(`مدته ${fmtDur(d)}، أطول من ٣ دقايق — صدّره MP3 أو حزمة Filmora`);
          let stage = '';
          const blob = await withProject(await exportVideo(project, p => status(`${tag}: ${stage}`, p), onLoad, s => { stage = s; status(`${tag}: ${s}`, 0); }));
          download(blob, `${name}.mp4`);
          setLastExport(blob, `${name}.mp4`, 'video/mp4');
          logExperiment(`${name}.mp4`, d);
        }
        if (wantMp3) {
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

// ===== 🔴 البث المباشر =====
// قايمة بتشتغل ورا بعض في نافذة لوحدها (OBS بياخدها). كل عنصر بيتقسم لأجزاء صغيرة،
// والجزء الجاي بيتجهّز وهو الحالي شغال، فالبث مايقفش. الرسم ماشي على توقيت نافذة البث نفسها.
const LIVE_CHUNK = 10; // أقصى عدد آيات في الجزء الواحد (عشان الذاكرة)
const live = {
  items: load('liveQueue', []), opts: { aspect: '16:9', mode: 'text', after: 'loop', badge: true, next: true, title: '', ...load('liveOpts', {}) },
  win: null, ac: null, canvas: document.createElement('canvas'), on: false, amb: null, t0: 0,
  pos: null, cur: null, nextJob: null, countdownEnd: 0, raf: 0, msg: '', session: 0,
};
const saveLive = () => { save('liveQueue', live.items.map(({ id, label, blocks, reciter, video, dur }) => ({ id, label, blocks, reciter, video, dur }))); save('liveOpts', live.opts); };
// فيديوهات القايمة (ملفات MP4 متصدّرة قبل كده) — الملفات نفسها في IndexedDB
const liveFiles = new Map();
async function liveVideoFile(it) {
  if (!liveFiles.has(it.id)) liveFiles.set(it.id, await loadLiveVideo(it.id));
  return liveFiles.get(it.id);
}

// أجزاء العنصر: السورة الطويلة بتتقسم كل LIVE_CHUNK آية (البسملة مع أول جزء بس)
function liveParts(it) {
  if (it.video) return [[]]; // الفيديو جزء واحد
  const parts = [];
  let other = [];
  for (const b of it.blocks) {
    if (b.type !== 'quran' || b.rec || b.to - b.from < LIVE_CHUNK) { other.push(b); continue; }
    if (other.length) { parts.push(other); other = []; }
    for (let a = b.from; a <= b.to; a += LIVE_CHUNK) {
      parts.push([{ ...b, id: uid(), from: a, to: Math.min(b.to, a + LIVE_CHUNK - 1), basmala: b.basmala && a === b.from }]);
    }
  }
  if (other.length) parts.push(other);
  return parts;
}

// بيجهّز جزء (تحميل التلاوة وبناء الصوت) — بقارئ العنصر نفسه
async function liveBuild(it, part) {
  if (it.video) {
    const file = await liveVideoFile(it);
    if (!file) throw new Error(`ملف الفيديو «${it.label}» مش موجود في المتصفح ده — ارفعه تاني`);
    return { video: file, label: it.label };
  }
  const saved = state.style;
  state.style = { ...saved, reciter: it.reciter || saved.reciter };
  const p = buildSegments(true, null, part, null);
  state.style = saved; // buildSegments بياخد نسخته من الإعدادات أول ما يبدأ
  let segs = await p;
  if (saved.intro && segs[0]?.kind === 'title') segs = segs.slice(1); // الافتتاحية للريلز بس
  if (!segs.length) throw new Error('الجزء فاضي');
  const timeline = buildTimeline(segs, { gap: Number(saved.gap) || 0, ambient: state.ambient?.buffer, ambientVolume: state.ambient ? state.ambientVolume : 0 });
  return { segs, timeline, label: it.label };
}

// اللي بعد الموضع ده (ولو القايمة خلصت: حسب الاختيار)
function liveNextPos(pos) {
  if (!live.items.length) return null;
  if (pos) {
    const i = live.items.findIndex(x => x.id === pos.id);
    if (i >= 0 && pos.part + 1 < liveParts(live.items[i]).length) return { id: pos.id, part: pos.part + 1 };
    if (i >= 0 && i + 1 < live.items.length) return { id: live.items[i + 1].id, part: 0 };
    if (i < 0) return { id: live.items[0].id, part: 0 };
    if (live.opts.after === 'loop') return { id: live.items[0].id, part: 0 };
    if (live.opts.after === 'next') {
      const it = liveContinue(live.items[i]);
      if (it) { live.items.push(it); saveLive(); renderLive(); return { id: it.id, part: 0 }; }
    }
    return null;
  }
  return { id: live.items[0].id, part: 0 };
}

// «يكمّل اللي بعده في المصحف»: نفس الطول من بعد آخر آية، أو السورة اللي بعدها كاملة
function liveContinue(it) {
  const q = [...it.blocks].reverse().find(b => b.type === 'quran' && !b.rec);
  if (!q) return null;
  const s = Q.surah(q.surah);
  let r;
  if (q.from === 1 && q.to === s.count) {
    const n = q.surah % 114 + 1;
    r = { surah: n, from: 1, to: Q.surah(n).count };
  } else if (q.to < s.count) {
    r = { surah: q.surah, from: q.to + 1, to: Math.min(s.count, q.to + 1 + (q.to - q.from)) };
  } else {
    r = { surah: q.surah % 114 + 1, from: 1, to: Q.surah(q.surah % 114 + 1).count };
  }
  return { id: uid(), label: refLabel(r), blocks: [quranRefBlock(r, true)], reciter: it.reciter };
}

function liveItemAt(pos) { return pos && live.items.find(x => x.id === pos.id); }

// يجهّز الجزء الجاي في الخلفية
function livePrepareNext() {
  const pos = liveNextPos(live.pos);
  const it = liveItemAt(pos);
  if (!it) { live.nextJob = null; return; }
  const part = liveParts(it)[pos.part];
  live.nextJob = { pos, promise: liveBuild(it, part).catch(e => ({ error: e })) };
}

async function liveAdvance() {
  if (!live.on) return;
  if (!live.nextJob) livePrepareNext();
  const job = live.nextJob;
  live.cur = null;
  // القايمة خلصت: شاشة الانتظار (والموضع بيفضل، عشان أي حاجة تتضاف بعدين تشتغل هي)
  if (!job) { live.msg = ''; renderLive(); return; }
  live.msg = '⏳ بيجهّز…';
  renderLive();
  const proj = await job.promise;
  if (!live.on || live.nextJob !== job) return;
  live.nextJob = null;
  live.pos = job.pos;
  if (proj.error) {
    // جزء فشل (نت أو قارئ): نسيبه ونكمّل، من غير ما البث يقف
    live.msg = '⚠️ ' + (proj.error.message || proj.error).split('\n')[0];
    renderLive();
    const ses = live.session;
    setTimeout(() => { if (live.session === ses) liveAdvance(); }, 1500);
    return;
  }
  if (proj.video) {
    // فيديو جاهز: بيتعرض زي ما هو (بصوته)، ولما يخلص نكمّل
    // الفيديو جوه نافذة البث نفسها (هي اللي لازم تفضل ظاهرة) عشان المتصفح مايوقفوش لو نافذة البرنامج اتصغّرت
    const doc = live.win && !live.win.closed ? live.win.document : document;
    const v = doc.createElement('video');
    v.src = URL.createObjectURL(proj.video);
    v.playsInline = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px;z-index:-1;pointer-events:none'; // ورا الرسم (لو مخفي خالص المتصفح بيوقفه)
    doc.body.appendChild(v);
    const stopV = () => { v.pause(); v.remove(); URL.revokeObjectURL(v.src); };
    v.onended = () => { if (live.cur?.video === v) { stopV(); liveAdvance(); } };
    v.onerror = () => { if (live.cur?.video === v) { stopV(); live.msg = `⚠️ تعذر تشغيل «${proj.label}»`; live.cur = null; renderLive(); const ses = live.session; setTimeout(() => { if (live.session === ses) liveAdvance(); }, 1500); } };
    live.cur = { label: proj.label, video: v, stopV, segs: [], src: { stop: stopV } };
    live.msg = '';
    try { await v.play(); } catch { v.muted = true; await v.play().catch(() => {}); live.msg = '⚠️ المتصفح منع الصوت — اضغط في صفحة البرنامج مرة'; }
    renderLive();
    livePrepareNext();
    return;
  }
  const ac = live.ac;
  const buf = ac.createBuffer(2, proj.timeline.left.length, 44100);
  buf.copyToChannel(proj.timeline.left, 0);
  buf.copyToChannel(proj.timeline.right, 1);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser).connect(ac.destination);
  const startAt = ac.currentTime + 0.1;
  src.start(startAt);
  const list = state.style.bgType === 'media' ? state.mediaList : [];
  live.cur = { ...proj, src, analyser, startAt, duration: proj.timeline.duration, bgSched: list.length > 1 ? bgSchedule(proj.segs, proj.timeline.duration, list.length, state.style, list.map(m => m.secs)) : null };
  src.onended = () => { if (live.cur?.src === src) liveAdvance(); };
  live.msg = '';
  renderLive();
  livePrepareNext();
}

// وضع المناظر من غير قايمة (صوت طبيعة أو سكوت)
const liveScenicOnly = () => live.opts.mode === 'ambient' || live.opts.mode === 'silent';
function liveScenicStart() {
  if (!live.on) return;
  live.t0 = live.ac.currentTime;
  if (live.opts.mode === 'ambient' && state.ambient?.buffer) {
    const src = live.ac.createBufferSource();
    src.buffer = state.ambient.buffer;
    src.loop = true;
    const g = live.ac.createGain();
    g.gain.value = Math.max(0.05, Math.min(1, state.ambientVolume * 3)); // لوحده من غير تلاوة: أعلى من مستوى الخلفية
    src.connect(g).connect(live.ac.destination);
    src.start();
    live.amb = src;
  }
  renderLive();
}

// فيديوهات الخلفية بتاعة البث: نسخة جوه نافذة البث نفسها. النسخة اللي في صفحة البرنامج المتصفح بيبطّأها
// أو يوقفها لما الصفحة تتصغّر أو تبقى ورا، فالمنظر كان بيقف في البث
const liveBgEls = new Map();
function liveBgPrune() {
  const keep = new Map(state.mediaList.map(m => [m.id, m.url]));
  for (const [id, v] of liveBgEls) {
    if (keep.get(id) !== v.src) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); liveBgEls.delete(id); }
  }
}
function liveBg(m) {
  if (!m || m.kind !== 'video' || !live.win || live.win.closed) return m;
  let v = liveBgEls.get(m.id);
  if (!v || v.ownerDocument !== live.win.document) {
    v = live.win.document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, src: m.url });
    v.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px;z-index:-1;pointer-events:none';
    live.win.document.body.appendChild(v);
    v.play().catch(() => {});
    liveBgEls.set(m.id, v);
  }
  if (v.paused) v.play().catch(() => {});
  return { ...m, el: v };
}
const LIVE_FPS = 30; // البث 30 فريم — الرسم أكتر من كده تقل على الجهاز من غير فايدة

// رسم فريم البث
function liveDraw(now) {
  const win = live.win;
  if (!live.on) return;
  if (!win || win.closed) { liveStop(); status('نافذة البث اتقفلت — البث وقف.'); return; }
  if (now && live.lastFrame && now - live.lastFrame < 1000 / LIVE_FPS - 4) { live.raf = win.requestAnimationFrame(liveDraw); return; }
  live.lastFrame = now || 0;
  // الخلفيات اللي اتشالت أو اتغيّرت: نوقف الفيديو بتاعها (كل 5 ثواني)
  if (!live.lastPrune || live.lastFrame - live.lastPrune > 5000) { live.lastPrune = live.lastFrame; liveBgPrune(); }
  const { w: W, h: H } = ASPECTS[live.opts.aspect] || ASPECTS['16:9'];
  const c = live.canvas;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  const all = state.style.bgType === 'media' ? state.mediaList : [];
  // 🎛️ خلفية أو مجموعة خلفيات مختارة من غرفة التحكم
  const sub = ctrl.bgNames ? all.filter(m => ctrl.bgNames.has(m.file.name)) : null;
  const list = sub?.length ? sub : all;
  const cur = live.cur;
  const t = cur ? live.ac.currentTime - cur.startAt : 0;
  let bg = list[0] || bgMedia(), prev = null, alpha = 1;
  if (sub?.length) {
    if (sub.length > 1) {
      const every = Math.max(6, Number(state.style.bgEvery) || 12), sec = (now || 0) / 1000;
      const k = Math.floor(sec / every) % sub.length, x = sec % every;
      bg = sub[k];
      if (state.style.bgFade !== false && x < 1) { prev = sub[(k - 1 + sub.length) % sub.length]; alpha = x; }
    }
  } else if (cur?.bgSched) {
    const p = pickBg(cur.bgSched, Math.max(0, t), state.style.bgFade !== false ? 0.6 : 0);
    bg = list[p.cur.k]; prev = p.prev && list[p.prev.k]; alpha = p.alpha;
  } else if (liveScenicOnly() && list.length > 1 && live.t0) {
    // من غير قايمة: كل خلفية بمدتها (أو كل «bgEvery» ثانية، أقل حاجة 8)، ودوران على طول
    const every = Math.max(8, Number(state.style.bgEvery) || 15);
    const durs = list.map(m => (m.kind === 'video' && m.secs ? Math.max(every, m.secs) : every));
    const total = durs.reduce((a, b) => a + b, 0);
    let x = (live.ac.currentTime - live.t0) % total, k = 0;
    while (x >= durs[k]) { x -= durs[k]; k++; }
    bg = list[k];
    const fade = state.style.bgFade !== false ? 1.2 : 0;
    if (fade && x < fade) { prev = list[(k - 1 + list.length) % list.length]; alpha = x / fade; }
  }
  g.clearRect(0, 0, W, H);
  const drawBgs = () => {
    if (prev) drawBackground(g, W, H, state.style, liveBg(prev));
    g.globalAlpha = alpha;
    drawBackground(g, W, H, state.style, liveBg(bg));
    g.globalAlpha = 1;
  };
  if (ctrl.fx.kenburns && !cur?.video) FX.kenBurns(g, W, H, (now || 0) / 1000, drawBgs); else drawBgs();
  if (!cur?.video) ctrl.particles.draw(g, W, H, now || performance.now());
  const unit = Math.min(W, H) / 1080;
  const scenic = live.opts.mode !== 'text';
  const counting = live.countdownEnd > Date.now();
  if (cur?.video) {
    // الفيديو الجاهز: لو مقاسه مختلف عن البث، بيتحط في النص وورا منه نفس الفيديو مكبّر وضبابي
    const v = cur.video, vw = v.videoWidth || W, vh = v.videoHeight || H;
    const fit = Math.min(W / vw, H / vh), cover = Math.max(W / vw, H / vh);
    if (Math.abs(vw / vh - W / H) > 0.02) {
      g.save(); g.filter = 'blur(40px) brightness(.6)';
      g.drawImage(v, (W - vw * cover) / 2, (H - vh * cover) / 2, vw * cover, vh * cover);
      g.restore();
    }
    g.drawImage(v, (W - vw * fit) / 2, (H - vh * fit) / 2, vw * fit, vh * fit);
  } else if (scenic && !counting) {
    // مناظر بس: من غير أي كتابة
  } else if (cur) {
    let i = 0;
    for (let k = 0; k < cur.segs.length; k++) if (cur.segs[k].start <= t + 0.05) i = k;
    const seg = cur.segs[i];
    drawOverlay(g, W, H, seg.wordTimes ? { ...seg, wordCount: WT.shownAt(seg.wordTimes, t - seg.start) } : seg, state.style);
    if (state.style.waveform) drawWave(g, W, H, cur.analyser, state.style.accent);
  } else {
    // شاشة الانتظار / العد التنازلي
    const left = Math.max(0, Math.ceil((live.countdownEnd - Date.now()) / 1000));
    const title = live.opts.title || 'قرآن يريح القلب 🤍';
    const sub = left ? `البث يبدأ بعد ${Q.arabicNum(Math.floor(left / 60))}:${Q.arabicNum(String(left % 60).padStart(2, '0'))}` : (live.msg || (live.items.length ? '' : 'انتظرونا'));
    drawOverlay(g, W, H, { kind: 'title', text: title, sub, label: '', footer: '' }, state.style);
  }
  // الشارات الصغيرة: «تلاوة مسجّلة» و«التالي»
  g.save();
  g.font = `600 ${Math.round(30 * unit)}px ${TEXT_FONT}`;
  g.textBaseline = 'middle';
  g.direction = 'rtl';
  const pill = (text, x, y, color) => {
    const w = g.measureText(text).width + 36 * unit, h = 52 * unit;
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath(); g.roundRect(x - w, y, w, h, h / 2); g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.fillText(text, x - w / 2, y + h / 2 + 2 * unit);
  };
  const m = 28 * unit;
  if (live.opts.badge && cur && !scenic) pill('● تلاوة مسجّلة', W - m, m, '#ffb4b4');
  const ni = live.nextJob && liveItemAt(live.nextJob.pos);
  const tickerBottom = ctrl.fx.ticker.on && !ctrl.fx.ticker.top ? 70 * unit : 0;
  if (live.opts.next && cur && !scenic && ni && ni.id !== live.pos?.id) pill(`التالي: ${ni.label}`, W - m, H - m - 52 * unit - tickerBottom, '#ffffff');
  g.restore();
  let curSeg = null;
  if (cur && !cur.video && cur.segs.length) { curSeg = cur.segs[0]; for (const sg of cur.segs) if (sg.start <= t + 0.05) curSeg = sg; }
  ctrlDrawOverlays(g, W, H, now || performance.now(), curSeg, cur);
  // للنافذة (بحجمها)
  const out = win.document.getElementById('c');
  if (out) {
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    out.getContext('2d').drawImage(c, 0, 0);
  }
  live.raf = win.requestAnimationFrame(liveDraw);
}

function liveOpenWindow() {
  const { w, h } = ASPECTS[live.opts.aspect] || ASPECTS['16:9'];
  const k = Math.min(1, (screen.availWidth * 0.6) / w, (screen.availHeight * 0.8) / h);
  const win = window.open('', 'qcs-live', `popup,width=${Math.round(w * k)},height=${Math.round(h * k)}`);
  if (!win) return null;
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>🔴 بث — ${escapeHtml(live.opts.title || 'قرآن يريح القلب')}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100vw;height:100vh;object-fit:contain;display:block}</style></head>
<body><canvas id="c"></canvas></body></html>`);
  win.document.close();
  win.addEventListener('keydown', ctrlHotkey); // أزرار المشاهد شغالة كمان لو نافذة البث هي اللي عليها التركيز
  return win;
}

async function liveStart() {
  if (live.on) return;
  const win = liveOpenWindow();
  if (!win) { alert('المتصفح منع فتح نافذة البث. اسمح بالنوافذ المنبثقة (Pop-ups) للموقع ده وجرّب تاني.'); return; }
  live.win = win;
  live.on = true;
  const ses = ++live.session;
  live.ac = new AudioContext({ sampleRate: 44100 });
  live.pos = null; live.cur = null; live.nextJob = null;
  for (const m of state.mediaList) if (m.kind === 'video') { m.el.loop = true; m.el.play().catch(() => {}); }
  const mins = Math.max(0, Number($('#live-countdown').value) || 0);
  live.countdownEnd = Date.now() + mins * 60000;
  liveDraw();
  renderLive();
  if (liveScenicOnly()) {
    if (live.opts.mode === 'ambient' && !state.ambient?.buffer) status('⚠️ مفيش صوت طبيعة مختار — اختاره من «٢ الصوت» ← صوت الخلفية. البث شغال من غير صوت لحد ما تختار.', null, true);
    setTimeout(() => { if (live.session === ses) liveScenicStart(); }, mins * 60000);
  } else {
    if (live.items.length) livePrepareNext(); // بيجهّز أول جزء وقت العد التنازلي
    setTimeout(() => { if (live.session === ses) liveAdvance(); }, mins * 60000);
  }
}

function liveStop() {
  if (!live.on) return;
  live.on = false;
  live.session++;
  try { live.cur?.src.stop(); } catch { /* اتوقف */ }
  try { live.amb?.stop(); } catch { /* اتوقف */ }
  live.amb = null; live.t0 = 0; live.lastFrame = 0;
  for (const v of liveBgEls.values()) { v.pause(); v.remove(); }
  liveBgEls.clear();
  live.ac?.close();
  live.ac = null; live.cur = null; live.pos = null; live.nextJob = null; live.msg = '';
  if (live.win && !live.win.closed) live.win.close();
  live.win = null;
  renderLive();
}

function liveSkip() {
  if (!live.on || !live.cur) return;
  const src = live.cur.src;
  live.cur = null;
  try { src.stop(); } catch { /* اتوقف */ }
  liveAdvance();
}

function renderLive() {
  const ol = $('#live-list');
  if (!ol) return;
  ol.innerHTML = '';
  live.items.forEach((it, i) => {
    const li = document.createElement('li');
    const now = !!live.cur && live.pos?.id === it.id;
    li.className = 'part' + (now ? ' live-now' : '');
    li.innerHTML = `<span class="pname"></span><span class="pinfo"></span>
      <button class="btn icon" type="button" data-a="play" title="شغّله دلوقتي">▶</button>
      <button class="btn icon" type="button" data-a="up" title="لفوق">↑</button>
      <button class="btn icon" type="button" data-a="down" title="لتحت">↓</button>
      <button class="btn icon" type="button" data-a="del" title="شيل من القايمة">✕</button>`;
    const parts = liveParts(it).length;
    li.querySelector('.pname').textContent = `${Q.arabicNum(i + 1)}. ${it.label}`;
    li.querySelector('.pinfo').textContent = [it.video ? `🎞️ فيديو${it.dur ? ` • ${fmtDur(it.dur)}` : ''}` : findReciter(it.reciter || state.style.reciter)?.name, parts > 1 && (now ? `الجزء ${Q.arabicNum(live.pos.part + 1)} من ${Q.arabicNum(parts)}` : `${Q.arabicNum(parts)} أجزاء`), now && '🔴 شغّال'].filter(Boolean).join(' • ');
    const mv = d => { const j = i + d; if (j < 0 || j >= live.items.length) return; [live.items[i], live.items[j]] = [live.items[j], live.items[i]]; liveQueueChanged(); };
    li.querySelector('[data-a=up]').onclick = () => mv(-1);
    li.querySelector('[data-a=down]').onclick = () => mv(1);
    li.querySelector('[data-a=del]').onclick = () => {
      live.items.splice(i, 1);
      if (it.video) { deleteLiveVideo(it.id); liveFiles.delete(it.id); }
      // لو اتشال اللي شغّال: الجزء الحالي بيكمّل، وبعده اللي كان بعده في الترتيب
      if (live.pos?.id === it.id) {
        const p = live.items[i - 1];
        live.pos = p ? { id: p.id, part: liveParts(p).length - 1 } : null;
      }
      liveQueueChanged();
    };
    li.querySelector('[data-a=play]').onclick = () => {
      if (!live.on) { live.items.unshift(...live.items.splice(i, 1)); liveQueueChanged(); liveStart(); return; }
      live.nextJob = null;
      const job = { pos: { id: it.id, part: 0 }, promise: liveBuild(it, liveParts(it)[0]).catch(e => ({ error: e })) };
      live.nextJob = job;
      if (live.cur) { const src = live.cur.src; live.cur = null; try { src.stop(); } catch { /* */ } }
      liveAdvance();
    };
    ol.appendChild(li);
  });
  $('#live-empty').hidden = live.items.length > 0;
  $('#live-start').disabled = live.on;
  $('#live-skip').disabled = !live.on || !live.cur;
  $('#live-stop').disabled = !live.on;
  $('#live-state').textContent = live.on ? '— 🔴 شغّال' : '';
  const cur = live.cur;
  $('#live-mode').disabled = live.on;
  $('#live-mode-hint').hidden = live.opts.mode === 'text';
  $('#live-after').disabled = liveScenicOnly();
  $('#live-now').textContent = !live.on ? '' : liveScenicOnly() ? (live.countdownEnd > Date.now() ? '⏳ عد تنازلي…' : `🌿 مناظر شغّالة${live.amb ? ` + ${state.ambient?.name || 'صوت الطبيعة'}` : live.opts.mode === 'ambient' ? ' (من غير صوت — اختار صوت الخلفية واعمل وقّف وابدأ تاني)' : ''}`) : cur ? `🔴 دلوقتي: ${cur.label}${live.msg ? ' — ' + live.msg : ''}` : live.countdownEnd > Date.now() ? '⏳ عد تنازلي…' : live.msg || (live.items.length ? '' : 'القايمة فاضية — شاشة الانتظار ظاهرة. ضيف حاجة وهتبدأ لوحدها.');
}

// القايمة اتغيّرت: الجزء الجاي المتجهّز ممكن مايبقاش هو اللي بعده
function liveQueueChanged() {
  saveLive();
  if (live.on && live.nextJob) {
    const want = liveNextPos(live.pos);
    if (!want || want.id !== live.nextJob.pos.id || want.part !== live.nextJob.pos.part) { live.nextJob = null; if (live.cur) livePrepareNext(); }
  }
  if (live.on && !liveScenicOnly() && !live.cur && !live.nextJob && live.countdownEnd <= Date.now() && !live.msg) liveAdvance();
  renderLive();
}

function setupLive() {
  const o = live.opts;
  $('#live-aspect').value = o.aspect; $('#live-after').value = o.after; $('#live-mode').value = o.mode;
  $('#live-mode').onchange = () => { o.mode = $('#live-mode').value; saveLive(); renderLive(); };
  $('#live-badge').checked = o.badge; $('#live-next').checked = o.next; $('#live-title').value = o.title;
  $('#live-aspect').onchange = () => {
    o.aspect = $('#live-aspect').value; saveLive();
    // المقاس اتغيّر: نكبّر النافذة على الشكل الجديد
    if (live.win && !live.win.closed) {
      const { w, h } = ASPECTS[o.aspect];
      const k = Math.min(1, (screen.availWidth * 0.6) / w, (screen.availHeight * 0.8) / h);
      try { live.win.resizeTo(Math.round(w * k), Math.round(h * k) + (live.win.outerHeight - live.win.innerHeight)); } catch { /* */ }
    }
  };
  $('#live-after').onchange = () => { o.after = $('#live-after').value; liveQueueChanged(); };
  $('#live-badge').onchange = () => { o.badge = $('#live-badge').checked; saveLive(); };
  $('#live-next').onchange = () => { o.next = $('#live-next').checked; saveLive(); };
  $('#live-title').onchange = () => { o.title = $('#live-title').value.trim(); saveLive(); };
  $('#live-add').onclick = () => {
    const { ok, bad } = parseRefs($('#live-input').value, Q.surahs());
    for (const r of ok) live.items.push({ id: uid(), label: refLabel(r), blocks: [quranRefBlock(r, true)], reciter: state.style.reciter });
    $('#live-input').value = bad.join('\n');
    liveQueueChanged();
    if (bad.length) status('السطور اللي فضلت في الخانة مش مفهومة — اكتبها زي «الكهف» أو «يوسف 4-6» أو «12:4-6»', null, true);
  };
  $('#live-files').onchange = async () => {
    const files = [...$('#live-files').files].filter(f => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(f.name));
    $('#live-files').value = '';
    for (const file of files) {
      const id = uid();
      const dur = await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = () => res(0); v.src = URL.createObjectURL(file); });
      liveFiles.set(id, file);
      await saveLiveVideo(id, file);
      live.items.push({ id, label: file.name.replace(/\.[^.]+$/, ''), blocks: [], video: true, dur });
    }
    if (files.length) { liveQueueChanged(); status(`✅ اتضاف ${Q.arabicNum(files.length)} فيديو لقايمة البث`); }
  };
  $('#live-add-current').onclick = () => {
    if (!state.blocks.length) return;
    if (!confirmGrades()) return;
    // نسخة بأرقام جديدة، ومعاها الأصوات المسجّلة (عشان لو اتشالت من المحرر)
    const empty = state.blocks.filter(b => b.type !== 'quran' && !String(b.text || '').trim()).length;
    const blocks = structuredClone(state.blocks.filter(b => b.type === 'quran' || String(b.text || '').trim())).map(b => {
      const id = uid(), au = hadithAudio.get(b.id);
      if (au) hadithAudio.set(id, { ...au });
      return { ...b, id };
    });
    if (!blocks.length) { status('المحتوى فاضي — اكتب النص أو ضيف آيات الأول.', null, true); return; }
    live.items.push({ id: uid(), label: blocksLabel(blocks), blocks, reciter: state.style.reciter });
    liveQueueChanged();
    status(`✅ المحتوى الحالي اتضاف لقايمة البث${empty ? ` (من غير ${Q.arabicNum(empty)} كارت فاضي)` : ''}`);
  };
  $('#live-start').onclick = liveStart;
  $('#live-stop').onclick = () => { if (confirm('توقّف البث؟')) liveStop(); };
  $('#live-skip').onclick = liveSkip;
  $('#btn-live').onclick = () => { renderLive(); $('#dlg-live').showModal(); };
  $('#live-close').onclick = () => $('#dlg-live').close();
  setInterval(() => { if (live.on && $('#dlg-live').open) renderLive(); }, 1000);
  window.addEventListener('beforeunload', e => { if (live.on) { e.preventDefault(); e.returnValue = ''; } });
}

// ===== الفيديو المرجعي =====
const refs = { list: load('refs', []), current: null };
const REF_ICONS = { tiktok: '🎵', instagram: '📸', facebook: '📘', youtube: '▶️', pinterest: '📌' };

function showRef(url) {
  const e = embedFor(url);
  const msg = $('#ref-msg');
  $('#ref-player').hidden = true;
  $('#ref-frame').removeAttribute('src');
  refs.current = null;
  if (!e) { msg.textContent = 'اللينك ده مش من تيك توك أو إنستجرام أو فيسبوك أو يوتيوب أو Pinterest.'; return; }
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

// ===== 🎛️ غرفة التحكم في البث =====
// مشاهد جاهزة (بأزرار 1–9)، اختيار الخلفية فورًا، مؤثرات، طبقات فوق البث، كارت «اعرض دلوقتي»، ملصقات Lottie، والتحكم في OBS
const FX_DEFAULT = {
  particles: 'none', density: 1, kenburns: false,
  lower: { on: false, auto: true, title: '', sub: '' },
  ticker: { on: false, text: 'اشترك في القناة وفعّل الجرس 🔔 — وشارك البث لعله يكون صدقة جارية 🤍', speed: 1, top: false },
  clock: { on: false },
  prayer: { on: false, city: 'Makkah|SA' },
  logo: { on: false, data: '', pos: 'tl', size: 0.1 },
  qr: { on: false, url: '', pos: 'bl', size: 0.16 },
};
const ctrl = {
  fx: { ...structuredClone(FX_DEFAULT), ...load('liveFx', {}) },
  scenes: load('liveScenes', []),
  particles: new FX.Particles(),
  bgNames: null,
  card: null,
  stickers: [], // { id, name, json, pos, size, on, anim }
  logoImg: null, qrImg: null, prayer: null, trans: null,
  obs: new OBS(), obsTimer: 0,
};
for (const k of Object.keys(FX_DEFAULT)) if (typeof FX_DEFAULT[k] === 'object') ctrl.fx[k] = { ...FX_DEFAULT[k], ...(ctrl.fx[k] || {}) };
ctrl.particles.set(ctrl.fx.particles, ctrl.fx.density);
const saveFx = () => { if (!save('liveFx', ctrl.fx)) status('⚠️ مساحة التخزين في المتصفح اتملت — الإعدادات دي مش هتتحفظ. جرّب لوجو أصغر أو امسح مشاهد.', null, true); };
const saveScenes = () => { if (!save('liveScenes', ctrl.scenes)) status('⚠️ مساحة التخزين في المتصفح اتملت — المشهد ده مش هيتحفظ.', null, true); };
const PRAYER_CITIES = { 'Makkah|SA': 'مكة المكرمة', 'Madinah|SA': 'المدينة المنورة', 'Riyadh|SA': 'الرياض', 'Jeddah|SA': 'جدة', 'Cairo|EG': 'القاهرة', 'Alexandria|EG': 'الإسكندرية', 'Dubai|AE': 'دبي', 'Kuwait City|KW': 'الكويت', 'Doha|QA': 'الدوحة' };

function ctrlDrawOverlays(g, W, H, now, seg, cur) {
  const f = ctrl.fx, acc = state.style.accent || '#f4d58d', u = Math.min(W, H) / 1080;
  // تخطيط الأركان عشان الطبقات ماتركبش على بعض: الشريط المتحرك، وشارة «تلاوة مسجّلة» فوق يمين، والساعة فوق شمال
  const tickT = f.ticker.on && f.ticker.top ? 70 * u : 0, tickB = f.ticker.on && !f.ticker.top ? 70 * u : 0;
  const pillTR = live.opts.badge && cur && live.opts.mode === 'text' ? 70 * u : 0;
  const prayer = f.prayer.on ? FX.nextPrayerText(ctrl.prayer) : '';
  FX.drawTicker(g, W, H, f.ticker, acc, now);
  const clockH = FX.drawClock(g, W, H, { on: f.clock.on }, acc, Date.now(), prayer, tickT);
  const used = { tl: tickT + (clockH || 0), tr: tickT + pillTR, bl: tickB, br: tickB };
  const place = pos => (pos === 'c' ? {} : pos.includes('t') ? { t: used[pos] } : { b: used[pos] });
  const bump = (pos, h) => { if (pos !== 'c') used[pos] += h + 12 * u; };
  if (f.logo.on && ctrl.logoImg?.naturalWidth) {
    const r = FX.cornerRect(W, H, ctrl.logoImg.naturalWidth, ctrl.logoImg.naturalHeight, f.logo.pos, f.logo.size, place(f.logo.pos));
    FX.drawCornerImage(g, W, H, ctrl.logoImg, f.logo.pos, f.logo.size, 0.92, place(f.logo.pos));
    bump(f.logo.pos, r.h);
  }
  if (f.qr.on && ctrl.qrImg) {
    const r = FX.cornerRect(W, H, ctrl.qrImg.width, ctrl.qrImg.height, f.qr.pos, f.qr.size, place(f.qr.pos));
    FX.drawCornerImage(g, W, H, ctrl.qrImg, f.qr.pos, f.qr.size, 1, place(f.qr.pos));
    bump(f.qr.pos, r.h);
  }
  for (const st of ctrl.stickers) {
    if (!st.on || !st.anim) continue;
    const c = st.anim.frameAt(now / 1000);
    const r = FX.cornerRect(W, H, c.width, c.height, st.pos, st.size, place(st.pos));
    g.drawImage(c, r.x, r.y, r.w, r.h);
    bump(st.pos, r.h);
  }
  if (f.lower.on) {
    let title = f.lower.title, sub = f.lower.sub;
    if (f.lower.auto && seg) { title = (seg.label || '').split('•')[0].trim() || title; sub = seg.footer || sub; }
    FX.drawLowerThird(g, W, H, { on: true, title, sub, since: ctrl.lowerSince || 0 }, acc, now);
  }
  FX.drawCard(g, W, H, ctrl.card, state.style, Date.now());
  // انتقال ناعم بين المشاهد: الصورة القديمة بتختفي فوق الجديدة
  if (ctrl.trans) {
    const a = 1 - (now - ctrl.trans.t0) / 700;
    if (a <= 0) ctrl.trans = null;
    else { g.save(); g.globalAlpha = a; g.drawImage(ctrl.trans.c, 0, 0, W, H); g.restore(); }
  }
}

// ساعة نافذة البث (الرسم هناك بيستخدمها) — مختلفة عن ساعة صفحة البرنامج
const ctrlNow = () => (live.win && !live.win.closed ? live.win.performance.now() : performance.now());

function ctrlSnapshot() {
  if (!live.on || !live.canvas.width) return;
  const c = document.createElement('canvas');
  c.width = live.canvas.width; c.height = live.canvas.height;
  c.getContext('2d').drawImage(live.canvas, 0, 0);
  ctrl.trans = { c, t0: ctrlNow() };
}

// ===== المشاهد =====
const SCENE_STYLE = ['bgType', 'color1', 'color2', 'dim', 'textColor', 'subColor', 'accent', 'textSize', 'labelScale', 'wordMode', 'showLabel', 'showFooter', 'waveform', 'bgSwitch', 'bgEvery', 'bgFade'];
function saveScene() {
  const name = (prompt('اسم المشهد (مثلًا: ليلي هادي، فجر، جمعة):', `مشهد ${ctrl.scenes.length + 1}`) || '').trim();
  if (!name) return;
  ctrl.scenes.push({
    id: uid(), name,
    style: Object.fromEntries(SCENE_STYLE.map(k => [k, state.style[k]])),
    bgNames: ctrl.bgNames ? [...ctrl.bgNames] : null,
    fx: { ...structuredClone(ctrl.fx), logo: { ...ctrl.fx.logo, data: '' } }, // اللوجو مش بيتكرر في كل مشهد
  });
  saveScenes(); renderCtrl();
  status(`✅ اتحفظ «${name}» — اضغط ${Q.arabicNum(ctrl.scenes.length)} على الكيبورد وانت بتبث`);
}
function applyScene(i) {
  const sc = ctrl.scenes[i];
  if (!sc) return;
  ctrlSnapshot();
  Object.assign(state.style, sc.style);
  T.rememberStyle(state.style);
  applyStyleToInputs();
  ctrl.bgNames = sc.bgNames?.length ? new Set(sc.bgNames) : null;
  // اللوجو بيفضل زي ما هو (مش جزء من المشهد عشان الحجم)
  ctrl.fx = { ...structuredClone(sc.fx), logo: { ...sc.fx.logo, data: ctrl.fx.logo.data } };
  ctrl.particles.set(ctrl.fx.particles, ctrl.fx.density);
  if (ctrl.fx.lower.on) ctrl.lowerSince = ctrlNow();
  ctrlLoadAssets();
  saveFx(); renderCtrl(); refreshPreview();
  status(`🎬 ${sc.name}`);
}
function ctrlHotkey(e) {
  if (!live.on || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
  const d = e.code?.match(/^(?:Digit|Numpad)([1-9])$/)?.[1];
  if (d) { e.preventDefault(); applyScene(+d - 1); }
}

async function ctrlLoadAssets() {
  const f = ctrl.fx;
  if (f.logo.data && ctrl.logoSrc !== f.logo.data) {
    const im = new Image(); im.src = f.logo.data; ctrl.logoImg = im; ctrl.logoSrc = f.logo.data;
  }
  if (f.qr.on && f.qr.url && ctrl.qrSrc !== f.qr.url) {
    try { ctrl.qrImg = await FX.qrCanvas(f.qr.url, 480); ctrl.qrSrc = f.qr.url; } catch (e) { status('❌ ' + e.message, null, true); }
  }
  if (f.prayer.on) {
    const [city, country] = f.prayer.city.split('|');
    try { ctrl.prayer = await FX.loadPrayer(city, country); } catch (e) { $('#ctrl-prayer-st').textContent = '❌ ' + e.message; }
  }
}

// ===== OBS =====
async function obsConnect() {
  const st = $('#obs-status');
  const pw = $('#obs-pass').value;
  save('obsConn', { url: $('#obs-url').value.trim(), pass: pw });
  st.textContent = '…';
  try {
    await ctrl.obs.connect($('#obs-url').value.trim() || 'ws://127.0.0.1:4455', pw);
    ctrl.obs.onClose = () => { $('#obs-status').textContent = '⚪ الاتصال بـ OBS اتقطع'; clearInterval(ctrl.obsTimer); renderObs(false); };
    ctrl.obs.onEvent = (type) => { if (/StreamStateChanged|RecordStateChanged|CurrentProgramSceneChanged|InputMuteStateChanged|SceneListChanged/.test(type)) obsRefresh(); };
    st.textContent = '🟢 متوصّل بـ OBS';
    renderObs(true);
    await obsRefresh();
    clearInterval(ctrl.obsTimer);
    ctrl.obsTimer = setInterval(obsStats, 2000);
  } catch (e) { st.textContent = '❌ ' + e.message; renderObs(false); }
}
function renderObs(on) { document.querySelectorAll('.obs-on').forEach(el => { el.hidden = !on; }); }
async function obsRefresh() {
  try {
    const [stream, scenes, inputs] = await Promise.all([ctrl.obs.call('GetStreamStatus'), ctrl.obs.call('GetSceneList'), ctrl.obs.call('GetInputList')]);
    $('#obs-stream').textContent = stream.outputActive ? '⏹ وقّف البث في OBS' : '▶ ابدأ البث في OBS';
    $('#obs-stream').classList.toggle('danger', stream.outputActive);
    const sel = $('#obs-scene');
    sel.innerHTML = (scenes.scenes || []).slice().reverse().map(x => `<option>${escapeHtml(x.sceneName)}</option>`).join('');
    sel.value = scenes.currentProgramSceneName;
    const aud = (inputs.inputs || []).filter(i => /audio|wasapi|pulse|coreaudio|application/i.test(i.inputKind || '') || /audio|صوت|mic/i.test(i.inputName));
    const box = $('#obs-mutes');
    box.innerHTML = '';
    for (const i of aud) {
      const { inputMuted } = await ctrl.obs.call('GetInputMute', { inputName: i.inputName }).catch(() => ({}));
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn';
      b.textContent = `${inputMuted ? '🔇' : '🔊'} ${i.inputName}`;
      b.onclick = async () => { await ctrl.obs.call('ToggleInputMute', { inputName: i.inputName }).catch(err => status('❌ ' + err.message, null, true)); obsRefresh(); };
      box.appendChild(b);
    }
  } catch (e) { $('#obs-status').textContent = '❌ ' + e.message; }
}
async function obsStats() {
  if (!ctrl.obs.ready || !$('#dlg-ctrl').open) return;
  try {
    const [st, s] = await Promise.all([ctrl.obs.call('GetStats'), ctrl.obs.call('GetStreamStatus')]);
    const drop = s.outputTotalFrames ? (s.outputSkippedFrames / s.outputTotalFrames * 100) : 0;
    const prev = ctrl.obsBytes;
    ctrl.obsBytes = { b: s.outputBytes, t: Date.now() };
    const kbps = prev && s.outputActive ? Math.round((s.outputBytes - prev.b) * 8 / (ctrl.obsBytes.t - prev.t)) : 0;
    $('#obs-stats').textContent = [
      s.outputActive ? `🔴 بيبث ${s.outputTimecode?.split('.')[0] || ''}` : '⚪ مش بيبث',
      s.outputActive && `📶 ${kbps} kbps`,
      s.outputActive && `${drop > 1 ? '⚠️' : '✅'} فريمات ضايعة (النت) ${drop.toFixed(1)}%`,
      `🖥️ CPU ${Math.round(st.cpuUsage || 0)}%`,
      st.renderSkippedFrames ? `🎨 تأخير رسم ${st.renderSkippedFrames}` : '',
      st.outputSkippedFrames ? `⚙️ تأخير تشفير ${st.outputSkippedFrames}` : '',
    ].filter(Boolean).join('  •  ');
  } catch { /* بيحاول تاني */ }
}

// ===== رسم اللوحة =====
function renderCtrl() {
  const f = ctrl.fx;
  // المشاهد
  const sb = $('#ctrl-scenes');
  sb.innerHTML = '';
  ctrl.scenes.forEach((sc, i) => {
    const w = document.createElement('span');
    w.className = 'scene-btn';
    w.innerHTML = '<button class="btn" type="button"></button><button class="btn icon" type="button" title="امسح المشهد">✕</button>';
    w.children[0].textContent = `${i < 9 ? Q.arabicNum(i + 1) + ' ' : ''}${sc.name}`;
    w.children[0].onclick = () => applyScene(i);
    w.children[1].onclick = () => { if (confirm(`تمسح «${sc.name}»؟`)) { ctrl.scenes.splice(i, 1); saveScenes(); renderCtrl(); } };
    sb.appendChild(w);
  });
  if (!ctrl.scenes.length) sb.innerHTML = '<span class="muted">لسه مفيش مشاهد — ظبّط الشكل والمؤثرات واضغط «احفظ كمشهد».</span>';
  // الخلفيات
  const bb = $('#ctrl-bgs');
  bb.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button'; allBtn.className = 'btn' + (!ctrl.bgNames ? ' primary' : '');
  allBtn.textContent = '🔁 كل الخلفيات';
  allBtn.onclick = () => { ctrlSnapshot(); ctrl.bgNames = null; renderCtrl(); };
  bb.appendChild(allBtn);
  if (state.style.bgType !== 'media' || !state.mediaList.length) bb.insertAdjacentHTML('beforeend', '<span class="muted">ضيف خلفيات صور أو فيديو من «٣ الشكل» الأول.</span>');
  else for (const m of state.mediaList) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'bg-pick' + (ctrl.bgNames?.has(m.file.name) ? ' on' : '');
    b.title = m.file.name + ' — Shift + ضغطة: ضيفها للمجموعة';
    b.innerHTML = m.thumb ? `<img src="${m.thumb}" alt="">` : (m.kind === 'video' ? '🎞️' : '🖼️');
    b.onclick = e => {
      ctrlSnapshot();
      if (e.shiftKey && ctrl.bgNames) { ctrl.bgNames.has(m.file.name) ? ctrl.bgNames.delete(m.file.name) : ctrl.bgNames.add(m.file.name); if (!ctrl.bgNames.size) ctrl.bgNames = null; }
      else ctrl.bgNames = new Set([m.file.name]);
      renderCtrl();
    };
    bb.appendChild(b);
  }
  // المؤثرات والطبقات
  $('#ctrl-particles').value = f.particles;
  $('#ctrl-density').value = f.density;
  $('#ctrl-kenburns').checked = f.kenburns;
  $('#ctrl-lower').checked = f.lower.on; $('#ctrl-lower-auto').checked = f.lower.auto;
  $('#ctrl-lower-title').value = f.lower.title; $('#ctrl-lower-sub').value = f.lower.sub;
  $('#ctrl-ticker').checked = f.ticker.on; $('#ctrl-ticker-text').value = f.ticker.text;
  $('#ctrl-ticker-speed').value = f.ticker.speed; $('#ctrl-ticker-top').checked = f.ticker.top;
  $('#ctrl-clock').checked = f.clock.on;
  $('#ctrl-prayer').checked = f.prayer.on; $('#ctrl-prayer-city').value = f.prayer.city;
  $('#ctrl-logo').checked = f.logo.on; $('#ctrl-logo-pos').value = f.logo.pos;
  $('#ctrl-qr').checked = f.qr.on; $('#ctrl-qr-url').value = f.qr.url; $('#ctrl-qr-pos').value = f.qr.pos;
  // الملصقات
  const sl = $('#ctrl-stickers');
  sl.innerHTML = '';
  for (const st of ctrl.stickers) {
    const row = document.createElement('div');
    row.className = 'row wrap';
    row.innerHTML = `<label class="check"><input type="checkbox"> <span></span></label>
      <select><option value="tr">فوق يمين</option><option value="tl">فوق شمال</option><option value="br">تحت يمين</option><option value="bl">تحت شمال</option><option value="c">النص</option></select>
      <input type="range" min="0.08" max="0.6" step="0.02" title="الحجم"><button class="btn icon" type="button" title="امسح">✕</button>`;
    row.querySelector('span').textContent = st.name;
    const cb = row.querySelector('input[type=checkbox]'), ps = row.querySelector('select'), sz = row.querySelector('input[type=range]');
    cb.checked = st.on; ps.value = st.pos; sz.value = st.size;
    cb.onchange = () => { st.on = cb.checked; };
    ps.onchange = () => { st.pos = ps.value; };
    sz.oninput = () => { st.size = +sz.value; };
    row.querySelector('button').onclick = () => { st.anim?.destroy(); ctrl.stickers.splice(ctrl.stickers.indexOf(st), 1); renderCtrl(); };
    sl.appendChild(row);
  }
}

function setupCtrl() {
  const dlg = $('#dlg-ctrl');
  // لوحة عائمة (مش modal) عشان تفضل شغالة جنب البث — بنقفل لوحة البث الأول لأنها modal
  $('#live-ctrl').onclick = () => { $('#dlg-live').close(); renderCtrl(); ctrlLoadAssets(); dlg.show(); };
  $('#ctrl-close').onclick = () => dlg.close();
  addEventListener('keydown', ctrlHotkey);
  $('#ctrl-particles').innerHTML = Object.entries(FX.PARTICLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#ctrl-prayer-city').innerHTML = Object.entries(PRAYER_CITIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#ctrl-scene-save').onclick = saveScene;
  const f = () => ctrl.fx;
  const bind = (id, fn, ev = 'onchange') => { $('#' + id)[ev] = () => { fn($('#' + id)); saveFx(); }; };
  bind('ctrl-particles', el => { f().particles = el.value; ctrl.particles.set(el.value, f().density); });
  bind('ctrl-density', el => { f().density = +el.value; ctrl.particles.set(f().particles, f().density); }, 'oninput');
  bind('ctrl-kenburns', el => { f().kenburns = el.checked; });
  bind('ctrl-lower', el => { f().lower.on = el.checked; ctrl.lowerSince = ctrlNow(); });
  bind('ctrl-lower-auto', el => { f().lower.auto = el.checked; });
  bind('ctrl-lower-title', el => { f().lower.title = el.value.trim(); }, 'oninput');
  bind('ctrl-lower-sub', el => { f().lower.sub = el.value.trim(); }, 'oninput');
  bind('ctrl-ticker', el => { f().ticker.on = el.checked; });
  bind('ctrl-ticker-text', el => { f().ticker.text = el.value; }, 'oninput');
  bind('ctrl-ticker-speed', el => { f().ticker.speed = +el.value; }, 'oninput');
  bind('ctrl-ticker-top', el => { f().ticker.top = el.checked; });
  bind('ctrl-clock', el => { f().clock.on = el.checked; });
  bind('ctrl-prayer', el => { f().prayer.on = el.checked; ctrlLoadAssets(); });
  bind('ctrl-prayer-city', el => { f().prayer.city = el.value; ctrl.prayer = null; ctrlLoadAssets(); });
  bind('ctrl-logo', el => { f().logo.on = el.checked; });
  bind('ctrl-logo-pos', el => { f().logo.pos = el.value; });
  bind('ctrl-qr', el => { f().qr.on = el.checked; ctrlLoadAssets(); });
  bind('ctrl-qr-url', el => { f().qr.url = el.value.trim(); ctrlLoadAssets(); });
  bind('ctrl-qr-pos', el => { f().qr.pos = el.value; });
  // اللوجو: بنصغّره لـ 256 بكسل عشان يتحفظ
  $('#ctrl-logo-file').onchange = async () => {
    const file = $('#ctrl-logo-file').files[0];
    $('#ctrl-logo-file').value = '';
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    f().logo.data = c.toDataURL('image/png'); f().logo.on = true;
    saveFx(); ctrlLoadAssets(); renderCtrl();
  };
  // 📢 اعرض دلوقتي
  $('#ctrl-card-show').onclick = () => {
    const text = $('#ctrl-card-text').value.trim();
    if (!text) return;
    const sec = Math.max(3, Number($('#ctrl-card-sec').value) || 8);
    ctrl.card = { text, title: $('#ctrl-card-title').value.trim(), since: Date.now(), until: Date.now() + sec * 1000 };
  };
  $('#ctrl-card-hide').onclick = () => { if (ctrl.card) ctrl.card.until = Math.min(ctrl.card.until, Date.now() + 500); };
  document.querySelectorAll('[data-card]').forEach(b => { b.onclick = () => { $('#ctrl-card-title').value = b.dataset.title || ''; $('#ctrl-card-text').value = b.dataset.card; $('#ctrl-card-show').click(); }; });
  // ملصقات Lottie
  $('#ctrl-lottie').onchange = async () => {
    for (const file of $('#ctrl-lottie').files) {
      try {
        const json = JSON.parse(await file.text());
        const anim = await FX.lottieSticker(json);
        ctrl.stickers.push({ id: uid(), name: file.name.replace(/\.json$/i, ''), pos: 'tr', size: 0.18, on: true, anim });
      } catch (e) { status(`❌ «${file.name}» مش ملف Lottie (.json) سليم`, null, true); }
    }
    $('#ctrl-lottie').value = '';
    renderCtrl();
  };
  // OBS
  const oc = load('obsConn', {});
  $('#obs-url').value = oc.url || 'ws://127.0.0.1:4455';
  $('#obs-pass').value = oc.pass || '';
  $('#obs-connect').onclick = obsConnect;
  $('#obs-stream').onclick = async () => { try { await ctrl.obs.call('ToggleStream'); setTimeout(obsRefresh, 800); } catch (e) { status('❌ ' + e.message, null, true); } };
  $('#obs-scene').onchange = () => ctrl.obs.call('SetCurrentProgramScene', { sceneName: $('#obs-scene').value }).catch(e => status('❌ ' + e.message, null, true));
  renderObs(false);
}

// ===== 🪄 ريل بضغطة =====
async function oneClickReel() {
  const theme = THEMES[$('#reel-theme').value];
  if (!theme) return;
  const used = load('reelUsed', []);
  const fresh = theme.refs.filter(r => !used.includes(r.join(':')));
  const ref = pickOne(fresh.length ? fresh : theme.refs);
  save('reelUsed', [ref.join(':'), ...used.filter(x => x !== ref.join(':'))].slice(0, 40));
  stop();
  const b = newQuranBlock(ref[0], ref[1], ref[2]);
  state.blocks = [b];
  // القارئ: الحالي، أو واحد عشوائي من القرّاء اللي عندهم توقيت كلمات (⏱️)
  if ($('#reel-reciter').value === 'random') {
    const ok = RECITERS.filter(r => r.featured && exactWords(r));
    state.style.reciter = pickOne(ok).id;
  }
  if ($('#reel-hook').checked) state.style.intro = pickOne(theme.hooks);
  if ($('#reel-words').checked) state.style.wordMode = 'reveal';
  T.rememberStyle(state.style);
  applyStyleToInputs();
  renderBlocks();
  refreshPublish(true);
  $('#dlg-reel').close();
  showTab('content');
  status(`🪄 ${theme.name}: ${Q.surah(ref[0]).ar} ${Q.arabicNum(ref[1])}${ref[2] > ref[1] ? '–' + Q.arabicNum(ref[2]) : ''} بصوت ${findReciter(state.style.reciter).name}${state.style.intro ? ` — «${state.style.intro}»` : ''}`);
  // خلفيات جديدة على الموضوع
  if ($('#reel-bg').checked) {
    const s = getSettings();
    const tries = [s.pexelsKey && ['pexels', 'video'], s.pixabayKey && ['pixabay', 'video'], ['openverse', 'image']].filter(Boolean);
    for (const [prov, kind] of tries) {
      try {
        status(`🪄 بجيب خلفيات «${theme.bg}»…`);
        const r = await PROVIDERS[prov].fn(theme.bg, kind, state.style.aspect, { page: 1 + Math.floor(Math.random() * 3) });
        const items = r.items.sort(() => Math.random() - 0.5).slice(0, 3);
        if (!items.length) continue;
        let first = true;
        for (const it of items) { await setMedia(await downloadStock(it), !first); first = false; }
        state.style.bgType = 'media';
        applyStyleToInputs();
        status(`✅ الريل جاهز (${theme.name}) — اسمعه في المعاينة، وبعدين صدّره.`);
        return;
      } catch { /* جرّب المصدر اللي بعده */ }
    }
    status('🪄 الريل جاهز، بس مقدرتش أجيب خلفيات (حط مفتاح Pexels أو Pixabay) — هيستخدم خلفياتك الحالية.', null, true);
  }
}

function setupReel() {
  $('#reel-theme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
  $('#btn-reel').onclick = () => $('#dlg-reel').showModal();
  $('#reel-close').onclick = () => $('#dlg-reel').close();
  $('#reel-go').onclick = oneClickReel;
}

// ===== 🖼️ الصور المصغّرة =====
function thumbOpts() {
  const media = $('#th-bg').value === '' ? bgMedia() : state.mediaList[+$('#th-bg').value];
  return {
    style: $('#th-style').value,
    headline: $('#th-headline').value.trim(),
    ayah: $('#th-ayah-on').checked ? $('#th-ayah').value.trim() : '',
    sub: $('#th-sub').value.trim(),
    handle: $('#th-handle-on').checked ? state.style.handle : '',
    accent: $('#th-accent').value,
    textColor: state.style.textColor,
    dim: +$('#th-dim').value,
    media: state.style.bgType === 'media' ? media : null,
    baseStyle: state.style,
  };
}
function drawThumbInto(c, sizeKey) {
  const { w, h } = THUMB_SIZES[sizeKey];
  c.width = w; c.height = h;
  drawThumb(c.getContext('2d'), w, h, thumbOpts());
}
const renderThumb = () => drawThumbInto($('#th-canvas'), $('#th-size').value);

// القيم الأولية من المحتوى: الافتتاحية، وكلمات من أول آية، والسورة والقارئ
function thumbDefaults() {
  const ay = previewSegs.find(s => s.kind === 'ayah');
  const q = state.blocks.find(b => b.type === 'quran');
  const z = state.blocks.find(b => b.type === 'zikr');
  const words = ay ? ay.text.replace(/\u00A0\S+$/, '').split(/\s+/) : [];
  $('#th-ayah').value = words.slice(0, 9).join(' ') + (words.length > 9 ? '…' : '');
  $('#th-ayah-on').checked = !!ay;
  $('#th-headline').value = state.style.intro || (z && !q ? (z.custom ? z.label : z.cat) || '' : '');
  $('#th-sub').value = q ? `سورة ${Q.surah(q.surah).ar} • ${(q.rec && hadithAudio.get(q.id) ? q.rec.name : findReciter(state.style.reciter).name) || ''}` : z?.ref || '';
  $('#th-accent').value = state.style.accent || '#f4d58d';
  $('#th-size').value = state.style.aspect === '16:9' ? 'yt' : state.style.aspect === '1:1' ? 'square' : 'cover';
  $('#th-bg').innerHTML = '<option value="">الخلفية الحالية</option>' + state.mediaList.map((m, i) => `<option value="${i}">${Q.arabicNum(i + 1)}. ${escapeHtml(m.file.name)}</option>`).join('');
}

function setupThumbs() {
  const dlg = $('#dlg-thumb');
  $('#th-size').innerHTML = Object.entries(THUMB_SIZES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  $('#th-style').innerHTML = Object.entries(THUMB_STYLES).map(([k, s]) => `<option value="${k}">${s}</option>`).join('');
  $('#btn-thumb').onclick = () => { thumbDefaults(); dlg.showModal(); renderThumb(); };
  $('#th-close').onclick = () => dlg.close();
  for (const id of ['th-size', 'th-style', 'th-headline', 'th-ayah-on', 'th-ayah', 'th-sub', 'th-bg', 'th-dim', 'th-accent', 'th-handle-on']) $('#' + id).addEventListener('input', renderThumb);
  const save1 = (c, key) => new Promise(res => c.toBlob(b => {
    const name = `${baseName()}_thumb_${key}.png`;
    download(b, name);
    if (key === $('#th-size').value) setLastExport(b, name, 'image/png');
    res();
  }, 'image/png'));
  $('#th-dl').onclick = () => save1($('#th-canvas'), $('#th-size').value);
  $('#th-dl-all').onclick = async () => {
    for (const key of Object.keys(THUMB_SIZES)) { const c = document.createElement('canvas'); drawThumbInto(c, key); await save1(c, key); }
    status('✅ اتنزّلت 3 صور: غلاف طولي، ويوتيوب، ومربع');
  };
  // ✨ عناوين من مساعد الكتابة (نفس قواعده: من غير آيات ولا أحاديث)
  $('#th-ai').onclick = async () => {
    if (!LLM.isReady()) { needLLM(); return; }
    $('#th-ai-st').textContent = '…';
    try {
      const hooks = await LLM.suggestHooks({ summary: contentSummary() });
      $('#th-ai-list').innerHTML = '';
      for (const h of hooks) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.textContent = h;
        b.onclick = () => { $('#th-headline').value = h; renderThumb(); };
        $('#th-ai-list').appendChild(b);
      }
      $('#th-ai-st').textContent = '';
    } catch (e) { $('#th-ai-st').textContent = '❌ ' + e.message; }
  };
}

// ===== 📈 المنافسين والتقدير =====
const comp = { list: load('comp', []), social: load('compSocial', []), busy: false };
const saveComp = () => { save('comp', comp.list); save('compSocial', comp.social); };

// ===== حسابات تيك توك / فيسبوك / إنستجرام (أرقام بإيد المستخدم) =====
const SOC = {
  tiktok: { icon: '🎵', name: 'تيك توك', url: h => `https://www.tiktok.com/@${h}`, blade: h => `https://socialblade.com/tiktok/user/${h}` },
  facebook: { icon: '📘', name: 'فيسبوك', url: h => (/^\d+$/.test(h) ? `https://www.facebook.com/profile.php?id=${h}` : `https://www.facebook.com/${h}`), blade: null },
  instagram: { icon: '📸', name: 'إنستجرام', url: h => `https://www.instagram.com/${h}`, blade: h => `https://socialblade.com/instagram/user/${h}` },
};
function parseSocial(input, platform) {
  const s = String(input || '').trim();
  let m;
  if ((m = s.match(/tiktok\.com\/@([\w.]+)/i))) return { platform: 'tiktok', handle: m[1] };
  if ((m = s.match(/instagram\.com\/([\w.]+)/i))) return { platform: 'instagram', handle: m[1] };
  if ((m = s.match(/facebook\.com\/profile\.php\?id=(\d+)/i))) return { platform: 'facebook', handle: m[1] };
  if ((m = s.match(/(?:facebook|fb)\.com\/([\w.\-]+)/i))) return { platform: 'facebook', handle: m[1] };
  const h = s.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[\w.\-]+$/.test(h)) return null;
  return { platform: platform || 'tiktok', handle: h };
}

function renderSocial() {
  const box = $('#soc-list');
  box.innerHTML = '';
  const favOnly = $('#comp-fav-only').checked;
  const list = [...comp.social].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)).filter(e => !favOnly || e.fav);
  for (const e of list) {
    const P = SOC[e.platform];
    const last = e.snaps.at(-1), prev = e.snaps.at(-2);
    const card = document.createElement('div');
    card.className = 'comp-card';
    card.innerHTML = `<div class="comp-head"><b class="grow"></b>
      ${P.blade ? '<a class="btn" target="_blank" rel="noopener" data-a="blade" title="أرقامه على Social Blade">📊 Social Blade</a>' : ''}
      <a class="btn icon" target="_blank" rel="noopener" data-a="open" title="افتح الحساب">↗</a>
      <button class="btn icon" type="button" data-a="fav"></button>
      <button class="btn icon" type="button" data-a="del" title="شيله">✕</button></div>
      <div class="comp-stats"></div><div class="comp-money"></div>
      <div class="row wrap">
        <label>المتابعين <input type="number" min="0" data-f="followers" style="width:8em"></label>
        <label>مشاهدات الشهر (تقريبًا) <input type="number" min="0" step="1000" data-f="views" style="width:9em" title="اختياري — مجموع مشاهدات اللي نزّله في الشهر، أو من Social Blade"></label>
        <label>بينزّل في الأسبوع <input type="number" min="0" data-f="perWeek" style="width:5em"></label>
        <button class="btn" type="button" data-a="snap">💾 سجّل الأرقام</button>
      </div>
      <details><summary>📜 الأرقام اللي سجّلتها</summary><ol class="muted" data-a="hist"></ol></details>`;
    card.querySelector('b').textContent = `${P.icon} @${e.handle} — ${P.name}`;
    if (P.blade) card.querySelector('[data-a=blade]').href = P.blade(e.handle);
    card.querySelector('[data-a=open]').href = P.url(e.handle);
    const fav = card.querySelector('[data-a=fav]');
    fav.textContent = e.fav ? '⭐' : '☆';
    fav.title = e.fav ? 'شيله من المفضلة' : 'ضيفه للمفضلة';
    fav.onclick = () => { e.fav = !e.fav; saveComp(); renderSocial(); };
    card.querySelector('[data-a=del]').onclick = () => { if (!confirm(`تشيل @${e.handle} من المتابعة؟`)) return; comp.social.splice(comp.social.indexOf(e), 1); saveComp(); renderSocial(); };
    if (last) {
      const days = prev ? Math.max(1, Math.round((last.t - prev.t) / 864e5)) : 0;
      const d = prev && last.followers != null && prev.followers != null ? last.followers - prev.followers : null;
      card.querySelector('.comp-stats').textContent = [
        last.followers != null && `👥 ${CP.fmtNum(last.followers)} متابع${d != null ? ` (${d >= 0 ? '+' : ''}${CP.fmtNum(d)} في ${Q.arabicNum(days)} يوم — حوالي ${CP.fmtNum(d / days)} في اليوم)` : ''}`,
        last.views && `👁️ ${CP.fmtNum(last.views)} مشاهدة في الشهر`,
        last.perWeek && `📅 ${last.perWeek} في الأسبوع`,
        `آخر تسجيل ${new Date(last.t).toLocaleDateString('ar-EG')}`,
      ].filter(Boolean).join('  •  ');
      const rpm = CP.OTHER_RPM[e.platform === 'instagram' ? 'facebook' : e.platform];
      if (last.views && rpm) card.querySelector('.comp-money').textContent = `💰 تقدير الشهر: ${CP.fmtUsd(last.views / 1000 * rpm.rpm[0])} – ${CP.fmtUsd(last.views / 1000 * rpm.rpm[1])}${e.platform === 'instagram' ? ' (إنستجرام مالوش برنامج أرباح ثابت — تقدير زي فيسبوك)' : ''}`;
      for (const k of ['followers', 'views', 'perWeek']) card.querySelector(`[data-f=${k}]`).value = last[k] ?? '';
    } else card.querySelector('.comp-stats').textContent = 'اكتب الأرقام تحت واضغط «💾 سجّل الأرقام».';
    card.querySelector('[data-a=hist]').innerHTML = [...e.snaps].reverse().map(s => `<li>${new Date(s.t).toLocaleDateString('ar-EG')}: 👥 ${CP.fmtNum(s.followers)}${s.views ? ` • 👁️ ${CP.fmtNum(s.views)}/شهر` : ''}${s.perWeek ? ` • 📅 ${s.perWeek}/أسبوع` : ''}</li>`).join('');
    card.querySelector('[data-a=snap]').onclick = () => {
      const v = k => { const x = card.querySelector(`[data-f=${k}]`).value; return x === '' ? null : Number(x); };
      if (v('followers') == null && v('views') == null) { $('#comp-status').textContent = 'اكتب المتابعين أو المشاهدات الأول'; return; }
      e.snaps.push({ t: Date.now(), followers: v('followers'), views: v('views'), perWeek: v('perWeek') });
      e.snaps = e.snaps.slice(-120);
      saveComp(); renderSocial();
    };
    box.appendChild(card);
  }
}

async function compUpdate(entry) {
  const key = getSettings().ytKey;
  const ch = await CP.fetchChannel(entry.id, key);
  Object.assign(entry, { title: ch.title, handle: ch.handle, thumb: ch.thumb, country: ch.country, data: ch });
  entry.snaps = [...(entry.snaps || []), { t: Date.now(), subs: ch.subs, views: ch.views, count: ch.count }].slice(-60);
  saveComp();
}

function renderComp() {
  const box = $('#comp-list');
  box.innerHTML = comp.list.length ? '' : '<p class="muted">لسه مفيش قنوات — الصق لينك قناة فوق.</p>';
  const favOnly = $('#comp-fav-only').checked;
  const all = [...comp.list, ...comp.social];
  $('#comp-count').textContent = all.length ? `${Q.arabicNum(all.length)} حساب محفوظ (⭐ ${Q.arabicNum(all.filter(e => e.fav).length)})` : '';
  // المفضلة فوق
  const list = [...comp.list].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)).filter(e => !favOnly || e.fav);
  for (const e of list) {
    if (!e.data) continue;
    const a = CP.analyze(e.data, e.snaps.slice(0, -1), e.region);
    const ch = e.data;
    const card = document.createElement('div');
    card.className = 'comp-card';
    card.innerHTML = `<div class="comp-head"><img alt=""><b class="grow"></b>
      <select data-a="region" title="جمهورها غالبًا منين"></select>
      <button class="btn icon" type="button" data-a="fav" title="المفضلة"></button>
      <button class="btn icon" type="button" data-a="upd" title="حدّث">🔄</button>
      <button class="btn icon" type="button" data-a="del" title="شيلها">✕</button></div>
      <div class="comp-stats"></div><div class="comp-money"></div><div class="muted" data-a="src"></div>
      <details><summary>🔥 أكتر 10 فيديوهات مشاهدة (من آخر 50)</summary><table class="comp-top"><tbody></tbody></table></details>`;
    card.querySelector('img').src = e.thumb || '';
    card.querySelector('b').textContent = `${ch.title}${ch.handle ? '  ' + ch.handle : ''}`;
    const sel = card.querySelector('[data-a=region]');
    sel.innerHTML = Object.entries(CP.RPM).map(([k, r]) => `<option value="${k}">${r.name}</option>`).join('');
    sel.value = e.region || 'mixed';
    sel.onchange = () => { e.region = sel.value; saveComp(); renderComp(); };
    const delta = a.subsDelta != null ? ` (${a.subsDelta >= 0 ? '+' : ''}${CP.fmtNum(a.subsDelta)} في ${Q.arabicNum(a.sinceDays)} يوم)` : '';
    card.querySelector('.comp-stats').textContent = [
      `👥 ${CP.fmtNum(ch.subs)} مشترك${delta}`,
      `👁️ ${CP.fmtNum(ch.views)} مشاهدة`,
      `🎬 ${CP.fmtNum(ch.count)} فيديو`,
      `📅 ${a.perWeek.toFixed(1)} فيديو في الأسبوع`,
      `⚡ ${Math.round(a.shortsShare * 100)}% من المشاهدات شورتس`,
      `📊 متوسط ${CP.fmtNum(a.avgViews)} مشاهدة للفيديو`,
      ch.country && `🌍 ${ch.country}`,
    ].filter(Boolean).join('  •  ');
    card.querySelector('.comp-money').textContent = `💰 تقدير الشهر: ${CP.fmtUsd(a.lo)} – ${CP.fmtUsd(a.hi)}  (حوالي ${CP.fmtNum(a.monthly)} مشاهدة في الشهر)`;
    card.querySelector('[data-a=src]').textContent = `${a.source} • آخر تحديث ${new Date(e.snaps.at(-1).t).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}`;
    const tb = card.querySelector('tbody');
    for (const v of a.top) {
      const tr = document.createElement('tr');
      const url = `https://www.youtube.com/${v.short ? 'shorts/' : 'watch?v='}${v.id}`;
      tr.innerHTML = `<td>${v.short ? '⚡' : v.live ? '🔴' : '▶️'}</td><td class="t"></td><td>${CP.fmtNum(v.views)}</td><td>${fmtDur(v.secs)}</td>
        <td><a class="btn icon" target="_blank" rel="noopener" title="افتحه">↗</a> <button class="btn icon" type="button" title="افتحه كفيديو مرجعي وطلّع آياته">📥</button></td>`;
      tr.querySelector('.t').textContent = v.title;
      tr.querySelector('.t').title = `${v.title} — ${new Date(v.date).toLocaleDateString('ar-EG')} • 👍 ${CP.fmtNum(v.likes)} • 💬 ${CP.fmtNum(v.comments)}`;
      tr.querySelector('a').href = url;
      tr.querySelector('button').onclick = () => {
        $('#dlg-comp').close();
        $('#ref-url').value = url;
        if (!$('#dlg-ref').open) $('#btn-ref').click();
        showRef(url);
        refExtract({ youtube: url });
      };
      tb.appendChild(tr);
    }
    const fav = card.querySelector('[data-a=fav]');
    fav.textContent = e.fav ? '⭐' : '☆';
    fav.title = e.fav ? 'شيلها من المفضلة' : 'ضيفها للمفضلة';
    fav.onclick = () => { e.fav = !e.fav; saveComp(); renderComp(); };
    card.querySelector('[data-a=upd]').onclick = () => compRun(async () => { await compUpdate(e); }, `بحدّث ${ch.title}…`);
    card.querySelector('[data-a=del]').onclick = () => { if (!confirm(`تشيل «${ch.title}» من المتابعة؟`)) return; comp.list.splice(comp.list.indexOf(e), 1); saveComp(); renderComp(); };
    box.appendChild(card);
  }
}

async function compRun(job, msg) {
  if (comp.busy) return;
  if (!getSettings().ytKey) { $('#comp-key-box').open = true; $('#comp-status').textContent = '🔑 حط مفتاح YouTube Data API الأول (الخطوات تحت الخانة).'; return; }
  comp.busy = true;
  $('#comp-status').textContent = msg;
  try { await job(); $('#comp-status').textContent = ''; } catch (e) { $('#comp-status').textContent = '❌ ' + e.message; }
  comp.busy = false;
  renderComp();
}

function renderEstimate() {
  const p = $('#est-platform').value, views = Number($('#est-views').value) || 0, sh = Math.min(100, Math.max(0, Number($('#est-shorts').value) || 0)) / 100;
  if (!views) { $('#est-out').textContent = ''; return; }
  let lo, hi;
  if (CP.OTHER_RPM[p]) [lo, hi] = CP.OTHER_RPM[p].rpm.map(x => views / 1000 * x);
  else { const r = CP.RPM[p.replace('yt-', '')]; lo = views / 1000 * (r.long[0] * (1 - sh) + r.shorts[0] * sh); hi = views / 1000 * (r.long[1] * (1 - sh) + r.shorts[1] * sh); }
  $('#est-out').textContent = `💰 تقريبًا ${CP.fmtUsd(lo)} – ${CP.fmtUsd(hi)} في الشهر`;
}

function setupCompetitors() {
  const dlg = $('#dlg-comp');
  $('#btn-comp').onclick = () => { $('#comp-key').value = getSettings().ytKey || ''; $('#comp-key-box').open = !getSettings().ytKey; renderComp(); renderSocial(); renderEstimate(); dlg.showModal(); };
  $('#comp-close').onclick = () => dlg.close();
  $('#comp-key').onchange = () => setSettings({ ytKey: $('#comp-key').value.trim() });
  $('#comp-region').innerHTML = Object.entries(CP.RPM).map(([k, r]) => `<option value="${k}">جمهور ${r.name}</option>`).join('');
  $('#comp-region').value = 'mixed';
  $('#comp-add').onclick = () => compRun(async () => {
    const key = getSettings().ytKey;
    const id = await CP.resolveChannel($('#comp-input').value, key);
    let e = comp.list.find(x => x.id === id);
    if (e) await compUpdate(e);
    else {
      // بنضيفها بعد ما بياناتها توصل بس (لو الطلب فشل، ماتفضلش قناة فاضية في القايمة)
      e = { id, region: $('#comp-region').value, snaps: [] };
      await compUpdate(e);
      comp.list.unshift(e);
      saveComp();
    }
    $('#comp-input').value = '';
  }, 'بجيب بيانات القناة…');
  $('#comp-input').onkeydown = ev => { if (ev.key === 'Enter') $('#comp-add').click(); };
  $('#comp-refresh').onclick = () => compRun(async () => {
    const todo = $('#comp-fav-only').checked ? comp.list.filter(e => e.fav) : comp.list;
    for (const [i, e] of todo.entries()) { $('#comp-status').textContent = `بحدّث ${Q.arabicNum(i + 1)} من ${Q.arabicNum(todo.length)}…`; await compUpdate(e); }
  }, 'بحدّث القنوات…');
  $('#comp-fav-only').onchange = () => { renderComp(); renderSocial(); };
  $('#soc-add').onclick = () => {
    const r = parseSocial($('#soc-input').value, $('#soc-platform').value);
    if (!r) { $('#comp-status').textContent = 'الصق لينك الحساب أو اكتب @اسم_الحساب'; return; }
    if (comp.social.some(e => e.platform === r.platform && e.handle.toLowerCase() === r.handle.toLowerCase())) { $('#comp-status').textContent = 'الحساب ده موجود عندك'; return; }
    comp.social.unshift({ id: uid(), ...r, fav: false, snaps: [] });
    $('#soc-input').value = '';
    saveComp(); renderSocial();
  };
  $('#soc-input').onkeydown = ev => { if (ev.key === 'Enter') $('#soc-add').click(); };
  // نسخة احتياطية من القايمة (عشان تنقلها لجهاز أو متصفح تاني)
  $('#comp-export').onclick = () => download(new Blob([JSON.stringify({ app: 'quran-clip-studio', comp: comp.list, social: comp.social })], { type: 'application/json' }), 'قنوات_المنافسين.json');
  $('#comp-import').onchange = async () => {
    const f = $('#comp-import').files[0];
    $('#comp-import').value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const add = (j.comp || []).filter(x => x.id && !comp.list.some(e => e.id === x.id));
      const addS = (j.social || []).filter(x => x.handle && !comp.social.some(e => e.platform === x.platform && e.handle === x.handle));
      comp.list.push(...add);
      comp.social.push(...addS);
      saveComp(); renderComp(); renderSocial();
      $('#comp-status').textContent = `✅ اتضاف ${Q.arabicNum(add.length)} قناة يوتيوب و${Q.arabicNum(addS.length)} حساب`;
    } catch { $('#comp-status').textContent = '❌ الملف ده مش نسخة قايمة المنافسين'; }
  };
  $('#est-platform').innerHTML = Object.entries(CP.RPM).map(([k, r]) => `<option value="yt-${k}">يوتيوب — جمهور ${r.name}</option>`).join('')
    + Object.entries(CP.OTHER_RPM).map(([k, r]) => `<option value="${k}">${r.name}</option>`).join('');
  ['est-platform', 'est-views', 'est-shorts'].forEach(id => { $('#' + id).oninput = renderEstimate; });
}

// ===== 📥 الآيات والأدعية من فيديو مرجعي =====
let refCands = [];
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// WAV مونو 16-bit بمعدل البافر الحقيقي
function monoWav(buf) {
  const d = buf.getChannelData(0), n = d.length, out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  return out.buffer;
}

// ملف فيديو ← صوت WAV صغير (16kHz مونو، أول 8 دقايق) + 3 لقطات للكلام المكتوب على الشاشة
async function mediaFromFile(file) {
  let audio = null;
  try {
    const buf = await decode(await file.arrayBuffer());
    // أول 5 دقايق بس، مونو 16kHz (‏32KB في الثانية) — عشان الطلب يفضل أقل من حد جوجل (20MB)
    const dur = Math.min(buf.duration, 300);
    const off = new OfflineAudioContext(1, Math.ceil(dur * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    audio = b64(monoWav(await off.startRendering()));
  } catch { /* فيديو من غير صوت */ }
  const images = [];
  if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
      for (const f of [0.15, 0.5, 0.85]) {
        v.currentTime = v.duration * f;
        await new Promise(res => { v.onseeked = res; setTimeout(res, 3000); });
        const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        images.push(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      }
    } catch { /* مش مشكلة */ }
    URL.revokeObjectURL(v.src);
  }
  if (!audio && !images.length) throw new Error('مقدرتش أقرا الملف ده — جرّب MP4');
  return { audio, images };
}

// اسم القارئ من الفيديو ← القارئ عندك: بالكلمات المميزة بس (مش «عبد» و«محمد»…)
const COMMON_NAME = new Set(['عبد', 'محمد', 'محمود', 'علي', 'احمد', 'الشيخ', 'القارئ', 'مرتل', 'مجود', 'المعلم', 'بن', 'ابن']);
const nameWords = s => String(s || '').replace(/[()«»]/g, ' ').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .split(/\s+/).map(w => w.replace(/^ال(?=..)/, '')).filter(w => w.length > 2 && !COMMON_NAME.has(w) && !COMMON_NAME.has('ال' + w));
function matchReciter(spoken) {
  const said = new Set(nameWords(spoken));
  if (!said.size) return null;
  let best = null, bestScore = 0;
  for (const r of RECITERS) {
    const score = nameWords(r.name).filter(w => said.has(w)).length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

async function refExtract(src) {
  const st = $('#ref-extract-status');
  if (!LLM.canReadMedia()) { st.textContent = '🔑 محتاج مفتاح Gemini (مجاني): ⚙️ الإعدادات ← ✨ مساعد الكتابة (Gemini) أو 🔊 صوت Gemini'; return; }
  st.textContent = '⏳ بيسمع ويقرا الفيديو…';
  $('#ref-items').innerHTML = '';
  $('#ref-items-actions').hidden = true;
  try {
    const r = await LLM.extractMedia(src.file ? await mediaFromFile(src.file) : src);
    refCands = [];
    for (const it of r.items) {
      if (it.type === 'other') continue;
      // أي حاجة (حتى لو اتصنّفت دعاء) فيها آيات بتتحوّل لآيات من المصحف — «ربنا…» كتير بتبقى قرآن
      const fr = Q.findFragments(it.text);
      if (fr.frags.length) {
        for (const f of fr.frags) refCands.push({ kind: 'quran', f, on: true });
        if (fr.rest > 4 && it.type !== 'quran') refCands.push({ kind: 'dua', text: it.text, on: false, note: 'فيه آيات وكلام تاني — الآيات فوق' });
      } else if (it.type === 'quran') refCands.push({ kind: 'unknown', text: it.text, on: false });
      else if (it.type === 'hadith') refCands.push({ kind: 'hadith', text: it.text, on: false });
      else refCands.push({ kind: 'dua', text: it.text, on: true });
    }
    const rc = matchReciter(r.reciter);
    st.textContent = `✅ لقيت ${Q.arabicNum(refCands.length)} عنصر${r.reciter ? ` — القارئ في الفيديو: ${r.reciter}${rc ? ` (موجود عندك: ${rc.name})` : ''}` : ''}`;
    renderRefCands(rc);
  } catch (e) { st.textContent = '❌ ' + e.message; }
}

function renderRefCands(rc) {
  const ol = $('#ref-items');
  ol.innerHTML = '';
  refCands.forEach(c => {
    const li = document.createElement('li');
    li.className = 'part';
    const ws = c.kind === 'quran' ? WT.words(Q.ayahText(c.f.s, c.f.a)) : null;
    const txt = c.kind === 'quran' ? ws.slice(c.f.w1 - 1, c.f.w2).join(' ') : c.text;
    const label = c.kind === 'quran' ? `📖 ${Q.surah(c.f.s).ar} ${Q.arabicNum(c.f.a)}${c.f.whole ? '' : ' (جزء)'} — بصوت القارئ`
      : c.kind === 'dua' ? '🤲 دعاء — نص خاص تقراه بصوتك' : c.kind === 'hadith' ? '⚠️ حديث — استخدم «＋ حديث» ودوّر عليه عشان درجته تظهر'
        : '⚠️ شكله قرآن بس مش لاقيه في المصحف — اتأكد منه';
    li.innerHTML = `<label class="check"><input type="checkbox"></label><span class="pname"></span><span class="pinfo"></span>`;
    const cb = li.querySelector('input');
    cb.checked = c.on; cb.disabled = c.kind === 'hadith' || c.kind === 'unknown';
    cb.onchange = () => { c.on = cb.checked; };
    li.querySelector('.pname').textContent = label + (c.note ? ` (${c.note})` : '');
    li.querySelector('.pinfo').textContent = txt.length > 140 ? txt.slice(0, 140) + '…' : txt;
    ol.appendChild(li);
  });
  if (rc && rc.id !== state.style.reciter) {
    const li = document.createElement('li');
    li.className = 'part';
    li.innerHTML = '<span class="grow"></span><button class="btn" type="button"></button>';
    li.querySelector('span').textContent = `🎙️ القارئ في الفيديو موجود عندك: ${rc.name}`;
    li.querySelector('button').textContent = 'استخدمه';
    li.querySelector('button').onclick = () => { state.style.reciter = rc.id; applyStyleToInputs(); T.rememberStyle(state.style); li.remove(); status(`✅ القارئ بقى ${rc.name}`); };
    ol.appendChild(li);
  }
  $('#ref-items-actions').hidden = !refCands.some(c => !['hadith', 'unknown'].includes(c.kind));
}

function setupRefExtract() {
  $('#ref-extract').onclick = () => {
    const url = $('#ref-url').value.trim();
    if (!/youtu\.?be/.test(url)) { $('#ref-extract-status').textContent = 'الصق لينك يوتيوب فوق. لتيك توك وإنستجرام وفيسبوك: احفظ الفيديو وارفعه بـ «📁 من ملف فيديو».'; return; }
    refExtract({ youtube: url });
  };
  $('#ref-extract-file').onchange = () => {
    const file = $('#ref-extract-file').files[0];
    $('#ref-extract-file').value = '';
    if (file) refExtract({ file });
  };
  $('#ref-items-add').onclick = () => {
    const blocks = refCands.filter(c => c.on).map(c => {
      if (c.kind === 'quran') {
        const q = newQuranBlock(c.f.s, c.f.a, c.f.a);
        if (!c.f.whole) q.part = { w1: c.f.w1, w2: c.f.w2 };
        return q;
      }
      const b = newCustomBlock();
      b.text = c.text;
      b.seconds = estimateSeconds(c.text);
      return b;
    });
    if (!blocks.length) return;
    stop();
    state.blocks = $('#ref-items-replace').checked ? blocks : [...state.blocks, ...blocks];
    renderBlocks();
    refreshPublish(true);
    showTab('content');
    const duas = blocks.filter(b => b.type === 'zikr').length;
    status(`✅ اتضاف ${Q.arabicNum(blocks.length)} كارت${duas ? ` — ${Q.arabicNum(duas)} دعاء: سجّلهم بصوتك (🎙️) أو ولّد صوت` : ''}. راجع النص قبل النشر.`);
  };
}

// ===== وصفة الريل =====
const RC = { intro: 'rc-intro', wordMode: 'rc-wordMode', textSize: 'rc-size', reciter: 'rc-reciter', duration: 'rc-dur', bg: 'rc-bg', bgSwitch: 'rc-bgSwitch' };
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
    openStock(q);
  };
  $('#rc-apply').onclick = () => {
    const r = readRecipe();
    const st = state.style;
    if (r.intro != null) st.intro = r.intro;
    if (r.wordMode) st.wordMode = r.wordMode;
    if (r.textSize) st.textSize = Number(r.textSize);
    if (r.reciter) st.reciter = r.reciter;
    if (r.bgSwitch === 'ayah') st.bgSwitch = 'ayah';
    else if (r.bgSwitch) { st.bgSwitch = 'seconds'; st.bgEvery = Number(r.bgSwitch); }
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

// ===== مخطط النشر =====
const posts = load('posts', []);
const planCfg = { times: '14:00, 20:00, 22:30', perDay: 2, ...load('planCfg', {}) };
const timeFmt = new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' });
const shortDay = d => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  return diff === 0 ? 'النهارده' : diff === 1 ? 'بكرة' : diff === -1 ? 'امبارح' : PL.dayText(d);
};

function warnText(w) {
  const sn = w.surah ? `سورة ${Q.surah(w.surah).ar}` : '';
  const ago = w.days === 0 ? 'النهارده' : `من ${Q.arabicNum(w.days)} يوم`;
  if (w.kind === 'same') return `⚠️ نفس آيات ${sn} اتنشرت ${ago}. تيك توك ممكن يعتبرها مكررة ويوقف توزيعها — اختار آيات تانية أو استنى ١٤ يوم.`;
  if (w.kind === 'surah') return `${sn} اتنشرت ${ago}. الأفضل تنوّع (أسبوع بين نفس السورة).`;
  if (w.kind === 'other') return '⚠️ الذكر/الحديث ده اتنشر من أقل من ١٤ يوم.';
  if (w.kind === 'spacing') return `آخر نشر كان ${w.hours < 1 ? 'من شوية' : `من ${Q.arabicNum(Math.round(w.hours * 10) / 10)} ساعة`} — سيب ٤ ساعات بين الفيديوهات.`;
  return '';
}

function updateDupWarn() {
  const el = $('#dup-warn');
  if (!el) return;
  const ws = PL.checkBlocks(state.blocks, posts);
  el.hidden = !ws.length;
  el.classList.toggle('high', ws.some(w => w.level === 'high'));
  el.innerHTML = '';
  for (const w of ws) { const p = document.createElement('div'); p.textContent = warnText(w); el.appendChild(p); }
  // الطابور
  const qw = $('#q-warn');
  if (!qw) return;
  const lines = [];
  const pend = queue.items.filter(it => !it.done);
  for (const it of pend) {
    const w = PL.checkBlocks(it.blocks, posts).filter(x => x.kind !== 'spacing');
    if (w.length) lines.push(`«${it.label}»: ${warnText(w[0])}`);
  }
  const seen = new Map();
  for (const it of pend) for (const b of it.blocks) if (b.type === 'quran') seen.set(b.surah, (seen.get(b.surah) || 0) + 1);
  const rep2 = [...seen].filter(([, n]) => n > 1).map(([sn]) => Q.surah(sn).ar);
  if (rep2.length) lines.push(`الطابور فيه أكتر من مقطع من: ${rep2.join('، ')} — صدّرهم عادي، بس انشرهم على أيام مختلفة.`);
  qw.hidden = !lines.length;
  qw.innerHTML = '';
  for (const l of lines) { const p = document.createElement('div'); p.textContent = l; qw.appendChild(p); }
}

function renderPlan() {
  const now = new Date();
  $('#plan-today').textContent = `النهارده ${PL.dayText(now)} — ${PL.hijriText(now)}`;
  const occ = $('#plan-occasions');
  occ.innerHTML = '';
  const up = PL.upcoming(now, 14);
  if (!up.length) occ.innerHTML = '<p class="muted">مفيش مواسم قريبة.</p>';
  for (const day of up) {
    for (const o of day.items) {
      const d = document.createElement('div');
      d.className = 'plan-item';
      d.innerHTML = '<div class="when"></div><b></b><div class="muted"></div>';
      d.querySelector('.when').textContent = `${shortDay(day.date)} • ${Q.arabicNum(day.hijri.d)}/${Q.arabicNum(day.hijri.m)} هـ`;
      d.querySelector('b').textContent = o.title + (o.ref ? ` — ${o.ref}` : '');
      d.querySelector('.muted').textContent = o.tip || '';
      if (o.ref) {
        const row = document.createElement('div');
        row.className = 'btn-row';
        row.innerHTML = '<button class="btn" type="button">حمّل في المحرر</button><button class="btn ghost" type="button">＋ للطابور</button>';
        const refs = () => parseRefs(o.ref, Q.surahs()).ok;
        row.children[0].onclick = () => {
          stop();
          state.blocks = refs().map(r => quranRefBlock(r, true));
          renderBlocks(); refreshPublish(true);
          $('#dlg-plan').close(); showTab('content');
          status(`✅ اتحمّل ${o.ref} (${o.title})`);
        };
        row.children[1].onclick = () => {
          for (const r of refs()) queue.items.push({ id: uid(), label: `${refLabel(r)} — ${o.title}`, blocks: [quranRefBlock(r, true)], done: false });
          saveQueue(); renderQueue(); updateDupWarn();
          status(`✅ ${o.ref} اتضاف للطابور`);
        };
        d.appendChild(row);
      }
      occ.appendChild(d);
    }
  }
  const slots = PL.nextSlots(posts, planCfg.times.split(','), Number(planCfg.perDay) || 2, 6, now);
  $('#plan-slots').innerHTML = '';
  for (const t of slots) {
    const d = document.createElement('div');
    d.className = 'plan-item';
    d.textContent = `🕘 ${shortDay(t)} — ${timeFmt.format(t)}`;
    $('#plan-slots').appendChild(d);
  }
  const box = $('#plan-posts');
  box.innerHTML = '';
  const recent = posts.filter(p => now - Date.parse(p.at) < 30 * 864e5);
  if (!recent.length) box.innerHTML = '<p class="muted">لسه مفيش. اضغط «✅ نشرته» في كارت النشر بعد ما تنشر.</p>';
  for (const p of recent) {
    const d = document.createElement('div');
    d.className = 'plan-item post';
    d.innerHTML = '<span class="grow"></span><button class="btn icon" type="button" title="حذف">✕</button>';
    const at = new Date(p.at);
    const what = p.keys.map(k => { const [sn, r] = k.split(':'); return `${Q.surah(Number(sn)).ar} ${r}`; }).join(' + ') || p.title || '—';
    d.querySelector('span').textContent = `${shortDay(at)} ${timeFmt.format(at)} • ${PLATFORMS[p.platform]?.name || p.platform} • ${what}`;
    d.querySelector('button').onclick = () => { posts.splice(posts.indexOf(p), 1); save('posts', posts); renderPlan(); updateDupWarn(); };
    box.appendChild(d);
  }
}

function setupPlanner() {
  $('#btn-plan').onclick = () => { renderPlan(); $('#dlg-plan').showModal(); };
  $('#plan-close').onclick = () => $('#dlg-plan').close();
  $('#plan-times').value = planCfg.times;
  $('#plan-perday').value = planCfg.perDay;
  $('#plan-times').onchange = () => { planCfg.times = $('#plan-times').value; save('planCfg', planCfg); renderPlan(); };
  $('#plan-perday').onchange = () => { planCfg.perDay = clamp($('#plan-perday').value, 1, 6); save('planCfg', planCfg); renderPlan(); };
  $('#pub-posted').onclick = () => {
    if (!state.blocks.length) return;
    const d = pub.data?.[pub.platform] || {};
    const before = PL.checkBlocks(state.blocks, posts).some(w => w.kind === 'spacing');
    posts.unshift(PL.postFromBlocks(state.blocks, pub.platform, d.title || (d.caption || '').split('\n')[0].slice(0, 80)));
    save('posts', posts.slice(0, 500));
    updateDupWarn();
    const next = PL.nextSlots(posts, planCfg.times.split(','), Number(planCfg.perDay) || 2, 1)[0];
    status(`✅ اتسجّل إنه اتنشر على ${PLATFORMS[pub.platform].name}.${before ? ' (كان قريب من اللي قبله — المرة الجاية سيب ٤ ساعات)' : ''}${next ? ` الموعد الجاي المقترح: ${shortDay(next)} ${timeFmt.format(next)}` : ''}`);
  };
  // تذكير يوم الخميس/الجمعة
  const today = PL.upcoming(new Date(), 2).flatMap(d => d.items.map(o => ({ ...o, date: d.date })));
  const hint = today.find(o => !o.weekly || /الجمعة/.test(o.title));
  if (hint) status(`📅 ${shortDay(hint.date)}: ${hint.title}${hint.ref ? ` — اقتراح: ${hint.ref}` : ''} (افتح «📅 المخطط»)`);
  updateDupWarn();
}

// ===== لوحة الأرقام =====
let statRows = (load('statsRows', []) || []).map(r => ({ ...r, date: r.date ? new Date(r.date) : null }));
const RECITER_KEYS = [...new Set(RECITERS.map(r => r.name.replace(/\s*\(.*?\)\s*/g, '').trim()))].map(n => ({ n, keys: [n, n.split(' ').slice(-1)[0], ...(n.startsWith('عبد الباسط') ? ['عبد الباسط'] : [])] }));
const normA = t => String(t || '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا');
function reciterIn(title) {
  const t = normA(title);
  if (/سيد سعيد/.test(t)) return 'سيد سعيد';
  for (const r of RECITER_KEYS) if (r.keys.some(k => normA(k).length >= 4 && t.includes(normA(k)))) return r.n;
  return null;
}
const statHelpers = { findSurahIn: t => surahInText(t, Q.surahs())?.ar || null, reciterIn };

function logRows() {
  return expLog.filter(e => e.views != null).map(e => {
    const m = /^(?:\d+_)?quran_(\d+)_/.exec(e.file || '');
    const [mm, ss] = String(e.dur || '').split(':').map(Number);
    return {
      title: e.file, views: Number(e.views), likes: e.likes != null ? Number(e.likes) : null,
      date: e.date ? new Date(e.date + 'T00:00:00') : null,
      dur: Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : null,
      surah: m ? Q.surah(Number(m[1]))?.ar : null,
      reciter: e.recipe?.reciter ? findReciter(e.recipe.reciter).name.replace(/\s*\(.*?\)\s*/g, '').trim() : null,
      hookFirst: !!e.recipe?.intro, wordMode: e.recipe?.wordMode,
    };
  });
}

function renderStats() {
  const body = $('#stats-body');
  const fromCsv = statRows.length > 0;
  const rows = fromCsv ? statRows : logRows();
  $('#stats-src').textContent = fromCsv ? `من التقرير: ${Q.arabicNum(statRows.length)} فيديو` : `من «سجل تجاربي»: ${Q.arabicNum(rows.length)} فيديو`;
  body.innerHTML = '';
  if (!rows.length) { body.innerHTML = '<p class="muted">مفيش بيانات لسه. ارفع تقرير CSV، أو اكتب المشاهدات في «🎞️ فيديو مرجعي ← سجل تجاربي».</p>'; return; }
  const a = ST.analyze(rows, statHelpers);
  const N = n => Q.arabicNum(Math.round(n).toLocaleString('en-US'));
  const cards = document.createElement('div');
  cards.className = 'stats-cards';
  cards.innerHTML = [['فيديو', N(a.count)], ['إجمالي المشاهدات', N(a.total)], ['متوسط الفيديو', N(a.avg)], ['نسبة اللايك', `${Q.arabicNum((a.likeRate * 100).toFixed(1))}٪`]]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  body.appendChild(cards);
  // ملاحظات
  const tips = [];
  const best = (g, min = 2) => g.filter(x => x.n >= min)[0];
  const bh = best(a.byHour); if (bh) tips.push(`أحسن وقت نشر: ${Q.arabicNum(bh.label)} (متوسط ${N(bh.avg)} مشاهدة على ${Q.arabicNum(bh.n)} فيديو).`);
  const hk = a.byHook.find(x => x.k === 'hook'), pl = a.byHook.find(x => x.k === 'plain');
  if (hk && pl && hk.n >= 2 && pl.n >= 2) tips.push(hk.avg >= pl.avg ? `الفيديوهات اللي بتبدأ بافتتاحية متوسطها ${N(hk.avg)} مقابل ${N(pl.avg)} للي بتبدأ باسم السورة — كمّل بالافتتاحيات.` : `اللي بيبدأ باسم السورة (${N(pl.avg)}) أحسن من الافتتاحيات (${N(hk.avg)}) عندك — جرّب افتتاحيات أقوى.`);
  const br = best(a.byReciter); if (br) tips.push(`أحسن قارئ عند جمهورك: ${br.label} (متوسط ${N(br.avg)}).`);
  const bd = best(a.byDur); if (bd) tips.push(`أحسن مدة: ${bd.label}.`);
  const bw = best(a.byWordMode); if (bw) tips.push(`أحسن طريقة لظهور الآيات: ${bw.label}.`);
  if (a.likeRate >= 0.1) tips.push(`نسبة اللايك ${Q.arabicNum((a.likeRate * 100).toFixed(1))}٪ ممتازة — المحتوى بيعجب اللي بيشوفه؛ ركّز على الافتتاحية عشان يوصل لناس أكتر.`);
  if (a.count < 8) tips.push('العينة لسه صغيرة — الأرقام دي مؤشر مش حكم. استنى لحد ١٥–٢٠ فيديو.');
  if (tips.length) {
    const ul = document.createElement('ul');
    ul.className = 'insights';
    for (const t of tips) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
    body.appendChild(ul);
  }
  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  const section = (title, groups) => {
    if (!groups.length) return;
    const sec = document.createElement('section');
    sec.innerHTML = `<h3></h3><div class="bars"></div>`;
    sec.querySelector('h3').textContent = title;
    const max = Math.max(...groups.map(g => g.avg), 1);
    for (const g of groups.slice(0, 7)) {
      const r = document.createElement('div');
      r.className = 'bar-row';
      r.innerHTML = '<span class="lbl2"></span><div class="bar-track"><div class="bar-fill"></div></div><span class="v"></span>';
      r.querySelector('.lbl2').textContent = `${Q.arabicNum(g.label)} (${Q.arabicNum(g.n)})`;
      r.querySelector('.bar-fill').style.width = `${(g.avg / max) * 100}%`;
      r.querySelector('.v').textContent = Math.round(g.avg).toLocaleString('en-US');
      sec.querySelector('.bars').appendChild(r);
    }
    grid.appendChild(sec);
  };
  section('⏰ حسب وقت النشر (متوسط المشاهدات)', a.byHour);
  section('📅 حسب اليوم', a.byDay);
  section('🪝 أول سطر', a.byHook);
  section('🎙️ حسب القارئ', a.byReciter);
  section('📖 حسب السورة', a.bySurah);
  section('⏱ حسب المدة', a.byDur);
  section('✨ ظهور الآيات', a.byWordMode);
  body.appendChild(grid);
  const top = document.createElement('section');
  top.innerHTML = '<h3>🏆 أعلى ٥</h3><ol class="plan-list"></ol>';
  for (const r of a.top) { const li = document.createElement('li'); li.className = 'plan-item'; li.textContent = `${Math.round(r.views).toLocaleString('en-US')} 👁 — ${(r.title || '').slice(0, 90)}`; top.querySelector('ol').appendChild(li); }
  body.appendChild(top);
}

function setupStats() {
  $('#btn-stats').onclick = () => { renderStats(); $('#dlg-stats').showModal(); };
  $('#stats-close').onclick = () => $('#dlg-stats').close();
  const use = text => {
    try {
      statRows = ST.rowsFromCsv(text);
      save('statsRows', statRows.map(r => ({ ...r, date: r.date ? r.date.toISOString() : null })));
      renderStats();
    } catch (e) { alert(e.message); }
  };
  $('#stats-file').onchange = async () => { const f = $('#stats-file').files[0]; $('#stats-file').value = ''; if (f) use(await f.text()); };
  $('#stats-paste-go').onclick = () => use($('#stats-paste').value);
  $('#stats-clear').onclick = () => { statRows = []; save('statsRows', []); renderStats(); };
}

// الخلفيات المحفوظة من آخر مرة
async function restoreMedia() {
  const saved = await loadMediaList();
  if (!saved.length || state.mediaList.length) return;
  state.mediaList = saved.map(v => { const m = makeMediaItem(v.file); m.secs = v.secs; return m; });
  state.media = state.mediaList[0];
  updateBgVisibility();
  renderBgList();
  refreshPreview();
}

// ===== البداية =====
async function init() {
  status('تحميل نص المصحف…');
  await Promise.all([Q.loadQuran(), ensureFonts(), loadAzkar()]);
  status('');
  setupStyle();
  restoreMedia();
  setupReciters();
  setupAyahSearch();
  setupStock();
  setupTemplates();
  setupSettings();
  renderBlocks();
  restoreBlockAudio();

  $('#add-quran').onclick = () => { state.blocks.push(newQuranBlock(1, 1, 1)); renderBlocks(); focusLastBlock(); };
  $('#add-hadith').onclick = () => { state.blocks.push(newHadithBlock()); renderBlocks(); focusLastBlock(); };
  $('#add-zikr').onclick = openAzkarLibrary;
  $('#add-custom').onclick = () => { state.blocks.push(newCustomBlock()); renderBlocks(); focusLastBlock(); blocksEl.lastElementChild?.querySelector('[data-f=text]')?.focus(); };
  setupLLM();
  setupAzkarLibrary();
  setupFollow();
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
  setupLive();
  setupReference();
  setupRefExtract();
  setupCompetitors();
  setupCtrl();
  setupThumbs();
  setupReel();
  setupPlanner();
  setupStats();
  idleLoop();
}

init().catch(showError);

// للاختبار من الكونسول
window.__qcs = { state, buildProject, buildSegments, live, withProject, projectFromVideo };
