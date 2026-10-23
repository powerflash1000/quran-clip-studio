// مساعد الكتابة (اختياري): افتتاحيات ووصف وهاشتاجات، وتحسين صياغة النص الخاص
// بيشتغل بمفتاح المستخدم نفسه (Gemini أو OpenAI أو Claude) — المفتاح بيتحفظ في المتصفح بس
// والطلب بيروح من المتصفح للخدمة مباشرة. ممنوع يكتب آيات أو أحاديث أو ينسب كلام لحد.
import { getSettings } from './storage.js';

export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini (فيه مستوى مجاني)',
    model: 'gemini-flash-latest', // اسم ثابت لأحدث Flash — متاح في المستوى المجاني
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    name: 'OpenAI (ChatGPT API — مدفوع)',
    model: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    name: 'Anthropic Claude (مدفوع)',
    model: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
};

// اسم الموديل زي ما الخدمة عايزاه: «Gemini 3.6 Flash» ← gemini-3.6-flash
export const normalizeModel = m => String(m || '').trim().replace(/^models\//, '').replace(/\s+/g, '-').toLowerCase();

export function config() {
  const s = getSettings();
  const provider = PROVIDERS[s.llmProvider] ? s.llmProvider : '';
  return { provider, key: (s.llmKey || '').trim(), model: normalizeModel(s.llmModel) || (provider ? PROVIDERS[provider].model : '') };
}

// الموديلات المتاحة للمفتاح ده (عشان المستخدم يختار من غير ما يكتب الاسم)
export async function listModels() {
  const c = config();
  if (!c.provider || !c.key) throw new Error('اختار المزوّد وحط المفتاح الأول');
  let ids = [];
  if (c.provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(c.key)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || r.statusText}`);
    ids = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => normalizeModel(m.name))
      .filter(id => /gemini/.test(id) && !/(embedding|image|tts|audio|live|vision)/.test(id));
  } else if (c.provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${c.key}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${j.error?.message || r.statusText}`);
    ids = (j.data || []).map(m => m.id).filter(id => /^(gpt|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|search)/.test(id));
  } else {
    const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': c.key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Claude ${r.status}: ${j.error?.message || r.statusText}`);
    ids = (j.data || []).map(m => m.id);
  }
  ids = [...new Set(ids)].sort().reverse();
  // جوجل مابترجعش السعر، فبنعلّم على حسب النوع: Flash و Flash-Lite و Gemma عليهم مستوى مجاني، و Pro مدفوع
  return ids.map(id => ({ id, tag: freeTag(c.provider, id) }))
    .sort((a, b) => (a.tag.free === b.tag.free ? 0 : a.tag.free ? -1 : 1));
}

export function freeTag(provider, id) {
  if (provider !== 'gemini') return { free: false, label: '💳 مدفوع' };
  if (/pro/.test(id)) return { free: false, label: '💳 مدفوع (محتاج Prepay)' };
  if (/(flash|gemma)/.test(id)) return { free: true, label: '🆓 مجاني' };
  return { free: false, label: '❔ غالبًا مدفوع' };
}
export const isReady = () => { const c = config(); return !!(c.provider && c.key); };

// قواعد ثابتة لكل الطلبات
const RULES = `أنت كاتب محتوى قصير لحساب تلاوات قرآنية اسمه «قرآن يريح القلب» على تيك توك وإنستجرام وفيسبوك (الجمهور: مصر والخليج).
قواعد لازم تلتزم بيها:
- ممنوع تكتب أو تقتبس أو تعيد صياغة أو تترجم أي آية قرآنية أو حديث نبوي، وممنوع تنسب أي كلام للنبي ﷺ أو للصحابة أو للعلماء.
- ممنوع تفسّر الآيات أو تشرح معناها أو تقول "الآية دي معناها كذا". تقدر تتكلم عن المشاعر العامة بس (طمأنينة، رجاء، سكينة، توبة).
- ممنوع تخترع فضائل أو أجر ("اللي يشير ليه حسنات"...) وممنوع ضغط أو تهديد ("لو ما شيرتش...") وممنوع كذب أو تهويل.
- أسلوب محترم وهادي، عربي بسيط (عامية مصرية خفيفة مقبولة في الافتتاحيات)، إيموجي قليل (🤍 🌙 ✨ بالكتير).
- رجّع JSON بس، من غير أي كلام قبله أو بعده.`;

// ===== الاتصال بكل مزوّد =====
async function callGemini({ key, model }, system, user) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(geminiError(r.status, j.error?.message || r.statusText, model));
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini رجّع رد فاضي' + (j.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''));
  return text;
}

async function callOpenAI({ key, model }, system, user) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${j.error?.message || r.statusText}`);
  return j.choices?.[0]?.message?.content || '';
}

async function callClaude({ key, model }, system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      // الطلب من المتصفح مباشرة بمفتاح المستخدم نفسه
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low' },
      fallbacks: 'default',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${j.error?.message || r.statusText}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude رفض الطلب ده — جرّب تاني أو غيّر المزوّد');
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// رسائل أوضح لأشهر أخطاء جوجل
function geminiError(code, msg, model) {
  const m = String(msg || '');
  if (/prepay|billing|credits|payment/i.test(m)) {
    return `الموديل ${model} مش مجاني على مشروعك، أو المشروع مربوط بحساب دفع (Prepay). الحل: اعمل مشروع جديد في AI Studio من غير حساب دفع، واختار موديل عليه 🆓 (Flash أو Flash-Lite). (${code})`;
  }
  if (code === 429) return `خلّصت الحد المجاني للدقيقة أو اليوم. استنى شوية وجرّب تاني، أو اختار موديل Flash-Lite. (${m})`;
  if (code === 404 || /not found|model name/i.test(m)) return `اسم الموديل ${model} مش موجود. اضغط «📋 الموديلات المتاحة» واختار من القايمة. (${m})`;
  if (code === 400 && /api key/i.test(m)) return 'المفتاح غلط — انسخه تاني من aistudio.google.com/apikey';
  return `Gemini ${code}: ${m}`;
}

const CALLERS = { gemini: callGemini, openai: callOpenAI, anthropic: callClaude };

// بيرجع JSON؛ لو الموديل لف الرد بكلام أو ```json بناخد أول كائن
export function parseJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch { /* نجرّب نطلّع الكائن */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('الرد مش JSON مفهوم');
}

export async function askJson(task) {
  const c = config();
  if (!c.provider || !c.key) throw new Error('محتاج تختار مزوّد وتحط المفتاح في ⚙️ الإعدادات ← ✨ مساعد الكتابة');
  let text;
  try {
    text = await CALLERS[c.provider](c, RULES, task);
  } catch (e) {
    if (e instanceof TypeError) throw new Error('الطلب ماوصلش للخدمة (النت أو الحجب). جرّب تاني، أو جرّب مزوّد تاني.');
    throw e;
  }
  return parseJson(text);
}

// ===== المهام =====
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// ctx: { summary, hooksThatWorked? }
export async function suggestHooks(ctx) {
  const j = await askJson(`اكتب 6 جمل افتتاحية (Hook) مختلفة لفيديو قصير، كل جملة من 3 لـ 7 كلمات، بتشد المتفرج يكمّل الفيديو للآخر.
نوّع: سؤال، دعوة هادية ("اسمعها بقلبك")، وقت مناسب ("قبل ما تنام")، شعور ("لو قلبك تعبان").
${ctx.hooksThatWorked ? `افتتاحيات نجحت قبل كده عندي: ${ctx.hooksThatWorked}\n` : ''}محتوى الفيديو (للفهم بس، ماتكتبش منه):
${ctx.summary}
الشكل: {"hooks": ["...", "..."]}`);
  return (j.hooks || []).map(clean).filter(Boolean).slice(0, 8);
}

// بيرجع { title, caption, tags[] } لمنصة معينة
export async function writeCaption(ctx, platformName) {
  const j = await askJson(`اكتب نص نشر لفيديو قصير على ${platformName}.
- caption: سطرين أو تلاتة: سطر أول بيشد (Hook) + سطر شعور هادي + دعوة لطيفة للتفاعل من غير ضغط (مثلًا "اكتب «آمين» 🤍" أو "احفظه تسمعه تاني"). ماتكتبش أسماء السور أو أرقام الآيات أو اسم القارئ — البرنامج بيضيفهم تحت لوحده.
- title: عنوان قصير (أقل من 70 حرف).
- tags: من 5 لـ 8 هاشتاجات عربي مناسبة للمحتوى من غير تكرار، كل واحد بيبدأ بـ #.
محتوى الفيديو (للفهم بس، ماتكتبش منه):
${ctx.summary}
الشكل: {"title": "...", "caption": "...", "tags": ["#...", "#..."]}`);
  const tags = (Array.isArray(j.tags) ? j.tags : String(j.tags || '').split(/\s+/))
    .map(t => clean(t).replace(/\s+/g, '_')).filter(Boolean).map(t => (t.startsWith('#') ? t : '#' + t));
  return { title: clean(j.title), caption: String(j.caption || '').trim(), tags };
}

// تحسين صياغة نص خاص (دعاء أو كلام من عند المستخدم) — نفس المعنى
export async function polishText(text) {
  const j = await askJson(`حسّن صياغة النص ده عشان يتقري على الشاشة في فيديو قصير: صحّح الإملاء والهمزات، وقسّمه لسطور قصيرة مريحة، وسيب المعنى زي ما هو بالظبط.
ماتزودش أي آية أو حديث أو كلام منسوب لحد، وماتشيلش أي جزء مهم. لو هو دعاء خليه دعاء.
النص:
${text}
الشكل: {"text": "..."}`);
  const out = String(j.text || '').trim();
  if (!out) throw new Error('الرد فاضي');
  return out;
}

// اختبار الاتصال
export async function ping() {
  const j = await askJson('رجّع {"ok": true} بس.');
  if (!j || j.ok !== true) throw new Error('الرد مش متوقع');
  return true;
}
