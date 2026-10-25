// قراءة النص بصوت Gemini (اختياري) — مجاني بمفتاح من مشروع جوجل مش مربوط بحساب دفع
// بيستخدم مفتاحه الخاص لو متحط، أو مفتاح Gemini بتاع مساعد الكتابة. الطلب بيروح لجوجل مباشرة.
// للأدعية والأذكار والنص الخاص بس — القرآن بيفضل بأصوات القرّاء.
import { getSettings } from './storage.js';
import { retryFetch } from './llm.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

// أصوات Gemini الجاهزة (الاسم ثابت عند جوجل، والوصف عشان تختار)
export const VOICES = [
  ['Charon', 'رجالي — هادي وواضح'],
  ['Algenib', 'رجالي — عميق ومبحوح'],
  ['Gacrux', 'رجالي — ناضج'],
  ['Iapetus', 'رجالي — واضح'],
  ['Orus', 'رجالي — ثابت'],
  ['Alnilam', 'رجالي — حازم'],
  ['Rasalgethi', 'رجالي — رزين'],
  ['Sadaltager', 'رجالي — رصين'],
  ['Schedar', 'رجالي — متزن'],
  ['Umbriel', 'رجالي — سلس'],
  ['Enceladus', 'رجالي — هامس'],
  ['Fenrir', 'رجالي — متحمس'],
  ['Puck', 'رجالي — مرح'],
  ['Achird', 'رجالي — ودود'],
  ['Zubenelgenubi', 'رجالي — عادي'],
  ['Algieba', 'رجالي — ناعم'],
  ['Sulafat', 'نسائي — دافي'],
  ['Vindemiatrix', 'نسائي — رقيق'],
  ['Achernar', 'نسائي — هادي'],
  ['Kore', 'نسائي — حازم'],
  ['Aoede', 'نسائي — خفيف'],
  ['Despina', 'نسائي — ناعم'],
  ['Erinome', 'نسائي — واضح'],
  ['Leda', 'نسائي — شبابي'],
  ['Zephyr', 'نسائي — مشرق'],
  ['Autonoe', 'نسائي — مشرق'],
  ['Callirrhoe', 'نسائي — بسيط'],
  ['Laomedeia', 'نسائي — مرح'],
  ['Pulcherrima', 'نسائي — مباشر'],
  ['Sadachbia', 'نسائي — حيوي'],
].map(([id, desc]) => ({ id, desc }));

// توجيه الأسلوب (اختياري) بيتبعت كتعليمات منفصلة، مش جوه النص — لأن الموديل ساعات بيقرا أي كلام قبل النص بصوت عالي
export const STYLE_HINT = 'مثلًا: Speak slowly in a calm, gentle, reverent voice.';

// المفتاح: الخاص بالصوت، أو مفتاح Gemini من مساعد الكتابة
export function key() {
  const s = getSettings();
  return (s.gttsKey || (s.llmProvider === 'gemini' ? s.llmKey : '') || '').trim();
}
export const hasKey = () => !!key();

// موديلات الصوت المتاحة للمفتاح؛ Flash عليه مستوى مجاني و Pro مدفوع
export async function listModels(k = key()) {
  if (!k) throw new Error('حط مفتاح Gemini الأول');
  const r = await fetch(`${API}?pageSize=1000&key=${encodeURIComponent(k)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || r.statusText}`);
  const ids = [...new Set((j.models || []).map(m => m.name.replace(/^models\//, '')).filter(id => /tts/.test(id)))];
  const free = id => !/pro/.test(id);
  return ids.sort((a, b) => (free(a) !== free(b) ? (free(a) ? -1 : 1) : b.localeCompare(a, 'en', { numeric: true })))
    .map(id => ({ id, free: free(id), label: free(id) ? '🆓 مجاني' : '💳 مدفوع' }));
}

// الموديلات اللي هنجرّبها بالترتيب: المختار بس، أو (تلقائي) كل موديلات Flash المجانية —
// عشان لو حد اليوم خلص في واحد، نكمّل على اللي بعده (كل موديل ليه حده)
async function pickModels(k) {
  const m = getSettings().gttsModel;
  if (m) return [m];
  const list = await listModels(k);
  const free = list.filter(x => x.free).map(x => x.id);
  if (!list.length) throw new Error('مفتاحك مفيهوش موديلات صوت (TTS)');
  return free.length ? free : [list[0].id];
}

// تحويل نص لصوت؛ بيرجع Blob (wav)
export async function speak(text, voice = '') {
  const k = key();
  if (!k) throw new Error('حط مفتاح Gemini في ⚙️ الإعدادات ← 🔊 صوت Gemini (أو في مساعد الكتابة)');
  const s = getSettings();
  const models = await pickModels(k);
  const style = (s.gttsStyle || '').trim();
  const voiceName = voice || s.gttsVoice || 'Charon';
  const send = (model, withStyle) => retryFetch(`${API}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(k)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // النص لوحده بس — عشان مايتقريش أي مقدمة في أول الصوت
      ...(withStyle ? { systemInstruction: { parts: [{ text: style }] } } : {}),
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });
  let r, j, model;
  for (model of models) {
    r = await send(model, !!style);
    // لو الموديل مش بيقبل تعليمات منفصلة، بنبعت النص لوحده
    if (style && r.status === 400) r = await send(model, false);
    j = await r.json().catch(() => ({}));
    if (r.status !== 429 && r.status !== 503) break; // الحد خلص أو زحمة في الموديل ده: نجرّب اللي بعده
  }
  if (!r.ok) throw new Error(ttsError(r.status, j.error?.message || r.statusText, model, models.length));
  const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error('Gemini مارجّعش صوت' + (j.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''));
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const bytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
  if (/wav|mpeg|mp3|ogg/.test(part.inlineData.mimeType || '')) return new Blob([bytes], { type: part.inlineData.mimeType });
  return pcmToWav(bytes, rate);
}

// جوجل بيرجع PCM خام (16-bit mono) — بنحط عليه هيدر WAV عشان المتصفح يشغله
function pcmToWav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: 'audio/wav' });
}

function ttsError(code, msg, model, tried = 1) {
  const m = String(msg || '');
  // 429 = الحد المجاني خلص (رسالة جوجل فيها كلمة billing بس مش معناها إنك هتدفع)
  if (code === 503 || code === 500) return `⏳ جوجل عليه زحمة دلوقتي في موديلات الصوت — حاولت كذا مرة. جرّب كمان دقيقة. (مش هيتخصم منك حاجة)`;
  if (code === 429) return quotaMsg(m, tried > 1 ? `كل موديلات الصوت المجانية (${tried})` : `موديل الصوت ${model}`);
  if (code === 402 || /prepay/i.test(m)) return `مشروع جوجل اللي طالع منه المفتاح مربوط بحساب دفع (Prepay)، فمش مجاني. اعمل مفتاح في مشروع جديد من غير Billing في aistudio.google.com/apikey. (${code})`;
  if (code === 404 || /not found|model name/i.test(m)) return `موديل الصوت ${model} مش متاح لمفتاحك. اختار «تلقائي» في ⚙️ الإعدادات ← 🔊 صوت Gemini. (${m})`;
  if (code === 400 && /api key/i.test(m)) return 'المفتاح غلط — انسخه تاني من aistudio.google.com/apikey';
  return `Gemini ${code}: ${m}`;
}

// رسالة الحد المجاني: لو جوجل قال استنى ثواني يبقى حد الدقيقة، غير كده حد اليوم
export function quotaMsg(m, what) {
  const wait = /retry in ([\d.]+)s/i.exec(m)?.[1];
  if (wait && Number(wait) < 120) return `⏳ ${what}: حد الدقيقة خلص. استنى ${Math.ceil(Number(wait))} ثانية وجرّب تاني. (مش هيتخصم منك حاجة)`;
  return `⏳ ${what}: الحد المجاني بتاع النهارده خلص — مش مشكلة دفع ومش هيتخصم منك حاجة. بيتجدد كل يوم الساعة 10 الصبح تقريبًا بتوقيت مصر (نص الليل في أمريكا). لحد ما يتجدد: سجّل بصوتك، أو استخدم ElevenLabs. (429)`;
}
