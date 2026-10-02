'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{ProjectStore}=require('./project-store.cjs');
const recoveryName=value=>typeof value==='string'&&/^[a-f0-9-]{36}\.ocut$/.test(value);
class Workspace {
  constructor(directory,onChange){this.directory=path.resolve(directory);this.store=new ProjectStore(path.join(this.directory,'recovery'));this.name=randomUUID()+'.ocut';this.etag=null;this.restored=null;this.chain=Promise.resolve();this.pending=null;this.timer=null;this.signature='';this.onChange=onChange;this.status={state:'idle',savedAt:null,error:null};}
  changed(state,error=null,project){this.status={...this.status,state,savedAt:project?new Date().toISOString():this.status.savedAt,error,...(project?{projectId:project.id,revision:project.revision}:{})};this.onChange?.(this.status);}
  schedule(snapshot){
    if(!snapshot.dirty)return;const signature=snapshot.project.id+':'+snapshot.project.revision;if(signature===this.signature)return;
    this.signature=signature;const project=structuredClone(snapshot.project);
    if(snapshot.location)for(const media of project.media)if(!path.isAbsolute(media.path))media.path=path.resolve(path.dirname(snapshot.location),media.path);
    this.pending=project;this.changed('pending');if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(()=>{});},1000);this.timer.unref?.();}
  }
  async flush(){
    clearTimeout(this.timer);this.timer=null;const project=this.pending;this.pending=null;if(!project)return this.chain;
    const work=this.chain.then(async()=>{try{const result=await this.store.save(this.name,project,{expectedEtag:this.etag});this.etag=result.etag;this.changed(this.signature===project.id+':'+project.revision?'saved':'pending',null,project);}catch(error){this.signature='';this.changed('error',error.message);throw error;}});
    this.chain=work.catch(()=>{});return work;
  }
  async clear(){
    clearTimeout(this.timer);this.timer=null;this.pending=null;await this.chain;
    for(const record of [{name:this.name,etag:this.etag},this.restored].filter(Boolean)){
      let current;try{current=await this.store.open(record.name);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(current.etag!==record.etag)throw Error('복구 파일이 외부에서 변경되어 보존했습니다.');
      await fs.unlink(path.join(this.store.directory,record.name));
    }
    this.etag=null;this.restored=null;this.signature='';this.status={state:'idle',savedAt:null,error:null};this.onChange?.(this.status);
  }
  async recover(name){if(!recoveryName(name)||name===this.name)throw Error('복구 목록에서 프로젝트를 선택해 주세요.');const result=await this.store.open(name);return {...result,name};}
  async recent(){
    const file=path.join(this.directory,'recent.json'),stat=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!stat)return [];
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw Error('최근 프로젝트 기록을 읽을 수 없습니다.');
    const rows=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(rows)||rows.length>20||rows.some(r=>!r||typeof r.path!=='string'||!path.isAbsolute(r.path)||!r.path.toLowerCase().endsWith('.ocut')||typeof r.name!=='string'||r.name.length>200||!Number.isFinite(Date.parse(r.time))))throw Error('최근 프로젝트 기록이 손상되었습니다.');return rows;
  }
  async remember(file,name){
    const rows=await this.recent();await fs.mkdir(this.directory,{recursive:true});if((await fs.realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase())throw Error('최근 프로젝트 폴더는 링크일 수 없습니다.');
    const target=path.join(this.directory,'recent.json'),temp=path.join(this.directory,randomUUID()+'.tmp');
    const next=[{path:path.resolve(file),name,time:new Date().toISOString()},...rows.filter(r=>r.path.toLowerCase()!==file.toLowerCase())].slice(0,20);
    const handle=await fs.open(temp,'wx');try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}
    try{await fs.rename(temp,target);}finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async list(){
    const warnings=[],recovery=[];let recent=[];try{recent=await this.recent();}catch(error){warnings.push(error.message);}
    const files=await fs.readdir(this.store.directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const name of files.filter(n=>recoveryName(n)&&n!==this.name).slice(0,100))try{const {project}=await this.store.open(name);recovery.push({id:name,name:project.name,time:project.modifiedAt,clips:project.clips.length});}catch(error){warnings.push(`${name}: ${error.message}`);}
    recovery.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));if(files.length>100)warnings.push('복구 목록은 최대 100개까지 표시합니다. 다른 파일은 폴더에 보존되어 있습니다.');return {recent,recovery,warnings,autosave:this.status};
  }
}
module.exports={Workspace};
