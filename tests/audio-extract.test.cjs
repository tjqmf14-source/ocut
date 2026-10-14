'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProject,createTrack,createClip,validateProject,serialize,deserialize}=require('../src/core/project.cjs');
const {ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
const keys=require('../src/core/keyframes.js'),fades=require('../src/core/audio-fades.js');
function fixture(edit=()=>{}){
  const p=createProject(),track=createTrack('video');p.tracks.push(track);
  p.media.push({id:'video-source',type:'video',path:'D:/fixture.mp4',name:'Video',duration:30,fingerprint:null});
  const clip=createClip({trackId:track.id,type:'video',source:'video-source',startTime:3,duration:6,sourceStart:4,speed:2});
  p.clips.push(clip);edit(p,clip,track);
  return {h:new ProjectHistory(p),id:clip.id,trackId:track.id};
}
test('extract audio preserves trimmed speed mapping, fades and volume keys while muting only original audio',()=>{
  const {h,id}=fixture((p,c)=>{
    c.volume=.4;c.opacity=.7;c.transform.x=125;c.transform.rotation=20;
    c.keyframes=[{property:'x',time:0,value:125,interpolation:'linear'},{property:'x',time:6,value:200,interpolation:'hold'},
      {property:'volume',time:0,value:.2,interpolation:'linear'},{property:'volume',time:3,value:.8,interpolation:'hold'},
      {property:'volume',time:5,value:.4,interpolation:'linear'}];
    c.effects=[{id:'fade',type:'audioFade',enabled:true,parameters:{fadeIn:1,fadeOut:2}},
      {id:'other',type:'legacy-visual-effect',enabled:true,parameters:{amount:2}}];
  });
  const before=h.state.clips[0],audioId=applyCommand(h,{type:'extractAudio',id}),p=h.state;
  const audio=p.clips.find(c=>c.id===audioId),video=p.clips.find(c=>c.id===id);
  assert.equal(audio.type,'audio');assert.notEqual(audio.id,id);assert.equal(p.media.length,1);
  for(const field of ['source','startTime','duration','sourceStart','sourceEnd','speed','volume'])assert.equal(audio[field],before[field],field);
  assert.deepEqual(audio.transform,createClip({trackId:'unused',type:'audio',duration:1}).transform);
  assert.equal(audio.opacity,1);assert.equal(audio.text,'');
  assert.deepEqual(audio.keyframes,before.keyframes.filter(k=>k.property==='volume'));
  assert.equal(audio.effects.length,1);assert.equal(audio.effects[0].type,'audioFade');
  assert.deepEqual(audio.effects[0].parameters,before.effects[0].parameters);assert.notEqual(audio.effects[0].id,before.effects[0].id);
  assert.deepEqual(video,{...before,volume:0,keyframes:before.keyframes.filter(k=>k.property!=='volume')});
  for(const time of [0,.5,2,3,4,5,5.9]){
    assert.equal(keys.value(audio,'volume',time)*fades.gain(audio,time),keys.value(before,'volume',time)*fades.gain(before,time));
    assert.equal(keys.value(video,'volume',time),0);
  }
  assert.equal(p.tracks.find(t=>t.id===audio.trackId).locked,false);
  validateProject(p);assert.deepEqual(deserialize(serialize(p)),p);
});
test('extract audio is one history operation, undo restores original track list and redo restores exact extracted clip',()=>{
  const {h,id}=fixture(),before=h.state,selected=applyCommand(h,{type:'extractAudio',id}),after=h.state;
  assert.equal(after.revision,before.revision+1);assert.equal(h.canUndo,true);
  h.undo();assert.deepEqual(h.state.clips,before.clips);assert.deepEqual(h.state.tracks,before.tracks);assert.equal(h.canUndo,false);
  h.redo();assert.deepEqual(h.state.clips,after.clips);assert.deepEqual(h.state.tracks,after.tracks);assert.equal(h.state.clips[1].id,selected);
});
test('reuse unlocked audio track, bypass locked audio track and create one when all audio tracks locked',()=>{
  for(const unlocked of [true,false]){
    const {h,id}=fixture(p=>{const locked=createTrack('audio');locked.locked=true;p.tracks.push(locked);if(unlocked)p.tracks.push(createTrack('audio','Existing audio'));});
    const old=h.state.tracks,extracted=applyCommand(h,{type:'extractAudio',id}),p=h.state,track=p.tracks.find(t=>t.id===p.clips.find(c=>c.id===extracted).trackId);
    assert.equal(track.locked,false);assert.equal(track.type,'audio');
    assert.equal(p.tracks.length,old.length+(unlocked?0:1));if(unlocked)assert.equal(track.id,old.at(-1).id);
    assert.deepEqual(p.tracks.find(t=>t.id===old[1].id),old[1]);
  }
});
test('original locked track and missing clip reject without altering history or state',()=>{
  for(const locked of [false,true]){
    const {h,id}=fixture((p,c,t)=>{t.locked=locked;});const before=h.state;
    assert.throws(()=>applyCommand(h,{type:'extractAudio',id:locked?id:'missing'}),locked?/잠긴/:/찾을/);
    assert.deepEqual(h.state,before);assert.equal(h.canUndo,false);
  }
});
test('nonvideo clips or sources reject atomically',()=>{
  for(const type of ['audio','image','text','subtitle']){
    const {h,id}=fixture((p,c,t)=>{
      t.type=c.type=type;
      if(type==='text'||type==='subtitle'){c.source=null;c.text='Text';}
      else {p.media[0].type=type;if(type==='image')p.media[0].duration=null;}
    });const before=h.state;assert.throws(()=>applyCommand(h,{type:'extractAudio',id}),/영상/);assert.deepEqual(h.state,before);
  }
});
test('missing or wrong media reference never commits an extracted clip',()=>{
  const {h,id}=fixture(),before=h.state;
  // A corrupted input history must be rejected by the command itself as well as schema validation.
  for(const mode of ['missing','wrong']){
    let edits=0;const fake={apply(label,edit){edits++;const p=structuredClone(before);if(mode==='missing')p.media=[];else p.media[0].type='audio';edit(p);}};
    assert.throws(()=>applyCommand(fake,{type:'extractAudio',id}),/영상/);assert.equal(edits,1);assert.deepEqual(h.state,before);
  }
});
test('already muted video rejects repeated extraction; audible volume keyframes permit extracting a zero base',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'extractAudio',id});const after=h.state;
  assert.throws(()=>applyCommand(h,{type:'extractAudio',id}),/음소거/);assert.deepEqual(h.state,after);
  const keyed=fixture((p,c)=>{c.volume=0;c.keyframes=[{property:'volume',time:0,value:0,interpolation:'linear'},{property:'volume',time:6,value:.6,interpolation:'hold'}];});
  const extracted=applyCommand(keyed.h,{type:'extractAudio',id:keyed.id});assert.equal(keyed.h.state.clips.find(c=>c.id===extracted).keyframes.length,2);
});
test('all-zero volume animation and an endpoint-only held positive value are treated as muted',()=>{
  for(const endValue of [0,.8]){
    const {h,id}=fixture((p,c)=>{c.volume=1;c.keyframes=[{property:'volume',time:0,value:0,interpolation:'hold'},{property:'volume',time:6,value:endValue,interpolation:'linear'}];});
    const before=h.state;assert.throws(()=>applyCommand(h,{type:'extractAudio',id}),/음소거/);assert.deepEqual(h.state,before);
  }
});
test('disabled fades retain their disabled state and extracted effects and keyframes are independent',()=>{
  const {h,id}=fixture((p,c)=>{
    c.effects=[{id:'fade',type:'audioFade',enabled:false,parameters:{fadeIn:2,fadeOut:1}}];
    c.keyframes=[{property:'volume',time:2,value:.6,interpolation:'hold'}];
  });const audioId=applyCommand(h,{type:'extractAudio',id});
  h.apply('edit extracted state',p=>{const c=p.clips.find(c=>c.id===audioId);c.effects[0].parameters.fadeIn=4;c.keyframes[0].value=.2;});
  const original=h.state.clips.find(c=>c.id===id),audio=h.state.clips.find(c=>c.id===audioId);
  assert.equal(original.effects[0].parameters.fadeIn,2);assert.equal(audio.effects[0].enabled,false);assert.equal(original.keyframes.length,0);
});
test('export schedules only extracted audio and keeps its source trim, speed, fades and keyframed gain',()=>{
  const {renderPlan}=require('../src/core/render-plan.cjs');
  const {h,id}=fixture((p,c)=>{c.keyframes=[{property:'volume',time:0,value:.4,interpolation:'linear'},{property:'volume',time:6,value:.8,interpolation:'hold'}];c.effects=[{id:'fade',type:'audioFade',enabled:true,parameters:{fadeIn:1,fadeOut:2}}];});
  const assets=new Map([['video-source',{type:'video',path:'D:/fixture.mp4',width:320,height:180,hasAudio:true}]]);
  const before=renderPlan(h.state,assets,new Map());applyCommand(h,{type:'extractAudio',id});const after=renderPlan(h.state,assets,new Map());
  assert.equal(after.graph.match(/atrim=start=4:end=16/g)?.length,1);
  assert.match(after.graph,/atrim=start=4:end=16,asetpts=PTS-STARTPTS,atempo=2,volume=/);
  assert.match(after.graph,/afade=t=in:st=0:d=1:curve=tri,afade=t=out:st=4:d=2:curve=tri/);
  assert.match(after.graph,/amix=inputs=1:normalize=0/);
  const chain=graph=>graph.split(';\n').find(s=>s.includes('atrim=start=4')).replace(/^\[\d+:a:0\]/,'[source]').replace(/\[a\d+\]$/,'[audio]');
  assert.equal(chain(after.graph),chain(before.graph));
});
