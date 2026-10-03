'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{verifyFeed,manifestAt,newer}=require('../src/infrastructure/updates.cjs'),{hash}=require('./prepare-update.cjs');
async function main(){
  const c=JSON.parse(fs.readFileSync(path.join(root,'evidence/updates/candidate.json'))),qa=JSON.parse(fs.readFileSync(path.join(root,'evidence/updates/qa.json'))),studio=JSON.parse(fs.readFileSync(path.join(root,'evidence/studio/gate.json'))),b=JSON.parse(fs.readFileSync(path.join(root,'evidence/release/build.json'))),channel=require('../src/desktop/update-channel.json');
  if(qa.status!=='PASS'||qa.asarSha256!==c.item.asarSha256||qa.manifestSha256!==c.item.manifestSha256||c.item.asarSha256!==studio.asarSha256||c.installerSha256!==b.installerSha256||hash(b.installer)!==c.installerSha256||studio.checks.some(c=>c.exitCode!==0))throw Error('Current exact update candidate must pass real update QA before publication');
  for(const f of studio.build.files)if(hash(path.join(root,'src',f.file))!==f.sha256)throw Error('App source changed after verification');
  const {manifest}=await manifestAt(c.item.directory,c.item);for(const f of manifest.files)if(hash(path.join(c.item.directory,f.file))!==f.sha256)throw Error('Candidate file changed after QA');
  if(fs.existsSync(channel.feed)){const previous=verifyFeed(JSON.parse(fs.readFileSync(channel.feed)),channel.publicKey);if(!newer(c.item.version,previous.version))throw Error('Published update versions must increase; same-version replacement and downgrade rejected.');}
  const payload=JSON.stringify(c.item),key=fs.readFileSync(path.join(root,'.runtime/update-keys/private.pem')),envelope={payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')};verifyFeed(envelope,channel.publicKey);
  fs.mkdirSync(path.dirname(channel.feed),{recursive:true});const temp=channel.feed+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(envelope,null,2),{flag:'wx'});fs.renameSync(temp,channel.feed);
  fs.writeFileSync(path.join(root,'evidence/updates/published.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',channel:'local-development',version:c.item.version,asarSha256:c.item.asarSha256,manifestSha256:c.item.manifestSha256,feed:channel.feed,scope:'This PC only; no external service or public distribution'},null,2));console.log('Published verified local update',c.item.version);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
