'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/release'),checks=[],hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let candidate;
fs.mkdirSync(evidence,{recursive:true});
function run(name,args){const r=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024});fs.writeFileSync(path.join(evidence,`gate-${name}.log`),(r.stdout||'')+(r.stderr||''));checks.push({name,exitCode:r.status});console.log(name+': '+(r.status===0?'PASS':'FAIL'));assert.equal(r.status,0,(r.stdout||'')+(r.stderr||''));}
try{
  if(!process.argv.includes('--existing'))run('build',['scripts/build-installer.cjs']);
  const b=candidate=JSON.parse(fs.readFileSync(path.join(evidence,'build.json'))),studio=JSON.parse(fs.readFileSync(path.join(root,'evidence/studio/gate.json')));
  assert.equal(hash(b.installer),b.installerSha256);assert.equal(b.manifest.asarSha256,studio.asarSha256);
  for(const [file,digest] of Object.entries(b.buildInputs))assert.equal(hash(path.join(root,file)),digest,file);
  for(const f of studio.build.files)assert.equal(hash(path.join(root,'src',f.file)),f.sha256,f.file);
  checks.push({name:'exact artifact and source identity',exitCode:0});
  run('tests',['--test','tests/*.test.cjs']);run('paths',['scripts/qa-installer-paths.cjs']);run('installer',['scripts/qa-installer.cjs']);
  const qa=JSON.parse(fs.readFileSync(path.join(evidence,'installer-qa.json')));assert.equal(qa.installerSha256,b.installerSha256);
  if(qa.integration.status!=='PASS'){const error=Error('Windows integration NOT RUN: '+qa.integration.reason);error.code='OCUT_INTEGRATION_NOT_RUN';throw error;}assert.equal(hash(b.installer),b.installerSha256);
  const verificationInputs=Object.fromEntries(['scripts/verify-release.cjs','scripts/qa-installer.cjs','scripts/qa-installer-paths.cjs'].map(f=>[f,hash(path.join(root,f))]));
  fs.writeFileSync(path.join(evidence,'gate.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',installer:b.installer,installerSha256:b.installerSha256,asarSha256:b.manifest.asarSha256,buildTime:b.time,buildInputs:b.buildInputs,verificationInputs,checks,scope:'this Windows host; clean PC VM, signing, power-loss and disk-full NOT RUN'},null,2));
  console.log('Release candidate verified:',b.installerSha256);
}catch(error){const report={time:new Date().toISOString(),status:error.code==='OCUT_INTEGRATION_NOT_RUN'?'BLOCKED':'FAIL',installer:candidate?.installer,installerSha256:candidate?.installerSha256,asarSha256:candidate?.manifest.asarSha256,error:error.stack,checks};fs.writeFileSync(path.join(evidence,'gate-failure.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(evidence,'gate.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;}
