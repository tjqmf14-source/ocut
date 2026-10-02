'use strict';
(function(root){
  const types=['none','fade','dissolve','slide','wipe','zoom','blur'],defaults={inType:'none',inDuration:.5,outType:'none',outDuration:.5};
  function validate(s){if(!s||Object.keys(s).some(k=>!Object.hasOwn(defaults,k))||!types.includes(s.inType)||!types.includes(s.outType))throw Error('전환 종류를 확인해 주세요.');for(const k of ['inDuration','outDuration'])if(!Number.isFinite(s[k])||s[k]<=0||s[k]>30)throw Error('전환 길이는 0초 초과 30초 이하여야 합니다.');}
  const get=c=>c.effects.find(e=>e.type==='visualTransition'&&e.enabled)?.parameters||defaults;
  const active=s=>s.inType!=='none'||s.outType!=='none';
  function state(clip,time,canvas){
    const s=get(clip),value={opacity:1,x:0,scale:1,wipe:1,blur:0};
    for(const [type,p,incoming] of [[s.inType,Math.max(0,Math.min(1,time/Math.min(s.inDuration,clip.duration))),true],[s.outType,Math.max(0,Math.min(1,(clip.duration-time)/Math.min(s.outDuration,clip.duration))),false]]){
      if(type==='none')continue;
      if(['fade','dissolve','zoom','blur'].includes(type))value.opacity*=p;
      if(type==='slide')value.x+=(incoming?-1:1)*(1-p)*canvas.width;
      if(type==='zoom')value.scale*=.75+.25*p;
      if(type==='wipe')value.wipe*=p;
      if(type==='blur')value.blur+=(1-p)*24;
    }
    return value;
  }
  const api={types,defaults,validate,get,active,state};if(typeof module!=='undefined')module.exports=api;else root.OcutTransitions=api;
})(globalThis);
