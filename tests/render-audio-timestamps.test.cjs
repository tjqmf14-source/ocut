'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createProject,createTrack,createClip}=require('../src/core/project.cjs');
const {renderPlan}=require('../src/core/render-plan.cjs');
test('delayed trimmed audio has finite timestamps, full duration and decoded fade/silence in real MP4',()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'ocut-audio-timestamps-')),tone=path.join(data,'tone.wav'),output=path.join(data,'output.mp4');
  const run=(exe,args)=>{const r=spawnSync(exe,args,{windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.error?.message||r.stderr?.toString());return r.stdout;};
  run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6',tone]);
  const p=createProject(),track=createTrack('audio');p.tracks.push(track);p.canvas.width=p.exportSettings.width=320;p.canvas.height=p.exportSettings.height=180;
  p.media.push({id:'media',type:'audio',path:tone,name:'tone',duration:6,fingerprint:null});
  const c=createClip({trackId:track.id,type:'audio',source:'media',startTime:1,sourceStart:1,duration:4});
  c.effects.push({id:'fade',type:'audioFade',enabled:true,parameters:{fadeIn:.5,fadeOut:1}});p.clips.push(c);
  const tail=createTrack('text');p.tracks.push(tail);p.clips.push(createClip({trackId:tail.id,type:'text',duration:6,text:'duration'}));
  // Hidden title extends the project to verify silence after the audio ends.
  tail.hidden=true;
  const plan=renderPlan(p,new Map([['media',{type:'audio',path:tone,hasAudio:true}]]),new Map());
  run('ffmpeg',['-v','error',...plan.args,'-filter_complex',plan.graph,'-map','[vout]','-map','[aout]','-c:v','libx264','-preset','ultrafast','-c:a','aac','-t','6',output]);
  const info=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',output])),audio=info.streams.find(s=>s.codec_type==='audio');
  assert.ok(Number.isFinite(Number(audio.start_time))&&Math.abs(Number(audio.start_time))<.1);
  assert.ok(Math.abs(Number(audio.duration)-6)<.1,JSON.stringify(audio));
  const pcm=run('ffmpeg',['-v','error','-i',output,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  const rms=t=>{let n=0,power=0;for(let i=Math.floor(t*48000);i<Math.floor((t+.08)*48000)&&i*4<pcm.length;i++){const v=pcm.readFloatLE(i*4);power+=v*v;n++;}assert.ok(n>0);return Math.sqrt(power/n);};
  const steady=rms(2);assert.ok(steady>.02);assert.ok(rms(.5)<steady*.01);assert.ok(rms(1.02)<steady*.2);assert.ok(rms(4.88)<steady*.15);assert.ok(rms(5.5)<steady*.01);
});
