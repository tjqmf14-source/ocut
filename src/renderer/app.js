'use strict';
const $ = id => document.getElementById(id);
let state, busy = false, selected = new Set(), zoom = 70, snap = true, ripple = false;
let exporting = false;
const clipNodes = new Map(), cardNodes = new Map();
const symbols = { text: 'T', subtitle: 'CC', video: '▣', image: '▧', audio: '♫', music: '♫', overlay: '▥' };
const clock = OcutStudioView.timecode;
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
const playback = new StudioPlayback($('preview'), (time, playing) => {
  $('timecode').textContent = clock(time); $('playhead').style.left = `${time * zoom}px`;
  $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? '일시정지' : '재생');
}, error => message(error, true));
const selectedClip = () => state?.project.clips.find(c => selected.has(c.id));
function showAutosave(status){$('autosaveState').textContent=status.state==='saved'?`자동 저장 ${new Date(status.savedAt).toLocaleTimeString('ko-KR',{hour12:false})}`:status.state==='pending'?'자동 저장 중…':status.state==='error'?'자동 저장 실패':'자동 저장 대기';$('autosaveState').classList.toggle('error',status.state==='error');$('autosaveState').title=status.error||'원본과 별도로 저장하는 복구본';}
window.ocut.onAutosave(showAutosave);
async function showWorkspace(){
  if(busy)return;try{const listing=await window.ocut.workspace();showAutosave(listing.autosave);$('workspaceWarnings').textContent=listing.warnings.join('\n');
    for(const [id,rows,isRecovery] of [['recoveryList',listing.recovery,true],['recentList',listing.recent,false]]){
      const holder=$(id);holder.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent=isRecovery?'복구할 편집이 없습니다.':'최근 프로젝트가 없습니다.';holder.append(p);}
      for(const row of rows){const button=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('span');button.className='workspace-item';title.textContent=row.name;detail.textContent=(isRecovery?`${row.clips}개 클립 · `:row.path+' · ')+new Date(row.time).toLocaleString('ko-KR');button.append(title,detail);button.onclick=async()=>{if(busy)return;busy=true;try{const next=await(isRecovery?window.ocut.recoverProject(row.id):window.ocut.openRecent(row.path));if(next){$('workspaceDialog').close();render(next);message(next.warning||(isRecovery?'편집을 복구했습니다. 확인한 뒤 다른 이름으로 저장하세요.':'최근 프로젝트를 열었습니다.'));}}catch(error){$('workspaceWarnings').textContent=error.message;}finally{busy=false;}};holder.append(button);}
    }
    if(!$('workspaceDialog').open)$('workspaceDialog').showModal();
  }catch(error){message(error.message,true);}
}
$('workspaceOpen').onclick=showWorkspace;$('workspaceClose').onclick=()=>$('workspaceDialog').close();
window.ocut.workspace().then(listing=>{showAutosave(listing.autosave);if(listing.recovery.length)$('workspaceOpen').textContent=`복구 가능 ${listing.recovery.length} · 최근`;}).catch(error=>message(error.message,true));
function render(next) {
  if (next) {
    if (next.reloadMedia) {
      playback.clear();
      for (const node of cardNodes.values()) node.remove(); cardNodes.clear();
      for (const node of clipNodes.values()) node.remove(); clipNodes.clear();
    }
    if (state?.project.id !== next.project.id) selected.clear();
    state = next;
    if (Array.isArray(next.selectedIds)) selected = new Set(next.selectedIds);
    else if (Object.hasOwn(next, 'selectedId')) selected = new Set(next.selectedId ? [next.selectedId] : []);
  }
  const p = state.project;
  for (const id of selected) if (!p.clips.some(c => c.id === id)) selected.delete(id);
  $('documentTitle').textContent = p.name;
  $('saveState').textContent = state.dirty ? '변경됨' : state.location ? '저장됨' : '저장 전';
  document.title = `${p.name}${state.dirty ? ' *' : ''} — O-CUT`;
  $('undo').disabled = !state.canUndo; $('redo').disabled = !state.canRedo;
  $('projectName').value = p.name; $('resolution').value = `${p.canvas.width},${p.canvas.height}`; $('fps').value = String(p.canvas.fps);
  $('canvasInfo').textContent = `${p.canvas.width} × ${p.canvas.height} · ${p.canvas.fps} FPS`;
  $('mediaCount').textContent = p.media.length; $('clipCount').textContent = `클립 ${p.clips.length}개`;
  playback.setProject(p, state.assets || {});
  $('duration').textContent = clock(playback.duration);
  $('previewEmpty').hidden = p.clips.length > 0;
  $('play').disabled = !p.clips.length;
  renderLibrary(); renderTimeline(); renderInspector(); renderCaptions(); renderVisualizerSources();
}
function renderVisualizerSources(){
  const selector=$('visualizerSource'),previous=selector.value,media=state.project.media.filter(m=>state.assets[m.id]?.hasAudio);
  selector.replaceChildren();for(const m of media){const option=document.createElement('option');option.value=m.id;option.textContent=m.name;selector.append(option);}
  selector.value=media.some(m=>m.id===previous)?previous:media[0]?.id||'';
  $('addVisualizer').disabled=$('createMusicVideo').disabled=!media.length;
}
function renderCaptions() {
  const source=$('sttSource'),last=source.value;source.replaceChildren();
  const spoken=state.project.clips.filter(c=>state.assets[c.source]?.hasAudio&&!c.effects.some(e=>e.type==='audioVisualizer'));
  for(const c of spoken){const option=document.createElement('option');option.value=c.id;option.textContent=`${state.project.media.find(m=>m.id===c.source)?.name} · ${clock(c.startTime)}`;source.append(option);}
  source.value=spoken.some(c=>c.id===last)?last:spoken[0]?.id||'';$('transcribe').disabled=!spoken.length;
  const selector = $('captionTrack'), previous = selector.value, clip = selectedClip();
  const tracks = state.project.tracks.filter(t => t.type === 'subtitle'); selector.replaceChildren();
  for (const [i, track] of tracks.entries()) { const option = document.createElement('option'); option.value = track.id; option.textContent = `${track.name} ${i + 1}${track.locked ? ' · 잠김' : ''}`; selector.append(option); }
  selector.value = clip?.type === 'subtitle' ? clip.trackId : tracks.some(t => t.id === previous) ? previous : tracks[0]?.id || '';
  selector.disabled = !tracks.length;
  const all = state.project.clips.filter(c => c.trackId === selector.value).sort((a, b) => a.startTime - b.startTime);
  $('exportCaptions').disabled = !all.length;
  const query = $('captionSearch').value.trim().toLocaleLowerCase(), clips = all.filter(c => c.text.toLocaleLowerCase().includes(query));
  $('captionCount').textContent = `${all.length}개 구간${query ? ` · 검색 ${clips.length}개` : ''}${clips.length > 200 ? ' · 앞 200개 표시' : ''}`;
  const list = $('captionList'); list.replaceChildren();
  if (!clips.length) { const hint = document.createElement('p'); hint.className = 'caption-empty'; hint.textContent = query ? '검색 결과가 없습니다.' : '직접 작성하거나 SRT·VTT 파일을 가져오세요.'; list.append(hint); }
  for (const c of clips.slice(0, 200)) {
    const button = document.createElement('button'); button.className = 'caption-item'; button.dataset.clipId = c.id; button.classList.toggle('selected', selected.has(c.id));
    const time = document.createElement('span'); time.textContent = `${clock(c.startTime)} → ${clock(c.startTime + c.duration)}`;
    const text = document.createElement('p'); text.textContent = c.text; button.append(time, text);
    button.onclick = event => { if (event.shiftKey) selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id); else selected = new Set([c.id]); playback.seek(c.startTime); renderSelection(); renderInspector(); renderCaptions(); };
    list.append(button);
  }
  updateCaptionSelection();
}
function updateCaptionSelection() {
  if (!state) return;
  const clips = state.project.clips.filter(c => selected.has(c.id));
  $('mergeCaptions').disabled = clips.length < 2 || clips.some(c => c.type !== 'subtitle' || c.trackId !== clips[0].trackId || state.project.tracks.find(t => t.id === c.trackId).locked);
  for (const node of $('captionList').children) node.classList.toggle('selected', selected.has(node.dataset.clipId));
}
function renderLibrary() {
  const holder = $('libraryContent'), ids = new Set(state.project.media.map(m => m.id));
  if (!ids.size) { holder.innerHTML = '<div class="empty-library"><div class="empty-symbol">＋</div><h2>첫 장면을 가져오세요</h2><p>영상 · 이미지 · 음악을 불러와<br>타임라인에 놓아 보세요.</p><button class="secondary" id="emptyImport">미디어 가져오기</button></div>'; $('emptyImport').onclick = () => $('importMedia').click(); cardNodes.clear(); return; }
  if (holder.querySelector('.empty-library')) holder.replaceChildren();
  for (const [id, node] of cardNodes) if (!ids.has(id)) { node.remove(); cardNodes.delete(id); }
  for (const media of state.project.media) {
    if (cardNodes.has(media.id)) continue;
    const asset = state.assets?.[media.id];
    const card = document.createElement('article'); card.className = 'media-card'; card.draggable = true; card.dataset.mediaId = media.id;
    const thumb = document.createElement('div'); thumb.className = `media-thumb ${media.type}`;
    if (asset?.thumbnail) { const img = new Image(); img.src = asset.thumbnail; img.alt = ''; thumb.append(img); }
    else if (asset?.waveform) { const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 65; drawWave(canvas, asset.waveform.peaks, 0, asset.waveform.duration, asset.waveform.duration); thumb.append(canvas); }
    else thumb.textContent = asset ? symbols[media.type] : '미디어를 찾을 수 없음';
    const row = document.createElement('div'); row.className = 'media-info';
    const name = document.createElement('strong'); name.textContent = media.name; name.title = media.path;
    const subtitle = document.createElement('span'); subtitle.textContent = `${media.type.toUpperCase()} · ${media.duration === null ? '정지 이미지' : clock(media.duration)}`;
    const add = document.createElement('button'); add.className = 'media-add'; add.textContent = '＋'; add.title = '타임라인에 추가'; add.setAttribute('aria-label', media.name + ' 타임라인에 추가'); add.disabled = !asset;
    add.onclick = () => edit({ type: 'add', mediaId: media.id });
    row.append(name, subtitle, add); card.append(thumb, row);
    card.ondragstart = event => event.dataTransfer.setData('application/ocut-media', media.id);
    card.ondblclick = () => add.click(); holder.append(card); cardNodes.set(media.id, card);
  }
}
function drawWave(canvas, peaks, sourceStart, sourceEnd, duration) {
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#a6d9b8';
  const maximum = Math.max(0.001, ...peaks);
  for (let x = 0; x < canvas.width; x += 2) {
    const from = Math.floor((sourceStart + (sourceEnd - sourceStart) * x / canvas.width) / duration * peaks.length);
    const to = Math.max(from + 1, Math.ceil((sourceStart + (sourceEnd - sourceStart) * (x + 2) / canvas.width) / duration * peaks.length));
    let peak = 0; for (let i = Math.max(0, from); i < Math.min(peaks.length, to); i++) peak = Math.max(peak, peaks[i]);
    const h = Math.max(1, Math.min(1, peak / maximum) * canvas.height * .85); ctx.fillRect(x, (canvas.height - h) / 2, 1, h);
  }
}
function renderTimeline() {
  const p = state.project, width = Math.max($('timelineBody').clientWidth, (Math.max(16, playback.duration) + 4) * zoom);
  const rows=new Map(),heights=new Map();
  for(const track of p.tracks){const ends=[];for(const c of p.clips.filter(c=>c.trackId===track.id).sort((a,b)=>a.startTime-b.startTime)){let row=ends.findIndex(end=>end<=c.startTime+1e-7);if(row<0)row=ends.length;ends[row]=c.startTime+c.duration;rows.set(c.id,row);}heights.set(track.id,Math.max(61,ends.length*55+6));}
  $('timelineContent').style.width = `${width}px`;
  $('trackHeaders').replaceChildren();
  const lanes = new Map([...$('tracks').children].map(node => [node.dataset.trackId, node]));
  for (const track of p.tracks) {
    const head = document.createElement('div'); head.className = 'track-head'; head.dataset.trackId = track.id;
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = `${symbols[track.type] || '▣'}  ${track.name}`;
    const toggles = document.createElement('div'); toggles.className = 'track-toggles';
    for (const [property, label, title] of [['locked', 'L', '트랙 잠금'], ['hidden', 'V', '화면 숨김'], ['muted', 'M', '음소거'], ['solo', 'S', '이 트랙만 듣기']]) {
      const button = document.createElement('button'); button.textContent = label; button.title = title; button.setAttribute('aria-label', `${track.name} ${title}`); button.setAttribute('aria-pressed', String(track[property]));
      if(OcutVisualizer.visualTrack(p,track)&&['muted','solo'].includes(property))button.disabled=true;
      button.onclick = () => edit({ type: 'track', id: track.id, property, value: !track[property] }); toggles.append(button);
    }
    head.append(name, toggles);head.dataset.baseHeight=heights.get(track.id);head.style.height=`${heights.get(track.id)}px`; $('trackHeaders').append(head);
    let lane = lanes.get(track.id);
    if (!lane) { lane = document.createElement('div'); lane.className = 'track-lane'; lane.dataset.trackId = track.id; $('tracks').append(lane); }
    $('tracks').append(lane);lane.dataset.baseHeight=heights.get(track.id);lane.style.height=`${heights.get(track.id)}px`;
    lane.classList.toggle('locked', track.locked); lane.classList.toggle('track-hidden', track.hidden); lanes.delete(track.id);
    lane.ondragover = event => event.preventDefault();
    lane.ondrop = event => { event.preventDefault(); const id = event.dataTransfer.getData('application/ocut-media'); if (id) edit({ type: 'add', mediaId: id, startTime: timeAt(event.clientX) }); };
    lane.onpointerdown = event => { if (event.target !== lane) return; selected.clear(); playback.seek(timeAt(event.clientX)); renderSelection(); renderInspector(); };
  }
  for (const lane of lanes.values()) lane.remove();
  $('trackHeaders').scrollTop = $('timelineBody').scrollTop;
  const ids = new Set(p.clips.map(c => c.id));
  for (const [id, node] of clipNodes) if (!ids.has(id)) { node.remove(); clipNodes.delete(id); }
  for (const clip of p.clips) {
    const lane = [...$('tracks').children].find(node => node.dataset.trackId === clip.trackId);
    let node = clipNodes.get(clip.id);
    const media = p.media.find(m => m.id === clip.source), asset = state.assets?.[clip.source];
    const key = JSON.stringify([clip, zoom, Boolean(asset)]);
    if (!node) {
      node = document.createElement('div'); node.className = `clip ${clip.type}`; node.dataset.clipId = clip.id; node.tabIndex = 0; node.setAttribute('role', 'button');
      node.onpointerdown = event => beginDrag(event, clip.id); node.ondblclick = () => playback.seek(state.project.clips.find(c => c.id === clip.id).startTime);
      node.oncontextmenu = event => { event.preventDefault(); selected = new Set([clip.id]); renderSelection(); renderInspector(); showContext(event.clientX, event.clientY); };
      node.onkeydown = event => { if (event.key === 'Enter') { selected = new Set([clip.id]); renderSelection(); renderInspector(); } };
      clipNodes.set(clip.id, node); lane.append(node);
    }
    node.style.top=`${6+rows.get(clip.id)*55}px`;
    if (node.dataset.key !== key) {
      node.dataset.key = key; node.style.left = `${clip.startTime * zoom}px`; node.style.width = `${Math.max(4, clip.duration * zoom)}px`; node.replaceChildren();
      const name = document.createElement('span'); name.className = 'clip-label'; name.textContent = clip.text || media?.name || clip.type; node.append(name);
      node.title = `${name.textContent} · ${clock(clip.startTime)} / ${clip.duration.toFixed(2)}초`; node.setAttribute('aria-label', node.title);
      if (asset?.waveform) { const wave = document.createElement('canvas'); wave.className = 'clip-wave'; wave.width = Math.min(3000, Math.ceil(clip.duration * zoom)); wave.height = 27; drawWave(wave, asset.waveform.peaks, clip.sourceStart, clip.sourceEnd, asset.waveform.duration); node.append(wave); }
      else if (asset?.thumbnail) { node.style.backgroundImage = `url("${asset.thumbnail}")`; }
      for (const side of ['left', 'right']) { const handle = document.createElement('span'); handle.className = `trim-handle ${side}`; handle.dataset.trim = side; node.append(handle); }
    }
  }
  renderRuler(); renderSelection(); $('playhead').style.left = `${playback.time * zoom}px`;
}
function renderRuler() {
  const ruler = $('ruler'); ruler.replaceChildren(); const step = OcutStudioView.rulerStep(zoom);
  const body = $('timelineBody'), begin = Math.floor(body.scrollLeft / zoom / step) * step, end = (body.scrollLeft + body.clientWidth) / zoom + step;
  for (let time = begin; time <= end; time += step) { const marker = document.createElement('span'); marker.textContent = OcutStudioView.timeLabel(time); marker.style.left = `${time * zoom + 6}px`; ruler.append(marker); }
}
function renderSelection() {
  updateCaptionSelection();
  for (const [id, node] of clipNodes) node.classList.toggle('selected', selected.has(id));
  const clip = selectedClip(), locked = state.project.clips.some(c => selected.has(c.id) && state.project.tracks.find(t => t.id === c.trackId).locked);
  for (const id of ['split', 'duplicate', 'deleteClip']) $(id).disabled = !clip || locked;
  for (const id of ['trimBefore', 'trimAfter']) $(id).disabled = !clip || locked || selected.size !== 1;
  $('extractAudio').disabled=!clip||locked||selected.size!==1||clip.type!=='video';
  window.directEditor?.render();
}
function renderInspector() {
  if(selectedClip())window.dispatchEvent(new Event('ocut-inspect'));
  const clip = selectedClip(); $('clipForm').hidden = !clip; $('projectForm').hidden = Boolean(clip); $('inspectorTitle').textContent = clip ? '클립 편집' : '프로젝트';
  if (!clip) return;
  const media = state.project.media.find(m => m.id === clip.source);
  $('clipName').textContent = clip.type === 'text' ? '텍스트' : clip.type === 'subtitle' ? '자막' : media?.name || clip.type;
  const values = { clipStart: clip.startTime, clipDuration: clip.duration, clipSourceStart: clip.sourceStart, clipSpeed: clip.speed, clipX: clip.transform.x, clipY: clip.transform.y, clipScale: clip.transform.scaleX * 100, clipRotation: clip.transform.rotation, clipOpacity: clip.opacity * 100, clipVolume: clip.volume * 100 };
  for (const [id, value] of Object.entries(values)) $(id).value = Number(value.toFixed(3));
  $('clipText').value = clip.text; $('textField').hidden = !['text', 'subtitle'].includes(clip.type);
  $('textStyleFields').hidden=$('textField').hidden;if(!$('textField').hidden)fillTextStyle(OcutTextStyle.get(clip));$('textPreset').value='';
  $('transformFields').hidden = ['audio', 'music'].includes(clip.type); $('volumeField').hidden = !state.assets?.[clip.source]?.hasAudio;
  $('fadeFields').hidden = $('volumeField').hidden;
  const fades = clip.effects.find(e => e.type === 'audioFade' && e.enabled)?.parameters;
  $('clipFadeIn').value = fades?.fadeIn || 0; $('clipFadeOut').value = fades?.fadeOut || 0;
  const visual=clip.effects.find(e=>e.type==='audioVisualizer');$('visualizerFields').hidden=!visual;
  const transition=OcutTransitions.get(clip);$('transitionFields').hidden=['audio','music','effect'].includes(clip.type);$('transitionIn').value=transition.inType;$('transitionOut').value=transition.outType;$('transitionInDuration').value=transition.inDuration;$('transitionOutDuration').value=transition.outDuration;
  $('colorFields').hidden=!['video','image'].includes(state.project.media.find(m=>m.id===clip.source)?.type)||Boolean(visual);fillColor(OcutColorFilters.get(clip));$('textureFields').hidden=$('colorFields').hidden;for(const [key,value] of Object.entries(OcutTexture.get(clip)))if($('texture-'+key))$('texture-'+key).value=value;$('colorPreset').value=clip.effects.some(e=>e.type==='colorCorrection')?'custom':'neutral';
  if(visual){const v=visual.parameters;for(const [id,key] of Object.entries({visualStyle:'style',visualColor:'color',visualBars:'barCount',visualThickness:'thickness',visualSensitivity:'sensitivity',visualSmoothing:'smoothing',visualMin:'minFrequency',visualMax:'maxFrequency',visualGlow:'glow'}))$(id).value=v[key];}
  const locked = state.project.tracks.find(t => t.id === clip.trackId).locked;
  for (const field of $('clipForm').querySelectorAll('input,textarea,select,button')) field.disabled = locked || !visual && Boolean(field.closest('#visualizerFields')) || $('textField').hidden && Boolean(field.closest('#textStyleFields')) || $('colorFields').hidden&&Boolean(field.closest('#colorFields')) || $('textureFields').hidden&&Boolean(field.closest('#textureFields')) || $('transitionFields').hidden&&Boolean(field.closest('#transitionFields'));
  $('dissolvePrevious').disabled=locked||!['video','image'].includes(clip.type);
  renderKeyframes();
}
const keyPercent=property=>['scaleX','scaleY','opacity','volume'].includes(property)?100:1;
for(const [key,label] of Object.entries({exposure:'노출 · 스톱',brightness:'밝기',contrast:'대비',saturation:'채도',temperature:'색온도',tint:'색조',highlights:'하이라이트',shadows:'그림자'})){
  const node=document.createElement('label'),input=document.createElement('input');input.id='color-'+key;input.type='number';input.min=OcutColorFilters.ranges[key][0];input.max=OcutColorFilters.ranges[key][1];input.step=key==='exposure'?.1:1;input.value=OcutColorFilters.defaults[key];node.textContent=label;node.append(input);$('colorInputs').append(node);
}
function fillColor(color){for(const key of Object.keys(OcutColorFilters.defaults))$('color-'+key).value=color[key];}
function readColor(){return Object.fromEntries(Object.keys(OcutColorFilters.defaults).map(k=>[k,Number($('color-'+k).value)]));}
$('colorPreset').onchange=()=>{const preset=OcutColorFilters.presets[$('colorPreset').value];if(preset)fillColor(preset);};
$('dissolvePrevious').onclick=()=>{const clip=selectedClip();if(clip)edit({type:'dissolve',id:clip.id,duration:Number($('transitionInDuration').value)});};
function keyAtTime(time){const clip=selectedClip();if(!clip)return;const property=$('keyProperty').value,t=Math.max(0,Math.min(clip.duration,time));$('keyTime').value=Number(t.toFixed(6));$('keyValue').value=Number((OcutKeyframes.value(clip,property,t)*keyPercent(property)).toFixed(3));const point=clip.keyframes.find(k=>k.property===property&&Math.abs(k.time-t)<1e-6);$('keyInterpolation').value=point?.interpolation||'linear';}
function renderKeyframes(){
  const clip=selectedClip();if(!clip)return;const locked=state.project.tracks.find(t=>t.id===clip.trackId).locked;
  for(const option of $('keyProperty').options)option.disabled=['audio','music'].includes(clip.type)&&option.value!=='volume'||option.value==='volume'&&!state.assets[clip.source]?.hasAudio;
  if($('keyProperty').selectedOptions[0].disabled)$('keyProperty').value=['audio','music'].includes(clip.type)?'volume':'x';
  const property=$('keyProperty').value,[min,max]=OcutKeyframes.ranges[property];$('keyTime').max=clip.duration;$('keyValue').min=min*keyPercent(property);$('keyValue').max=max*keyPercent(property);keyAtTime(playback.time-clip.startTime);
  $('keyList').replaceChildren();for(const k of OcutKeyframes.frames(clip,property)){
    const row=document.createElement('div'),go=document.createElement('button'),remove=document.createElement('button');row.className='key-row';go.type=remove.type='button';go.textContent=`${k.time.toFixed(3)}초 · ${(k.value*keyPercent(property)).toFixed(2)} · ${k.interpolation==='hold'?'유지':'선형'}`;remove.textContent='×';remove.setAttribute('aria-label',`${k.time}초 키프레임 삭제`);remove.disabled=locked;
    go.onclick=()=>{playback.seek(clip.startTime+k.time);keyAtTime(k.time);};remove.onclick=()=>edit({type:'keyframe',id:clip.id,property,time:k.time,operation:'delete'});row.append(go,remove);$('keyList').append(row);
  }
  $('keyClear').disabled=locked||!clip.keyframes.some(k=>k.property===property);
}
$('keyProperty').onchange=renderKeyframes;
$('keyAtCursor').onclick=()=>{const clip=selectedClip();if(clip)keyAtTime(playback.time-clip.startTime);};
$('keySet').onclick=()=>{const clip=selectedClip();if(!clip)return;edit({type:'keyframe',id:clip.id,operation:'set',property:$('keyProperty').value,time:Number($('keyTime').value),value:Number($('keyValue').value)/keyPercent($('keyProperty').value),interpolation:$('keyInterpolation').value});};
$('keyClear').onclick=()=>{const clip=selectedClip();if(clip)edit({type:'keyframe',id:clip.id,operation:'clear',property:$('keyProperty').value,time:0});};
const textStyleFields={textFont:'font',textSize:'fontSize',textWeight:'weight',textTracking:'tracking',textLineHeight:'lineHeight',textAlign:'align',textFill:'fill',textGradient:'gradient',textGradientEnd:'gradientEnd',textStroke:'stroke',textStrokeWidth:'strokeWidth',textShadow:'shadow',textShadowBlur:'shadowBlur',textShadowX:'shadowX',textShadowY:'shadowY',textBackground:'background',textBackgroundOpacity:'backgroundOpacity',textPadding:'padding',textRadius:'radius'};
function fillTextStyle(style){for(const [id,key] of Object.entries(textStyleFields)){if(key==='gradient')$(id).checked=style[key];else $(id).value=key==='backgroundOpacity'?style[key]*100:style[key];}}
function readTextStyle(){const style={};for(const [id,key] of Object.entries(textStyleFields)){const field=$(id);style[key]=key==='gradient'?field.checked:typeof OcutTextStyle.defaults[key]==='number'?Number(field.value):field.value;if(key==='backgroundOpacity')style[key]/=100;}return style;}
$('textPreset').onchange=()=>{const preset=OcutTextStyle.presets[$('textPreset').value];if(preset){fillTextStyle(preset);if($('textPreset').value==='lowerThird'){$('clipX').value=Math.round(-state.project.canvas.width*.35);$('clipY').value=Math.round(state.project.canvas.height*.3);}message('프리셋을 선택했습니다. 클립에 적용을 눌러 저장하세요.');}};
function timeAt(x) { const box = $('timelineBody').getBoundingClientRect(); return Math.max(0, (x - box.left + $('timelineBody').scrollLeft) / zoom); }
function snapped(delta, clip) {
  let value = delta; const threshold = 7 / zoom;
  if (snap) {
    const targets = [0, playback.time, ...state.project.clips.filter(c => !selected.has(c.id)).flatMap(c => [c.startTime, c.startTime + c.duration])];
    let best = threshold;
    for (const edge of [clip.startTime + delta, clip.startTime + clip.duration + delta]) for (const target of targets) if (Math.abs(target - edge) < best) { best = Math.abs(target - edge); value = delta + target - edge; }
  }
  const first = Math.min(...state.project.clips.filter(c => selected.has(c.id)).map(c => c.startTime));
  return Math.max(-first, Math.round(value * state.project.canvas.fps) / state.project.canvas.fps);
}
function beginDrag(event, id) {
  if (event.button !== 0 || busy || event.target.closest('.fade-handle')) return;
  event.preventDefault();
  if (event.shiftKey) { selected.has(id) ? selected.delete(id) : selected.add(id); } else if (!selected.has(id)) selected = new Set([id]);
  renderSelection(); renderInspector();
  const clip = state.project.clips.find(c => c.id === id); if (!selected.has(id) || state.project.clips.some(c => selected.has(c.id) && state.project.tracks.find(t => t.id === c.trackId).locked)) return;
  const node = clipNodes.get(id), startX = event.clientX, side = event.target.dataset.trim;
  let delta = 0, moved = false; node.setPointerCapture(event.pointerId);
  node.onpointermove = move => {
    const raw = (move.clientX - startX) / zoom;
    if (Math.abs(move.clientX - startX) < 3 && !moved) return; moved = true;
    if (!side) { delta = snapped(raw, clip); for (const selectedId of selected) clipNodes.get(selectedId).style.transform = `translateX(${delta * zoom}px)`; }
    else {
      const frame = 1 / state.project.canvas.fps, media = state.project.media.find(m => m.id === clip.source);
      let candidate = raw;
      if (snap && !move.altKey) {
        const boundary = side === 'left' ? clip.startTime : clip.startTime + clip.duration;
        const targets = [0, playback.time, ...state.project.clips.filter(c => c.id !== id).flatMap(c => [c.startTime, c.startTime + c.duration])];
        let best = 7 / zoom;
        for (const target of targets) if (Math.abs(target - boundary - raw) < best) { best = Math.abs(target - boundary - raw); candidate = target - boundary; }
      }
      const quantized = Math.round(candidate * state.project.canvas.fps) / state.project.canvas.fps;
      delta = side === 'left' ? Math.max(-clip.startTime, -clip.sourceStart / clip.speed, Math.min(clip.duration - frame, quantized)) : Math.max(frame - clip.duration, Math.min(media?.duration ? (media.duration - clip.sourceEnd) / clip.speed : 86400, quantized));
      node.style.left = `${(clip.startTime + (side === 'left' ? delta : 0)) * zoom}px`; node.style.width = `${(clip.duration + (side === 'left' ? -delta : delta)) * zoom}px`;
    }
  };
  const finish = cancelled => {
    node.onpointermove = node.onpointerup = node.onpointercancel = node.onlostpointercapture = null;
    window.removeEventListener('keydown', cancelKey, true);
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    for (const n of clipNodes.values()) { n.style.transform = ''; n.dataset.key = ''; }
    if (cancelled || !moved || !delta) { renderTimeline(); return; }
    if (!side) edit({ type: 'move', ids: [...selected], delta });
    else edit({ type: 'trim', id, side, time: (side === 'left' ? clip.startTime : clip.startTime + clip.duration) + delta });
  };
  const cancelKey = key => { if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); finish(true); } };
  window.addEventListener('keydown', cancelKey, true);
  node.onpointerup = () => finish(false);
  node.onpointercancel = node.onlostpointercapture = () => finish(true);
}
function showContext(x, y) {
  document.querySelector('.context-menu')?.remove(); const menu = document.createElement('div'); menu.className = 'context-menu'; menu.style.left = `${Math.min(x, innerWidth - 160)}px`; menu.style.top = `${Math.min(y, innerHeight - 150)}px`;
  for (const [label, id] of [['재생 헤드에서 분할', 'split'], ['클립 복제', 'duplicate'], ['오디오 분리', 'extractAudio'], ['클립 삭제', 'deleteClip']]) { const button = document.createElement('button'); button.textContent = label; button.disabled = $(id).disabled; button.onclick = () => { menu.remove(); $(id).click(); }; menu.append(button); }
  document.body.append(menu); setTimeout(() => document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.remove(); }, { once: true }), 0);
}
async function act(work, note) {
  if (busy) return;
  busy = true; playback.pause(); $('importMedia').disabled = true;
  try { const next = await work(); if (next) { render(next); message(next.warning || note || '적용했습니다.', Boolean(next.warning)); } }
  catch (error) { message(error.message, true); if (state) render(); }
  finally { busy = false; $('importMedia').disabled = false; }
}
function edit(action) { return act(() => window.ocut.edit(action), '편집 내용을 적용했습니다.'); }
$('newProject').onclick = () => act(() => window.ocut.newProject(), '새 프로젝트를 만들었습니다.');
$('openProject').onclick = () => act(() => window.ocut.openProject(), '프로젝트를 열었습니다.');
$('save').onclick = () => act(() => window.ocut.saveProject(false), '프로젝트를 저장했습니다.');
$('saveAs').onclick = () => act(() => window.ocut.saveProject(true), '프로젝트를 저장했습니다.');
$('undo').onclick = () => act(() => window.ocut.undo(), '실행을 취소했습니다.');
$('redo').onclick = () => act(() => window.ocut.redo(), '다시 실행했습니다.');
$('importMedia').onclick = () => { message('미디어와 실제 파형을 분석하고 있습니다…'); act(() => window.ocut.importMedia(), '미디어를 가져왔습니다. 타임라인에 드래그하거나 ＋를 눌러 추가하세요.'); };
$('addText').onclick = () => edit({ type: 'text', startTime: playback.time });
$('addCaption').onclick = () => edit({ type: 'subtitle', startTime: playback.time });
$('importCaptions').onclick = () => act(() => window.ocut.importCaptions(), '자막을 가져왔습니다.');
$('mergeCaptions').onclick = () => edit({ type: 'mergeCaptions', ids: [...selected] });
$('exportCaptions').onclick = async () => {
  if (busy) return; busy = true;
  try { const result = await window.ocut.exportCaptions($('captionTrack').value); if (result) message(`SRT 저장 완료: ${result.target}`); }
  catch (error) { message(error.message, true); }
  finally { busy = false; }
};
function showPane(name) {
  for (const pane of ['media','captions','music','visualizer','text','stickers','filters','adjustments','transitions']) { $(pane + 'Pane').hidden = pane !== name; $(pane + 'Tab').setAttribute('aria-selected', String(pane === name)); }
  if (name === 'captions') renderCaptions();
  window.dispatchEvent(new CustomEvent('ocut-pane',{detail:name}));
}
for (const pane of ['media','captions','music','visualizer','text','stickers','filters','adjustments','transitions']) $(pane + 'Tab').onclick = () => showPane(pane);
$('addVisualizer').onclick=()=>{message('음원의 파형과 주파수를 분석하고 있습니다…');edit({type:'visualizer',mediaId:$('visualizerSource').value,startTime:playback.time});};
$('createMusicVideo').onclick=()=>{message('음원을 분석하고 음악 영상 프로젝트를 준비하고 있습니다…');act(()=>window.ocut.createMusicVideo($('visualizerSource').value),'음악 영상 프로젝트를 만들었습니다. 각 트랙을 자유롭게 편집하세요.');};
$('captionSearch').oninput = () => renderCaptions(); $('captionTrack').onchange = () => { selected.clear(); renderSelection(); renderInspector(); renderCaptions(); };
function editSelection(type) {
  if (!selected.size) return;
  const existing = new Set(state.project.clips.map(c => c.id));
  return act(async () => {
    const next = await window.ocut.edit({ type, ids: [...selected], time: playback.time });
    return { ...next, selectedIds: next.project.clips.filter(c => !existing.has(c.id)).map(c => c.id) };
  }, '선택한 클립을 편집했습니다.');
}
$('split').onclick = () => editSelection('splitSelected');
$('duplicate').onclick = () => editSelection('duplicateSelected');
$('extractAudio').onclick=()=>{const clip=selectedClip();if(clip)edit({type:'extractAudio',id:clip.id});};
for (const [id, side] of [['trimBefore', 'left'], ['trimAfter', 'right']]) $(id).onclick = () => {
  const clip = selectedClip(); if (!clip || selected.size !== 1) return;
  if (playback.time < clip.startTime || playback.time > clip.startTime + clip.duration) { message('재생 헤드를 선택한 클립 안으로 이동해 주세요.', true); return; }
  edit({ type: 'trim', id: clip.id, side, time: playback.time });
};
$('deleteClip').onclick = () => edit({ type: 'delete', ids: [...selected], ripple });
$('deselect').onclick = () => { selected.clear(); renderSelection(); renderInspector(); };
$('snap').onclick = () => { snap = !snap; $('snap').setAttribute('aria-pressed', String(snap)); };
$('ripple').onclick = () => { ripple = !ripple; $('ripple').setAttribute('aria-pressed', String(ripple)); };
function setTimelineZoom(value,anchor=$('timelineBody').clientWidth/2){
  if(!state)return;const body=$('timelineBody'),time=(body.scrollLeft+anchor)/zoom;
  zoom=OcutStudioView.clampZoom(value);$('zoom').value=OcutStudioView.toSlider(zoom);
  $('zoom').setAttribute('aria-valuetext',`화면에 약 ${OcutStudioView.timeLabel(body.clientWidth/zoom)}`);
  renderTimeline();body.scrollLeft=Math.max(0,time*zoom-anchor);renderRuler();
}
$('zoom').value=OcutStudioView.toSlider(zoom);
$('zoom').oninput=()=>setTimelineZoom(OcutStudioView.fromSlider(Number($('zoom').value)));
$('fitTimeline').onclick=()=>{setTimelineZoom(OcutStudioView.fit(playback.duration,$('timelineBody').clientWidth),0);$('timelineBody').scrollLeft=0;renderRuler();};
$('timelineBody').addEventListener('wheel',event=>{
  if(!event.ctrlKey)return;event.preventDefault();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?$('timelineBody').clientHeight:1);
  setTimelineZoom(zoom*Math.exp(-Math.max(-200,Math.min(200,delta))*.005),event.clientX-$('timelineBody').getBoundingClientRect().left);
},{passive:false});
$('timelineBody').onscroll = () => { $('trackHeaders').scrollTop = $('timelineBody').scrollTop; renderRuler(); };
$('ruler').onpointerdown = event => { playback.pause(); playback.seek(timeAt(event.clientX)); $('ruler').setPointerCapture(event.pointerId); $('ruler').onpointermove = e => playback.seek(timeAt(e.clientX)); $('ruler').onpointerup = () => { $('ruler').onpointermove = null; }; };
$('play').onclick = () => playback.playing ? playback.pause() : playback.play().catch(error => message(error.message, true));
$('stepBack').onclick = () => { playback.pause(); playback.seek(playback.time - 1 / state.project.canvas.fps); };
$('stepForward').onclick = () => { playback.pause(); playback.seek(playback.time + 1 / state.project.canvas.fps); };
$('projectForm').onsubmit = event => {
  event.preventDefault(); const [width, height] = $('resolution').value.split(',').map(Number);
  act(() => window.ocut.settings({ name: $('projectName').value.trim(), width, height, fps: Number($('fps').value) }), '프로젝트 설정을 적용했습니다.');
};
$('clipForm').onsubmit = event => {
  event.preventDefault(); const clip = selectedClip(); if (!clip) return; const num = id => Number($(id).value);
  const visual={...($('transitionFields').hidden?{}:{visualTransition:{inType:$('transitionIn').value,inDuration:num('transitionInDuration'),outType:$('transitionOut').value,outDuration:num('transitionOutDuration')}}),...($('visualizerFields').hidden?{}:{visualizer:{style:$('visualStyle').value,color:$('visualColor').value,barCount:num('visualBars'),thickness:num('visualThickness'),sensitivity:num('visualSensitivity'),smoothing:num('visualSmoothing'),minFrequency:num('visualMin'),maxFrequency:num('visualMax'),glow:num('visualGlow')}}),...($('textStyleFields').hidden?{}:{textStyle:readTextStyle()})};
  edit({ type: 'update', id: clip.id, values: { startTime: num('clipStart'), duration: num('clipDuration'), sourceStart: num('clipSourceStart'), speed: num('clipSpeed'), text: $('clipText').value, volume: num('clipVolume') / 100, opacity: num('clipOpacity') / 100, ...visual, ...(!$('colorFields').hidden?{colorCorrection:readColor(),texture:Object.fromEntries(Object.keys(OcutTexture.defaults).map(k=>[k,Number($('texture-'+k).value)]))}:{}), ...(!$('fadeFields').hidden ? {audioFade:{fadeIn:num('clipFadeIn'),fadeOut:num('clipFadeOut')}} : {}), transform: { x: num('clipX'), y: num('clipY'), scaleX: num('clipScale') / 100, scaleY: num('clipScale') / 100, rotation: num('clipRotation') } } });
};
window.addEventListener('keydown', event => {
  if (exporting || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase(), typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); $(event.shiftKey ? 'saveAs' : 'save').click(); return; }
  if (typing) return;
  if(event.defaultPrevented)return;
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') { event.preventDefault(); $(event.shiftKey ? 'redo' : 'undo').click(); }
    if (key === 'd') { event.preventDefault(); $('duplicate').click(); }
    if (key === 'b') { event.preventDefault(); $('split').click(); }
    if (key === 'a') { event.preventDefault(); selected = new Set(state.project.clips.filter(c => !state.project.tracks.find(t => t.id === c.trackId).locked).map(c => c.id)); renderSelection(); renderInspector(); }
    return;
  }
  if (key === ' ') { event.preventDefault(); $('play').click(); }
  if (key === 's') $('split').click();
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); $('deleteClip').click(); }
  if (key === 'arrowleft') { event.preventDefault(); $('stepBack').click(); }
  if (key === 'arrowright') { event.preventDefault(); $('stepForward').click(); }
});
window.addEventListener('resize', () => state && renderTimeline());
new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const ratio = state ? state.project.canvas.width / state.project.canvas.height : 16 / 9;
  const frame = document.querySelector('.monitor-frame'); const fitted = Math.min(width, height * ratio);
  frame.style.width = `${fitted}px`; frame.style.height = `${fitted / ratio}px`;
}).observe(document.querySelector('.monitor-space'));
window.ocut.onExportProgress(percent => { $('exportProgress').value = percent; $('exportPercent').textContent = `${Math.floor(percent)}% · ${percent >= 99 ? '파일 확인 중' : '영상과 음성 출력 중'}`; });
$('exportDialog').addEventListener('cancel', event => event.preventDefault());
$('cancelExport').onclick = () => { window.ocut.cancelExport(); $('cancelExport').disabled = true; $('exportPercent').textContent = '취소하고 있습니다…'; };
$('exportVideo').onclick = async () => {
  if (busy) return;
  busy = exporting = true; playback.pause();
  const s = state.project.exportSettings;
  $('exportDescription').textContent = `${s.width} × ${s.height} · ${s.fps} FPS · H.264 / AAC`;
  $('exportProgress').value = 0; $('exportPercent').textContent = '저장할 위치를 선택해 주세요.'; $('cancelExport').disabled = false;
  $('exportDialog').showModal();
  try { const result = await window.ocut.exportVideo(); message(result ? `내보내기 완료: ${result.target}` : '내보내기를 취소했습니다.'); }
  catch (error) { message(error.message, true); }
  finally { $('exportDialog').close(); busy = exporting = false; }
};
act(() => window.ocut.state(), '프로젝트 준비됨');
let musicState, musicPending = false;
let voiceRunning=false,voiceScanId=null,voiceReports=new Map();
const selectedMusicIds=new Set();
const voiceLabels={detected:'허밍·보이스 검출',review:'확인 필요',not_detected:'미검출',error:'검사 실패'};
function voiceControls(){
  const occupied=musicState?.current||musicState?.queueActive||(!musicState?.paused&&musicState?.queue?.length),count=selectedMusicIds.size;
  for(const id of ['voiceSelectInstrumentals','voiceClearSelection','voiceSelectDetected','voiceModel'])$(id).disabled=musicPending||Boolean(occupied);
  $('voiceScan').disabled=musicPending||Boolean(occupied)||!count;
  $('voiceDelete').disabled=musicPending||Boolean(occupied)||!voiceScanId||!count||[...selectedMusicIds].some(id=>voiceReports.get(id)?.verdict!=='detected');
  $('voiceCancel').hidden=!voiceRunning;$('voiceCancel').disabled=false;
  $('voiceScan').textContent=count?`선택 ${count}곡 검사`:'선택곡 검사';
}
function renderMusic(next) {
  if (next) musicState = next;
  if (!musicState) return;
  const job = musicState.current, running = Boolean(job), queue=musicState.queue||[], occupied=running||musicState.queueActive||(!musicState.paused&&queue.length);
  for (const field of $('musicPane').querySelectorAll('input,textarea,select,button')) field.disabled = musicPending;
  $('musicVoice').disabled=musicPending||$('musicInstrumental').checked;
  $('musicLyrics').disabled=musicPending||$('musicInstrumental').checked;
  $('generateMusic').disabled=Boolean(occupied||queue.length||musicPending);
  for (const id of ['musicPython','musicModels','checkMusic']) $(id).disabled = Boolean(occupied||musicPending);
  $('musicQueueStatus').textContent=`대기 ${queue.length}곡 · ${musicState.paused?'일시 정지':occupied?'생성 중':'준비됨'}`;
  $('musicQueueError').textContent=musicState.queueError||'';
  $('resumeMusic').disabled=musicPending||!musicState.paused||!queue.length;
  $('pauseMusic').disabled=musicPending||musicState.paused||!occupied;
  $('clearMusicQueue').disabled=musicPending||!queue.length;
  $('musicQueue').replaceChildren();
  for(const item of queue){const row=document.createElement('li'),title=document.createElement('span'),remove=document.createElement('button');title.textContent=`${item.input.title} · 시드 ${item.input.seed}`;remove.textContent='삭제';remove.className='quiet';remove.disabled=musicPending;remove.setAttribute('aria-label',`${item.input.title} 예약 삭제`);remove.onclick=()=>musicAction(()=>window.ocut.removeQueuedMusic(item.id),'예약을 삭제했습니다.');row.dataset.queueId=item.id;row.append(title,remove);$('musicQueue').append(row);}
  $('musicProgress').hidden = !running;
  $('musicActivity').hidden = !running;
  if (job) {
    const progress=OcutStudioView.musicProgress(job);
    $('musicJobTitle').textContent=job.title;
    $('musicStage').textContent=progress.label;
    $('musicActivity').textContent=`♫ ${progress.label}`;
    $('musicActivity').title=`${job.title} · 음악 생성 상태 보기`;
    if(progress.percent===null)$('musicProgressBar').removeAttribute('value');else $('musicProgressBar').value=progress.percent;
    $('musicProgressBar').setAttribute('aria-label',progress.label);
    $('musicDetail').textContent=progress.detail;
    updateMusicElapsed();
  }
  $('musicEnvironment').textContent = `${musicState.configured ? '로컬 경로 연결됨' : '실행 환경 연결 필요'}\nPython: ${musicState.config.python}\n모델: ${musicState.config.models}`;
  const holder = $('musicJobs');for(const audio of holder.querySelectorAll('audio'))audio.pause();holder.replaceChildren();
  const jobs = musicState.jobs.filter(item => item.id !== job?.id);
  for(const id of selectedMusicIds)if(!jobs.some(j=>j.id===id&&j.status==='complete'))selectedMusicIds.delete(id);
  voiceControls();
  if (!jobs.length) { const hint = document.createElement('p'); hint.className = 'music-hint'; hint.textContent = '완료된 음악을 타임라인에 넣어 편집하세요.'; holder.append(hint); }
  for (const item of jobs) {
    const card = document.createElement('article'); card.className = 'music-job'; card.dataset.jobId = item.id;
    const title = document.createElement('strong'); title.textContent = item.title;
    const info = document.createElement('p');
    info.textContent = item.status === 'complete' ? `${Number.isFinite(item.duration)?item.duration.toFixed(2):'?'}초 · 시드 ${item.seed}${item.meta?.truncated?.semantic ? ' · 길이 상한 도달' : ''}` : item.message;
    const tag = document.createElement('span'); tag.className = 'music-job-status'; tag.textContent = {complete:'완료',failed:'실패',cancelled:'취소',interrupted:'중단'}[item.status] || item.status;
    card.append(title, tag, info);
    if (item.status === 'complete') {
      const choice=document.createElement('label');choice.className='music-choice';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='music-select';checkbox.checked=selectedMusicIds.has(item.id);checkbox.disabled=musicPending;checkbox.setAttribute('aria-label',`${item.title} 검사 선택`);checkbox.onchange=()=>{checkbox.checked?selectedMusicIds.add(item.id):selectedMusicIds.delete(item.id);voiceControls();};choice.append(checkbox,document.createTextNode(' 검사 선택'));card.prepend(choice);
      const report=voiceReports.get(item.id)||item.voiceCheck;
      if(report){const result=document.createElement('p');result.className='voice-verdict';result.dataset.verdict=report.verdict;result.textContent=voiceLabels[report.verdict]+(report.message?` · ${report.message}`:` · 전체 ${report.duration.toFixed(1)}초 검사`);card.append(result);}
      const player=document.createElement('audio');player.controls=true;player.preload='none';player.src=`ocut-music://song/${item.id}`;player.className='music-audio';player.setAttribute('aria-label',`${item.title} 원본 듣기`);player.onplay=()=>{playback.pause();for(const other of document.querySelectorAll('.music-audio'))if(other!==player)other.pause();};card.append(player);
      if(report?.windows){const candidates=report.windows.filter(w=>w.speech>=.25||w.singing>=.15||w.humming>=.15);if(candidates.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`검출 후보 구간 ${candidates.length}개 · 모델 점수`;details.append(summary);for(const w of candidates){const button=document.createElement('button');button.className='quiet voice-segment';button.textContent=`${w.start.toFixed(1)}–${w.end.toFixed(1)}초 듣기 · 말 ${w.speech.toFixed(2)} / 노래 ${w.singing.toFixed(2)} / 허밍 ${w.humming.toFixed(2)}`;button.onclick=async()=>{try{if(player.readyState<1){player.load();await new Promise((resolve,reject)=>{player.addEventListener('loadedmetadata',resolve,{once:true});player.addEventListener('error',()=>reject(Error('음원을 읽지 못했습니다.')),{once:true});});}player.currentTime=w.start;await player.play();}catch(e){message(e.message,true);}};details.append(button);}card.append(details);}}
      const add = document.createElement('button'); add.className = 'secondary full music-add'; add.textContent = '＋ 타임라인에 넣기'; add.onclick = () => act(async()=>{const next=await window.ocut.addMusic(item.id);showPane('media');return next;}, '생성한 음악을 타임라인에 추가했습니다.');
      const folder=document.createElement('button');folder.className='secondary full music-folder';folder.textContent='저장 폴더 열기';folder.onclick=()=>openMusicFolder(item.id);card.append(add,folder);
    }
    const remove=document.createElement('button');remove.className='quiet full music-delete';remove.textContent='완전 삭제';remove.setAttribute('aria-label',`${item.title} 곡 완전 삭제`);remove.title='음원과 생성 임시파일을 함께 완전 삭제';remove.disabled=Boolean(musicPending||occupied);remove.onclick=()=>deleteGeneratedMusic(item.id);card.append(remove);
    holder.append(card);
  }
}
$('voiceSelectInstrumentals').onclick=()=>{selectedMusicIds.clear();for(const job of musicState.jobs)if(job.status==='complete'&&job.instrumental)selectedMusicIds.add(job.id);renderMusic();};
$('voiceClearSelection').onclick=()=>{selectedMusicIds.clear();renderMusic();};
$('voiceSelectDetected').onclick=()=>{selectedMusicIds.clear();for(const [id,report] of voiceReports)if(report.verdict==='detected')selectedMusicIds.add(id);renderMusic();};
$('voiceCancel').onclick=()=>{window.ocut.cancelVoiceScan();$('voiceStatus').textContent='검사를 취소하고 있습니다…';};
$('voiceScan').onclick=async()=>{
  if(musicPending||!selectedMusicIds.size)return;
  musicPending=true;voiceRunning=true;voiceScanId=null;voiceReports=new Map();renderMusic();$('voiceStatus').textContent='모델과 원본 파일을 확인하고 있습니다…';
  try{const result=await window.ocut.scanMusicVoices([...selectedMusicIds]);voiceScanId=result.scanId;voiceReports=new Map(result.reports.map(r=>[r.id,r]));renderMusic(result.state);const counts={};for(const r of result.reports)counts[r.verdict]=(counts[r.verdict]||0)+1;$('voiceStatus').textContent=`검사 완료 · 검출 ${counts.detected||0} / 확인 필요 ${counts.review||0} / 미검출 ${counts.not_detected||0} / 실패 ${counts.error||0}곡`;}
  catch(e){$('voiceStatus').textContent=e.message;message(e.message,true);}
  finally{voiceRunning=false;musicPending=false;renderMusic();}
};
$('voiceDelete').onclick=async()=>{
  if(musicPending)return;musicPending=true;renderMusic();
  try{const result=await window.ocut.deleteVoiceMusic({ids:[...selectedMusicIds],scanId:voiceScanId});if(result){voiceScanId=null;voiceReports.clear();renderMusic(result.state);message(`${result.deleted.length}곡 완전 삭제${result.error?' · 중단: '+result.error:''}`,Boolean(result.error));}else message('삭제를 취소했습니다.');}
  catch(e){message(e.message,true);}finally{musicPending=false;renderMusic();}
};
function renderVoiceModel(value){if(value)$('voiceModelInfo').textContent=`${value.available?'로컬 모델 연결됨':'모델 연결 필요'} · ${value.model}\n자동 다운로드 없이 로컬에서 검사합니다.`;}
$('voiceModel').onclick=async()=>{try{renderVoiceModel(await window.ocut.voiceModel());}catch(e){message(e.message,true);}};
window.ocut.voiceSettings().then(renderVoiceModel).catch(e=>message(e.message,true));
window.ocut.onVoiceProgress(value=>{if(!voiceRunning)return;const job=musicState?.jobs.find(j=>j.id===value.id);$('voiceStatus').textContent=value.type==='progress'?`${job?.title||'선택곡'} · 구간 ${value.completedWindows}/${value.totalWindows} 검사 중`:`${job?.title||'선택곡'} · ${value.type==='checked'?'검사 완료':'원본 준비'}`;});
async function openMusicFolder(id){try{const directory=await window.ocut.openMusicFolder(id);message(`저장 폴더: ${directory}`);}catch(error){message(error.message,true);}}
async function deleteGeneratedMusic(id){
  if(musicPending)return;musicPending=true;renderMusic();
  try{const result=await window.ocut.deleteGeneratedMusic(id);if(result){renderMusic(result.state);message(`곡과 관련 파일 ${result.deleted.files}개를 완전히 삭제했습니다.`);}else message('삭제를 취소했습니다.');}
  catch(error){message(error.message,true);try{renderMusic(await window.ocut.musicState());}catch{}}
  finally{musicPending=false;renderMusic();}
}
$('musicFolder').onclick=()=>openMusicFolder();
$('musicActivity').onclick=()=>showPane('music');
function updateMusicElapsed(){if(musicState?.current){const seconds=Math.max(0,(Date.now()-Date.parse(musicState.current.createdAt))/1000);$('musicElapsed').textContent=`경과 ${OcutStudioView.timeLabel(Number.isFinite(seconds)?seconds:0)} · 현재 단계 진행률`;}}
setInterval(updateMusicElapsed,1000);
const musicGenres=new Set(['acoustic']);
let musicStyleEdited=false;
function writeMusicStyle(force=false){
  if(force===true||!musicStyleEdited)$('musicStyle').value=OcutMusicStyles.compose({selected:[...musicGenres],mood:$('musicMood').value,instrumental:$('musicInstrumental').checked,voice:$('musicVoice').value});
  for(const button of $('musicGenres').children)button.setAttribute('aria-pressed',String(musicGenres.has(button.dataset.genre)));
  $('musicVoice').disabled=musicPending||$('musicInstrumental').checked;
}
for(const genre of OcutMusicStyles.genres){const button=document.createElement('button');button.type='button';button.textContent=genre.label;button.dataset.genre=genre.id;button.onclick=()=>{if(musicGenres.has(genre.id))musicGenres.delete(genre.id);else if(musicGenres.size<3)musicGenres.add(genre.id);else{message('장르는 최대 3개까지 조합할 수 있습니다.',true);return;}writeMusicStyle();};$('musicGenres').append(button);}
$('musicStyleClear').onclick=()=>{musicGenres.clear();writeMusicStyle();};
$('musicMood').onchange=()=>writeMusicStyle();$('musicVoice').onchange=()=>writeMusicStyle();
$('musicStyle').oninput=()=>{musicStyleEdited=true;$('promptHint').textContent='직접 작성한 프롬프트를 유지합니다. 장르 선택으로 바꾸려면 아래 버튼을 누르세요.';};
$('musicStyleBuild').onclick=()=>{musicStyleEdited=false;writeMusicStyle(true);$('promptHint').textContent='선택한 장르로 작성했습니다. 직접 수정할 수 있습니다.';};
$('musicInstrumental').onchange = () => { const instrumental=$('musicInstrumental').checked;$('musicLyrics').disabled=instrumental;$('musicLyrics').required=!instrumental;$('lyricsHint').textContent=instrumental?'가사는 보관하지만 생성에는 사용하지 않습니다. 로파이·BGM 연주곡을 만듭니다.':'[Verse] · [Chorus] · [Bridge]로 구간을 나눠 작성하세요.';writeMusicStyle(); };
writeMusicStyle();
$('musicCount').oninput=()=>{const count=Number($('musicCount').value);$('generateMusic').textContent=Number.isInteger(count)&&count>=1&&count<=10?`${count}곡 생성`:'곡 수를 확인해 주세요';};
const musicInput=()=>({title:$('musicTitle').value,style:$('musicStyle').value,lyrics:$('musicInstrumental').checked?'':$('musicLyrics').value,instrumental:$('musicInstrumental').checked,seconds:Number($('musicSeconds').value),quality:$('musicQuality').value,seed:$('musicSeed').value});
async function musicAction(action,text){if(musicPending)return;musicPending=true;renderMusic();try{renderMusic(await action());message(text);}catch(error){message(error.message,true);}finally{musicPending=false;renderMusic();}}
$('enqueueMusic').onclick=()=>{if($('musicForm').reportValidity())musicAction(()=>window.ocut.enqueueMusic(musicInput(),Number($('musicCount').value)),'대기열에 추가했습니다.');};
$('resumeMusic').onclick=()=>musicAction(()=>window.ocut.resumeMusic(),'대기열을 재개했습니다.');
$('pauseMusic').onclick=()=>musicAction(()=>window.ocut.pauseMusic(),'현재 곡이 끝나면 대기합니다.');
$('clearMusicQueue').onclick=()=>musicAction(()=>window.ocut.clearMusicQueue(),'대기 목록을 비웠습니다.');
$('musicForm').onsubmit = async event => {
  event.preventDefault(); if (musicPending || musicState?.current) return; musicPending = true; renderMusic();
  try { const count=Number($('musicCount').value);renderMusic(await window.ocut.startMusic(musicInput(),count)); message(`${count}곡 생성을 시작했습니다. 한 곡씩 순서대로 만들며, 생성 중에도 프로젝트를 편집할 수 있습니다.`); }
  catch (error) { message(error.message,true); }
  finally { musicPending = false; renderMusic(); }
};
$('cancelMusic').onclick = () => { window.ocut.cancelMusic(); $('musicDetail').textContent = '취소하고 있습니다…'; };
for (const [id,key] of [['musicPython','python'],['musicModels','models']]) $(id).onclick = async () => {
  try { renderMusic(await window.ocut.configureMusic(key)); } catch (error) { message(error.message,true); }
};
$('checkMusic').onclick = async () => {
  musicPending = true; renderMusic(); $('musicCheckResult').textContent = '실행 환경을 확인하고 있습니다…';
  try { const value = await window.ocut.checkMusic(); $('musicCheckResult').textContent = `${value.cuda && value.models ? '환경 확인 완료' : '환경 준비 필요'} · ${value.gpu || 'CUDA GPU 없음'} · YuE2 ${value.engine}`; }
  catch (error) { $('musicCheckResult').textContent = error.message; }
  finally { musicPending = false; renderMusic(); }
};
window.ocut.onMusicState(renderMusic);
function renderUpdate(value){$('updatesOpen').textContent=value.status==='ready'?'업데이트 준비됨':value.status==='error'?'업데이트 확인 필요':`O-CUT ${value.currentVersion}`;$('updatesOpen').title=value.message;$('updateVersion').textContent=`현재 버전 ${value.currentVersion}`;$('updateMessage').textContent=value.message;$('updatesRestart').disabled=value.status!=='ready';$('updatesCheck').disabled=['checking','preparing','scheduled'].includes(value.status)||!value.enabled;}
window.ocut.onUpdateState(renderUpdate);window.ocut.updateState().then(renderUpdate).catch(error=>message(error.message,true));
$('updatesOpen').onclick=()=>{$('updatesDialog').showModal();};$('updatesClose').onclick=()=>$('updatesDialog').close();
$('updatesCheck').onclick=async()=>{try{renderUpdate(await window.ocut.checkUpdates());}catch(error){$('updateMessage').textContent=error.message;}};
$('updatesRestart').onclick=async()=>{try{await window.ocut.restartToUpdate();}catch(error){$('updateMessage').textContent=error.message;}};
window.ocut.musicState().then(renderMusic).catch(error => message(error.message,true));
window.ocut.sttSettings().then(value=>{$('sttModelPath').textContent=value.model||'Whisper 모델 연결 필요';}).catch(error=>message(error.message,true));
$('sttModel').onclick=async()=>{try{const value=await window.ocut.sttModel();if(value)$('sttModelPath').textContent=value.model;}catch(error){message(error.message,true);}};
window.ocut.onTranscriptionProgress(text=>{$('transcriptionProgress').textContent=text;});
$('transcriptionDialog').addEventListener('cancel',event=>event.preventDefault());
$('cancelTranscription').onclick=()=>{window.ocut.cancelTranscription();$('cancelTranscription').disabled=true;$('transcriptionProgress').textContent='취소하고 있습니다…';};
$('transcribe').onclick=async()=>{
  if(busy)return;busy=exporting=true;playback.pause();$('cancelTranscription').disabled=false;$('transcriptionProgress').textContent='음성을 준비하고 있습니다…';$('transcriptionDialog').showModal();
  try{const next=await window.ocut.transcribe({clipId:$('sttSource').value,language:$('sttLanguage').value,device:$('sttDevice').value});render(next);message('자동 자막을 만들었습니다. 내용과 시간을 확인하고 수정해 주세요.');}
  catch(error){message(error.message,true);}
  finally{$('transcriptionDialog').close();busy=exporting=false;}
};
