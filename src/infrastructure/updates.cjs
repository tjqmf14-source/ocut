'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function version(value){if(typeof value!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value))throw Error('업데이트 버전이 올바르지 않습니다.');return value.split('.').map(Number);}
function newer(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
async function regular(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('연결된 업데이트 파일은 사용할 수 없습니다.');return s;}
async function safeDirectory(directory){const absolute=path.resolve(directory);let cursor=absolute;for(;;){const s=await fs.lstat(cursor);if(!s.isDirectory()||s.isSymbolicLink())throw Error('연결된 업데이트 폴더는 사용할 수 없습니다.');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}if((await fs.realpath(absolute)).toLowerCase()!==absolute.toLowerCase())throw Error('업데이트 폴더 경로가 변경되었습니다.');return absolute;}
function contained(root,name){if(typeof name!=='string'||!name||name.includes('\\')||name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[ .]$/.test(part)))throw Error('잘못된 업데이트 파일 경로입니다.');const file=path.resolve(root,name);if(!file.toLowerCase().startsWith((path.resolve(root)+path.sep).toLowerCase()))throw Error('업데이트 경로가 폴더 밖입니다.');return file;}
function verifyFeed(envelope,key){
  if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>16384||typeof envelope.signature!=='string'||!crypto.verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')))throw Error('업데이트 서명을 확인할 수 없습니다.');
  const item=JSON.parse(envelope.payload);version(item.version);if(item.channel!=='local-development'||!path.isAbsolute(item.directory)||!/^\w:[\\/]/.test(item.directory)||!/^\w:[\\/]/.test(path.resolve(item.directory))||!/^[a-f0-9]{64}$/.test(item.manifestSha256)||!/^[a-f0-9]{64}$/.test(item.asarSha256))throw Error('업데이트 정보가 올바르지 않습니다.');return item;
}
async function manifestAt(directory,expected){
  await safeDirectory(directory);const file=path.join(directory,'UPDATE-MANIFEST.json');const stat=await regular(file);if(stat.size>1024*1024)throw Error('업데이트 파일 목록이 너무 큽니다.');const bytes=await fs.readFile(file);if(hash(bytes)!==expected.manifestSha256)throw Error('업데이트 파일 목록이 변경되었습니다.');const m=JSON.parse(bytes);
  if(m.version!==expected.version||m.asarSha256!==expected.asarSha256||!Array.isArray(m.files)||!m.files.length||m.files.length>1000)throw Error('업데이트 파일 목록이 올바르지 않습니다.');
  const names=new Set();let total=0;for(const entry of m.files){contained(directory,entry.file);if(names.has(entry.file.toLowerCase())||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('업데이트 파일 목록에 잘못된 항목이 있습니다.');names.add(entry.file.toLowerCase());total+=entry.bytes;}
  if(total>4*1024**3||!names.has('app/o-cut.exe')||!names.has('app/resources/app.asar')||!names.has('uninstall o-cut.exe'))throw Error('필수 업데이트 파일이 없습니다.');return {manifest:m,bytes};
}
async function copyVerified(source,target,item){
  const {manifest,bytes}=await manifestAt(source,item);
  for(const entry of manifest.files){const input=contained(source,entry.file),output=contained(target,entry.file);await safeDirectory(path.dirname(input));const stat=await regular(input);if(stat.size!==entry.bytes)throw Error('업데이트 파일 크기가 다릅니다.');await fs.mkdir(path.dirname(output),{recursive:true});await fs.copyFile(input,output,1);if(hash(await fs.readFile(output))!==entry.sha256)throw Error('업데이트 파일 검증에 실패했습니다.');}
  await fs.writeFile(path.join(target,'UPDATE-MANIFEST.json'),bytes,{flag:'wx'});return manifest;
}
class UpdateService {
  constructor({root,directory,version:current,feed,publicKey,onChange,executable}){this.root=path.resolve(root);this.executable=path.resolve(executable||path.join(root,'app/O-CUT.exe'));this.directory=directory;this.current=current;this.feed=feed;this.publicKey=publicKey;this.onChange=onChange;this.value={status:'idle',currentVersion:current,enabled:false,message:'업데이트 준비 중'};this.pending=null;this.busy=false;}
  state(){return {...this.value};}
  changed(values){Object.assign(this.value,values);this.onChange?.(this.state());return this.state();}
  async installed(){try{if(/^backup-/i.test(path.basename(this.root))||this.executable.toLowerCase()!==path.join(this.root,'app/O-CUT.exe').toLowerCase())return false;await safeDirectory(this.root);const ini=await fs.readFile(path.join(this.root,'ocut-install.ini'),'utf8');if(!/^id=studio\.ocut\.desktop\r?$/m.test(ini))return false;await regular(path.join(this.root,'app/O-CUT.exe'));return true;}catch{return false;}}
  async check(force=false){
    if(this.busy||this.pending)return this.state();this.busy=true;
    try{
      if(!await this.installed())return this.changed({status:'development',enabled:false,message:'개발 빌드 · 설치된 앱에서 자동 업데이트합니다.'});
      this.changed({status:'checking',enabled:true,message:'새 버전 확인 중'});await regular(this.feed);if((await fs.stat(this.feed)).size>32768)throw Error('업데이트 정보가 너무 큽니다.');
      const item=verifyFeed(JSON.parse(await fs.readFile(this.feed,'utf8')),this.publicKey);
      if(!newer(item.version,this.current))return this.changed({status:'current',message:`최신 버전 ${this.current}`});
      if(!force){let previous;try{previous=JSON.parse(await fs.readFile(path.join(this.directory,'result.json'),'utf8'));}catch{}if(previous?.version===item.version&&['failed','recovery_required'].includes(previous.status))return this.changed({status:'error',message:'이전 업데이트가 실패했습니다. 기존 버전을 유지했습니다. 다시 확인을 눌러 재시도하세요.'});}
      this.changed({status:'preparing',nextVersion:item.version,message:`${item.version} 업데이트 준비 중`});
      const stage=await fs.mkdtemp(path.join(this.root,'.ocut-update-'));await copyVerified(item.directory,stage,item);
      const ini=await fs.readFile(path.join(this.root,'ocut-install.ini'),'utf8');await fs.writeFile(path.join(stage,'ocut-install.ini'),ini.replace(/^version=.*$/m,`version=${item.version}`),{flag:'wx'});
      await fs.mkdir(this.directory,{recursive:true});await safeDirectory(this.directory);
      const helper=path.join(this.directory,'apply-update.ps1');await fs.writeFile(helper,await fs.readFile(path.join(__dirname,'apply-update.ps1')));
      const job={root:this.root,stage,version:item.version,manifestSha256:item.manifestSha256,asarSha256:item.asarSha256,result:path.join(this.directory,'result.json'),restart:false,waitSeconds:86400};
      const jobFile=path.join(this.directory,`job-${crypto.randomUUID()}.json`);await fs.writeFile(jobFile,JSON.stringify(job),{flag:'wx'});
      this.pending={job,jobFile,helper};return this.changed({status:'ready',message:`${item.version} 준비됨 · 앱 종료 후 자동 적용`});
    }catch(error){return this.changed({status:error.code==='ENOENT'?'waiting':'error',message:error.code==='ENOENT'?'새 빌드를 기다리는 중':error.message});}
    finally{this.busy=false;}
  }
  async schedule(restart=false){
    if(!this.pending)return false;const {job,jobFile,helper}=this.pending;await fs.writeFile(jobFile,JSON.stringify({...job,restart}));
    const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    // Start-Process gives the helper its own hidden console, surviving the app's
    // exit. Node's DETACHED_PROCESS flag can make Windows PowerShell exit early.
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const args=`-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${helper}" -JobFile "${jobFile}"`;
    const command=`$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(powershell)} -WindowStyle Hidden -ArgumentList ${quote(args)}`;
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('업데이트 도우미를 시작하지 못했습니다.')));});this.pending=null;this.changed({status:'scheduled',message:'앱 종료를 기다린 뒤 업데이트합니다.'});return true;
  }
}
module.exports={UpdateService,version,newer,verifyFeed,manifestAt,copyVerified,contained,safeDirectory,hash};
