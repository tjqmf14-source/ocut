'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProject,createTrack,createClip}=require('../src/core/project.cjs');
const {ProjectHistory}=require('../src/core/history.cjs');
const {applyCommand}=require('../src/core/timeline.cjs'),keys=require('../src/core/keyframes.js'),fades=require('../src/core/audio-fades.js');
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
function fixture(specs=[{startTime:2,duration:6,sourceStart:2,speed:2}]){
  const p=createProject(),track=createTrack('video'),other=createTrack('video');p.tracks.push(track,other);
  p.media.push({id:'media',type:'video',path:'D:/fixture.mp4',name:'fixture',duration:30,fingerprint:null});
  for(const spec of specs)p.clips.push(createClip({trackId:track.id,type:'video',source:'media',...spec}));
  return {h:new ProjectHistory(p),ids:p.clips.map(c=>c.id),trackId:track.id,otherId:other.id};
}
function animate(h,id){for(const [property,points] of Object.entries({x:[[0,-10,'linear'],[3,20,'hold'],[5,40,'linear'],[6,60,'linear']],opacity:[[1,.2,'hold'],[4,.8,'linear']]}))for(const [time,value,interpolation] of points)applyCommand(h,{type:'keyframe',id,property,time,value,interpolation,operation:'set'});}
function sameCurve(original,next,offset,samples){for(const time of samples)for(const property of ['x','opacity'])close(keys.value(next,property,time),keys.value(original,property,time+offset));}
test('left and right trim preserve linear and hold samples, source speed, and one-step undo',()=>{
  const {h,ids:[id]}=fixture();animate(h,id);const original=h.state.clips[0];
  applyCommand(h,{type:'trim',id,side:'left',time:3.01});let c=h.state.clips[0];close(c.startTime,3);close(c.duration,5);close(c.sourceStart,4);close(c.sourceEnd,14);
  sameCurve(original,c,1,[0,.2,1.9,2,2.99,3,3.99,4,5]);
  h.undo();assert.deepEqual(h.state.clips[0],original);h.redo();
  applyCommand(h,{type:'trim',id,side:'right',time:6.51});c=h.state.clips[0];close(c.duration,3.5);close(c.sourceEnd,11);sameCurve(original,c,1,[0,1.9,2,2.99,3,3.5]);
});
test('extension holds animated endpoints and preserves source and edge-attached fade parameters',()=>{
  const {h,ids:[id]}=fixture();animate(h,id);applyCommand(h,{type:'update',id,values:{audioFade:{fadeIn:2,fadeOut:3}}});const original=h.state.clips[0];
  applyCommand(h,{type:'trim',id,side:'left',time:1});applyCommand(h,{type:'trim',id,side:'right',time:9});const c=h.state.clips[0];
  close(c.sourceStart,0);close(c.sourceEnd,16);sameCurve(original,c,-1,[0,.5,1,2,3.99,4,5,6,7,7.5,8]);
  assert.deepEqual(c.effects,original.effects);assert.deepEqual(fades.lengths(c),{fadeIn:2,fadeOut:3});close(fades.gain(c,7),1/3);
});
test('128-keyframe extension holds endpoints without adding redundant keys',()=>{
  const {h,ids:[id]}=fixture();
  for(let i=0;i<128;i++)applyCommand(h,{type:'keyframe',id,operation:'set',property:'x',time:i*6/127,value:i,interpolation:'linear'});
  const original=h.state.clips[0];
  applyCommand(h,{type:'trim',id,side:'left',time:1});
  applyCommand(h,{type:'trim',id,side:'right',time:9});
  const c=h.state.clips[0];assert.equal(c.keyframes.length,128);
  sameCurve(original,c,-1,[0,.5,1,2,4,6,7,7.5,8]);
});

test('invalid trim boundaries, missing IDs and locks leave history atomic',()=>{
  const {h,ids:[id],trackId}=fixture();animate(h,id);
  for(const action of [{id,side:'left',time:0},{id,side:'right',time:20},{id,side:'right',time:2},{id,side:'left',time:8},{id,side:'right',time:NaN},{id,side:'center',time:3},{id:'missing',side:'right',time:3}]){const before=h.state;assert.throws(()=>applyCommand(h,{type:'trim',...action}));assert.deepEqual(h.state,before);}
  applyCommand(h,{type:'track',id:trackId,property:'locked',value:true});const before=h.state;assert.throws(()=>applyCommand(h,{type:'trim',id,side:'left',time:3}),/잠긴/);assert.deepEqual(h.state,before);
});
test('inspector duration and source window updates preserve keys but pure timeline moves do not rebase',()=>{
  const {h,ids:[id]}=fixture();animate(h,id);const original=h.state.clips[0];
  applyCommand(h,{type:'update',id,values:{startTime:12,sourceStart:4,duration:3,speed:2,transform:{x:5}}});let c=h.state.clips[0];sameCurve(original,c,1,[0,.1,1.99,2,2.99,3]);close(c.sourceEnd,10);
  const previousKeys=structuredClone(c.keyframes);applyCommand(h,{type:'update',id,values:{startTime:15,duration:3,sourceStart:4,speed:2}});assert.deepEqual(h.state.clips[0].keyframes,previousKeys);
  applyCommand(h,{type:'update',id,values:{duration:1.5}});c=h.state.clips[0];sameCurve(original,c,1,[0,.4,1.5]);assert.ok(c.keyframes.every(k=>k.time<=1.5));
});
test('selected split splits crossing clips only in one undoable operation and retains relative source mapping',()=>{
  const {h,ids}=fixture([{startTime:0,duration:6,speed:2},{startTime:1,duration:4},{startTime:8,duration:2}]);const original=h.state.clips;
  const first=applyCommand(h,{type:'splitSelected',ids:[...ids,ids[0]],time:3});assert.equal(h.state.clips.length,5);const copy=h.state.clips.find(c=>c.id===first);close(copy.startTime,3);close(copy.sourceStart,6);close(copy.duration,3);
  assert.equal(h.state.clips.find(c=>c.id===ids[2]).duration,2);h.undo();assert.deepEqual(h.state.clips,original);h.redo();assert.equal(h.state.clips.length,5);
});
test('selected operations reject missing IDs, empty selection and locked members atomically',()=>{
  const {h,ids,otherId}=fixture([{startTime:0,duration:6},{startTime:1,duration:4}]);
  for(const type of ['splitSelected','duplicateSelected'])for(const selection of [[],[ids[0],'missing']]){const before=h.state;assert.throws(()=>applyCommand(h,{type,ids:selection,time:3}));assert.deepEqual(h.state,before);}
  const p=h.state;p.clips.find(c=>c.id===ids[1]).trackId=otherId;p.tracks.find(t=>t.id===otherId).locked=true;const locked=new ProjectHistory(p);
  for(const type of ['splitSelected','duplicateSelected']){const before=locked.state;assert.throws(()=>applyCommand(locked,{type,ids,time:3}),/잠긴/);assert.deepEqual(locked.state,before);}
  const before=h.state;assert.throws(()=>applyCommand(h,{type:'splitSelected',ids,time:9}));assert.deepEqual(h.state,before);
});

test('128-keyframe selected split after the final key preserves both curves without overflowing',()=>{
  const {h,ids:[id]}=fixture([{startTime:0,duration:6}]);
  for(let i=0;i<128;i++)applyCommand(h,{type:'keyframe',id,operation:'set',property:'x',time:i*4/127,value:i,interpolation:'linear'});
  const original=h.state.clips[0];applyCommand(h,{type:'splitSelected',ids:[id],time:5});
  const [left,right]=h.state.clips;assert.equal(left.keyframes.length,128);assert.equal(right.keyframes.length,1);
  sameCurve(original,left,0,[0,1,3.5,4,4.5,5]);sameCurve(original,right,5,[0,.5,1]);
});
test('selected split rolls back earlier halves if a later clip has unsupported effects',()=>{
  const {h,ids}=fixture([{startTime:0,duration:6},{startTime:1,duration:4}]);applyCommand(h,{type:'update',id:ids[1],values:{audioFade:{fadeIn:1,fadeOut:0}}});const before=h.state;assert.throws(()=>applyCommand(h,{type:'splitSelected',ids,time:3}),/페이드/);assert.deepEqual(h.state,before);
});
test('selected duplicate preserves group span, gaps, keys and independent cloned state with one undo',()=>{
  const {h,ids}=fixture([{startTime:2,duration:6},{startTime:11,duration:2}]);animate(h,ids[0]);const before=h.state.clips;
  const first=applyCommand(h,{type:'duplicateSelected',ids:[...ids,ids[0]]}),copies=h.state.clips.slice(2);assert.equal(copies.length,2);assert.equal(copies[0].id,first);close(copies[0].startTime,13);close(copies[1].startTime,22);assert.deepEqual(copies[0].keyframes,before[0].keyframes);
  applyCommand(h,{type:'update',id:first,values:{transform:{x:99}}});assert.equal(h.state.clips[0].transform.x,before[0].transform.x);h.undo();h.undo();assert.deepEqual(h.state.clips,before);
});
test('ripple delete unions overlaps, preserves existing gaps and leaves other tracks alone',()=>{
  const {h,ids,otherId}=fixture([{startTime:0,duration:5},{startTime:3,duration:5},{startTime:10,duration:2},{startTime:12,duration:2}]);const p=h.state;p.clips[3].trackId=otherId;const history=new ProjectHistory(p),before=history.state.clips;
  applyCommand(history,{type:'delete',ids:[ids[0],ids[1]],ripple:true});close(history.state.clips.find(c=>c.id===ids[2]).startTime,2);close(history.state.clips.find(c=>c.id===ids[3]).startTime,12);history.undo();assert.deepEqual(history.state.clips,before);
});
test('ripple deletes only vacated portions when surviving clips occupy removed intervals',()=>{
  const {h,ids}=fixture([{startTime:0,duration:8},{startTime:2,duration:2},{startTime:3,duration:3},{startTime:10,duration:2}]);applyCommand(h,{type:'delete',ids:[ids[0]],ripple:true});
  const remaining=h.state.clips;close(remaining.find(c=>c.id===ids[1]).startTime,0);close(remaining.find(c=>c.id===ids[2]).startTime,1);close(remaining.find(c=>c.id===ids[3]).startTime,6);
});
test('fully occupied deleted span causes no ripple and failed delete cannot partly remove clips',()=>{
  const {h,ids}=fixture([{startTime:2,duration:2},{startTime:0,duration:6},{startTime:8,duration:2}]);const before=h.state;assert.throws(()=>applyCommand(h,{type:'delete',ids:[ids[0],'missing'],ripple:true}));assert.deepEqual(h.state,before);
  applyCommand(h,{type:'delete',ids:[ids[0]],ripple:true});close(h.state.clips.find(c=>c.id===ids[1]).startTime,0);close(h.state.clips.find(c=>c.id===ids[2]).startTime,8);
});
