'use strict';
(function(root){
  const defaults={grain:0,noise:0,vignette:0,size:2};
  const ranges={grain:[0,100],noise:[0,100],vignette:[0,100],size:[1,6]};
  function validate(s){if(!s||Object.keys(s).length!==4)throw Error('질감 설정을 확인해 주세요.');for(const [k,[min,max]] of Object.entries(ranges))if(!Number.isFinite(s[k])||s[k]<min||s[k]>max)throw Error('질감 범위를 확인해 주세요: '+k);if(!Number.isInteger(s.size))throw Error('입자 크기는 정수여야 합니다.');}
  const get=c=>c.effects.find(e=>e.type==='texture'&&e.enabled)?.parameters||defaults;
  const active=s=>s.grain>0||s.noise>0||s.vignette>0;
  // Fixed frame/cell hash: seeking and export use identical noise, without random state.
  function random(x,y,frame,salt){let h=Math.imul(x+1,374761393)^Math.imul(y+1,668265263)^Math.imul(frame+salt,1274126177);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295-.5;}
  function pixels(data,width,height,s,time=0){
    if(!active(s))return data;
    const frame=Math.floor(Math.max(0,time)*12+1e-6),grain=s.grain*.6,noise=s.noise*.45;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,cellX=Math.floor(x/s.size),cellY=Math.floor(y/s.size),g=grain?random(cellX,cellY,frame,17)*grain:0;
      const nx=(x+.5)/width*2-1,ny=(y+.5)/height*2-1,v=1-s.vignette/100*.8*Math.min(1,(nx*nx+ny*ny)/1.5);
      for(let c=0;c<3;c++)data[i+c]=(data[i+c]+g+(noise?random(x,y,frame,101+c*97)*noise:0))*v;
    }
    return data;
  }
  const api={defaults,ranges,validate,get,active,pixels,random};if(typeof module!=='undefined')module.exports=api;else root.OcutTexture=api;
})(globalThis);
