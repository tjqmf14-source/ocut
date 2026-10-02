'use strict';
const { contextBridge, ipcRenderer } = require('electron');
async function call(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result.ok) throw Error(result.error);
  return result.data;
}
contextBridge.exposeInMainWorld('ocut', {
  state: () => call('project:state'),
  workspace:()=>call('workspace:list'),
  openRecent:file=>call('workspace:recent',file),
  recoverProject:id=>call('workspace:recover',id),
  onAutosave:callback=>{const listener=(_event,status)=>callback(status);ipcRenderer.on('workspace:autosave',listener);return ()=>ipcRenderer.removeListener('workspace:autosave',listener);},
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
  sttSettings:()=>call('captions:sttSettings'),
  sttModel:()=>call('captions:sttModel'),
  transcribe:values=>call('captions:transcribe',values),
  cancelTranscription:()=>ipcRenderer.send('captions:sttCancel'),
  onTranscriptionProgress:callback=>{
    const listener=(_event,text)=>callback(text);ipcRenderer.on('captions:sttProgress',listener);
    return ()=>ipcRenderer.removeListener('captions:sttProgress',listener);
  },
  musicState: () => call('music:state'),
  checkMusic: () => call('music:check'),
  configureMusic: key => call('music:configure', key),
  startMusic: values => call('music:start', values),
  cancelMusic: () => ipcRenderer.send('music:cancel'),
  addMusic: id => call('music:add', id),
  createMusicVideo: mediaId => call('visualizer:createVideo', mediaId),
  onMusicState: callback => {
    const listener = (_event, value) => callback(value); ipcRenderer.on('music:state', listener);
    return () => ipcRenderer.removeListener('music:state', listener);
  },
  exportVideo: () => call('render:export'),
  cancelExport: () => ipcRenderer.send('render:cancel'),
  onExportProgress: callback => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('render:progress', listener);
    return () => ipcRenderer.removeListener('render:progress', listener);
  }
});
