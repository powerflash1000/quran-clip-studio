// حفظ ملفات الخلفيات في المتصفح (IndexedDB) عشان متضيعش لما الصفحة تتقفل أو تعمل Refresh
const DB = 'qcs-media', STORE = 'bg';

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

// list: [{ file: File, secs }]
export async function saveMediaList(list) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(list.map(m => ({ name: m.file.name, type: m.file.type, blob: m.file, secs: m.secs ?? null })), 'list');
    await done(tx);
    db.close();
    return true;
  } catch (e) {
    console.warn('تعذر حفظ الخلفيات', e);
    return false;
  }
}

export async function loadMediaList() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('list');
    const val = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    db.close();
    return (val || []).map(v => ({ file: new File([v.blob], v.name, { type: v.type || v.blob.type }), secs: v.secs }));
  } catch (e) {
    console.warn('تعذر تحميل الخلفيات المحفوظة', e);
    return [];
  }
}
