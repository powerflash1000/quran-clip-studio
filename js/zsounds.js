// 📿 أصوات عدّاد الذكر — كلها متولّدة بالكود (من غير ملفات ولا موسيقى ولا أجراس):
// أصوات طبيعية هادية (خشب، خرز سبحة، قطرة مية، نبضة ناعمة) مع كل مرة،
// وصوت مختلف شوية لما الذكر يتغيّر (هوا خفيف، طرقة خشب، خرزتين).
const SR = 44100;

export const REP_SOUNDS = {
  wood: 'تكّة خشب هادية',
  beads: 'خرزة سبحة (حجر)',
  drop: 'قطرة مية',
  soft: 'نبضة ناعمة (واطية)',
  none: 'من غير صوت',
};
export const NEXT_SOUNDS = {
  whoosh: 'نَفَس هوا خفيف',
  knock: 'طرقة خشب عميقة',
  double: 'خرزتين ورا بعض',
  none: 'زي صوت كل مرة',
};

// مولّد أرقام عشوائية ثابت (عشان الصوت يطلع نفسه كل مرة)
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

// كل صوت: بيضيف عيّنات في d من s0 بقوة vol
const SYNTH = {
  wood(d, s0, vol) {
    const L = Math.floor(0.06 * SR);
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const t = i / SR, env = Math.exp(-t * 85);
      d[s0 + i] += vol * env * (Math.sin(2 * Math.PI * 1150 * t) * 0.65 + Math.sin(2 * Math.PI * 2310 * t) * 0.25 + Math.sin(2 * Math.PI * 520 * t) * 0.1);
    }
  },
  beads(d, s0, vol) {
    // خرزتين حجر بيخبطوا: نقرة عالية قصيرة + صدى أخف بعدها بـ ٢٢ ملّي
    const r = rng(7);
    for (const [off, k] of [[0, 1], [Math.floor(0.022 * SR), 0.45]]) {
      const L = Math.floor(0.035 * SR);
      let lp = 0;
      for (let i = 0; i < L && s0 + off + i < d.length; i++) {
        const t = i / SR, env = Math.exp(-t * 160);
        lp += (r() - lp) * 0.55;
        d[s0 + off + i] += vol * 1.5 * k * env * (Math.sin(2 * Math.PI * 3300 * t) * 0.55 + Math.sin(2 * Math.PI * 4700 * t) * 0.2 + lp * 0.35);
      }
    }
  },
  drop(d, s0, vol) {
    // قطرة: نغمة بتطلع بسرعة لفوق وتختفي
    const L = Math.floor(0.12 * SR);
    let ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const t = i / SR, f = 650 + 1100 * (1 - Math.exp(-t * 45)), env = Math.min(1, t * 900) * Math.exp(-t * 38);
      ph += 2 * Math.PI * f / SR;
      d[s0 + i] += vol * 0.8 * env * Math.sin(ph);
    }
  },
  soft(d, s0, vol) {
    // نبضة واطية ناعمة
    const L = Math.floor(0.16 * SR);
    let ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const t = i / SR, f = 140 - 60 * Math.min(1, t * 8), env = Math.min(1, t * 400) * Math.exp(-t * 22);
      ph += 2 * Math.PI * f / SR;
      d[s0 + i] += vol * 1.05 * env * Math.sin(ph);
    }
  },
  whoosh(d, s0, vol) {
    // هوا خفيف: نويز متفلتر بيعلى وينزل في نص ثانية
    const r = rng(11), L = Math.floor(0.55 * SR);
    let a = 0, b = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const p = i / L, env = Math.sin(Math.PI * p) ** 2;
      const cut = 0.02 + 0.08 * Math.sin(Math.PI * p);
      a += (r() - a) * cut; b += (a - b) * cut;
      d[s0 + i] += vol * 1.6 * env * b;
    }
    SYNTH.soft(d, s0, vol * 0.35);
  },
  knock(d, s0, vol) {
    // طرقة خشب عميقة (مرتين خفاف)
    for (const [off, k] of [[0, 1], [Math.floor(0.14 * SR), 0.6]]) {
      const L = Math.floor(0.12 * SR);
      for (let i = 0; i < L && s0 + off + i < d.length; i++) {
        const t = i / SR, env = Math.exp(-t * 40);
        d[s0 + off + i] += vol * k * env * (Math.sin(2 * Math.PI * 330 * t) * 0.6 + Math.sin(2 * Math.PI * 690 * t) * 0.3 + Math.sin(2 * Math.PI * 1500 * t) * 0.1 * Math.exp(-t * 80));
      }
    }
  },
  double(d, s0, vol) {
    SYNTH.beads(d, s0, vol);
    SYNTH.beads(d, s0 + Math.floor(0.13 * SR), vol * 0.85);
  },
};

// صوت كارت ذكر: n مرات على مدة dur — first = الصوت في أول مرة (لما الذكر يتغيّر)
export function counterAudio(n, dur, rep = 'wood', next = 'whoosh') {
  const len = Math.max(1, Math.ceil(dur * SR));
  const buf = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: SR });
  const d = buf.getChannelData(0);
  const R = SYNTH[rep], N = SYNTH[next];
  for (let k = 0; k < n; k++) {
    const s0 = Math.floor(k * dur / n * SR);
    if (k === 0 && N) N(d, s0, 0.3);
    else if (R) R(d, s0, 0.28);
  }
  // حماية من التشويش لو صوتين ركبوا على بعض
  for (let i = 0; i < len; i++) if (d[i] > 0.95) d[i] = 0.95; else if (d[i] < -0.95) d[i] = -0.95;
  return buf;
}

// معاينة صوت واحد (زرار ▶)
let pctx = null;
export function previewSound(kind) {
  const fn = SYNTH[kind];
  if (!fn) return;
  pctx = pctx || new AudioContext();
  const buf = new AudioBuffer({ length: SR, numberOfChannels: 1, sampleRate: SR });
  fn(buf.getChannelData(0), Math.floor(0.05 * SR), 0.32);
  const src = pctx.createBufferSource(); src.buffer = buf; src.connect(pctx.destination); src.start();
}
