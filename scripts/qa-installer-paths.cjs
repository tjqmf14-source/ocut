'use strict';
// Exercise the real installer script with a tiny payload before expensive full compression.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),b=JSON.parse(fs.readFileSync(path.join(root,'evidence/release/build.json'))),data=fs.mkdtempSync(path.join(root,'.runtime/installer-paths-')),payload=path.join(data,'payload'),output=path.join(data,'O-CUT-Path-QA.exe'),checks=[];
const defaultDir=path.join(process.env.LOCALAPPDATA,'Programs/O-CUT');
const defaultState=()=>fs.existsSync(defaultDir)?fs.readdirSync(defaultDir).sort().map(name=>{const s=fs.lstatSync(path.join(defaultDir,name));return {name,size:s.size,modified:s.mtimeMs};}):null;
const defaultBefore=defaultState();
fs.mkdirSync(path.join(payload,'resources'),{recursive:true});fs.writeFileSync(path.join(payload,'fixture.txt'),'test payload');fs.writeFileSync(path.join(payload,'resources/data.txt'),'nested payload');
const un=path.join(data,'uninstall.nsh');fs.writeFileSync(un,'Push "$INSTDIR\\app\\resources"\nCall un.CheckPath\nDelete "$INSTDIR\\app\\fixture.txt"\nDelete "$INSTDIR\\app\\resources\\data.txt"\nRMDir "$INSTDIR\\app\\resources"\nRMDir "$INSTDIR\\app"\n');
const run=(file,args,code=0,raw=false)=>{const r=spawnSync(file,args,{windowsHide:true,windowsVerbatimArguments:raw,encoding:'utf8',timeout:30000});assert.equal(r.status,code,r.stdout+r.stderr);return r;};
const setup=(target,code=0)=>run(output,['/S','/LOCALONLY',`/D=${target}`],code,true);
try{
  const compiled=run(b.tools.nsis.path,['/NOCONFIG','/INPUTCHARSET','UTF8','/V3',`/DVERSION=${b.manifest.version}`,`/DPAYLOAD=${payload}`,`/DICON=${b.payload}\\resources\\ocut.ico`,`/DUNINSTALL_FILES=${un}`,`/DOUTPUT=${output}`,path.join(root,'packaging/installer.nsi')]);assert.doesNotMatch(compiled.stdout,/\bwarning[s]?:/i);
  for(const name of ['새 폴더','nested/새 폴더','existing']){const target=path.join(data,name);if(name==='existing')fs.mkdirSync(target);setup(target);assert.equal(fs.readFileSync(path.join(target,'app/fixture.txt'),'utf8'),'test payload');checks.push('install '+name);}
  const foreign=path.join(data,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'keep.txt'),'keep');setup(foreign,11);
  setup(path.join(foreign,'keep.txt'),11);assert.equal(fs.readFileSync(path.join(foreign,'keep.txt'),'utf8'),'keep');assert.deepEqual(fs.readdirSync(foreign),['keep.txt']);
  // Reject the incorrectly quoted /D argument instead of silently using the default install folder.
  run(output,['/S','/LOCALONLY',`/D=${path.join(data,'quoted destination')}`],21,false);assert.ok(!fs.existsSync(path.join(data,'quoted destination')));
  const linked=path.join(data,'linked');fs.symlinkSync(foreign,linked,'junction');setup(linked,12);setup(path.join(linked,'child'),12);assert.deepEqual(fs.readdirSync(foreign),['keep.txt']);checks.push('nonempty folder, regular file, junction and nested junction rejected without mutation');
  const installed=path.join(data,'existing'),resources=path.join(installed,'app/resources');fs.renameSync(resources,path.join(installed,'original-resources'));fs.symlinkSync(foreign,resources,'junction');run(path.join(installed,'Uninstall O-CUT.exe'),['/S',`_?=${installed}`],12,true);assert.equal(fs.readFileSync(path.join(installed,'app/fixture.txt'),'utf8'),'test payload');assert.deepEqual(fs.readdirSync(foreign),['keep.txt']);checks.push('uninstaller rejects redirected nested application directory before deleting any package files');
  assert.deepEqual(defaultState(),defaultBefore);checks.push('invalid file and incorrectly quoted destination never fall back to or change the default installation folder');
  fs.writeFileSync(path.join(root,'evidence/release/path-qa.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',data,checks,scope:'actual NSIS script; tiny fixture payload; not full package lifecycle'},null,2));console.log('Installer path QA PASS:',checks.length,'checks');
}catch(error){fs.writeFileSync(path.join(root,'evidence/release/path-failure.json'),JSON.stringify({error:error.stack,data,checks},null,2));throw error;}
