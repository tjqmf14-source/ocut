'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { StudioSession } = require('./session.cjs');
const { MediaLibrary, probe } = require('../infrastructure/media.cjs');
const { applyCommand } = require('../core/timeline.cjs');
const { renderVideo } = require('../infrastructure/render.cjs');
const { readCaptions, writeSrt } = require('../infrastructure/caption-files.cjs');
const { serializeSrt } = require('../core/captions.cjs');
const { mediaResponse } = require('../infrastructure/media-response.cjs');
const { MusicService } = require('../infrastructure/music.cjs');
const { MusicQueue } = require('../infrastructure/music-queue.cjs');
const {defaultModel,transcribe}=require('../infrastructure/transcribe.cjs');
const {Workspace}=require('../infrastructure/workspace.cjs');

app.setName('O-CUT');
app.setAppUserModelId('studio.ocut.desktop');
app.setPath('userData', process.env.OCUT_DATA_DIR || path.join(app.getPath('appData'), 'O-CUT'));
if(!app.requestSingleInstanceLock())app.exit(0);
let session = new StudioSession();
let library = new MediaLibrary(path.join(app.getPath('userData'), 'media-cache'));
protocol.registerSchemesAsPrivileged([{ scheme: 'ocut-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const snapshot = extra => ({ ...session.snapshot(), assets: library.view(), ...extra });
let window;
app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.focus();}});
const workspace=new Workspace(path.join(app.getPath('userData'),'workspace'),status=>{if(window&&!window.isDestroyed())window.webContents.send('workspace:autosave',status);});
let exportAbort;
let sttAbort;
const music = new MusicQueue({engine:new MusicService({ directory: path.join(app.getPath('userData'), 'music'), workerPath: path.join(process.resourcesPath, 'music-worker/worker.py') }),canRun:()=>!sttAbort,
  onChange: value => { if (window && !window.isDestroyed()) window.webContents.send('music:state', value); } });
const sttSettings=path.join(app.getPath('userData'),'transcription-settings.json');
async function sttModel(){try{const saved=JSON.parse(fs.readFileSync(sttSettings,'utf8'));if(typeof saved.model==='string')return saved.model;}catch{}return defaultModel();}
let serial = Promise.resolve();
const rendererPath = path.join(__dirname, '../renderer/index.html');
const log = message => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.appendFileSync(path.join(app.getPath('userData'), 'studio.log'), `${new Date().toISOString()} ${message}\n`);
};
function register(channel, action, prepare) {
  ipcMain.handle(channel, (event, payload) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('허용되지 않은 요청입니다.');
    const context = prepare?.();
    const work = serial.then(async () => {
      try { const data=await action(payload,context);if(data?.project)workspace.schedule(session.snapshot());return {ok:true,data}; }
      catch (error) { log(`${channel}: ${error.stack || error.message}`); return { ok: false, error: error.message }; }
    });
    serial = work.catch(() => {});
    return work;
  });
}
async function mayDiscard() {
  if (!session.snapshot().dirty) return true;
  const result = await dialog.showMessageBox(window, { type: 'question', title: '변경 내용 저장',
    message: '저장하지 않은 변경 내용이 있습니다.', buttons: ['저장', '계속 편집', '변경 내용 버리기'], defaultId: 0, cancelId: 1 });
  if (result.response === 1) return false;
  if (result.response === 0) return Boolean(await save(false));
  return true;
}
async function save(as) {
  let file = !as && session.location;
  if (!file) {
    const picked = await dialog.showSaveDialog(window, { title: 'O-CUT 프로젝트 저장',
      defaultPath: session.location || `${session.history.state.name}.ocut`, filters: [{ name: 'O-CUT 프로젝트', extensions: ['ocut'] }] });
    if (picked.canceled || !picked.filePath) return null;
    file = picked.filePath.endsWith('.ocut') ? picked.filePath : picked.filePath + '.ocut';
  }
  await session.save(file);
  await workspace.clear().catch(error=>{workspace.changed('error',error.message);log(error.message);});
  await workspace.remember(file,session.history.state.name).catch(error=>{log(error.message);workspace.changed('error',error.message);});
  return snapshot();
}
register('project:state', () => snapshot());
register('project:settings', values => { session.settings(values); return snapshot(); });
register('project:new', async () => {
  if (!await mayDiscard()) return null;
  await workspace.clear();session.newProject(); library.assets.clear(); return snapshot({ selectedId: null });
});
register('project:open', async () => {
  if (!await mayDiscard()) return null;
  const picked = await dialog.showOpenDialog(window, { title: 'O-CUT 프로젝트 열기', properties: ['openFile'], filters: [{ name: 'O-CUT 프로젝트', extensions: ['ocut'] }] });
  if (picked.canceled) return null;
  return openProject(picked.filePaths[0]);
});
async function openProject(file,recovery){
  const next = new StudioSession();if(recovery)next.restore(recovery.project);else await next.open(file);
  const assets = new MediaLibrary(library.cacheDir); const missing = [];
  for (const media of next.history.state.media) {
    try { await assets.prepare({ ...media, path: path.resolve(path.dirname(file), media.path) }); }
    catch (error) { missing.push(`${media.name}: ${error.message}`); }
  }
  for(const clip of next.history.state.clips.filter(c=>c.effects.some(e=>e.type==='audioVisualizer'))) {
    try{await assets.ensureVisual(clip.source);}catch(error){missing.push(`시각화: ${error.message}`);}
  }
  await workspace.clear();if(recovery)workspace.restored={name:recovery.name,etag:recovery.etag};session = next; library = assets;
  if(!recovery)await workspace.remember(file,session.history.state.name).catch(error=>missing.push(error.message));
  return snapshot({ selectedId: null, reloadMedia: true, warning: missing.length ? `누락되거나 읽을 수 없는 미디어 ${missing.length}개: ${missing.join(' / ')}` : null });
}
register('workspace:list',()=>workspace.list());
register('workspace:recent',async file=>{const recent=await workspace.recent();if(!recent.some(r=>r.path===file))throw Error('최근 프로젝트 목록에서 선택해 주세요.');if(!await mayDiscard())return null;return openProject(file);});
register('workspace:recover',async name=>{const recovery=await workspace.recover(name);if(!await mayDiscard())return null;return openProject(path.join(workspace.store.directory,name),recovery);});
register('project:save', as => save(Boolean(as)));
register('history:undo', () => { session.history.undo(); return snapshot(); });
register('history:redo', () => { session.history.redo(); return snapshot(); });
register('timeline:edit', async action => {
  if (action?.type === 'music') throw Error('완료된 생성 작업에서 음악을 추가해 주세요.');
  if (action?.type === 'visualizer') await library.ensureVisual(action.mediaId);
  const selectedId = applyCommand(session.history, action);
  return snapshot(['track', 'move'].includes(action.type) ? {} : { selectedId });
});
register('visualizer:createVideo', async mediaId => {
  const media=session.history.state.media.find(m=>m.id===mediaId),asset=library.assets.get(mediaId);
  if(!media||!asset?.hasAudio)throw Error('오디오가 있는 미디어를 선택해 주세요.');
  await library.ensureVisual(mediaId);
  if(!await mayDiscard())return null;
  const next=new StudioSession(),duration=Math.floor(media.duration*30+1e-6)/30;
  next.settings({name:media.name,width:1920,height:1080,fps:30});
  next.history.apply('음악 소스',p=>p.media.push(media));
  const audioId=applyCommand(next.history,{type:'add',mediaId});
  const visualId=applyCommand(next.history,{type:'visualizer',mediaId});
  for(const id of [audioId,visualId])applyCommand(next.history,{type:'update',id,values:{audioFade:{fadeIn:Math.min(1,duration/2),fadeOut:Math.min(2,duration/2)}}});
  const title=applyCommand(next.history,{type:'text',text:media.name,startTime:0});
  applyCommand(next.history,{type:'update',id:title,values:{duration,transform:{y:-260,scaleX:.7,scaleY:.7}}});
  // Build before swapping: a failed analysis or validation never destroys the current document.
  await workspace.clear();session=next;for(const id of library.assets.keys())if(id!==mediaId)library.assets.delete(id);
  return snapshot({selectedId:visualId,reloadMedia:true});
});
register('music:state', () => music.state());
register('music:check', () => music.check());
register('music:start', values => music.start(values));
register('music:enqueue', values => music.enqueue(values?.input,values?.count));
register('music:resume', () => music.resume());
register('music:pause', () => music.pause());
register('music:remove', id => music.remove(id));
register('music:clear', () => music.clear());
register('music:configure', async key => {
  if (!['python','models'].includes(key)) throw Error('잘못된 환경 설정입니다.');
  const picked = await dialog.showOpenDialog(window, { title: key === 'python' ? '음악 생성용 Python 선택' : '저장된 YuE2 모델 폴더 선택', properties: [key === 'python' ? 'openFile' : 'openDirectory'] });
  return picked.canceled ? null : music.configure(key, picked.filePaths[0]);
});
register('music:add', async id => {
  const result = await music.audio(id), media = await library.import(result.file); media.name = result.title;
  const selectedId = applyCommand(session.history, { type: 'music', media }); return snapshot({ selectedId });
});
ipcMain.on('music:cancel', event => {
  if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) music.cancel();
});
register('captions:import', async () => {
  const picked = await dialog.showOpenDialog(window, { title: 'SRT · VTT 자막 가져오기', properties: ['openFile'], filters: [{ name: '자막 파일', extensions: ['srt', 'vtt'] }] });
  if (picked.canceled) return null;
  const result = await readCaptions(picked.filePaths[0]);
  const selectedId = applyCommand(session.history, { type: 'captions', segments: result.segments });
  return snapshot({ selectedId, warning: result.warnings.join(' ') || null });
});
register('captions:sttSettings',async()=>({model:await sttModel()}));
register('captions:sttModel',async()=>{
  const picked=await dialog.showOpenDialog(window,{title:'Whisper 모델 폴더 선택 · config.json이 있는 폴더',properties:['openDirectory']});if(picked.canceled)return null;
  const model=fs.realpathSync(picked.filePaths[0]);if(!fs.existsSync(path.join(model,'model.safetensors'))||!fs.existsSync(path.join(model,'config.json')))throw Error('Whisper 모델 파일이 있는 폴더를 선택해 주세요.');
  fs.mkdirSync(path.dirname(sttSettings),{recursive:true});fs.writeFileSync(sttSettings,JSON.stringify({model}));return {model};
});
register('captions:transcribe',async (values,controller)=>{
  try{
  if(controller.signal.aborted)throw Error('자동 자막 생성을 취소했습니다.');
  if(music.occupied)throw Error('음악 대기열을 일시 정지하고 현재 생성이 끝난 뒤 자동 자막을 실행해 주세요.');
  const clip=session.history.state.clips.find(c=>c.id===values?.clipId),asset=library.assets.get(clip?.source);
  if(!asset)throw Error('음성이 있는 타임라인 클립을 선택해 주세요.');
  if((await probe(asset.path)).key!==asset.key)throw Error('원본 미디어가 변경됐습니다. 프로젝트를 다시 열어 주세요.');
    const segments=await transcribe({clip,asset,values,python:music.config.python,model:await sttModel(),directory:path.join(app.getPath('userData'),'transcription'),signal:controller.signal,onProgress:text=>{if(!window.isDestroyed())window.webContents.send('captions:sttProgress',text);}});
    if((await probe(asset.path)).key!==asset.key)throw Error('인식 중 원본이 변경되어 자막을 적용하지 않았습니다.');
    if(controller.signal.aborted)throw Error('자동 자막 생성을 취소했습니다.');
    const selectedId=applyCommand(session.history,{type:'captions',segments});return snapshot({selectedId});
  }finally{if(sttAbort===controller)sttAbort=null;}
},()=>{if(sttAbort)throw Error('자동 자막을 이미 생성하고 있습니다.');sttAbort=new AbortController();return sttAbort;});
ipcMain.on('captions:sttCancel',event=>{if(event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame)sttAbort?.abort();});
register('captions:export', async trackId => {
  const text = serializeSrt(session.history.state, trackId);
  const picked = await dialog.showSaveDialog(window, { title: 'SRT 자막 저장 · 텍스트와 시간만 저장', defaultPath: `${session.history.state.name}.srt`, filters: [{ name: 'SRT 자막', extensions: ['srt'] }] });
  if (picked.canceled || !picked.filePath) return null;
  const target = picked.filePath.toLowerCase().endsWith('.srt') ? picked.filePath : picked.filePath + '.srt';
  await writeSrt(target, text); return { target };
});
register('render:export', async () => {
  const project = session.history.state;
  if (!project.clips.length) throw Error('타임라인에 클립을 추가해 주세요.');
  const picked = await dialog.showSaveDialog(window, { title: 'MP4 내보내기', defaultPath: `${project.name}.mp4`, filters: [{ name: 'MP4 영상', extensions: ['mp4'] }] });
  if (picked.canceled || !picked.filePath) return null;
  exportAbort = new AbortController();
  try {
    return await renderVideo({ project, library, target: picked.filePath.toLowerCase().endsWith('.mp4') ? picked.filePath : picked.filePath + '.mp4',
      cacheDir: path.join(app.getPath('userData'), 'exports'), signal: exportAbort.signal,
      textImage: (clip, canvas, output) => window.webContents.executeJavaScript(`window.OcutText.image(${JSON.stringify(clip)},${JSON.stringify(canvas)},${JSON.stringify(output)})`),
      visualImage: (clip,canvas,output,time) => window.webContents.executeJavaScript(`playback.visualImage(${JSON.stringify(clip)},${JSON.stringify(canvas)},${JSON.stringify(output)},${JSON.stringify(time)})`),
      onProgress: percent => { if (!window.isDestroyed()) window.webContents.send('render:progress', percent); } });
  } finally { exportAbort = null;if(!window.isDestroyed())await window.webContents.executeJavaScript('playback.clearExport()').catch(error=>log(error.message)); }
});
ipcMain.on('render:cancel', event => {
  if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) exportAbort?.abort();
});
register('media:import', async () => {
  const picked = await dialog.showOpenDialog(window, { title: '영상 · 이미지 · 오디오 가져오기', properties: ['openFile', 'multiSelections'], filters: [{ name: '미디어', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'png', 'jpg', 'jpeg', 'webp'] }] });
  if (picked.canceled) return null;
  const imported = []; const failures = [];
  for (const file of picked.filePaths.slice(0, 50)) {
    try { imported.push(await library.import(file)); }
    catch (error) { failures.push(`${path.basename(file)}: ${error.message}`); }
  }
  if (imported.length) session.history.apply('미디어 가져오기', project => { project.media.push(...imported); });
  if (!imported.length && failures.length) throw Error(failures.join('\n'));
  return snapshot({ warning: failures.length ? failures.join('\n') : null });
});
app.whenReady().then(() => {
  protocol.handle('ocut-media', async request => {
    const url = new URL(request.url); const id = url.pathname.slice(1);
    // A renderer cannot turn this protocol into an arbitrary filesystem reader.
    if (!['GET', 'HEAD'].includes(request.method) || !session.history.state.media.some(media => media.id === id)) return new Response('Forbidden', { status: 403 });
    const asset = library.assets.get(id);
    const file = url.hostname === 'asset' ? asset?.path : url.hostname === 'thumb' ? asset?.thumbnail : null;
    if (!file) return new Response('Not found', { status: 404 });
    return mediaResponse(request, file);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }]));
  window = new BrowserWindow({ width: 1540, height: 960, minWidth: 1100, minHeight: 760,
    title: 'O-CUT', backgroundColor: '#101215', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', (_event, details) => log('renderer gone: ' + JSON.stringify(details)));
  let closing = false;
  window.on('close', event => {
    if (exportAbort || sttAbort) { event.preventDefault(); return; }
    if (closing || !session.snapshot().dirty) return;
    event.preventDefault();
    serial = serial.then(async () => { if (await mayDiscard()) {await workspace.clear();closing = true; window.close(); } }).catch(error => log(error.stack));
  });
  window.loadFile(rendererPath);
}).catch(error => { log(error.stack); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {music.dispose();sttAbort?.abort();});
