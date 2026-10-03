'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const buildInputs=Object.fromEntries(['scripts/build-installer.cjs','packaging/installer.nsi','packaging/NOTICE.ko.txt'].map(f=>[f,hash(path.join(root,f))]));
const run=(file,args)=>execFileSync(file,args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,encoding:'utf8'});
const version='0.10.0',gate=JSON.parse(fs.readFileSync(path.join(root,'evidence/studio/gate.json')));
function tree(dir,base=dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Package symlink rejected');return e.isDirectory()?tree(p,base):[path.relative(base,p)];});}
const nsis=process.env.OCUT_MAKENSIS||path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
const rcedit=process.env.OCUT_RCEDIT||path.join(root,'.runtime/build-tools/rcedit-x64-2.0.0.exe');
if(hash(rcedit)!=='3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a')throw Error('RCEdit pinned digest mismatch');
if(hash(nsis)!=='e277b7378931b74392015f5ad6b1d744dcd8a347baa4480350a75ebeab8d8e3d')throw Error('NSIS pinned compiler digest mismatch');
if(hash(path.join(root,'dist/studio/resources/app.asar'))!==gate.asarSha256||gate.checks.some(c=>c.exitCode!==0))throw Error('Build must match successful studio gate');
for(const f of gate.build.files)if(hash(path.join(root,'src',f.file))!==f.sha256)throw Error('Changed source since gate: '+f.file);
const stage=fs.mkdtempSync(path.join(root,'.runtime/release-')),payload=path.join(stage,'payload');fs.mkdirSync(payload);
for(const original of fs.readdirSync(path.join(root,'original/extracted')))if(original!=='resources'){
  const e=original==='ssokMusic Free.exe'?'O-CUT.exe':original;
  fs.cpSync(path.join(root,'dist/studio',e),path.join(payload,e),{recursive:true});
}
for(const e of ['app.asar','music-worker','transcribe'])fs.cpSync(path.join(root,'dist/studio/resources',e),path.join(payload,'resources',e),{recursive:true});
const ffmpeg=process.env.OCUT_FFMPEG||run('where.exe',['ffmpeg.exe']).trim().split(/\r?\n/)[0],ffprobe=path.join(path.dirname(ffmpeg),'ffprobe.exe'),ffroot=path.dirname(path.dirname(ffmpeg));
const toolDir=path.join(payload,'resources/tools');fs.mkdirSync(toolDir,{recursive:true});
for(const tool of [ffmpeg,ffprobe])fs.copyFileSync(tool,path.join(toolDir,path.basename(tool)));
for(const f of ['LICENSE','README.txt'])fs.copyFileSync(path.join(ffroot,f),path.join(toolDir,'FFmpeg-'+f));
for(const f of ['STUDIO_GUIDE.md','RECOVERY_REPORT.md'])fs.copyFileSync(path.join(root,f),path.join(payload,f));
fs.copyFileSync(path.join(root,'packaging/NOTICE.ko.txt'),path.join(payload,'먼저 읽어주세요.txt'));
fs.writeFileSync(path.join(payload,'THIRD-PARTY-NOTICES.txt'),`O-CUT local installation candidate ${version}\n\nElectron 33.4.11: supplied ssokMusic Free 0.50.2 archive; LICENSE.electron.txt and LICENSES.chromium.html preserved. https://github.com/electron/electron\nPreserved worker.py and spectrum-analysis.cjs derive from the user-supplied application; original author rights are not reassigned. Public redistribution clearance is not asserted.\nFFmpeg/FFprobe: existing Gyan Windows build, GPL v3; resources/tools/FFmpeg-LICENSE and FFmpeg-README.txt include upstream source revision and configuration. https://www.gyan.dev/ffmpeg/builds/\nNSIS 3.04 compiler: existing electron-builder cache. https://nsis.sourceforge.io/\nRCEdit 2.0.0 build tool: https://github.com/electron/rcedit/releases/tag/v2.0.0 (not installed or included as a runtime).\nPython and AI models are not included.\n`);
// Generate an original geometric O/cut icon, without third-party artwork or new libraries.
async function icon(){
  const {_electron}=require('playwright-core');const app=await _electron.launch({executablePath:path.join(root,'dist/studio/O-CUT.exe'),env:{...process.env,OCUT_DATA_DIR:path.join(stage,'icon-user')}});
  try{const page=await app.firstWindow();const sizes=[16,32,48,256],images=[];for(const size of sizes){const png=await page.evaluate(size=>{const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');x.scale(size/256,size/256);x.fillStyle='#141a20';x.beginPath();x.roundRect(0,0,256,256,52);x.fill();x.strokeStyle='#a4e2ce';x.lineWidth=22;x.beginPath();x.arc(124,132,69,.12*Math.PI,1.72*Math.PI);x.stroke();x.strokeStyle='#f1f6f3';x.lineWidth=15;x.beginPath();x.moveTo(107,154);x.lineTo(216,45);x.stroke();return c.toDataURL().split(',')[1];},size);images.push(Buffer.from(png,'base64'));}
    const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;for(let i=0;i<images.length;i++){const p=6+i*16;header[p]=header[p+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length;}const file=path.join(payload,'resources/ocut.ico');fs.writeFileSync(file,Buffer.concat([header,...images]));return file;
  }finally{await app.evaluate(({app})=>app.exit());}
}
async function main(){
  const ico=await icon();run(rcedit,[path.join(payload,'O-CUT.exe'),'--set-icon',ico,'--set-version-string','ProductName','O-CUT','--set-version-string','FileDescription','O-CUT AI Music & Video Studio','--set-version-string','InternalName','O-CUT','--set-version-string','OriginalFilename','O-CUT.exe','--set-version-string','CompanyName','','--set-version-string','LegalCopyright','See THIRD-PARTY-NOTICES.txt','--set-file-version',version,'--set-product-version',version]);
  fs.writeFileSync(path.join(payload,'ocut-app.id'),'studio.ocut.desktop');
  const files=tree(payload).sort().map(file=>({file:file.replaceAll('\\','/'),bytes:fs.statSync(path.join(payload,file)).size,sha256:hash(path.join(payload,file))}));
  const manifest={version,sourceCommit:run('git',['rev-parse','HEAD']).trim(),asarSha256:gate.asarSha256,files};fs.writeFileSync(path.join(payload,'PACKAGE-MANIFEST.json'),JSON.stringify(manifest,null,2));
  const dirs=new Set();for(const f of [...files,{file:'PACKAGE-MANIFEST.json'}]){let d=path.dirname(f.file);while(d!=='.'){dirs.add(d);d=path.dirname(d);}}
  // Never recursive-delete an installation: enumerate only this package's files and remove empty directories.
  const escape=s=>s.replaceAll('$','$$').replaceAll('"','$\\"').replaceAll('/','\\');
  const uninstall=[...dirs].sort().map(d=>`Push "$INSTDIR\\app\\${escape(d)}"\nCall un.CheckPath`);
  for(const f of [...files,{file:'PACKAGE-MANIFEST.json'}])uninstall.push(`Delete "$INSTDIR\\app\\${escape(f.file)}"\nIfFileExists "$INSTDIR\\app\\${escape(f.file)}" un_failed`);
  for(const d of [...dirs].sort((a,b)=>b.length-a.length))uninstall.push(`RMDir "$INSTDIR\\app\\${escape(d)}"`);
  uninstall.push('RMDir "$INSTDIR\\app"');fs.writeFileSync(path.join(stage,'uninstall-files.nsh'),uninstall.join('\n'));
  const artifacts=path.join(root,'artifacts/release');fs.mkdirSync(artifacts,{recursive:true});const installer=path.join(artifacts,`O-CUT-Setup-${version}.exe`);
  const log=run(nsis,['/NOCONFIG','/INPUTCHARSET','UTF8','/V3',`/DVERSION=${version}`,`/DPAYLOAD=${payload}`,`/DICON=${ico}`,`/DUNINSTALL_FILES=${path.join(stage,'uninstall-files.nsh')}`,`/DOUTPUT=${installer}`,path.join(root,'packaging/installer.nsi')]);
  fs.mkdirSync(path.join(root,'evidence/release'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/release/build.log'),log);
  if(/\bwarning[s]?:/i.test(log))throw Error('Installer compiler warning; inspect evidence/release/build.log');
  for(const [f,digest] of Object.entries(buildInputs))if(hash(path.join(root,f))!==digest)throw Error('Build input changed during packaging: '+f);
  const result={time:new Date().toISOString(),stage,payload,installer,installerSha256:hash(installer),installerBytes:fs.statSync(installer).size,manifest,buildInputs,tools:{nsis:{path:nsis,sha256:hash(nsis)},rcedit:{path:rcedit,sha256:hash(rcedit)},ffmpeg:{path:ffmpeg,sha256:hash(ffmpeg)},ffprobe:{path:ffprobe,sha256:hash(ffprobe)}}};
  fs.writeFileSync(path.join(root,'evidence/release/build.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(artifacts,'SHA256SUMS.txt'),`${result.installerSha256}  ${path.basename(installer)}\n`);console.log('Installer built',installer,result.installerBytes,result.installerSha256);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
