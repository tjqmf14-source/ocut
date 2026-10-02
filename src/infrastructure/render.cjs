'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { renderPlan } = require('../core/render-plan.cjs');
const { probe, tool, run } = require('./media.cjs');
const {visualizerVideo}=require('./visualizer-video.cjs');
const {animated}=require('../core/keyframes.js');
async function renderVideo({ project, library, target, cacheDir, textImage, visualImage, onProgress, signal }) {
  if (path.extname(target).toLowerCase() !== '.mp4') throw Error('출력 파일은 .mp4 형식이어야 합니다.');
  const parent = await fs.realpath(path.dirname(target)); target = path.join(parent, path.basename(target));
  for (const asset of library.assets.values()) if (asset.path.toLowerCase() === target.toLowerCase()) throw Error('원본 미디어에 덮어쓸 수 없습니다.');
  const previous = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw Error('일반 파일 경로를 선택해 주세요.');
  const job = path.join(cacheDir, 'render-' + randomUUID()); await fs.mkdir(job, { recursive: true });
  const partial = path.join(parent, `.ocut-${randomUUID()}.mp4`), textFiles = new Map(), assets = new Map(), visualFiles = new Map();
  const visualClips=project.clips.filter(c=>animated(c)&&!['audio','music'].includes(c.type)&&!project.tracks.find(t=>t.id===c.trackId).hidden);
  try {
    for (const c of project.clips) {
      if (signal?.aborted) throw Error('내보내기를 취소했습니다.');
      if (c.source && !assets.has(c.source)) {
        const item = library.assets.get(c.source); if (!item) throw Error('미디어를 다시 연결한 후 출력해 주세요.');
        const info = await probe(item.path);
        if (info.key !== item.key) throw Error('원본 미디어가 변경되었습니다. 프로젝트를 다시 열어 주세요.');
        assets.set(c.source, info);
      }
      if (['text', 'subtitle'].includes(c.type)) {
        const data = await textImage(c, project.canvas, project.exportSettings);
        if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 48 * 1024 * 1024) throw Error('텍스트 이미지 생성 실패');
        const file = path.join(job, `${textFiles.size}.png`); await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64')); textFiles.set(c.id, file);
      }
    }
    for(const [index,clip] of visualClips.entries()){
      const target=path.join(job,`visual-${index}.mov`);
      await visualizerVideo({clip,canvas:project.canvas,output:project.exportSettings,target,image:visualImage,signal,onProgress:f=>onProgress?.(25*(index+f)/visualClips.length)});
      visualFiles.set(clip.id,target);
    }
    const plan = renderPlan(project, assets, textFiles, visualFiles);
    const filter = path.join(job, 'filter.txt'); await fs.writeFile(filter, plan.graph);
    const args = ['-hide_banner', '-v', 'warning', '-nostdin', '-y', ...plan.args, '-filter_complex_threads', '2', '-/filter_complex', filter,
      '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-threads', '4', '-pix_fmt', 'yuv420p', '-r', String(plan.fps),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(plan.duration), '-movflags', '+faststart', '-progress', 'pipe:1', partial];
    await fs.writeFile(path.join(job, 'job.json'), JSON.stringify({ project, target, args }, null, 2));
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(Error('내보내기를 취소했습니다.'));
      const child = spawn(tool('ffmpeg'), args, { windowsHide: true }); let error = '', tail = '';
      const cancel = () => child.kill(); signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', data => {
        tail += data; const lines = tail.split('\n'); tail = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const micros = Number(line.split('=')[1]);
          // FFmpeg reports N/A until its first timestamp is available.
          if (Number.isFinite(micros)) onProgress?.(Math.min(99, (visualClips.length?25:0)+Math.max(0, micros / 1e6 / plan.duration * (visualClips.length?74:100))));
        }
      });
      child.stderr.on('data', data => { error = (error + data).slice(-12000); });
      child.on('error', reject);
      child.on('close', async code => {
        signal?.removeEventListener('abort', cancel);
        await fs.writeFile(path.join(job, 'ffmpeg.log'), error).catch(() => {});
        if (signal?.aborted) reject(Error('내보내기를 취소했습니다.'));
        else if (code !== 0) reject(Error(`영상 출력에 실패했습니다: ${error.slice(-1500)}`)); else resolve();
      });
    });
    if (signal?.aborted) throw Error('내보내기를 취소했습니다.');
    const metadata = JSON.parse((await run(tool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', partial])).toString());
    const video = metadata.streams.find(s => s.codec_type === 'video'), audio = metadata.streams.find(s => s.codec_type === 'audio');
    const fps = video?.avg_frame_rate.split('/').map(Number);
    if (!video || !audio || video.width !== plan.width || video.height !== plan.height || Math.abs(fps[0] / fps[1] - plan.fps) > .001 || Math.abs(Number(metadata.format.duration) - plan.duration) > .1 || Number(metadata.format.size) <= 0) throw Error('출력 파일 검증 실패');
    if (signal?.aborted) throw Error('내보내기를 취소했습니다.');
    const now = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (Boolean(now) !== Boolean(previous) || now && (now.mtimeMs !== previous.mtimeMs || now.size !== previous.size || now.ino !== previous.ino)) throw Error('출력 중 대상 파일이 변경되어 덮어쓰기를 중단했습니다.');
    await fs.rename(partial, target);
    const result = { target, metadata, job, encoder: 'libx264 (CPU)' };
    await fs.writeFile(path.join(job, 'result.json'), JSON.stringify(result, null, 2));
    onProgress?.(100); return result;
  } finally { await fs.unlink(partial).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
module.exports = { renderVideo };
