'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto'),{_electron}=require('./qa-electron.cjs');
const {createProject,createTrack,createClip,serialize}=require('../src/core/project.cjs'),{renderPlan}=require('../src/core/render-plan.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'.runtime/audio-extract-')),evidence=path.join(root,'evidence/studio'),checks=[],errors=[];let app,page;
const run=(exe,args)=>{const r=spawnSync(exe,args,{windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r;};
const source=path.join(data,'영상과 소리.mp4'),silent=path.join(data,'무음 영상.mp4');
run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=8','-f','lavfi','-i','sine=frequency=440:duration=8:sample_rate=48000','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:size=320x180:rate=30:duration=1','-c:v','libx264','-pix_fmt','yuv420p',silent]);
const project=createProject('오디오 분리 검증');project.canvas.width=project.exportSettings.width=320;project.canvas.height=project.exportSettings.height=180;
const track=createTrack('video');project.tracks.push(track);
const media={id:randomUUID(),type:'video',name:'영상과 소리',path:source,duration:8,fingerprint:null};project.media.push(media);
const video=createClip({trackId:track.id,type:'video',source:media.id,startTime:1,duration:3,sourceStart:.5,speed:2});video.volume=.4;
video.keyframes=[{property:'volume',time:0,value:.2,interpolation:'linear'},{property:'volume',time:3,value:.8,interpolation:'hold'}];
video.effects=[{id:randomUUID(),type:'audioFade',enabled:true,parameters:{fadeIn:.6,fadeOut:.8}}];project.clips.push(video);
const file=path.join(data,'before.ocut');fs.writeFileSync(file,serialize(project));
const plan=renderPlan(project,new Map([[media.id,{type:'video',path:source,width:320,height:180,hasAudio:true}]]),new Map());
const reference=path.join(data,'before.mp4');run('ffmpeg',['-v','error',...plan.args,'-filter_complex',plan.graph,'-map','[vout]','-map','[aout]','-c:v','libx264','-preset','ultrafast','-c:a','aac','-t',String(plan.duration),reference]);
const pcm=file=>run('ffmpeg',['-v','error','-i',file,'-vn','-f','f32le','-ac','1','-ar','48000','pipe:1']).stdout;
const rms=(buffer,start,length=.12)=>{let sum=0,n=0;for(let i=Math.round(start*48000);i<Math.round((start+length)*48000)&&i*4<buffer.length;i++){sum+=buffer.readFloatLE(i*4)**2;n++;}return Math.sqrt(sum/n);};
const pass=note=>{checks.push(note);console.log('PASS:',note);};
const selected=id=>page.locator(`.clip[data-clip-id="${id}"]`).click({position:{x:25,y:20}});
async function main(){
 const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
 const launch=async()=>{app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof state!=='undefined'&&state.project);};
 const open=async file=>{await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.locator('#openProject').click();await page.waitForFunction(name=>state.project.name===name,project.name);};
 await launch();await open(file);await page.locator('#layoutMode').selectOption('edit');await selected(video.id);
 await page.locator('#extractAudio').click();await page.waitForFunction(()=>state.project.clips.length===2);
 let extracted=await page.evaluate(()=>state.project.clips.find(c=>c.type==='audio')),after=await page.evaluate(()=>state.project);
 assert.equal(after.clips.find(c=>c.type==='video').volume,0);assert.equal(after.clips.find(c=>c.type==='video').keyframes.length,0);
 for(const field of ['startTime','duration','sourceStart','sourceEnd','speed','volume'])assert.equal(extracted[field],video[field]);
 assert.deepEqual(extracted.keyframes,video.keyframes);assert.deepEqual(extracted.effects[0].parameters,video.effects[0].parameters);
 await page.locator('#undo').click();await page.waitForFunction(()=>state.project.clips.length===1);assert.deepEqual(await page.evaluate(()=>state.project.clips[0]),video);
 await page.locator('#redo').click();await page.waitForFunction(()=>state.project.clips.length===2);assert.deepEqual(await page.evaluate(()=>state.project.clips),after.clips);
 pass('actual extract button separates trimmed sped-up audio with fades and volume keys; one undo/redo preserves exact original/new clips');
 await page.evaluate(async()=>{await playback.play();playback.pause();});
 const gains=await page.evaluate(({videoId,audioId})=>[1.3,2,3.5].map(time=>{playback.seek(time);return {time,video:playback.nodes.get(videoId).gain.gain.value,audio:playback.nodes.get(audioId).gain.gain.value};}),{videoId:video.id,audioId:extracted.id});
 for(const {time,video:originalGain,audio:audioGain} of gains){const elapsed=time-video.startTime,expected=(.2+elapsed*.2)*Math.min(1,elapsed/.6)*Math.min(1,(3-elapsed)/.8);assert.equal(originalGain,0);assert.ok(Math.abs(audioGain-expected)<.001,JSON.stringify({time,audioGain,expected}));}
 pass('real Web Audio preview mutes original video and follows extracted audio volume and both fades');
 const saved=path.join(data,'after.ocut'),output=path.join(data,'after.mp4');
 const pick=async file=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
 await pick(saved);await page.locator('#saveAs').click();await page.waitForFunction(()=>!state.dirty);
 await pick(output);await page.locator('#exportVideo').click();await page.waitForFunction(()=>!document.querySelector('#exportDialog').open,null,{timeout:180000});assert.match(await page.locator('#status').textContent(),/^내보내기 완료/);run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
 const beforePcm=pcm(reference),afterPcm=pcm(output),audioSamples=[.3,1.3,2,3.5].map(time=>({time,before:rms(beforePcm,time),after:rms(afterPcm,time)}));
 for(const {time,before,after:actual} of audioSamples){if(time<1)assert.ok(actual<.0001);else assert.ok(Math.abs(actual/before-1)<.08,JSON.stringify({time,before,actual}));}
 pass('actual MP4 fully decodes; PCM matches original audio amplitude and timeline silence without doubled audio');
 const restored=JSON.parse(fs.readFileSync(saved));await page.screenshot({path:path.join(evidence,'audio-extract-editor.png')});await app.close();app=null;
 await launch();await open(saved);await page.waitForFunction(()=>state.project.clips.length===2);assert.deepEqual(await page.evaluate(()=>state.project),restored);
 pass('saved separated tracks, source mapping, volume keys and fades restore exactly after app restart');
 // A real silent video must be rejected by the main-process asset probe, not accepted from project metadata alone.
 const silentProject=createProject('무음 영상 분리 검증'),silentTrack=createTrack('video'),silentMedia={id:randomUUID(),type:'video',name:'무음 영상',path:silent,duration:1,fingerprint:null};silentProject.tracks.push(silentTrack);silentProject.media.push(silentMedia);
 const silentClip=createClip({trackId:silentTrack.id,type:'video',source:silentMedia.id,duration:1});silentProject.clips.push(silentClip);const silentFile=path.join(data,'silent.ocut');fs.writeFileSync(silentFile,serialize(silentProject));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},silentFile);await page.locator('#openProject').click();await page.waitForFunction(()=>state.project.name==='무음 영상 분리 검증');await selected(silentClip.id);
 await page.locator('#extractAudio').click();await page.waitForFunction(()=>!busy);assert.equal(await page.evaluate(()=>state.project.clips.length),1);assert.match(await page.locator('#status').textContent(),/오디오|소리|음성/);
 pass('actual silent-video extraction is rejected by asset audio-stream probe without creating an audio clip');assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'audio-extract-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,checks,errors,saved,output,gains,audioSamples,asarSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'dist/studio/resources/app.asar'))).digest('hex')},null,2));
}
main().catch(async error=>{console.error(error);fs.writeFileSync(path.join(evidence,'audio-extract-failure.json'),JSON.stringify({time:new Date().toISOString(),data,checks,errors,error:error.stack},null,2));if(page)await page.screenshot({path:path.join(evidence,'audio-extract-failure.png')}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});app=null;process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
