'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{_electron}=require('./qa-electron.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/studio'),data=path.join(root,'.runtime','text-style-'+Date.now()),artifact=path.join(root,'artifacts/text-style');
for(const dir of [data,artifact])fs.mkdirSync(dir,{recursive:true});
const run=(exe,args)=>{const r=spawnSync(exe,args,{windowsHide:true,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r;};
const checks=[],outputs=[],errors=[];let app,page;
async function main(){
  const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');
  const metrics=await page.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');c.font='40px Arial';const before=c.measureText('O-CUT').width;c.letterSpacing='10px';return {supported:'letterSpacing' in c,before,after:c.measureText('O-CUT').width};});
  assert.ok(metrics.supported&&metrics.after>metrics.before+30);checks.push('packaged Chromium really applies Canvas letter spacing');
  await page.locator('#addText').click();await page.waitForFunction(()=>state.project.clips.length===1);
  const pick=file=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  await page.evaluate(()=>{window.qaPointer=[];document.addEventListener('pointerdown',e=>qaPointer.push({id:e.target.id,tag:e.target.tagName,x:e.clientX,y:e.clientY}),true);});
  for(const preset of ['title','subtitle','lyrics','lowerThird']){
    console.log('Preset',preset,await page.evaluate(()=>({selected:[...selected],clipFormHidden:document.querySelector('#clipForm').hidden,textHidden:document.querySelector('#textField').hidden,pointers:qaPointer.slice(-5)})));
    await page.locator('#clipText').fill('나의 음악, 나의 장면\nO-CUT · '+preset);await page.locator('#clipDuration').fill('2');await page.locator('#clipX').fill('0');await page.locator('#clipY').fill('0');await page.locator('#textPreset').selectOption(preset);await page.locator('#clipForm button[type=submit]').click();
    await page.waitForFunction(preset=>state.project.clips[0].text.endsWith(preset),preset);await page.evaluate(()=>playback.seek(.5));
    const preview=path.join(data,preset+'-preview.png');fs.writeFileSync(preview,Buffer.from((await page.locator('#preview').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
    const output=path.join(artifact,'O-CUT-'+preset+'.mp4');await pick(output);await page.locator('#exportVideo').click();await page.waitForFunction(()=>!document.querySelector('#exportDialog').open,null,{timeout:90000});assert.match(await page.locator('#status').textContent(),/^내보내기 완료/);
    run('ffmpeg',['-v','error','-i',output,'-f','null','-']);const frame=path.join(artifact,preset+'.png');run('ffmpeg',['-v','error','-ss','0.5','-i',output,'-frames:v','1','-y',frame]);
    const diff=run('ffmpeg',['-i',preview,'-i',frame,'-lavfi','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-f','null','-']).stderr.toString(),ssim=Number(diff.match(/All:([\d.]+)/)?.[1]);assert.ok(ssim>.99,`${preset}: ${ssim}`);
    const pixels=await page.locator('#preview').evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]>60||p[i+1]>60||p[i+2]>60)n++;return n;});assert.ok(pixels>5000,preset+' has visible text');outputs.push({preset,output,preview,frame,ssim,pixels,fullDecode:true});
  }
  checks.push('four Korean multiline text presets render visible full-decode MP4 with preview parity above .99 SSIM');
  const before=(await page.evaluate(()=>window.ocut.state())).project.clips[0];
  await page.locator('#textFont').selectOption('Batang');await page.locator('#textAlign').selectOption('right');
  for(const [id,v] of [['textSize','72'],['textTracking','4'],['textLineHeight','1.8'],['textFill','#ffeeaa'],['textStrokeWidth','3'],['textShadowBlur','8'],['textShadowX','7'],['textShadowY','9'],['textBackgroundOpacity','45'],['textPadding','25'],['textRadius','16'],['clipX','400']])await page.locator('#'+id).fill(v);
  await page.locator('#clipForm button[type=submit]').click();await page.waitForFunction(()=>state.project.clips[0].effects[0].parameters.font==='Batang');
  const custom=(await page.evaluate(()=>window.ocut.state())).project.clips[0];assert.equal(custom.effects[0].parameters.tracking,4);assert.equal(custom.effects[0].parameters.backgroundOpacity,.45);
  await page.locator('#undo').click();await page.waitForFunction(()=>state.project.clips[0].effects[0].parameters.font==='Malgun Gothic');assert.deepEqual((await page.evaluate(()=>window.ocut.state())).project.clips[0],before);
  await page.locator('#redo').click();await page.waitForFunction(()=>state.project.clips[0].effects[0].parameters.font==='Batang');assert.deepEqual((await page.evaluate(()=>window.ocut.state())).project.clips[0],custom);
  checks.push('custom font, alignment, spacing, outline, shadow and background edits undo and redo exactly');
  const save=path.join(artifact,'텍스트 서식.ocut');await pick(save);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#saveState').textContent==='저장됨');await page.evaluate(()=>playback.seek(.5));await page.screenshot({path:path.join(evidence,'text-style-editor.png')});
  await app.close();app=null;app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#status').textContent==='프로젝트 준비됨');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},save);await page.locator('#openProject').click();await page.waitForFunction(()=>state.project.clips.length===1);assert.deepEqual((await page.evaluate(()=>window.ocut.state())).project,JSON.parse(fs.readFileSync(save)));assert.deepEqual(errors,[]);checks.push('standalone styled text project restores exactly after app restart');
  fs.writeFileSync(path.join(evidence,'text-style-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,save,metrics,checks,outputs,errors},null,2));console.log('Text style QA PASS:',checks.length);
}
main().catch(async e=>{console.error(e);const diagnostic=page?await page.evaluate(()=>({selected:[...selected],pointers:qaPointer,active:document.activeElement.id})).catch(()=>null):null;fs.writeFileSync(path.join(evidence,'text-style-failure.json'),JSON.stringify({time:new Date().toISOString(),data,checks,error:e.stack,diagnostic},null,2));if(page)await page.screenshot({path:path.join(evidence,'text-style-failure.png')}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});app=null;process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
