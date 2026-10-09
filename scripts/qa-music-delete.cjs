'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {_electron}=require('./qa-electron.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'.runtime/music-delete-')),user=path.join(data,'user'),music=path.join(user,'music'),evidence=path.join(root,'evidence/studio');
const ids={complete:randomUUID(),failed:randomUUID(),cancelled:randomUUID(),running:randomUUID()},checks=[],errors=[];let app,page;
for(const [status,id] of Object.entries(ids)){const dir=path.join(music,id);fs.mkdirSync(path.join(dir,'plan'),{recursive:true});fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify({id,title:`삭제 검사 ${status}`,status,createdAt:new Date().toISOString(),seed:42,duration:1}));fs.writeFileSync(path.join(dir,'plan/abc.txt'),'fixture');fs.writeFileSync(path.join(dir,'semantic.npy'),'fixture');fs.writeFileSync(path.join(dir,'worker.stderr.log'),'fixture');}
const audio=path.join(music,ids.complete,'audio.wav'),r=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1',audio],{windowsHide:true});assert.equal(r.status,0);
fs.writeFileSync(path.join(music,'settings.json'),'{}');
const env={...process.env,OCUT_DATA_DIR:user};delete env.ELECTRON_RUN_AS_NODE;
async function launch(){app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof musicState!=='undefined'&&musicState);await page.locator('#musicTab').click();}
async function click(id){await page.locator(`.music-job[data-job-id="${id}"] .music-delete`).click();}
async function status(text){await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text),text);}
async function main(){
  await launch();assert.equal(await page.locator('.music-delete').count(),4);
  await app.evaluate(({dialog})=>{global.confirmations=[];dialog.showMessageBox=async(_w,options)=>{confirmations.push(options);return {response:0};};});
  const before=fs.readFileSync(audio);await click(ids.complete);await status('삭제를 취소');assert.deepEqual(fs.readFileSync(audio),before);assert.equal(await page.locator('.music-delete').count(),4);
  const confirm=await app.evaluate(()=>confirmations[0]);assert.equal(confirm.defaultId,0);assert.equal(confirm.cancelId,0);assert.match(confirm.detail,/복구할 수 없습니다/);assert.match(confirm.detail,/MB/);checks.push('complete/failed/cancelled/interrupted cards expose deletion; default-cancel confirmation describes permanent removal and size; cancel leaves all data intact');
  await page.locator(`.music-job[data-job-id="${ids.complete}"] .music-add`).click();await page.waitForFunction(()=>state.project.clips.some(c=>c.type==='music'));await page.locator('#musicTab').click();
  await click(ids.complete);await status('현재 프로젝트');assert.ok(fs.existsSync(audio));assert.equal(await app.evaluate(()=>confirmations.length),1);checks.push('current project audio and undo assets cannot be deleted');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_w,options)=>({response:options.title==='변경 내용 저장'?2:1});});
  await page.locator('#newProject').click();await page.waitForFunction(()=>state.project.clips.length===0);await page.locator('#musicTab').click();
  const cache=path.join(user,'media-cache');assert.ok(fs.readdirSync(cache).some(f=>f.endsWith('.wave.json')));fs.writeFileSync(path.join(cache,'unrelated.wave.json'),'keep');
  await page.screenshot({path:path.join(evidence,'music-delete-controls.png')});
  await click(ids.complete);await status('완전히 삭제했습니다');assert.equal(fs.existsSync(path.dirname(audio)),false);assert.deepEqual(fs.readdirSync(cache),['unrelated.wave.json']);assert.equal(await page.locator('.music-delete').count(),3);checks.push('confirmed UI deletion removes source WAV, generation plan/intermediate/log files and matching waveform cache while preserving unrelated cache');
  // Change a file during the confirmation: the service must revalidate, not delete stale targets.
  await app.evaluate(({dialog})=>{let started;global.qaDialogStarted=new Promise(resolve=>{started=resolve;});dialog.showMessageBox=()=>new Promise(resolve=>{global.qaAnswerDialog=resolve;started();});});
  await click(ids.failed);await app.evaluate(()=>qaDialogStarted);fs.writeFileSync(path.join(music,ids.failed,'new.tmp'),'changed during confirmation');await app.evaluate(()=>qaAnswerDialog({response:1}));
  await status('파일이 변경');assert.ok(fs.existsSync(path.join(music,ids.failed,'semantic.npy')));checks.push('file changes during confirmation stop deletion before mutation');
  await assert.rejects(page.evaluate(()=>window.ocut.deleteGeneratedMusic('../escape')));checks.push('IPC rejects caller-supplied paths');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  for(const id of [ids.failed,ids.cancelled,ids.running]){await click(id);await page.waitForFunction(id=>!musicState.jobs.some(j=>j.id===id),id);assert.equal(fs.existsSync(path.join(music,id)),false);}
  assert.equal(fs.readFileSync(path.join(music,'settings.json'),'utf8'),'{}');checks.push('failed/cancelled/interrupted jobs and leftover temporary data can be fully removed without an audio file');
  await app.close();app=null;await launch();assert.equal(await page.locator('.music-delete').count(),0);assert.equal(await page.locator('.music-job').count(),0);assert.deepEqual(errors,[]);checks.push('deleted songs remain absent after restart; settings preserved and renderer has no errors');
  fs.writeFileSync(path.join(evidence,'music-delete-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',asarSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'dist/studio/resources/app.asar'))).digest('hex'),data,checks,errors,scope:'Destructive checks use isolated synthetic song fixtures only; no user songs deleted.'},null,2));console.log('Music deletion PASS:',checks.length,'flows');
}
main().catch(async error=>{console.error(error);fs.writeFileSync(path.join(evidence,'music-delete-failure.json'),JSON.stringify({time:new Date().toISOString(),data,checks,errors,error:error.stack},null,2));process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
