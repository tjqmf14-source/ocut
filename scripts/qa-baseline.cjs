const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const evidence = path.join(root,'evidence/phase0');
const runId = new Date().toISOString().replace(/[:.]/g,'-');
const data = path.join(root,'.runtime',runId);
const checks = [];
const errors = [];
let app;
function save() { fs.writeFileSync(path.join(evidence,'runtime-qa.json'),JSON.stringify({runId,data,checks,errors},null,2)); }
function passed(name, detail) { checks.push({name,status:'PASS',detail}); save(); console.log('PASS',name); }
const python = process.env.OCUT_PYTHON || 'D:/ssokmusic/runtime/venv/Scripts/python.exe';
const ffmpeg = execFileSync(python,['-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8',windowsHide:true}).trim();
const probe = file => JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true}));
async function launch() {
  const env={...process.env,OCUT_BASELINE_DATA:data,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/baseline/O-CUT.exe'),env,timeout:60000});
  app.process().stderr.on('data',d=>fs.appendFileSync(path.join(evidence,'electron-stderr.log'),d));
  app.process().stdout.on('data',d=>fs.appendFileSync(path.join(evidence,'electron-stdout.log'),d));
  const page=await app.firstWindow();
  page.on('pageerror',e=>{errors.push(e.stack);save();});
  await page.waitForFunction(()=>window.yue && document.querySelector('#versionInfo').textContent.includes('0.50.2'));
  await page.locator('#generate').waitFor({state:'visible'});
  return page;
}
async function main() {
  fs.mkdirSync(data,{recursive:true});
  const gpuLine=execFileSync('nvidia-smi',['--query-gpu=name,memory.total,compute_cap','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true}).trim().split('\n')[0].split(',').map(x=>x.trim());
  fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({setupDone:true,pythonPath:python,hfHome:process.env.OCUT_HF_HOME || 'D:/ssokmusic/models',ffmpeg,songsDir:path.join(data,'Songs'),autoMp3:false,dropWav:false,gpu:{ok:true,name:gpuLine[0],vramGb:Number(gpuLine[1])/1024,compute:Number(gpuLine[2])}}));
  let page=await launch();
  const runtime=await app.evaluate(({app})=>({versions:process.versions,userData:app.getPath('userData'),packaged:app.isPackaged}));
  assert.equal(path.resolve(runtime.userData),path.resolve(data));
  assert.equal(runtime.packaged,true);
  assert.equal((await page.evaluate(()=>window.yue.state())).ready,true);
  assert.equal(await page.locator('#setup').isVisible(),false);
  await page.screenshot({path:path.join(evidence,'baseline-main.png')});
  passed('packaged application startup and music controls',runtime);
  assert.equal((await page.evaluate(()=>window.yue.createProject('O-CUT Phase0 QA'))).ok,true);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#project').value==='O-CUT Phase0 QA');
  passed('project create/select IPC and rendered selector',await page.evaluate(()=>window.yue.projects()));
  await page.locator('#title').fill('O-CUT baseline AI smoke');
  await page.locator('#instrumental').check();
  await page.locator('#style').fill('solo acoustic piano, gentle instrumental, C major, short melody, 90 BPM');
  await page.locator('#seed').fill('42');
  await page.locator('#advanced summary').click();
  await page.locator('#advCot').selectOption('off');
  await page.locator('#advMaxSeconds').fill('20');
  await page.locator('#advAbcMaxTokens').fill('256');
  await page.locator('#advOdeSteps').fill('8');
  await page.evaluate(()=>{
    window.qaEvents=[]; window.qaDone=null; window.qaError=null;
    window.yue.onJobEvent(e=>window.qaEvents.push(e));
    window.yue.onJobDone(e=>window.qaDone=e);
    window.yue.onJobError(e=>window.qaError=e);
  });
  await page.locator('#generate').click();
  console.log('AI generation started through actual UI');
  const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline) {
    const s=await page.evaluate(()=>({done:window.qaDone,error:window.qaError,events:window.qaEvents}));
    fs.writeFileSync(path.join(evidence,'ai-events.json'),JSON.stringify(s,null,2));
    if(s.error) throw Error('AI generation failed: '+JSON.stringify(s.error));
    if(s.done) break;
    await new Promise(r=>setTimeout(r,3000));
  }
  assert.ok(await page.evaluate(()=>window.qaDone),'AI generation timed out');
  const songs=await page.evaluate(()=>window.yue.listSongs());
  fs.writeFileSync(path.join(evidence,'generated-songs.json'),JSON.stringify(songs,null,2));
  const song=songs.find(s=>s.audio && s.title==='O-CUT baseline AI smoke');
  assert.ok(song,'generated audio must appear in library');
  const audio=probe(song.audio);
  assert.ok(Number(audio.format.duration)>0);
  execFileSync(ffmpeg,['-v','error','-i',song.audio,'-f','null','-'],{windowsHide:true});
  passed('real local AI music generation and complete audio decode',{song,audio});
  await page.screenshot({path:path.join(evidence,'baseline-generated.png')});
  const prepared=await page.evaluate(async song=>{
    const r=await window.yue.videoPrepare({tracks:[{path:song.audio,title:song.title}],fps:30,analysis:{barCount:32}});
    return {ok:r.ok,message:r.message,cycle:r.cycle,header:r.header,bytes:r.frames?.length};
  },song);
  assert.equal(prepared.ok,true); assert.ok(prepared.bytes>0);
  passed('real generated audio spectrum worker through IPC',prepared);
  await app.close(); app=null;
  page=await launch();
  const reopened=await page.evaluate(()=>window.yue.listSongs());
  assert.ok(reopened.some(x=>x.title===song.title&&x.audio===song.audio));
  assert.equal((await page.evaluate(()=>window.yue.projects())).current,'O-CUT Phase0 QA');
  passed('close/relaunch restores project and generated song',{count:reopened.length});
  assert.equal(errors.length,0);
  passed('no renderer startup or runtime exception',{errors});
  await app.close(); app=null;
  console.log('RUNTIME QA COMPLETE');
}
main().catch(async e=>{errors.push(e.stack);save();console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1;});
