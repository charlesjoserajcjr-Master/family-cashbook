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
  const Plug = n => window.CashbookNative?.[n] || (cap && cap.Plugins && cap.Plugins[n]) || null;
  const FS = NATIVE ? Plug('Filesystem') : null;
  const DESK = window.cashbookDesktop || null; // Windows desktop app: data lives in a normal file

  let docs = new Map();   // path -> data
  let times = new Map();  // path -> last change (ms)
  let fieldMeta = {}, conflicts = {}, loadError = null, saveError = null;
  let deviceId=crypto.randomUUID();try{deviceId=localStorage.getItem('fcb-device')||deviceId;localStorage.setItem('fcb-device',deviceId);}catch{}
  let ledgerPassword=null, lockedEnvelope=null, pendingWrites=0, generation=0,rawSource=null,sourcePreserved=false;
  const assertWritable=()=>{if(loadError)throw Error('Saved ledger could not be read. Preserve the source file and restore a backup.');if(lockedEnvelope)throw Error('Unlock the ledger first.');};
  function revision(){let max=Date.now();for(const t of [...times.values(),...tomb.values()])max=Math.max(max,t+1);for(const fields of Object.values(fieldMeta))for(const r of Object.values(fields))max=Math.max(max,r.time+1);return max;}
  let tomb = new Map();   // path -> deletion time (ms)
  const docSubs = new Map(), colSubs = new Map();
  const clone = o => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  const now = () => Date.now();

  // ---------- local file ----------
  function load(o) {
    o=CashbookSchema.validate(o,{legacy:true});
    fieldMeta = o.fieldMeta || {}; conflicts = o.conflicts || {};
    docs = new Map(Object.entries(o.docs || (o.app ? {} : o)));
    times = new Map(Object.entries(o.times || {}));
    tomb = new Map(Object.entries(o.tomb || {}));
    for (const k of docs.keys()) if (!times.has(k)) times.set(k, 1);
  }
  async function readAll() {
    try {
      const txt = DESK ? await DESK.read() : FS ? (await FS.readFile({ path: FILE, directory: 'DATA', encoding: 'utf8' })).data : localStorage.getItem(FILE);
      rawSource=txt; if(txt){if(txt.length>30e6)throw Error('Ledger is too large.');const parsed=JSON.parse(txt);if(parsed.app==='family-cashbook-encrypted')lockedEnvelope=txt;else load(parsed);}
    } catch (e) { if (e?.code !== 'ENOENT' && !/does not exist|not found/i.test(e?.message || '')) { loadError = e; window.dispatchEvent(new CustomEvent('cashbook-save', { detail: {state:'error', message:'Unable to read the saved ledger. Restore a backup before editing.'} })); } }
  }
  const ready = readAll();
  // Electron waits for this asynchronous queue before closing. Browsers cannot await unload.
  if(DESK?.onBeforeClose)DESK.onBeforeClose(async()=>{try{await ready;document.activeElement?.blur?.();await new Promise(resolve=>setTimeout(resolve,0));while(window.CashbookUI?.busy)await new Promise(resolve=>setTimeout(resolve,20));await saveQueue;if(saveError||loadError)throw Error('Unresolved storage error');DESK.closeReady(true);}catch{saveStatus('error','Close cancelled: export or retry the unsaved changes.');DESK.closeReady(false);}});
  window.addEventListener('beforeunload',e=>{if(pendingWrites||saveError){e.preventDefault();e.returnValue='';}});
  const snapshot = () => ({ app: 'family-cashbook', version: 2, savedAt: new Date().toISOString(), docs: Object.fromEntries(docs), times: Object.fromEntries(times), tomb: Object.fromEntries(tomb), fieldMeta, conflicts });
  let saveTimer = null, saveQueue = Promise.resolve();
  function saveStatus(state,message=''){window.dispatchEvent(new CustomEvent('cashbook-save',{detail:{state,message}}));}
  function persist(){
    if(loadError)return Promise.reject(Error('Saved ledger could not be read. Restore a known backup first.'));
    assertWritable();const copy=clone(CashbookSchema.validate(snapshot())),password=ledgerPassword;pendingWrites++;meta.hasPendingWrites=true;saveStatus('saving');
    const job=saveQueue.catch(()=>{}).then(async()=>{
      try{
        let txt=JSON.stringify(copy);if(txt.length>CashbookSchema.MAX_BYTES)throw Error('Ledger exceeds the storage size limit. Export and archive records.');if(password)txt=await CashbookSecurity.seal(txt,password);
        if(DESK)await DESK.write(txt);
        else if(FS){await FS.writeFile({path:FILE+'.saving',directory:'DATA',encoding:'utf8',data:txt,recursive:true});await FS.rename({from:FILE+'.saving',to:FILE,directory:'DATA',toDirectory:'DATA'});}
        else localStorage.setItem(FILE,txt);
        saveError=null;
      }catch(e){saveError=e;saveStatus('error','Changes could not be saved. Keep this app open, export a backup, then retry.');throw e;}finally{pendingWrites--;meta.hasPendingWrites=pendingWrites>0;if(!saveError)saveStatus(pendingWrites?'saving':'saved');}
    });
    saveQueue=job;return job;
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
  async function changed(p,before) {
    const t=revision();fieldMeta[p]=CashbookSync.stamp(p,before,docs.get(p),fieldMeta[p],t,deviceId,times.get(p)||1);generation++;
    times.set(p,t); notify(p); await persist(); Drive.dirty();
  }

  async function authorizeLocal(p,before,after){
    const family=docs.get('family/main');if(family?.mode!=='member')return;
    if(p==='family/identity')return;
    const grant=await CashbookFamily.checkGrant(family.grant,family.owner.id);if(grant.role!=='editor')throw Object.assign(Error('This shared ledger is read-only.'),{code:'permission_denied'});
    CashbookFamily.authorizeChange({path:p,data:after??null},Object.fromEntries(docs),grant,docs.get('settings/main')?.closedThrough||'');
  }
  function docRef(p) {
    CashbookSchema.path(p);if (p.split('/').length % 2) throw new TypeError('document paths need an even number of segments: ' + p);
    return {
      id: p.split('/').pop(), path: p,
      async get() { await ready; return snapDoc(p); },
      async set(data) { await ready; assertWritable();CashbookSchema.safe(data);if (!isObj(data)) return bad('document body must be an object'); const before=docs.get(p);CashbookSchema.validate({app:"family-cashbook",docs:{...Object.fromEntries(docs),[p]:data}});await authorizeLocal(p,before,data);docs.set(p, clone(data)); tomb.delete(p); await changed(p,before); },
      async update(data) { await ready; assertWritable();CashbookSchema.safe(data);if(!isObj(data))return bad('document body must be an object');if (!docs.has(p)) return bad('document does not exist'); const before=clone(docs.get(p)); const candidate=merge(docs.get(p),clone(data));CashbookSchema.validate({app:"family-cashbook",docs:{...Object.fromEntries(docs),[p]:candidate}});await authorizeLocal(p,before,candidate);docs.set(p,candidate); await changed(p,before); },
      async delete() { await ready; assertWritable();if (!docs.has(p)) return;await authorizeLocal(p,docs.get(p),null);const t=revision();docs.delete(p);times.delete(p);tomb.set(p,t);generation++;notify(p); await persist(); Drive.dirty(); },
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
  async function applyBatch(ops){
    await ready;assertWritable();if(!Array.isArray(ops)||ops.length>1000)throw Error('Invalid batch.');
    for(const op of ops)await authorizeLocal(op.path,docs.get(op.path),op.type==='delete'?null:op.type==='update'?merge(docs.get(op.path),op.data):op.data);
    const original=clone(snapshot());
    for(const op of ops){CashbookSchema.path(op.path);CashbookSchema.safe(op.data);if(!['set','update','delete'].includes(op.type))throw Error('Invalid batch operation.');if(op.type==='update'&&!docs.has(op.path))throw Error('Record does not exist.');}
    try{for(const op of ops){const p=op.path,before=docs.get(p),t=revision();if(op.type==='delete'){docs.delete(p);times.delete(p);tomb.set(p,t);}else{docs.set(p,op.type==='update'?merge(before,clone(op.data)):clone(op.data));fieldMeta[p]=CashbookSync.stamp(p,before,docs.get(p),fieldMeta[p],t,deviceId,times.get(p)||1);times.set(p,t);tomb.delete(p);}}CashbookSchema.validate(snapshot());}catch(e){load(original);throw e;}
    generation++;notifyMany(ops.map(o=>o.path));await persist();Drive.dirty();
  }
  const db = { doc: docRef, collection: colRef, applyBatch };

  // Merge another copy (from Drive or a backup) into this one, item by item: newest change wins.
  async function mergeIn(o) {
    assertWritable();o=CashbookSchema.validate(o);const previous=JSON.stringify(snapshot());
    const rDocs = o.docs || {}, rTimes = o.times || {}, rTomb = o.tomb || {};
    const touched = [];
    const paths = new Set([...docs.keys(), ...tomb.keys(), ...Object.keys(rDocs), ...Object.keys(rTomb)]);
    let localNewer = false;
    for (const p of paths) {
      const lT = Math.max(times.get(p) || 0, tomb.get(p) || 0);
      const rDocT = rDocs[p] ? (rTimes[p] || 1) : 0, rDelT = rTomb[p] || 0, rT = Math.max(rDocT, rDelT);
      if (docs.has(p) && rDocs[p] && !tomb.has(p) && !(rDelT >= rDocT && rDelT)) {
        const result=CashbookSync.merge(p,docs.get(p),rDocs[p],fieldMeta[p],o.fieldMeta?.[p],times.get(p)||1,rTimes[p]||1);
        for(const c of result.conflicts){
          const id=JSON.stringify([p,c.field,c.localRevision,c.remoteRevision]);
          conflicts[id]={path:p,...c};
        }
        if(JSON.stringify(result.doc)!==JSON.stringify(docs.get(p))){docs.set(p,result.doc);touched.push(p);}
        fieldMeta[p]=result.meta;
        times.set(p,Math.max(lT,rT));
        if(JSON.stringify(result.doc)!==JSON.stringify(rDocs[p]))localNewer=true;
        continue;
      }
      if (rT > lT || (rT===lT&&rDelT>0&&!tomb.has(p))) {
        if (rDelT >= rDocT) { if (docs.has(p)) touched.push(p); docs.delete(p); times.delete(p); tomb.set(p, rDelT); }
        else { docs.set(p, clone(rDocs[p])); fieldMeta[p]=o.fieldMeta?.[p]||{}; times.set(p, rTimes[p] || 1); tomb.delete(p); touched.push(p); }
      } else if (lT > rT) localNewer = true;
    }
    for(const [id,c]of Object.entries(o.conflicts||{}))if(!conflicts[id])conflicts[id]=c;
    conflicts=Object.fromEntries(Object.entries(conflicts).sort(([a],[b])=>a.localeCompare(b)).slice(-200));
    if(JSON.stringify(snapshot())!==previous){await persist();notifyMany(touched);}
    return { touched: touched.length, localNewer };
  }

  // ---------- Google Drive sync ----------
  const Drive = (() => {
    const KEY = 'fcb-drive';
    let st = {};
    try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    const save = () => { try { const {token,exp,...publicState}=st;localStorage.setItem(KEY, JSON.stringify(publicState)); } catch (e) {} };
    delete st.token;delete st.exp;
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
      if (r.status === 401 && !opts._retried) { st.token = ''; st.exp = 0; save(); if (!NATIVE && !interactive) { const e = new Error('Google sign-in expired. Tap Sync now to reconnect.'); e.needsTap = true; throw e; } return api(url, {...opts,_retried:true}, interactive); }
      if(r.status===412){const e=Error('Drive changed during sync. Retry to merge the latest copy.');e.precondition=true;throw e;}
      if (!r.ok) throw new Error('Google Drive error ' + r.status + ': ' + (await r.text()).slice(0, 160));
      return r;
    }
    async function findFile(interactive) {
      if (st.fileId) return st.fileId;
      const q = encodeURIComponent(`name='${DRIVE_NAME}' and trashed=false`);
      const r = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,version,modifiedTime)&orderBy=modifiedTime desc`, {}, interactive)).json();
      if(r.files?.length>1)throw Error('Multiple Drive ledgers found. Preserve each copy and resolve duplicates before syncing.');
      if (r.files && r.files[0]) { st.fileId = r.files[0].id; save(); }
      return st.fileId || null;
    }
    async function upload(interactive,etag) {
      let body=JSON.stringify(snapshot());if(ledgerPassword)body=await CashbookSecurity.seal(body,ledgerPassword);
      let r;
      if (st.fileId) {
        if(!etag)throw Error('Drive did not supply a safe write precondition. Local data is saved; remote upload stopped. Export a backup before resolving sync.');
        r = await api(`https://www.googleapis.com/upload/drive/v3/files/${st.fileId}?uploadType=media&fields=id,version,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match':etag }, body }, interactive);
      } else {
        const b = 'fcb' + Math.random().toString(36).slice(2);
        const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_NAME, mimeType: 'application/json', description: 'Family Cashbook ledger. Edited by the Family Cashbook app; please do not edit by hand.' })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
        r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multipart }, interactive);
      }
      const j = await r.json(); st.fileId = j.id; st.version = j.version; save();
    }
    async function syncOnce(interactive) {
      await ready;assertWritable();if(docs.get('family/main'))throw Error('Use signed family file exchange for family ledgers; personal Drive sync is disabled to keep one authoritative roster.');if(saveError)throw Error('Retry the local save before syncing.');await saveQueue;
      if(!configured())throw Error('Google Drive sync is not set up in this build yet.');
      if(!navigator.onLine){set('offline');return;}set('syncing');
      // Always re-read after a lost acknowledgement or restart. No first-sync override.
      for(let attempt=0;attempt<3;attempt++){
        st.fileId='';const id=await findFile(interactive);let needUpload=dirtyFlag||!id,etag=null;
        if(id){
          const response=await api('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media',{},interactive);
          etag=response.headers.get('ETag');let raw=await response.text();
          if(raw.length>30e6)throw Error('Remote ledger is too large.');
          if(JSON.parse(raw).app==='family-cashbook-encrypted'){
            if(!ledgerPassword)throw Error('Enable and unlock ledger encryption with the shared passphrase before syncing this encrypted copy.');
            raw=await CashbookSecurity.open(raw,ledgerPassword);
          }
          const result=await mergeIn(CashbookSchema.parse(raw));needUpload=needUpload||result.localNewer;
        }
        const sentGeneration=generation;
        try{if(needUpload)await upload(interactive,etag);}catch(e){dirtyFlag=true;if(e.precondition&&attempt<2)continue;throw e;}
        dirtyFlag=generation!==sentGeneration;st.connected=true;st.lastSync=now();save();set(dirtyFlag?'idle':'synced');return;
      }
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
  async function exportData(password) {
    await ready;if(lockedEnvelope)throw Error('Unlock before exporting.');password=password||ledgerPassword;
    let txt = JSON.stringify(snapshot(), null, 1);
    if(password)txt=await CashbookSecurity.seal(txt,password);
    const name = 'family-cashbook-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    if (DESK) return (await DESK.saveFile(name, txt)) ? 'saved' : 'cancelled';
    const Share = Plug('Share');
    if (FS && Share) {
      const w = await FS.writeFile({ path: name, directory: 'CACHE', encoding: 'utf8', data: txt });
      await Share.share({ title: 'Family Cashbook backup', url: w.uri, dialogTitle: 'Save your backup' });
      return 'shared';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; a.click();
    return 'downloaded';
  }
  async function importData(text,password) {
    if(JSON.parse(text)?.app==='family-cashbook-encrypted')text=await CashbookSecurity.open(text,password||'');
    const o = CashbookSchema.parse(text);
    if (!o || o.app !== 'family-cashbook' || !isObj(o.docs)) throw new Error('This is not a Family Cashbook backup file.');
    await ready;
    // An owner backup must never silently reactivate revoked grants or old proposal sequences.
    if(o.docs['family/main']?.mode==='owner'){const restored=o.docs['family/main'];o.docs['family/main']={...restored,members:{},sent:{},received:[],epoch:Math.max(restored.epoch||1,docs.get('family/main')?.epoch||1)+1,reinviteRequired:true};}
    // Preserve the current snapshot before replacing it.
    if(lockedEnvelope)throw Error('Unlock before restoring.');
    const recovery=loadError?null:await exportData(ledgerPassword||undefined);
    if(recovery==='cancelled')throw Error('Restore cancelled; the current ledger was kept.');
    if(loadError&&!sourcePreserved)throw Error('Export the unreadable source before restoring.');
    loadError=null;
    const priorDocs=new Map(docs),priorMeta=fieldMeta,priorRevision=revision();fieldMeta=o.fieldMeta||{};conflicts=o.conflicts||{};
    // A restore replaces this device's ledger; it is then marked as the newest version everywhere.
    const touched = new Set([...docs.keys(), ...Object.keys(o.docs)]);
    const t = Math.max(priorRevision,revision(),...Object.values(o.times||{}),...Object.values(o.fieldMeta||{}).flatMap(x=>Object.values(x).map(r=>r.time)))+1;
    for (const p of docs.keys()) if (!o.docs[p]) tomb.set(p, t);
    docs = new Map(Object.entries(o.docs)); times = new Map([...docs.keys()].map(k => [k, t]));
    for(const k of docs.keys()){tomb.delete(k);const fresh=CashbookSync.stamp(k,priorDocs.get(k)||{},docs.get(k),{},t,deviceId);for(const field of new Set([...Object.keys(priorMeta[k]||{}),...Object.keys(o.fieldMeta?.[k]||{})]))if(!(field in fresh))fresh[field]={time:t,device:deviceId,deleted:true};fieldMeta[k]=fresh;}
    generation++;await persist(); notifyMany([...touched]); Drive.dirty();
  }

  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#3340A0"/><circle cx="16" cy="13" r="5" fill="#fff"/><path d="M6 27c2-5 6-7 10-7s8 2 10 7" fill="#fff"/></svg>');
  const user = {
    isOwner: async () => true, canEdit: async () => true, can: async () => true,
    id: async () => deviceId, name: async () => '', email: async () => null, avatarUrl: async () => avatar,
    me: async () => ({ id: deviceId, name: '', avatarUrl: avatar, color: '#3340A0', email: null, isOwner: true, canEdit: true }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name: '', avatarUrl: avatar, color: '#3340A0', email: null, isMe: id === deviceId, guest: false }])),
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

  async function exportFile(name, text, mime) {
    if (DESK) return DESK.saveFile(name, text);
    const Share = Plug('Share');
    if (FS && Share) { const w = await FS.writeFile({ path: name, directory: 'CACHE', encoding: 'utf8', data: text }); await Share.share({ title: name, url: w.uri, dialogTitle: 'Save or send' }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name; a.click();
  }

  const desktop = DESK ? {
    info: () => DESK.info(), openFolder: () => DESK.openFolder(),
    async chooseFolder() { await saveQueue;if(saveError||loadError)throw Error('Resolve storage errors first.');if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await DESK.write(JSON.stringify(snapshot())); } const r = await DESK.chooseFolder(); if (r && r.reload) location.reload(); return r; },
  } : null;

  async function unlock(password){await ready;if(!lockedEnvelope)return;const plain=await CashbookSecurity.open(lockedEnvelope,password);const o=CashbookSchema.parse(plain);load(o);ledgerPassword=password;lockedEnvelope=null;notifyMany([...new Set([...docSubs.keys(),...docs.keys()])]);for(const [c,fns]of colSubs)for(const fn of fns)fn(snapCol(c));window.dispatchEvent(new Event('cashbook-unlock'));}
  async function encryptLedger(password){await ready;assertWritable();if(Drive.connected)throw Error('Disconnect Drive and preserve a backup before enabling encryption.');if(password.length<12)throw Error('Use at least 12 characters.');await saveQueue;ledgerPassword=password;await persist();}
  async function lock(){await ready;await saveQueue;if(saveError)throw Error('Retry the save before locking.');if(!ledgerPassword)throw Error('Enable working-ledger encryption first.');location.reload();}
  async function exportSource(){if(!rawSource)throw Error("No saved source is available.");const r=await exportFile("family-cashbook-unreadable-source-"+Date.now()+".json",rawSource,"application/json");if(r===false)throw Error("Export cancelled.");sourcePreserved=true;}
  async function shareFile(name,text,mime='application/json'){
    if(NATIVE&&FS&&Plug('Share')){const file=await FS.writeFile({path:name,directory:'CACHE',encoding:'utf8',data:text});await Plug('Share').share({title:'Family Cashbook encrypted file',files:[file.uri],dialogTitle:'Choose WhatsApp, email or another app'});return 'shared';}
    if(!DESK&&navigator.canShare&&navigator.share){const file=new File([text],name,{type:mime});if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Family Cashbook encrypted file'});return 'shared';}}
    return exportFile(name,text,mime);
  }
  window.__cashbookLocal = {shareFile,getSnapshot:async()=>{await ready;if(lockedEnvelope)throw Error('Unlock first.');return clone(snapshot());}, exportSource,get readError(){return loadError;},unlock,encryptLedger,lock,get locked(){return !!lockedEnvelope;},get encrypted(){return !!(lockedEnvelope||ledgerPassword);},flush:async()=>{await saveQueue;if(saveError)throw saveError;}, retrySave:()=>persist(), get saveError(){return saveError||loadError;}, get conflicts(){return conflicts;}, clearConflict:async id=>{delete conflicts[id];await persist();}, exportData, importData, exportFile, drive: Drive, pwa, desktop };
  window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : null };
})();
