// Gives the app page a small, safe bridge to its data file. Nothing else on the computer is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cashbookDesktop', {
  read: () => ipcRenderer.invoke('data:read'),
  write: text => ipcRenderer.invoke('data:write', text),
  writeSync: text => ipcRenderer.sendSync('data:writeSync', text),
  info: () => ipcRenderer.invoke('data:info'),
  openFolder: () => ipcRenderer.invoke('data:open'),
  chooseFolder: () => ipcRenderer.invoke('data:choose'),
  saveFile: (name, text) => ipcRenderer.invoke('file:save', { name, text }),
});
