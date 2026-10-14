'use strict';
const { randomUUID } = require('node:crypto');
const { createTrack, createClip, validateProject } = require('./project.cjs');
const { defaults: visualDefaults, validate: validateVisualizer } = require('./visualizer.js');
const {defaults:textDefaults,validate:validateTextStyle,get:textStyle}=require('./text-style.js');
const {split:splitKeyframes,trim:trimKeyframes}=require('./keyframes.js');
const {defaults:colorDefaults,validate:validateColor,active:colorActive}=require('./color-filters.js');
const {defaults:textureDefaults,validate:validateTexture,active:textureActive}=require('./texture.js');
const {defaults:transitionDefaults,validate:validateTransition,active:transitionActive,get:transitionGet}=require('./transitions.js');
const durationOf = project => Math.max(0, ...project.clips.map(clip => clip.startTime + clip.duration));
const frameTime = (time, fps) => Math.round(time * fps) / fps;
function writable(project, id) {
  const clip = project.clips.find(item => item.id === id);
  if (!clip) throw Error('클립을 찾을 수 없습니다.');
  if (project.tracks.find(track => track.id === clip.trackId)?.locked) throw Error('잠긴 트랙은 편집할 수 없습니다.');
  return clip;
}
function trackFor(project, type) {
  let track = project.tracks.find(item => item.type === type && !item.locked);
  if (!track) {
    track = createTrack(type, { image: '이미지', video: '영상', audio: '오디오', music: 'AI 음악', text: '텍스트', subtitle: '자막', overlay: '장식 · 시각화' }[type] || type);
    const rank = item => ['text', 'subtitle'].includes(item) ? 0 : item === 'overlay' ? 1 : ['audio', 'music'].includes(item) ? 3 : 2;
    const at = project.tracks.findIndex(item => rank(item.type) > rank(type));
    project.tracks.splice(at < 0 ? project.tracks.length : at, 0, track);
  }
  return track;
}
function selection(project,ids){
  if(!Array.isArray(ids)||!ids.length)throw Error('편집할 클립을 선택해 주세요.');
  return [...new Set(ids)].map(id=>writable(project,id));
}
function unionIntervals(intervals){
  const result=[];
  for(const [start,end] of intervals.sort((a,b)=>a[0]-b[0])){
    const last=result.at(-1);
    if(last&&start<=last[1])last[1]=Math.max(last[1],end);
    else result.push([start,end]);
  }
  return result;
}
function vacantIntervals(removed,survivors){
  let vacant=unionIntervals(removed.map(c=>[c.startTime,c.startTime+c.duration]));
  for(const [start,end] of unionIntervals(survivors.map(c=>[c.startTime,c.startTime+c.duration]))){
    vacant=vacant.flatMap(([a,b])=>end<=a||start>=b?[[a,b]]:[...(a<start?[[a,start]]:[]),...(end<b?[[end,b]]:[])]);
  }
  return vacant;
}
function command(project, action) {
  if (!action || typeof action.type !== 'string') throw Error('잘못된 편집 명령입니다.');
  const frame = 1 / project.canvas.fps;
  switch (action.type) {
    case 'extractAudio': {
      const clip=writable(project,action.id),media=project.media.find(m=>m.id===clip.source);
      if(clip.type!=='video'||media?.type!=='video')throw Error('오디오를 분리할 영상 클립을 선택해 주세요.');
      const keys=require('./keyframes.js'),volumeKeys=keys.frames(clip,'volume');
      const boundaries=[...new Set([0,...volumeKeys.map(k=>k.time),clip.duration])].sort((a,b)=>a-b);
      // Sampling each interval detects any positive linear/held gain, excluding the end instant.
      if(!boundaries.slice(1).some((end,i)=>keys.value(clip,'volume',(boundaries[i]+end)/2)>0))throw Error('이미 음소거된 영상입니다. 분리된 오디오 클립을 사용해 주세요.');
      const track=trackFor(project,'audio');
      const audio=createClip({trackId:track.id,type:'audio',source:clip.source,startTime:clip.startTime,duration:clip.duration,sourceStart:clip.sourceStart,speed:clip.speed});
      audio.sourceEnd=clip.sourceEnd;audio.volume=clip.volume;
      audio.keyframes=structuredClone(volumeKeys);
      audio.effects=clip.effects.filter(e=>e.type==='audioFade').map(e=>({...structuredClone(e),id:randomUUID()}));
      clip.volume=0;clip.keyframes=clip.keyframes.filter(k=>k.property!=='volume');
      project.clips.push(audio);return audio.id;
    }
    case 'transformDirect': {
      const clip=writable(project,action.id),time=frameTime(action.time,project.canvas.fps),keys=require('./keyframes.js');
      if(['audio','music'].includes(clip.type)||!Number.isFinite(time)||time<0||time>clip.duration||!action.values||typeof action.values!=='object')throw Error('화면에 표시되는 클립과 클립 안 시간을 선택해 주세요.');
      for(const [property,value] of Object.entries(action.values)){
        if(!['x','y','scaleX','scaleY','rotation'].includes(property)||!Number.isFinite(value)||value<keys.ranges[property][0]||value>keys.ranges[property][1])throw Error('위치·크기·회전 범위를 확인해 주세요.');
        if(Math.abs(keys.value(clip,property,time)-value)<1e-9)continue;
        const animated=clip.keyframes.some(k=>k.property===property);
        if(animated||action.autoKey===true){
          if(!animated&&time>0)clip.keyframes.push({property,time:0,value:keys.base(clip,property),interpolation:'linear'});
          const old=clip.keyframes.find(k=>k.property===property&&Math.abs(k.time-time)<1e-7);
          clip.keyframes=clip.keyframes.filter(k=>k!==old);clip.keyframes.push({property,time,value,interpolation:old?.interpolation||'linear'});
        }else clip.transform[property]=value;
      }
      clip.keyframes.sort((a,b)=>a.time-b.time||a.property.localeCompare(b.property));return clip.id;
    }
    case 'keyframeMove': {
      const clip=writable(project,action.id),time=frameTime(action.time,project.canvas.fps),point=clip.keyframes.find(k=>k.property===action.property&&Math.abs(k.time-action.from)<1e-7);
      if(!point||!Number.isFinite(time)||time<0||time>clip.duration)throw Error('키프레임을 클립 범위 안으로 이동해 주세요.');
      if(clip.keyframes.some(k=>k!==point&&k.property===point.property&&Math.abs(k.time-time)<1e-7))throw Error('같은 위치에 키프레임이 있습니다.');
      point.time=time;clip.keyframes.sort((a,b)=>a.time-b.time||a.property.localeCompare(b.property));return clip.id;
    }
    case 'dissolve': {
      const clip=writable(project,action.id),duration=Number(action.duration);
      if(!['video','image'].includes(clip.type)||!Number.isFinite(duration)||duration<=0||duration>30)throw Error('영상/이미지 클립과 30초 이하 전환 길이를 선택해 주세요.');
      const peers=project.clips.filter(c=>c.trackId===clip.trackId).sort((a,b)=>a.startTime-b.startTime),index=peers.indexOf(clip),previous=peers[index-1];
      if(!previous||Math.abs(previous.startTime+previous.duration-clip.startTime)>1e-6)throw Error('같은 트랙에서 바로 앞 클립과 경계를 맞춘 뒤 디졸브를 적용해 주세요.');
      if(duration>=Math.min(clip.duration,previous.duration))throw Error('전환은 두 클립보다 짧아야 합니다.');
      if(transitionGet(previous).outType!=='none')throw Error('앞 클립의 끝 전환을 먼저 없음으로 설정해 주세요.');
      for(const item of peers.slice(index))item.startTime-=duration;
      const parameters={...transitionGet(clip),inType:'dissolve',inDuration:duration};clip.effects=clip.effects.filter(e=>e.type!=='visualTransition');clip.effects.push({id:randomUUID(),type:'visualTransition',enabled:true,parameters});return clip.id;
    }
    case 'keyframe': {
      const clip=writable(project,action.id),{property,time}=action;
      if(!Number.isFinite(time)||time<0||time>clip.duration)throw Error('키프레임 시간은 클립 범위 안이어야 합니다.');
      if(!['set','delete','clear'].includes(action.operation))throw Error('지원하지 않는 키프레임 작업입니다.');
      clip.keyframes=clip.keyframes.filter(k=>k.property!==property||action.operation!=='clear'&&Math.abs(k.time-time)>1e-7);
      if(action.operation==='set')clip.keyframes.push({property,time,value:action.value,interpolation:action.interpolation});
      clip.keyframes.sort((a,b)=>a.time-b.time||a.property.localeCompare(b.property));return clip.id;
    }
    case 'visualizer': {
      const media = project.media.find(m => m.id === action.mediaId);
      if (!media || !['audio','video'].includes(media.type) || media.duration > 600) throw Error('10분 이하 오디오 소스를 선택해 주세요.');
      const track = trackFor(project,'overlay'),duration = Math.floor(media.duration * project.canvas.fps + 1e-6) / project.canvas.fps;
      const clip = createClip({trackId:track.id,type:'overlay',source:media.id,startTime:frameTime(action.startTime||0,project.canvas.fps),duration});
      clip.effects.push({id:randomUUID(),type:'audioVisualizer',enabled:true,parameters:{...visualDefaults}});
      project.clips.push(clip);return clip.id;
    }
    case 'music': {
      const media = action.media;
      if (!media || media.type !== 'audio' || !(media.duration > 0)) throw Error('음악 파일을 읽을 수 없습니다.');
      project.media.push(media);
      const track = trackFor(project, 'music');
      const duration = Math.floor(media.duration * project.canvas.fps + 1e-6) / project.canvas.fps;
      if (duration < frame) throw Error('한 프레임보다 짧은 음악입니다.');
      const startTime = Math.max(0, ...project.clips.filter(c => c.trackId === track.id).map(c => c.startTime + c.duration));
      const clip = createClip({ trackId: track.id, type: 'music', source: media.id, startTime, duration });
      project.clips.push(clip); return clip.id;
    }
    case 'sticker': {
      const media=action.media;
      if(!media||media.type!=='image')throw Error('장식 이미지를 읽을 수 없습니다.');
      project.media.push(media);const track=trackFor(project,'overlay');
      const clip=createClip({trackId:track.id,type:'overlay',source:media.id,startTime:frameTime(action.startTime||0,project.canvas.fps),duration:5});
      clip.transform.scaleX=.2;clip.transform.scaleY=.2;project.clips.push(clip);return clip.id;
    }
    case 'add': {
      const media = project.media.find(item => item.id === action.mediaId);
      if (!media) throw Error('미디어를 찾을 수 없습니다.');
      const track = trackFor(project, media.type);
      const duration = media.duration === null ? 5 : Math.floor(media.duration * project.canvas.fps + 1e-6) / project.canvas.fps;
      if (duration < frame) throw Error('한 프레임보다 짧은 미디어입니다.');
      const startTime = action.startTime == null
        ? Math.max(0, ...project.clips.filter(clip => clip.trackId === track.id).map(clip => clip.startTime + clip.duration))
        : frameTime(action.startTime, project.canvas.fps);
      const clip = createClip({ trackId: track.id, type: track.type, source: media.id, startTime, duration });
      project.clips.push(clip); return clip.id;
    }
    case 'text':
    case 'subtitle': {
      const track = trackFor(project, action.type);
      const clip = createClip({ trackId: track.id, type: action.type, startTime: frameTime(action.startTime || 0, project.canvas.fps), duration: 3, text: action.text || (action.type === 'subtitle' ? '자막을 입력하세요' : '나의 이야기') });
      if (action.type === 'subtitle') { clip.transform.y = project.canvas.height * .35; clip.transform.scaleX = clip.transform.scaleY = .7; }
      project.clips.push(clip); return clip.id;
    }
    case 'captions': {
      if (!Array.isArray(action.segments) || !action.segments.length || action.segments.length > 5000) throw Error('자막 구간 수가 올바르지 않습니다.');
      const track = trackFor(project, 'subtitle'); let first;
      for (const segment of action.segments) {
        if (typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 2000 || segment.startTime + segment.duration > 28800) throw Error('자막 내용 또는 시간이 올바르지 않습니다.');
        const clip = createClip({ trackId: track.id, type: 'subtitle', startTime: segment.startTime, duration: segment.duration, text: segment.text });
        clip.transform.y = project.canvas.height * .35; clip.transform.scaleX = clip.transform.scaleY = .7;
        project.clips.push(clip); first ||= clip.id;
      }
      return first;
    }
    case 'mergeCaptions': {
      const clips = [...new Set(action.ids || [])].map(id => writable(project, id)).sort((a, b) => a.startTime - b.startTime);
      if (clips.length < 2 || clips.some(c => c.type !== 'subtitle' || c.trackId !== clips[0].trackId)) throw Error('같은 자막 트랙의 구간을 두 개 이상 선택해 주세요.');
      const first = clips[0], end = Math.max(...clips.map(c => c.startTime + c.duration));
      if (project.clips.some(c => c.trackId === first.trackId && !clips.includes(c) && c.startTime < end && c.startTime + c.duration > first.startTime)) throw Error('선택한 자막 사이의 구간도 함께 선택해 주세요.');
      if (clips.some(c => c.effects.some(e=>e.type!=='textStyle') || c.keyframes.length || c.opacity !== first.opacity || JSON.stringify(c.transform) !== JSON.stringify(first.transform) || JSON.stringify(textStyle(c))!==JSON.stringify(textStyle(first)))) throw Error('같은 서식·배치·불투명도의 자막만 병합할 수 있습니다.');
      first.text = clips.map(c => c.text).filter((text, i, all) => i === 0 || text !== all[i - 1]).join('\n');
      if (first.text.length > 2000) throw Error('병합한 자막은 2000자를 넘을 수 없습니다.');
      first.duration = end - first.startTime; first.speed = 1; first.sourceStart = 0; first.sourceEnd = first.duration;
      project.clips = project.clips.filter(c => !clips.includes(c) || c === first); return first.id;
    }
    case 'trim': {
      const clip=writable(project,action.id);
      if(!['left','right'].includes(action.side)||!Number.isFinite(action.time))throw Error('트림 경계와 시간을 확인해 주세요.');
      const boundary=frameTime(action.time,project.canvas.fps),oldEnd=clip.startTime+clip.duration;
      const start=action.side==='left'?boundary:clip.startTime,end=action.side==='right'?boundary:oldEnd;
      if(start<0||end-start<frame-1e-7)throw Error('클립은 0초 이후에 한 프레임 이상이어야 합니다.');
      if(Math.abs(start-clip.startTime)<1e-9&&Math.abs(end-oldEnd)<1e-9)return clip.id;
      const offset=start-clip.startTime,sourceStart=clip.sourceStart+offset*clip.speed,sourceEnd=clip.sourceStart+(end-clip.startTime)*clip.speed;
      const media=project.media.find(m=>m.id===clip.source);
      if(sourceStart<-1e-7||(media?.duration!=null&&sourceEnd>media.duration+1e-7))throw Error('원본 미디어 범위 안에서 트림해 주세요.');
      clip.keyframes=trimKeyframes(clip,offset,end-clip.startTime);
      clip.startTime=start;clip.duration=end-start;clip.sourceStart=Math.max(0,sourceStart);clip.sourceEnd=clip.sourceStart+clip.duration*clip.speed;
      return clip.id;
    }
    case 'splitSelected': {
      const clips=selection(project,action.ids);
      if(!Number.isFinite(action.time))throw Error('분할 시간을 확인해 주세요.');
      const time=frameTime(action.time,project.canvas.fps),crossing=clips.filter(c=>time-c.startTime>=frame-1e-7&&c.startTime+c.duration-time>=frame-1e-7);
      if(!crossing.length)throw Error('선택한 클립 내부의 프레임에서 분할해 주세요.');
      let first;
      for(const clip of crossing){const id=command(project,{type:'split',id:clip.id,time});first??=id;}
      return first;
    }
    case 'duplicateSelected': {
      const clips=selection(project,action.ids),span=Math.max(...clips.map(c=>c.startTime+c.duration))-Math.min(...clips.map(c=>c.startTime));
      let first;
      for(const clip of clips){const copy=structuredClone(clip);copy.id=randomUUID();copy.startTime+=span;project.clips.push(copy);first??=copy.id;}
      return first;
    }
    case 'split': {
      const clip = writable(project, action.id);
      if (clip.effects.some(e=>!['audioVisualizer','textStyle','colorCorrection'].includes(e.type))) throw Error('전환·질감·페이드/기타 효과를 먼저 제거한 뒤 분할해 주세요.');
      const at = frameTime(action.time, project.canvas.fps);
      const left = at - clip.startTime;
      if (left < frame - 1e-7 || clip.duration - left < frame - 1e-7) throw Error('클립 내부의 프레임에서 분할해 주세요.');
      const right = structuredClone(clip); right.id = randomUUID();
      const keys=splitKeyframes(clip,left);clip.keyframes=keys.left;right.keyframes=keys.right;
      right.startTime = at; right.duration = clip.duration - left; right.sourceStart = clip.sourceStart + left * clip.speed;
      clip.duration = left; clip.sourceEnd = right.sourceStart;
      project.clips.splice(project.clips.indexOf(clip) + 1, 0, right); return right.id;
    }
    case 'update': {
      const clip = writable(project, action.id);
      const original=structuredClone(clip);
      const fields = ['startTime', 'duration', 'sourceStart', 'speed', 'text', 'volume', 'opacity', 'transform', 'audioFade', 'visualizer', 'textStyle', 'colorCorrection', 'visualTransition','texture'];
      if (!action.values || Object.keys(action.values).some(key => !fields.includes(key))) throw Error('지원하지 않는 클립 속성입니다.');
      for (const [key, value] of Object.entries(action.values)) {
        if(key==='visualTransition'){
          const parameters={...transitionDefaults,...value};validateTransition(parameters);clip.effects=clip.effects.filter(e=>e.type!=='visualTransition');
          if(transitionActive(parameters))clip.effects.push({id:randomUUID(),type:'visualTransition',enabled:true,parameters});continue;
        }
        if(key==='texture'){
          const parameters={...textureDefaults,...value};validateTexture(parameters);clip.effects=clip.effects.filter(e=>e.type!=='texture');
          if(textureActive(parameters))clip.effects.push({id:randomUUID(),type:'texture',enabled:true,parameters});continue;
        }
        if(key==='colorCorrection'){
          const parameters={...colorDefaults,...value};validateColor(parameters);clip.effects=clip.effects.filter(e=>e.type!=='colorCorrection');
          if(colorActive(parameters))clip.effects.push({id:randomUUID(),type:'colorCorrection',enabled:true,parameters});continue;
        }
        if(key==='textStyle'){
          if(!['text','subtitle'].includes(clip.type))throw Error('텍스트 또는 자막 클립을 선택해 주세요.');
          const parameters={...textDefaults,...value};validateTextStyle(parameters);
          clip.effects=clip.effects.filter(e=>e.type!=='textStyle');clip.effects.push({id:randomUUID(),type:'textStyle',enabled:true,parameters});continue;
        }
        if (key === 'visualizer') {
          const effect = clip.effects.find(e => e.type === 'audioVisualizer');
          if (!effect) throw Error('시각화 클립을 선택해 주세요.');
          const parameters = {...effect.parameters,...value};validateVisualizer(parameters);effect.parameters=parameters;continue;
        }
        if (key === 'audioFade') {
          if (!value || Object.keys(value).some(k => !['fadeIn','fadeOut'].includes(k)) || [value.fadeIn,value.fadeOut].some(n => !Number.isFinite(n) || n < 0 || n > 28800)) throw Error('페이드 길이는 0–28800초여야 합니다.');
          clip.effects = clip.effects.filter(e => e.type !== 'audioFade');
          if (value.fadeIn || value.fadeOut) clip.effects.push({id:randomUUID(),type:'audioFade',enabled:true,parameters:{...value}});
          continue;
        }
        clip[key] = key === 'transform' ? { ...clip.transform, ...value } : value;
      }
      if (clip.duration < frame - 1e-7) throw Error('클립은 한 프레임 이상이어야 합니다.');
      if(clip.speed===original.speed&&(clip.sourceStart!==original.sourceStart||clip.duration!==original.duration)){
        const offset=(clip.sourceStart-original.sourceStart)/clip.speed;
        clip.keyframes=trimKeyframes(original,offset,offset+clip.duration);
      }
      clip.sourceEnd = clip.sourceStart + clip.duration * clip.speed;
      return clip.id;
    }
    case 'move': {
      const ids = [...new Set(action.ids || [])];
      if (!Number.isFinite(action.delta)) throw Error('잘못된 이동 거리입니다.');
      for (const id of ids) { const clip = writable(project, id); clip.startTime = frameTime(clip.startTime + action.delta, project.canvas.fps); }
      return ids[0];
    }
    case 'duplicate': {
      const clip = writable(project, action.id); const copy = structuredClone(clip);
      copy.id = randomUUID(); copy.startTime += copy.duration; project.clips.push(copy); return copy.id;
    }
    case 'delete': {
      const ids = [...new Set(action.ids || [])];
      const clips = ids.map(id => writable(project, id));
      project.clips = project.clips.filter(clip => !ids.includes(clip.id));
      if (action.ripple) {
        // Close each vacated interval once, preserving every surviving clip's occupied time.
        for (const trackId of new Set(clips.map(c=>c.trackId))) {
          const survivors=project.clips.filter(c=>c.trackId===trackId),vacant=vacantIntervals(clips.filter(c=>c.trackId===trackId),survivors);
          for(const clip of survivors){const start=clip.startTime;clip.startTime-=vacant.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(start,b)-a),0);}
        }
      }
      return null;
    }
    case 'track': {
      const track = project.tracks.find(item => item.id === action.id);
      if (!track || !['locked', 'hidden', 'muted', 'solo'].includes(action.property) || typeof action.value !== 'boolean') throw Error('잘못된 트랙 설정입니다.');
      track[action.property] = action.value; return null;
    }
    default: throw Error('지원하지 않는 편집 명령입니다.');
  }
}
function applyCommand(history, action) {
  let selected;
  history.apply(action.type, project => { selected = command(project, action); validateProject(project); });
  return selected;
}
module.exports = { durationOf, frameTime, applyCommand };
