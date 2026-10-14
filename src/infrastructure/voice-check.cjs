'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {safeDirectory}=require('./updates.cjs');
const {inspectMusic}=require('./music-delete.cjs');
const {run,tool}=require('./media.cjs');
const {MODEL,POLICY,uuid,selection,validateResult,classify,validateReport}=require('../core/voice-check.cjs');
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function regular(file){await safeDirectory(path.dirname(file));const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('연결된 파일은 음성 검사에 사용할 수 없습니다.');return stat;}
async function hashFile(file){const before=signature(await regular(file)),hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);if(!same(before,signature(await regular(file))))throw Error('검사 중 원본 파일이 변경됐습니다.');return hash.digest('hex');}
async function verifyModel(model){
  if(typeof model!=='string'||!path.isAbsolute(model))throw Error('로컬 음성 검사 모델 폴더를 연결해 주세요.');
  await safeDirectory(model);
  const files={'model.safetensors':MODEL.sha256,'config.json':'a93d525511d77e8ecc933d09674b85099815bbbb417c228a4edd655e252fb9ff','preprocessor_config.json':'8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231'};
  for(const [file,expected] of Object.entries(files))if(await hashFile(path.join(model,file))!==expected)throw Error('음성 검사 모델의 원본 검증에 실패했습니다.');
  return {...MODEL};
}
async function sourceAt(directory,cacheDirectory,id){
  const plan=await inspectMusic(directory,cacheDirectory,id),job=JSON.parse(await fs.readFile(plan.record,'utf8'));
  if(job.status!=='complete')throw Error('생성이 완료된 음악만 검사할 수 있습니다.');
  const audio=path.join(plan.target,'audio.wav');await regular(audio);
  for(const declared of [job.audio,job.audioPath])if(declared!=null&&(typeof declared!=='string'||path.resolve(declared).toLowerCase()!==audio.toLowerCase()))throw Error('생성된 곡의 원본 음악 경로가 일치하지 않습니다.');
  return {target:plan.target,audio,signature:signature(await regular(audio)),recordHash:plan.recordHash};
}
async function durationAt(file,signal){const info=JSON.parse((await run(tool('ffprobe'),['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file],{signal,timeout:30000,maxBytes:1024*1024})).toString());const audio=info.streams?.find(s=>s.codec_type==='audio'),duration=Number(info.format?.duration||audio?.duration);if(!audio||!Number.isFinite(duration)||duration<=0||duration>1800)throw Error('오디오를 확인할 수 없거나 30분을 초과했습니다.');return duration;}
async function readValidReport(directory,id){
  try{
    if(!uuid(id))return null;const root=await safeDirectory(directory),song=path.join(root,id);await safeDirectory(song);
    const file=path.join(song,'voice-check.json');if((await regular(file)).size>1024*1024)return null;
    const report=validateReport(JSON.parse(await fs.readFile(file,'utf8')),id);
    const job=JSON.parse(await fs.readFile(path.join(song,'job.json'),'utf8'));if(job.id!==id||job.status!=='complete')return null;
    if(!same(report.sourceSignature,signature(await regular(path.join(song,'audio.wav')))))return null;
    return report;
  }catch{return null;}
}
function infer({python,model,workerPath,items,onProgress,signal,timeout=30*60*1000}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('음성 검사를 취소했습니다.'));
    const child=spawn(python,['-u',workerPath],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_DATASETS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
    const results=new Map(),allowed=new Set(items.map(item=>item.id));let buffer='',stderr='',failure,ready=false,bytes=0;
    const stop=error=>{if(!failure)failure=error;child.kill();};
    const cancel=()=>stop(Error('음성 검사를 취소했습니다.'));signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>stop(Error('음성 검사 시간이 초과됐습니다.')),Math.min(Math.max(timeout,100),30*60*1000));
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>8*1024*1024)return stop(Error('음성 검사 응답이 너무 큽니다.'));buffer+=chunk.toString();
      for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
        try{
          const item=JSON.parse(line);
          if(item.type==='ready'){if(ready||item.sha256!==MODEL.sha256)throw Error('음성 검사 모델 식별자가 올바르지 않습니다.');ready=true;}
          else if(item.type==='fatal')throw Error(typeof item.message==='string'?item.message:'음성 검사 엔진 실패');
          else {
            if(!ready||!allowed.has(item.id))throw Error('음성 검사 응답 ID가 올바르지 않습니다.');
            if(item.type==='progress'){
              if(!Number.isInteger(item.completedWindows)||!Number.isInteger(item.totalWindows)||item.completedWindows<1||item.totalWindows>360||item.completedWindows>item.totalWindows)throw Error('음성 검사 진행 정보가 올바르지 않습니다.');
              onProgress?.(item);
            }else if(item.type==='result'||item.type==='error'){
              if(results.has(item.id))throw Error('중복된 음성 검사 응답입니다.');
              results.set(item.id,item.type==='error'?{error:typeof item.message==='string'?item.message.slice(0,1000):'음성 검사 실패'}:item.value);
            }else throw Error('음성 검사 응답을 해석할 수 없습니다.');
          }
        }catch(error){stop(error);}
      }
    });
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    child.on('error',error=>{cleanup();reject(error);});
    child.on('close',code=>{cleanup();if(failure)return reject(failure);if(code!==0||!ready||buffer.trim())return reject(Error(`음성 검사 엔진 종료 오류 (${code}). ${stderr.slice(-1000)}`));resolve(results);});
    child.stdin.on('error',error=>stop(error));
    child.stdin.end(JSON.stringify({model,ffmpeg:tool('ffmpeg'),items:items.map(({id,file})=>({id,file}))})+'\n');
  });
}
async function scanGenerated({directory,cacheDirectory,ids,python,model,workerPath=path.join(__dirname,'voice-check.py'),onProgress,signal,timeout}={}){
  selection(ids);const reports=new Map(),items=[];
  const failed=(id,error)=>({version:1,id,verdict:'error',message:error.message||String(error)});
  const checkCancel=()=>{if(signal?.aborted)throw Error('음성 검사를 취소했습니다.');};
  try{
    checkCancel();if(typeof python!=='string'||!path.isAbsolute(python))throw Error('로컬 Python 실행 파일을 연결해 주세요.');await regular(python);await regular(workerPath);await verifyModel(model);checkCancel();
    for(const id of ids){
      try{checkCancel();const source=await sourceAt(directory,cacheDirectory,id),duration=await durationAt(source.audio,signal);const audioSha256=await hashFile(source.audio);if(!same(source.signature,signature(await regular(source.audio))))throw Error('검사 준비 중 음악이 변경됐습니다.');items.push({id,file:source.audio,source,duration,audioSha256});onProgress?.({type:'prepared',id});}
      catch(error){reports.set(id,failed(id,error));}
    }
    if(items.length){
      checkCancel();const results=await infer({python,model,workerPath,items,onProgress,signal,timeout});checkCancel();
      for(const item of items){
        try{
          checkCancel();const result=results.get(item.id);if(!result)throw Error('이 음악의 검사 결과가 없습니다.');if(result.error)throw Error(result.error);
          const value=validateResult(result,item.duration),after=await sourceAt(directory,cacheDirectory,item.id);
          if(!same(item.source.signature,after.signature)||item.source.recordHash!==after.recordHash||await hashFile(after.audio)!==item.audioSha256)throw Error('검사 중 원본 음악이 변경되어 결과를 저장하지 않았습니다.');
          const report={version:1,id:item.id,audioSha256:item.audioSha256,sourceSignature:after.signature,scannedAt:new Date().toISOString(),model:{...MODEL},policy:POLICY,verdict:classify(value.windows),...value,coverage:{seconds:value.duration,ratio:1,windowSeconds:10,strideSeconds:5}};validateReport(report,item.id);
          const target=path.join(after.target,'voice-check.json'),temporary=path.join(after.target,`voice-check-${randomUUID()}.tmp`);
          // Reject existing links before atomically replacing our own report.
          try{await regular(target);}catch(error){if(error.code!=='ENOENT')throw error;}
          await safeDirectory(after.target);await fs.writeFile(temporary,JSON.stringify(report,null,2),{flag:'wx'});
          try{checkCancel();if(!same(after.signature,signature(await regular(after.audio))))throw Error('저장 전에 원본 음악이 변경됐습니다.');await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
          reports.set(item.id,report);onProgress?.({type:'checked',id:item.id,verdict:report.verdict});
        }catch(error){reports.set(item.id,failed(item.id,error));}
      }
    }
  }catch(error){for(const id of ids)if(!reports.has(id))reports.set(id,failed(id,error));}
  return ids.map(id=>reports.get(id)||failed(id,Error('음성 검사를 완료하지 못했습니다.')));
}
module.exports={scanGenerated,readValidReport,verifyModel,hashFile,signature,infer};
