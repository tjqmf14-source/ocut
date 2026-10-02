'use strict';
const {spawn}=require('node:child_process'),{tool}=require('./media.cjs');
async function visualizerVideo({clip,canvas,output,target,image,signal,onProgress}){
  if(signal?.aborted)throw Error('내보내기를 취소했습니다.');
  const child=spawn(tool('ffmpeg'),['-v','error','-nostdin','-y','-f','image2pipe','-framerate',String(output.fps),'-c:v','png','-i','pipe:0','-an','-c:v','qtrle','-pix_fmt','argb','-threads','2',target],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let error='',failure;child.stderr.on('data',b=>{error=(error+b.toString()).slice(-6000);});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>signal?.aborted?reject(Error('내보내기를 취소했습니다.')):code===0?resolve():reject(Error(error||'시각화 영상 생성 실패')));});
  done.catch(e=>{failure=e;});child.stdin.on('error',e=>{failure=e;});
  const cancel=()=>child.kill();signal?.addEventListener('abort',cancel,{once:true});
  try{
    const total=Math.ceil(clip.duration*output.fps-1e-7);
    for(let frame=0;frame<total;frame++){
      if(signal?.aborted)throw Error('내보내기를 취소했습니다.');if(failure)throw failure;
      const data=await image(clip,canvas,output,clip.startTime+frame/output.fps);
      if(signal?.aborted)throw Error('내보내기를 취소했습니다.');
      if(typeof data!=='string'||!data.startsWith('data:image/png;base64,')||data.length>48*1024*1024)throw Error('애니메이션 프레임 생성 실패');
      await new Promise((resolve,reject)=>child.stdin.write(Buffer.from(data.split(',')[1],'base64'),err=>err?reject(err):resolve()));
      onProgress?.((frame+1)/total);
    }
    child.stdin.end();await done;
  }catch(error){if(signal?.aborted)throw Error('내보내기를 취소했습니다.');throw error;}
  finally{signal?.removeEventListener('abort',cancel);child.kill();await done.catch(()=>{});}
}
module.exports={visualizerVideo};
