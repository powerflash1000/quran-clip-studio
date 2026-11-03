// قراءة النص بصوتك عن طريق ElevenLabs (اختياري — محتاج مفتاح API ورقم الصوت في الإعدادات)
// المفتاح بيتحفظ على جهازك بس، والطلب بيروح لـ ElevenLabs مباشرة (أو عن طريق الوسيط لو متضبط)
import { getSettings } from './storage.js';
import { emotion } from './emotions.js';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (معبّر)' },
  { id: 'eleven_v4', name: 'Eleven v4 🎭 (الأحدث — أقوى في المشاعر والتاجات)' },
  { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo (أسرع)' },
];
// الموديلات اللي بتفهم تاجات المشاعر ([sad] [whispers] …)
const EXPRESSIVE = new Set(['eleven_v3', 'eleven_v4', 'eleven_v4_turbo']);
// لو حسابك لسه مافيهوش v4، بننزل لـ v3 لوحدنا ونفتكر ده لحد ما الصفحة تتقفل
let noV4 = false;

export function isConfigured() {
  const s = getSettings();
  return !!(s.elevenKey && s.elevenVoiceId);
}

export const hasKey = () => !!getSettings().elevenKey;

// لو الطلب المباشر اترفض (غالبًا CORS) بنجرّب عن طريق الوسيط
async function call(path, init) {
  const { elevenKey, proxyUrl } = getSettings();
  const headers = { 'xi-api-key': elevenKey, ...(init.headers || {}) };
  try {
    return await fetch(API + path, { ...init, headers });
  } catch (e) {
    if (!proxyUrl) throw new Error('المتصفح منع الاتصال بـ ElevenLabs (CORS). اضبط «رابط الوسيط» في الإعدادات (الشرح في README).');
    const base = proxyUrl.replace(/\/+$/, '');
    return fetch(`${base}/?url=${encodeURIComponent(API + path)}`, { ...init, headers });
  }
}

async function errorText(res) {
  try {
    const j = await res.json();
    return j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j);
  } catch {
    return res.statusText;
  }
}

// قائمة الأصوات في حسابك (عشان تختار صوتك المنسوخ بدل ما تكتب الرقم)
export async function listVoices() {
  const res = await call('/v1/voices', { method: 'GET' });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorText(res)}`);
  const j = await res.json();
  return (j.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category, preview: v.preview_url || '' }));
}

// تحويل نص لصوت؛ بيرجع Blob (mp3)
// voiceId (اختياري): صوت معيّن للمقطع ده بدل الصوت الافتراضي اللي في الإعدادات
// perf (أداء الصوت): { emotion, stability, style, speed }
// المشاعر بتحتاج موديل معبّر (v4 أو v3 — بيفهموا تاجات زي [crying] و [whispers]) — فلو فيه مشاعر بنستخدمه للمقطع ده
export async function speak(text, voiceId = '', perf = {}) {
  const { elevenVoiceId, elevenModel } = getSettings();
  const em = emotion(perf.emotion);
  // تاجات مكتوبة جوه النص نفسه ([sighs] …) برضه محتاجة موديل معبّر، وإلا الموديل القديم هينطقها
  const tagsInText = /\[[a-z][a-z ,\-]*\]/i.test(text);
  const chosen = elevenModel || MODELS[0].id;
  let model = em.tag || tagsInText ? (EXPRESSIVE.has(chosen) ? chosen : 'eleven_v4') : chosen;
  if (noV4 && model.startsWith('eleven_v4')) model = 'eleven_v3';
  const base = perf.stability ?? (em.tag ? 0.5 : 0.6);
  // v3 بيقبل الثبات 0 أو 0.5 أو 1 بس (Creative / Natural / Robust)
  const snap = x => [0, 0.5, 1].reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const send = (m, stability) => call(`/v1/text-to-speech/${encodeURIComponent(voiceId || elevenVoiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: em.tag ? `[${em.tag}] ${text}` : text,
      model_id: m,
      voice_settings: { stability, similarity_boost: 0.85, style: perf.style ?? 0, use_speaker_boost: true, speed: perf.speed ?? 1 },
    }),
  });
  let res = await send(model, model === 'eleven_v3' ? snap(base) : base);
  let msg = res.ok ? '' : await errorText(res);
  // v4: لو رفض قيمة الثبات، نجرّب القيم الثابتة زي v3
  if (!res.ok && model.startsWith('eleven_v4') && /stabilit/i.test(msg)) {
    res = await send(model, snap(base));
    msg = res.ok ? '' : await errorText(res);
  }
  // الموديل مش متاح لحسابك (أو للصوت ده): نكمّل بـ v3
  if (!res.ok && model.startsWith('eleven_v4') && [400, 403, 404, 422].includes(res.status) && /model|not (available|found|supported)|permission|access/i.test(msg)) {
    noV4 = true;
    model = 'eleven_v3';
    res = await send(model, snap(base));
    msg = res.ok ? '' : await errorText(res);
  }
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${msg}`);
  lastModel = model;
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}
// آخر موديل اتولّد بيه فعلًا (عشان رسالة الحالة)
export let lastModel = '';

// تنظيف بسيط قبل الإرسال: علامات التنصيص والأقواس مش بتتنطق
export function prepareText(text) {
  return String(text)
    .replace(/[«»"“”]/g, '')
    .replace(/ﷺ/g, 'صلى الله عليه وسلم')
    .replace(/\s+/g, ' ')
    .trim();
}
