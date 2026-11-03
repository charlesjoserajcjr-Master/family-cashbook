// Family Cashbook desktop app (Windows). Runs fully offline.
// The ledger is saved as a normal file: Documents\Family Cashbook\family-cashbook-data.json
// (the folder can be changed, e.g. to a Google Drive or OneDrive folder, or a USB stick).
// A dated copy is kept in the Backups sub-folder each day (the last 60 days).
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const {createRelay}=require('./wifi-relay.cjs');
const wifi=createRelay(value=>{if(win&&!win.isDestroyed())win.webContents.send('wifi:request',value);});
const trusted=e=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted device request');};
ipcMain.handle('wifi:start',e=>{trusted(e);return wifi.start();});
ipcMain.handle('wifi:stop',e=>{trusted(e);return wifi.stop();});
ipcMain.handle('wifi:reply',(e,{id,value})=>{trusted(e);return wifi.respond(id,value);});
ipcMain.handle('devices:read',e=>{trusted(e);try{return fs.readFileSync(path.join(dataDir(),'family-cashbook-local-devices.json'),'utf8');}catch(err){if(err.code==='ENOENT')return null;throw err;}});
ipcMain.handle('devices:write',(e,text)=>{trusted(e);const file=path.join(dataDir(),'family-cashbook-local-devices.json');if(text===null){fs.rmSync(file,{force:true});return;}if(typeof text!=='string'||text.length>200000||JSON.parse(text).app!=='family-cashbook-encrypted')throw Error('Invalid device store');safeWrite(file,text);});

if (!app.requestSingleInstanceLock()) { app.quit(); }

const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } };
const writeCfg = c => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1)); };
const testRoot=process.env.CASHBOOK_TEST_MODE==='1'&&!app.isPackaged?process.env.CASHBOOK_TEST_DATA_DIR:null;
if(testRoot){fs.mkdirSync(path.join(path.resolve(testRoot),'settings'),{recursive:true});app.setPath('userData',path.join(path.resolve(testRoot),'settings'));}
// The app's display name changed, but its folders must not: existing data and the PIN record live there.
const FOLDER = app.getName().includes('Preview') ? 'Family Cashbook Preview' : 'Family Cashbook';
if (!testRoot) app.setPath('userData', path.join(app.getPath('appData'), FOLDER));
const dataDir = () => testRoot?path.join(path.resolve(testRoot),'ledger'):readCfg().dataDir || path.join(app.getPath('documents'), FOLDER);
const dataFile = (dir = dataDir()) => path.join(dir, 'family-cashbook-data.json');

function safeWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.saving';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // replace in one step, so a crash never leaves a half-written ledger
}
function dailyBackup(text) {
  try {
    const dir = path.join(dataDir(), 'Backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'family-cashbook-' + new Date().toISOString().slice(0, 10) + '.json'), text);
    const old = fs.readdirSync(dir).filter(f => /^family-cashbook-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -60);
    old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  } catch (e) { console.error('backup failed', e); }
}
function saveData(text) { safeWrite(dataFile(), text); dailyBackup(text); }

ipcMain.handle('data:read', () => { try { return fs.readFileSync(dataFile(), 'utf8'); } catch(e){if(e.code==='ENOENT')return null;throw e;} });
ipcMain.handle('data:write', (e, text) => { saveData(text); return true; });
ipcMain.on('data:writeSync', (e, text) => { try { saveData(text); e.returnValue = true; } catch (err) { e.returnValue = false; } });
// Windows keeps this key tied to the signed-in user, so a copied data folder has nothing to guess a PIN against.
ipcMain.handle('key:wrap', (e, data) => { if (!safeStorage.isEncryptionAvailable()) throw Error('unavailable'); return safeStorage.encryptString(data).toString('base64'); });
ipcMain.handle('key:unwrap', (e, data) => safeStorage.decryptString(Buffer.from(data, 'base64')));
ipcMain.handle('data:info', () => ({ dir: dataDir(), file: dataFile(), backups: path.join(dataDir(), 'Backups') }));
ipcMain.handle('data:open', () => shell.openPath(dataDir()));
ipcMain.handle('data:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to keep your Family Money records', properties: ['openDirectory', 'createDirectory'], defaultPath: dataDir() });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0], from = dataFile(), to = dataFile(dir);
  if (dir === dataDir()) return { dir, reload: false };
  const existing = fs.existsSync(to);
  // An existing ledger in the new folder (e.g. synced from another laptop) is used as it is;
  // otherwise this computer's ledger is copied there.
  if (!existing && fs.existsSync(from)) fs.copyFileSync(from, to);
  writeCfg({ ...readCfg(), dataDir: dir });
  return { dir, reload: existing };
});
ipcMain.handle('file:save', async (e, { name, text }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name) });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text); return true;
});

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: 'ReadyTrove Family Money', backgroundColor: '#F5F8F7', icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  let closeApproved=false,closing=false,closeTimer;
  win.on('close',e=>{if(closeApproved)return;e.preventDefault();if(closing)return;closing=true;win.webContents.send('data:before-close');closeTimer=setTimeout(()=>{closing=false;dialog.showErrorBox('Close postponed','The ledger has not acknowledged a completed save. Keep the app open and export or retry your changes.');},30000);});
  ipcMain.on('data:close-ready',(e,ok)=>{if(e.sender!==win.webContents||!closing)return;clearTimeout(closeTimer);closing=false;if(ok){closeApproved=true;win.close();}});
  win.webContents.on('did-start-loading',()=>{wifi.stop().catch(()=>{});});
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // Links to websites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'File', submenu: [
    { label: 'Open data folder', click: () => shell.openPath(dataDir()) },
    { type: 'separator' }, { role: 'quit', label: 'Exit' } ] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
]));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {wifi.stop().finally(()=>app.quit());});
