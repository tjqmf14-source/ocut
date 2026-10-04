'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),{verifyFeed,manifestAt,newer}=require('../src/infrastructure/updates.cjs'),{hash}=require('./prepare-update.cjs');
async function main(){
  const c=JSON.parse(fs.readFileSync(path.join(root,'evidence/updates/candidate.json'))),qa=JSON.parse(fs.readFileSync(path.join(root,'evidence/updates/qa.json'))),studio=JSON.parse(fs.readFileSync(path.join(root,'evidence/studio/gate.json'))),b=JSON.parse(fs.readFileSync(path.join(root,'evidence/release/build.json'))),channel=require('../src/desktop/update-channel.json');
  if(qa.status!=='PASS'||qa.asarSha256!==c.item.asarSha256||qa.manifestSha256!==c.item.manifestSha256||c.item.asarSha256!==studio.asarSha256||c.installerSha256!==b.installerSha256||hash(b.installer)!==c.installerSha256||studio.checks.some(c=>c.exitCode!==0))throw Error('Current exact update candidate must pass real update QA before publication');
  for(const f of studio.build.files)if(hash(path.join(root,'src',f.file))!==f.sha256)throw Error('App source changed after verification');
  const {manifest}=await manifestAt(c.item.directory,c.item);for(const f of manifest.files)if(hash(path.join(c.item.directory,f.file))!==f.sha256)throw Error('Candidate file changed after QA');
  if(fs.existsSync(channel.feed)){const previous=verifyFeed(JSON.parse(fs.readFileSync(channel.feed)),channel.publicKey);if(!newer(c.item.version,previous.version))throw Error('Published update versions must increase; same-version replacement and downgrade rejected.');}
  const keyFile=path.join(root,'.runtime/update-keys/private.pem');
  // This newly created signing key must not inherit the workspace's shared ACL.
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const check=`$ErrorActionPreference='Stop';$allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544');foreach($target in @(${quote(path.dirname(keyFile))},${quote(keyFile)})){$item=Get-Item -LiteralPath $target;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked signing key rejected'};$acl=$item.GetAccessControl();if(!$acl.AreAccessRulesProtected){throw 'Signing key ACL must be protected'};foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){throw 'Signing key is accessible to another principal'}}}`;
  const access=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(check,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});if(access.status!==0)throw Error('Protect the local signing key permissions before publishing: '+access.stderr);
  const payload=JSON.stringify(c.item),key=fs.readFileSync(keyFile),envelope={payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')};verifyFeed(envelope,channel.publicKey);
  fs.mkdirSync(path.dirname(channel.feed),{recursive:true});const temp=channel.feed+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(envelope,null,2),{flag:'wx'});fs.renameSync(temp,channel.feed);
  fs.writeFileSync(path.join(root,'evidence/updates/published.json'),JSON.stringify({time:new Date().toISOString(),status:'PASS',channel:'local-development',version:c.item.version,asarSha256:c.item.asarSha256,manifestSha256:c.item.manifestSha256,feed:channel.feed,keyAccess:'Protected ACL: current user, SYSTEM and Administrators only',scope:'This PC only; no external service or public distribution'},null,2));console.log('Published verified local update',c.item.version);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
