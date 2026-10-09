'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {safeDirectory}=require('./updates.cjs');
const {mediaKey}=require('./media.cjs');
const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
async function regular(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('연결된 파일은 삭제하지 않습니다.');return stat;}
async function inspectMusic(directory,cacheDirectory,id){
  if(!uuid(id))throw Error('잘못된 음악 ID입니다.');
  const root=await safeDirectory(directory),target=path.resolve(root,id);
  if(path.dirname(target)!==root)throw Error('음악 삭제 경로가 올바르지 않습니다.');
  await safeDirectory(target);
  const record=path.join(target,'job.json'),recordStat=await regular(record);
  if(recordStat.size>1024*1024)throw Error('음악 기록이 너무 큽니다.');
  const bytes=await fs.readFile(record),job=JSON.parse(bytes.toString('utf8'));
  if(job.id!==id||typeof job.title!=='string'||!['complete','failed','cancelled','starting','running','checking','interrupted'].includes(job.status))throw Error('음악 생성 기록을 확인할 수 없어 삭제하지 않았습니다.');
  const files=[],directories=[];
  async function walk(folder){
    await safeDirectory(folder);
    for(const name of (await fs.readdir(folder)).sort()){
      const file=path.join(folder,name),stat=await fs.lstat(file);
      if(stat.isSymbolicLink())throw Error('곡 폴더에 연결된 파일 또는 폴더가 있어 삭제하지 않았습니다.');
      if(stat.isDirectory())await walk(file);
      else {if(!stat.isFile())throw Error('일반 파일이 아닌 항목은 삭제하지 않습니다.');files.push({file,signature:signature(stat),bytes:stat.size});}
    }
    directories.push(folder);
  }
  await walk(target);
  const cacheFiles=[],audio=path.join(target,'audio.wav');
  const stat=await fs.lstat(audio).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(stat){
    const key=mediaKey(await fs.realpath(audio),stat);
    const exists=await fs.lstat(cacheDirectory).catch(e=>{if(e.code!=='ENOENT')throw e;});
    if(exists){const cache=await safeDirectory(cacheDirectory);for(const suffix of ['.wave.json','.spectrum-v1.json','.png']){
      const file=path.join(cache,key+suffix),s=await fs.lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
      if(s){await regular(file);cacheFiles.push({file,signature:signature(s),bytes:s.size});}
    }}
  }
  const plan={id,title:job.title,target,record,files,cacheFiles,directories,recordHash:createHash('sha256').update(bytes).digest('hex')};
  return {...plan,bytes:[...files,...cacheFiles].reduce((n,f)=>n+f.bytes,0),fingerprint:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
async function deleteMusic(directory,cacheDirectory,expected){
  const plan=await inspectMusic(directory,cacheDirectory,expected.id);
  if(plan.fingerprint!==expected.fingerprint)throw Error('확인 중 곡 파일이 변경됐습니다. 삭제하지 않았습니다. 다시 확인해 주세요.');
  // Remove only verified files, never recursively traverse a computed path.
  // Keep job.json until the end so a partial failure remains visible and retryable.
  try{
    for(const entry of [...plan.cacheFiles,...plan.files.filter(f=>f.file!==plan.record),...plan.files.filter(f=>f.file===plan.record)]){
      await safeDirectory(path.dirname(entry.file));
      if(JSON.stringify(signature(await regular(entry.file)))!==JSON.stringify(entry.signature))throw Error('파일이 변경되었습니다.');
      await fs.unlink(entry.file);
    }
    for(const folder of plan.directories){await safeDirectory(folder);await fs.rmdir(folder);}
  }catch(error){throw Error(`완전 삭제를 마치지 못했습니다. 일부 파일이 남아 있을 수 있습니다: ${error.message}`);}
  return {id:plan.id,files:plan.files.length+plan.cacheFiles.length,bytes:plan.bytes};
}
module.exports={inspectMusic,deleteMusic};
