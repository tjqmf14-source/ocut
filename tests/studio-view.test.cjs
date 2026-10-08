const {test}=require('node:test'),assert=require('node:assert/strict');
const view=require('../src/core/studio-view.js');
test('ten-hour project fits narrow and wide timelines; ruler stays bounded and hours are readable',()=>{
  for(const width of [500,900,1700]){const z=view.fit(36000,width);assert.ok(36004*z<=width);assert.ok(width/z/view.rulerStep(z)<24);}
  assert.equal(view.timeLabel(36000),'10:00:00');assert.equal(view.timeLabel(3661),'1:01:01');
  assert.equal(view.timecode(32399.999999),'9:00:00.000');assert.equal(view.timecode(59.9999),'01:00.000');
  for(const z of [.005,.02,1,70,180])assert.ok(Math.abs(view.fromSlider(view.toSlider(z))-z)<1e-9);
  assert.equal(view.clampZoom(0),.005);assert.equal(view.clampZoom(Infinity),70);
});
test('music feedback distinguishes unknown duration, token estimate, actual synthesis steps and verification',()=>{
  assert.equal(view.musicProgress({stage:'load'}).percent,null);
  assert.equal(view.musicProgress({stage:'plan',progress:{tokens:30}}).percent,null);
  const semantic=view.musicProgress({stage:'semantic',seconds:420,progress:{tokens:5250}});assert.equal(semantic.percent,50);assert.match(semantic.detail,/추정/);
  assert.equal(view.musicProgress({stage:'semantic',seconds:20,progress:{tokens:900}}).percent,99);
  assert.equal(view.musicProgress({stage:'synth',progress:{step:4,steps:8}}).percent,50);
  assert.equal(view.musicProgress({stage:'synth',progress:{status:'done'}}).percent,100);
  assert.equal(view.musicProgress({stage:'decode',status:'checking',progress:{status:'done'}}).percent,null);
  assert.equal(view.musicProgress({stage:'synth',progress:{steps:0,step:4}}).percent,null);
});
