'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {MusicQueue,batch}=require('../src/infrastructure/music-queue.cjs');
const input={title:'테스트 곡',style:'Piano',lyrics:'',instrumental:true,seconds:20,quality:'draft',seed:42};
async function until(predicate){const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('queue test timed out');await new Promise(r=>setTimeout(r,5));}}
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ocut-queue-'));
  const engine={directory,config:{},current:null,jobs:[],starts:[],running:0,maxRunning:0,
    async state(){return {config:this.config,current:this.current,jobs:structuredClone(this.jobs)};},
    async start(values,identity){assert.equal(this.running,0,'previous worker must be closed');this.running++;this.maxRunning=Math.max(this.running,this.maxRunning);this.current={...values,...identity,status:'running'};this.starts.push(identity.id);this.completion=new Promise(r=>this.finish=r);await this.persist(this.current);this.onChange?.();},
    async persist(job){await fs.mkdir(path.join(directory,job.id),{recursive:true});await fs.writeFile(path.join(directory,job.id,'job.json'),JSON.stringify(job));},
    async end(status='complete'){const job={...this.current,status,message:status};await this.persist(job);this.jobs.push(job);this.current=null;this.running--;this.finish(job);},
    cancel(){return this.end('cancelled');},dispose(){},async configure(){},check(){},audio(){}};
  const queue=new MusicQueue({engine});await queue.ready;t.after(async()=>{queue.dispose();await until(()=>!queue.pumping);await fs.rm(directory,{recursive:true,force:true});});return {queue,engine,directory};
}
test('batch validates count, titles and deterministic distinct wrapped seeds',()=>{
  const list=batch({...input,title:'x'.repeat(100),seed:2**31-1},3);assert.deepEqual(list.map(i=>i.input.seed),[2**31-1,0,1]);assert.equal(new Set(list.map(i=>i.id)).size,3);assert.equal(new Set(list.map(i=>i.batchId)).size,1);assert.ok(list.every(i=>i.input.title.length<=100));for(const n of [0,11,1.5,'2',null])assert.throws(()=>batch(input,n));
});
test('one start dispatches ten long-target songs sequentially with distinct seeds',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.start({...input,seconds:420},10);
  for(let i=0;i<10;i++){await until(()=>e.current);assert.equal(e.current.seconds,420);assert.equal(e.current.seed,(input.seed+i)%2**31);await e.end();}
  await until(()=>!q.pumping);assert.equal(e.starts.length,10);assert.equal(new Set(e.starts).size,10);assert.equal(e.maxRunning,1);assert.equal(q.items.length,0);assert.equal(q.paused,true);
});
test('FIFO waits for completion, pause retains next song and resume runs it once',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,2);const ids=q.items.map(i=>i.id);assert.equal(e.starts.length,0);await q.resume();await until(()=>e.current);await q.pause();await e.end();await until(()=>!q.pumping);assert.deepEqual(e.starts,[ids[0]]);assert.equal(q.items[0].id,ids[1]);await q.resume();await until(()=>e.current);await e.end();await until(()=>!q.pumping);assert.deepEqual(e.starts,ids);assert.equal(q.items.length,0);assert.equal(e.maxRunning,1);
});
test('cancel advances the queue but failed generation pauses the remaining songs',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,3);await q.resume();await until(()=>e.current);await e.cancel();await until(()=>e.starts.length===2);await e.end('failed');await until(()=>!q.pumping);assert.equal(q.paused,true);assert.equal(q.error,'failed');assert.equal(q.items.length,1);assert.equal(e.maxRunning,1);
});
test('restart preserves pending songs paused and never replays a dispatched job',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,3);const ids=q.items.map(i=>i.id);await e.persist({...q.items[0].input,id:ids[0],status:'running'});
  const restored=new MusicQueue({engine:e});await restored.ready;assert.equal(restored.paused,true);assert.deepEqual(restored.items.map(i=>i.id),ids.slice(1));assert.equal(e.starts.length,0);await assert.rejects(restored.start(input),/남은 대기열/);assert.equal(restored.items.length,2);restored.dispose();
});
test('removal and clear preserve the currently running worker and pause after it',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,3);await q.remove(q.items[1].id);assert.equal(q.items.length,2);await q.resume();await until(()=>e.current);await assert.rejects(q.remove(e.current.id),/진행 중인/);await q.clear();assert.equal(q.items.length,1);assert.ok(e.current);await e.end();await until(()=>!q.pumping);assert.equal(q.items.length,0);assert.equal(e.starts.length,1);
});
test('queue capacity is enforced atomically across concurrent additions',async t=>{
  const {queue:q}=await fixture(t);const results=await Promise.allSettled([q.enqueue(input,10),q.enqueue(input,10),q.enqueue(input,1)]);assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','rejected']);assert.equal(q.items.length,20);assert.equal(JSON.parse(await fs.readFile(q.file)).items.length,20);
});
test('file lock and external edit failures preserve memory and existing file bytes',async t=>{
  const {queue:q}=await fixture(t);await q.enqueue(input);const before=await fs.readFile(q.file);await fs.writeFile(q.file+'.lock','other writer');await assert.rejects(q.enqueue(input),/저장 중/);assert.deepEqual(await fs.readFile(q.file),before);assert.equal(q.items.length,1);await fs.unlink(q.file+'.lock');const external=Buffer.from('{"external":true}');await fs.writeFile(q.file,external);await assert.rejects(q.clear(),/외부에서 변경/);assert.deepEqual(await fs.readFile(q.file),external);assert.equal(q.items.length,1);
});
test('completed song is never regenerated when saving queue removal fails',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,2);const ids=q.items.map(i=>i.id);await q.resume();await until(()=>e.current);await fs.writeFile(q.file+'.lock','injected write failure');await e.end();await until(()=>!q.pumping);assert.equal(q.paused,true);assert.equal(q.items.length,2);assert.match(q.error,/저장 중/);await fs.unlink(q.file+'.lock');await q.resume();await until(()=>e.starts.length===2);assert.equal(e.current.id,ids[1]);await e.end();await until(()=>!q.pumping);assert.deepEqual(e.starts,ids);assert.equal(q.items.length,0);
});
test('malformed persisted input remains untouched and blocks execution',async t=>{
  const {queue:q,engine:e}=await fixture(t);const items=batch(input);items[0].input.seed='';const bytes=JSON.stringify({version:1,items});await fs.writeFile(q.file,bytes);const other=new MusicQueue({engine:e});await other.ready;assert.ok(other.loadError);await assert.rejects(other.resume(),/손상/);assert.equal(await fs.readFile(q.file,'utf8'),bytes);assert.equal(e.starts.length,0);other.dispose();
});
test('generation startup error keeps pending job available for explicit retry',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input);e.start=async()=>{throw Error('missing engine');};await q.resume();await until(()=>!q.pumping);assert.equal(q.paused,true);assert.equal(q.error,'missing engine');assert.equal(q.items.length,1);
});
test('transcription blocks resume and pauses between songs without dispatching',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.enqueue(input,2);q.canRun=()=>false;await assert.rejects(q.resume(),/자동 자막/);assert.equal(e.starts.length,0);q.canRun=()=>true;await q.resume();await until(()=>e.current);q.canRun=()=>false;await e.end();await until(()=>!q.pumping);assert.equal(q.items.length,1);assert.equal(q.paused,true);assert.equal(e.starts.length,1);
});
test('drained queue returns to paused so new reservations can be resumed from UI',async t=>{
  const {queue:q,engine:e}=await fixture(t);await q.start(input);await until(()=>e.current);await e.end();await until(()=>!q.pumping);assert.equal(q.paused,true);await q.enqueue(input);assert.equal(q.paused,true);assert.equal(e.starts.length,1);await q.resume();await until(()=>e.current);await e.end();await until(()=>!q.pumping);assert.equal(e.starts.length,2);
});
