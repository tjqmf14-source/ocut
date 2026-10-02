'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),filter=require('../src/core/color-filters.js'),{createProject,createTrack,createClip,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
test('neutral pixels are byte exact; monochrome removes chroma and preserves alpha',()=>{
  const input=new Uint8ClampedArray([255,30,80,128,20,100,200,0]),neutral=input.slice();filter.pixels(neutral,filter.defaults);assert.deepEqual(neutral,input);
  const mono=filter.pixels(input.slice(),filter.presets.mono);assert.equal(mono[0],mono[1]);assert.equal(mono[1],mono[2]);assert.equal(mono[3],128);assert.equal(mono[7],0);
});
test('exposure brightness contrast temperature tint highlights and shadows change correct channels',()=>{
  const pixel=s=>[...filter.pixels(new Uint8ClampedArray([64,64,64,255,192,192,192,255]),{...filter.defaults,...s})];
  assert.equal(pixel({exposure:1})[0],128);assert.ok(pixel({brightness:30})[0]>64);assert.ok(pixel({contrast:150})[0]<64);assert.ok(pixel({temperature:100})[0]>pixel({temperature:100})[2]);assert.ok(pixel({tint:100})[0]>pixel({tint:100})[1]);assert.ok(pixel({highlights:-100})[4]<192);assert.equal(pixel({highlights:-100})[0],64);assert.ok(pixel({shadows:100})[0]>64);assert.equal(pixel({shadows:100})[4],192);
});
test('all presets validate and color effect schema rejects unsafe and inappropriate inputs',()=>{
  for(const s of Object.values(filter.presets))filter.validate(s);for(const change of [{exposure:5},{contrast:Infinity},{unknown:0},{saturation:-1}])assert.throws(()=>filter.validate({...filter.defaults,...change}));
  const p=createProject(),t=createTrack('text');p.tracks.push(t);p.clips.push(createClip({trackId:t.id,type:'text',text:'Title',duration:2}));p.clips[0].effects.push({id:'color',type:'colorCorrection',enabled:true,parameters:filter.presets.warm});assert.throws(()=>validateProject(p),/video or image/);
});
test('color edits split undo and neutral removal preserve original source and keyframes',()=>{
  const p=createProject(),t=createTrack('image');p.tracks.push(t);p.media.push({id:'m',type:'image',path:'D:/photo.png',name:'photo',duration:null,fingerprint:null});p.clips.push(createClip({type:'image',trackId:t.id,source:'m',duration:3}));const h=new ProjectHistory(p),id=p.clips[0].id;applyCommand(h,{type:'update',id,values:{colorCorrection:filter.presets.warm}});applyCommand(h,{type:'split',id,time:1});assert.equal(h.state.clips.length,2);assert.deepEqual(filter.get(h.state.clips[1]),filter.presets.warm);h.undo();assert.equal(h.state.clips.length,1);applyCommand(h,{type:'update',id,values:{colorCorrection:filter.defaults}});assert.equal(h.state.clips[0].effects.length,0);h.undo();assert.deepEqual(filter.get(h.state.clips[0]),filter.presets.warm);assert.equal(h.state.media[0].path,'D:/photo.png');
});
