// Family Cashbook desktop app (Windows). Runs fully offline.
// The ledger is saved as a normal file: Documents\Family Cashbook\family-cashbook-data.json
// (the folder can be changed, e.g. to a Google Drive or OneDrive folder, or a USB stick).
// A dated copy is kept in the Backups sub-folder each day (the last 60 days).
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } };
const writeCfg = c => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1)); };
const dataDir = () => readCfg().dataDir || path.join(app.getPath('documents'), 'Family Cashbook');
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

ipcMain.handle('data:read', () => { try { return fs.readFileSync(dataFile(), 'utf8'); } catch (e) { return null; } });
ipcMain.handle('data:write', (e, text) => { saveData(text); return true; });
ipcMain.on('data:writeSync', (e, text) => { try { saveData(text); e.returnValue = true; } catch (err) { e.returnValue = false; } });
ipcMain.handle('data:info', () => ({ dir: dataDir(), file: dataFile(), backups: path.join(dataDir(), 'Backups') }));
ipcMain.handle('data:open', () => shell.openPath(dataDir()));
ipcMain.handle('data:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to keep your Family Cashbook data', properties: ['openDirectory', 'createDirectory'], defaultPath: dataDir() });
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
    title: 'Family Cashbook', backgroundColor: '#F4F5F8', icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
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
app.on('window-all-closed', () => app.quit());
