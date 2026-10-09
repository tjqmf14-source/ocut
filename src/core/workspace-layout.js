(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OcutWorkspaceLayout=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n)),value=(n,fallback)=>Number.isFinite(n)?n:fallback;
  function measure(mode,width,height,pref={}){
    const music=mode==='music',focus=mode==='focus',leftMin=music?360:220,centerMin=music?260:300,thirdMin=focus?0:220;
    const third=focus?0:clamp(value(pref.third,music?Math.min(340,width*.23):280),thirdMin,width-leftMin-centerMin);
    const left=clamp(value(pref.left,music?width*.48:320),leftMin,width-third-centerMin);
    const bottomMax=Math.max(140,height-(music?360:220)),bottom=clamp(value(pref.bottom,music?150:230),140,bottomMax);
    return {left,third,bottom,leftMin,thirdMin,centerMin,bottomMax,width,height,columns:focus?[left,width-left]:music?[left,third,width-left-third]:[left,width-left-third,third]};
  }
  function resize(mode,box,part,delta){
    let {left,third,bottom}=box;
    if(part==='bottom')bottom=clamp(bottom-delta,140,box.bottomMax);
    else if(part==='left'){
      const next=clamp(left+delta,box.leftMin,mode==='music'?left+third-box.thirdMin:box.width-third-box.centerMin);
      if(mode==='music')third+=left-next;
      left=next;
    }else third=clamp(third+(mode==='music'?delta:-delta),box.thirdMin,box.width-left-box.centerMin);
    return {left,third,bottom};
  }
  return {measure,resize};
});
