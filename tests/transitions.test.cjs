'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),transition=require('../src/core/transitions.js'),{createProject,createTrack,createClip,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
function fixture(){const p=createProject(),track=createTrack('image');p.tracks.push(track);p.media.push({id:'m',type:'image',path:'D:/image.png',name:'image',duration:null,fingerprint:null});for(let i=0;i<3;i++)p.clips.push(createClip({type:'image',trackId:track.id,source:'m',startTime:i*2,duration:2}));return new ProjectHistory(p);}
test('all transition modes have deterministic start midpoint end and clamp oversized durations',()=>{
  for(const type of transition.types){const c={duration:2,effects:[{type:'visualTransition',enabled:true,parameters:{inType:type,inDuration:1,outType:type,outDuration:1}}]},a=transition.state(c,0,{width:100}),mid=transition.state(c,1,{width:100}),end=transition.state(c,2,{width:100});assert.deepEqual(mid,{opacity:1,x:0,scale:1,wipe:1,blur:0});if(['fade','dissolve','zoom','blur'].includes(type)){assert.equal(a.opacity,0);assert.equal(end.opacity,0);}if(type==='slide'){assert.equal(a.x,-100);assert.equal(end.x,100);}if(type==='wipe'){assert.equal(a.wipe,0);assert.equal(end.wipe,0);}if(type==='blur')assert.equal(a.blur,24);}
  assert.throws(()=>transition.validate({...transition.defaults,inDuration:0}));assert.throws(()=>transition.validate({...transition.defaults,inType:'shader'}));
});
test('dissolve overlaps only incoming and following clips, preserves source ranges, and undoes atomically',()=>{
  const h=fixture(),before=h.state,id=before.clips[1].id;applyCommand(h,{type:'dissolve',id,duration:.5});assert.deepEqual(h.state.clips.map(c=>c.startTime),[0,1.5,3.5]);assert.equal(h.state.clips[1].sourceStart,0);assert.equal(transition.get(h.state.clips[1]).inType,'dissolve');assert.equal(transition.get(h.state.clips[0]).outType,'none');h.undo();assert.deepEqual(h.state.clips,before.clips);h.redo();validateProject(h.state);
});
test('invalid dissolve boundaries locks and durations cannot partially move timeline',()=>{
  const h=fixture(),ids=h.state.clips.map(c=>c.id);for(const request of [{id:ids[0],duration:.5},{id:ids[1],duration:2},{id:ids[1],duration:NaN}]){const before=h.state;assert.throws(()=>applyCommand(h,{type:'dissolve',...request}));assert.deepEqual(h.state,before);}
  applyCommand(h,{type:'update',id:ids[1],values:{startTime:2.2}});const before=h.state;assert.throws(()=>applyCommand(h,{type:'dissolve',id:ids[1],duration:.5}),/경계/);assert.deepEqual(h.state,before);
});
test('transition effect validates rejects audio and must be removed before splitting',()=>{
  const h=fixture(),id=h.state.clips[0].id;applyCommand(h,{type:'update',id,values:{visualTransition:{...transition.defaults,inType:'wipe'}}});const before=h.state;assert.throws(()=>applyCommand(h,{type:'split',id,time:1}),/전환/);assert.deepEqual(h.state,before);applyCommand(h,{type:'update',id,values:{visualTransition:transition.defaults}});assert.equal(h.state.clips[0].effects.length,0);applyCommand(h,{type:'split',id,time:1});assert.equal(h.state.clips.length,4);
});
