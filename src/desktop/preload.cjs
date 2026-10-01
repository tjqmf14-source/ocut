'use strict';
const { contextBridge, ipcRenderer } = require('electron');
async function call(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result.ok) throw Error(result.error);
  return result.data;
}
contextBridge.exposeInMainWorld('ocut', {
  state: () => call('project:state'),
  settings: values => call('project:settings', values),
  newProject: () => call('project:new'),
  openProject: () => call('project:open'),
  saveProject: as => call('project:save', as),
  undo: () => call('history:undo'),
  redo: () => call('history:redo'),
  importMedia: () => call('media:import'),
  edit: action => call('timeline:edit', action),
  importCaptions: () => call('captions:import'),
  exportCaptions: trackId => call('captions:export', trackId),
  exportVideo: () => call('render:export'),
  cancelExport: () => ipcRenderer.send('render:cancel'),
  onExportProgress: callback => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('render:progress', listener);
    return () => ipcRenderer.removeListener('render:progress', listener);
  }
});
