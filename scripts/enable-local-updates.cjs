'use strict';
// One-time bridge for already installed versions that predate automatic updates.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{UpdateService,safeDirectory,verifyFeed,contained}=require('../src/infrastructure/updates.cjs'),{hash}=require('./prepare-update.cjs'),channel=require('../src/desktop/update-channel.json');
async function main(){
  const workspace=path.resolve(__dirname,'..'),root=path.join(process.env.LOCALAPPDATA,'Programs/O-CUT'),directory=path.join(process.env.APPDATA,'O-CUT/updates');let fresh=false;
  if(!fs.existsSync(root)){
    await safeDirectory(path.dirname(root));
    const build=JSON.parse(fs.readFileSync(path.join(workspace,'evidence/release/build.json'))),qa=JSON.parse(fs.readFileSync(path.join(workspace,'evidence/updates/qa.json'))),release=JSON.parse(fs.readFileSync(path.join(workspace,'evidence/release/gate.json'))),item=verifyFeed(JSON.parse(fs.readFileSync(channel.feed)),channel.publicKey);
    assert.equal(release.status,'PASS');assert.equal(qa.status,'PASS');assert.equal(qa.asarSha256,item.asarSha256);assert.equal(qa.manifestSha256,item.manifestSha256);assert.equal(build.manifest.version,item.version);assert.equal(build.manifest.asarSha256,item.asarSha256);assert.equal(hash(build.installer),build.installerSha256);assert.equal(release.installerSha256,build.installerSha256);
    const startMenu=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/O-CUT');assert.equal(fs.existsSync(startMenu),false,'Existing Start menu preserved; inspect its owner before installing.');
    const registered=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if(Test-Path -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\O-CUT'){exit 2}"],{windowsHide:true});assert.equal(registered.status,0,'Existing registration preserved; inspect its owner before installing.');
    const install=spawnSync(build.installer,['/S',`/D=${root}`],{windowsHide:true,windowsVerbatimArguments:true,timeout:180000,encoding:'utf8'});assert.equal(install.status,0,install.stderr||install.error?.message);fresh=true;
  }
  await safeDirectory(root);const manifest=JSON.parse(fs.readFileSync(path.join(root,'app/PACKAGE-MANIFEST.json')));
  for(const f of manifest.files){const file=contained(path.join(root,'app'),f.file);await safeDirectory(path.dirname(file));if(fs.lstatSync(file).isSymbolicLink()||hash(file)!==f.sha256)throw Error('Existing app differs from its package manifest; preserved unchanged.');}
  const updater=new UpdateService({root,directory,version:manifest.version,feed:channel.feed,publicKey:channel.publicKey});const state=await updater.check(true);
  if(state.status==='ready')await updater.schedule(false);else if(state.status!=='current')throw Error(state.message);
  const report={time:new Date().toISOString(),status:state.status==='ready'?'WAITING_FOR_APP_EXIT':'CURRENT',freshInstallation:fresh,installation:root,previousVersion:fresh?null:manifest.version,nextVersion:state.nextVersion||manifest.version,updateResult:path.join(directory,'result.json'),message:fresh?'Verified installer activated in previously absent app directory. Existing user data preserved.':'No forced close. Helper applies verified update after current app exits; backups and user data preserved.'};
  fs.writeFileSync(path.join(__dirname,'../evidence/updates/bootstrap.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
