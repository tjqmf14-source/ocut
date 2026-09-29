'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { StudioSession } = require('./session.cjs');

app.setName('O-CUT');
app.setAppUserModelId('studio.ocut.desktop');
app.setPath('userData', process.env.OCUT_DATA_DIR || path.join(app.getPath('appData'), 'O-CUT'));
const session = new StudioSession();
let window;
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
  return session.save(file);
}
register('project:state', () => session.snapshot());
register('project:settings', values => session.settings(values));
register('project:new', async () => await mayDiscard() ? session.newProject() : null);
register('project:open', async () => {
  if (!await mayDiscard()) return null;
  const picked = await dialog.showOpenDialog(window, { title: 'O-CUT 프로젝트 열기', properties: ['openFile'], filters: [{ name: 'O-CUT 프로젝트', extensions: ['ocut'] }] });
  return picked.canceled ? null : session.open(picked.filePaths[0]);
});
register('project:save', as => save(Boolean(as)));
register('history:undo', () => { session.history.undo(); return session.snapshot(); });
register('history:redo', () => { session.history.redo(); return session.snapshot(); });
app.whenReady().then(() => {
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
    if (closing || !session.snapshot().dirty) return;
    event.preventDefault();
    serial = serial.then(async () => { if (await mayDiscard()) { closing = true; window.close(); } }).catch(error => log(error.stack));
  });
  window.loadFile(rendererPath);
}).catch(error => { log(error.stack); app.quit(); });
app.on('window-all-closed', () => app.quit());
