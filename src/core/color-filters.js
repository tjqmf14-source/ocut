'use strict';
(function(root){
  const defaults={exposure:0,brightness:0,contrast:100,saturation:100,temperature:0,tint:0,highlights:0,shadows:0};
  const presets={neutral:{...defaults},vivid:{...defaults,contrast:115,saturation:125},warm:{...defaults,temperature:35,tint:5,contrast:105},mono:{...defaults,saturation:0,contrast:115},soft:{...defaults,contrast:85,saturation:85,shadows:15,highlights:-15}};
  Object.assign(presets,{cafe:{...defaults,temperature:24,saturation:78,contrast:92,shadows:12},night:{...defaults,temperature:-26,tint:12,saturation:72,brightness:-5,shadows:8},faded:{...defaults,contrast:78,saturation:65,shadows:22,highlights:-18},sunset:{...defaults,temperature:40,tint:18,saturation:110,highlights:-12}});
  const ranges={exposure:[-4,4],brightness:[-100,100],contrast:[0,200],saturation:[0,200],temperature:[-100,100],tint:[-100,100],highlights:[-100,100],shadows:[-100,100]};
  function validate(s){if(!s||Object.keys(s).length!==Object.keys(defaults).length)throw Error('색 보정 설정을 확인해 주세요.');for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error('색 보정 범위를 확인해 주세요: '+key);}
  const get=clip=>clip.effects.find(e=>e.type==='colorCorrection'&&e.enabled)?.parameters||defaults;
  const active=s=>Object.keys(defaults).some(k=>s[k]!==defaults[k]);
  function pixels(data,s){
    if(!active(s))return data;
    const exposure=2**s.exposure,contrast=s.contrast/100,saturation=s.saturation/100,brightness=s.brightness/200,temp=s.temperature/1000,tint=s.tint/1000,high=s.highlights/200,shadow=s.shadows/200;
    const clamp=v=>Math.max(0,Math.min(1,v));
    for(let i=0;i<data.length;i+=4){
      let r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
      r=clamp(((r*exposure+brightness)-.5)*contrast+.5+temp+tint*.5);g=clamp(((g*exposure+brightness)-.5)*contrast+.5-tint);b=clamp(((b*exposure+brightness)-.5)*contrast+.5-temp+tint*.5);
      const luma=.2126*r+.7152*g+.0722*b,tones=high*Math.max(0,(luma-.5)*2)+shadow*Math.max(0,1-luma*2);
      data[i]=Math.round(clamp(luma+(r-luma)*saturation+tones)*255);data[i+1]=Math.round(clamp(luma+(g-luma)*saturation+tones)*255);data[i+2]=Math.round(clamp(luma+(b-luma)*saturation+tones)*255);
    }
    return data;
  }
  const api={defaults,presets,ranges,validate,get,active,pixels};if(typeof module!=='undefined')module.exports=api;else root.OcutColorFilters=api;
})(globalThis);
