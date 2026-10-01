'use strict';
// Deterministic source-time sampling shared by preview and exported overlay frames.
(function(root){
  const defaults={style:'bars',color:'#b9edcf',barCount:48,thickness:3,sensitivity:1,smoothing:2,minFrequency:40,maxFrequency:12000,glow:8};
  const effect=clip=>clip.effects.find(e=>e.type==='audioVisualizer'&&e.enabled);
  const visualTrack=(project,track)=>track.type==='overlay'&&project.clips.filter(c=>c.trackId===track.id).every(c=>c.effects.some(e=>e.type==='audioVisualizer'));
  function validate(p){
    if(!p||Object.keys(p).some(k=>!Object.hasOwn(defaults,k)))throw Error('지원하지 않는 시각화 설정입니다.');
    if(!['wave','bars','line','circular','mirror','spectrum'].includes(p.style)||!/^#[\da-f]{6}$/i.test(p.color))throw Error('시각화 모양 또는 색상이 올바르지 않습니다.');
    for(const [key,min,max] of [['barCount',8,128],['thickness',1,20],['sensitivity',.1,4],['smoothing',0,10],['minFrequency',20,11999],['maxFrequency',21,12000],['glow',0,40]])if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw Error('시각화 설정 범위를 확인해 주세요: '+key);
    if(!Number.isInteger(p.barCount)||!Number.isInteger(p.smoothing)||p.minFrequency>=p.maxFrequency)throw Error('주파수 범위와 막대 수를 확인해 주세요.');
  }
  function row(data,seconds,p){
    const values=new Float32Array(p.style==='wave'?(data?.waveCount||64):p.barCount);
    if(!data||seconds<0||seconds>=data.duration)return values;
    const frame=Math.min(data.frameCount-1,Math.floor(seconds*data.fps+1e-7));
    const count=p.style==='wave'?data.waveCount:data.barCount,source=p.style==='wave'?data.waves:data.frames;
    for(let i=0;i<values.length;i++){
      let from=i,to=i+1;
      if(p.style!=='wave'){
        const hz=p.minFrequency*(p.maxFrequency/p.minFrequency)**(i/values.length),end=p.minFrequency*(p.maxFrequency/p.minFrequency)**((i+1)/values.length);
        from=Math.max(0,Math.min(count-1,Math.floor(Math.log(hz/20)/Math.log(600)*count)));to=Math.max(from+1,Math.min(count,Math.ceil(Math.log(end/20)/Math.log(600)*count)));
      }
      let sum=0,n=0;
      for(let f=Math.max(0,frame-p.smoothing);f<=frame;f++){let peak=0;for(let b=from;b<to;b++){const v=source[f*count+b];if(Math.abs(v)>Math.abs(peak))peak=v;}sum+=peak;n++;}
      values[i]=Math.max(-1,Math.min(1,sum/n*p.sensitivity));
    }
    return values;
  }
  function paint(ctx,clip,canvas,data,time,gain=1){
    const e=effect(clip);if(!e||!data)return;
    const p=e.parameters,values=row(data,clip.sourceStart+(time-clip.startTime)*clip.speed,p);
    const w=canvas.width*.75,h=canvas.height*.28,step=w/values.length;
    ctx.save();ctx.translate(canvas.width/2+clip.transform.x,canvas.height/2+clip.transform.y);ctx.rotate(clip.transform.rotation*Math.PI/180);
    ctx.scale(clip.transform.scaleX*(clip.transform.flipX?-1:1),clip.transform.scaleY*(clip.transform.flipY?-1:1));
    ctx.globalAlpha=clip.opacity;ctx.fillStyle=ctx.strokeStyle=p.color;ctx.lineWidth=p.thickness;ctx.lineJoin='round';ctx.shadowColor=p.color;ctx.shadowBlur=p.glow;
    if(p.style==='wave'||p.style==='line'){
      if(values.some(v=>v!==0)&&gain>0){ctx.beginPath();values.forEach((v,i)=>{const x=-w/2+i*w/(values.length-1),y=-v*h*.5*gain;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
    }else for(let i=0;i<values.length;i++){
      const value=values[i]*gain;if(value<=0)continue;
      const length=value*h;
      if(p.style==='circular'){const a=i/values.length*Math.PI*2,r=h*.6;ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*(r+length*.65),Math.sin(a)*(r+length*.65));ctx.stroke();}
      else if(p.style==='mirror')ctx.fillRect(-w/2+i*step,-length/2,Math.max(1,step*.65),length);
      else if(p.style==='spectrum'){ctx.beginPath();ctx.moveTo(-w/2+i*step,h/2);ctx.lineTo(-w/2+i*step,h/2-length);ctx.stroke();}
      else ctx.fillRect(-w/2+i*step,h/2-length,Math.max(1,step*.7),length);
    }
    ctx.restore();
  }
  const api={defaults,effect,visualTrack,validate,row,paint};if(typeof module!=='undefined')module.exports=api;else root.OcutVisualizer=api;
})(globalThis);
