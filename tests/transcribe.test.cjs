'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {request}=require('../src/infrastructure/transcribe.cjs');
const clip={source:'audio',duration:30,speed:1,effects:[]};
test('transcription validates language, device, duration and audio clip requirements',()=>{
  assert.deepEqual(request(clip,{language:'ko',device:'cpu'}),{language:'ko',device:'cpu'});
  for(const c of [{...clip,source:null},{...clip,duration:1801},{...clip,speed:5},{...clip,effects:[{type:'audioVisualizer'}]}])assert.throws(()=>request(c,{language:'auto',device:'auto'}));
  for(const v of [{language:'bad',device:'auto'},{language:'en',device:'remote'},null])assert.throws(()=>request(clip,v));
});
