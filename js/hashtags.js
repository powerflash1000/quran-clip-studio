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

  renderTrends(); renderSearch(); renderPicked(); renderSets();
}

// البرومبت المشترك للاقتراح (كل برنامج بيبعته لمزوّده)
export function hashtagPrompt({ topic, platform, region }) {
  return `Suggest social-media hashtags for a short vertical video.
Topic (from the creator): ${topic}
Platform: ${platform}. Audience region: ${region}.
Rules: hashtags must be genuinely relevant to the topic (no unrelated trending tags, no engagement bait, no misleading tags). Mix: 3-5 Arabic hashtags people actually search (broad + specific), 2-4 English ones if useful. No '#' sign, words joined with underscores. If the topic is Quranic/religious, keep tags respectful and do not invent claims.
Return JSON: {"ar":["..."],"en":["..."],"note":"one short Arabic tip (Egyptian dialect) about using them"}`;
}
