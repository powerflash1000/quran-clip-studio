// 🔎 الباحث: نافذة منفصلة للبحث في القرآن وقراءة التفاسير والترجمات (من مصادر مفتوحة)
// + روابط مباشرة لنفس الآية في «الباحث القرآني» (tafsir.app) للأقسام اللي مش عندنا:
//   القراءات، الإعراب، أسباب النزول، غريب القرآن، الأحكام، المعاجم.
// tafsir.app مابيسمحش يتفتح جوه مواقع تانية ولا يتسحب منه بيانات، فبنفتحه في تاب جديد بس (رابط عادي).
import * as Q from './quran.js';

const $ = s => document.querySelector(s);
const N = Q.arabicNum;
const TA = 'https://tafsir.app';
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('qcs-research') : null;
const load = (k, d) => { try { const v = localStorage.getItem('qcs:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem('qcs:' + k, JSON.stringify(v)); } catch { /* مش مهم */ } };

// كتبنا ← اسمها في tafsir.app (للرابط «افتح في الباحث القرآني»)
const TA_SLUG = { muyassar: 'muyassar', mukhtasar: 'mukhtasar', jalalayn: 'jalalayn', saadi: 'saadi', baghawi: 'baghawi', ibnkathir: 'ibn-katheer', qurtubi: 'qurtubi', tabari: 'tabari' };

// أقسام الباحث القرآني (الأسماء من قايمة كتبه)
const TA_SECTIONS = [
  { name: '📖 تفاسير أخرى', books: [['zad-almaseer', 'زاد المسير — ابن الجوزي'], ['ibn-aashoor', 'التحرير والتنوير — ابن عاشور'], ['alaloosi', 'روح المعاني — الألوسي'], ['alrazi', 'مفاتيح الغيب — الرازي'], ['adwaa-albayan', 'أضواء البيان — الشنقيطي'], ['ibn-atiyah', 'المحرر الوجيز — ابن عطية'], ['kashaf', 'الكشاف — الزمخشري'], ['albahr-almuheet', 'البحر المحيط — أبو حيان'], ['ibn-uthaymeen', 'تفسير ابن عثيمين'], ['aldur-almanthoor', 'الدر المنثور — السيوطي'], ['ibn-abi-hatim', 'تفسير ابن أبي حاتم']] },
  { name: '🎙️ القراءات', note: 'كتب القراءات بتتكلم عن الكلمات اللي فيها خلاف بين القرّاء بس — لو الآية مافيهاش خلاف، الصفحة هتقول «غير متاح».', books: [['qiraat-almawsoah', 'موسوعة القراءات'], ['alnashir', 'النشر في القراءات العشر — ابن الجزري'], ['tahbeer-altayseer', 'تحبير التيسير'], ['mafateeh-alaghanee', 'مفاتيح الأغاني في القراءات']] },
  { name: '✍️ الإعراب واللغة', books: [['aliraab-almuyassar', 'الإعراب الميسّر'], ['iraab-daas', 'إعراب القرآن — دعاس'], ['aljadwal', 'الجدول في إعراب القرآن'], ['aldur-almasoon', 'الدر المصون — السمين الحلبي'], ['iraab-aldarweesh', 'إعراب القرآن وبيانه — درويش'], ['iraab-alnahas', 'إعراب القرآن — النحاس']] },
  { name: '📜 أسباب النزول', note: 'مش كل آية ليها سبب نزول (أغلب القرآن نزل من غير سبب معيّن). لو كتاب الواحدي قال «غير متاح» يبقى مفيش عنده سبب للآية دي — جرّب «موسوعة التفسير المأثور» أو «البسيط» لأنهم بيذكروا الروايات اللي حوالين الآية.', books: [['wahidi-asbab', 'أسباب النزول — الواحدي'], ['mathoor', 'موسوعة التفسير المأثور — معهد الشاطبي'], ['albaseet', 'البسيط — الواحدي']] },
  { name: '🔤 غريب القرآن ومعانيه', note: 'كتب الغريب بتشرح الكلمات الصعبة بس — لو الآية كلماتها واضحة ممكن متلاقيش حاجة.', books: [['siraaj-ghareeb', 'السراج في بيان غريب القرآن'], ['almuyassar-ghareeb', 'الميسّر في غريب القرآن'], ['ghareeb-ibn-qutaybah', 'غريب القرآن — ابن قتيبة'], ['zajjaj', 'معاني القرآن — الزجاج'], ['farraa', 'معاني القرآن — الفرّاء']] },
  { name: '⚖️ الأحكام والناسخ والمنسوخ', note: 'كتب الأحكام بتشرح آيات الأحكام (العبادات والمعاملات) بس، وكتاب الناسخ والمنسوخ بيذكر الآيات اللي فيها نسخ بس.', books: [['ahkam-ibn-alarabee', 'أحكام القرآن — ابن العربي'], ['aljasas', 'أحكام القرآن — الجصاص'], ['eedah-naskh-mansukh', 'الإيضاح لناسخ القرآن ومنسوخه — مكي']] },
];
const TA_DICTS = [['lisan', 'لسان العرب'], ['mufradat-ragheb', 'مفردات الراغب'], ['maqayees', 'مقاييس اللغة'], ['qamoos', 'القاموس المحيط'], ['alsihah', 'الصحاح']];

const st = { s: 1, a: 1, tab: load('rsTab', 'tafsir'), books: load('rsBooks', ['muyassar', 'saadi', 'ibnkathir']), word: '' };
const status = t => { $('#rs-status').textContent = t || ''; };

// ===== البحث =====
const clean = t => String(t).replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^سوره\s+/, '').trim();
const toLatin = t => String(t).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
function parseRef(q) {
  const t = toLatin(q.trim());
  let m = /^(\d{1,3})\s*[:：.\s]\s*(\d{1,3})$/.exec(t);
  if (m) return { s: +m[1], a: +m[2] };
  m = /^(.+?)\s*[:\s]\s*(\d{1,3})$/.exec(t);
  if (m) {
    const name = clean(m[1]).replace(/^ال/, '');
    const i = Q.surahs().findIndex(x => clean(x.ar).replace(/^ال/, '') === name || clean(x.ar).replace(/^سوره\s+/, '').replace(/^ال/, '') === name);
    if (i >= 0) return { s: i + 1, a: +m[2] };
  }
  return null;
}
function doSearch() {
  const q = $('#rs-q').value.trim();
  if (!q) return;
  const ref = parseRef(q);
  const list = ref && ref.s >= 1 && ref.s <= 114 && ref.a >= 1 && ref.a <= Q.surah(ref.s).count ? [ref] : Q.search(q, 200);
  const box = $('#rs-results');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="muted">مالقيتش نتايج. جرّب كلمة تانية أو من غير «ال».</p>'; return; }
  const head = document.createElement('p'); head.className = 'muted'; head.textContent = `${N(list.length)} نتيجة${list.length >= 200 ? ' (أول ٢٠٠)' : ''}`;
  box.append(head);
  for (const r of list) {
    const d = document.createElement('div');
    d.className = 'rs-res';
    d.innerHTML = '<small></small><div class="t"></div>';
    d.querySelector('small').textContent = `${Q.surah(r.s).ar} • ${N(r.a)}`;
    const t = Q.showText(r.s, r.a);
    d.querySelector('.t').textContent = t.length > 140 ? t.slice(0, 140) + '…' : t;
    d.onclick = () => { box.querySelectorAll('.on').forEach(x => x.classList.remove('on')); d.classList.add('on'); show(r.s, r.a); };
    box.append(d);
  }
  box.querySelector('.rs-res').click();
}

// ===== عرض الآية =====
function show(s, a) {
  st.s = s; st.a = a; st.word = '';
  save('rsLast', { s, a });
  const v = $('#rs-view');
  const sur = Q.surah(s);
  v.innerHTML = `
    <div class="rs-ref"></div>
    <div class="rs-ayah" id="rs-ayah"></div>
    <div class="rs-nav">
      <button class="btn" id="rs-prev" type="button">→ الآية اللي قبلها</button>
      <button class="btn" id="rs-next" type="button">الآية اللي بعدها ←</button>
      <button class="btn" id="rs-copy" type="button">📋 انسخ الآية</button>
      <button class="btn primary" id="rs-add" type="button" title="تتضاف ككارت آيات في البرنامج">＋ أضف للفيديو</button>
      <a class="btn" id="rs-ta" target="_blank" rel="noopener">↗ افتح في الباحث القرآني</a>
    </div>
    <div class="rs-tabs" id="rs-tabs">
      <button type="button" data-t="tafsir">📖 التفاسير</button>
      <button type="button" data-t="asbab">📜 سبب النزول</button>
      <button type="button" data-t="trans">🌐 الترجمات</button>
      <button type="button" data-t="more">📚 قراءات • إعراب • أسباب نزول • غريب • أحكام</button>
      <button type="button" data-t="word">🔤 معنى كلمة</button>
    </div>
    <div id="rs-tab"></div>`;
  v.querySelector('.rs-ref').textContent = `سورة ${sur.ar} • الآية ${N(a)} من ${N(sur.count)}`;
  // كل كلمة بتتداس عشان «معنى كلمة»
  const ay = $('#rs-ayah');
  Q.showText(s, a).split(/\s+/).forEach((w, i) => {
    if (i) ay.append(' ');
    const sp = document.createElement('span'); sp.textContent = w; sp.style.cursor = 'pointer'; sp.title = 'دوس عشان معنى الكلمة';
    sp.onclick = () => { st.word = w; setTab('word'); };
    ay.append(sp);
  });
  ay.append(` ﴿${N(a)}﴾`);
  $('#rs-prev').disabled = s === 1 && a === 1;
  $('#rs-next').disabled = s === 114 && a === Q.surah(114).count;
  $('#rs-prev').onclick = () => a > 1 ? show(s, a - 1) : show(s - 1, Q.surah(s - 1).count);
  $('#rs-next').onclick = () => a < sur.count ? show(s, a + 1) : show(s + 1, 1);
  $('#rs-copy').onclick = () => navigator.clipboard.writeText(`﴿${Q.showText(s, a)}﴾ [${sur.ar}: ${a}]`).then(() => status('✅ اتنسخت الآية'), () => status('⚠️ المتصفح منع النسخ'));
  $('#rs-add').onclick = () => {
    if (!chan) { status('⚠️ المتصفح ده مايدعمش الربط بين النوافذ'); return; }
    chan.postMessage({ type: 'addAyah', s, a });
    status(`✅ اتبعتت ${sur.ar} ${N(a)} للبرنامج — هتلاقيها كارت جديد في «المحتوى»`);
  };
  $('#rs-ta').href = `${TA}/${s}/${a}`;
  v.querySelectorAll('#rs-tabs button').forEach(b => { b.onclick = () => setTab(b.dataset.t); });
  setTab(st.tab);
}

function setTab(t) {
  st.tab = t; save('rsTab', t === 'word' ? 'tafsir' : t);
  document.querySelectorAll('#rs-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  const box = $('#rs-tab');
  box.innerHTML = '';
  ({ tafsir: tabTafsir, asbab: tabAsbab, trans: tabTrans, more: tabMore, word: tabWord })[t]?.(box);
}

function bookCard(box, title, link) {
  const d = document.createElement('div');
  d.className = 'rs-book';
  d.innerHTML = '<h3><span class="grow"></span><button class="btn icon" type="button" title="انسخ">📋</button></h3><p class="muted">⏳ بيحمّل…</p>';
  d.querySelector('.grow').textContent = title;
  if (link) { const a = document.createElement('a'); a.className = 'btn icon'; a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.title = 'افتحه في الباحث القرآني'; a.textContent = '↗'; d.querySelector('h3').append(a); }
  box.append(d);
  const p = d.querySelector('p');
  d.querySelector('button').onclick = () => navigator.clipboard.writeText(`${title}\n${p.textContent}`).then(() => status('✅ اتنسخ'), () => {});
  return p;
}

function tabTafsir(box) {
  const pick = document.createElement('div');
  pick.className = 'rs-pick';
  for (const t of Q.TAFSIRS) {
    const l = document.createElement('label'); l.className = 'check';
    l.innerHTML = `<input type="checkbox"> ${t.name}`;
    const cb = l.querySelector('input'); cb.checked = st.books.includes(t.code);
    cb.onchange = () => { st.books = Q.TAFSIRS.map(x => x.code).filter(c => c === t.code ? cb.checked : st.books.includes(c)); save('rsBooks', st.books); setTab('tafsir'); };
    pick.append(l);
  }
  box.append(pick);
  const { s, a } = st;
  for (const t of Q.TAFSIRS.filter(x => st.books.includes(x.code))) {
    const p = bookCard(box, `${t.name} — ${t.by}`, TA_SLUG[t.code] ? `${TA}/${TA_SLUG[t.code]}/${s}/${a}` : '');
    Q.tafsirOf(t.code, s, a).then(r => {
      if (st.s !== s || st.a !== a) return;
      p.classList.remove('muted');
      p.textContent = r.text ? (r.from !== a ? `(التفسير مكتوب عند الآية ${N(r.from)} مع اللي بعدها)\n` : '') + r.text : 'مفيش تفسير للآية دي في الكتاب ده.';
    }).catch(() => { p.textContent = '⚠️ ماتحمّلش — اتأكد من النت وجرّب تاني.'; });
  }
  if (!st.books.length) box.insertAdjacentHTML('beforeend', '<p class="muted">علّم على كتاب تفسير واحد على الأقل.</p>');
}

function tabTrans(box) {
  const { s, a } = st;
  const codes = Q.TRANSLATIONS.filter(t => t.code && !Q.tafsirInfo(t.code) && t.code !== 'muyassar');
  for (const t of codes) {
    const p = bookCard(box, t.name, '');
    p.dir = 'auto';
    Q.translation(t.code, s, a).then(x => { if (st.s === s && st.a === a) { p.classList.remove('muted'); p.textContent = x || '—'; } }).catch(() => { p.textContent = '⚠️ ماتحمّلش'; });
  }
}

// ===== 📜 أسباب النزول (بيانات الموسوعة القرآنية quranpedia.net — كتابين) =====
// المحرر (المزيني): كل سبب مدروس، وفي آخره «النتيجة»: ثبت أنه سبب النزول ولا لأ.
// الواحدي: الروايات بأسانيدها (فيها الصحيح والضعيف).
let ASBAB = null;
async function asbabData() {
  if (ASBAB) return ASBAB;
  status('⏳ بيحمّل أسباب النزول…');
  const j = await (await fetch('data/asbab.json')).json();
  const idx = new Map();
  const add = (k, v) => { if (!idx.has(k)) idx.set(k, {}); Object.assign(idx.get(k), v); };
  for (const [s, a, ok, res, text] of j.m) add(`${s}:${a}`, { m: { ok, res, text } });
  for (const [s, a, text] of j.w) add(`${s}:${a}`, { w: { text } });
  ASBAB = { ...j, idx };
  status('');
  return ASBAB;
}
const VERDICT = { 1: ['✅ ثبت أنه سبب النزول', '#1f6f5c'], [-1]: ['⚠️ لم يثبت أنه سبب النزول', '#a15c00'], 0: ['', ''] };
const credit = d => `المصدر: ${d.books.m} • ${d.books.w} — بيانات الموسوعة القرآنية (quranpedia.net)`;
// قصة جاهزة للنسخ (لكتابة سكريبت الريل)
function storyText(s, a, e, d) {
  const sur = Q.surah(s).ar, out = [`📜 سبب نزول ${sur} ${N(a)}`];
  if (e.m) { if (e.m.ok) out.push(VERDICT[e.m.ok][0] + ' — ' + d.books.m); if (e.m.res) out.push('الخلاصة: ' + e.m.res); out.push('', e.m.text); }
  else if (e.w) out.push('', `${d.books.w}:`, e.w.text, '', '⚠️ روايات الواحدي فيها الصحيح والضعيف — راجع درجة الرواية قبل ما تحكيها.');
  out.push('', credit(d));
  return out.join('\n');
}
async function tabAsbab(box) {
  const { s, a } = st;
  let d;
  try { d = await asbabData(); } catch { box.innerHTML = '<p class="muted">❌ مقدرتش أحمّل ملف أسباب النزول.</p>'; return; }
  if (st.s !== s || st.a !== a || st.tab !== 'asbab') return;
  const e = d.idx.get(`${s}:${a}`);
  box.insertAdjacentHTML('beforeend', `<p class="hint">أغلب القرآن نزل من غير سبب معيّن، فمش كل آية ليها سبب نزول. <b>المحرر</b> بيدرس كل رواية ويقول في «النتيجة» ثبت إنها سبب النزول ولا لأ — ده اللي تعتمد عليه في القصص. <b>الواحدي</b> بيجمع الروايات بأسانيدها (فيها الصحيح والضعيف). <button class="btn" type="button" id="rs-asb-browse">📜 تصفّح كل أسباب النزول</button></p>`);
  $('#rs-asb-browse').onclick = () => browseAsbab();
  if (!e) {
    // الآية ممكن تكون جزء من سبب نزول آية قبلها في نفس السورة
    let near = 0;
    for (let k = a - 1; k >= Math.max(1, a - 8); k--) if (d.idx.has(`${s}:${k}`)) { near = k; break; }
    box.insertAdjacentHTML('beforeend', `<div class="rs-book"><p>مفيش سبب نزول مذكور للآية دي في الكتابين.${near ? ` <br>بس فيه سبب نزول لـ<b>الآية ${N(near)}</b> قبلها — ساعات السبب بيشمل كذا آية ورا بعض. <button class="btn" type="button" id="rs-asb-near">شوف سبب نزول الآية ${N(near)}</button>` : ''}</p></div>`);
    if (near) $('#rs-asb-near').onclick = () => show(s, near);
    tabMoreAsbabLinks(box, s, a);
    return;
  }
  const row = document.createElement('div'); row.className = 'rs-search'; row.style.margin = '.4rem 0';
  row.innerHTML = '<button class="btn primary" type="button">📋 انسخ القصة (لسكريبت الريل)</button>';
  row.querySelector('button').onclick = () => navigator.clipboard.writeText(storyText(s, a, e, d)).then(() => status('✅ اتنسخت القصة — راجعها وخد منها اللي يناسب الريل'), () => status('⚠️ المتصفح منع النسخ'));
  box.append(row);
  if (e.m) {
    const [lbl, col] = VERDICT[e.m.ok];
    const c = document.createElement('div'); c.className = 'rs-book';
    c.innerHTML = `<h3><span class="grow"></span></h3>${lbl ? `<p style="font-weight:700;color:${col};margin:.1rem 0 .4rem"></p>` : ''}<div class="rs-res-box" style="border-inline-start:4px solid ${col || '#888'};padding:.4rem .7rem;margin-bottom:.5rem;background:rgba(127,127,127,.07);border-radius:8px"><b>النتيجة:</b> <span></span></div><details><summary>اقرا الدراسة كاملة (الروايات والتخريج وكلام المفسرين)</summary><p></p></details>`;
    c.querySelector('.grow').textContent = d.books.m;
    if (lbl) c.querySelector('h3 + p').textContent = lbl;
    c.querySelector('.rs-res-box span').textContent = e.m.res || '—';
    c.querySelector('details p').textContent = e.m.text;
    box.append(c);
  }
  if (e.w) {
    const c = document.createElement('div'); c.className = 'rs-book';
    c.innerHTML = `<h3><span class="grow"></span></h3><p class="hint" style="margin:.1rem 0 .4rem">الروايات هنا بأسانيدها — فيها الصحيح والضعيف${e.m ? '، والحكم عليها في «المحرر» فوق' : ' (الآية دي مش مدروسة في المحرر — راجع درجة الرواية قبل ما تحكيها)'}.</p><details ${e.m ? '' : 'open'}><summary>نص الواحدي</summary><p></p></details>`;
    c.querySelector('.grow').textContent = d.books.w;
    c.querySelector('details p').textContent = e.w.text;
    box.append(c);
  }
  tabMoreAsbabLinks(box, s, a);
  box.insertAdjacentHTML('beforeend', `<p class="hint">${credit(d)} — النسخة ${d.ver.m}.</p>`);
}
function tabMoreAsbabLinks(box, s, a) {
  const sec = TA_SECTIONS.find(x => x.name.includes('أسباب'));
  if (!sec) return;
  box.insertAdjacentHTML('beforeend', '<div class="rs-sec">كتب تانية في الباحث القرآني (tafsir.app)</div>');
  const g = document.createElement('div'); g.className = 'rs-ext';
  for (const [slug, name] of sec.books) {
    const el = document.createElement('a'); el.href = `${TA}/${slug}/${s}/${a}`; el.target = '_blank'; el.rel = 'noopener';
    el.innerHTML = '<span></span><small>↗ tafsir.app</small>'; el.querySelector('span').textContent = name;
    g.append(el);
  }
  box.append(g);
}
// تصفّح كل أسباب النزول في العمود الجانبي: فلتر بالكتاب والحكم والسورة، وبحث في نص القصة
async function browseAsbab() {
  let d;
  try { d = await asbabData(); } catch { status('❌ مقدرتش أحمّل ملف أسباب النزول.'); return; }
  const box = $('#rs-results');
  const f = load('asbF', { book: 'm', ok: '1', sur: '', q: '' });
  box.innerHTML = `<div class="rs-sec" style="margin-top:0">📜 أسباب النزول</div>
    <div class="rs-pick" style="flex-direction:column;gap:.35rem">
      <select id="asb-book"><option value="m">المحرر (مدروس ومحكوم عليه)</option><option value="w">الواحدي (روايات بأسانيدها)</option><option value="all">الاتنين</option></select>
      <select id="asb-ok"><option value="1">✅ اللي ثبت إنه سبب النزول بس</option><option value="">كل الروايات</option><option value="-1">⚠️ اللي لم يثبت (عشان تنبّه عليه)</option></select>
      <select id="asb-sur"><option value="">كل السور</option></select>
      <input id="asb-q" type="search" placeholder="دوّر في القصص: الأنصار، عائشة، اليهود…">
    </div><p class="muted" id="asb-n"></p><div id="asb-list"></div>`;
  const surs = [...new Set([...d.idx.keys()].map(k => +k.split(':')[0]))].sort((x, y) => x - y);
  $('#asb-sur').insertAdjacentHTML('beforeend', surs.map(s => `<option value="${s}">${N(s)}. ${Q.surah(s).ar}</option>`).join(''));
  $('#asb-book').value = f.book; $('#asb-ok').value = f.ok; $('#asb-sur').value = f.sur; $('#asb-q').value = f.q;
  const norm = t => clean(t).replace(/[^ء-ي\s]/g, '');
  const render = () => {
    const F = { book: $('#asb-book').value, ok: $('#asb-ok').value, sur: $('#asb-sur').value, q: $('#asb-q').value.trim() };
    save('asbF', F);
    $('#asb-ok').disabled = F.book === 'w';
    const q = norm(F.q);
    const items = [...d.idx.entries()].map(([k, e]) => { const [s, a] = k.split(':').map(Number); return { s, a, e }; })
      .filter(({ s, e }) => (F.book === 'all' ? true : !!e[F.book]) && (!F.sur || s === +F.sur)
        && (F.book === 'w' || !F.ok || (e.m && String(e.m.ok) === F.ok))
        && (!q || norm((e.m?.text || '') + ' ' + (e.w?.text || '')).includes(q)))
      .sort((x, y) => x.s - y.s || x.a - y.a);
    $('#asb-n').textContent = `${N(items.length)} آية`;
    const list = $('#asb-list'); list.innerHTML = '';
    for (const { s, a, e } of items.slice(0, 400)) {
      const el = document.createElement('div'); el.className = 'rs-res';
      const badge = e.m ? (e.m.ok === 1 ? '✅' : e.m.ok === -1 ? '⚠️' : '') : '📗';
      const snip = (e.m?.res || e.w?.text || '').replace(/\s+/g, ' ');
      el.innerHTML = '<small></small><div></div>';
      el.querySelector('small').textContent = `${badge} ${Q.surah(s).ar} • ${N(a)}`;
      el.querySelector('div').textContent = snip.length > 120 ? snip.slice(0, 120) + '…' : snip;
      el.onclick = () => { list.querySelectorAll('.on').forEach(x => x.classList.remove('on')); el.classList.add('on'); st.tab = 'asbab'; show(s, a); };
      list.append(el);
    }
  };
  for (const id of ['#asb-book', '#asb-ok', '#asb-sur']) $(id).onchange = render;
  let tm; $('#asb-q').oninput = () => { clearTimeout(tm); tm = setTimeout(render, 250); };
  render();
}

function tabMore(box) {
  const { s, a } = st;
  box.insertAdjacentHTML('beforeend', `<p class="hint">الأقسام دي بتفتح على <b>${Q.surah(s).ar} ${N(a)}</b> في «الباحث القرآني» (tafsir.app) في تاب جديد. الموقع ده من فريق «نُقاية»، مجاني ووقف لله، ومابيسمحش ينعرض جوه برامج تانية — فبنفتحه هناك.</p><p class="hint">لو كتاب قال <b>«غير متاح»</b>: ده معناه غالبًا إن الكتاب ده <b>مالوش كلام عن الآية دي</b> (مش إن الموقع مقفول) — كتب أسباب النزول والقراءات والأحكام والغريب بتغطي آيات معيّنة بس. جرّب كتاب تاني من نفس القسم، أو <a href="${TA}/${s}/${a}" target="_blank" rel="noopener">افتح الآية في الباحث القرآني</a> واختار من قايمة الكتب هناك (بتوريك الكتب اللي ليها كلام عن الآية).</p>`);
  for (const sec of TA_SECTIONS) {
    box.insertAdjacentHTML('beforeend', `<div class="rs-sec">${sec.name}</div>` + (sec.note ? `<p class="hint" style="margin:.1rem 0 .4rem">ℹ️ ${sec.note}</p>` : ''));
    const g = document.createElement('div'); g.className = 'rs-ext';
    for (const [slug, name] of sec.books) {
      const el = document.createElement('a'); el.href = `${TA}/${slug}/${s}/${a}`; el.target = '_blank'; el.rel = 'noopener';
      el.innerHTML = '<span></span><small>↗ tafsir.app</small>'; el.querySelector('span').textContent = name;
      g.append(el);
    }
    box.append(g);
  }
}

function tabWord(box) {
  const w = clean(st.word || '').replace(/[^ء-ي]/g, '');
  if (!w) { box.innerHTML = '<p class="muted">دوس على أي كلمة في الآية فوق عشان تشوف معناها في المعاجم.</p>'; return; }
  box.insertAdjacentHTML('beforeend', `<p>الكلمة: <b style="font-size:1.3rem">${st.word.replace(/[<>&]/g, '')}</b> — المعاجم بتدوّر بالجذر غالبًا (مثلًا «رحمة» ← «رحم»)، وتقدر تعدّل الكلمة هنا:</p>`);
  const row = document.createElement('div'); row.className = 'rs-search';
  row.innerHTML = '<input type="text"><span></span>';
  const inp = row.querySelector('input'); inp.value = w.replace(/^(وال|فال|بال|كال|ال|و|ف)/, '');
  box.append(row);
  const g = document.createElement('div'); g.className = 'rs-ext'; g.style.marginTop = '.6rem';
  const render = () => {
    g.innerHTML = '';
    const q = encodeURIComponent(inp.value.trim());
    for (const [slug, name] of [['', '🔎 كل المعاجم'], ...TA_DICTS]) {
      const el = document.createElement('a'); el.href = `${TA}/${slug ? slug + '/' : ''}${q}`; el.target = '_blank'; el.rel = 'noopener';
      el.innerHTML = '<span></span><small>↗ tafsir.app</small>'; el.querySelector('span').textContent = name;
      g.append(el);
    }
  };
  inp.oninput = render; render();
  box.append(g);
}

// ===== البداية =====
(async () => {
  status('⏳ بيحمّل المصحف…');
  await Q.loadQuran();
  const ls = load('lastStyle', {});
  if (ls?.script === 'imlaei') await Q.setScript('imlaei').catch(() => {});
  status('');
  $('#rs-go').onclick = doSearch;
  $('#rs-asbab').onclick = () => browseAsbab();
  $('#rs-q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  const p = new URLSearchParams(location.search);
  const last = p.get('s') ? { s: +p.get('s'), a: +p.get('a') || 1 } : load('rsLast', null);
  if (p.get('q')) { $('#rs-q').value = p.get('q'); doSearch(); }
  else if (last && last.s >= 1 && last.s <= 114) show(last.s, Math.min(Q.surah(last.s).count, Math.max(1, last.a)));
  $('#rs-q').focus();
})();
