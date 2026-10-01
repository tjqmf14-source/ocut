'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {request,MusicService}=require('../src/infrastructure/music.cjs');
const {createProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
const input={title:' 새 곡 ',style:' Piano ',lyrics:'',instrumental:true,seconds:20,quality:'draft',seed:42};
test('music requests validate limits, normalize text and preserve deterministic seed',()=>{
  assert.deepEqual(request(input),{...input,title:'새 곡',style:'Piano',lyrics:'[Instrumental]'});
  for(const change of [{seconds:100},{quality:'unknown'},{seed:-1},{seed:1.5},{seed:2**31},{title:''},{style:'x'.repeat(2001)},{instrumental:false},{instrumental:'false'},{lyrics:'x'.repeat(8001)}])assert.throws(()=>request({...input,...change}));
  assert.ok(Number.isInteger(request({...input,seed:''}).seed));
});
test('generated music adds media and a dedicated track as one undoable transaction',()=>{
  const h=new ProjectHistory(createProject()),before=h.state;
  const media={id:'song',type:'audio',name:'새 곡',path:'D:/song.wav',duration:20.019,fingerprint:null};
  const id=applyCommand(h,{type:'music',media});
  assert.equal(h.state.clips[0].id,id);assert.equal(h.state.clips[0].type,'music');assert.equal(h.state.clips[0].duration,20);
  h.undo();for(const key of ['media','tracks','clips'])assert.deepEqual(h.state[key],before[key]);h.redo();assert.equal(h.state.media.length,1);
  const saved=h.state;assert.throws(()=>applyCommand(h,{type:'music',media}));assert.deepEqual(h.state,saved);
});
test('music catalog recovers interrupted jobs and excludes malformed records',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocut-music-test-'));
  const service=new MusicService({directory:dir,workerPath:'missing'}),id='11111111-1111-1111-1111-111111111111';
  await service.persist({id,title:'중단된 곡',createdAt:new Date().toISOString(),status:'running'});
  assert.equal((await service.list())[0].status,'interrupted');
  await assert.rejects(service.audio('../escape'));await assert.rejects(service.audio(id),/완료된/);
  await service.persist({id,title:'불완전 기록',status:'complete'});assert.deepEqual(await service.list(),[]);
  await fs.rm(dir,{recursive:true});
});
test('missing worker cannot leave an active music job or change project state',async()=>{
  const service=new MusicService({directory:path.join(os.tmpdir(),'ocut-no-write'),workerPath:'missing-worker'});
  await assert.rejects(service.start(input),/먼저 연결/);assert.equal(service.current,null);
});
