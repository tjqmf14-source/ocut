'use strict';
(function(root){
  const ranges={x:[-1000000,1000000],y:[-1000000,1000000],scaleX:[.001,4],scaleY:[.001,4],rotation:[-36000,36000],opacity:[0,1],volume:[0,4]};
  const frames=(clip,property)=>clip.keyframes.filter(k=>k.property===property).sort((a,b)=>a.time-b.time);
  const base=(clip,property)=>Object.hasOwn(clip.transform,property)?clip.transform[property]:clip[property];
  function validate(clip){
    const counts={};
    for(const k of clip.keyframes){
      if(!Object.hasOwn(ranges,k.property))throw Error('지원하지 않는 키프레임 속성입니다.');
      const [min,max]=ranges[k.property];if(!Number.isFinite(k.value)||k.value<min||k.value>max)throw Error('키프레임 값의 범위를 확인해 주세요.');
      if((counts[k.property]=(counts[k.property]||0)+1)>128)throw Error('속성별 키프레임은 128개까지 지원합니다.');
    }
  }
  function value(clip,property,time){
    const list=frames(clip,property);if(!list.length)return base(clip,property);
    if(time<=list[0].time)return list[0].value;
    for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];if(time<b.time)return a.interpolation==='hold'?a.value:a.value+(b.value-a.value)*(time-a.time)/(b.time-a.time);}
    return list.at(-1).value;
  }
  function evaluate(clip,time){
    if(!clip.keyframes.length)return clip;
    const next={...clip,transform:{...clip.transform}};
    for(const property of new Set(clip.keyframes.map(k=>k.property))){const v=value(clip,property,time);if(Object.hasOwn(next.transform,property))next.transform[property]=v;else next[property]=v;}
    return next;
  }
  function expression(clip,property){
    const list=frames(clip,property);if(!list.length)return String(base(clip,property));
    const terms=[`lt(t,${list[0].time})*${list[0].value}`];
    for(let i=0;i<list.length-1;i++){const a=list[i],b=list[i+1],part=a.interpolation==='hold'?String(a.value):`(${a.value}+(${b.value-a.value})*(t-${a.time})/${b.time-a.time})`;terms.push(`gte(t,${a.time})*lt(t,${b.time})*${part}`);}
    terms.push(`gte(t,${list.at(-1).time})*${list.at(-1).value}`);
    // FFmpeg limits expression-tree depth, including left-associated additions.
    const balanced=items=>items.length===1?items[0]:`(${balanced(items.slice(0,Math.floor(items.length/2)))}+${balanced(items.slice(Math.floor(items.length/2)))})`;
    return `if(isnan(t),${list[0].value},${balanced(terms)})`;
  }
  const animated=clip=>clip.keyframes.some(k=>k.property!=='volume')||clip.effects.some(e=>['audioVisualizer','colorCorrection','visualTransition','texture'].includes(e.type)&&e.enabled);
  function split(clip,time){
    return {left:trim(clip,0,time),right:trim(clip,time,clip.duration)};
  }
  function trim(clip,start,end){
    const result=[];
    for(const property of new Set(clip.keyframes.map(k=>k.property))){
      const list=frames(clip,property);
      const mode=time=>[...list].reverse().find(k=>k.time<=time)?.interpolation||'hold';
      const retained=list.filter(k=>k.time>=start&&k.time<=end).map(k=>({...k,time:k.time-start}));
      // Outside the keyed interval, evaluation already holds the first/last value.
      // Add a boundary only when cutting through an interpolated interval.
      if(start>list[0].time&&start<list.at(-1).time&&!list.some(k=>k.time===start))retained.unshift({property,time:0,value:value(clip,property,start),interpolation:mode(start)});
      if(end>list[0].time&&end<list.at(-1).time&&!list.some(k=>k.time===end))retained.push({property,time:end-start,value:value(clip,property,end),interpolation:mode(end)});
      if(!retained.length)retained.push({property,time:0,value:value(clip,property,start),interpolation:'hold'});
      result.push(...retained);
    }
    return result.sort((a,b)=>a.time-b.time||a.property.localeCompare(b.property));
  }
  const api={ranges,frames,base,validate,value,evaluate,expression,animated,split,trim};if(typeof module!=='undefined')module.exports=api;else root.OcutKeyframes=api;
})(globalThis);
