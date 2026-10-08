'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{_electron}=require('playwright-core'),{createProject,createTrack,createClip,serialize}=require('../src/core/project.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'.runtime/navigation-')),checks=[],errors=[];let app,page;
async function main(){
  const p=createProject('10시간 로파이 타임라인'),track=createTrack('text');p.tracks.push(track);
  for(let i=0;i<10;i++)p.clips.push(createClip({trackId:track.id,type:'text',startTime:i*3600,duration:3600,text:`${i+1}시간 구간`}));
  const file=path.join(data,'10hours.ocut');fs.writeFileSync(file,serialize(p));
  const env={...process.env,OCUT_DATA_DIR:path.join(data,'user')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof state!=='undefined'&&state.project);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.locator('#openProject').click();await page.waitForFunction(()=>state.project.clips.length===10);
  for(const width of [1100,1920]){
    await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setSize(w,900),width);await page.waitForFunction(w=>window.outerWidth===w,width);
    await page.locator('#fitTimeline').click();
    const metrics=await page.evaluate(()=>({end:36000*zoom,width:$('timelineBody').clientWidth,scroll:$('timelineBody').scrollLeft,ticks:$('ruler').children.length,labels:$('ruler').textContent}));
    assert.ok(metrics.end<=metrics.width-10,JSON.stringify(metrics));assert.equal(metrics.scroll,0);assert.ok(metrics.ticks<30);assert.match(metrics.labels,/10:00:00/);
    const last=await page.locator('.clip').last().boundingBox(),body=await page.locator('#timelineBody').boundingBox();assert.ok(last.x+last.width<=body.x+body.width);
  }
  checks.push('10-hour project fits at 1100 and 1920 widths with bounded hourly ruler and all ten clips visible');
  const body=await page.locator('#timelineBody').boundingBox(),x=body.x+body.width*.6,y=body.y+12;
  const before=await page.evaluate(x=>({zoom,time:timeAt(x),web:window.devicePixelRatio}),x);
  await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.wheel(0,-160);await page.keyboard.up('Control');await page.waitForFunction(z=>zoom>z,before.zoom);
  const after=await page.evaluate(x=>({zoom,time:timeAt(x),web:window.devicePixelRatio}),x);
  assert.ok(Math.abs(before.time-after.time)<1/after.zoom);assert.equal(before.web,after.web);
  await page.keyboard.down('Control');await page.mouse.wheel(0,160);await page.keyboard.up('Control');await page.waitForFunction(z=>zoom<z,after.zoom);
  const ordinary=await page.evaluate(()=>zoom);await page.mouse.wheel(0,80);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>zoom),ordinary);
  checks.push('actual Ctrl+wheel zooms both directions around pointer without changing web zoom; ordinary wheel retains timeline zoom');
  await page.locator('#zoom').focus();await page.keyboard.press('Home');await page.waitForFunction(()=>zoom===OcutStudioView.MIN_ZOOM);assert.ok(await page.locator('#ruler span').count()<35);
  await page.keyboard.press('End');await page.waitForFunction(()=>zoom===OcutStudioView.MAX_ZOOM);
  await page.locator('#fitTimeline').click();const ruler=await page.locator('#ruler').boundingBox();await page.mouse.click(ruler.x+await page.evaluate(()=>9*3600*zoom),ruler.y+12);assert.ok(Math.abs(await page.evaluate(()=>playback.time)-32400)<100);
  assert.deepEqual((await page.evaluate(()=>window.ocut.state())).project,p);checks.push('slider keyboard extremes, nine-hour seek and no project mutation');
  await page.screenshot({path:path.join(root,'evidence/studio/timeline-10hours.png')});assert.deepEqual(errors,[]);
  await app.close();app=null;fs.writeFileSync(path.join(root,'evidence/studio/timeline-navigation-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,checks,errors,scope:'10-hour navigation only; 10-hour video export NOT RUN'},null,2));console.log('Timeline navigation PASS:',checks.length);
}
main().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(root,'evidence/studio/timeline-navigation-failure.png')}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});process.exitCode=1;});
