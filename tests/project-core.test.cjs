const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const core=require('../dist/core/core/project.cjs');
const {ProjectHistory}=require('../dist/core/core/history.cjs');
const {ProjectStore}=require('../dist/core/infrastructure/project-store.cjs');
function fixture(){
  const p=core.createProject('테스트 프로젝트');
  const track=core.createTrack('audio','오디오');
  const media={id:randomUUID(),type:'audio',path:'media/song.wav',name:'song.wav',duration:10,fingerprint:null};
  p.tracks.push(track);p.media.push(media);
  p.clips.push(core.createClip({trackId:track.id,type:'audio',source:media.id,startTime:2,duration:4,sourceStart:1}));
  return p;
}
async function store(){const parent=path.join(root,'.runtime/phase1');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'case-'));return new ProjectStore(dir);}
test('built core equals current source',async()=>{
  for(const x of require('../evidence/phase1/build.json').files)assert.deepEqual(await fs.readFile(path.join(root,'src',x.file)),await fs.readFile(path.join(root,'dist/core',x.file)));
});
test('project JSON round-trip preserves media tracks and source range',()=>{const p=fixture();assert.deepEqual(core.deserialize(core.serialize(p)),p);});
test('reject unknown format version instead of lossy migration',()=>{const p=fixture();p.version=2;assert.throws(()=>core.validateProject(p),/version/);});
test('reject missing media reference',()=>{const p=fixture();p.media=[];assert.throws(()=>core.validateProject(p),/reference/);});
test('reject duplicate entity IDs',()=>{const p=fixture();p.clips[0].id=p.tracks[0].id;assert.throws(()=>core.validateProject(p),/duplicate/);});
test('reject clip source overrun and mismatched speed span',()=>{
  const p=fixture();p.clips[0].sourceEnd=11;assert.throws(()=>core.validateProject(p),/source span/);
  p.clips[0].duration=10;assert.throws(()=>core.validateProject(p),/exceeds source/);
});
test('reject NaN infinity and zero duration',()=>{for(const value of [NaN,Infinity,0,-1]){const p=fixture();p.clips[0].duration=value;assert.throws(()=>core.validateProject(p));}});
test('reject unsafe JSON object keys and unsupported fields',()=>{
  assert.throws(()=>core.deserialize('{"__proto__":{"polluted":true}}'),/unsafe/);assert.equal({}.polluted,undefined);
  const p=fixture();p.hiddenCode='eval';assert.throws(()=>core.validateProject(p),/unsupported/);
});
test('support source-free text and bounded keyframes',()=>{
  const p=fixture(),t=core.createTrack('text','제목');p.tracks.push(t);
  const c=core.createClip({trackId:t.id,type:'text',duration:5,text:'O-CUT'});c.keyframes.push({property:'opacity',time:0,value:0,interpolation:'linear'},{property:'opacity',time:1,value:1,interpolation:'linear'});p.clips.push(c);
  assert.equal(core.validateProject(p),p);c.keyframes[1].time=6;assert.throws(()=>core.validateProject(p),/keyframe time/);
});
test('undo redo round-trip and branching clear redo',()=>{
  const p=fixture(),h=new ProjectHistory(p);h.apply('rename',d=>{d.name='changed';});assert.equal(h.state.name,'changed');
  assert.equal(h.undo().name,p.name);assert.equal(h.redo().name,'changed');h.undo();h.apply('branch',d=>{d.name='new branch';});assert.equal(h.canRedo,false);assert.equal(h.state.revision,5);
});
test('failed edit and retained draft cannot mutate history',()=>{
  const h=new ProjectHistory(fixture());assert.throws(()=>h.apply('bad',d=>{d.clips[0].duration=-1;}));assert.equal(h.state.revision,0);assert.equal(h.canUndo,false);
  let draft;h.apply('valid',d=>{draft=d;d.name='safe';});draft.name='tampered';const exposed=h.state;exposed.name='tampered';assert.equal(h.state.name,'safe');
});
test('history is bounded and rejects async edits',()=>{
  const h=new ProjectHistory(fixture(),2);assert.throws(()=>h.apply('async',async()=>{}),/synchronous/);
  for(const n of ['a','b','c'])h.apply('rename',p=>{p.name=n;});h.undo();h.undo();assert.equal(h.state.name,'a');assert.equal(h.canUndo,false);
});
test('document identity remains stable through history edits',()=>{
  const h=new ProjectHistory(fixture());assert.throws(()=>h.apply('replace identity',p=>{p.id=randomUUID();}),/identity/);assert.equal(h.canUndo,false);
});
test('save open update enforces optimistic concurrency',async()=>{
  const s=await store(),p=fixture();const first=await s.save('document.ocut',p);assert.deepEqual((await s.open('document.ocut')).project,p);
  p.name='new';await assert.rejects(s.save('document.ocut',p),/changed/);const updated=await s.save('document.ocut',p,{expectedEtag:first.etag});assert.notEqual(updated.etag,first.etag);
  await assert.rejects(s.save('document.ocut',p,{expectedEtag:first.etag}),/changed/);assert.equal((await s.open('document.ocut')).project.name,'new');
});
test('invalid save preserves existing bytes and releases lock',async()=>{
  const s=await store(),p=fixture();const saved=await s.save('document.ocut',p);p.clips[0].duration=-1;
  await assert.rejects(s.save('document.ocut',p,{expectedEtag:saved.etag}));assert.equal((await s.open('document.ocut')).etag,saved.etag);
  assert.deepEqual(await fs.readdir(s.directory),['document.ocut']);
});
test('corrupt on-disk document is rejected and never silently overwritten',async()=>{
  const s=await store();await fs.writeFile(path.join(s.directory,'bad.ocut'),'{incomplete');await assert.rejects(s.open('bad.ocut'));await assert.rejects(s.save('bad.ocut',fixture()));assert.equal(await fs.readFile(path.join(s.directory,'bad.ocut'),'utf8'),'{incomplete');
});
test('traversal reserved filenames and alternate data streams are rejected',async()=>{
  const s=await store();for(const name of ['../escape.ocut','sub\\escape.ocut','C:\\escape.ocut','file:stream.ocut','NUL.ocut','file.json'])await assert.rejects(s.save(name,fixture()),/filename/);
});
test('existing lock prevents writes without stealing another writer lock',async()=>{
  const s=await store();await fs.writeFile(path.join(s.directory,'document.ocut.lock'),'other writer');await assert.rejects(s.save('document.ocut',fixture()),/locked/);assert.equal(await fs.readFile(path.join(s.directory,'document.ocut.lock'),'utf8'),'other writer');
});
test('simultaneous saves cannot both overwrite the same revision',async()=>{
  const s=await store(),p=fixture();const a=structuredClone(p),b=structuredClone(p);a.name='writer A';b.name='writer B';
  const results=await Promise.allSettled([s.save('document.ocut',a),s.save('document.ocut',b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.ok(['writer A','writer B'].includes((await s.open('document.ocut')).project.name));assert.deepEqual(await fs.readdir(s.directory),['document.ocut']);
});
test('autosave recovery preserves primary project and survives new service instance',async()=>{
  const s=await store(),p=fixture();const original=await s.save('document.ocut',p);p.name='unsaved changes';await s.autosave('document.ocut',p);
  const reopened=new ProjectStore(s.directory);assert.equal((await reopened.open('document.ocut')).etag,original.etag);assert.equal((await reopened.recover('document.ocut')).project.name,'unsaved changes');
});
test('reject non-regular project targets',async()=>{
  const s=await store();await fs.mkdir(path.join(s.directory,'directory.ocut'));await assert.rejects(s.open('directory.ocut'),/regular/);await assert.rejects(s.save('directory.ocut',fixture()),/regular/);
});
test('actual packaged Electron runtime saves and reopens core in separate processes',async()=>{
  const s=await store();const executable=path.join(root,'dist/baseline/O-CUT.exe');
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};
  const script="const {ProjectStore}=require(process.argv[1]);const {createProject}=require(process.argv[2]);const s=new ProjectStore(process.argv[3]);(async()=>{if(process.argv[4]==='write'){await s.save('electron.ocut',createProject('Electron project'));await s.autosave('electron.ocut',createProject('Recovered project'));}else{console.log(JSON.stringify({saved:(await s.open('electron.ocut')).project.name,recovered:(await s.recover('electron.ocut')).project.name,node:process.versions.node,electron:process.versions.electron}));}})().catch(e=>{console.error(e);process.exitCode=1;});";
  const args=['-e',script,path.join(root,'dist/core/infrastructure/project-store.cjs'),path.join(root,'dist/core/core/project.cjs'),s.directory];
  execFileSync(executable,[...args,'write'],{env,windowsHide:true,timeout:15000});
  const result=JSON.parse(execFileSync(executable,[...args,'read'],{env,encoding:'utf8',windowsHide:true,timeout:15000}));
  assert.equal(result.saved,'Electron project');assert.equal(result.recovered,'Recovered project');assert.equal(result.electron,'33.4.11');
  await fs.writeFile(path.join(root,'evidence/phase1/electron-storage-smoke.json'),JSON.stringify({time:new Date().toISOString(),result,directory:s.directory,mode:'ELECTRON_RUN_AS_NODE; storage runtime verification, not new UI verification'},null,2));
});
