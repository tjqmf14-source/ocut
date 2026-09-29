'use strict';
const $ = id => document.getElementById(id);
let state, busy = false, selected = new Set(), zoom = 70, snap = true, ripple = false;
const clipNodes = new Map(), cardNodes = new Map();
const symbols = { text: 'T', video: '▣', image: '▧', audio: '♫', music: '♫' };
const clock = t => { const m = Math.floor(t / 60); return `${String(m).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}`; };
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
const playback = new StudioPlayback($('preview'), (time, playing) => {
  $('timecode').textContent = clock(time); $('playhead').style.left = `${time * zoom}px`;
  $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? '일시정지' : '재생');
}, error => message(error, true));
const selectedClip = () => state?.project.clips.find(c => selected.has(c.id));
function render(next) {
  if (next) {
    if (state?.project.id !== next.project.id) selected.clear();
    state = next;
    if (Object.hasOwn(next, 'selectedId')) selected = new Set(next.selectedId ? [next.selectedId] : []);
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
  renderLibrary(); renderTimeline(); renderInspector();
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
  $('timelineContent').style.width = `${width}px`;
  $('trackHeaders').replaceChildren();
  const lanes = new Map([...$('tracks').children].map(node => [node.dataset.trackId, node]));
  for (const track of p.tracks) {
    const head = document.createElement('div'); head.className = 'track-head';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = `${symbols[track.type] || '▣'}  ${track.name}`;
    const toggles = document.createElement('div'); toggles.className = 'track-toggles';
    for (const [property, label, title] of [['locked', 'L', '트랙 잠금'], ['hidden', 'V', '화면 숨김'], ['muted', 'M', '음소거'], ['solo', 'S', '이 트랙만 듣기']]) {
      const button = document.createElement('button'); button.textContent = label; button.title = title; button.setAttribute('aria-label', `${track.name} ${title}`); button.setAttribute('aria-pressed', String(track[property]));
      button.onclick = () => edit({ type: 'track', id: track.id, property, value: !track[property] }); toggles.append(button);
    }
    head.append(name, toggles); $('trackHeaders').append(head);
    let lane = lanes.get(track.id);
    if (!lane) { lane = document.createElement('div'); lane.className = 'track-lane'; lane.dataset.trackId = track.id; $('tracks').append(lane); }
    lane.classList.toggle('locked', track.locked); lane.classList.toggle('track-hidden', track.hidden); lanes.delete(track.id);
    lane.ondragover = event => event.preventDefault();
    lane.ondrop = event => { event.preventDefault(); const id = event.dataTransfer.getData('application/ocut-media'); if (id) edit({ type: 'add', mediaId: id, startTime: timeAt(event.clientX) }); };
    lane.onpointerdown = event => { if (event.target !== lane) return; selected.clear(); playback.seek(timeAt(event.clientX)); renderSelection(); renderInspector(); };
  }
  for (const lane of lanes.values()) lane.remove();
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
  const ruler = $('ruler'); ruler.replaceChildren(); const step = zoom > 100 ? 1 : zoom > 40 ? 2 : 5;
  const body = $('timelineBody'), begin = Math.floor(body.scrollLeft / zoom / step) * step, end = (body.scrollLeft + body.clientWidth) / zoom + step;
  for (let time = begin; time <= end; time += step) { const marker = document.createElement('span'); marker.textContent = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`; marker.style.left = `${time * zoom + 6}px`; ruler.append(marker); }
}
function renderSelection() {
  for (const [id, node] of clipNodes) node.classList.toggle('selected', selected.has(id));
  const clip = selectedClip(), locked = clip && state.project.tracks.find(t => t.id === clip.trackId).locked;
  for (const id of ['split', 'duplicate', 'deleteClip']) $(id).disabled = !clip || locked;
}
function renderInspector() {
  const clip = selectedClip(); $('clipForm').hidden = !clip; $('projectForm').hidden = Boolean(clip); $('inspectorTitle').textContent = clip ? '클립 편집' : '프로젝트';
  if (!clip) return;
  const media = state.project.media.find(m => m.id === clip.source);
  $('clipName').textContent = clip.type === 'text' ? '텍스트' : media?.name || clip.type;
  const values = { clipStart: clip.startTime, clipDuration: clip.duration, clipSourceStart: clip.sourceStart, clipSpeed: clip.speed, clipX: clip.transform.x, clipY: clip.transform.y, clipScale: clip.transform.scaleX * 100, clipRotation: clip.transform.rotation, clipOpacity: clip.opacity * 100, clipVolume: clip.volume * 100 };
  for (const [id, value] of Object.entries(values)) $(id).value = Number(value.toFixed(3));
  $('clipText').value = clip.text; $('textField').hidden = !['text', 'subtitle'].includes(clip.type);
  $('transformFields').hidden = ['audio', 'music'].includes(clip.type); $('volumeField').hidden = !state.assets?.[clip.source]?.hasAudio;
  const locked = state.project.tracks.find(t => t.id === clip.trackId).locked;
  for (const field of $('clipForm').querySelectorAll('input,textarea,button[type=submit]')) field.disabled = locked;
}
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
  if (event.button !== 0 || busy) return;
  event.preventDefault();
  if (event.shiftKey) { selected.has(id) ? selected.delete(id) : selected.add(id); } else if (!selected.has(id)) selected = new Set([id]);
  renderSelection(); renderInspector();
  const clip = state.project.clips.find(c => c.id === id); if (state.project.tracks.find(t => t.id === clip.trackId).locked) return;
  const node = clipNodes.get(id), startX = event.clientX, side = event.target.dataset.trim;
  let delta = 0, moved = false; node.setPointerCapture(event.pointerId);
  node.onpointermove = move => {
    const raw = (move.clientX - startX) / zoom;
    if (Math.abs(move.clientX - startX) < 3 && !moved) return; moved = true;
    if (!side) { delta = snapped(raw, clip); for (const selectedId of selected) clipNodes.get(selectedId).style.transform = `translateX(${delta * zoom}px)`; }
    else {
      const frame = 1 / state.project.canvas.fps, media = state.project.media.find(m => m.id === clip.source);
      const quantized = Math.round(raw * state.project.canvas.fps) / state.project.canvas.fps;
      delta = side === 'left' ? Math.max(-clip.startTime, -clip.sourceStart / clip.speed, Math.min(clip.duration - frame, quantized)) : Math.max(frame - clip.duration, Math.min(media?.duration ? (media.duration - clip.sourceEnd) / clip.speed : 86400, quantized));
      node.style.left = `${(clip.startTime + (side === 'left' ? delta : 0)) * zoom}px`; node.style.width = `${(clip.duration + (side === 'left' ? -delta : delta)) * zoom}px`;
    }
  };
  node.onpointerup = () => {
    node.onpointermove = node.onpointerup = null;
    for (const n of clipNodes.values()) { n.style.transform = ''; n.dataset.key = ''; }
    if (!moved || !delta) { renderTimeline(); return; }
    if (!side) edit({ type: 'move', ids: [...selected], delta });
    else edit({ type: 'update', id, values: side === 'left' ? { startTime: clip.startTime + delta, sourceStart: clip.sourceStart + delta * clip.speed, duration: clip.duration - delta } : { duration: clip.duration + delta } });
  };
}
function showContext(x, y) {
  document.querySelector('.context-menu')?.remove(); const menu = document.createElement('div'); menu.className = 'context-menu'; menu.style.left = `${Math.min(x, innerWidth - 160)}px`; menu.style.top = `${Math.min(y, innerHeight - 150)}px`;
  for (const [label, id] of [['재생 헤드에서 분할', 'split'], ['클립 복제', 'duplicate'], ['클립 삭제', 'deleteClip']]) { const button = document.createElement('button'); button.textContent = label; button.disabled = $(id).disabled; button.onclick = () => { menu.remove(); $(id).click(); }; menu.append(button); }
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
$('split').onclick = () => { if (selectedClip()) edit({ type: 'split', id: selectedClip().id, time: playback.time }); };
$('duplicate').onclick = () => { if (selectedClip()) edit({ type: 'duplicate', id: selectedClip().id }); };
$('deleteClip').onclick = () => edit({ type: 'delete', ids: [...selected], ripple });
$('deselect').onclick = () => { selected.clear(); renderSelection(); renderInspector(); };
$('snap').onclick = () => { snap = !snap; $('snap').setAttribute('aria-pressed', String(snap)); };
$('ripple').onclick = () => { ripple = !ripple; $('ripple').setAttribute('aria-pressed', String(ripple)); };
$('zoom').oninput = () => { zoom = Number($('zoom').value); renderTimeline(); };
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
  edit({ type: 'update', id: clip.id, values: { startTime: num('clipStart'), duration: num('clipDuration'), sourceStart: num('clipSourceStart'), speed: num('clipSpeed'), text: $('clipText').value, volume: num('clipVolume') / 100, opacity: num('clipOpacity') / 100, transform: { x: num('clipX'), y: num('clipY'), scaleX: num('clipScale') / 100, scaleY: num('clipScale') / 100, rotation: num('clipRotation') } } });
};
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase(), typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); $(event.shiftKey ? 'saveAs' : 'save').click(); return; }
  if (typing) return;
  if (event.ctrlKey || event.metaKey) { if (key === 'z') { event.preventDefault(); $(event.shiftKey ? 'redo' : 'undo').click(); } if (key === 'd') { event.preventDefault(); $('duplicate').click(); } return; }
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
act(() => window.ocut.state(), '프로젝트 준비됨');
