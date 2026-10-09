'use strict';
class OcutWorkspacePanels {
  constructor(workspace){
    this.workspace=workspace;this.mode='edit';this.preferences={};
    try{
      const saved=JSON.parse(localStorage.getItem('ocut.layout.v2'));
      if(saved&&['edit','focus','music'].includes(saved.mode)){this.mode=saved.mode;for(const mode of ['edit','focus','music']){const p=saved.sizes?.[mode];if(p&&typeof p==='object')this.preferences[mode]=Object.fromEntries(['left','third','bottom'].filter(k=>Number.isFinite(p[k])).map(k=>[k,p[k]]));}}
      else {const old=JSON.parse(localStorage.getItem('ocut.layout.v1'));if(old){if(['edit','focus','music'].includes(old.mode))this.mode=old.mode;this.preferences.edit={left:old.width,bottom:old.height};this.preferences.focus={left:old.width,bottom:old.height};}}
    }catch{}
    this.layer=document.createElement('div');this.layer.className='workspace-splitters';document.body.append(this.layer);this.handles={};
    for(const [part,orientation] of [['left','vertical'],['third','vertical'],['bottom','horizontal']]){
      const handle=document.createElement('div');handle.id=`resize-${part}`;handle.className=`panel-resizer ${orientation}`;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',orientation);handle.title='드래그 또는 방향키로 크기 조절 · 두 번 클릭으로 이 경계 초기화';this.layer.append(handle);this.handles[part]=handle;
      handle.onpointerdown=event=>{
        if(event.button!==0)return;event.preventDefault();handle.focus();handle.setPointerCapture(event.pointerId);
        const start=orientation==='vertical'?event.clientX:event.clientY,box=this.box,mode=this.mode,previous={...(this.preferences[mode]||{})};
        document.documentElement.classList.add(orientation==='vertical'?'resizing-columns':'resizing-rows');handle.classList.add('dragging');
        const finish=cancel=>{if(cancel)this.preferences[mode]=previous;handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;handle.onlostpointercapture=null;document.removeEventListener('keydown',escape,true);handle.classList.remove('dragging');document.documentElement.classList.remove('resizing-columns','resizing-rows');if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);this.render();this.save();};
        const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}};document.addEventListener('keydown',escape,true);
        handle.onpointermove=e=>{this.preferences[mode]=OcutWorkspaceLayout.resize(mode,box,part,(orientation==='vertical'?e.clientX:e.clientY)-start);this.render();};
        handle.onpointerup=()=>finish(false);handle.onpointercancel=()=>finish(true);handle.onlostpointercapture=()=>finish(true);
      };
      handle.onkeydown=event=>{
        const direction=orientation==='vertical'?{ArrowLeft:-1,ArrowRight:1}:{ArrowUp:-1,ArrowDown:1};
        if(!Object.hasOwn(direction,event.key)&&!['Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();const delta=event.key==='Home'?-100000:event.key==='End'?100000:direction[event.key]*(event.shiftKey?50:10);
        this.preferences[this.mode]=OcutWorkspaceLayout.resize(this.mode,this.box,part,delta);this.render();this.save();
      };
      handle.ondblclick=()=>{const defaults=OcutWorkspaceLayout.measure(this.mode,this.workspace.clientWidth,this.workspace.clientHeight);this.preferences[this.mode]={left:this.box.left,third:this.box.third,bottom:this.box.bottom,[part]:defaults[part]};this.render();this.save();};
    }
    this.observer=new ResizeObserver(()=>this.render());this.observer.observe(workspace);
  }
  save(){try{localStorage.setItem('ocut.layout.v2',JSON.stringify({mode:this.mode,sizes:this.preferences}));}catch{}}
  setMode(mode){this.mode=mode;this.render();this.save();}
  reset(){this.preferences={};this.render();this.save();}
  setLeft(value){this.preferences[this.mode]=OcutWorkspaceLayout.resize(this.mode,this.box,'left',value-this.box.left);this.render();this.save();}
  setBottom(value){this.preferences[this.mode]={left:this.box.left,third:this.box.third,bottom:value};this.render();this.save();}
  render(){
    const w=this.workspace;if(!w.clientWidth||!w.clientHeight)return;
    this.box=OcutWorkspaceLayout.measure(this.mode,w.clientWidth,w.clientHeight,this.preferences[this.mode]);const b=this.box;
    w.style.gridTemplateColumns=b.columns.map(n=>`${n}px`).join(' ');w.style.gridTemplateRows=`minmax(0,1fr) ${b.bottom}px`;w.classList.toggle('wide-composer',this.mode==='music'&&b.left>=700);
    for(const [id,min,max,value] of [['libraryWidth',b.leftMin,this.mode==='music'?b.left+b.third-b.thirdMin:b.width-b.third-b.centerMin,b.left],['timelineHeight',140,b.bottomMax,b.bottom]]){const input=document.getElementById(id);input.min=min;input.max=max;input.value=value;}
    const bounds=w.getBoundingClientRect(),top=bounds.top,height=b.height-b.bottom,boundary=this.mode==='music'?b.left+b.third:b.width-b.third;
    for(const [part,left,label] of [['left',b.left,this.mode==='music'?'음악 작성과 곡 목록 사이 너비':'도구와 미리보기 사이 너비'],['third',boundary,this.mode==='music'?'곡 목록과 미리보기 사이 너비':'미리보기와 설정 사이 너비']]){
      const h=this.handles[part];h.hidden=part==='third'&&this.mode==='focus';h.style.left=`${bounds.left+left-4}px`;h.style.top=`${top}px`;h.style.height=`${height}px`;h.setAttribute('aria-label',label);h.setAttribute('aria-valuenow',Math.round(b[part]));h.setAttribute('aria-valuemin',part==='left'?b.leftMin:b.thirdMin);h.setAttribute('aria-valuemax',Math.round(part==='left'&&this.mode==='music'?b.left+b.third-b.thirdMin:b.width-(part==='left'?b.third:b.left)-b.centerMin));
    }
    const h=this.handles.bottom;h.style.left=`${bounds.left}px`;h.style.top=`${top+height-4}px`;h.style.width=`${b.width}px`;h.setAttribute('aria-label','작업 화면과 타임라인 사이 높이');h.setAttribute('aria-valuenow',Math.round(b.bottom));h.setAttribute('aria-valuemin','140');h.setAttribute('aria-valuemax',Math.round(b.bottomMax));
    if(typeof renderRuler==='function'&&typeof state!=='undefined'&&state)renderRuler();
  }
}
