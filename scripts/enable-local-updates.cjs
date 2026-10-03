'use strict';
// One-time bridge for already installed versions that predate automatic updates.
const fs=require('node:fs'),path=require('node:path'),{UpdateService}=require('../src/infrastructure/updates.cjs'),{hash}=require('./prepare-update.cjs'),channel=require('../src/desktop/update-channel.json');
async function main(){
  const root=path.join(process.env.LOCALAPPDATA,'Programs/O-CUT'),directory=path.join(process.env.APPDATA,'O-CUT/updates'),manifest=JSON.parse(fs.readFileSync(path.join(root,'app/PACKAGE-MANIFEST.json')));
  for(const f of manifest.files){const file=path.resolve(root,'app',f.file);if(!file.toLowerCase().startsWith((path.resolve(root,'app')+path.sep).toLowerCase())||hash(file)!==f.sha256)throw Error('Existing app differs from its package manifest; preserved unchanged.');}
  const updater=new UpdateService({root,directory,version:manifest.version,feed:channel.feed,publicKey:channel.publicKey});const state=await updater.check(true);
  if(state.status==='ready')await updater.schedule(false);else if(state.status!=='current')throw Error(state.message);
  const report={time:new Date().toISOString(),status:state.status==='ready'?'WAITING_FOR_APP_EXIT':'CURRENT',installation:root,previousVersion:manifest.version,nextVersion:state.nextVersion||manifest.version,updateResult:path.join(directory,'result.json'),message:'No forced close. Helper applies verified update after current app exits; backups and user data preserved.'};
  fs.writeFileSync(path.join(__dirname,'../evidence/updates/bootstrap.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
