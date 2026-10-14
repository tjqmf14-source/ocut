'use strict';
// Exercise real pointer/keyboard routes in the packaged, isolated Electron app.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const {_electron}=require('./qa-electron.cjs');
const {createProject,serialize,validateProject}=require('../src/core/project.cjs');
const {ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
const keys=require('../src/core/keyframes.js');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/studio');
fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});fs.mkdirSync(evidence,{recursive:true});
const data=fs.mkdtempSync(path.join(root,'.runtime/timeline-editing-'));
const checks=[],errors=[],metrics={};let app,page,asarSha256,watchdog;
const run=(exe,args)=>{const result=spawnSync(exe,args,{windowsHide:true,maxBuffer:64*1024*1024,timeout:180000});assert.equal(result.status,0,result.error?.message||result.stderr?.toString());return result;};
const pass=note=>{checks.push(note);console.log('PASS:',note);};
const clip=id=>page.evaluate(id=>state.project.clips.find(c=>c.id===id),id);
const project=()=>page.evaluate(()=>state.project);
const settle=()=>page.waitForFunction(()=>!busy);
const node=id=>page.locator(`.clip[data-clip-id="${id}"]`);
async function select(id,add=false){await node(id).click({position:{x:25,y:24},modifiers:add?['Shift']:[]});await settle();}
async function seek(time){await page.evaluate(time=>playback.seek(time),time);}
async function pointerTrim(id,side,seconds,cancel){
  await select(id);const handle=node(id).locator(`[data-trim="${side}"]`);await handle.scrollIntoViewIfNeeded();
  const b=await handle.boundingBox(),z=await page.evaluate(()=>zoom);
  // Lower half avoids the audio fade handle placed near the clip's top edge.
  const x=b.x+b.width/2,y=b.y+b.height*.72;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+seconds*z,y,{steps:8});
  if(cancel==='escape')await page.keyboard.press('Escape');
  if(cancel==='pointercancel')await node(id).dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});
  await page.mouse.up();await settle();
}
async function waitClip(id,expected){await page.waitForFunction(({id,expected})=>{const c=state.project.clips.find(c=>c.id===id);return !busy&&Object.entries(expected).every(([k,v])=>Math.abs(c[k]-v)<1e-7);},{id,expected});}
async function undoEquals(expected){await page.locator('#undo').click();await settle();assert.deepEqual((await project()).clips,expected.clips);}
async function redoEquals(expected){await page.locator('#redo').click();await settle();assert.deepEqual((await project()).clips,expected.clips);}
function checkPose(original,edited,times){
  for(const t of times)for(const property of ['x','y','scaleX','scaleY','opacity'])assert.ok(Math.abs(keys.value(original,property,t-original.startTime)-keys.value(edited,property,t-edited.startTime))<1e-7,`${property} at world time ${t}`);
  assert.ok(edited.keyframes.every(k=>k.time>=0&&k.time<=edited.duration));
  assert.equal(new Set(edited.keyframes.map(k=>`${k.property}:${k.time}`)).size,edited.keyframes.length);
}
async function launch(env){
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof state!=='undefined'&&state.project);
}
async function open(file,id){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.locator('#openProject').click();await page.waitForFunction(id=>state.project.id===id&&!busy,id);}
async function main(){
  asarSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'dist/studio/resources/app.asar'))).digest('hex');
  const tone=path.join(data,'tone.wav'),picture=path.join(data,'pattern.png');
  run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6',tone]);
  run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30','-frames:v','1',picture]);
  const p=createProject('Timeline editing runtime fixture');p.canvas.width=p.exportSettings.width=640;p.canvas.height=p.exportSettings.height=360;
  const history=new ProjectHistory(p),image={id:randomUUID(),type:'image',name:'Animated test image',path:picture,duration:null,fingerprint:null};
  const imageId=applyCommand(history,{type:'sticker',media:image,startTime:0});
  const textId=applyCommand(history,{type:'text',text:'TIMELINE QA',startTime:0});
  const audioId=applyCommand(history,{type:'music',media:{id:randomUUID(),type:'audio',name:'440 Hz',path:tone,duration:6,fingerprint:null}});
  const lockedId=applyCommand(history,{type:'subtitle',text:'LOCKED',startTime:0});
  for(const id of [imageId,textId,lockedId])applyCommand(history,{type:'update',id,values:{duration:6}});
  applyCommand(history,{type:'update',id:imageId,values:{transform:{scaleX:.55,scaleY:.55}}});
  applyCommand(history,{type:'update',id:textId,values:{transform:{y:-115,scaleX:.4,scaleY:.4}}});
  applyCommand(history,{type:'update',id:lockedId,values:{transform:{y:125,scaleX:.35,scaleY:.35}}});
  for(const [property,points] of [['x',[[0,-100,'linear'],[3,50,'linear'],[6,100,'linear']]],['y',[[0,-25,'hold'],[2,20,'linear'],[6,60,'linear']]],['opacity',[[0,.6,'linear'],[6,1,'linear']]]])
    for(const [time,value,interpolation] of points)applyCommand(history,{type:'keyframe',id:imageId,operation:'set',property,time,value,interpolation});
  applyCommand(history,{type:'track',id:history.state.clips.find(c=>c.id===lockedId).trackId,property:'locked',value:true});
  const fixture=path.join(data,'fixture.ocut');fs.writeFileSync(fixture,serialize(history.state));
  const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
  await launch(env);await open(fixture,p.id);await page.locator('#layoutMode').selectOption('edit');
  await page.locator('#timelineHeight').fill('380');await page.locator('#timelineHeight').dispatchEvent('input');
  await page.locator('#fitTimeline').click();await page.locator('#snap').click();
  const baseline=await project(),original=baseline.clips.find(c=>c.id===imageId);
  await pointerTrim(imageId,'left',1);await waitClip(imageId,{startTime:1,duration:5,sourceStart:1});
  let after=await project();validateProject(after);checkPose(original,await clip(imageId),[1,1.5,2,3,4.5,5.5]);
  await undoEquals(baseline);await redoEquals(after);
  const leftTrimmed=await project();await pointerTrim(imageId,'right',-1);await waitClip(imageId,{startTime:1,duration:4,sourceEnd:5});
  after=await project();validateProject(after);checkPose(original,await clip(imageId),[1,1.5,2,3,4.5,5]);
  await undoEquals(leftTrimmed);await redoEquals(after);
  pass('real left/right trim drags preserve linear and hold animation at world time, valid keyframe bounds, and one-step undo/redo');
  const unchanged=await project();
  for(const cancel of ['escape','pointercancel']){await pointerTrim(imageId,'left',.5,cancel);assert.deepEqual(await project(),unchanged);}
  pass('Escape and pointercancel abandon trim drafts without changing project or revision');
  await select(textId);await seek(1);const textBefore=await project();await page.locator('#trimBefore').click();await waitClip(textId,{startTime:1,duration:5});
  let textAfter=await project();await undoEquals(textBefore);await redoEquals(textAfter);
  await seek(5);await page.locator('#trimAfter').click();await waitClip(textId,{startTime:1,duration:4});
  await undoEquals(textAfter);await undoEquals(textBefore);
  pass('trim-before and trim-after toolbar controls trim at playhead and are atomic undo steps');
  // Ctrl+A must exclude a locked subtitle, using the normal keyboard dispatch path.
  await node(imageId).focus();await page.keyboard.press('Control+a');
  assert.deepEqual((await page.evaluate(()=>[...selected])).sort(),[imageId,textId,audioId].sort());
  await select(lockedId);await select(imageId);await select(textId,true);
  assert.deepEqual((await page.evaluate(()=>[...selected])).sort(),[imageId,textId].sort());
  await seek(3);const beforeSplit=await project();await node(textId).focus();await page.keyboard.press('Control+b');
  await page.waitForFunction(()=>!busy&&state.project.clips.length===6);
  const split=await project();validateProject(split);
  for(const id of [imageId,textId]){
    const old=beforeSplit.clips.find(c=>c.id===id),parts=split.clips.filter(c=>c.trackId===old.trackId).sort((a,b)=>a.startTime-b.startTime);
    assert.equal(parts.length,2);assert.equal(parts[0].startTime+parts[0].duration,3);assert.equal(parts[1].startTime,3);
    for(const part of parts)checkPose(old,part,[part.startTime,part.startTime+part.duration/2,part.startTime+part.duration]);
  }
  await undoEquals(beforeSplit);await redoEquals(split);await undoEquals(beforeSplit);
  pass('Ctrl+A excludes locked tracks; Shift multi-selection and Ctrl+B split both selected clips with preserved animation in one history step');
  await select(lockedId);await select(imageId);await select(textId,true);const beforeDuplicate=await project();
  await node(textId).focus();await page.keyboard.press('Control+d');await page.waitForFunction(()=>!busy&&state.project.clips.length===6);
  const duplicated=await project(),newClips=duplicated.clips.filter(c=>!beforeDuplicate.clips.some(old=>old.id===c.id));
  assert.equal(newClips.length,2);
  for(const id of [imageId,textId]){const old=beforeDuplicate.clips.find(c=>c.id===id),copy=newClips.find(c=>c.trackId===old.trackId);assert.deepEqual({...copy,id:old.id,startTime:old.startTime},old);assert.equal(copy.startTime-old.startTime,6);}
  await undoEquals(beforeDuplicate);await redoEquals(duplicated);await undoEquals(beforeDuplicate);
  pass('Ctrl+D duplicates every selected clip by group span, preserves relative placement and keys, and undoes/redoes atomically');
  await select(audioId);
  for(const [side,delta] of [['fadeIn',.5],['fadeOut',-1]]){
    const h=node(audioId).locator(`.${side}`);await h.scrollIntoViewIfNeeded();const b=await h.boundingBox(),z=await page.evaluate(()=>zoom);
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+delta*z,b.y+b.height/2,{steps:8});await page.mouse.up();await settle();
  }
  assert.deepEqual((await clip(audioId)).effects.find(e=>e.type==='audioFade').parameters,{fadeIn:.5,fadeOut:1});
  await pointerTrim(audioId,'left',1);await waitClip(audioId,{startTime:1,duration:5,sourceStart:1});
  await pointerTrim(audioId,'right',-1);await waitClip(audioId,{startTime:1,duration:4,sourceEnd:5});
  assert.deepEqual((await clip(audioId)).effects.find(e=>e.type==='audioFade').parameters,{fadeIn:.5,fadeOut:1});
  const sampleTimes=[1,1.25,2,4.5,4.9],expectedGains=[0,.5,1,.5,.1];
  const actualGains=await page.evaluate(async({id,times})=>{await playback.play();playback.pause();return times.map(t=>{playback.seek(t);return playback.nodes.get(id).gain.gain.value;});},{id:audioId,times:sampleTimes});
  actualGains.forEach((v,i)=>assert.ok(Math.abs(v-expectedGains[i])<.001,`WebAudio gain at ${sampleTimes[i]}: ${v}`));
  metrics.previewAudio={times:sampleTimes,gains:actualGains};
  pass('mouse fade handles retain edge fade lengths after both trims; real Web Audio gains match an independently calculated envelope');
  const saved=path.join(data,'edited.ocut');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);
  await page.locator('#saveAs').click();await page.waitForFunction(()=>!busy&&!state.dirty);const expected=await project();validateProject(expected);
  await seek(2.5);await page.waitForFunction(()=>[...playback.nodes.values()].filter(e=>e.media.type==='image').every(e=>e.node.complete&&e.node.naturalWidth>0));await seek(2.5);
  const preview=path.join(data,'preview.png');fs.writeFileSync(preview,Buffer.from((await page.locator('#preview').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
  await page.screenshot({path:path.join(evidence,'timeline-editing-preview.png')});
  const output=path.join(data,'edited.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
  await page.locator('#exportVideo').click();await page.waitForFunction(()=>!document.querySelector('#exportDialog').open,null,{timeout:180000});assert.match(await page.locator('#status').textContent(),/^내보내기 완료/);
  run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
  const frame=path.join(data,'output.png');run('ffmpeg',['-v','error','-ss','2.5','-i',output,'-frames:v','1',frame]);
  const comparison=run('ffmpeg',['-i',preview,'-i',frame,'-lavfi','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-f','null','-']).stderr.toString();
  metrics.ssim=Number(comparison.match(/All:([\d.]+)/)?.[1]);assert.ok(metrics.ssim>.97,comparison);
  const pcm=run('ffmpeg',['-v','error','-i',output,'-vn','-f','f32le','-ac','1','-ar','48000','pipe:1']).stdout;
  const rms=t=>{let total=0,count=0;for(let i=Math.floor(t*48000);i<Math.floor((t+.08)*48000)&&i*4<pcm.length;i++){const v=pcm.readFloatLE(i*4);total+=v*v;count++;}assert.ok(count>0);return Math.sqrt(total/count);};
  const steady=rms(2);assert.ok(steady>.02,'export must contain audible tone');
  metrics.pcm={steady,before:rms(.5),fadeIn:rms(1.02),fadeOut:rms(4.88),after:rms(5.5)};
  assert.ok(metrics.pcm.before<steady*.01);assert.ok(metrics.pcm.fadeIn<steady*.2);assert.ok(metrics.pcm.fadeOut<steady*.15);assert.ok(metrics.pcm.after<steady*.01);
  pass('MP4 fully decodes; animated trimmed picture matches preview above .97 SSIM; PCM is audible with correct fade edges and silence outside trimmed audio');
  await app.close();app=null;await launch(env);await open(saved,p.id);assert.deepEqual(await project(),expected);assert.deepEqual(errors,[]);
  pass('save and actual process restart reopen the exact project without renderer errors');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'dist/studio/resources/app.asar'))).digest('hex'),asarSha256,'packaged artifact changed during QA');
  fs.writeFileSync(path.join(evidence,'timeline-editing-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,checks,errors,metrics,output,asarSha256},null,2));
}
watchdog=setTimeout(()=>{console.error('Runtime QA exceeded 8-minute bound');process.exit(2);},480000);
main().catch(async error=>{
  console.error(error);fs.writeFileSync(path.join(evidence,'timeline-editing-failure.json'),JSON.stringify({time:new Date().toISOString(),status:'FAIL',data,checks,errors,metrics,error:error.stack,asarSha256},null,2));
  if(page)await page.screenshot({path:path.join(evidence,'timeline-editing-failure.png')}).catch(()=>{});
  if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});app=null;process.exitCode=1;
}).finally(async()=>{clearTimeout(watchdog);if(app)await app.close();});
