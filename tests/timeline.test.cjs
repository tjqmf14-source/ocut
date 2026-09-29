const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createProject, createTrack } = require('../src/core/project.cjs');
const { ProjectHistory } = require('../src/core/history.cjs');
const { applyCommand, durationOf } = require('../src/core/timeline.cjs');
function fixture() {
  const p = createProject(); p.tracks.push(createTrack('video'));
  p.media.push({ id: randomUUID(), type: 'video', path: 'D:/clip.mp4', name: 'clip', duration: 10, fingerprint: null });
  const h = new ProjectHistory(p); const id = applyCommand(h, { type: 'add', mediaId: p.media[0].id }); return { h, id };
}
test('new image track stays below titles and above audio', () => {
  const p = createProject(); p.tracks.push(createTrack('text'), createTrack('video'), createTrack('audio'));
  p.media.push({ id: 'image', type: 'image', path: 'D:/image.png', name: 'image', duration: null, fingerprint: null });
  const h = new ProjectHistory(p); applyCommand(h, { type: 'add', mediaId: 'image' });
  assert.deepEqual(h.state.tracks.map(t => t.type), ['text', 'video', 'image', 'audio']);
});
test('split preserves exact source span and is one undoable operation', () => {
  const { h, id } = fixture(); const right = applyCommand(h, { type: 'split', id, time: 3 });
  const [a, b] = h.state.clips; assert.equal(b.id, right); assert.equal(a.duration, 3); assert.equal(a.sourceEnd, 3); assert.equal(b.sourceStart, 3); assert.equal(b.duration, 7); assert.equal(b.startTime, 3); assert.equal(durationOf(h.state), 10);
  h.undo(); assert.equal(h.state.clips.length, 1); assert.equal(h.state.clips[0].duration, 10);
});
test('split at clip edge fails and preserves history state', () => {
  const { h, id } = fixture(); const before = h.state; assert.throws(() => applyCommand(h, { type: 'split', id, time: 0 })); assert.deepEqual(h.state, before);
});
test('trim and speed keep source-time mapping coherent', () => {
  const { h, id } = fixture(); applyCommand(h, { type: 'update', id, values: { sourceStart: 2, duration: 3, speed: 2 } });
  assert.equal(h.state.clips[0].sourceEnd, 8);
  const before = h.state; assert.throws(() => applyCommand(h, { type: 'update', id, values: { duration: 5 } })); assert.deepEqual(h.state, before);
});
test('locked tracks reject clip edits but can be unlocked', () => {
  const { h, id } = fixture(); const track = h.state.tracks[0].id;
  applyCommand(h, { type: 'track', id: track, property: 'locked', value: true });
  for (const action of [{ type: 'split', id, time: 3 }, { type: 'delete', ids: [id] }, { type: 'move', ids: [id], delta: 1 }, { type: 'duplicate', id }]) assert.throws(() => applyCommand(h, action), /잠긴/);
  applyCommand(h, { type: 'track', id: track, property: 'locked', value: false }); applyCommand(h, { type: 'move', ids: [id], delta: 1 }); assert.equal(h.state.clips[0].startTime, 1);
});
test('duplicate and ripple delete close only the affected track', () => {
  const { h, id } = fixture(); const copy = applyCommand(h, { type: 'duplicate', id });
  const text = applyCommand(h, { type: 'text', startTime: 12, text: '제목' });
  applyCommand(h, { type: 'delete', ids: [id], ripple: true });
  assert.equal(h.state.clips.find(c => c.id === copy).startTime, 0); assert.equal(h.state.clips.find(c => c.id === text).startTime, 12);
});
test('multi-selection move is atomic when one clip would go negative', () => {
  const { h, id } = fixture(); const copy = applyCommand(h, { type: 'duplicate', id }); const before = h.state;
  assert.throws(() => applyCommand(h, { type: 'move', ids: [id, copy], delta: -1 })); assert.deepEqual(h.state, before);
});
