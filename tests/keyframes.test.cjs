'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const keys=require('../src/core/keyframes.js'),{createProject,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
function fixture(){const h=new ProjectHistory(createProject()),id=applyCommand(h,{type:'text'});return {h,id};}
const set=(h,id,property,time,value,interpolation='linear')=>applyCommand(h,{type:'keyframe',id,property,time,value,interpolation,operation:'set'});
test('linear and hold curves have exact endpoint, pre-first and post-last behavior',()=>{
  const {h,id}=fixture();set(h,id,'x',.5,-100);set(h,id,'x',2.5,100);assert.equal(keys.value(h.state.clips[0],'x',0),-100);assert.equal(keys.value(h.state.clips[0],'x',1.5),0);assert.equal(keys.value(h.state.clips[0],'x',3),100);
  set(h,id,'x',.5,-100,'hold');assert.equal(keys.value(h.state.clips[0],'x',2.499),-100);assert.equal(keys.value(h.state.clips[0],'x',2.5),100);
});
test('all seven properties evaluate without mutating base project, key edits replace undo and delete',()=>{
  const {h,id}=fixture();for(const [p,v] of Object.entries({x:123,y:-45,scaleX:.5,scaleY:.7,rotation:90,opacity:.4,volume:2}))set(h,id,p,1,v);
  const before=h.state,c=keys.evaluate(before.clips[0],1);assert.equal(c.transform.x,123);assert.equal(c.opacity,.4);assert.equal(c.volume,2);assert.equal(h.state.clips[0].transform.x,0);assert.deepEqual(h.state,before);
  set(h,id,'x',1,333);assert.equal(h.state.clips[0].keyframes.length,7);h.undo();assert.equal(keys.value(h.state.clips[0],'x',1),123);h.redo();assert.equal(keys.value(h.state.clips[0],'x',1),333);
  applyCommand(h,{type:'keyframe',id,property:'x',time:1,operation:'delete'});assert.equal(keys.value(h.state.clips[0],'x',1),0);validateProject(JSON.parse(JSON.stringify(h.state)));
});
test('unknown properties unsafe values and out-of-clip edits fail atomically',()=>{
  const {h,id}=fixture(),before=h.state;for(const [p,t,v] of [['opacity',1,2],['scaleX',1,0],['volume',1,5],['x',4,1],['x',NaN,1],['x',1,Infinity],['__proto__',1,1]]){assert.throws(()=>set(h,id,p,t,v));assert.deepEqual(h.state,before);}
});
test('splitting a moving clip keeps every sampled linear and hold value continuous in local time',()=>{
  for(const mode of ['linear','hold']){const {h,id}=fixture();set(h,id,'x',0,-100,mode);set(h,id,'x',2,100);set(h,id,'opacity',.5,.2);set(h,id,'opacity',2.5,.8);const original=h.state.clips[0];const rid=applyCommand(h,{type:'split',id,time:1.5}),left=h.state.clips.find(c=>c.id===id),right=h.state.clips.find(c=>c.id===rid);
    for(const t of [0,.2,.5,1,1.49,1.5,1.8,2,2.5,2.99])for(const property of ['x','opacity'])assert.ok(Math.abs(keys.value(original,property,t)-keys.value(t<1.5?left:right,property,t<1.5?t:t-1.5))<1e-8);
  }
});
test('volume expression is numeric-only and preserves hold and linear intervals',()=>{
  const {h,id}=fixture();set(h,id,'volume',0,0);set(h,id,'volume',1,1,'hold');set(h,id,'volume',2,.25);const expr=keys.expression(h.state.clips[0],'volume');assert.match(expr,/gte\(t,1\)\*lt\(t,2\)\*1/);assert.match(expr,/gte\(t,2\)\*0.25/);assert.doesNotMatch(expr,/['";\n]/);
});

test('maximum 128-keyframe volume envelope runs through real FFmpeg without expression depth failure',()=>{
  const {spawnSync}=require('node:child_process'),{tool}=require('../src/infrastructure/media.cjs');
  const clip={transform:{},volume:1,keyframes:Array.from({length:128},(_,i)=>({property:'volume',time:i/128,value:i%10/10,interpolation:i%2?'linear':'hold'}))};
  const result=spawnSync(tool('ffmpeg'),['-v','error','-f','lavfi','-i','sine=d=1','-af',`volume='${keys.expression(clip,'volume')}':eval=frame:precision=double`,'-f','null','-'],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
