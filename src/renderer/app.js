'use strict';
const $ = id => document.getElementById(id);
let state;
let busy = false;
const labels = { text: 'T', video: '▣', audio: '♫' };
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function render(next) {
  if (next) state = next;
  const p = state.project;
  $('documentTitle').textContent = p.name;
  $('saveState').textContent = state.dirty ? '변경됨' : state.location ? '저장됨' : '저장 전';
  document.title = `${p.name}${state.dirty ? ' *' : ''} — O-CUT`;
  $('undo').disabled = !state.canUndo;
  $('redo').disabled = !state.canRedo;
  $('projectName').value = p.name;
  $('resolution').value = `${p.canvas.width},${p.canvas.height}`;
  $('fps').value = String(p.canvas.fps);
  $('canvasInfo').textContent = `${p.canvas.width} × ${p.canvas.height} · ${p.canvas.fps} FPS`;
  $('preview').width = p.canvas.width;
  $('preview').height = p.canvas.height;
  const ctx = $('preview').getContext('2d');
  ctx.fillStyle = p.canvas.background; ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
  $('trackHeaders').replaceChildren(); $('tracks').replaceChildren();
  for (const track of p.tracks) {
    const head = document.createElement('div'); head.className = 'track-head';
    const symbol = document.createElement('span'); symbol.className = 'track-symbol'; symbol.textContent = labels[track.type] || '▣';
    const name = document.createElement('span'); name.textContent = track.name;
    head.append(symbol, name); $('trackHeaders').append(head);
    const lane = document.createElement('div'); lane.className = 'track-lane'; $('tracks').append(lane);
  }
}
async function act(work, note) {
  if (busy) return;
  busy = true;
  try { const next = await work(); if (next) { render(next); message(note || '적용했습니다.'); } }
  catch (error) { message(error.message, true); }
  finally { busy = false; }
}
$('newProject').onclick = () => act(() => window.ocut.newProject(), '새 프로젝트를 만들었습니다.');
$('openProject').onclick = () => act(() => window.ocut.openProject(), '프로젝트를 열었습니다.');
$('save').onclick = () => act(() => window.ocut.saveProject(false), '프로젝트를 저장했습니다.');
$('saveAs').onclick = () => act(() => window.ocut.saveProject(true), '프로젝트를 저장했습니다.');
$('undo').onclick = () => act(() => window.ocut.undo(), '실행을 취소했습니다.');
$('redo').onclick = () => act(() => window.ocut.redo(), '다시 실행했습니다.');
$('projectForm').onsubmit = event => {
  event.preventDefault(); const [width, height] = $('resolution').value.split(',').map(Number);
  act(() => window.ocut.settings({ name: $('projectName').value.trim(), width, height, fps: Number($('fps').value) }), '프로젝트 설정을 적용했습니다.');
};
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's') { event.preventDefault(); $('save').click(); }
  if (key === 'z' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $(event.shiftKey ? 'redo' : 'undo').click(); }
});
act(() => window.ocut.state(), '프로젝트 준비됨');
