'use strict';
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto'), { spawn } = require('node:child_process');
const { probe, run } = require('./media.cjs');
function request(values) {
  if (!values || typeof values !== 'object') throw Error('음악 생성 설정이 없습니다.');
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  const style = typeof values.style === 'string' ? values.style.trim() : '';
  const lyrics = typeof values.lyrics === 'string' ? values.lyrics.trim() : '';
  if (!title || title.length > 100 || !style || style.length > 2000 || lyrics.length > 8000) throw Error('제목 100자, 스타일 2000자, 가사 8000자 이내로 입력해 주세요.');
  if (![20,40,60,120,180,240,300,360,420].includes(values.seconds) || !['draft','standard'].includes(values.quality)) throw Error('지원하지 않는 음악 길이 또는 품질입니다.');
  if (typeof values.instrumental !== 'boolean') throw Error('연주곡 여부를 선택해 주세요.');
  const seed = values.seed === '' || values.seed == null ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw Error('시드는 0–2147483647의 정수여야 합니다.');
  if (!values.instrumental && !lyrics) throw Error('노래 가사를 입력하거나 연주곡을 선택해 주세요.');
  return { title, style, lyrics: values.instrumental ? '[Instrumental]' : lyrics, instrumental: Boolean(values.instrumental), seconds: values.seconds, quality: values.quality, seed };
}
class MusicService {
  constructor({ directory, workerPath, onChange }) {
    this.directory = directory; this.workerPath = workerPath; this.onChange = onChange; this.current = null; this.child = null;
    this.config = { python: process.env.OCUT_PYTHON || 'D:/ssokmusic/runtime/venv/Scripts/python.exe', models: process.env.OCUT_HF_HOME || 'D:/ssokmusic/models' };
    try { const saved = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8')); for (const key of ['python','models']) if (typeof saved[key] === 'string' && !process.env[key === 'python' ? 'OCUT_PYTHON' : 'OCUT_HF_HOME']) this.config[key] = saved[key]; } catch {}
  }
  async list() {
    const dirs = await fsp.readdir(this.directory, { withFileTypes: true }).catch(() => []), jobs = [];
    for (const dir of dirs) if (dir.isDirectory() && /^[\da-f-]{36}$/.test(dir.name)) {
      try { const job = JSON.parse(await fsp.readFile(path.join(this.directory, dir.name, 'job.json'), 'utf8'));
        if (job.id !== dir.name || typeof job.title !== 'string' || typeof job.createdAt !== 'string') continue;
        if (['starting','running','checking'].includes(job.status) && this.current?.id !== job.id) { job.status = 'interrupted'; job.message = '지난 실행 중 중단된 작업입니다.'; }
        jobs.push(job);
      } catch {}
    }
    return jobs.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,50);
  }
  async state() { return { config: this.config, configured: fs.existsSync(this.config.python) && fs.existsSync(this.config.models), current: this.current, jobs: await this.list() }; }
  async changed() { this.onChange?.(await this.state()); }
  async configure(key, file) {
    if (this.current) throw Error('생성이 끝난 뒤 실행 환경을 변경해 주세요.');
    if (!['python','models'].includes(key) || !path.isAbsolute(file)) throw Error('올바른 환경 경로를 선택해 주세요.');
    const stat = await fsp.stat(file);
    if (key === 'python' ? !stat.isFile() || path.basename(file).toLowerCase() !== 'python.exe' : !stat.isDirectory()) throw Error('Python 실행 파일 또는 모델 폴더를 선택해 주세요.');
    this.config[key] = await fsp.realpath(file); await fsp.mkdir(this.directory,{recursive:true});
    await fsp.writeFile(path.join(this.directory,'settings.json'),JSON.stringify(this.config,null,2)); return this.state();
  }
  async check() {
    const output = await run(this.config.python, ['-c', 'import json,torch,importlib.metadata;print(json.dumps({"cuda":torch.cuda.is_available(),"gpu":torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,"engine":importlib.metadata.version("yue2-infer")}))'], {timeout:60000});
    const result = JSON.parse(output.toString().trim().split(/\r?\n/).at(-1));
    return { ...result, models: fs.existsSync(this.config.models) };
  }
  async persist(job) {
    const dir = path.join(this.directory,job.id); await fsp.mkdir(dir,{recursive:true});
    const temporary = path.join(dir,'job.json.tmp'); await fsp.writeFile(temporary,JSON.stringify(job,null,2)); await fsp.rename(temporary,path.join(dir,'job.json'));
  }
  async start(values, identity = {}) {
    if (this.current) throw Error('진행 중인 음악 생성을 먼저 완료하거나 취소해 주세요.');
    const input = request(values);
    if (!fs.existsSync(this.config.python) || !fs.existsSync(this.config.models) || !fs.existsSync(this.workerPath)) throw Error('로컬 Python 환경과 YuE2 모델 폴더를 먼저 연결해 주세요.');
    if(identity.id && !/^[a-f0-9-]{36}$/.test(identity.id))throw Error('잘못된 생성 작업 ID입니다.');
    const job = { id: identity.id || randomUUID(), ...input, ...(identity.batchId?{batchId:identity.batchId}:{}), status:'starting', stage:'load', createdAt:new Date().toISOString(), message:'생성 엔진을 불러오고 있습니다.' };
    this.current = job;
    try { await this.persist(job); } catch (error) { this.current = null; throw error; }
    const outDir = path.join(this.directory,job.id), env = { ...process.env, HF_HOME:this.config.models, HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1', PYTHONDONTWRITEBYTECODE:'1', PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8' };
    const child = spawn(this.config.python,['-u',this.workerPath],{windowsHide:true,env,stdio:['pipe','pipe','pipe']}); this.child = child;
    const closed=new Promise(resolve=>child.once('close',resolve));
    let complete;this.completion=new Promise(resolve=>{complete=resolve;});
    let buffer = '', stderr = '', settled = false, sent = false, cancelled = false;
    const timeoutMinutes=input.seconds>60?90:30;
    const timeout = setTimeout(() => finish('failed',`생성이 ${timeoutMinutes}분을 초과해 중단했습니다.`),timeoutMinutes*60*1000);
    let cancelTimer;
    const finish = async (status, message, details = {}) => {
      if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(cancelTimer);
      try { child.stdin.end(JSON.stringify({cmd:'quit'})+'\n'); } catch {}
      child.kill(); await closed;this.child = null;
      Object.assign(job,details,{status,message,finishedAt:new Date().toISOString()});
      try { await fsp.writeFile(path.join(outDir,'worker.stderr.log'),stderr); await this.persist(job); }
      catch (error) { job.status='failed'; job.message=`작업 기록 저장 실패: ${error.message}`; }
      this.current = null; this.cancelCurrent = null;
      try{await this.changed();}finally{complete(structuredClone(job));}
    };
    this.cancelCurrent = () => {
      if (settled || cancelled) return; cancelled = true; job.message = '음악 생성을 취소하고 있습니다.';
      try { child.stdin.write(JSON.stringify({cmd:'cancel',jobId:job.id})+'\n'); } catch {}
      cancelTimer = setTimeout(() => finish('cancelled','음악 생성을 취소했습니다.'),5000); this.changed().catch(()=>{});
    };
    child.stdin.on('error', error => { if (!settled) finish(cancelled?'cancelled':'failed',error.message); });
    child.stderr.on('data',bytes => { stderr = (stderr+bytes.toString()).slice(-24000); });
    child.on('error',error => finish('failed',`생성 엔진 실행 실패: ${error.message}`));
    child.on('close',code => { if (!settled) finish(cancelled?'cancelled':'failed',cancelled?'음악 생성을 취소했습니다.':`생성 엔진이 종료됐습니다 (${code}). ${stderr.slice(-1200)}`); });
    const event = async item => {
      if (settled) return;
      if (item.type === 'ready' && !sent) {
        if (!item.cuda) return finish('failed','이 음악 엔진에는 CUDA를 지원하는 NVIDIA GPU가 필요합니다. 영상 편집은 계속 사용할 수 있습니다.');
        sent = true; job.gpu=item.gpu; job.status='running';
        child.stdin.write(JSON.stringify({cmd:'generate',jobId:job.id,outDir,id:'song',style:input.style,lyrics:input.lyrics,instrumental:input.instrumental,seed:input.seed,cot:input.quality==='draft'?'off':'full',targetSeconds:input.seconds,advanced:{maxTokens:Math.max(500,input.seconds*25),minTokens:input.seconds>60?input.seconds*25-1:200,abcMaxTokens:input.quality==='draft'?256:1024,odeSteps:input.quality==='draft'?8:32}})+'\n');
        if (cancelled) child.stdin.write(JSON.stringify({cmd:'cancel',jobId:job.id})+'\n');
      }
      if (item.jobId && item.jobId !== job.id) return;
      if (item.type==='stage' || item.type==='progress') { job.stage=item.stage; job.progress={step:item.step,steps:item.steps,tokens:item.tokens}; }
      if (item.type==='notice') job.message=String(item.message).slice(0,1000);
      if (item.type==='error') return finish(cancelled||item.cancelled?'cancelled':'failed',String(item.message || '음악 생성 실패'));
      if (item.type==='done') {
        if (cancelled) return finish('cancelled','음악 생성을 취소했습니다.');
        job.status='checking'; await this.changed();
        try {
          const audio=path.join(outDir,'audio.wav'); const info=await probe(audio);
          if (info.type!=='audio'||!info.hasAudio) throw Error('생성 음원을 읽을 수 없습니다.');
          if (cancelled) return finish('cancelled','음악 생성을 취소했습니다.');
          return finish('complete','음악을 생성했습니다.',{audio,duration:info.duration,meta:item.meta});
        } catch(error) { return finish('failed',error.message); }
      }
      await this.changed();
    };
    let events = Promise.resolve();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk => {
      buffer += chunk; if(buffer.length>1024*1024){finish('failed','생성 엔진 응답이 너무 큽니다.');return;}
      const lines=buffer.split(/\r?\n/);buffer=lines.pop();
      for(const line of lines){let item;try{item=JSON.parse(line);}catch{continue;}events=events.then(()=>event(item)).catch(error=>finish('failed',error.message));}
    });
    await this.changed(); return this.state();
  }
  cancel() { this.cancelCurrent?.(); }
  dispose() { this.cancel(); this.child?.kill(); }
  async audio(id) {
    if (typeof id!=='string'||!/^[\da-f-]{36}$/.test(id)) throw Error('잘못된 음악 ID입니다.');
    const job=JSON.parse(await fsp.readFile(path.join(this.directory,id,'job.json'),'utf8'));
    if(job.status!=='complete')throw Error('완료된 음악만 타임라인에 넣을 수 있습니다.');
    const dir=await fsp.realpath(path.join(this.directory,id)),audio=await fsp.realpath(path.join(dir,'audio.wav'));
    if(path.dirname(audio)!==dir)throw Error('음악 파일 경로가 올바르지 않습니다.');
    return {file:audio,title:job.title};
  }
}
module.exports={MusicService,request};
