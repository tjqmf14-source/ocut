'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),{_electron}=require('playwright-core');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/studio'),data=path.join(root,'.runtime','visualizer-'+Date.now()),artifact=path.join(root,'artifacts/visualizer');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(artifact,{recursive:true});const checks=[],outputs=[],errors=[];let app,page;
const run=(exe,args)=>{const r=spawnSync(exe,args,{windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r;};
async function main(){
  const source=path.join(data,'O-CUT 음악 장면.wav');run('ffmpeg',['-v','error','-i',path.join(root,'artifacts/music/O-CUT-generated-music.wav'),'-t','3','-c:a','pcm_s24le','-y',source]);
  const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');
  const pickSave=file=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},source);
  await page.locator('#importMedia').click();await page.waitForFunction(()=>document.querySelector('#mediaCount').textContent==='1');
  await page.locator('#visualizerTab').click();await page.locator('#createMusicVideo').click();
  await page.waitForFunction(()=>state.project.clips.length===3&&state.project.clips.some(c=>c.effects.some(e=>e.type==='audioVisualizer')),null,{timeout:120000});
  let snapshot=await page.evaluate(()=>window.ocut.state()),project=snapshot.project,visualId=project.clips.find(c=>c.type==='overlay').id;
  assert.equal(project.clips.find(c=>c.type==='audio').duration,3);assert.equal(project.clips.find(c=>c.type==='text').duration,3);assert.equal(project.clips.find(c=>c.type==='audio').effects[0].parameters.fadeOut,1.5);
  assert.equal(Object.values(snapshot.assets)[0].spectrum.frameCount,90);assert.equal(Object.values(snapshot.assets)[0].spectrum.barCount,128);
  checks.push('actual packaged worker analyzes PCM and creates editable background/title/audio/visualizer/fade project');
  await page.evaluate(()=>playback.seek(0));await page.locator('#play').click();
  await page.waitForFunction(()=>playback.playing&&playback.time>.3);
  const motionA=await page.locator('#preview').evaluate(c=>c.toDataURL());
  await page.waitForFunction(()=>playback.time>1);
  const motionB=await page.locator('#preview').evaluate(c=>c.toDataURL());assert.notEqual(motionA,motionB);await page.locator('#play').click();
  checks.push('actual audio playback advances time and changes deterministic visualizer frames');
  const cache=fs.readdirSync(path.join(data,'user/media-cache')).find(f=>f.endsWith('.spectrum-v1.json')),cachePath=path.join(data,'user/media-cache',cache),cacheTime=fs.statSync(cachePath).mtimeMs;
  const definitions=[['bars',1920,1080,30],['wave',1280,720,30],['line',1280,720,30],['circular',3840,2160,30],['mirror',1920,1080,60],['spectrum',1280,720,30]];
  for(const [style,width,height,fps] of definitions){
    await page.locator('#deselect').click();await page.locator('#resolution').selectOption(`${width},${height}`);await page.locator('#fps').selectOption(String(fps));await page.locator('#projectForm button[type=submit]').click();
    await page.waitForFunction(v=>state.project.canvas.width===v.width&&state.project.canvas.fps===v.fps,{width,fps});
    await page.locator(`.clip[data-clip-id="${visualId}"]`).click();await page.locator('#visualStyle').selectOption(style);await page.locator('#clipForm button[type=submit]').click();
    await page.waitForFunction(style=>state.project.clips.find(c=>c.type==='overlay').effects.find(e=>e.type==='audioVisualizer').parameters.style===style,style);
    const frames=[];
    for(const time of style==='bars'?[.5,1.5,2.5]:[1.5]){
      const preview=path.join(data,`${style}-${time}.png`);
      const pixels=await page.evaluate(time=>{playback.seek(time);const ctx=document.querySelector('#preview').getContext('2d'),bytes=ctx.getImageData(0,0,playback.canvas.width,playback.canvas.height).data;let colored=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i+1]>bytes[i]*1.1&&bytes[i+1]>80)colored++;return {png:playback.canvas.toDataURL('image/png'),colored};},time);
      assert.ok(pixels.colored>100,`${style} must paint actual spectrum pixels`);fs.writeFileSync(preview,Buffer.from(pixels.png.split(',')[1],'base64'));frames.push({time,preview,colored:pixels.colored});
    }
    const output=path.join(artifact,`O-CUT-${style}-${height}p${fps}.mp4`);await pickSave(output);await page.locator('#exportVideo').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('내보내기 완료')||document.querySelector('#status').classList.contains('error'),null,{timeout:300000});
    assert.match(await page.locator('#status').textContent(),/^내보내기 완료/);
    run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
    for(const frame of frames){
      const actual=path.join(data,`${style}-${frame.time}-actual.png`);run('ffmpeg',['-v','error','-i',output,'-vf',`select=eq(n\\,${Math.round(frame.time*fps)})`,'-frames:v','1','-y',actual]);
      const result=run('ffmpeg',['-hide_banner','-i',frame.preview,'-i',actual,'-lavfi','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-f','null','-']);
      const match=result.stderr.toString().match(/All:([\d.]+)/);assert.ok(match);frame.ssim=Number(match[1]);assert.ok(frame.ssim>.98,`${style} SSIM ${frame.ssim}`);
      const rgb=run('ffmpeg',['-v','error','-i',actual,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']).stdout;let colored=0;for(let i=0;i<rgb.length;i+=3)if(rgb[i+1]>rgb[i]*1.1&&rgb[i+1]>80)colored++;
      frame.outputColored=colored;assert.ok(colored/frame.colored>.7&&colored/frame.colored<1.4,`${style} colored pixels must survive output`);
    }
    outputs.push({style,width,height,fps,output,frames,sha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex')});console.log(style,'PASS',frames.map(f=>f.ssim));
  }
  checks.push('six visualizer styles export actual H264/AAC MP4, including 1080p60 and 4K30, and match preview frames');
  // Validate source-time mapping and persisted user settings with a real inspector edit.
  await page.locator('#clipStart').fill('.5');await page.locator('#clipSourceStart').fill('1');await page.locator('#clipDuration').fill('1');await page.locator('#clipSpeed').fill('2');await page.locator('#visualBars').fill('32');await page.locator('#visualMin').fill('100');await page.locator('#visualMax').fill('6000');await page.locator('#clipX').fill('80');await page.locator('#clipForm button[type=submit]').click();
  await page.waitForFunction(()=>state.project.clips.find(c=>c.type==='overlay').speed===2);
  const mapped=await page.evaluate(()=>{const c=state.project.clips.find(c=>c.type==='overlay'),d=playback.visualData(c.source),p=OcutVisualizer.effect(c).parameters;return {at:Array.from(OcutVisualizer.row(d,c.sourceStart+(.75-c.startTime)*c.speed,p)),expected:Array.from(OcutVisualizer.row(d,1.5,p))};});assert.deepEqual(mapped.at,mapped.expected);
  const save=path.join(data,'시각화 편집.ocut');await pickSave(save);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#saveState').textContent==='저장됨');
  await page.locator('#visualizerTab').click();await page.evaluate(()=>playback.seek(.75));await page.screenshot({path:path.join(evidence,'visualizer-editor.png')});
  checks.push('source trim/speed/timeline placement and visual settings use deterministic source-time mapping');
  const protectedOutput=path.join(data,'cancel.mp4'),sentinel=Buffer.from('existing QA output');fs.writeFileSync(protectedOutput,sentinel);await pickSave(protectedOutput);await page.locator('#exportVideo').click();
  await page.waitForFunction(()=>{const p=document.querySelector('#exportProgress').value;return p>0&&p<25;});await page.locator('#cancelExport').click();
  await page.waitForFunction(()=>!document.querySelector('#exportDialog').open);assert.deepEqual(fs.readFileSync(protectedOutput),sentinel);assert.equal(fs.readdirSync(data).filter(f=>f.startsWith('.ocut-')).length,0);
  checks.push('cancellation during alpha-layer generation preserves existing target and removes partial output');
  await app.close();app=null;app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},save);await page.locator('#openProject').click();
  await page.waitForFunction(()=>state.project.clips.length===3);assert.deepEqual((await page.evaluate(()=>window.ocut.state())).project,JSON.parse(fs.readFileSync(save)));assert.equal(fs.statSync(cachePath).mtimeMs,cacheTime);
  checks.push('app restart restores exact visualizer project and reuses disk analysis cache');assert.deepEqual(errors,[]);
  fs.copyFileSync(save,path.join(artifact,'시각화 편집.ocut'));
  fs.writeFileSync(path.join(evidence,'visualizer-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,save,checks,outputs,errors},null,2));console.log('Visualizer QA PASS:',checks.length,'scenarios');
}
main().catch(async e=>{console.error(e);fs.writeFileSync(path.join(evidence,'visualizer-failure.json'),JSON.stringify({time:new Date().toISOString(),data,checks,outputs,error:e.stack},null,2));if(page)await page.screenshot({path:path.join(evidence,'visualizer-failure.png')}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});app=null;process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
