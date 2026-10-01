'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Worker}=require('node:worker_threads');
const {tool,run}=require('./media.cjs');
async function analyzeVisual(asset,cacheDir){
  if(!asset.hasAudio||asset.duration>600)throw Error('시각화는 오디오가 있는 10분 이하 미디어를 지원합니다.');
  const target=path.join(cacheDir,asset.key+'.spectrum-v1.json');
  try{
    if((await fs.stat(target)).size>24*1024*1024)throw Error('oversized cache');
    const cached=JSON.parse(await fs.readFile(target,'utf8'));
    if(cached.version!==1||cached.fps!==30||!Number.isFinite(cached.duration)||Math.abs(cached.duration-asset.duration)>.1||cached.frameCount!==Math.ceil(cached.duration*30-1e-7)||cached.barCount!==128||cached.waveCount!==64)throw Error('invalid cache metadata');
    for(const [field,count,min] of [['frames',128,0],['waves',64,-1]]){
      const bytes=Buffer.from(cached[field],'base64');if(bytes.length!==cached.frameCount*count*4)throw Error('invalid cache size');
      for(let i=0;i<bytes.length;i+=4){const v=bytes.readFloatLE(i);if(!Number.isFinite(v)||v<min||v>1)throw Error('invalid cache samples');}
    }
    return cached;
  }catch{}
  const pcm=path.join(cacheDir,randomUUID()+'.f32');
  try{
    await run(tool('ffmpeg'),['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',asset.path,'-vn','-ac','1','-ar','24000','-t','600','-f','f32le','-y',pcm]);
    const data=await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'visualizer-worker.cjs'),{workerData:{file:pcm}});let result;
      const timer=setTimeout(()=>{worker.terminate();reject(Error('음원 분석 시간이 초과되었습니다.'));},120000);
      worker.on('message',value=>{result=value;});worker.on('error',reject);worker.on('exit',code=>{clearTimeout(timer);code===0&&result?resolve(result):reject(Error('음원 시각화 분석 실패'));});
    });
    const tmp=target+'.tmp';await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,target);return data;
  }finally{await fs.unlink(pcm).catch(()=>{});}
}
module.exports={analyzeVisual};
