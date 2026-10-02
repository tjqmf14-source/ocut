'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {run,tool}=require('./media.cjs');
async function defaultModel(){
  if(process.env.OCUT_STT_MODEL)return process.env.OCUT_STT_MODEL;
  const root=path.join(os.homedir(),'.cache/huggingface/hub/models--openai--whisper-base');
  try{const ref=(await fs.readFile(path.join(root,'refs/main'),'utf8')).trim();if(/^[a-f0-9]{40}$/.test(ref))return path.join(root,'snapshots',ref);}catch{}
  return '';
}
function request(clip,values){
  if(!clip?.source||clip.duration>1800||clip.speed<.25||clip.speed>4||clip.effects.some(e=>e.type==='audioVisualizer'))throw Error('30분 이하의 오디오가 있는 클립을 선택해 주세요.');
  if(!values||!['auto','ko','en','ja','zh'].includes(values.language)||!['auto','cpu'].includes(values.device))throw Error('음성 인식 언어와 장치를 확인해 주세요.');
  return {language:values.language,device:values.device};
}
async function transcribe({clip,asset,values,python,model,directory,onProgress,signal}){
  const options=request(clip,values);if(!asset?.hasAudio)throw Error('선택한 클립에 오디오가 없습니다.');
  if(!model||!path.isAbsolute(model))throw Error('로컬 Whisper 모델 폴더를 먼저 선택해 주세요.');
  for(const name of ['config.json','model.safetensors','preprocessor_config.json'])if(!(await fs.stat(path.join(model,name)).catch(()=>null))?.isFile())throw Error('Whisper 모델 파일이 없습니다. config.json과 model.safetensors가 있는 폴더를 선택해 주세요.');
  const dir=path.join(directory,'stt-'+randomUUID()),pcm=path.join(dir,'audio.f32');await fs.mkdir(dir,{recursive:true});
  const cancelled=()=>{if(signal?.aborted)throw Error('자동 자막 생성을 취소했습니다.');};
  const log={clipId:clip.id,options,model,startedAt:new Date().toISOString()};
  try{
    cancelled();onProgress?.('클립의 음성을 준비하고 있습니다.');
    let rate=clip.speed;const tempo=[];while(rate<.5){tempo.push('atempo=0.5');rate/=.5;}while(rate>2){tempo.push('atempo=2');rate/=2;}tempo.push('atempo='+rate);
    await run(tool('ffmpeg'),['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',asset.path,'-vn','-af',`atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},asetpts=PTS-STARTPTS,${tempo.join(',')}`,'-ac','1','-ar','16000','-t',String(clip.duration),'-f','f32le','-y',pcm],{signal});
    cancelled();
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(python,['-u',path.join(process.resourcesPath,'transcribe/transcribe.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
      let buffer='',stderr='',result,error;const cancel=()=>child.kill(),timer=setTimeout(()=>{error=Error('음성 인식 시간이 초과되었습니다.');child.kill();},20*60*1000);
      signal?.addEventListener('abort',cancel,{once:true});child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024){error=Error('음성 인식 응답이 너무 큽니다.');child.kill();return;}const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines){let item;try{item=JSON.parse(line);}catch{continue;}if(item.type==='stage')onProgress?.(item.message);if(item.type==='done')result=item;if(item.type==='error')error=Error(item.message);}});
      child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-16000);});child.stdin.on('error',e=>{error=e;});child.on('error',e=>{error=e;});
      child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);log.stderr=stderr;if(signal?.aborted)reject(Error('자동 자막 생성을 취소했습니다.'));else if(error||code!==0||!result)reject(error||Error(stderr||'음성 인식에 실패했습니다.'));else resolve(result);});
      child.stdin.end(JSON.stringify({pcm,model,...options})+'\n');if(signal?.aborted)cancel();
    });
    cancelled();
    if(!Array.isArray(result.segments)||!result.segments.length||result.segments.length>5000)throw Error('인식된 음성이 없습니다. 음성이 있는 클립을 선택해 주세요.');
    const segments=result.segments.map(s=>{
      if(!Number.isFinite(s.startTime)||!Number.isFinite(s.duration)||s.startTime<0||s.startTime>=clip.duration||s.duration<=0||s.startTime+s.duration>clip.duration+.1||typeof s.text!=='string'||!s.text.trim()||s.text.length>2000)throw Error('음성 인식의 시간 정보가 올바르지 않습니다.');
      return {...s,startTime:s.startTime+clip.startTime,duration:Math.min(s.duration,clip.duration-s.startTime)};
    });
    Object.assign(log,{status:'complete',device:result.device,segments});return segments;
  }catch(error){log.status=signal?.aborted?'cancelled':'failed';log.error=error.message;throw error;}
  finally{await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({...log,finishedAt:new Date().toISOString()},null,2));await fs.unlink(pcm).catch(()=>{});}
}
module.exports={defaultModel,request,transcribe};
