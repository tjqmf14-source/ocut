'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../src/core/direct-edit.js'),K=require('../src/core/keyframes.js'),{createProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
const canvas={width:1920,height:1080},box={x:-100,y:-30,width:200,height:60};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(){const h=new ProjectHistory(createProject()),id=applyCommand(h,{type:'text',text:'direct',startTime:0});return {h,id};}
test('direct editor world/local transforms roundtrip with rotation, unequal scales and flips',()=>{
  for(const flipX of [false,true])for(const flipY of [false,true]){const t={x:123,y:-47,scaleX:.6,scaleY:1.8,rotation:137,flipX,flipY},p={x:75,y:-13},q=G.local(G.world(p,t,canvas),t,canvas);close(p.x,q.x);close(p.y,q.y);assert.equal(G.contains(G.world(p,t,canvas),box,t,canvas),true);assert.equal(G.contains(G.world({x:999,y:0},t,canvas),box,t,canvas),false);}
});
test('all resize handles keep opposite anchor fixed with rotated and flipped content',()=>{
  const opposite={nw:'se',n:'s',ne:'sw',e:'w',se:'nw',s:'n',sw:'ne',w:'e'};
  for(const flipX of [false,true])for(const name of Object.keys(opposite)){const t={x:60,y:40,scaleX:.7,scaleY:1.2,rotation:40,flipX,flipY:false},points=G.handles(box),p=G.world(points[name],t,canvas),next=G.resize(t,box,name,{x:p.x+20,y:p.y+35},canvas,true),a=G.world(points[opposite[name]],t,canvas),b=G.world(points[opposite[name]],next,canvas);close(a.x,b.x);close(a.y,b.y);assert.ok(next.scaleX>=.001&&next.scaleX<=4);if(name.length===2)close(next.scaleX/next.scaleY,t.scaleX/t.scaleY);}
});
test('resize clamps crossing and extreme drags to valid positive scales',()=>{const t={x:0,y:0,scaleX:1,scaleY:1,rotation:0};for(const p of [{x:-1e8,y:-1e8},{x:1e8,y:1e8}]){const n=G.resize(t,box,'se',p,canvas);assert.ok(n.scaleX>=.001&&n.scaleX<=4);assert.ok(n.scaleY>=.001&&n.scaleY<=4);}});
test('transition-scaled resize uses scaled limits and keeps its anchor fixed',()=>{const t={x:20,y:0,scaleX:.8,scaleY:.4,rotation:22},next=G.resize(t,box,'se',{x:1e7,y:1e7},canvas,true,{min:.0008,max:3.2}),anchor=G.handles(box).nw,a=G.world(anchor,t,canvas),b=G.world(anchor,next,canvas);close(next.scaleX,3.2);close(next.scaleY,1.6);close(a.x,b.x);close(a.y,b.y);});
test('direct transform is one reversible transaction and preserves unrelated values',()=>{
  const {h,id}=fixture(),before=h.state.clips[0];applyCommand(h,{type:'transformDirect',id,time:1,values:{x:140,y:90,scaleX:.5,scaleY:.8,rotation:45}});const after=h.state.clips[0];assert.equal(after.keyframes.length,0);assert.equal(after.transform.rotation,45);assert.equal(after.text,before.text);h.undo();assert.deepEqual(h.state.clips[0],before);h.redo();assert.deepEqual(h.state.clips[0],after);
});
test('automatic keys preserve initial pose and animated transforms update the current frame without changing base',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'transformDirect',id,time:1,values:{x:150,y:20},autoKey:true});let c=h.state.clips[0];assert.equal(c.keyframes.length,4);close(K.value(c,'x',.5),75);assert.equal(c.transform.x,0);
  applyCommand(h,{type:'transformDirect',id,time:1,values:{x:200}});c=h.state.clips[0];assert.equal(c.keyframes.length,4);assert.equal(K.value(c,'x',1),200);assert.equal(c.transform.x,0);
});
test('keyframe drag moves only its time, quantizes frames and rejects occupied destinations atomically',()=>{
  const {h,id}=fixture();for(const [time,value] of [[0,1],[2,10]])applyCommand(h,{type:'keyframe',id,operation:'set',property:'x',time,value,interpolation:'hold'});
  applyCommand(h,{type:'keyframeMove',id,property:'x',from:2,time:1.017});let c=h.state.clips[0];close(c.keyframes[1].time,Math.round(1.017*h.state.canvas.fps)/h.state.canvas.fps);assert.equal(c.keyframes[1].value,10);assert.equal(c.keyframes[1].interpolation,'hold');const before=h.state;assert.throws(()=>applyCommand(h,{type:'keyframeMove',id,property:'x',from:c.keyframes[1].time,time:0}),/위치/);assert.deepEqual(h.state,before);h.undo();assert.equal(h.state.clips[0].keyframes[1].time,2);
});
test('direct edits reject locked tracks and invalid values without partial changes',()=>{
  const {h,id}=fixture();for(const values of [{x:30,scaleX:0},{scaleY:5},{rotation:Infinity},{unknown:2}]){const before=h.state;assert.throws(()=>applyCommand(h,{type:'transformDirect',id,time:1,values}));assert.deepEqual(h.state,before);}
  applyCommand(h,{type:'track',id:h.state.clips[0].trackId,property:'locked',value:true});assert.throws(()=>applyCommand(h,{type:'transformDirect',id,time:1,values:{x:10}}),/잠긴/);assert.throws(()=>applyCommand(h,{type:'keyframeMove',id,property:'x',from:0,time:1}),/잠긴/);
});
