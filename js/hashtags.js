// #️⃣ صفحة الهاشتاجات والترند: روابط لكل الأماكن اللي بتعرض الترند والهاشتاجات (حسب البلد)،
// بحث عن أي هاشتاج في كل المنصات بدوسة، اقتراح هاشتاجات بالذكاء الاصطناعي (مرتبطة بالمحتوى فعلًا)،
// أفكار ريلز تركب الترند بأمانة، ومجموعات هاشتاجات محفوظة تنسخها بدوسة. نفس الملف في البرنامجين.
// مفيش أي سحب بيانات من المواقع دي: كله روابط بتتفتح في تاب جديد (المواقع دي بتمنع القراية من برا).

const REGIONS = [
  ['EG', 'مصر', 'egypt'], ['SA', 'السعودية', 'saudi-arabia'], ['AE', 'الإمارات', 'united-arab-emirates'],
  ['KW', 'الكويت', 'kuwait'], ['MA', 'المغرب', 'morocco'], ['DZ', 'الجزائر', 'algeria'], ['IQ', 'العراق', 'iraq'],
  ['JO', 'الأردن', 'jordan'], ['US', 'أمريكا', 'united-states'], ['GB', 'بريطانيا', 'united-kingdom'], ['', 'العالم كله', ''],
];
const CC = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular';
// أماكن الترند (بتتغيّر حسب البلد المختار)
const TREND_SITES = [
  { icon: '🎵', name: 'TikTok Creative Center — الهاشتاجات الطالعة', url: () => `${CC}/hashtag/pc/en`, note: 'أقوى مكان للهاشتاجات: اختار البلد والفترة (٧ أيام) من فوق في الصفحة، ودوس على أي هاشتاج تشوف الفيديوهات بتاعته وهو طالع ولا نازل.' },
  { icon: '🎶', name: 'TikTok Creative Center — الأغاني والأصوات الترند', url: () => `${CC}/music/pc/en`, note: 'الأصوات اللي الناس بتستخدمها دلوقتي (لريلز الكلام والقصص — مش للتلاوة).' },
  { icon: '🎬', name: 'TikTok Creative Center — الفيديوهات الأعلى', url: () => `${CC}/pc/en`, note: 'أكتر الفيديوهات انتشارًا: شوف أول ٣ ثواني فيهم عاملين إيه.' },
  { icon: '📈', name: 'Google Trends — الترند دلوقتي', url: r => `https://trends.google.com/trending${r.code ? '?geo=' + r.code : ''}`, note: 'اللي الناس بتدوّر عليه في جوجل في آخر ٢٤ ساعة في البلد ده.' },
  { icon: '𝕏', name: 'ترند X (تويتر) — trends24', url: r => `https://trends24.in/${r.slug ? r.slug + '/' : ''}`, note: 'الهاشتاجات الترند على X ساعة بساعة.' },
  { icon: '𝕏', name: 'ترند X (تويتر) — getdaytrends', url: r => `https://getdaytrends.com/${r.slug ? r.slug + '/' : ''}`, note: 'نفس الفكرة، وبيوريك مدة بقاء الهاشتاج ترند.' },
  { icon: '📊', name: 'Exploding Topics — مواضيع بتكبر', url: () => 'https://explodingtopics.com/', note: 'مواضيع عالمية بتطلع قبل ما تبقى ترند (إنجليزي).' },
  { icon: '🔎', name: 'مكتبة إعلانات ميتا — افحص أي صفحة', url: () => 'https://www.facebook.com/ads/library/', note: 'تشوف أي صفحة عاملة إعلانات ولا لأ، وتاريخ إنشائها واسمها القديم.' },
];
// مولّدات الهاشتاجات (مواقع خارجية)
const GENERATORS = [
  { name: 'Best-Hashtags', url: t => `https://best-hashtags.com/hashtag/${encodeURIComponent(t)}/`, note: 'أحسن هاشتاجات مرتبطة بالكلمة (إنجليزي أحسن)' },
  { name: 'RiteTag', url: t => `https://ritetag.com/best-hashtags-for/${encodeURIComponent(t)}`, note: 'بيقول الهاشتاج قوي ولا مستهلك' },
  { name: 'All-Hashtag', url: () => 'https://www.all-hashtag.com/hashtag-generator.php', note: 'اكتب الكلمة جوه الموقع' },
  { name: 'Inflact', url: () => 'https://inflact.com/tools/instagram-hashtag-generator/', note: 'مولّد لإنستجرام (اكتب الكلمة جوه الموقع)' },
];
// بحث عن هاشتاج/موضوع في كل منصة
const SEARCH = [
  { name: 'TikTok #', url: (t, q) => `https://www.tiktok.com/tag/${encodeURIComponent(t)}` },
  { name: 'TikTok بحث', url: (t, q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Instagram #', url: t => `https://www.instagram.com/explore/tags/${encodeURIComponent(t)}/` },
  { name: 'Facebook #', url: t => `https://www.facebook.com/hashtag/${encodeURIComponent(t)}` },
  { name: 'Facebook ريلز', url: (t, q) => `https://www.facebook.com/search/videos/?q=${encodeURIComponent(q)}` },
  { name: 'YouTube #', url: t => `https://www.youtube.com/hashtag/${encodeURIComponent(t)}` },
  { name: 'YouTube بحث', url: (t, q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' #shorts')}` },
  { name: 'X #', url: t => `https://x.com/hashtag/${encodeURIComponent(t)}` },
  { name: 'Google Trends', url: (t, q, r) => `https://trends.google.com/trends/explore?${r.code ? 'geo=' + r.code + '&' : ''}q=${encodeURIComponent(q)}` },
];

// أفكار بتركب الترند بصدق (المحتوى نفسه مرتبط بالترند — مش هاشتاج ملزوق)
const IDEAS = {
  quran: [
    { t: '⚽ لاعيبة بيسجدوا بعد الجول + آية الشكر', d: 'مشهد سجود (من صور/فيديو مسموح استخدامه أو رسم) وآية الشكر: إبراهيم ٧ (هاتها من البرنامج).', tags: ['#سجدة_شكر', '#كرة_القدم', '#كأس_العالم', '#قرآن', '#football'] },
    { t: '🏆 «النصر من عند الله» قبل ماتش كبير', d: 'آية «وما النصر إلا من عند الله»: آل عمران ١٢٦، مع خلفية ملعب.', tags: ['#كأس_العالم_2026', '#النصر', '#قرآن_كريم', '#worldcup'] },
    { t: '🌙 لاعيبة صايمين في الماتشات (رمضان)', d: 'معلومة + آية الصيام: البقرة ١٨٣.', tags: ['#رمضان', '#صيام', '#لاعبين_مسلمين', '#ramadan'] },
    { t: '🤍 قصة لاعب أو مشهور أسلم', d: 'احكي القصة من مصدر موثوق (اذكره في الوصف) + آية الهداية: الأنعام ١٢٥. ماتنسبش لحد حاجة من غير مصدر.', tags: ['#أسلم', '#الإسلام', '#هداية', '#قصص_مؤثرة'] },
    { t: '📚 امتحانات / نتيجة الثانوية', d: 'دعاء المذاكرة + آية «وقل رب زدني علما»: طه ١١٤ — بيتشارك جدًا في موسم الامتحانات.', tags: ['#الثانوية_العامة', '#امتحانات', '#دعاء_المذاكرة', '#ربي_زدني_علما'] },
    { t: '🌧️ حدث طقس (مطر/حر شديد)', d: 'دعاء المطر أو آية مرتبطة، في نفس يوم الحدث وهو ترند.', tags: ['#مطر', '#دعاء', '#قرآن', '#ترند_مصر'] },
  ],
  news: [
    { t: '⚽ خبر رياضي ترند + الأرقام', d: 'الخبر الحقيقي بالمصدر + بطاقة إحصائيات (قالب stat).', tags: ['#كأس_العالم_2026', '#football', '#أخبار_الرياضة'] },
    { t: '📈 أكتر حاجة اتبحثت النهارده', d: 'خد الموضوع من Google Trends واعمل عليه شرح «يعني إيه وليه مهم» بمصدر.', tags: ['#ترند', '#ترند_مصر', '#أخبار'] },
    { t: '🗺️ حدث في بلد — بالخريطة', d: 'قالب الخريطة + المصدر، والهاشتاج اسم البلد والحدث.', tags: ['#عاجل', '#أخبار_العالم'] },
  ],
};

// 🔀 الترند المشترك بين المنصات (مصر/السعودية): بيتجمع كل ساعة في استوديو الريلز (tools/cross-trends.mjs → data/cross.json)
const CROSS_URLS = ['https://powerflash1000.github.io/news-reels-studio/data/cross.json', 'https://raw.githubusercontent.com/powerflash1000/news-reels-studio/main/data/cross.json'];
const PLAT = { google: ['🔍', 'جوجل'], youtube: ['▶️', 'يوتيوب'], x: ['𝕏', 'X'], tiktok: ['🎵', 'تيك توك'] };
const normT = s => String(s || '').toLowerCase().replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[#_]/g, ' ').replace(/\s+/g, ' ');
// موضوع ترند ← فكرة قرآنية/دعاء صحيح مرتبط بيه فعلًا (النصوص بمصادرها؛ راجع النص من البرنامج قبل النشر)
const QIDEAS = [
  [/مطر|امطار|سيول|غيث|\brain\b/, '🌧️ مطر', 'دعاء المطر: «اللهم صيبًا نافعًا» (رواه البخاري) + «وهو الذي ينزل الغيث من بعد ما قنطوا» (الشورى ٢٨).'],
  [/عاصف|رياح|ريح|غبار|storm|wind/, '🌬️ رياح وعواصف', 'دعاء الريح: «اللهم إني أسألك خيرها وخير ما فيها وخير ما أرسلت به، وأعوذ بك من شرها وشر ما فيها وشر ما أرسلت به» (رواه مسلم).'],
  [/زلزال|هزه ارضيه|earthquake/, '🌍 زلزال', 'سورة الزلزلة، ودعاء للمتضررين — من غير تخويف ولا صور مؤلمة.'],
  [/وفاه|توفي|رحيل|نعي|died|death|passed away/, '🤍 وفاة', '«إنا لله وإنا إليه راجعون، اللهم أجرني في مصيبتي واخلف لي خيرًا منها» (رواه مسلم). احترم أهل المتوفى وماتستغلش الخبر.'],
  [/امتحان|نتيجه|ثانويه|exam/, '📚 امتحانات', '«رب اشرح لي صدري ويسر لي أمري» (طه ٢٥–٢٦) و«وقل رب زدني علما» (طه ١١٤).'],
  [/رمضان|صيام|سحور|افطار|ramadan/, '🌙 رمضان', 'آية الصيام (البقرة ١٨٣)، ودعاء ليلة القدر: «اللهم إنك عفو تحب العفو فاعف عني» (رواه الترمذي وصححه).'],
  [/جمعه|استجابه|friday/, '🕌 الجمعة', 'سورة الكهف، والإكثار من الصلاة على النبي ﷺ يوم الجمعة.'],
  [/(^| )عيد|اضحي|حج|عرفه|عمره|الحرم|مكه|eid|hajj/, '🕋 حج وعيد', 'التكبير، وآية الحج «وأذن في الناس بالحج» (الحج ٢٧).'],
  [/موجه حاره|حر شديد|درجات الحراره|heat ?wave/, '☀️ حر شديد', 'حديث «اشتكت النار إلى ربها…» (متفق عليه) — تذكير لطيف بالنار والجنة.'],
  [/غزه|فلسطين|الاقصي|القدس|gaza|palestin/, '🤲 فلسطين', 'آية الإسراء (الإسراء ١)، ودعاء للمستضعفين — من غير صور عنف.'],
  [/مباراه|ماتش|الاهلي|الزمالك|منتخب|كاس|دوري|الهلال|النصر|الاتحاد|\bmatch\b|\bcup\b/, '⚽ كورة', '«وما النصر إلا من عند الله» (آل عمران ١٢٦) — مشهد سجود شكر بعد الجول.'],
  [/حريق|حادث|انهيار|غرق/, '🤲 حادث', 'الدعاء للمصابين بالشفاء ولمن توفي بالرحمة، و«إنا لله وإنا إليه راجعون» (البقرة ١٥٦) — من غير صور للضحايا.'],
  [/الفردوس|الجنه|جنات/, '🌿 الجنة', '«إن الذين آمنوا وعملوا الصالحات كانت لهم جنات الفردوس نزلا» (الكهف ١٠٧).'],
  [/مصحف|قران|سوره|تلاوه/, '📖 القرآن', 'القرآن نفسه ترند: شارك تلاوة لآية مناسبة بصوت قارئ تحبه، بالهاشتاج ده.'],
  [/مرض|مستشفي|شفاء|فيروس|virus/, '🩺 مرض وشفاء', 'دعاء الشفاء: «اللهم رب الناس، أذهب البأس، اشف أنت الشافي…» (متفق عليه).'],
  [/سفر|طيران|مطار|travel/, '✈️ سفر', 'دعاء السفر (رواه مسلم).'],
  [/كسوف|خسوف|eclipse/, '🌘 كسوف وخسوف', '«إن الشمس والقمر آيتان من آيات الله…» (متفق عليه).'],
];
const qIdea = text => { const t = normT(text); const m = QIDEAS.find(([re]) => re.test(t)); return m ? { t: m[1], d: m[2] } : null; };

const css = `
.ht-wrap{max-width:1100px;margin:0 auto;padding:16px}
.ht-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.55rem}
.ht-card{display:block;padding:.65rem .75rem;border:1px solid var(--line,#ddd);border-radius:10px;text-decoration:none;color:inherit;background:var(--card,transparent)}
.ht-card:hover{border-color:var(--accent,#1f6f5c)}
.ht-card small{display:block;opacity:.7;margin-top:.2rem;line-height:1.5}
.ht-sec{margin:1.1rem 0 .5rem;font-size:1.1rem}
.ht-row{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
.ht-row input[type=text],.ht-row input[type=search]{flex:1;min-width:220px;font-size:1.05rem;padding:.5rem .7rem}
.ht-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin:.4rem 0}
.ht-tag{padding:.15rem .5rem;border-radius:999px;border:1px solid var(--line,#ccc);cursor:pointer;direction:ltr;unicode-bidi:plaintext}
.ht-tag.on{background:var(--accent,#1f6f5c);color:#fff;border-color:transparent}
.ht-box{border:1px solid var(--line,#ddd);border-radius:12px;padding:.8rem;margin-bottom:.8rem}
.ht-warn{font-size:.88rem;opacity:.85;line-height:1.7}
.ht-btn{display:inline-block;padding:.35rem .7rem;border:1px solid var(--line,#ccc);border-radius:8px;text-decoration:none;color:inherit;font-size:.92rem}
.ht-btn:hover{border-color:var(--accent,#1f6f5c)}
.ht-x{border:1px solid var(--line,#ddd);border-radius:10px;padding:.55rem .7rem;margin:.4rem 0}
.ht-x.hot{border-color:#ff3b5c}
.ht-x .pl{display:flex;flex-wrap:wrap;gap:.3rem;font-size:.85rem;margin-top:.25rem}
.ht-x .pl a{padding:0 .45rem;border:1px solid var(--line,#ccc);border-radius:999px;text-decoration:none;color:inherit}
.ht-q{margin-top:.35rem;padding:.4rem .6rem;border-radius:8px;background:rgba(31,111,92,.12);font-size:.92rem;line-height:1.7}
`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// هاشتاج صالح: من غير # ومسافات ← _
export const cleanTag = s => String(s || '').trim().replace(/^#+/, '').replace(/[\s\-]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');

// opts: { app:'quran'|'news', prefix:'qcs:'|'nrs:', ask?: async ({topic, platform, lang}) => {ar:[], en:[], note} }
export function mountHashtags(root, opts) {
  const P = opts.prefix || 'ht:';
  const load = (k, d) => { try { const v = localStorage.getItem(P + 'ht:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(P + 'ht:' + k, JSON.stringify(v)); } catch { /* مش مهم */ } };
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  let region = REGIONS.find(r => r[0] === load('region', 'EG')) || REGIONS[0];
  const R = () => ({ code: region[0], name: region[1], slug: region[2] });
  let picked = new Set();
  let sets = load('sets', []);

  root.innerHTML = `<div class="ht-wrap">
    <div class="ht-row" style="margin-bottom:.4rem"><h1 style="margin:0;font-size:1.35rem;flex:1">#️⃣ الهاشتاجات والترند</h1>
      <label>البلد <select data-h="region">${REGIONS.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('')}</select></label></div>
    <p class="ht-warn">⚠️ الهاشتاج لازم يبقى <b>مرتبط فعلًا</b> بالمحتوى. هاشتاجات الكورة أو الأفلام على ريل مالوش علاقة بيها فيسبوك بيعتبرها سبام (ممكن يقلّل وصول الصفحة)، والجمهور اللي بيجي منها مش بيتابعك. خد <b>الموضوع</b> الترند واعمل عليه محتوى صادق — والأفكار تحت أمثلة.</p>

    <h2 class="ht-sec">🔀 الترند المشترك بين المنصات</h2>
    <div class="ht-box">
      <div class="ht-row"><span data-h="xChips"></span>
        ${opts.app === 'quran' ? '<label class="ht-warn"><input type="checkbox" data-h="xMine"> 🕌 اللي ينفع أعمل عليه محتوى ديني بس</label>' : ''}
        <button class="btn ghost" type="button" data-h="xReload">↻ حدّث</button></div>
      <p class="ht-warn" data-h="xSrc"></p>
      <div data-h="xList"><p class="ht-warn">⏳ بيحمّل…</p></div>
      <p class="ht-warn">الموضوع اللي طالع في أكتر من منصة في نفس الوقت (جوجل، يوتيوب، X، تيك توك) = ترند حقيقي واسع. بيتحدّث كل ساعة لوحده. دوس على أي هاشتاج يتعلّم ويتنسخ مع الباقي تحت.</p>
    </div>

    <h2 class="ht-sec">📈 فين الترند دلوقتي؟ <small style="font-weight:400;opacity:.7" data-h="regName"></small></h2>
    <div class="ht-grid" data-h="trends"></div>

    <h2 class="ht-sec">🔎 دوّر على هاشتاج أو موضوع في كل المنصات</h2>
    <div class="ht-box">
      <div class="ht-row"><input type="search" data-h="q" placeholder="مثلًا: سجدة شكر، محمد صلاح، worldcup، رمضان"></div>
      <div class="ht-row" style="margin-top:.5rem" data-h="search"></div>
      <div class="ht-row" style="margin-top:.5rem"><b style="font-size:.9rem">مولّدات هاشتاجات:</b> <span data-h="gens" class="ht-row"></span></div>
    </div>

    <h2 class="ht-sec">🤖 اقترحلي هاشتاجات للريل ده</h2>
    <div class="ht-box">
      <div class="ht-row"><input type="text" data-h="topic" placeholder="اكتب موضوع الريل: مثلًا «سورة الكهف بصوت ياسر الدوسري — آية عن الصبر»">
        <select data-h="plat"><option value="all">كل المنصات</option><option value="tiktok">تيك توك</option><option value="instagram">إنستجرام</option><option value="facebook">فيسبوك</option><option value="youtube">يوتيوب شورتس</option></select>
        <button class="btn primary" data-h="ai" type="button">✨ اقترح</button></div>
      <p class="ht-warn" data-h="aiMsg">${opts.ask ? 'بيستخدم مزوّد الذكاء الاصطناعي اللي في ⚙️ الإعدادات. دوس على أي هاشتاج يتعلّم، وانسخ المتعلّم.' : 'محتاج مزوّد ذكاء اصطناعي في الإعدادات.'}</p>
      <div class="ht-tags" data-h="aiTags"></div>
    </div>

    <h2 class="ht-sec">💡 أفكار تركب الترند بأمانة</h2>
    <div class="ht-grid" data-h="ideas"></div>

    <h2 class="ht-sec">🕵️ افحص صفحة أو حساب — تفاعل حقيقي ولا مصنوع؟</h2>
    <div class="ht-box">
      <div class="ht-row"><input type="text" data-h="acc" placeholder="اسم الحساب أو اللينك — مثلًا: zad.almoumen أو tiktok.com/@name">
        <select data-h="accPlat"><option value="tiktok">تيك توك</option><option value="instagram">إنستجرام</option><option value="youtube">يوتيوب</option><option value="facebook">فيسبوك</option></select></div>
      <div class="ht-row" style="margin-top:.5rem" data-h="accLinks"></div>
      <p class="ht-warn">Social Blade بيوريك رسم نمو المتابعين يوم بيوم — القفزة المفاجئة وبعدها خط مستقيم = غالبًا شراء —. HypeAuditor بيقدّر نسبة المتابعين الوهميين — جزء منه مجاني —. فيسبوك مالوش أداة عامة: افتح الصفحة ← «حول» ← «شفافية الصفحة»، أو مكتبة الإعلانات.</p>

      <h3 style="margin:.9rem 0 .3rem;font-size:1rem">🧮 حاسبة نسب التفاعل لريل أو بوست</h3>
      <div class="ht-row"><label>المشاهدات <input type="number" min="0" data-h="cV" style="width:9em"></label><label>اللايكات <input type="number" min="0" data-h="cL" style="width:8em"></label><label>التعليقات <input type="number" min="0" data-h="cC" style="width:7em"></label><label>المشاركات <input type="number" min="0" data-h="cS" style="width:7em"></label></div>
      <div data-h="calcOut" style="margin-top:.5rem"></div>

      <h3 style="margin:.9rem 0 .3rem;font-size:1rem">✅ قايمة الفحص — علّم على اللي لقيته</h3>
      <div data-h="checks"></div>
      <p data-h="checkOut" style="font-weight:700;margin:.4rem 0 0"></p>
    </div>

    <h2 class="ht-sec">📋 الهاشتاجات المتعلّمة ومجموعاتي</h2>
    <div class="ht-box">
      <div class="ht-tags" data-h="picked"></div>
      <div class="ht-row"><input type="text" data-h="manual" placeholder="ضيف هاشتاجات بإيدك (افصل بمسافة أو فاصلة)"><button class="btn" data-h="addManual" type="button">＋ ضيف</button></div>
      <div class="ht-row" style="margin-top:.5rem"><button class="btn primary" data-h="copy" type="button">📋 انسخ المتعلّم</button>
        <input type="text" data-h="setName" placeholder="اسم المجموعة (مثلًا: تلاوة)" style="max-width:220px"><button class="btn" data-h="saveSet" type="button">💾 احفظ كمجموعة</button>
        <button class="btn ghost" data-h="clear" type="button">✕ امسح المتعلّم</button></div>
      <div data-h="sets" style="margin-top:.6rem"></div>
      <p class="ht-warn">نصيحة: من ٣ لـ ٦ هاشتاجات كفاية — ٢ عامين (#قرآن) + ٢ متخصصين (اسم السورة/القارئ) + ١ ترند مرتبط.</p>
    </div>
  </div>`;
  const q = k => root.querySelector(`[data-h=${k}]`);
  const open = u => window.open(u, '_blank', 'noopener');

  const renderTrends = () => {
    q('regName').textContent = `— ${region[1]}`;
    q('trends').innerHTML = TREND_SITES.map(s => `<a class="ht-card" href="${esc(s.url(R()))}" target="_blank" rel="noopener">${s.icon} <b>${esc(s.name)}</b><small>${esc(s.note)}</small></a>`).join('');
  };
  q('region').value = region[0];
  q('region').onchange = () => { region = REGIONS.find(r => r[0] === q('region').value) || REGIONS[0]; save('region', region[0]); renderTrends(); renderSearch(); };

  // 🔀 الترند المشترك
  let cross = null, xr = load('xr', 'eg');
  const loadCross = async () => {
    q('xList').innerHTML = '<p class="ht-warn">⏳ بيحمّل…</p>';
    cross = null;
    for (const u of opts.crossUrl ? [opts.crossUrl] : CROSS_URLS) {
      try { const r = await fetch(u + '?t=' + Date.now()); if (r.ok) { cross = await r.json(); break; } } catch { /* اللي بعده */ }
    }
    renderCross();
  };
  const ago = iso => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? 'أقل من ساعة' : h < 48 ? `${Math.round(h)} ساعة` : `${Math.round(h / 24)} يوم`; };
  const renderCross = () => {
    if (!cross?.regions) { q('xChips').innerHTML = ''; q('xSrc').textContent = ''; q('xList').innerHTML = '<p class="ht-warn">❌ مقدرتش أجيب الترند المشترك دلوقتي — جرّب «↻ حدّث» كمان شوية.</p>'; return; }
    if (!cross.regions[xr]) xr = Object.keys(cross.regions)[0];
    const Rg = cross.regions[xr];
    q('xChips').innerHTML = Object.entries(cross.regions).map(([k, r]) => `<button class="btn${k === xr ? ' primary' : ''}" type="button" data-xr="${k}">${k === 'eg' ? '🇪🇬' : k === 'sa' ? '🇸🇦' : '🌍'} ${esc(r.name)}</button>`).join(' ');
    q('xSrc').innerHTML = Object.entries(PLAT).map(([k, [ic, nm]]) => { const v = Rg.sources?.[k]; return v?.ok ? `${ic} ${nm} ✅` : v?.url ? `${ic} ${nm}: <a href="${esc(v.url)}" target="_blank" rel="noopener">افتحه بنفسك ↗</a>` : `${ic} ${nm} ⚠️ مش متاح`; }).join(' · ') + ` · آخر تحديث من ${ago(cross.updated)}`;
    const mine = opts.app === 'quran' && q('xMine')?.checked;
    const card = (t, single) => {
      const idea = opts.app === 'quran' ? qIdea(t.label + ' ' + Object.values(t.platforms || {}).map(v => v.label).join(' ')) : null;
      if (mine && !idea) return '';
      const pl = Object.entries(t.platforms || {}).sort((a, b) => a[1].rank - b[1].rank).map(([k, v]) => `<a href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.label)}">${PLAT[k][0]} ${PLAT[k][1]} #${v.rank}</a>`).join('');
      const tags = [...new Set([...(t.tags || []), '#' + cleanTag(t.label)])].filter(x => x.length > 2).slice(0, 6);
      return `<div class="ht-x${t.count >= 3 ? ' hot' : ''}"><b>${esc(t.label)}</b> ${single ? '' : `<span class="ht-warn">🔀 في ${t.count} منصات</span>`}
        <div class="pl">${pl}</div><div class="ht-tags">${tags.map(h => `<span class="ht-tag" data-t="${esc(cleanTag(h))}">#${esc(cleanTag(h))}</span>`).join('')}</div>
        ${idea ? `<div class="ht-q">🕌 <b>${esc(idea.t)}:</b> ${esc(idea.d)}</div>` : ''}</div>`;
    };
    let html = (Rg.cross || []).map(t => card(t)).join('');
    if (!html) html = `<p class="ht-warn">${mine ? 'مفيش موضوع مشترك مناسب لمحتوى ديني دلوقتي.' : 'مفيش موضوع مشترك بين المنصات دلوقتي.'}</p>`;
    // مواضيع في منصة واحدة بس، بس ليها فكرة قرآنية (فرصة حتى لو مش مشتركة)
    if (opts.app === 'quran') {
      const seen = new Set((Rg.cross || []).map(t => normT(t.label)));
      const singles = [];
      for (const [k, L] of Object.entries(Rg.top || {})) for (const e of L) {
        if (k === 'youtube' || seen.has(normT(e.label)) || !qIdea(e.label)) continue;
        seen.add(normT(e.label));
        singles.push({ label: e.label.replace(/^#/, '').replace(/_/g, ' '), tags: e.label.startsWith('#') ? [e.label] : [], count: 1, platforms: { [k]: { rank: e.rank, label: e.label, url: e.url } } });
      }
      if (singles.length) html += `<h3 class="ht-sec" style="font-size:1rem">🕌 ترند في منصة واحدة بس — بس ليه فكرة مناسبة ليك</h3>` + singles.slice(0, 8).map(t => card(t, true)).join('');
    }
    q('xList').innerHTML = html;
    renderPicked();
  };
  q('xChips').onclick = e => { const b = e.target.closest('[data-xr]'); if (b) { xr = b.dataset.xr; save('xr', xr); renderCross(); } };
  if (q('xMine')) { q('xMine').checked = load('xMine', false); q('xMine').onchange = () => { save('xMine', q('xMine').checked); renderCross(); }; }
  q('xReload').onclick = loadCross;

  const renderSearch = () => {
    const raw = q('q').value.trim(), tag = cleanTag(raw);
    q('search').innerHTML = SEARCH.map((s, i) => `<button class="btn" type="button" data-s="${i}" ${raw ? '' : 'disabled'}>${esc(s.name)}</button>`).join('');
    q('gens').innerHTML = GENERATORS.map((g, i) => `<a class="ht-btn" href="${esc(g.url(tag || 'quran'))}" target="_blank" rel="noopener" title="${esc(g.note)}">${esc(g.name)}</a>`).join('');
  };
  q('q').oninput = renderSearch;
  q('q').onkeydown = e => { if (e.key === 'Enter') root.querySelector('[data-s="0"]')?.click(); };
  q('search').onclick = e => {
    const i = e.target.closest('[data-s]')?.dataset.s;
    const raw = q('q').value.trim();
    if (i == null || !raw) return;
    open(SEARCH[+i].url(cleanTag(raw), raw.replace(/^#/, ''), R()));
  };

  // الهاشتاجات المتعلّمة
  const renderPicked = () => {
    q('picked').innerHTML = [...picked].map(t => `<span class="ht-tag on" data-un="${esc(t)}" title="دوس تشيله">#${esc(t)} ✕</span>`).join('') || '<span class="ht-warn">مفيش هاشتاجات متعلّمة — دوس على أي هاشتاج في الأفكار أو الاقتراحات.</span>';
    root.querySelectorAll('.ht-tag[data-t]').forEach(x => x.classList.toggle('on', picked.has(x.dataset.t)));
  };
  const toggle = t => { t = cleanTag(t); if (!t) return; picked.has(t) ? picked.delete(t) : picked.add(t); renderPicked(); };
  root.addEventListener('click', e => {
    const tg = e.target.closest('.ht-tag[data-t]'); if (tg) return toggle(tg.dataset.t);
    const un = e.target.closest('[data-un]'); if (un) { picked.delete(un.dataset.un); renderPicked(); }
  });
  q('addManual').onclick = () => { for (const t of q('manual').value.split(/[\s,،]+/)) { const c = cleanTag(t); if (c) picked.add(c); } q('manual').value = ''; renderPicked(); };
  q('manual').onkeydown = e => { if (e.key === 'Enter') q('addManual').click(); };
  q('clear').onclick = () => { picked.clear(); renderPicked(); };
  const copy = async txt => {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
  };
  q('copy').onclick = async () => {
    if (!picked.size) return;
    const ok = await copy([...picked].map(t => '#' + t).join(' '));
    q('copy').textContent = ok ? '✅ اتنسخ' : '❌ مقدرتش أنسخ';
    setTimeout(() => { q('copy').textContent = '📋 انسخ المتعلّم'; }, 1500);
  };
  const renderSets = () => {
    q('sets').innerHTML = sets.map((s, i) => `<div class="ht-row" style="margin:.25rem 0"><b>${esc(s.name)}</b><span class="ht-warn" style="direction:ltr;unicode-bidi:plaintext">${esc(s.tags.map(t => '#' + t).join(' '))}</span>
      <button class="btn" type="button" data-set-copy="${i}">📋 انسخ</button><button class="btn" type="button" data-set-use="${i}">علّمهم</button><button class="btn ghost" type="button" data-set-del="${i}">✕</button></div>`).join('');
  };
  q('saveSet').onclick = () => {
    if (!picked.size) return;
    const name = q('setName').value.trim() || `مجموعة ${sets.length + 1}`;
    sets = [...sets.filter(s => s.name !== name), { name, tags: [...picked] }];
    save('sets', sets); q('setName').value = ''; renderSets();
  };
  q('sets').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +(b.dataset.setCopy ?? b.dataset.setUse ?? b.dataset.setDel);
    const s = sets[i]; if (!s) return;
    if (b.dataset.setCopy != null) { const ok = await copy(s.tags.map(t => '#' + t).join(' ')); b.textContent = ok ? '✅' : '❌'; setTimeout(() => { b.textContent = '📋 انسخ'; }, 1200); }
    if (b.dataset.setUse != null) { s.tags.forEach(t => picked.add(t)); renderPicked(); }
    if (b.dataset.setDel != null && confirm(`تمسح «${s.name}»؟`)) { sets.splice(i, 1); save('sets', sets); renderSets(); }
  };

  // الأفكار
  q('ideas').innerHTML = (IDEAS[opts.app] || IDEAS.quran).map(x => `<div class="ht-card"><b>${esc(x.t)}</b><small>${esc(x.d)}</small><div class="ht-tags">${x.tags.map(t => `<span class="ht-tag" data-t="${esc(cleanTag(t))}">#${esc(cleanTag(t))}</span>`).join('')}</div></div>`).join('');

  // اقتراح بالذكاء الاصطناعي
  q('ai').onclick = async () => {
    const topic = q('topic').value.trim();
    if (!topic) return q('topic').focus();
    if (!opts.ask) return;
    const btn = q('ai'); btn.disabled = true; q('aiMsg').textContent = '⏳ بيفكّر…';
    try {
      const r = await opts.ask({ topic, platform: q('plat').value, region: region[1] });
      const all = [...(r.ar || []), ...(r.en || [])].map(cleanTag).filter(Boolean);
      q('aiTags').innerHTML = [...new Set(all)].map(t => `<span class="ht-tag${picked.has(t) ? ' on' : ''}" data-t="${esc(t)}">#${esc(t)}</span>`).join('');
      q('aiMsg').textContent = (r.note ? r.note + ' — ' : '') + 'دوس على اللي يعجبك يتعلّم. اتأكد بنفسك إن الهاشتاج عليه محتوى شبه بتاعك (دوس عليه في «دوّر» فوق).';
    } catch (e) { q('aiMsg').textContent = '❌ ' + (e.message || e); } finally { btn.disabled = false; }
  };

  // 🕵️ فحص حساب: لينكات بالاسم
  const accName = () => {
    let v = q('acc').value.trim();
    const m = v.match(/(?:tiktok\.com\/@|instagram\.com\/|youtube\.com\/@|facebook\.com\/)([^/?#\s]+)/i);
    if (m) v = m[1];
    return v.replace(/^@/, '').replace(/\/$/, '');
  };
  const ACC = {
    tiktok: n => [['Social Blade', `https://socialblade.com/tiktok/user/${n}`], ['HypeAuditor', `https://hypeauditor.com/tiktok/${n}/`], ['افتح الحساب', `https://www.tiktok.com/@${n}`]],
    instagram: n => [['Social Blade', `https://socialblade.com/instagram/user/${n}`], ['HypeAuditor', `https://hypeauditor.com/instagram/${n}/`], ['افتح الحساب', `https://www.instagram.com/${n}/`]],
    youtube: n => [['Social Blade', `https://socialblade.com/youtube/handle/${n}`], ['HypeAuditor', `https://hypeauditor.com/youtube/${n}/`], ['افتح القناة', `https://www.youtube.com/@${n}`]],
    facebook: n => [['مكتبة الإعلانات', `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(n)}&search_type=keyword_unordered`], ['افتح الصفحة', /^\d+$/.test(n) ? `https://www.facebook.com/profile.php?id=${n}` : `https://www.facebook.com/${n}`]],
  };
  const renderAcc = () => {
    const n = accName();
    q('accLinks').innerHTML = n ? ACC[q('accPlat').value](encodeURIComponent(n)).map(([t, u]) => `<a class="ht-btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('') : '<span class="ht-warn">اكتب اسم الحساب فوق.</span>';
  };
  q('acc').oninput = renderAcc; q('accPlat').onchange = renderAcc; renderAcc();

  // 🧮 حاسبة النسب
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : NaN);
  const f1 = x => (x >= 10 ? x.toFixed(0) : x.toFixed(x >= 1 ? 1 : 2));
  const verdictRow = (label, val, ok, warn, note) => `<div style="margin:.2rem 0"><b>${label}:</b> ${Number.isFinite(val) ? f1(val) + '٪' : '—'} ${Number.isFinite(val) ? (ok ? '🟢 طبيعي' : warn ? '🟡 مش معتاد' : '🔴 مشبوه') : ''} <span class="ht-warn">${note}</span></div>`;
  const calc = () => {
    const V = +q('cV').value || 0, L = +q('cL').value || 0, C = +q('cC').value || 0, S = +q('cS').value || 0;
    if (!V && !L) { q('calcOut').innerHTML = '<span class="ht-warn">اكتب الأرقام اللي ظاهرة تحت الريل.</span>'; return; }
    const lv = pct(L, V), cl = pct(C, L), sl = pct(S, L);
    q('calcOut').innerHTML =
      verdictRow('اللايكات ÷ المشاهدات', lv, lv >= 1 && lv <= 12, (lv >= 0.3 && lv < 1) || (lv > 12 && lv <= 20), '— الطبيعي ١٪–١٠٪ تقريبًا: أقل جدًا = مشاهدات مشتريّة، أعلى جدًا = لايكات مشتريّة')
      + verdictRow('التعليقات ÷ اللايكات', cl, cl >= 0.5 && cl <= 10, (cl > 10 && cl <= 25) || (cl >= 0.1 && cl < 0.5), '— تعليقات كتير جدًا متشابهة = جروبات تفاعل')
      + verdictRow('المشاركات ÷ اللايكات', sl, sl <= 60, sl > 60 && sl <= 150, '— محتوى ديني بيتشارك كتير، بس مشاركات أكتر من اللايكات بكتير = شبكة مشاركات')
      + '<p class="ht-warn" style="margin:.3rem 0 0">النسب مؤشر بس، مش حكم نهائي — ريل بيضرب بجد ممكن يطلع رقم غريب. اجمعها مع قايمة الفحص تحت.</p>';
  };
  for (const k of ['cV', 'cL', 'cC', 'cS']) q(k).oninput = calc;
  calc();

  // ✅ قايمة الفحص
  const CHECKS = [
    'المسؤولين عن الصفحة في بلد مالهاش علاقة بجمهورها — من «شفافية الصفحة»',
    'الصفحة جديدة أو اسمها اتغيّر قريب',
    'الوصف أو الهاشتاجات مالهاش علاقة بالفيديو — منسوخة من ترند',
    'هاشتاجات تبادل تفاعل زي fblifestyle / frindship / challenge',
    'من عينة ٢٠ حساب عملوا لايك: أكتر من ٨ من غير صورة أو جداد أو من بلاد بعيدة',
    'تعليقات متكررة بنفس الكلام في نفس الدقيقة، ومحدش بيتكلم عن الفيديو نفسه',
    'نسب الحاسبة فوق فيها 🔴',
    'المتابعين بيزيدوا على دفعات مفاجئة — ألف في ساعة وبعدين صفر',
  ];
  q('checks').innerHTML = CHECKS.map((c, i) => `<label class="check" style="display:block;margin:.15rem 0"><input type="checkbox" data-ck="${i}"> ${esc(c)}</label>`).join('');
  const checkOut = () => {
    const n = root.querySelectorAll('[data-ck]:checked').length;
    q('checkOut').textContent = n >= 4 ? `🔴 ${n} من ${CHECKS.length}: غالبًا تفاعل مصنوع أو شبكة صفحات.` : n >= 2 ? `🟡 ${n} من ${CHECKS.length}: فيه علامات — كمّل الفحص قبل ما تحكم.` : `🟢 ${n} من ${CHECKS.length}: غالبًا نمو طبيعي — ريل ضرب بجد.`;
  };
  q('checks').onchange = checkOut; checkOut();

  renderTrends(); renderSearch(); renderPicked(); renderSets();
  loadCross();
}

// البرومبت المشترك للاقتراح (كل برنامج بيبعته لمزوّده)
export function hashtagPrompt({ topic, platform, region }) {
  return `Suggest social-media hashtags for a short vertical video.
Topic (from the creator): ${topic}
Platform: ${platform}. Audience region: ${region}.
Rules: hashtags must be genuinely relevant to the topic (no unrelated trending tags, no engagement bait, no misleading tags). Mix: 3-5 Arabic hashtags people actually search (broad + specific), 2-4 English ones if useful. No '#' sign, words joined with underscores. If the topic is Quranic/religious, keep tags respectful and do not invent claims.
Return JSON: {"ar":["..."],"en":["..."],"note":"one short Arabic tip (Egyptian dialect) about using them"}`;
}
