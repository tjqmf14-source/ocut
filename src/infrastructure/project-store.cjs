'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {serialize,deserialize}=require('../core/project.cjs');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const MAX_BYTES=16*1024*1024;
class ProjectStore {
  constructor(directory){this.directory=path.resolve(directory);}
  async #target(name){
    if(typeof name!=='string'||!name.endsWith('.ocut')||/[\\/:\0]/.test(name)||name==='..'||name.length>180||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name))throw Error('Invalid project filename');
    await fs.mkdir(this.directory,{recursive:true});
    const canonical=await fs.realpath(this.directory);
    if(path.resolve(canonical).toLowerCase()!==this.directory.toLowerCase())throw Error('Project directory must not be a symlink or junction');
    const target=path.join(canonical,name);await this.#regular(target);return target;
  }
  async #regular(file){try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Project target must be a regular file');return s;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async #read(file){const s=await this.#regular(file);if(!s){const e=Error('Project not found');e.code='ENOENT';throw e;}if(s.size>MAX_BYTES)throw Error('Project exceeds 16 MiB');const raw=await fs.readFile(file,'utf8');return {project:deserialize(raw),etag:hash(raw)};}
  async open(name){return this.#read(await this.#target(name));}
  async save(name,project,{expectedEtag=null}={}){
    const raw=serialize(project);if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('Project exceeds 16 MiB');
    const target=await this.#target(name);const lock=target+'.lock';const temp=target+'.'+randomUUID()+'.tmp';
    let handle;
    try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Project is locked by another save or interrupted writer');throw e;}
    try{
      let current=null;try{current=await this.#read(target);}catch(e){if(e.code!=='ENOENT')throw e;}
      if((current?.etag||null)!==expectedEtag)throw Error('Project changed on disk; reopen before saving');
      const out=await fs.open(temp,'wx');try{await out.writeFile(raw,'utf8');await out.sync();}finally{await out.close();}
      await this.#regular(target);
      await fs.rename(temp,target);
      return {project:deserialize(raw),etag:hash(raw),path:target};
    }finally{
      try{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      finally{try{await handle.close();}finally{await fs.unlink(lock);}}
    }
  }
  async autosave(name,project){
    const recoveryName=name+'.recovery.ocut';
    // Validate the requested document name separately from its recovery filename.
    await this.#target(name);
    let etag=null;try{etag=(await this.open(recoveryName)).etag;}catch(e){if(e.code!=='ENOENT')throw e;}
    return this.save(recoveryName,project,{expectedEtag:etag});
  }
  async recover(name){await this.#target(name);return this.open(name+'.recovery.ocut');}
}
module.exports={ProjectStore};
