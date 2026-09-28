const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const analysis = require('../baseline/electron/spectrum-analysis');
const midi = require('../baseline/electron/midi');
const video = require('../baseline/electron/video');
test('built ASAR contains the current baseline source bytes', async () => {
  const {extractFile}=await import('@electron/asar');
  const path=require('node:path');
  for(const f of require('../evidence/phase0/source-manifest.json')) {
    assert.deepEqual(extractFile(path.join(__dirname,'../dist/baseline/resources/app.asar'),f.path),fs.readFileSync(path.join(__dirname,'../baseline',f.path)));
  }
});

test('all recovered source bytes match ASAR integrity manifest', () => {
  const manifest = require('../evidence/phase0/source-manifest.json');
  assert.equal(manifest.length, 21);
  for (const file of manifest) {
    const data = fs.readFileSync(require('node:path').join(__dirname, '../original/source', file.path));
    assert.equal(data.length, file.size);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), file.sha256);
  }
});
test('spectrum of digital silence remains zero', () => {
  const r = analysis.analyze(new Float32Array(48000), 48000, 30);
  assert.equal(r.frameCount, 30);
  assert.ok(r.frames.every(x => x === 0));
});
test('FFT responds to real samples and is deterministic', () => {
  const samples = Float32Array.from({length:48000}, (_,i)=>Math.sin(i*2*Math.PI*440/48000)*0.7);
  const a = analysis.analyze(samples,48000,60);
  const b = analysis.analyze(samples,48000,60);
  assert.equal(a.frameCount,60);
  assert.deepEqual(a.frames,b.frames);
  assert.ok(a.frames.some(x=>x>0.5));
  assert.ok(a.frames.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
});
test('frame/time boundaries do not add a rounding frame', () => {
  for(const fps of [30,60]) for(const frame of [0,1,29,300,10001]) {
    assert.equal(analysis.frameAt(analysis.timeOf(frame,fps),fps),frame);
    assert.ok(analysis.frameTotal(frame/fps,fps) === frame, 'same numeric frame count (signed zero is equivalent)');
  }
});
test('invalid MIDI is rejected', () => assert.throws(()=>midi.parseMidi(Buffer.from('not a midi file'))));
test('MIDI melody converts to valid ABC through recovered Python validator', () => {
  const track=Buffer.from([0,0x90,60,100,0x83,0x60,0x80,60,0,0,0x90,64,100,0x83,0x60,0x80,64,0,0,0x90,67,100,0x83,0x60,0x80,67,0,0,0xff,0x2f,0]);
  const size=Buffer.alloc(4);size.writeUInt32BE(track.length);
  const input=Buffer.concat([Buffer.from('4d546864000000060000000101e04d54726b','hex'),size,track]);
  const parsed=midi.parseMidi(input);const parts=midi.partsOf(parsed);
  assert.equal(parts.length,1);assert.equal(parts[0].count,3);
  const converted=midi.midiToAbc(parsed,{ins:parts[0].id,chords:false});
  const result=JSON.parse(require('node:child_process').execFileSync(process.env.OCUT_PYTHON || 'D:/ssokmusic/runtime/venv/Scripts/python.exe',[require('node:path').join(__dirname,'../baseline/python/abc_check.py')],{input:converted.abc,encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'}}));
  assert.equal(result.ok,true);assert.equal(result.insNotes,3);assert.ok(result.seconds>0);
});
test('render plan preserves resolution frame rate and repeat length', () => {
  const p = video.planRender({cycle:{fps:60,frameCount:120},video:{resolution:'2160p',spectrum:{visible:true},length:{mode:'repeat',count:3}}});
  assert.equal(p.width,3840); assert.equal(p.height,2160); assert.equal(p.fps,60);
  assert.equal(p.target,6); assert.equal(p.expectedFrames,360); assert.equal(p.renderFrames,120);
});
test('upstream updater cannot download or execute an installer', async () => {
  const updater = require('../baseline/electron/app-update');
  assert.equal(await updater.check(),null);
  assert.equal((await updater.download('https://example.invalid/installer.exe')).ok,false);
  assert.equal((await updater.run('ignored.exe')).ok,false);
});
