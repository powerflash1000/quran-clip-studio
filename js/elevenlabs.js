// قراءة النص بصوتك عن طريق ElevenLabs (اختياري — محتاج مفتاح API ورقم الصوت في الإعدادات)
// المفتاح بيتحفظ على جهازك بس، والطلب بيروح لـ ElevenLabs مباشرة (أو عن طريق الوسيط لو متضبط)
import { getSettings } from './storage.js';
import { emotion } from './emotions.js';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (أحدث وأكثر تعبيرًا)' },
];

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
// المشاعر بتحتاج Eleven v3 (بيفهم تاجات زي [crying] و [whispers]) — فلو فيه مشاعر بنستخدمه للمقطع ده
export async function speak(text, voiceId = '', perf = {}) {
  const { elevenVoiceId, elevenModel } = getSettings();
  const em = emotion(perf.emotion);
  // تاجات مكتوبة جوه النص نفسه ([sighs] …) برضه محتاجة v3، وإلا الموديل القديم هينطقها
  const tagsInText = /\[[a-z][a-z \-]*\]/i.test(text);
  const model = em.tag || tagsInText ? 'eleven_v3' : (elevenModel || MODELS[0].id);
  const v3 = model === 'eleven_v3';
  // v3 بيقبل الثبات 0 أو 0.5 أو 1 بس (Creative / Natural / Robust)
  let stability = perf.stability ?? (em.tag ? 0.5 : 0.6);
  if (v3) stability = [0, 0.5, 1].reduce((a, b) => (Math.abs(b - stability) < Math.abs(a - stability) ? b : a));
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(voiceId || elevenVoiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: em.tag ? `[${em.tag}] ${text}` : text,
      model_id: model,
      voice_settings: { stability, similarity_boost: 0.85, style: perf.style ?? 0, use_speaker_boost: true, speed: perf.speed ?? 1 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorText(res)}`);
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

// تنظيف بسيط قبل الإرسال: علامات التنصيص والأقواس مش بتتنطق
export function prepareText(text) {
  return String(text)
    .replace(/[«»"“”]/g, '')
    .replace(/ﷺ/g, 'صلى الله عليه وسلم')
    .replace(/\s+/g, ' ')
    .trim();
}
