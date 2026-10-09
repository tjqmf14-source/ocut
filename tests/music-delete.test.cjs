'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {inspectMusic,deleteMusic}=require('../src/infrastructure/music-delete.cjs');
const {mediaKey}=require('../src/infrastructure/media.cjs');
const {MusicQueue}=require('../src/infrastructure/music-queue.cjs');
async function fixture(t,status='complete'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ocut-delete-')),music=path.join(root,'music'),cache=path.join(root,'media-cache'),id=randomUUID(),song=path.join(music,id);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(song,'plan'),{recursive:true});await fs.mkdir(cache);
  await fs.writeFile(path.join(song,'job.json'),JSON.stringify({id,title:'삭제 대상',status,createdAt:new Date().toISOString()}));
  for(const name of ['audio.wav','worker.stderr.log','semantic.npy','latents.npy','job.json.tmp','plan/abc.txt'])await fs.writeFile(path.join(song,name),name);
  const key=mediaKey(await fs.realpath(path.join(song,'audio.wav')),await fs.stat(path.join(song,'audio.wav')));
  for(const suffix of ['.wave.json','.spectrum-v1.json'])await fs.writeFile(path.join(cache,key+suffix),'cache');
  await fs.writeFile(path.join(music,'settings.json'),'settings');await fs.writeFile(path.join(cache,'unrelated.wave.json'),'other');
  return {root,music,cache,id,song,key};
}
test('complete deletion removes nested generation junk and matching caches but preserves other songs/settings',async t=>{
  const f=await fixture(t),other=path.join(f.music,randomUUID());await fs.mkdir(other);await fs.writeFile(path.join(other,'audio.wav'),'keep');
  const plan=await inspectMusic(f.music,f.cache,f.id);assert.equal(plan.files.length,7);assert.equal(plan.cacheFiles.length,2);assert.ok(plan.bytes>0);
  const deleted=await deleteMusic(f.music,f.cache,plan);assert.equal(deleted.files,9);await assert.rejects(fs.stat(f.song),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(other,'audio.wav'),'utf8'),'keep');assert.equal(await fs.readFile(path.join(f.music,'settings.json'),'utf8'),'settings');assert.deepEqual(await fs.readdir(f.cache),['unrelated.wave.json']);
});
test('failed/cancelled/interrupted jobs can be deleted without an audio file',async t=>{
  for(const status of ['failed','cancelled','running']){const f=await fixture(t,status);await fs.unlink(path.join(f.song,'audio.wav'));const plan=await inspectMusic(f.music,f.cache,f.id);await deleteMusic(f.music,f.cache,plan);await assert.rejects(fs.stat(f.song),{code:'ENOENT'});}
});
test('invalid IDs, mismatched records and modified confirmation snapshots never delete files',async t=>{
  const f=await fixture(t);for(const id of ['../escape',f.song,{},'-'.repeat(36)])await assert.rejects(inspectMusic(f.music,f.cache,id));
  const plan=await inspectMusic(f.music,f.cache,f.id);await fs.writeFile(path.join(f.song,'new.tmp'),'changed');await assert.rejects(deleteMusic(f.music,f.cache,plan),/변경/);assert.ok(await fs.stat(path.join(f.song,'audio.wav')));
  await fs.writeFile(path.join(f.song,'job.json'),JSON.stringify({id:randomUUID(),title:'wrong',status:'complete'}));await assert.rejects(inspectMusic(f.music,f.cache,f.id),/기록/);
});
test('root and nested junctions and cache links are refused before any deletion',async t=>{
  const f=await fixture(t),outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'keep');
  const nested=path.join(f.song,'link');await fs.symlink(outside,nested,'junction');t.after(()=>fs.unlink(nested).catch(()=>{}));await assert.rejects(inspectMusic(f.music,f.cache,f.id),/연결/);await fs.unlink(nested);
  const linked=path.join(f.music,randomUUID());await fs.symlink(outside,linked,'junction');await assert.rejects(inspectMusic(f.music,f.cache,path.basename(linked)),/폴더/);await fs.unlink(linked);
  const c=path.join(f.cache,f.key+'.wave.json');await fs.unlink(c);await fs.symlink(outside,c,'junction');await assert.rejects(inspectMusic(f.music,f.cache,f.id),/연결/);await fs.unlink(c);
  assert.equal(await fs.readFile(path.join(outside,'keep'),'utf8'),'keep');assert.ok(await fs.stat(path.join(f.song,'audio.wav')));
});
test('partial filesystem failure is reported and record remains retryable',async t=>{
  const f=await fixture(t),plan=await inspectMusic(f.music,f.cache,f.id),original=fs.unlink;
  const mocked=t.mock.method(fs,'unlink',async file=>{if(file.endsWith('latents.npy'))throw Error('fixture locked');return original(file);});
  await assert.rejects(deleteMusic(f.music,f.cache,plan),/일부 파일/);mocked.mock.restore();assert.ok(await fs.stat(path.join(f.song,'job.json')));
  await deleteMusic(f.music,f.cache,await inspectMusic(f.music,f.cache,f.id));await assert.rejects(fs.stat(f.song),{code:'ENOENT'});
});
test('queue deletion guard blocks active, queued and closed work before executing destructive action',async t=>{
  const f=await fixture(t),engine={directory:f.music,current:null,state:async()=>({jobs:[]})},queue=new MusicQueue({engine});await queue.ready;let calls=0;
  engine.current={id:f.id};await assert.rejects(queue.deleteGenerated(f.id,()=>calls++));engine.current=null;
  queue.items=[{id:f.id}];await assert.rejects(queue.deleteGenerated(f.id,()=>calls++));queue.items=[];
  queue.closed=true;await assert.rejects(queue.deleteGenerated(f.id,()=>calls++));queue.closed=false;assert.equal(calls,0);
  await queue.deleteGenerated(f.id,()=>calls++);assert.equal(calls,1);
});
