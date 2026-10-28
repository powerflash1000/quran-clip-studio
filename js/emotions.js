// أداء الصوت (المشاعر) للتوليد: تاج لـ ElevenLabs v3 + وصف لـ Gemini
// ElevenLabs v3 بيفهم تاجات بين [ ] في أول الكلام، و Gemini بيفهم وصف بالإنجليزي في التعليمات
export const EMOTIONS = [
  { id: '', name: 'عادي' },
  { id: 'calm', name: '😌 هادي', tag: 'calm', say: 'Speak in a calm, gentle, peaceful voice.' },
  { id: 'reverent', name: '🤲 خاشع', tag: 'reverently', say: 'Speak slowly with deep reverence and humility, like a heartfelt supplication.' },
  { id: 'serious', name: '🎙️ رصين', tag: 'serious', say: 'Speak in a serious, steady, dignified voice.' },
  { id: 'warm', name: '🤍 دافي', tag: 'warmly', say: 'Speak warmly and kindly, like comforting a loved one.' },
  { id: 'whisper', name: '🤫 همس', tag: 'whispers', say: 'Whisper softly.' },
  { id: 'sad', name: '😔 حزين', tag: 'sad', say: 'Speak in a sad, sorrowful voice.' },
  { id: 'tearful', name: '🥲 صوت باكي', tag: 'tearful', say: 'Speak with a tearful, trembling voice, holding back tears.' },
  { id: 'crying', name: '😢 بيبكي', tag: 'crying', say: 'Speak while crying, with an emotional, breaking voice.' },
  { id: 'sobbing', name: '😭 بينهنه', tag: 'sobbing', say: 'Speak while sobbing, with breaths between words.' },
  { id: 'sigh', name: '😮‍💨 بيتنهّد', tag: 'sighs', say: 'Begin with a soft sigh, then speak gently.' },
  { id: 'hopeful', name: '🌤️ متفائل', tag: 'hopeful', say: 'Speak in a hopeful, uplifting voice.' },
  { id: 'happy', name: '😊 فرحان', tag: 'happy', say: 'Speak in a happy, cheerful voice.' },
  { id: 'excited', name: '🤩 متحمس', tag: 'excited', say: 'Speak with excitement and energy.' },
  { id: 'laugh', name: '😄 بيضحك', tag: 'laughs', say: 'Speak with light laughter in the voice.' },
  { id: 'surprised', name: '😮 مندهش', tag: 'surprised', say: 'Speak with surprise and wonder.' },
  { id: 'angry', name: '😠 غضبان', tag: 'angry', say: 'Speak in an angry, stern voice.' },
  { id: 'aggressive', name: '💢 حاد / عدواني', tag: 'shouting', say: 'Speak forcefully and aggressively, almost shouting.' },
  { id: 'storyteller', name: '📖 راوي حكايات', tag: 'storytelling', say: 'Narrate like a warm storyteller for children, expressive and clear.' },
];
export const emotion = id => EMOTIONS.find(e => e.id === id) || EMOTIONS[0];
