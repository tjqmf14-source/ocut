'use strict';
const { randomUUID } = require('node:crypto');
const { createTrack, createClip, validateProject } = require('./project.cjs');
const { defaults: visualDefaults, validate: validateVisualizer } = require('./visualizer.js');
const {defaults:textDefaults,validate:validateTextStyle,get:textStyle}=require('./text-style.js');
const {split:splitKeyframes}=require('./keyframes.js');
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
    track = createTrack(type, { image: '이미지', video: '영상', audio: '오디오', music: 'AI 음악', text: '텍스트', subtitle: '자막', overlay: '시각화' }[type] || type);
    const rank = item => ['text', 'subtitle'].includes(item) ? 0 : item === 'overlay' ? 1 : ['audio', 'music'].includes(item) ? 3 : 2;
    const at = project.tracks.findIndex(item => rank(item.type) > rank(type));
    project.tracks.splice(at < 0 ? project.tracks.length : at, 0, track);
  }
  return track;
}
function command(project, action) {
  if (!action || typeof action.type !== 'string') throw Error('잘못된 편집 명령입니다.');
  const frame = 1 / project.canvas.fps;
  switch (action.type) {
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
    case 'split': {
      const clip = writable(project, action.id);
      if (clip.effects.some(e=>!['audioVisualizer','textStyle'].includes(e.type))) throw Error('페이드/기타 효과 클립의 분할은 아직 지원하지 않습니다.');
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
      const fields = ['startTime', 'duration', 'sourceStart', 'speed', 'text', 'volume', 'opacity', 'transform', 'audioFade', 'visualizer', 'textStyle'];
      if (!action.values || Object.keys(action.values).some(key => !fields.includes(key))) throw Error('지원하지 않는 클립 속성입니다.');
      for (const [key, value] of Object.entries(action.values)) {
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
        // Remove intervals right-to-left; overlapping clips stay at their current time.
        for (const removed of clips.sort((a, b) => b.startTime - a.startTime)) {
          for (const clip of project.clips) if (clip.trackId === removed.trackId && clip.startTime >= removed.startTime + removed.duration - 1e-7) clip.startTime -= removed.duration;
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
