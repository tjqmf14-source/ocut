'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{Workspace}=require('../src/infrastructure/workspace.cjs'),{StudioSession}=require('../src/desktop/session.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocut-recovery-'));return {dir,workspace:new Workspace(dir),session:new StudioSession()};}
test('automatic recovery stores latest immutable edit separately and a fresh instance can read it',async()=>{
  const {dir,workspace:w,session:s}=await fixture();const id=applyCommand(s.history,{type:'text',text:'첫 편집'});w.schedule(s.snapshot());applyCommand(s.history,{type:'update',id,values:{text:'마지막 편집'}});w.schedule(s.snapshot());await w.flush();assert.equal(w.status.state,'saved');assert.equal(w.status.revision,s.snapshot().project.revision);
  const next=new Workspace(dir),listing=await next.list();assert.equal(listing.recovery.length,1);const recovered=await next.recover(listing.recovery[0].id);assert.deepEqual(recovered.project,s.snapshot().project);const newSession=new StudioSession();newSession.restore(recovered.project);assert.equal(newSession.snapshot().dirty,true);assert.equal(newSession.location,null);
});
test('successful manual save clears owned and selected recovery copies but preserves another instance',async()=>{
  const {dir,workspace:w,session:s}=await fixture();applyCommand(s.history,{type:'text'});w.schedule(s.snapshot());await w.flush();const next=new Workspace(dir),third=new Workspace(dir);third.schedule(s.snapshot());await third.flush();const recovered=await next.recover(w.name);next.restored={name:recovered.name,etag:recovered.etag};next.schedule(s.snapshot());await next.flush();await next.clear();assert.equal((await next.list()).recovery.length,1);assert.equal((await next.list()).recovery[0].id,third.name);
});
test('clear preserves externally changed recovery instead of deleting it',async()=>{
  const {workspace:w,session:s}=await fixture();applyCommand(s.history,{type:'text'});w.schedule(s.snapshot());await w.flush();const file=path.join(w.store.directory,w.name),p=JSON.parse(await fs.readFile(file,'utf8'));p.name='외부 수정';await fs.writeFile(file,JSON.stringify(p));await assert.rejects(w.clear(),/외부에서 변경/);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).name,'외부 수정');
});
test('recovery path traversal and corrupt candidate fail without hiding valid backups',async()=>{
  const {workspace:w,session:s}=await fixture();await assert.rejects(w.recover('../private.ocut'));applyCommand(s.history,{type:'text'});w.schedule(s.snapshot());await w.flush();await fs.writeFile(path.join(w.store.directory,'11111111-1111-1111-1111-111111111111.ocut'),'broken');const next=new Workspace(w.directory),list=await next.list();assert.equal(list.recovery.length,1);assert.equal(list.warnings.length,1);
});
test('recent list is bounded deduplicated persisted and reports corruption',async()=>{
  const {dir,workspace:w}=await fixture();for(let i=0;i<22;i++)await w.remember(path.join(dir,i+'.ocut'),'프로젝트 '+i);await w.remember(path.join(dir,'20.ocut'),'최근 편집');const list=await w.recent();assert.equal(list.length,20);assert.equal(list[0].name,'최근 편집');assert.equal(list.filter(r=>r.path===path.join(dir,'20.ocut')).length,1);await fs.writeFile(path.join(dir,'recent.json'),'broken');await assert.rejects(w.recent());assert.equal((await w.list()).warnings.length,1);
});
test('recovery resolves relative source paths against original project directory',async()=>{
  const {dir,workspace:w,session:s}=await fixture();s.location=path.join(dir,'project.ocut');s.history.apply('media',p=>p.media.push({id:'m',type:'image',path:'photos/a.png',name:'a',duration:null,fingerprint:null}));w.schedule(s.snapshot());await w.flush();const next=new Workspace(dir),r=await next.recover(w.name);assert.equal(r.project.media[0].path,path.join(dir,'photos/a.png'));
});
