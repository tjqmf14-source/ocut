'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { parseCaptions, serializeSrt } = require('../src/core/captions.cjs');
const { createProject, createTrack } = require('../src/core/project.cjs');
const { ProjectHistory } = require('../src/core/history.cjs');
const { applyCommand } = require('../src/core/timeline.cjs');
const { readCaptions, writeSrt } = require('../src/infrastructure/caption-files.cjs');
const sample = '\uFEFF1\r\n00:00:00,125 --> 00:00:02,250\r\n첫 번째 줄\r\n둘째 줄\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,500\r\nA &amp; B\r\n';
function imported() { const h = new ProjectHistory(createProject()); applyCommand(h, { type: 'captions', segments: parseCaptions(sample, 'srt').segments }); return h; }
test('SRT UTF-8 BOM and multiline import roundtrips exact millisecond timing', () => {
  const h = imported(), p = h.state; assert.equal(p.clips[0].startTime, .125); assert.equal(p.clips[0].duration, 2.125); assert.equal(p.clips[1].text, 'A & B');
  assert.deepEqual(parseCaptions(serializeSrt(p, p.tracks[0].id), 'srt').segments, parseCaptions(sample, 'srt').segments);
});
test('VTT cue identifiers settings comments markup and entities are handled explicitly', () => {
  const r = parseCaptions('WEBVTT\n\nNOTE ignore this\nnotes\n\nSTYLE\n::cue { color: lime; }\n\nscene-one\n00:01.000 --> 00:02.500 align:start\n<v 소라><b>안녕</b> &lt;친구&gt;\n', 'vtt');
  assert.equal(r.segments[0].text, '안녕 <친구>'); assert.equal(r.segments[0].duration, 1.5); assert.equal(r.warnings.length, 3);
  assert.equal(parseCaptions('WEBVTT\n \t\n00:00.000 --> 00:01.000\n본문', 'vtt').segments[0].text, '본문');
  assert.equal(parseCaptions('1\n00:00:00,000 --> 00:00:01,000\n<font color="red">색상</font>', 'srt').segments[0].text, '색상');
});
test('malformed, reversed, empty, oversized and unknown caption data reject', () => {
  for (const raw of ['', '1\n00:00:02,000 --> 00:00:01,000\n역순', '1\n00:61:00,000 --> 01:02:00,000\n잘못됨', '1\n00:00:01,000 --> 00:00:02,000\n', 'x'.repeat(2*1024*1024+1)]) assert.throws(() => parseCaptions(raw, 'srt'));
  assert.throws(() => parseCaptions(sample, 'vtt'), /헤더/); assert.throws(() => parseCaptions(sample, 'ass'));
});
test('caption import is one undoable transaction and invalid segments do not partially apply', () => {
  const h = imported(); h.undo(); assert.equal(h.state.clips.length, 0); h.redo(); assert.equal(h.state.clips.length, 2);
  const before = h.state; assert.throws(() => applyCommand(h, { type: 'captions', segments: [{ startTime: 1, duration: 1, text: '정상' }, { startTime: -2, duration: 1, text: '잘못됨' }] })); assert.deepEqual(h.state, before);
});
test('caption split and merge restore timing and do not duplicate identical split text', () => {
  const h = imported(), first = h.state.clips[0], right = applyCommand(h, { type: 'split', id: first.id, time: 1 });
  const merged = applyCommand(h, { type: 'mergeCaptions', ids: [first.id, right] }); const result = h.state.clips.find(c => c.id === merged);
  assert.equal(result.text, first.text); assert.equal(result.startTime, first.startTime); assert.equal(result.duration, first.duration); h.undo(); assert.equal(h.state.clips.length, 3);
});
test('caption merge refuses omitted middle segments and locked tracks', () => {
  const h = imported(), track = h.state.tracks[0].id;
  const middle = applyCommand(h, { type: 'subtitle', startTime: 2.3 }); const ids = h.state.clips.filter(c => c.id !== middle).map(c => c.id);
  assert.throws(() => applyCommand(h, { type: 'mergeCaptions', ids }), /사이/);
  applyCommand(h, { type: 'track', id: track, property: 'locked', value: true }); assert.throws(() => applyCommand(h, { type: 'mergeCaptions', ids }), /잠긴/);
});
test('SRT export isolates selected track and escapes literal markup', () => {
  const h = imported(); h.apply('second track', p => { p.tracks.push(createTrack('subtitle', '번역')); p.clips[0].text = '<b>그대로 & 표시</b>'; });
  assert.throws(() => serializeSrt(h.state, h.state.tracks[1].id), /없습니다/);
  const srt = serializeSrt(h.state, h.state.tracks[0].id); assert.match(srt, /&lt;b&gt;/); assert.equal(parseCaptions(srt, 'srt').segments[0].text, '<b>그대로 & 표시</b>');
});
test('real SRT file write/read preserves bytes and rejects invalid UTF-8 and non-file targets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocut-caption-')), file = path.join(dir, '한글.srt');
  const p = imported().state, text = serializeSrt(p, p.tracks[0].id);
  await writeSrt(file, text); assert.equal(await fs.readFile(file, 'utf8'), text); assert.equal((await readCaptions(file)).segments.length, 2);
  const bad = path.join(dir, 'bad.srt'); await fs.writeFile(bad, Buffer.from([0xff,0xff])); await assert.rejects(readCaptions(bad), /UTF-8/);
  const folder = path.join(dir, 'folder.srt'); await fs.mkdir(folder); await assert.rejects(writeSrt(folder, text), /일반 파일/);
});
