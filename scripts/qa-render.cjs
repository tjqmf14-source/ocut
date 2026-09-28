const {_electron}=require('playwright-core');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const evidence=path.join(root,'evidence/phase0');
const previous=JSON.parse(fs.readFileSync(path.join(evidence,'runtime-qa.json')));
const song=JSON.parse(fs.readFileSync(path.join(evidence,'generated-songs.json')))[0];
const settings=JSON.parse(fs.readFileSync(path.join(previous.data,'settings.json')));
const checks=[];const errors=[];let app;
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const outDir=path.join(evidence,'renders',runId);
fs.mkdirSync(outDir,{recursive:true});
function save(){fs.writeFileSync(path.join(evidence,'render-qa.json'),JSON.stringify({runId,outDir,checks,errors,dialogHarness:'Only native file selection is supplied by the test; production import/render/IPC/FFmpeg code runs unchanged.'},null,2));}
async function main(){
  // Two seconds of the freshly generated AI WAV are a QA input, never shipped as product demo content.
  const input=path.join(outDir,'ai-excerpt.wav');
  execFileSync(settings.ffmpeg,['-v','error','-i',song.audio,'-t','2','-c:a','pcm_s16le',input],{windowsHide:true});
  const env={...process.env,OCUT_BASELINE_DATA:previous.data,HF_HUB_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/baseline/O-CUT.exe'),env});
  app.process().stdout.on('data',d=>fs.appendFileSync(path.join(outDir,'electron-stdout.log'),d));
  app.process().stderr.on('data',d=>fs.appendFileSync(path.join(outDir,'electron-stderr.log'),d));
  app.process().on('exit',(code,signal)=>fs.writeFileSync(path.join(outDir,'process-exit.json'),JSON.stringify({code,signal,time:new Date().toISOString()})));
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.stack));
  await page.waitForFunction(()=>window.yue&&document.querySelector('#versionInfo').textContent.includes('0.50.2'));
  assert.equal((await page.evaluate(name=>window.yue.createProject(name),'Render QA '+runId)).ok,true);
  await page.reload();await page.locator('#importSongs').waitFor({state:'visible'});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},input);
  await page.locator('#importSongs').click();
  await page.waitForFunction(()=>document.querySelector('#songs').textContent.includes('ai-excerpt'));
  checks.push({name:'real audio import through UI',status:'PASS'});save();
  await page.locator('#vSource').selectOption('project');
  await page.locator('input[name="vRenderer"][value="cpu"]').check();
  for(const [resolution,fps,width,height] of [['1080p',30,1920,1080],['1080p',60,1920,1080],['2160p',30,3840,2160]]){
    const output=path.join(outDir,`${resolution}-${fps}.mp4`);
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.locator('#vResolution').selectOption(resolution);
    await page.locator('#vFps').selectOption(String(fps));
    await page.waitForTimeout(700); // Let the original FPS-change debounce finish.
    await page.locator('#vPrepare').click();
    await page.waitForFunction(fps=>!document.querySelector('#vRender').disabled && !document.querySelector('#vPrepare').disabled && studio.cycle?.fps===fps,fps);
    await page.locator('#vPlay').click();
    await page.waitForFunction(()=>document.querySelector('#vAudio').currentTime>0.2);
    await page.locator('#vPlay').click();
    if(fps===30&&resolution==='1080p')await page.screenshot({path:path.join(evidence,'baseline-spectrum.png')});
    await page.evaluate(()=>{document.querySelector('#vResultCheck').textContent='';});
    await page.locator('#vRender').click();
    await page.waitForFunction(file=>!document.querySelector('#vResult').classList.contains('hidden')&&document.querySelector('#vResultText').textContent.includes(file),output,{timeout:180000});
    const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8',windowsHide:true}));
    const v=meta.streams.find(x=>x.codec_type==='video');const a=meta.streams.find(x=>x.codec_type==='audio');
    assert.ok(fs.statSync(output).size>0);assert.ok(v&&a);assert.equal(v.width,width);assert.equal(v.height,height);assert.equal(v.avg_frame_rate,`${fps}/1`);assert.ok(Math.abs(Number(meta.format.duration)-2)<0.1);
    execFileSync(settings.ffmpeg,['-v','error','-i',output,'-f','null','-'],{windowsHide:true,timeout:60000});
    // Wait for the original application's own preview-versus-export comparison.
    await page.waitForFunction(()=>/SSIM|검증|확인/.test(document.querySelector('#vResultCheck').textContent),null,{timeout:60000});
    const comparison=await page.locator('#vResultCheck').textContent();
    fs.writeFileSync(path.join(outDir,`${resolution}-${fps}.ffprobe.json`),JSON.stringify(meta,null,2));
    checks.push({name:`UI spectrum export ${resolution}/${fps}`,status:'PASS',output,bytes:fs.statSync(output).size,meta,comparison,fullDecode:'PASS'});save();console.log('PASS',resolution,fps,comparison);
  }
  // Exercise the original MP3 and WAV export IPC, with real file conversion.
  const imported=(await page.evaluate(()=>window.yue.listSongs()))[0];
  for(const format of ['mp3','wav']){
    const output=path.join(outDir,`audio-export.${format}`);
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    const r=await page.evaluate(({song,format})=>window.yue.exportSong(song.dir,song.title,format),{song:imported,format});
    assert.equal(r.ok,true);assert.ok(fs.statSync(output).size>0);
    execFileSync(settings.ffmpeg,['-v','error','-i',output,'-f','null','-'],{windowsHide:true});
    checks.push({name:`${format} export and decode`,status:'PASS',output});save();
  }
  assert.equal(errors.length,0);await page.screenshot({path:path.join(evidence,'baseline-export-complete.png')});
  await app.close();app=null;save();console.log('RENDER QA COMPLETE');
}
main().catch(async e=>{errors.push(e.stack);save();console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1;});
