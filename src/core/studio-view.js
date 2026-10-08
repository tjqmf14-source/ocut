(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OcutStudioView=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const MIN_ZOOM=.005, MAX_ZOOM=180;
  const clampZoom=value=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,Number.isFinite(value)?value:70));
  const fromSlider=value=>clampZoom(MIN_ZOOM*(MAX_ZOOM/MIN_ZOOM)**(value/1000));
  const toSlider=value=>1000*Math.log(clampZoom(value)/MIN_ZOOM)/Math.log(MAX_ZOOM/MIN_ZOOM);
  const fit=(duration,width)=>clampZoom(Math.max(1,width-80)/Math.max(20,duration+4));
  function rulerStep(zoom){const target=90/clampZoom(zoom);return [1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,14400,28800].find(n=>n>=target)||28800;}
  function timeLabel(t){const n=Math.max(0,Math.floor(t)),s=String(n%60).padStart(2,'0'),m=String(Math.floor(n/60)%60).padStart(2,'0');return n>=3600?`${Math.floor(n/3600)}:${m}:${s}`:`${m}:${s}`;}
  function timecode(t){const ms=Math.max(0,Math.round(t*1000));return `${timeLabel(Math.floor(ms/1000))}.${String(ms%1000).padStart(3,'0')}`;}
  function musicProgress(job){
    if(!job)return null;
    const stage=job.status==='checking'?'음원 확인':({load:'엔진 준비',plan:'작곡 계획',semantic:'멜로디 생성',synth:'악기 소리 합성',decode:'오디오 생성',save:'음원 저장'}[job.stage]||'음악 생성');
    const p=job.progress||{};let percent=null,detail='진행 시간을 계산할 수 없는 단계입니다.';
    if(job.status==='checking')detail='생성 파일을 확인하고 있습니다.';
    else if(p.status==='done'){percent=100;detail='이 단계 완료 · 다음 단계 준비 중';}
    else if(Number.isFinite(p.steps)&&p.steps>0&&Number.isFinite(p.step)){percent=Math.floor(Math.max(0,Math.min(1,p.step/p.steps))*100);detail=`${p.step} / ${p.steps} 합성 단계`;}
    else if(Number.isFinite(p.tokens)&&p.tokens>=0){
      detail=`${p.tokens.toLocaleString('ko-KR')} 토큰 생성`;
      if(job.stage==='semantic'&&Number.isFinite(job.seconds)&&job.seconds>0){percent=Math.min(99,Math.floor(p.tokens/Math.max(500,job.seconds*25)*100));detail+=' · 목표 길이 기준 추정';}
    }
    return {stage,percent,detail,label:percent===null?`${stage} · 진행 중`:`${stage} · ${percent}%`};
  }
  return {MIN_ZOOM,MAX_ZOOM,clampZoom,fromSlider,toSlider,fit,rulerStep,timeLabel,timecode,musicProgress};
});
