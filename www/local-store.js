// Family Cashbook — on-device data store.
// Gives the app the same small database API it uses on Claude (doc / collection / onSnapshot),
// but keeps everything in one JSON file on the phone. A cloud version (sign-in + family sharing)
// will replace this file later without changing the app screens.
(() => {
  if (window.claude && window.claude.use) return; // running inside Claude: use the real shared store

  const FILE = 'family-cashbook-data.json';
  const cap = window.Capacitor;
  const NATIVE = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Plug = n => (cap && cap.Plugins && cap.Plugins[n]) || null;
  const FS = NATIVE ? Plug('Filesystem') : null;

  let docs = new Map();            // "collection/docId" -> data
  const docSubs = new Map();       // doc path -> Set(fn)
  const colSubs = new Map();       // collection path -> Set(fn)
  const clone = o => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };

  async function readAll() {
    try {
      let txt = null;
      if (FS) txt = (await FS.readFile({ path: FILE, directory: 'DATA', encoding: 'utf8' })).data;
      else txt = localStorage.getItem(FILE);
      if (txt) docs = new Map(Object.entries(JSON.parse(txt)));
    } catch (e) { /* first run: no file yet */ }
  }
  const ready = readAll();

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const txt = JSON.stringify(Object.fromEntries(docs));
      try {
        if (FS) await FS.writeFile({ path: FILE, directory: 'DATA', encoding: 'utf8', data: txt, recursive: true });
        else localStorage.setItem(FILE, txt);
      } catch (e) { console.error('Could not save data', e); }
    }, 200);
  }

  const parentOf = p => p.split('/').slice(0, -1).join('/');
  const snapDoc = p => { const d = docs.get(p); const id = p.split('/').pop(); return { id, exists: !!d, data: () => d ? clone(d) : undefined, metadata: meta }; };
  const snapCol = c => {
    const list = [...docs.keys()].filter(k => parentOf(k) === c).sort().map(snapDoc);
    return { docs: list, size: list.length, empty: !list.length, docChanges: () => list.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })), metadata: meta };
  };
  function notify(p) {
    (docSubs.get(p) || []).forEach(fn => { try { fn(snapDoc(p)); } catch (e) { console.error(e); } });
    const c = parentOf(p);
    (colSubs.get(c) || []).forEach(fn => { try { fn(snapCol(c)); } catch (e) { console.error(e); } });
  }
  const bad = msg => Promise.reject({ code: 'invalid_argument', message: msg });
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function merge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v; return o; }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function docRef(p) {
    if (p.split('/').length % 2) throw new TypeError('document paths need an even number of segments: ' + p);
    return {
      id: p.split('/').pop(), path: p,
      async get() { await ready; return snapDoc(p); },
      async set(data) { await ready; if (!isObj(data)) return bad('document body must be an object'); docs.set(p, clone(data)); persist(); notify(p); },
      async update(data) { await ready; if (!docs.has(p)) return bad('document does not exist'); docs.set(p, merge(docs.get(p), clone(data))); persist(); notify(p); },
      async delete() { await ready; docs.delete(p); persist(); notify(p); },
      onSnapshot(next) { const s = docSubs.get(p) || new Set(); s.add(next); docSubs.set(p, s); ready.then(() => s.has(next) && next(snapDoc(p))); return () => s.delete(next); },
      collection(sub) { return colRef(p + '/' + sub); },
    };
  }
  function colRef(c) {
    if (!(c.split('/').length % 2)) throw new TypeError('collection paths need an odd number of segments: ' + c);
    return {
      path: c,
      doc(id) { return docRef(c + '/' + (id || newId())); },
      async add(data) { const r = docRef(c + '/' + newId()); await r.set(data); return r; },
      async get() { await ready; return snapCol(c); },
      onSnapshot(next) { const s = colSubs.get(c) || new Set(); s.add(next); colSubs.set(c, s); ready.then(() => s.has(next) && next(snapCol(c))); return () => s.delete(next); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
    };
  }
  const db = { doc: docRef, collection: colRef };

  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#3340A0"/><circle cx="16" cy="13" r="5" fill="#fff"/><path d="M6 27c2-5 6-7 10-7s8 2 10 7" fill="#fff"/></svg>');
  const user = {
    isOwner: async () => true, canEdit: async () => true, can: async () => true,
    id: async () => 'this-phone', name: async () => '', email: async () => null, avatarUrl: async () => avatar,
    me: async () => ({ id: 'this-phone', name: '', avatarUrl: avatar, color: '#3340A0', email: null, isOwner: true, canEdit: true }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name: '', avatarUrl: avatar, color: '#3340A0', email: null, isMe: id === 'this-phone', guest: false }])),
    search: async () => [],
  };

  // Backup: the data lives only on this phone until cloud sync arrives, so offer export/import.
  async function exportData() {
    await ready;
    const txt = JSON.stringify({ app: 'family-cashbook', version: 1, exportedAt: new Date().toISOString(), docs: Object.fromEntries(docs) }, null, 1);
    const name = 'family-cashbook-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    const Share = Plug('Share');
    if (FS && Share) {
      const w = await FS.writeFile({ path: name, directory: 'CACHE', encoding: 'utf8', data: txt });
      await Share.share({ title: 'Family Cashbook backup', url: w.uri, dialogTitle: 'Save your backup' });
      return 'shared';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; a.click();
    return 'downloaded';
  }
  async function importData(text) {
    const o = JSON.parse(text);
    if (!o || o.app !== 'family-cashbook' || !isObj(o.docs)) throw new Error('This is not a Family Cashbook backup file.');
    await ready;
    const touched = new Set([...docs.keys(), ...Object.keys(o.docs)]);
    docs = new Map(Object.entries(o.docs));
    persist();
    touched.forEach(notify);
  }

  window.__cashbookLocal = { exportData, importData };
  window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : null };
})();
