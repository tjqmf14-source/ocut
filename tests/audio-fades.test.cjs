'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProject,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
const {gain,lengths}=require('../src/core/audio-fades.js'),{renderPlan}=require('../src/core/render-plan.cjs');
function fixture(){const h=new ProjectHistory(createProject());const id=applyCommand(h,{type:'music',media:{id:'song',type:'audio',name:'song',path:'D:/song.wav',duration:10,fingerprint:null}});return {h,id};}
test('fade preview gain follows linear envelopes including overlapping fades',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'update',id,values:{audioFade:{fadeIn:8,fadeOut:8}}});const c=h.state.clips[0];
  assert.equal(gain(c,0),0);assert.equal(gain(c,2),.25);assert.equal(gain(c,5),.390625);assert.equal(gain(c,9),.125);assert.equal(gain(c,10),0);
});
test('trim clamps fades, undo restores edit and zero removes fade for splitting',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'update',id,values:{audioFade:{fadeIn:8,fadeOut:2}}});
  applyCommand(h,{type:'update',id,values:{duration:3}});assert.deepEqual(lengths(h.state.clips[0]),{fadeIn:3,fadeOut:2});h.undo();assert.equal(h.state.clips[0].duration,10);
  assert.throws(()=>applyCommand(h,{type:'split',id,time:5}),/효과/);
  applyCommand(h,{type:'update',id,values:{audioFade:{fadeIn:0,fadeOut:0}}});applyCommand(h,{type:'split',id,time:5});assert.equal(h.state.clips.length,2);
});
test('fade rejects malicious, negative, duplicate and non-audio parameters atomically',()=>{
  const {h,id}=fixture(),before=h.state;
  for(const value of [{fadeIn:-1,fadeOut:0},{fadeIn:'1;bad',fadeOut:0},{fadeIn:Infinity,fadeOut:0},{fadeIn:1,fadeOut:0,extra:1}]){assert.throws(()=>applyCommand(h,{type:'update',id,values:{audioFade:value}}));assert.deepEqual(h.state,before);}
  applyCommand(h,{type:'update',id,values:{audioFade:{fadeIn:1,fadeOut:2}}});const p=h.state;p.clips[0].effects.push({...p.clips[0].effects[0],id:'another'});assert.throws(()=>validateProject(p),/duplicate audio fade/);
  const title=applyCommand(h,{type:'text'});assert.throws(()=>applyCommand(h,{type:'update',id:title,values:{audioFade:{fadeIn:1,fadeOut:1}}}),/requires audio/);
});
test('render fades run after speed and before timeline delay with same clamped durations',()=>{
  const {h,id}=fixture();applyCommand(h,{type:'update',id,values:{duration:4,speed:2,startTime:3,audioFade:{fadeIn:1,fadeOut:2}}});
  const graph=renderPlan(h.state,new Map([['song',{type:'audio',path:'D:/song.wav',hasAudio:true}]]),new Map()).graph;
  assert.match(graph,/atempo=2,volume=1,afade=t=in:st=0:d=1:curve=tri,afade=t=out:st=2:d=2:curve=tri,aresample=48000,adelay=144000S/);
});
