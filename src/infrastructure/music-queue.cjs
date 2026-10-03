'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {request}=require('./music.cjs');
const MAX_QUEUE=20,uuid=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s),digest=b=>b===null?null:createHash('sha256').update(b).digest('hex');
function batch(values,count=1){
  if(!Number.isInteger(count)||count<1||count>10)throw Error('한 번에 1–10곡을 추가할 수 있습니다.');
  const base=request(values),batchId=randomUUID();
  return Array.from({length:count},(_,i)=>({id:randomUUID(),batchId,createdAt:new Date().toISOString(),input:{...base,title:count===1?base.title:`${base.title.slice(0,90)} · ${i+1}/${count}`,seed:(base.seed+i)%2**31}}));
}
class MusicQueue {
  constructor({engine,onChange,canRun=()=>true}){
    this.engine=engine;this.onChange=onChange;this.canRun=canRun;this.items=[];this.paused=true;this.closed=false;this.error=null;this.activeId=null;this.pumping=false;this.serial=Promise.resolve();this.etag=null;
    this.file=path.join(engine.directory,'queue.json');this.ready=this.load().catch(error=>{this.error=error.message;this.loadError=error;});
    engine.onChange=()=>{this.changed().catch(()=>{});};
  }
  get current(){return this.engine.current;}
  get config(){return this.engine.config;}
  get occupied(){return Boolean(this.activeId||this.current||(!this.paused&&this.items.length));}
  async bytes(){
    let stat;try{stat=await fs.lstat(this.file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)throw Error('음악 대기열 파일을 읽을 수 없습니다.');
    return fs.readFile(this.file);
  }
  async load(){
    const bytes=await this.bytes();this.etag=digest(bytes);if(!bytes)return;
    const saved=JSON.parse(bytes.toString('utf8'));
    if(saved?.version!==1||!Array.isArray(saved.items)||saved.items.length>MAX_QUEUE)throw Error('음악 대기열 형식이 올바르지 않습니다.');
    const ids=new Set();for(const item of saved.items){if(!uuid(item.id)||!uuid(item.batchId)||ids.has(item.id)||!Number.isFinite(Date.parse(item.createdAt)))throw Error('음악 대기열 항목이 손상되었습니다.');ids.add(item.id);const normalized=request(item.input);if(Object.keys(normalized).some(k=>normalized[k]!==item.input[k]))throw Error('음악 대기열 설정이 손상되었습니다.');}
    this.items=saved.items;
    // A persisted engine job proves dispatch already happened. Never replay it after a crash.
    const waiting=[];for(const item of this.items)if(!await this.attempted(item))waiting.push(item);
    if(waiting.length!==this.items.length)await this.save(waiting);this.items=waiting;
  }
  async attempted(item){
    let record;try{record=JSON.parse(await fs.readFile(path.join(this.engine.directory,item.id,'job.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}
    if(record?.id!==item.id||!['starting','running','checking','complete','failed','cancelled'].includes(record.status))throw Error('이전 음악 생성 기록을 확인할 수 없습니다.');return true;
  }
  async save(items){
    const dir=path.dirname(this.file);await fs.mkdir(dir,{recursive:true});
    if((await fs.realpath(dir)).toLowerCase()!==path.resolve(dir).toLowerCase())throw Error('음악 대기열 폴더는 연결된 폴더일 수 없습니다.');
    const lock=await fs.open(this.file+'.lock','wx').catch(e=>{if(e.code==='EEXIST')throw Error('음악 대기열을 다른 작업이 저장 중입니다. 잠시 후 다시 시도해 주세요.');throw e;});
    const temp=this.file+'.'+randomUUID()+'.tmp';
    try{
      if(digest(await this.bytes())!==this.etag)throw Error('음악 대기열이 외부에서 변경되었습니다. 파일을 보존했습니다. 앱을 다시 열어 확인해 주세요.');
      const bytes=Buffer.from(JSON.stringify({version:1,items},null,2)),handle=await fs.open(temp,'wx');
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      if(digest(await this.bytes())!==this.etag)throw Error('저장 중 음악 대기열이 변경되었습니다.');
      await fs.rename(temp,this.file);this.etag=digest(bytes);
    }finally{await lock.close();await fs.unlink(this.file+'.lock');await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  mutate(action){const work=this.serial.then(async()=>{await this.ready;if(this.loadError)throw this.loadError;return action();});this.serial=work.catch(()=>{});return work;}
  async state(){await this.ready;return {...await this.engine.state(),queue:structuredClone(this.items.filter(i=>i.id!==this.activeId)),paused:this.paused,queueError:this.error,queueActive:this.activeId};}
  async changed(){this.onChange?.(await this.state());}
  async enqueue(values,count=1){
    const incoming=batch(values,count);
    await this.mutate(async()=>{if(this.closed)throw Error('앱이 종료 중입니다.');if(this.items.length+incoming.length>MAX_QUEUE)throw Error('진행 중인 곡을 포함해 최대 20곡까지 예약할 수 있습니다.');const next=[...this.items,...incoming];await this.save(next);this.items=next;this.error=null;});
    await this.changed();return this.state();
  }
  async start(values){
    await this.ready;
    if(this.occupied)throw Error('대기열이 진행 중입니다. 대기열에 추가해 주세요.');
    if(this.items.length)throw Error('남은 대기열을 재개하거나 비운 뒤 바로 생성해 주세요.');
    await this.enqueue(values,1);return this.resume();
  }
  async resume(){
    await this.mutate(async()=>{if(this.closed)throw Error('앱이 종료 중입니다.');if(!this.canRun())throw Error('자동 자막 작업이 끝난 뒤 음악 대기열을 재개해 주세요.');this.paused=false;this.error=null;});
    await this.changed();this.kick();return this.state();
  }
  async pause(){await this.mutate(()=>{this.paused=true;});await this.changed();return this.state();}
  async remove(id){
    await this.mutate(async()=>{if(id===this.activeId)throw Error('진행 중인 곡은 현재 생성 취소를 사용해 주세요.');if(!this.items.some(i=>i.id===id))throw Error('대기 중인 곡이 없습니다.');const next=this.items.filter(i=>i.id!==id);await this.save(next);this.items=next;});await this.changed();return this.state();
  }
  async clear(){
    await this.mutate(async()=>{const next=this.items.filter(i=>i.id===this.activeId);await this.save(next);this.items=next;this.paused=true;});await this.changed();return this.state();
  }
  async pump(){
    if(this.pumping||this.closed)return;this.pumping=true;
    try{while(!this.closed){
      const item=await this.mutate(async()=>{if(this.paused)return null;if(!this.items.length){this.paused=true;return null;}if(!this.canRun()){this.paused=true;this.error='자동 자막 작업 후 대기열을 재개해 주세요.';return null;}
        // A previous completion may have failed to save the shortened queue. Reconcile before dispatch.
        while(this.items.length&&await this.attempted(this.items[0])){const rest=this.items.slice(1);await this.save(rest);this.items=rest;}
        const next=this.items[0];if(next)this.activeId=next.id;else this.paused=true;return next;});if(!item)break;
      let result;
      try{await this.engine.start(item.input,{id:item.id,batchId:item.batchId});result=await this.engine.completion;}
      catch(error){this.paused=true;this.error=error.message;break;}
      await this.mutate(async()=>{const next=this.items.filter(i=>i.id!==item.id);await this.save(next);this.items=next;this.activeId=null;if(!next.length)this.paused=true;if(result.status==='failed'){this.paused=true;this.error=result.message;}});
      await this.changed();
    }}catch(error){this.paused=true;this.error=error.message;}
    finally{this.activeId=null;this.pumping=false;await this.changed();if(!this.paused&&this.items.length&&!this.closed)this.kick();}
  }
  kick(){this.pump().catch(error=>{this.paused=true;this.error=error.message;});}
  cancel(){this.engine.cancel();}
  async configure(key,file){await this.ready;if(this.occupied)throw Error('대기열을 일시 정지하고 현재 생성이 끝난 뒤 환경을 변경해 주세요.');return this.engine.configure(key,file).then(()=>this.state());}
  check(){return this.engine.check();}
  audio(id){return this.engine.audio(id);}
  dispose(){this.closed=true;this.paused=true;this.engine.dispose();}
}
module.exports={MusicQueue,batch,MAX_QUEUE};
