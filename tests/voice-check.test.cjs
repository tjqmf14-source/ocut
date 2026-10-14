'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto');
const {MODEL,POLICY,selection,starts,classify,validateResult,validateReport}=require('../src/core/voice-check.cjs');
const {readValidReport,scanGenerated,hashFile,signature}=require('../src/infrastructure/voice-check.cjs');
const window=(start=0,score=0,end=start+10)=>({start,end,speech:score,singing:0,humming:0});
function report(id){return {version:1,id,policy:POLICY,verdict:'not_detected',audioSha256:'a'.repeat(64),sourceSignature:[1,1,1,1,1],scannedAt:new Date().toISOString(),model:{...MODEL},duration:10,sampleRate:16000,coverage:{seconds:10,ratio:1,windowSeconds:10,strideSeconds:5},windows:[window()]};}
test('selected IDs are bounded, unique UUIDs and windows cover the final tail',()=>{
  const id=randomUUID();assert.deepEqual(selection([id]),[id]);for(const ids of [[],['../escape'],[id,id],Array.from({length:51},randomUUID)])assert.throws(()=>selection(ids));
  assert.deepEqual(starts(2),[0]);assert.deepEqual(starts(20),[0,5,10]);assert.deepEqual(starts(21),[0,5,10,11]);assert.throws(()=>starts(1801));
});
test('provisional policy retains uncertainty and excludes nonvoice labels',()=>{
  assert.equal(classify([window()]),'not_detected');assert.equal(classify([window(0,.5)]),'review');assert.equal(classify([window(0,.87)]),'review');assert.equal(classify([window(0,.97)]),'detected');assert.equal(classify([window(0,.86),window(5,.86)]),'detected');
  assert.equal(classify([{...window(),humming:.3}]),'review');assert.equal(classify([{...window(),singing:.98}]),'detected');assert.equal(classify([{...window(),bird:.99,singingBowl:.99}]),'not_detected');
});
test('response validation refuses partial coverage, invented scores, duration mismatch and nonfinite values',()=>{
  const value={duration:20,sampleRate:16000,windows:[window(),window(5),window(10)]};assert.ok(validateResult(value,20));
  for(const bad of [{...value,windows:value.windows.slice(1)},{...value,duration:30},{...value,sampleRate:44100},{...value,windows:[window(),window(7),window(10)]},{...value,windows:[window(0,NaN),window(5),window(10)]},{...value,windows:[window(0,1.1),window(5),window(10)]}])assert.throws(()=>validateResult(bad,20));
});
test('saved reports reject stale model identity, unsupported policy and forged verdict',()=>{
  const id=randomUUID(),r=report(id);assert.equal(validateReport(r,id),r);
  for(const bad of [{...r,version:2},{...r,model:{...MODEL,sha256:'b'.repeat(64)}},{...r,policy:'other'},{...r,verdict:'clean'},{...r,verdict:'detected'},{...r,coverage:{...r.coverage,ratio:.5}},{...r,audioSha256:'x'}])assert.throws(()=>validateReport(bad,id));
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ocut-voice-')),id=randomUUID(),song=path.join(root,id);await fs.mkdir(song);t.after(()=>fs.rm(root,{recursive:true,force:true}));const audio=path.join(song,'audio.wav');await fs.writeFile(audio,'original');await fs.writeFile(path.join(song,'job.json'),JSON.stringify({id,status:'complete'}));const r=report(id);r.audioSha256=createHash('sha256').update('original').digest('hex');r.sourceSignature=signature(await fs.stat(audio));await fs.writeFile(path.join(song,'voice-check.json'),JSON.stringify(r));return {root,id,song,audio,r};}
test('list reads a valid report and rejects changed audio, incomplete jobs and malformed JSON',async t=>{
  const f=await fixture(t);assert.equal((await readValidReport(f.root,f.id)).verdict,'not_detected');await fs.writeFile(f.audio,'modified');assert.equal(await readValidReport(f.root,f.id),null);
  await fs.writeFile(path.join(f.song,'voice-check.json'),'{');assert.equal(await readValidReport(f.root,f.id),null);assert.equal(await readValidReport(f.root,'../escape'),null);
  const g=await fixture(t);await fs.writeFile(path.join(g.song,'job.json'),JSON.stringify({id:g.id,status:'running'}));assert.equal(await readValidReport(g.root,g.id),null);
});
test('linked song folders, report links and hardlinked audio are never trusted',async t=>{
  const f=await fixture(t),linked=path.join(f.root,randomUUID());await fs.symlink(f.song,linked,'junction');assert.equal(await readValidReport(f.root,path.basename(linked)),null);await fs.unlink(linked);
  await fs.link(f.audio,path.join(f.root,'hardlink.wav'));assert.equal(await readValidReport(f.root,f.id),null);await assert.rejects(hashFile(f.audio),/연결/);
  const g=await fixture(t);await fs.unlink(path.join(g.song,'voice-check.json'));await fs.symlink(f.song,path.join(g.song,'voice-check.json'),'junction');assert.equal(await readValidReport(g.root,g.id),null);await fs.unlink(path.join(g.song,'voice-check.json'));
});
test('pre-cancelled batches return per-file errors without persistence or deletion',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();const result=await scanGenerated({directory:f.root,ids:[f.id],signal:controller.signal});assert.equal(result[0].verdict,'error');assert.match(result[0].message,/취소/);assert.equal(await fs.readFile(f.audio,'utf8'),'original');assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.song,'voice-check.json'),'utf8')),f.r);
});
test('missing runtime is a visible error, not an undetected or clean result',async t=>{
  const f=await fixture(t),result=await scanGenerated({directory:f.root,ids:[f.id],python:path.join(f.root,'missing.exe')});assert.equal(result[0].verdict,'error');assert.equal(await fs.readFile(f.audio,'utf8'),'original');
});
