/* ==========================================================================
   preload.js — единственная дверь между экранами и диском.
   Renderer работает с contextIsolation: у него нет ни require, ни fs.
   Наружу выставлен один метод: вызвать хранилище по имени.
   ========================================================================== */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('journeyman', {
  db: (method, ...args) => ipcRenderer.invoke('db', method, args),

  // сохранение файла наружу: имя предлагается, место выбирает пользователь
  saveFile: (name, bytes) => ipcRenderer.invoke('saveFile', name, bytes),

  // пункты меню «Файл» дотягиваются до тех же кнопок, что есть на экране
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd) => fn(cmd)),

  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
