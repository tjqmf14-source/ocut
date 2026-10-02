const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['core/project.cjs','core/history.cjs','core/visualizer.js','core/text-style.js','core/keyframes.js','infrastructure/project-store.cjs'];
const manifest=[];
for(const file of files){
  const source=path.join(root,'src',file);execFileSync(process.execPath,['--check',source]);
  const target=path.join(root,'dist/core',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
  manifest.push({file,sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex')});
}
fs.mkdirSync(path.join(root,'evidence/phase1'),{recursive:true});
fs.writeFileSync(path.join(root,'evidence/phase1/build.json'),JSON.stringify({time:new Date().toISOString(),kind:'CommonJS core distribution; no UI or installer',files:manifest},null,2));
console.log('Core build PASS:',files.length,'modules');
