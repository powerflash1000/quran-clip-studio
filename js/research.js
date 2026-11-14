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
  { name: '🎙️ القراءات', books: [['qiraat-almawsoah', 'موسوعة القراءات'], ['alnashir', 'النشر في القراءات العشر — ابن الجزري'], ['tahbeer-altayseer', 'تحبير التيسير'], ['mafateeh-alaghanee', 'مفاتيح الأغاني في القراءات']] },
  { name: '✍️ الإعراب واللغة', books: [['aliraab-almuyassar', 'الإعراب الميسّر'], ['iraab-daas', 'إعراب القرآن — دعاس'], ['aljadwal', 'الجدول في إعراب القرآن'], ['aldur-almasoon', 'الدر المصون — السمين الحلبي'], ['iraab-aldarweesh', 'إعراب القرآن وبيانه — درويش'], ['iraab-alnahas', 'إعراب القرآن — النحاس']] },
  { name: '📜 أسباب النزول', books: [['wahidi-asbab', 'أسباب النزول — الواحدي']] },
  { name: '🔤 غريب القرآن ومعانيه', books: [['siraaj-ghareeb', 'السراج في بيان غريب القرآن'], ['almuyassar-ghareeb', 'الميسّر في غريب القرآن'], ['ghareeb-ibn-qutaybah', 'غريب القرآن — ابن قتيبة'], ['zajjaj', 'معاني القرآن — الزجاج'], ['farraa', 'معاني القرآن — الفرّاء']] },
  { name: '⚖️ الأحكام والناسخ والمنسوخ', books: [['ahkam-ibn-alarabee', 'أحكام القرآن — ابن العربي'], ['aljasas', 'أحكام القرآن — الجصاص'], ['eedah-naskh-mansukh', 'الإيضاح لناسخ القرآن ومنسوخه — مكي']] },
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
  ({ tafsir: tabTafsir, trans: tabTrans, more: tabMore, word: tabWord })[t]?.(box);
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

function tabMore(box) {
  const { s, a } = st;
  box.insertAdjacentHTML('beforeend', `<p class="hint">الأقسام دي بتفتح على <b>${Q.surah(s).ar} ${N(a)}</b> في «الباحث القرآني» (tafsir.app) في تاب جديد. الموقع ده من فريق «نُقاية»، مجاني ووقف لله، ومابيسمحش ينعرض جوه برامج تانية — فبنفتحه هناك.</p>`);
  for (const sec of TA_SECTIONS) {
    box.insertAdjacentHTML('beforeend', `<div class="rs-sec">${sec.name}</div>`);
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
  $('#rs-q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  const p = new URLSearchParams(location.search);
  const last = p.get('s') ? { s: +p.get('s'), a: +p.get('a') || 1 } : load('rsLast', null);
  if (p.get('q')) { $('#rs-q').value = p.get('q'); doSearch(); }
  else if (last && last.s >= 1 && last.s <= 114) show(last.s, Math.min(Q.surah(last.s).count, Math.max(1, last.a)));
  $('#rs-q').focus();
})();
