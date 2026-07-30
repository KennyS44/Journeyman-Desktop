/* ==========================================================================
   preload.js — единственная дверь между экранами и диском.
   Renderer работает с contextIsolation: у него нет ни require, ни fs.
   Наружу выставлен один метод: вызвать хранилище по имени.
   ========================================================================== */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('journeyman', {
  db: (method, ...args) => ipcRenderer.invoke('db', method, args),
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
