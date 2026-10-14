'use strict';
const { validateProject } = require('./project.cjs');
const { lengths } = require('./audio-fades.js');
const {visualTrack}=require('./visualizer.js');
const {animated,expression}=require('./keyframes.js');
function renderPlan(project, assets, textFiles, visualFiles = new Map()) {
  validateProject(project);
  const s = project.exportSettings, duration = Math.max(0, ...project.clips.map(c => c.startTime + c.duration));
  if (!duration || duration > 28800) throw Error('출력할 클립이 없거나 영상이 8시간을 초과합니다.');
  if (s.videoCodec !== 'h264') throw Error('현재 출력은 H.264를 지원합니다.');
  if (s.width > 3840 || s.height > 2160) throw Error('현재 출력은 최대 3840 × 2160을 지원합니다.');
  const args = [], graph = [], audio = [], scaleX = s.width / project.canvas.width, scaleY = s.height / project.canvas.height;
  let input = 0, layer = 0;
  graph.push(`color=c=${project.canvas.background}:s=${s.width}x${s.height}:r=${s.fps}:d=${duration},format=rgba[base0]`);
  const solo = project.tracks.some(t => t.solo && !visualTrack(project,t));
  for (const track of [...project.tracks].reverse()) for (const c of project.clips.filter(c => c.trackId === track.id).sort((a,b)=>a.startTime-b.startTime)) {
    if (c.effects.some(e => !['audioFade','audioVisualizer','textStyle','colorCorrection','visualTransition','texture'].includes(e.type)) || c.type === 'effect') throw Error('지원하지 않는 효과 출력입니다.');
    if (c.speed < .25 || c.speed > 4) throw Error('현재 미리보기와 출력은 0.25–4배속을 지원합니다.');
    const text = ['text', 'subtitle'].includes(c.type), asset = assets.get(c.source);
    const viz = c.effects.find(e=>e.type==='audioVisualizer');
    if (!text && !asset) throw Error('출력에 필요한 원본 미디어가 없습니다.');
    const visual = !track.hidden && !['audio', 'music'].includes(c.type) && (!viz || viz.enabled);
    const audible = !viz && asset?.hasAudio && !track.muted && (!solo || track.solo) && (c.volume > 0 || c.keyframes.some(k=>k.property==='volume'&&k.value>0));
    if (!visual && !audible) continue;
    const index = input++;
    const baked=visual&&animated(c);
    if (baked && !visualFiles.has(c.id)) throw Error(viz?'시각화 영상 레이어가 없습니다.':'키프레임 영상 레이어가 없습니다.');
    if (!baked&&(text || !viz && asset.type === 'image')) args.push('-loop', '1', '-framerate', String(s.fps));
    args.push('-protocol_whitelist', 'file,pipe', '-i', baked ? visualFiles.get(c.id) : text ? textFiles.get(c.id) : asset.path);
    let audioIndex=index;
    if(baked&&audible){audioIndex=input++;args.push('-protocol_whitelist','file,pipe','-i',asset.path);}
    if (audible) {
      let rate = c.speed; const tempo = [];
      while (rate < .5) { tempo.push('atempo=0.5'); rate /= .5; }
      while (rate > 2) { tempo.push('atempo=2'); rate /= 2; }
      tempo.push(`atempo=${rate}`);
      const tag = `a${index}`;
      const { fadeIn, fadeOut } = lengths(c);
      const fades = (fadeIn ? `,afade=t=in:st=0:d=${fadeIn}:curve=tri` : '') + (fadeOut ? `,afade=t=out:st=${c.duration-fadeOut}:d=${fadeOut}:curve=tri` : '');
      const volume=c.keyframes.some(k=>k.property==='volume')?`'${expression(c,'volume')}':eval=frame:precision=double`:String(c.volume);
      // Delay includes real leading silence; rebuild its timestamps from samples.
      // Some FFmpeg versions emit NOPTS for those delayed frames.
      graph.push(`[${audioIndex}:a:0]atrim=start=${c.sourceStart}:end=${c.sourceEnd},asetpts=PTS-STARTPTS,${tempo.join(',')},volume=${volume}${fades},aresample=48000,adelay=${Math.round(c.startTime * 48000)}S:all=1,asetpts=N/SR/TB[${tag}]`);
      audio.push(`[${tag}]`);
    }
    if (!visual) continue;
    let filter;
    if (text || baked) filter = `trim=duration=${c.duration},setpts=PTS-STARTPTS+${c.startTime}/TB,format=rgba`;
    else {
      const t = c.transform, fit = Math.min(project.canvas.width / asset.width, project.canvas.height / asset.height);
      const w = Math.max(1, Math.round(asset.width * fit * t.scaleX * scaleX)), h = Math.max(1, Math.round(asset.height * fit * t.scaleY * scaleY));
      if (w * h > 64 * 1024 * 1024) throw Error('변환한 클립이 출력 메모리 한도를 초과합니다. 크기를 줄여 주세요.');
      const trim = asset.type === 'image' ? `trim=duration=${c.duration}` : `trim=start=${c.sourceStart}:end=${c.sourceEnd}`;
      filter = `${trim},setpts=(PTS-STARTPTS)/${asset.type === 'image' ? 1 : c.speed}+${c.startTime}/TB,scale=${w}:${h}:flags=bicubic,setsar=1,format=rgba`;
      if (t.flipX) filter += ',hflip'; if (t.flipY) filter += ',vflip';
      if (t.rotation % 360) { const a = t.rotation * Math.PI / 180; filter += `,rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`; }
      filter += `,colorchannelmixer=aa=${c.opacity}`;
    }
    graph.push(`[${index}:v:0]${filter}[v${index}]`);
    const x = text || baked ? '0' : `(W-w)/2+${c.transform.x * scaleX}`, y = text || baked ? '0' : `(H-h)/2+${c.transform.y * scaleY}`;
    graph.push(`[base${layer}][v${index}]overlay=x='${x}':y='${y}':enable='gte(t,${c.startTime})*lt(t,${c.startTime + c.duration})':eof_action=pass:repeatlast=0:format=auto[base${++layer}]`);
  }
  graph.push(`[base${layer}]fps=${s.fps},scale=iw:ih:out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);
  graph.push(audio.length ? `${audio.join('')}amix=inputs=${audio.length}:normalize=0,apad,atrim=duration=${duration}[aout]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[aout]`);
  return { args, graph: graph.join(';\n'), duration, width: s.width, height: s.height, fps: s.fps };
}
module.exports = { renderPlan };
