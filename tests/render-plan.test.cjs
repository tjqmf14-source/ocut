'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProject, createTrack, createClip } = require('../src/core/project.cjs');
const { renderPlan } = require('../src/core/render-plan.cjs');
function fixture() {
  const p = createProject(), t = createTrack('video'); p.tracks.push(t);
  p.media.push({ id: 'media', type: 'video', path: 'D:\\movie.mp4', name: 'movie', duration: 8, fingerprint: null });
  p.clips.push(createClip({ trackId: t.id, type: 'video', source: 'media', startTime: 2, duration: 2, sourceStart: 1, speed: 2 }));
  return { p, assets: new Map([['media', { path: 'D:\\movie.mp4', width: 1280, height: 720, hasAudio: true, type: 'video' }]]) };
}
test('render retains source trim, speed, placement and exact duration from project', () => {
  const { p, assets } = fixture(), plan = renderPlan(p, assets, new Map());
  assert.equal(plan.duration, 4); assert.match(plan.graph, /trim=start=1:end=5/);
  assert.match(plan.graph, /setpts=\(PTS-STARTPTS\)\/2\+2\/TB/); assert.match(plan.graph, /adelay=96000S/); assert.match(plan.graph, /atempo=2/);
});
test('hide does not mute, mute does not hide, solo excludes other tracks', () => {
  const { p, assets } = fixture(); p.tracks[0].hidden = true;
  let plan = renderPlan(p, assets, new Map()); assert.doesNotMatch(plan.graph, /overlay=/); assert.match(plan.graph, /amix/);
  p.tracks[0].hidden = false; p.tracks[0].muted = true;
  plan = renderPlan(p, assets, new Map()); assert.match(plan.graph, /overlay=/); assert.match(plan.graph, /anullsrc/);
  p.tracks[0].muted = false; const solo = createTrack('audio'); solo.solo = true; p.tracks.push(solo);
  assert.match(renderPlan(p, assets, new Map()).graph, /anullsrc/);
});
test('unsupported effects and missing sources cannot silently export', () => {
  const { p, assets } = fixture();
  assert.throws(() => renderPlan(p, new Map(), new Map()), /원본 미디어/);
  p.clips[0].keyframes = [{ property: 'opacity', time: 0, value: 0, interpolation: 'linear' }];
  assert.throws(() => renderPlan(p, assets, new Map()), /키프레임/);
  p.clips[0].keyframes=[];p.clips[0].effects.push({id:'unknown',type:'unimplemented',enabled:true,parameters:{}});assert.throws(()=>renderPlan(p,assets,new Map()),/지원하지 않는 효과/);
});

test('animated video has one baked visual input and one original audio input with volume envelope',()=>{
  const {p,assets}=fixture(),c=p.clips[0];c.volume=0;c.keyframes=[{property:'x',time:0,value:20,interpolation:'linear'},{property:'volume',time:0,value:1,interpolation:'linear'}];
  const plan=renderPlan(p,assets,new Map(),new Map([[c.id,'D:/animated.mov']]));assert.equal(plan.args.filter(v=>v==='-i').length,2);assert.ok(plan.args.includes('D:/animated.mov'));assert.match(plan.graph,/\[1:a:0\]atrim/);assert.match(plan.graph,/eval=frame:precision=double/);assert.match(plan.graph,/overlay=x='0':y='0'/);
});
test('render paints track order bottom to top and keeps source path in argument not graph', () => {
  const { p, assets } = fixture(), text = createTrack('text'); p.tracks.unshift(text);
  const c = createClip({ trackId: text.id, type: 'text', duration: 3, text: "한글: '; [bad] %" }); p.clips.push(c);
  const plan = renderPlan(p, assets, new Map([[c.id, 'D:\\text.png']]));
  assert.equal(plan.args.at(-1), 'D:\\text.png'); assert.doesNotMatch(plan.graph, /한글|movie\.mp4/); assert.match(plan.graph, /base1.*v1.*base2/s);
});
