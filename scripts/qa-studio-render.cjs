'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require('playwright-core');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'evidence/studio');
const source = JSON.parse(fs.readFileSync(path.join(evidence, 'timeline-qa.json')));
const data = path.join(root, '.runtime', `render-qa-${Date.now()}`); fs.mkdirSync(data, { recursive: true });
const errors = [], results = []; let app;
const run = (tool, args) => { const r = spawnSync(tool, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr?.toString()); return r; };
async function main() {
  app = await _electron.launch({ executablePath: path.join(root, 'dist/studio/O-CUT.exe'), env: { ...process.env, OCUT_DATA_DIR: path.join(data, 'user') } });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => document.querySelector('#status').textContent === '프로젝트 준비됨');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source.save);
  await page.locator('#openProject').click(); await page.waitForFunction(() => document.querySelectorAll('.clip').length === 4);
  for (const [width, height, fps] of [[1920,1080,30],[1920,1080,60],[3840,2160,30]]) {
    await page.locator('#resolution').selectOption(`${width},${height}`); await page.locator('#fps').selectOption(String(fps));
    await page.locator('#projectForm button').click();
    await page.waitForFunction(([w, f]) => document.querySelector('#canvasInfo').textContent.includes(`${w} ×`) && document.querySelector('#canvasInfo').textContent.includes(`${f} FPS`), [width, fps]);
    await page.evaluate(() => playback.seek(2.5));
    await page.waitForFunction(() => playback.project.clips.filter(c => c.type === 'video' && c.startTime <= 2.5 && c.startTime + c.duration > 2.5).every(c => {
      const e = playback.nodes.get(c.id); return e && !e.node.seeking && e.node.readyState >= 2 && Math.abs(e.node.currentTime - (c.sourceStart + (2.5 - c.startTime) * c.speed)) < .04;
    }));
    const preview = path.join(data, `${height}-${fps}-preview.png`);
    fs.writeFileSync(preview, Buffer.from((await page.locator('#preview').evaluate(c => c.toDataURL())).split(',')[1], 'base64'));
    const output = path.join(data, `O-CUT-${height}p-${fps}.mp4`);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, output);
    await page.locator('#exportVideo').click();
    await page.waitForFunction(() => !document.querySelector('#exportDialog').open, null, { timeout: 180000 });
    assert.match(await page.locator('#status').textContent(), /내보내기 완료/, await page.locator('#status').textContent());
    const metadata = JSON.parse(run('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output]).stdout);
    const v = metadata.streams.find(s => s.codec_type === 'video'), a = metadata.streams.find(s => s.codec_type === 'audio');
    assert.equal(v.width,width); assert.equal(v.height,height); assert.equal(v.avg_frame_rate,`${fps}/1`); assert.equal(v.codec_name,'h264'); assert.equal(a.codec_name,'aac'); assert.ok(Math.abs(Number(metadata.format.duration)-6)<.05);
    run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
    const frame = path.join(data, `${height}-${fps}-export.png`);
    run('ffmpeg',['-v','error','-ss','2.5','-i',output,'-frames:v','1','-y',frame]);
    const comparison = run('ffmpeg',['-i',preview,'-i',frame,'-lavfi','ssim','-f','null','-']).stderr.toString();
    const rgbSsim = Number(comparison.match(/All:([\d.]+)/)?.[1]);
    // Compare in the delivered video's YUV420 format; retain RGB results too.
    const normalized = run('ffmpeg',['-i',preview,'-i',frame,'-lavfi','[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim','-f','null','-']).stderr.toString();
    const ssim = Number(normalized.match(/All:([\d.]+)/)?.[1]); assert.ok(ssim > .98, `Preview/export YUV420 SSIM ${ssim}`);
    const pcm = run('ffmpeg',['-v','error','-ss','2.5','-i',output,'-t','0.2','-vn','-ac','1','-ar','8000','-f','f32le','pipe:1']).stdout;
    const bins = [440,880].map(hz => { let re=0,im=0; for(let i=0;i<pcm.length/4;i++){const x=pcm.readFloatLE(i*4);re+=x*Math.cos(2*Math.PI*hz*i/8000);im-=x*Math.sin(2*Math.PI*hz*i/8000);}return Math.hypot(re,im)/(pcm.length/4); });
    assert.ok(bins.every(x=>x>.015),`Expected both source tones: ${bins}`);
    results.push({ output, preview, frame, width, height, fps, bytes: Number(metadata.format.size), duration: metadata.format.duration, fullDecode: true, ssim, rgbSsim, comparisonFormat: 'yuv420p', audioToneMagnitudes: bins, metadata });
    console.log(`Export PASS ${height}p${fps}, SSIM ${ssim}, both audio sources decoded`);
  }
  await page.screenshot({ path: path.join(evidence,'export-complete.png') });
  assert.deepEqual(errors, []);
  await app.evaluate(({ app }) => app.exit()); app = null;
  fs.writeFileSync(path.join(evidence,'render-qa.json'),JSON.stringify({time:new Date().toISOString(),data,sourceProject:source.save,results,errors},null,2));
}
main().catch(async e=>{fs.writeFileSync(path.join(evidence,'render-failure.json'),JSON.stringify({error:e.stack,data,results,errors},null,2));console.error(e);if(app)await app.evaluate(({app})=>app.exit()).catch(()=>{});process.exitCode=1;});
