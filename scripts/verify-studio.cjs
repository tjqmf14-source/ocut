'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'evidence/studio');
const stages = [ ['core','scripts/build-core.cjs'], ['build','scripts/build-studio.cjs'], ['tests','--test','tests/*.test.cjs'], ['shell','scripts/qa-shell.cjs'], ['timeline','scripts/qa-timeline.cjs'], ['render','scripts/qa-studio-render.cjs'], ['image','scripts/qa-image-export.cjs'], ['recovery','scripts/qa-export-recovery.cjs'], ['captions','scripts/qa-captions.cjs'], ['music','scripts/qa-music.cjs'], ['visualizer','scripts/qa-visualizer.cjs'], ['text-style','scripts/qa-text-style.cjs'], ['transcription','scripts/qa-transcribe.cjs'] ];
const checks=[];
stages.push(['keyframes','scripts/qa-keyframes.cjs']);
stages.push(['color-filters','scripts/qa-color-filters.cjs'],['transitions','scripts/qa-transitions.cjs']);
for(const [name,...args] of stages){
  const r=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
  const output=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(evidence,`gate-${name}.log`),output);
  checks.push({name,exitCode:r.status});console.log(name+': '+(r.status===0?'PASS':'FAIL'));
  if(r.status!==0){fs.writeFileSync(path.join(evidence,'gate-failure.json'),JSON.stringify({time:new Date().toISOString(),checks},null,2));console.error(output);process.exit(1);}
}
const archive=path.join(root,'dist/studio/resources/app.asar');
const asarSha256=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(path.join(evidence,'gate.json'),JSON.stringify({time:new Date().toISOString(),asarSha256,checks,build:JSON.parse(fs.readFileSync(path.join(evidence,'build.json')))},null,2));
console.log('Verified exact ASAR SHA256:',asarSha256);
