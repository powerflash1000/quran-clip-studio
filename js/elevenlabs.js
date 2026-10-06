// قراءة النص بصوتك عن طريق ElevenLabs (اختياري — محتاج مفتاح API ورقم الصوت في الإعدادات)
// المفتاح بيتحفظ على جهازك بس، والطلب بيروح لـ ElevenLabs مباشرة (أو عن طريق الوسيط لو متضبط)
import { getSettings } from './storage.js';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (أحدث وأكثر تعبيرًا)' },
];

export function isConfigured() {
  const s = getSettings();
  return !!(s.elevenKey && s.elevenVoiceId);
}

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
  return (j.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category }));
}

// تحويل نص لصوت؛ بيرجع Blob (mp3)
export async function speak(text) {
  const { elevenVoiceId, elevenModel } = getSettings();
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(elevenVoiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: elevenModel || MODELS[0].id,
      voice_settings: { stability: 0.6, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
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
