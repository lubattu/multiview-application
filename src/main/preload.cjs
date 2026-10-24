const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poke', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  onSlotHotkey: (callback) => ipcRenderer.on('slot-focus-hotkey', (_event, slotId) => callback(slotId)),
  onSlotOpenStream: (callback) => ipcRenderer.on('slot-open-stream', (_event, payload) => callback(payload)),
  onLightStatus: (callback) => ipcRenderer.on('light:status', (_event, payload) => callback(payload)),
});
