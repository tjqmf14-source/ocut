'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { StudioSession } = require('./session.cjs');
const { MediaLibrary } = require('../infrastructure/media.cjs');
const { applyCommand } = require('../core/timeline.cjs');
const { renderVideo } = require('../infrastructure/render.cjs');

app.setName('O-CUT');
app.setAppUserModelId('studio.ocut.desktop');
app.setPath('userData', process.env.OCUT_DATA_DIR || path.join(app.getPath('appData'), 'O-CUT'));
let session = new StudioSession();
let library = new MediaLibrary(path.join(app.getPath('userData'), 'media-cache'));
protocol.registerSchemesAsPrivileged([{ scheme: 'ocut-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const snapshot = extra => ({ ...session.snapshot(), assets: library.view(), ...extra });
let window;
let exportAbort;
let serial = Promise.resolve();
const rendererPath = path.join(__dirname, '../renderer/index.html');
const log = message => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.appendFileSync(path.join(app.getPath('userData'), 'studio.log'), `${new Date().toISOString()} ${message}\n`);
};
function register(channel, action) {
  ipcMain.handle(channel, (event, payload) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('허용되지 않은 요청입니다.');
    const work = serial.then(async () => {
      try { return { ok: true, data: await action(payload) }; }
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
  return snapshot();
}
register('project:state', () => snapshot());
register('project:settings', values => { session.settings(values); return snapshot(); });
register('project:new', async () => {
  if (!await mayDiscard()) return null;
  session.newProject(); library.assets.clear(); return snapshot({ selectedId: null });
});
register('project:open', async () => {
  if (!await mayDiscard()) return null;
  const picked = await dialog.showOpenDialog(window, { title: 'O-CUT 프로젝트 열기', properties: ['openFile'], filters: [{ name: 'O-CUT 프로젝트', extensions: ['ocut'] }] });
  if (picked.canceled) return null;
  const file = picked.filePaths[0];
  const next = new StudioSession(); await next.open(file);
  const assets = new MediaLibrary(library.cacheDir); const missing = [];
  for (const media of next.history.state.media) {
    try { await assets.prepare({ ...media, path: path.resolve(path.dirname(file), media.path) }); }
    catch (error) { missing.push(`${media.name}: ${error.message}`); }
  }
  session = next; library = assets;
  return snapshot({ selectedId: null, reloadMedia: true, warning: missing.length ? `누락되거나 읽을 수 없는 미디어 ${missing.length}개: ${missing.join(' / ')}` : null });
});
register('project:save', as => save(Boolean(as)));
register('history:undo', () => { session.history.undo(); return snapshot(); });
register('history:redo', () => { session.history.redo(); return snapshot(); });
register('timeline:edit', action => {
  const selectedId = applyCommand(session.history, action);
  return snapshot(['track', 'move'].includes(action.type) ? {} : { selectedId });
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
      onProgress: percent => { if (!window.isDestroyed()) window.webContents.send('render:progress', percent); } });
  } finally { exportAbort = null; }
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
    const response = await net.fetch(pathToFileURL(file).href, { method: request.method, headers: request.headers });
    const headers = new Headers(response.headers); headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
    if (exportAbort) { event.preventDefault(); return; }
    if (closing || !session.snapshot().dirty) return;
    event.preventDefault();
    serial = serial.then(async () => { if (await mayDiscard()) { closing = true; window.close(); } }).catch(error => log(error.stack));
  });
  window.loadFile(rendererPath);
}).catch(error => { log(error.stack); app.quit(); });
app.on('window-all-closed', () => app.quit());
