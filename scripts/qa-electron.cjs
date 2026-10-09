'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{_electron:electron}=require('playwright-core');
// Only isolated test apps may be hidden. Keep the user's installed app untouched.
const _electron={async launch(options){
  const root=path.resolve(__dirname,'..'),data=path.resolve(options.env?.OCUT_DATA_DIR||'');
  assert.ok(data.startsWith(path.join(root,'.runtime')+path.sep),'QA requires an isolated runtime directory');
  assert.equal(path.resolve(options.executablePath),path.join(root,'dist/studio/O-CUT.exe'));
  const app=await electron.launch(options),page=await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);window.hide();});
  const screenshot=page.screenshot.bind(page);
  page.screenshot=async options=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());try{return await screenshot(options);}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide()).catch(()=>{});}};
  return app;
}};
module.exports={_electron};
