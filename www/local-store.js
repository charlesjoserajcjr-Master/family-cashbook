// Family Cashbook — data store.
// Works offline from a copy on this device, and (once connected) keeps it in sync with one
// file in the user's own Google Drive: "Family Cashbook data.json". Every device signed in to
// the same Google account sees the same ledger. Each item carries its own change time, so edits
// made on different devices merge item by item (the most recent edit of an item wins).
(() => {
  if (window.claude && window.claude.use) return; // running inside Claude: use Claude's store

  const FILE = 'family-cashbook-data.json';
  const DRIVE_NAME = 'Family Cashbook data.json';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const CFG = window.CASHBOOK_CONFIG || {};
  const cap = window.Capacitor;
  const NATIVE = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Plug = n => (cap && cap.Plugins && cap.Plugins[n]) || null;
  const FS = NATIVE ? Plug('Filesystem') : null;

  let docs = new Map();   // path -> data
  let times = new Map();  // path -> last change (ms)
  let tomb = new Map();   // path -> deletion time (ms)
  const docSubs = new Map(), colSubs = new Map();
  const clone = o => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  const now = () => Date.now();

  // ---------- local file ----------
  function load(o) {
    docs = new Map(Object.entries(o.docs || (o.app ? {} : o)));
    times = new Map(Object.entries(o.times || {}));
    tomb = new Map(Object.entries(o.tomb || {}));
    for (const k of docs.keys()) if (!times.has(k)) times.set(k, 1);
  }
  async function readAll() {
    try {
      const txt = FS ? (await FS.readFile({ path: FILE, directory: 'DATA', encoding: 'utf8' })).data : localStorage.getItem(FILE);
      if (txt) load(JSON.parse(txt));
    } catch (e) { /* first run */ }
  }
  const ready = readAll();
  const snapshot = () => ({ app: 'family-cashbook', version: 2, savedAt: new Date().toISOString(), docs: Object.fromEntries(docs), times: Object.fromEntries(times), tomb: Object.fromEntries(tomb) });
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const txt = JSON.stringify(snapshot());
      try { if (FS) await FS.writeFile({ path: FILE, directory: 'DATA', encoding: 'utf8', data: txt, recursive: true }); else localStorage.setItem(FILE, txt); }
      catch (e) { console.error('Could not save data', e); }
    }, 200);
  }

  // ---------- database API (same shape the app uses on Claude) ----------
  const parentOf = p => p.split('/').slice(0, -1).join('/');
  const snapDoc = p => { const d = docs.get(p); return { id: p.split('/').pop(), exists: !!d, data: () => d ? clone(d) : undefined, metadata: meta }; };
  const snapCol = c => { const list = [...docs.keys()].filter(k => parentOf(k) === c).sort().map(snapDoc); return { docs: list, size: list.length, empty: !list.length, docChanges: () => list.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })), metadata: meta }; };
  function notify(p) {
    (docSubs.get(p) || []).forEach(fn => { try { fn(snapDoc(p)); } catch (e) { console.error(e); } });
    const c = parentOf(p);
    (colSubs.get(c) || []).forEach(fn => { try { fn(snapCol(c)); } catch (e) { console.error(e); } });
  }
  function notifyMany(paths) {
    const cols = new Set();
    paths.forEach(p => { (docSubs.get(p) || []).forEach(fn => fn(snapDoc(p))); cols.add(parentOf(p)); });
    cols.forEach(c => (colSubs.get(c) || []).forEach(fn => fn(snapCol(c))));
  }
  const bad = msg => Promise.reject({ code: 'invalid_argument', message: msg });
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function merge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v; return o; }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  function changed(p) { times.set(p, now()); persist(); notify(p); Drive.dirty(); }

  function docRef(p) {
    if (p.split('/').length % 2) throw new TypeError('document paths need an even number of segments: ' + p);
    return {
      id: p.split('/').pop(), path: p,
      async get() { await ready; return snapDoc(p); },
      async set(data) { await ready; if (!isObj(data)) return bad('document body must be an object'); docs.set(p, clone(data)); tomb.delete(p); changed(p); },
      async update(data) { await ready; if (!docs.has(p)) return bad('document does not exist'); docs.set(p, merge(docs.get(p), clone(data))); changed(p); },
      async delete() { await ready; if (!docs.has(p)) return; docs.delete(p); times.delete(p); tomb.set(p, now()); persist(); notify(p); Drive.dirty(); },
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

  // Merge another copy (from Drive or a backup) into this one, item by item: newest change wins.
  function mergeIn(o, preferRemote) {
    const rDocs = o.docs || {}, rTimes = o.times || {}, rTomb = o.tomb || {};
    const touched = [];
    const paths = new Set([...docs.keys(), ...tomb.keys(), ...Object.keys(rDocs), ...Object.keys(rTomb)]);
    let localNewer = false;
    for (const p of paths) {
      const lT = Math.max(times.get(p) || 0, tomb.get(p) || 0);
      const rDocT = rDocs[p] ? (rTimes[p] || 1) : 0, rDelT = rTomb[p] || 0, rT = Math.max(rDocT, rDelT);
      if (rT > lT || (preferRemote && rT && rT !== lT)) {
        if (rDelT >= rDocT) { if (docs.has(p)) touched.push(p); docs.delete(p); times.delete(p); tomb.set(p, rDelT); }
        else { docs.set(p, clone(rDocs[p])); times.set(p, rTimes[p] || 1); tomb.delete(p); touched.push(p); }
      } else if (lT > rT) localNewer = true;
    }
    if (touched.length) { persist(); notifyMany(touched); }
    return { touched: touched.length, localNewer };
  }

  // ---------- Google Drive sync ----------
  const Drive = (() => {
    const KEY = 'fcb-drive';
    let st = {};
    try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
    let status = st.connected ? 'idle' : 'off', lastError = '', dirtyFlag = false, timer = null, busy = null;
    const listeners = new Set();
    const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
    const set = (s, err) => { status = s; lastError = err || ''; emit(); };
    const configured = () => !!CFG.googleWebClientId;

    async function getToken(interactive) {
      if (st.token && st.exp > now() + 60000) return st.token;
      if (NATIVE) {
        const SL = Plug('SocialLogin'); if (!SL) throw new Error('Google sign-in is missing from this build.');
        if (!getToken.init) { await SL.initialize({ google: { webClientId: CFG.googleWebClientId, iOSClientId: CFG.googleIosClientId || undefined, mode: 'online' } }); getToken.init = true; }
        if (!interactive && !st.connected) throw new Error('not connected');
        const res = await SL.login({ provider: 'google', options: { scopes: ['email', 'profile', SCOPE] } });
        const t = res?.result?.accessToken?.token || res?.result?.accessToken;
        if (!t || typeof t !== 'string') throw new Error('Google did not return Drive access. Try connecting again.');
        st.token = t; st.exp = now() + 55 * 60000; st.email = res?.result?.profile?.email || st.email || ''; save(); return t;
      }
      if (!interactive) { const e = new Error('Tap Connect to sign in to Google Drive again.'); e.needsTap = true; throw e; }
      await loadGis();
      return new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: CFG.googleWebClientId, scope: SCOPE, prompt: st.connected ? '' : 'consent',
          callback: r => { if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Sign-in was cancelled.')); st.token = r.access_token; st.exp = now() + (r.expires_in || 3600) * 1000 - 60000; save(); resolve(r.access_token); },
          error_callback: e => reject(new Error(e?.message || 'Sign-in was cancelled.')),
        });
        client.requestAccessToken();
      });
    }
    function loadGis() {
      if (window.google?.accounts?.oauth2) return Promise.resolve();
      return loadGis.p ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not reach Google. Check the internet connection.')); document.head.append(s); });
    }
    async function api(url, opts = {}, interactive) {
      const tok = await getToken(interactive);
      const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tok } });
      if (r.status === 401) { st.token = ''; st.exp = 0; save(); if (!NATIVE && !interactive) { const e = new Error('Google sign-in expired. Tap Sync now to reconnect.'); e.needsTap = true; throw e; } return api(url, opts, interactive); }
      if (!r.ok) throw new Error('Google Drive error ' + r.status + ': ' + (await r.text()).slice(0, 160));
      return r;
    }
    async function findFile(interactive) {
      if (st.fileId) return st.fileId;
      const q = encodeURIComponent(`name='${DRIVE_NAME}' and trashed=false`);
      const r = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,version,modifiedTime)&orderBy=modifiedTime desc`, {}, interactive)).json();
      if (r.files && r.files[0]) { st.fileId = r.files[0].id; save(); }
      return st.fileId || null;
    }
    async function upload(interactive) {
      const body = JSON.stringify(snapshot());
      let r;
      if (st.fileId) {
        r = await api(`https://www.googleapis.com/upload/drive/v3/files/${st.fileId}?uploadType=media&fields=id,version,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, interactive);
      } else {
        const b = 'fcb' + Math.random().toString(36).slice(2);
        const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_NAME, mimeType: 'application/json', description: 'Family Cashbook ledger. Edited by the Family Cashbook app; please do not edit by hand.' })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
        r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multipart }, interactive);
      }
      const j = await r.json(); st.fileId = j.id; st.version = j.version; save();
    }
    async function syncOnce(interactive) {
      await ready;
      if (!configured()) throw new Error('Google Drive sync is not set up in this build yet.');
      if (!navigator.onLine) { set('offline'); return; }
      set('syncing');
      const id = await findFile(interactive);
      let needUpload = dirtyFlag || !id;
      if (id) {
        const m = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=version,modifiedTime,trashed`, {}, interactive)).json();
        if (m.trashed) { st.fileId = ''; save(); needUpload = true; }
        else if (String(m.version) !== String(st.version)) {
          const remote = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, interactive)).json();
          const r = mergeIn(remote, !st.lastSync); // a device's first sync: Drive's copy wins any clash
          st.version = m.version; save();
          if (r.localNewer) needUpload = true;
        }
      }
      dirtyFlag = false;
      if (needUpload) await upload(interactive);
      st.connected = true; st.lastSync = now(); save();
      set('synced');
    }
    function sync(interactive) {
      if (busy) return busy.then(() => dirtyFlag ? sync(interactive) : undefined);
      busy = syncOnce(interactive).catch(e => { if (e.message === 'not connected') set('off'); else set(e.needsTap ? 'needs-tap' : navigator.onLine ? 'error' : 'offline', e.message); throw e; }).finally(() => { busy = null; });
      return busy;
    }
    const quiet = p => p && p.catch(() => {});
    return {
      configured, get status() { return status; }, get error() { return lastError; }, get lastSync() { return st.lastSync || 0; }, get email() { return st.email || ''; }, get connected() { return !!st.connected; },
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dirty() { dirtyFlag = true; if (!st.connected) return; clearTimeout(timer); timer = setTimeout(() => quiet(sync(false)), 4000); },
      connect: () => sync(true),
      syncNow: () => sync(true),
      background: () => st.connected ? quiet(sync(false)) : undefined,
      async disconnect() { const t = st.token; st = {}; save(); set('off'); if (!NATIVE && t && window.google?.accounts?.oauth2) try { window.google.accounts.oauth2.revoke(t); } catch (e) {} if (NATIVE) try { await Plug('SocialLogin')?.logout({ provider: 'google' }); } catch (e) {} },
    };
  })();

  // Keep devices in step: sync when the app opens, comes back to the front, or goes back online.
  ready.then(() => Drive.background());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Drive.background(); });
  window.addEventListener('online', () => Drive.background());
  setInterval(() => { if (document.visibilityState === 'visible') Drive.background(); }, 5 * 60000);

  // ---------- backup files ----------
  async function exportData() {
    await ready;
    const txt = JSON.stringify(snapshot(), null, 1);
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
    // A restore replaces this device's ledger; it is then marked as the newest version everywhere.
    const touched = new Set([...docs.keys(), ...Object.keys(o.docs)]);
    const t = now();
    for (const p of docs.keys()) if (!o.docs[p]) tomb.set(p, t);
    docs = new Map(Object.entries(o.docs)); times = new Map([...docs.keys()].map(k => [k, t]));
    for (const k of docs.keys()) tomb.delete(k);
    persist(); notifyMany([...touched]); Drive.dirty();
  }

  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#3340A0"/><circle cx="16" cy="13" r="5" fill="#fff"/><path d="M6 27c2-5 6-7 10-7s8 2 10 7" fill="#fff"/></svg>');
  const user = {
    isOwner: async () => true, canEdit: async () => true, can: async () => true,
    id: async () => 'this-phone', name: async () => '', email: async () => null, avatarUrl: async () => avatar,
    me: async () => ({ id: 'this-phone', name: '', avatarUrl: avatar, color: '#3340A0', email: null, isOwner: true, canEdit: true }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name: '', avatarUrl: avatar, color: '#3340A0', email: null, isMe: id === 'this-phone', guest: false }])),
    search: async () => [],
  };

  // ---------- web only: open offline, install as an app, keep browser storage ----------
  const WEB = !NATIVE && (location.protocol === 'https:' || location.hostname === 'localhost');
  const pwa = (() => {
    let prompt = null, persisted = null;
    const ping = () => window.dispatchEvent(new Event('cashbook-pwa'));
    if (WEB && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline support unavailable', e));
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; ping(); });
    window.addEventListener('appinstalled', () => { prompt = null; ping(); });
    async function protect() {
      try {
        if (!navigator.storage?.persist) { persisted = false; return ping(); }
        persisted = await navigator.storage.persisted() || await navigator.storage.persist();
      } catch (e) { persisted = false; }
      ping();
    }
    if (WEB) protect();
    return {
      web: WEB,
      get installed() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
      get canInstall() { return !!prompt; },
      get persisted() { return persisted; },
      async install() { if (!prompt) return false; prompt.prompt(); const r = await prompt.userChoice; prompt = null; ping(); if (r?.outcome === 'accepted') protect(); return r?.outcome === 'accepted'; },
      protect,
    };
  })();

  window.__cashbookLocal = { exportData, importData, drive: Drive, pwa };
  window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : null };
})();
