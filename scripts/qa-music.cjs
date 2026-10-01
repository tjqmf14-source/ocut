'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),{_electron}=require('playwright-core');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/studio'),data=path.join(root,'.runtime','music-'+Date.now());
fs.mkdirSync(data,{recursive:true});const checks=[],errors=[],stages=new Set();let app,page,timer;
const run=(exe,args)=>{const r=spawnSync(exe,args,{windowsHide:true,maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;};
async function main(){
  const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');
  await page.locator('#musicTab').click();await page.locator('.music-environment summary').click();await page.locator('#checkMusic').click();
  await page.waitForFunction(()=>document.querySelector('#musicCheckResult').textContent.includes('환경 확인 완료'),null,{timeout:90000});
  const environment=await page.locator('#musicCheckResult').textContent();assert.match(environment,/RTX 5080/);checks.push('existing local Python / CUDA / YuE2 environment checked in UI');
  await page.locator('.music-environment summary').click();await page.locator('#musicTitle').fill('O-CUT 음악 실증');await page.locator('#musicSeed').fill('42');
  await page.locator('#generateMusic').click();await page.waitForFunction(()=>!document.querySelector('#musicProgress').hidden);
  timer=setInterval(async()=>{try{const s=await page.evaluate(()=>window.ocut.musicState());if(s.current){stages.add(s.current.stage);console.log('Music:',s.current.status,s.current.stage,JSON.stringify(s.current.progress||{}));}}catch{}},15000);
  await page.locator('#addText').click();await page.waitForFunction(()=>document.querySelectorAll('.clip.text').length===1);
  await page.locator('#clipText').fill('O-CUT\n내 PC에서 만든 음악');await page.locator('#clipDuration').fill('6');await page.locator('#clipForm button[type=submit]').click();
  checks.push('timeline remains editable while real music generation runs');
  await page.waitForFunction(()=>musicState && !musicState.current && musicState.jobs.some(j=>['complete','failed','cancelled'].includes(j.status)),null,{timeout:1800000});clearInterval(timer);
  const music=await page.evaluate(()=>window.ocut.musicState()),job=music.jobs[0];assert.equal(job.status,'complete',job.message);assert.ok(job.duration>1);assert.equal(job.seed,42);
  assert.ok(stages.has('semantic')||stages.has('synth'));
  const pcm=run('ffmpeg',['-v','error','-i',job.audio,'-f','f32le','-ac','1','-ar','48000','pipe:1']);let power=0,peak=0;
  for(let i=0;i<pcm.length;i+=4){const v=pcm.readFloatLE(i);assert.ok(Number.isFinite(v));power+=v*v;peak=Math.max(peak,Math.abs(v));}
  const rms=Math.sqrt(power/(pcm.length/4));assert.ok(rms>.0001&&peak>.001,'generated audio must contain real nonzero samples');
  checks.push('actual GPU-generated WAV fully decodes with nonzero PCM');
  await page.locator('#musicTab').click();
  await page.locator(`.music-job[data-job-id="${job.id}"] button`).click();await page.waitForFunction(()=>document.querySelectorAll('.clip.music').length===1);
  let state=await page.evaluate(()=>window.ocut.state());assert.ok(Object.values(state.assets).some(a=>a.waveform?.peaks.some(v=>v>0)));
  const clipId=state.project.clips.find(c=>c.type==='music').id;
  await page.locator('#clipDuration').fill('6');await page.locator('#clipFadeIn').fill('1');await page.locator('#clipFadeOut').fill('2');await page.locator('#clipVolume').fill('75');await page.locator('#clipForm button[type=submit]').click();
  await page.waitForFunction(()=>state.project.clips.some(c=>c.type==='music'&&c.duration===6&&c.effects.length===1));
  await page.locator('#play').click();await page.waitForTimeout(500);await page.locator('#play').click();
  const measured=await page.evaluate(id=>{playback.pause();return [0,.5,2,5,5.9].map(t=>{playback.seek(t);return {time:t,gain:playback.nodes.get(id).gain.gain.value};});},clipId);
  for(const [i,expected] of [0,.375,.75,.375,.0375].entries())assert.ok(Math.abs(measured[i].gain-expected)<1e-5,JSON.stringify(measured));
  checks.push('generated music creates real waveform and Web Audio preview applies volume and both fades');
  const artifact=path.join(root,'artifacts/music');fs.mkdirSync(artifact,{recursive:true});
  const save=path.join(data,'음악 편집 프로젝트.ocut'),output=path.join(artifact,'O-CUT-AI-music-1080p.mp4');
  const pickSave=file=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  await pickSave(save);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#saveState').textContent==='저장됨');
  await page.evaluate(()=>playback.seek(2));await page.screenshot({path:path.join(evidence,'music-editor.png')});
  await pickSave(output);await page.locator('#exportVideo').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('내보내기 완료'),null,{timeout:180000});
  const metadata=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
  assert.equal(metadata.streams.find(s=>s.codec_type==='video').width,1920);assert.equal(metadata.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
  run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
  const outPcm=run('ffmpeg',['-v','error','-i',output,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  // Compare signal RMS to the actual source with the intended fade envelope, away from AAC edge delay.
  const ratios=[];
  for(const time of [.3,2,5.5]){let a=0,b=0;for(let i=Math.round(time*48000);i<Math.round((time+.15)*48000);i++){const t=i/48000,g=.75*Math.min(1,t)*Math.min(1,(6-t)/2),x=pcm.readFloatLE(i*4)*g,y=outPcm.readFloatLE(i*4);a+=x*x;b+=y*y;}const ratio=Math.sqrt(b/a);assert.ok(ratio>.82&&ratio<1.18,`fade PCM ratio ${time}: ${ratio}`);ratios.push({time,ratio});}
  checks.push('1080p MP4 decodes with source-matched generated music and measured fade envelope');
  // Start then cancel a real worker; no generated success card may appear for it.
  await page.locator('#generateMusic').click();await page.waitForFunction(()=>!document.querySelector('#musicProgress').hidden);await page.locator('#cancelMusic').click();
  await page.waitForFunction(()=>!musicState.current&&musicState.jobs[0]?.status==='cancelled',null,{timeout:20000});
  checks.push('real generation cancellation recorded without publishing a completed song');
  await app.close();app=null;
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},save);
  await page.locator('#openProject').click();await page.waitForFunction(()=>document.querySelectorAll('.clip.music').length===1);
  state=await page.evaluate(()=>window.ocut.state());assert.equal(state.project.clips.find(c=>c.type==='music').effects[0].parameters.fadeOut,2);
  await page.locator('#musicTab').click();await page.waitForFunction(()=>document.querySelectorAll('.music-job').length===2);assert.equal(await page.locator('.music-job button').count(),1);
  checks.push('app restart restores generated catalog and saved project with audio fade parameters');assert.deepEqual(errors,[]);
  fs.copyFileSync(job.audio,path.join(artifact,'O-CUT-generated-music.wav'));fs.copyFileSync(save,path.join(artifact,'음악 편집 프로젝트.ocut'));
  const report={time:new Date().toISOString(),status:'PASS',checks,environment,data,save,output,job,pcm:{rms,peak,ratios},previewGain:measured,sha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex')};
  fs.writeFileSync(path.join(evidence,'music-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:checks.length,seconds:job.duration,rms,output},null,2));
}
main().catch(async e=>{console.error(e);fs.writeFileSync(path.join(evidence,'music-failure.json'),JSON.stringify({time:new Date().toISOString(),data,checks,errors,error:e.stack},null,2));if(page)await page.screenshot({path:path.join(evidence,'music-failure.png')}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});app=null;process.exitCode=1;}).finally(async()=>{clearInterval(timer);if(app)await app.close();});
