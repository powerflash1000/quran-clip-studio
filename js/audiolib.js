// مكتبة الأصوات: كل صوت اتولّد (Gemini / ElevenLabs) أو اتسجّل أو اترفع لدعاء أو حديث بيتحفظ هنا (IndexedDB)
// عشان: ١) مايضيعش لما الصفحة تتقفل أو تعمل Refresh  ٢) تستخدمه تاني من غير ما تولّده (ومن غير ما يتخصم رصيد)
const DB = 'qcs-audio', STORE = 'clips';
const MAX_ITEMS = 300, MAX_BYTES = 400 * 1048576; // فوق كده بنمسح الأقدم

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// نص للمقارنة: من غير تشكيل ولا مسافات زيادة
export const textKey = t => String(t || '').replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '').replace(/\s+/g, ' ').trim();

// clip: { name, kind: 'gtts'|'ai'|'record'|'upload', text, voice, dur, blob } → بيرجع id
export async function addClip(clip) {
  const id = clip.id || `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...clip, id, key: textKey(clip.text), size: clip.blob.size, date: Date.now() });
    await done(tx);
    db.close();
    prune();
  } catch (e) { console.warn('تعذر حفظ الصوت في المكتبة', e); }
  return id;
}

// كل الأصوات (من غير الملفات نفسها عشان السرعة)، الأحدث الأول
export async function listClips() {
  try {
    const db = await openDb();
    const all = await req2p(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    db.close();
    return all.map(({ blob, ...m }) => m).sort((a, b) => b.date - a.date);
  } catch { return []; }
}

export async function getClip(id) {
  try {
    const db = await openDb();
    const c = await req2p(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
    db.close();
    return c || null;
  } catch { return null; }
}

export async function deleteClip(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await done(tx);
  db.close();
}

// صوت متولّد قبل كده لنفس النص بنفس الصوت (عشان مانولّدش تاني)
export async function findSame(kind, text, voice) {
  const k = textKey(text);
  return (await listClips()).find(c => c.kind === kind && c.key === k && (c.voice || '') === (voice || '')) || null;
}

async function prune() {
  const all = await listClips();
  let bytes = all.reduce((a, c) => a + (c.size || 0), 0);
  const drop = [];
  for (let i = all.length - 1; i >= 0 && (all.length - drop.length > MAX_ITEMS || bytes > MAX_BYTES); i--) {
    drop.push(all[i].id);
    bytes -= all[i].size || 0;
  }
  for (const id of drop) await deleteClip(id).catch(() => {});
}
