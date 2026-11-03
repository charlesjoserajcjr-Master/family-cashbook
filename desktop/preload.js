// Gives the app page a small, safe bridge to its data file. Nothing else on the computer is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cashbookDesktop', {
  onBeforeClose: callback => ipcRenderer.on('data:before-close',()=>callback()),
  closeReady: ok => ipcRenderer.send('data:close-ready',ok===true),
  deviceWrap:data=>ipcRenderer.invoke('key:wrap',data),
  deviceUnwrap:data=>ipcRenderer.invoke('key:unwrap',data),
  readDeviceVault:()=>ipcRenderer.invoke('devices:read'),
  writeDeviceVault:text=>ipcRenderer.invoke('devices:write',text),
  wifiStart:()=>ipcRenderer.invoke('wifi:start'),
  wifiStop:()=>ipcRenderer.invoke('wifi:stop'),
  wifiReply:(id,value)=>ipcRenderer.invoke('wifi:reply',{id,value}),
  onWifiRequest:callback=>{ipcRenderer.removeAllListeners('wifi:request');ipcRenderer.on('wifi:request',(_,value)=>callback(value));},
  read: () => ipcRenderer.invoke('data:read'),
  write: text => ipcRenderer.invoke('data:write', text),
  writeSync: text => ipcRenderer.sendSync('data:writeSync', text),
  info: () => ipcRenderer.invoke('data:info'),
  openFolder: () => ipcRenderer.invoke('data:open'),
  chooseFolder: () => ipcRenderer.invoke('data:choose'),
  saveFile: (name, text, encoding) => ipcRenderer.invoke('file:save', { name, text, encoding }),
});
