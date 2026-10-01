'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {analyze}=require('../src/core/spectrum-analysis.cjs'),visual=require('../src/core/visualizer.js');
const {createProject,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs'),{renderPlan}=require('../src/core/render-plan.cjs');
function fixture(){const p=createProject();p.media.push({id:'music',type:'audio',path:'D:/song.wav',duration:4,name:'song',fingerprint:null});const h=new ProjectHistory(p);const id=applyCommand(h,{type:'visualizer',mediaId:'music'});return {h,id};}
test('FFT source is byte-identical to the preserved baseline implementation',()=>{assert.deepEqual(fs.readFileSync('src/core/spectrum-analysis.cjs'),fs.readFileSync('baseline/electron/spectrum-analysis.js'));});
test('silent audio generates zero spectrum and all drawing samples stay zero',()=>{
  const a=analyze(new Float32Array(24000),24000,30,{barCount:128,minFrequency:20,maxFrequency:12000});
  assert.ok(a.frames.every(v=>v===0));const data={...a,fps:30,duration:1,waveCount:64,waves:new Float32Array(30*64)};
  for(const style of ['wave','bars','line','mirror','circular','spectrum'])assert.ok(visual.row(data,.5,{...visual.defaults,style}).every(v=>v===0));
});
test('real FFT frequency regions distinguish low and high tone without random motion',()=>{
  const tone=hz=>Float32Array.from({length:24000},(_,i)=>Math.sin(2*Math.PI*hz*i/24000)*.2);
  const peak=hz=>{const a=analyze(tone(hz),24000,30,{barCount:128,minFrequency:20,maxFrequency:12000,smoothing:0});const row=a.frames.slice(20*128,21*128);return row.indexOf(Math.max(...row));};
  assert.ok(peak(440)<peak(4000));const a=analyze(tone(440),24000,30);assert.deepEqual(a.frames,analyze(tone(440),24000,30).frames);
});
test('visualizer validates finite bounded settings and source duration',()=>{
  visual.validate(visual.defaults);
  for(const change of [{minFrequency:2000,maxFrequency:100},{barCount:2},{barCount:8.5},{glow:Infinity},{color:'url(x)'},{style:'unknown'},{smoothing:1.2},{extra:1}])assert.throws(()=>visual.validate({...visual.defaults,...change}));
  const {h}=fixture(),p=h.state;p.media[0].duration=601;assert.throws(()=>validateProject(p),/10 minutes/);
});
test('visualizer timing and style edits undo atomically and reject invalid range',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'update',id,values:{duration:1,sourceStart:1,speed:2,startTime:3,visualizer:{style:'circular',sensitivity:2}}});const c=h.state.clips[0];assert.equal(c.sourceEnd,3);assert.equal(c.effects[0].parameters.style,'circular');
  const before=h.state;assert.throws(()=>applyCommand(h,{type:'update',id,values:{visualizer:{maxFrequency:10}}}));assert.deepEqual(h.state,before);h.undo();assert.equal(h.state.clips[0].effects[0].parameters.style,'bars');
});
test('render uses alpha overlay without duplicating audio or applying transforms twice',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'add',mediaId:'music'});applyCommand(h,{type:'update',id,values:{transform:{x:200,rotation:30}}});
  const assets=new Map([['music',{path:'D:/song.wav',type:'audio',hasAudio:true}]]);
  assert.throws(()=>renderPlan(h.state,assets,new Map()),/시각화 영상/);
  const plan=renderPlan(h.state,assets,new Map(),new Map([[id,'D:/layer.mov']]));assert.equal((plan.graph.match(/atempo=/g)||[]).length,1);assert.match(plan.graph,/overlay=x='0':y='0'/);assert.doesNotMatch(plan.graph,/rotate=/);assert.ok(plan.args.includes('D:/layer.mov'));
});
test('disabled visualizer needs no alpha layer and produces no duplicate audio',()=>{
  const {h}=fixture(),p=h.state;p.clips[0].effects[0].enabled=false;
  const plan=renderPlan(p,new Map([['music',{path:'D:/song.wav',type:'audio',hasAudio:true}]]),new Map());assert.match(plan.graph,/anullsrc/);assert.doesNotMatch(plan.graph,/overlay=/);
});
test('silent visualizer track solo cannot suppress the actual music track',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'add',mediaId:'music'});const p=h.state;p.tracks.find(t=>t.type==='overlay').solo=true;
  const plan=renderPlan(p,new Map([['music',{path:'D:/song.wav',type:'audio',hasAudio:true}]]),new Map(),new Map([[id,'D:/layer.mov']]));assert.match(plan.graph,/amix=inputs=1/);
});
test('splitting a visualizer preserves source continuity and settings without a fade',()=>{
  const {h,id}=fixture();const right=applyCommand(h,{type:'split',id,time:1.5}),[a,b]=h.state.clips;
  assert.equal(b.id,right);assert.equal(a.sourceEnd,b.sourceStart);assert.equal(a.duration+b.duration,4);assert.deepEqual(a.effects[0].parameters,b.effects[0].parameters);
  h.undo();assert.equal(h.state.clips.length,1);
});
