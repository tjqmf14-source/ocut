'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process'), { _electron } = require('playwright-core');
const { parseCaptions } = require('../src/core/captions.cjs');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'evidence/studio');
const timeline = JSON.parse(fs.readFileSync(path.join(evidence, 'timeline-qa.json')));
const data = path.join(root, '.runtime', 'captions-' + Date.now()); fs.mkdirSync(data, { recursive: true });
const checks = [], errors = []; let app;
const run = (name, args) => { const r = spawnSync(name, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr?.toString()); return r; };
const count = async (page, n) => page.waitForFunction(n => document.querySelectorAll('.clip.subtitle').length === n, n);
async function main() {
  const srt = path.join(data, '한글 자막.srt'), vtt = path.join(data, 'captions.vtt'), bad = path.join(data, 'bad.srt');
  fs.writeFileSync(srt, '\uFEFF1\r\n00:00:00,250 --> 00:00:01,750\r\n첫 번째 자막\r\n두 줄입니다\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,500\r\n두 번째 자막\r\n\r\n3\r\n00:00:04,500 --> 00:00:05,750\r\n세 번째 자막\r\n');
  fs.writeFileSync(vtt, 'WEBVTT\n\nNOTE QA comment\n\ncue-id\n00:04.000 --> 00:04.400 align:start\n<v 소라>WebVTT &amp; 한글\n');
  fs.writeFileSync(bad, '1\n00:00:02,000 --> 00:00:01,000\n잘못된 구간\n');
  const env = { ...process.env, OCUT_DATA_DIR: path.join(data, 'user') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: path.join(root, 'dist/studio/O-CUT.exe'), env });
  let page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => document.querySelector('#status').textContent === '프로젝트 준비됨');
  await page.evaluate(() => {
    window.mediaTrace = [];
    const make = playback.node.bind(playback);
    playback.node = clip => {
      const entry = make(clip);
      if (entry && !entry.traced) { entry.traced = true; for (const event of ['loadedmetadata','loadeddata','seeking','seeked','emptied','error','canplay']) entry.node.addEventListener(event, () => { mediaTrace.push({ event, id: clip.id, cursor: playback.time, time: entry.node.currentTime, ready: entry.node.readyState }); if (mediaTrace.length > 60) mediaTrace.shift(); }); }
      return entry;
    };
  });
  const pickOpen = file => app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  const pickSave = file => app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
  await pickOpen(timeline.save); await page.locator('#openProject').click(); await page.waitForFunction(() => document.querySelectorAll('.clip').length === 4);
  const partial = await page.evaluate(async () => { const response = await fetch(Object.values(playback.assets)[0].url,{headers:{Range:'bytes=1-2'}}); return {status:response.status,length:response.headers.get('Content-Length'),range:response.headers.get('Content-Range'),bytes:(await response.arrayBuffer()).byteLength}; });
  assert.equal(partial.status,206); assert.equal(partial.length,'2'); assert.match(partial.range,/^bytes 1-2\//); assert.equal(partial.bytes,2);
  await page.locator('#captionsTab').click(); await pickOpen(srt); await page.locator('#importCaptions').click(); await count(page, 3);
  let state = await page.evaluate(() => window.ocut.state()); const firstId = state.project.clips.find(c => c.type === 'subtitle').id;
  assert.equal(state.project.clips.find(c => c.id === firstId).startTime, .25); assert.equal(await page.locator('.caption-item').count(), 3);
  checks.push('native SRT import creates three editable timed captions with multiline Korean');
  const ruler = await page.locator('#ruler').boundingBox(); await page.mouse.click(ruler.x + 70, ruler.y + 10);
  await page.locator('#split').click(); await count(page, 4);
  await page.locator('.caption-item').nth(0).click(); await page.locator('.caption-item').nth(1).click({ modifiers: ['Shift'] });
  await page.locator('#mergeCaptions').click(); await count(page, 3);
  state = await page.evaluate(() => window.ocut.state()); assert.equal(state.project.clips.find(c => c.id === firstId).duration, 1.5); assert.equal(state.project.clips.find(c => c.id === firstId).text, '첫 번째 자막\n두 줄입니다');
  checks.push('actual caption split and Shift multi-selection merge retain timing/text');
  await page.locator('#clipText').fill('수정한 한글 자막\n두 번째 줄'); await page.locator('#clipForm button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('.caption-item').textContent.includes('수정한 한글'));
  await page.locator('#undo').click(); await page.waitForFunction(() => !document.querySelector('.caption-item').textContent.includes('수정한 한글'));
  await page.locator('#redo').click(); await page.waitForFunction(() => document.querySelector('.caption-item').textContent.includes('수정한 한글'));
  checks.push('caption text edits undo redo through inspector');
  await pickOpen(vtt); await page.locator('#importCaptions').click(); await count(page, 4);
  assert.match(await page.locator('#status').textContent(), /기본 위치|일반 텍스트/);
  state = await page.evaluate(() => window.ocut.state()); assert.ok(state.project.clips.some(c => c.text === 'WebVTT & 한글'));
  const beforeBad = state.project; await pickOpen(bad); await page.locator('#importCaptions').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('종료 시간'));
  assert.deepEqual((await page.evaluate(() => window.ocut.state())).project, beforeBad);
  checks.push('VTT timestamps/entities and unsupported-format warning; invalid SRT leaves project unchanged');
  await page.evaluate(() => playback.seek(6)); await page.locator('#addCaption').click(); await count(page, 5);
  await page.locator('#clipText').fill('직접 작성한 마지막 자막'); await page.locator('#clipDuration').fill('1'); await page.locator('#clipForm button[type=submit]').click();
  await page.waitForFunction(() => state.project.clips.some(c => c.text === '직접 작성한 마지막 자막' && c.duration === 1));
  await page.locator('#captionSearch').fill('WebVTT'); assert.equal(await page.locator('.caption-item').count(), 1); await page.locator('#captionSearch').fill('');
  const outputSrt = path.join(data, '편집 결과.srt'); await pickSave(outputSrt); await page.locator('#exportCaptions').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('SRT 저장 완료'));
  const expected = (await page.evaluate(() => window.ocut.state())).project.clips.filter(c => c.type === 'subtitle').sort((a, b) => a.startTime - b.startTime).map(c => ({ startTime: c.startTime, duration: c.duration, text: c.text }));
  assert.deepEqual(parseCaptions(fs.readFileSync(outputSrt, 'utf8'), 'srt').segments, expected);
  checks.push('manual caption, search and real SRT export roundtrip exact text/timing');
  const save = path.join(data, '자막 프로젝트.ocut'); await pickSave(save); await page.locator('#saveAs').click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === '저장됨');
  const frames = [];
  // Compare exact 30-fps frame boundaries, not two neighboring decoded frames.
  for (const t of [.8, 4.2, 6.5]) {
    await page.evaluate(t => playback.seek(t), t);
    await page.waitForFunction(t => playback.project.clips.filter(c => c.type === 'video' && c.startTime <= t && c.startTime + c.duration > t).every(c => { const e = playback.nodes.get(c.id); return e && !e.node.seeking && e.node.readyState >= 2 && Math.abs(e.node.currentTime - c.sourceStart - (t - c.startTime) * c.speed) < .04; }), t);
    const preview = path.join(data, `preview-${t}.png`); fs.writeFileSync(preview, Buffer.from((await page.locator('#preview').evaluate(c => c.toDataURL())).split(',')[1], 'base64')); frames.push({ t, preview });
  }
  const output = path.join(data, 'O-CUT-captions-1080p.mp4'); await pickSave(output); await page.locator('#exportVideo').click();
  await page.waitForFunction(() => !document.querySelector('#exportDialog').open, null, { timeout: 120000 }); assert.match(await page.locator('#status').textContent(), /내보내기 완료/);
  const metadata = JSON.parse(run('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output]).stdout);
  assert.ok(Math.abs(Number(metadata.format.duration) - 7) < .05); assert.equal(metadata.streams.find(s => s.codec_type === 'video').width, 1920); assert.ok(metadata.streams.some(s => s.codec_type === 'audio'));
  run('ffmpeg', ['-v','error','-i',output,'-f','null','-']);
  for (const frame of frames) {
    frame.output = path.join(data, `output-${frame.t}.png`); run('ffmpeg', ['-v','error','-ss',String(frame.t),'-i',output,'-frames:v','1',frame.output]);
    const compare = run('ffmpeg', ['-i',frame.preview,'-i',frame.output,'-lavfi','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-f','null','-']).stderr.toString();
    frame.ssim = Number(compare.match(/All:([\d.]+)/)?.[1]); assert.ok(frame.ssim > .98, `Caption frame ${frame.t} SSIM ${frame.ssim}`);
  }
  checks.push('actual MP4 full decode plus SRT/VTT/manual caption frame comparisons');
  await page.screenshot({ path: path.join(evidence, 'captions-preview.png') });
  assert.deepEqual(errors, []); await app.close(); app = null;
  app = await _electron.launch({ executablePath: path.join(root, 'dist/studio/O-CUT.exe'), env }); page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#status').textContent === '프로젝트 준비됨'); await pickOpen(save); await page.locator('#openProject').click(); await count(page, 5);
  assert.deepEqual((await page.evaluate(() => window.ocut.state())).project, JSON.parse(fs.readFileSync(save)));
  checks.push('app relaunch restores all caption data exactly');
  await app.close(); app = null;
  fs.writeFileSync(path.join(evidence,'captions-qa.json'), JSON.stringify({time:new Date().toISOString(),data,save,outputSrt,output,checks,frames,metadata,errors},null,2));
  console.log('Captions QA PASS:', checks.length, 'checks; frame SSIM', frames.map(f => f.ssim));
}
main().catch(async e => {
  console.error(e); let diagnostic;
  if (app) { const page = await app.firstWindow(); diagnostic = await page.evaluate(() => ({ time: playback.time, duration: playback.duration, status: document.querySelector('#status').textContent, clips: playback.project.clips, trace: window.mediaTrace, nodes: [...playback.nodes].map(([id,e]) => ({ id, type:e.media.type, time:e.node.currentTime, ready:e.node.readyState, seeking:e.node.seeking, error:e.node.error?.message })) })).catch(() => null); }
  fs.writeFileSync(path.join(evidence,'captions-failure.json'),JSON.stringify({error:e.stack,data,checks,errors,diagnostic},null,2));
  if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{}); process.exitCode=1;
});
