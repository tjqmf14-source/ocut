'use strict';
const { randomUUID } = require('node:crypto');
const { createTrack, createClip, validateProject } = require('./project.cjs');
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
    track = createTrack(type, { image: '이미지', video: '영상', audio: '오디오', text: '텍스트' }[type] || type);
    project.tracks.splice(type === 'audio' ? project.tracks.length : 0, 0, track);
  }
  return track;
}
function command(project, action) {
  if (!action || typeof action.type !== 'string') throw Error('잘못된 편집 명령입니다.');
  const frame = 1 / project.canvas.fps;
  switch (action.type) {
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
    case 'text': {
      const track = trackFor(project, 'text');
      const clip = createClip({ trackId: track.id, type: 'text', startTime: frameTime(action.startTime || 0, project.canvas.fps), duration: 3, text: action.text || '나의 이야기' });
      project.clips.push(clip); return clip.id;
    }
    case 'split': {
      const clip = writable(project, action.id);
      if (clip.keyframes.length || clip.effects.length) throw Error('효과/키프레임 클립의 분할은 아직 지원하지 않습니다.');
      const at = frameTime(action.time, project.canvas.fps);
      const left = at - clip.startTime;
      if (left < frame - 1e-7 || clip.duration - left < frame - 1e-7) throw Error('클립 내부의 프레임에서 분할해 주세요.');
      const right = structuredClone(clip); right.id = randomUUID();
      right.startTime = at; right.duration = clip.duration - left; right.sourceStart = clip.sourceStart + left * clip.speed;
      clip.duration = left; clip.sourceEnd = right.sourceStart;
      project.clips.splice(project.clips.indexOf(clip) + 1, 0, right); return right.id;
    }
    case 'update': {
      const clip = writable(project, action.id);
      const fields = ['startTime', 'duration', 'sourceStart', 'speed', 'text', 'volume', 'opacity', 'transform'];
      if (!action.values || Object.keys(action.values).some(key => !fields.includes(key))) throw Error('지원하지 않는 클립 속성입니다.');
      for (const [key, value] of Object.entries(action.values)) {
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
