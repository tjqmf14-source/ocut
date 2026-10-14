'use strict';
(()=>{
  const G=OcutDirectEdit,svg=$('previewSelection'),canvas=$('preview'),ns='http://www.w3.org/2000/svg';let gesture=null,chosenKey=null;
  const frame=t=>Math.round(t*state.project.canvas.fps)/state.project.canvas.fps;
  const relative=clip=>G.clamp(frame(playback.time-clip.startTime),0,clip.duration);
  const locked=clip=>!clip||state.project.tracks.find(t=>t.id===clip.trackId)?.locked;
  const visual=clip=>clip&&!['audio','music'].includes(clip.type);
  const active=clip=>clip&&playback.time>=clip.startTime-1e-7&&playback.time<clip.startTime+clip.duration-1e-7&&!state.project.tracks.find(t=>t.id===clip.trackId)?.hidden;
  const evaluated=clip=>OcutKeyframes.evaluate(clip,G.clamp(playback.time-clip.startTime,0,clip.duration));
  const transition=clip=>OcutTransitions.state(clip,playback.time-clip.startTime,state.project.canvas);
  const displayed=clip=>{const t=transition(clip);return {...clip.transform,x:clip.transform.x+t.x,scaleX:clip.transform.scaleX*t.scale,scaleY:clip.transform.scaleY*t.scale};};
  function bounds(clip){
    const size=state.project.canvas;
    if(['text','subtitle'].includes(clip.type))return OcutText.bounds(playback.ctx,clip,size.height);
    const effect=clip.effects.find(e=>e.type==='audioVisualizer'&&e.enabled);
    if(effect){const h=size.height*.28,w=effect.parameters.style==='circular'?h*2.5:size.width*.75;return {x:-w/2,y:effect.parameters.style==='circular'?-w/2:-h/2,width:w,height:effect.parameters.style==='circular'?w:h};}
    const asset=state.assets[clip.source];if(!asset?.width||!asset?.height)return null;
    const fit=Math.min(size.width/asset.width,size.height/asset.height),w=asset.width*fit,h=asset.height*fit;return {x:-w/2,y:-h/2,width:w,height:h};
  }
  function element(name,attributes,parent=svg){const el=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attributes))el.setAttribute(key,value);parent.append(el);return el;}
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*state.project.canvas.width/r.width,y:(e.clientY-r.top)*state.project.canvas.height/r.height};};
  function preview(){
    if(!state)return;svg.replaceChildren();const size=state.project.canvas;svg.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);
    const source=selectedClip(),clip=source&&evaluated(playback.project.clips.find(c=>c.id===source.id)||source),b=clip&&bounds(clip),enabled=visual(clip)&&active(clip)&&!locked(clip);
    $('previewCenter').disabled=$('previewReset').disabled=!enabled;
    if(!enabled||!b||exporting)return;
    const t=displayed(clip),points=G.handles(b),scale=size.width/Math.max(1,canvas.getBoundingClientRect().width),r=5*scale;
    element('polygon',{points:['nw','ne','se','sw'].map(k=>{const p=G.world(points[k],t,size);return `${p.x},${p.y}`;}).join(' '),class:'selection-outline','data-handle':'move'});
    for(const [name,p] of Object.entries(points)){const q=G.world(p,t,size);element('rect',{x:q.x-r,y:q.y-r,width:r*2,height:r*2,rx:scale,class:'selection-handle','data-handle':name,'aria-label':`${name} 크기 조절`,role:'button',tabindex:0});}
    const top=G.world(points.n,t,size),direction=G.rotate({x:0,y:-28*scale},t.rotation),rotation={x:top.x+direction.x,y:top.y+direction.y};
    element('line',{x1:top.x,y1:top.y,x2:rotation.x,y2:rotation.y,class:'selection-line'});element('circle',{cx:rotation.x,cy:rotation.y,r:r*1.15,class:'selection-handle rotate-handle','data-handle':'rotate',role:'button',tabindex:0,'aria-label':'회전 조절'});
    for(const axis of gesture?.guides||[])element('line',axis==='x'?{x1:size.width/2,y1:0,x2:size.width/2,y2:size.height,class:'alignment-guide'}:{x1:0,y1:size.height/2,x2:size.width,y2:size.height/2,class:'alignment-guide'});
  }
  function drag(event,node,move,finish){
    event.preventDefault();event.stopPropagation();node.setPointerCapture(event.pointerId);let moved=false;
    const start={x:event.clientX,y:event.clientY};
    const end=cancel=>{node.removeEventListener('pointermove',onMove);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',cancelled);node.removeEventListener('lostpointercapture',cancelled);document.removeEventListener('keydown',escape,true);if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);finish(cancel||!moved,moved);};
    const onMove=e=>{if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<2&&!moved)return;moved=true;move(e);},up=()=>end(false),cancelled=()=>end(true),escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end(true);}};
    node.addEventListener('pointermove',onMove);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',cancelled);node.addEventListener('lostpointercapture',cancelled);document.addEventListener('keydown',escape,true);
  }
  function startPreview(event){
    if(event.button!==0||busy||exporting||gesture||!state)return;playback.pause();const at=point(event);let source=selectedClip(),handle=event.target.dataset.handle;
    if(!handle){
      source=null;
      for(const track of state.project.tracks){if(track.hidden||track.locked)continue;const candidates=state.project.clips.filter(c=>c.trackId===track.id&&visual(c)&&active(c)).sort((a,b)=>b.startTime-a.startTime||state.project.clips.indexOf(b)-state.project.clips.indexOf(a));for(const c of candidates){const v=evaluated(c),b=bounds(v);if(b&&G.contains(at,b,displayed(v),state.project.canvas)){source=c;break;}}if(source)break;}
      selected=new Set(source?[source.id]:[]);renderSelection();renderInspector();handle='move';
    }
    if(!source||locked(source)||!active(source)||!visual(source))return;canvas.focus();playback.seek(source.startTime+relative(source));const clip=evaluated(source),b=bounds(clip);if(!b)return;
    const initial={...clip.transform},displayInitial=displayed(clip),effect=transition(clip),start=at,time=relative(source),draft=structuredClone(state.project),target=draft.clips.find(c=>c.id===source.id);let next={...initial};
    gesture={id:source.id,guides:[]};playback.project=draft;
    drag(event,svg,event=>{
      const p=point(event);gesture.guides=[];
      if(handle==='move'){
        next={...initial,x:initial.x+p.x-start.x,y:initial.y+p.y-start.y};if(event.shiftKey){if(Math.abs(p.x-start.x)>Math.abs(p.y-start.y))next.y=initial.y;else next.x=initial.x;}
        if(snap&&!event.altKey){const center=G.world({x:b.x+b.width/2,y:b.y+b.height/2},displayed({...clip,transform:next}),state.project.canvas),threshold=6*state.project.canvas.width/canvas.clientWidth;for(const axis of ['x','y']){const destination=axis==='x'?state.project.canvas.width/2:state.project.canvas.height/2;if(Math.abs(center[axis]-destination)<threshold){next[axis]+=destination-center[axis];gesture.guides.push(axis);}}}
      }else if(handle==='rotate'){
        const center={x:state.project.canvas.width/2+displayInitial.x,y:state.project.canvas.height/2+displayInitial.y},angle=q=>Math.atan2(q.y-center.y,q.x-center.x)*180/Math.PI;let delta=angle(p)-angle(start);delta=((delta+540)%360)-180;next={...initial,rotation:initial.rotation+delta};if(event.shiftKey)next.rotation=Math.round(next.rotation/15)*15;
      }else {const resized=G.resize(displayInitial,b,handle,p,state.project.canvas,!event.shiftKey,{min:.001*effect.scale,max:4*effect.scale});next={...resized,x:resized.x-effect.x,scaleX:resized.scaleX/effect.scale,scaleY:resized.scaleY/effect.scale};}
      target.transform={...next};target.keyframes=target.keyframes.filter(k=>!['x','y','scaleX','scaleY','rotation'].includes(k.property));playback.draw();$('previewEditHint').textContent=`X ${Math.round(next.x)} · Y ${Math.round(next.y)} · 크기 ${Math.round(next.scaleX*100)}% · 회전 ${Math.round(next.rotation)}°`;
    },cancel=>{gesture=null;playback.project=state.project;playback.draw();if(!cancel){const values=Object.fromEntries(['x','y','scaleX','scaleY','rotation'].map(k=>[k,next[k]]));edit({type:'transformDirect',id:source.id,time,values,autoKey:$('previewAutoKey').checked});}$('previewEditHint').textContent='모서리: 비율 유지 · Shift: 자유 크기 · Esc: 취소';});
  }
  canvas.addEventListener('pointerdown',startPreview);svg.addEventListener('pointerdown',startPreview);
  for(const node of [canvas,svg])node.addEventListener('keydown',event=>{
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},source=selectedClip();if(!steps[event.key]||!visual(source)||!active(source)||locked(source)||busy||gesture)return;
    event.preventDefault();event.stopPropagation();const [dx,dy]=steps[event.key],t=evaluated(source).transform,n=event.shiftKey?10:1;edit({type:'transformDirect',id:source.id,time:relative(source),values:{x:t.x+dx*n,y:t.y+dy*n},autoKey:$('previewAutoKey').checked});
  });
  $('previewCenter').onclick=()=>{const c=selectedClip();if(!c||locked(c))return;const t=evaluated(c).transform,b=bounds(c),p=G.world({x:b.x+b.width/2,y:b.y+b.height/2},displayed(evaluated(c)),state.project.canvas);edit({type:'transformDirect',id:c.id,time:relative(c),values:{x:t.x+state.project.canvas.width/2-p.x,y:t.y+state.project.canvas.height/2-p.y},autoKey:$('previewAutoKey').checked});};
  $('previewReset').onclick=()=>{const c=selectedClip();if(c&&!locked(c))edit({type:'transformDirect',id:c.id,time:relative(c),values:{x:0,y:0,scaleX:1,scaleY:1,rotation:0},autoKey:$('previewAutoKey').checked});};
  const toolbar=document.createElement('div');toolbar.className='timeline-key-tools';toolbar.innerHTML='<strong>키프레임</strong><select id="timelineKeyProperty" aria-label="타임라인 키프레임 속성"></select><button id="timelineKeyPrevious" title="이전 키프레임">◀ ◆</button><button id="timelineKeyAdd" title="재생 헤드에 키프레임 추가 (K)">＋ ◆ 추가</button><button id="timelineKeyNext" title="다음 키프레임">◆ ▶</button><button id="timelineKeyDelete" title="선택한 키프레임 삭제">지점 삭제</button><span>빈 줄 두 번 클릭: 추가 · ◆ 드래그: 이동</span>';
  document.querySelector('.timeline-toolbar').after(toolbar);$('timelineKeyProperty').innerHTML=$('keyProperty').innerHTML;
  const property=()=>$('timelineKeyProperty').value;
  function addKey(time){const c=selectedClip();if(!c||locked(c)||busy)return;const t=G.clamp(frame(time),0,c.duration),p=property();chosenKey={id:c.id,property:p,time:t};edit({type:'keyframe',id:c.id,operation:'set',property:p,time:t,value:OcutKeyframes.value(c,p,t),interpolation:'linear'});}
  $('timelineKeyAdd').onclick=()=>{const c=selectedClip();if(c)addKey(playback.time-c.startTime);};
  $('timelineKeyProperty').onchange=()=>{$('keyProperty').value=property();chosenKey=null;renderKeyframes();timeline();};
  $('keyProperty').addEventListener('change',()=>{$('timelineKeyProperty').value=$('keyProperty').value;chosenKey=null;timeline();});
  for(const [id,direction] of [['timelineKeyPrevious',-1],['timelineKeyNext',1]])$(id).onclick=()=>{const c=selectedClip();if(!c)return;const points=OcutKeyframes.frames(c,property()),t=playback.time-c.startTime,k=direction<0?[...points].reverse().find(k=>k.time<t-1e-7):points.find(k=>k.time>t+1e-7);if(k){playback.pause();playback.seek(c.startTime+k.time);chosenKey={id:c.id,property:k.property,time:k.time};keyAtTime(k.time);timeline();}};
  function deleteKey(){if(!chosenKey||busy)return;const {id,property,time}=chosenKey;chosenKey=null;edit({type:'keyframe',id,property,time,operation:'delete'});}
  $('timelineKeyDelete').onclick=deleteKey;
  function timeline(){
    if(!state||gesture)return;const c=selectedClip(),refocus=document.activeElement?.classList.contains('timeline-key');
    for(const lane of $('tracks').children){lane.style.height=`${lane.dataset.baseHeight||61}px`;lane.querySelector('.timeline-key-lane')?.remove();}for(const head of $('trackHeaders').children)head.style.height=`${head.dataset.baseHeight||61}px`;
    for(const id of ['timelineKeyProperty','timelineKeyPrevious','timelineKeyAdd','timelineKeyNext'])$(id).disabled=!c||locked(c);
    if(!c){$('timelineKeyDelete').disabled=true;return;}
    if(chosenKey&&(chosenKey.id!==c.id||!c.keyframes.some(k=>k.property===chosenKey.property&&Math.abs(k.time-chosenKey.time)<1e-7)))chosenKey=null;
    $('timelineKeyDelete').disabled=!chosenKey||locked(c);
    for(const option of $('timelineKeyProperty').options)option.disabled=['audio','music'].includes(c.type)?option.value!=='volume':option.value==='volume'&&(!state.assets[c.source]?.hasAudio||c.effects.some(e=>e.type==='audioVisualizer'));
    if($('timelineKeyProperty').selectedOptions[0].disabled)$('timelineKeyProperty').value=['audio','music'].includes(c.type)?'volume':'x';
    const p=property(),lane=[...$('tracks').children].find(n=>n.dataset.trackId===c.trackId),head=[...$('trackHeaders').children].find(n=>n.dataset.trackId===c.trackId);lane.style.height=head.style.height=`${Number(lane.dataset.baseHeight||61)+29}px`;
    const row=document.createElement('div');row.className='timeline-key-lane';row.style.top=`${Number(lane.dataset.baseHeight||61)}px`;row.style.left=`${c.startTime*zoom}px`;row.style.width=`${Math.max(4,c.duration*zoom)}px`;row.title='두 번 클릭하여 키프레임 추가';row.ondblclick=e=>{e.stopPropagation();$('keyProperty').value=p;addKey((e.clientX-row.getBoundingClientRect().left)/zoom);};lane.append(row);
    for(const k of OcutKeyframes.frames(c,p)){
      const marker=document.createElement('button');marker.className='timeline-key';marker.textContent='◆';marker.style.left=`${k.time*zoom}px`;marker.dataset.time=k.time;marker.dataset.property=p;marker.setAttribute('aria-label',`${p} ${k.time.toFixed(3)}초 키프레임`);marker.classList.toggle('chosen',chosenKey?.time===k.time&&chosenKey?.property===p);marker.disabled=locked(c);row.append(marker);if(refocus&&chosenKey?.time===k.time&&chosenKey?.property===p)marker.focus();
      marker.onpointerdown=e=>{if(e.button!==0||busy||locked(c))return;e.stopPropagation();marker.focus();playback.pause();chosenKey={id:c.id,property:p,time:k.time};$('timelineKeyDelete').disabled=false;$('keyProperty').value=p;playback.seek(c.startTime+k.time);keyAtTime(k.time);const start=e.clientX;let to=k.time;gesture={id:c.id};drag(e,marker,move=>{to=G.clamp(frame(k.time+(move.clientX-start)/zoom),0,c.duration);marker.style.left=`${to*zoom}px`;marker.title=`${to.toFixed(3)}초`;},cancel=>{gesture=null;if(!cancel&&to!==k.time){chosenKey.time=to;playback.seek(c.startTime+to);edit({type:'keyframeMove',id:c.id,property:p,from:k.time,time:to});}else timeline();});};
      marker.onkeydown=e=>{if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();chosenKey={id:c.id,property:p,time:k.time};deleteKey();}else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();const to=G.clamp(frame(k.time+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1)/state.project.canvas.fps),0,c.duration);chosenKey={id:c.id,property:p,time:to};edit({type:'keyframeMove',id:c.id,property:p,from:k.time,time:to});}else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();chosenKey={id:c.id,property:p,time:k.time};playback.seek(c.startTime+k.time);keyAtTime(k.time);$('timelineKeyDelete').disabled=false;}};
    }
  }
  function fadeVisual(node,clip){
    node.querySelector('.fade-envelope')?.remove();const envelope=document.createElementNS(ns,'svg');envelope.classList.add('fade-envelope');envelope.setAttribute('viewBox','0 0 100 40');envelope.setAttribute('preserveAspectRatio','none');
    const points=Array.from({length:41},(_,i)=>{const t=clip.duration*i/40,gain=i===40&&OcutAudioFades.lengths(clip).fadeOut===0?1:OcutAudioFades.gain(clip,t);return `${i*2.5},${39-gain*35}`;});element('polyline',{points:points.join(' '),fill:'none'},envelope);node.append(envelope);
  }
  function fades(){
    if(!state||gesture)return;
    for(const c of state.project.clips){const node=clipNodes.get(c.id);if(!node)continue;node.querySelectorAll('.fade-handle,.fade-envelope').forEach(n=>n.remove());if(!state.assets[c.source]?.hasAudio||c.effects.some(e=>e.type==='audioVisualizer'))continue;
      if(!selected.has(c.id)&&!c.effects.some(e=>e.type==='audioFade'&&e.enabled))continue;fadeVisual(node,c);if(!selected.has(c.id))continue;const lengths=OcutAudioFades.lengths(c);
      for(const side of ['fadeIn','fadeOut']){const h=document.createElement('button');h.className=`fade-handle ${side}`;h.textContent=side==='fadeIn'?'◢':'◣';h.dataset.fade=side;h.setAttribute('aria-label',side==='fadeIn'?'오디오 페이드 인 조절':'오디오 페이드 아웃 조절');h.title=`${side==='fadeIn'?'페이드 인':'페이드 아웃'} ${lengths[side].toFixed(2)}초 · 드래그 조절 · 두 번 클릭 초기화`;h.disabled=locked(c);h.style.left=`${G.clamp((side==='fadeIn'?lengths[side]:c.duration-lengths[side])*zoom,9,Math.max(9,c.duration*zoom-9))}px`;node.append(h);
        const commit=value=>edit({type:'update',id:c.id,values:{audioFade:{...lengths,[side]:value}}});
        h.ondblclick=e=>{e.stopPropagation();commit(0);};h.onpointerdown=e=>{if(e.button!==0||busy||locked(c))return;e.stopPropagation();playback.pause();selected=new Set([c.id]);renderInspector();const start=e.clientX;let value=lengths[side];gesture={id:c.id};drag(e,h,move=>{value=G.clamp(frame(lengths[side]+(move.clientX-start)/zoom*(side==='fadeIn'?1:-1)),0,c.duration);h.style.left=`${(side==='fadeIn'?value:c.duration-value)*zoom}px`;h.title=`${value.toFixed(2)}초`;const draft={...c,effects:[...c.effects.filter(e=>e.type!=='audioFade'),{type:'audioFade',enabled:true,parameters:{...lengths,[side]:value}}]};fadeVisual(node,draft);message(`${side==='fadeIn'?'페이드 인':'페이드 아웃'} ${value.toFixed(2)}초`);},(cancel,moved)=>{gesture=null;if(!cancel)commit(value);else if(moved)renderSelection();});};
        h.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();const delta=(e.key==='ArrowLeft'?-1:1)*(side==='fadeIn'?1:-1)*(e.shiftKey?1:.1);commit(e.key==='Home'?0:G.clamp(lengths[side]+delta,0,c.duration));}};
      }
    }
  }
  document.addEventListener('keydown',e=>{if(gesture&&!['Escape','Shift','Alt','Control','Meta'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();return;}if(e.defaultPrevented||busy||exporting||e.ctrlKey||e.metaKey||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;if(e.key.toLowerCase()==='k'){e.preventDefault();$('timelineKeyAdd').click();}},true);
  window.directEditor={render(){preview();timeline();fades();},preview,bounds};playback.onDraw=preview;new ResizeObserver(preview).observe(canvas);if(state)directEditor.render();
})();
