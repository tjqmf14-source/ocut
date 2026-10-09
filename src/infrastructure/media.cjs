'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const TYPES = { '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.webm': 'video', '.avi': 'video', '.wav': 'audio', '.mp3': 'audio', '.m4a': 'audio', '.flac': 'audio', '.ogg': 'audio', '.aac': 'audio', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image' };
function tool(name) {
  const supplied = process.env[`OCUT_${name.toUpperCase()}`];
  if (supplied) return supplied;
  const bundled = path.join(process.resourcesPath || '', 'tools', `${name}.exe`);
  return fs.existsSync(bundled) ? bundled : name;
}
function run(exe, args, { timeout = 120000, maxBytes = 8 * 1024 * 1024, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if(signal?.aborted)return reject(Error('작업을 취소했습니다.'));
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let size = 0; let error = ''; let failure;
    const timer = setTimeout(() => { failure = Error('미디어 처리 시간이 초과되었습니다.'); child.kill(); }, timeout);
    const cancel=()=>{failure=Error('작업을 취소했습니다.');child.kill();};signal?.addEventListener('abort',cancel,{once:true});
    child.stdout.on('data', bytes => { size += bytes.length; if (size > maxBytes) { failure = Error('미디어 응답이 너무 큽니다.'); child.kill(); } else { out.push(bytes); onProgress?.(bytes.toString()); } });
    child.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-12000); });
    child.on('error', e => { clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(e); });
    child.on('close', code => { clearTimeout(timer);signal?.removeEventListener('abort',cancel);code === 0 && !failure ? resolve(Buffer.concat(out)) : reject(failure || Error(error.trim() || `${path.basename(exe)} 종료 코드 ${code}`)); });
  });
}
function mediaKey(resolved,stat){return createHash('sha256').update(JSON.stringify([resolved,stat.size,stat.mtimeMs,'wave-v1'])).digest('hex');}
async function probe(file) {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || file.startsWith('\\\\') || !path.isAbsolute(file)) throw Error('지원하는 로컬 미디어 파일을 선택해 주세요.');
  const resolved = await fsp.realpath(file);
  if (resolved.startsWith('\\\\')) throw Error('네트워크 미디어 경로는 지원하지 않습니다.');
  const stat = await fsp.stat(resolved); if (!stat.isFile()) throw Error('일반 미디어 파일만 가져올 수 있습니다.');
  const info = JSON.parse((await run(tool('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', resolved])).toString());
  const video = info.streams.find(item => item.codec_type === 'video');
  const audio = info.streams.find(item => item.codec_type === 'audio');
  if ((type === 'audio' && !audio) || (type !== 'audio' && !video)) throw Error('미디어 스트림을 읽을 수 없습니다.');
  const duration = type === 'image' ? null : Number(info.format.duration || video?.duration || audio?.duration);
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 28800)) throw Error('미디어 길이를 확인할 수 없거나 8시간을 초과했습니다.');
  const key = mediaKey(resolved,stat);
  return { type, path: resolved, duration, width: video?.width || 0, height: video?.height || 0, hasAudio: Boolean(audio), bytes: stat.size, key };
}
async function waveform(file, duration, target) {
  const bins = 1600, rate = 8000, span = Math.max(1, Math.ceil(duration * rate / bins));
  const peaks = new Array(bins).fill(0);
  await new Promise((resolve, reject) => {
    const child = spawn(tool('ffmpeg'), ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    let index = 0, tail = Buffer.alloc(0), stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('파형 분석 시간이 초과되었습니다.')); }, 120000);
    child.stdout.on('data', data => {
      const bytes = Buffer.concat([tail, data]); const length = bytes.length - bytes.length % 4;
      for (let at = 0; at < length; at += 4) { const value = Math.abs(bytes.readFloatLE(at)); const bucket = Math.min(bins - 1, Math.floor(index++ / span)); if (Number.isFinite(value)) peaks[bucket] = Math.max(peaks[bucket], value); }
      tail = bytes.subarray(length);
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(stderr || '파형 분석 실패')); });
  });
  const result = { duration, peaks, sampleRate: rate, algorithm: 'absolute peak per time bucket' };
  await fsp.writeFile(target, JSON.stringify(result)); return result;
}
class MediaLibrary {
  constructor(cacheDir) { this.cacheDir = cacheDir; this.assets = new Map(); }
  async prepare(media) {
    const info = await probe(media.path);
    if (info.type !== media.type) throw Error('프로젝트 미디어 형식이 파일과 다릅니다.');
    await fsp.mkdir(this.cacheDir, { recursive: true });
    const detail = { ...info, id: media.id, waveform: null, thumbnail: null };
    if (info.hasAudio) {
      const file = path.join(this.cacheDir, `${info.key}.wave.json`);
      try { detail.waveform = JSON.parse(await fsp.readFile(file, 'utf8')); }
      catch { detail.waveform = await waveform(info.path, info.duration, file); }
    }
    if (info.type !== 'audio') {
      const file = path.join(this.cacheDir, `${info.key}.png`);
      if (!fs.existsSync(file)) await run(tool('ffmpeg'), ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', info.path, '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2', '-y', file]);
      detail.thumbnail = file;
    }
    this.assets.set(media.id, detail); return detail;
  }
  async import(file) {
    const info = await probe(file);
    const media = { id: randomUUID(), type: info.type, path: info.path, name: path.basename(info.path), duration: info.duration, fingerprint: null };
    await this.prepare(media); return media;
  }
  async ensureVisual(id) {
    const asset=this.assets.get(id);if(!asset)throw Error('시각화할 미디어를 먼저 연결해 주세요.');
    if(!asset.spectrum)asset.spectrum=await require('./visualizer.cjs').analyzeVisual(asset,this.cacheDir);
    return asset.spectrum;
  }
  view() {
    return Object.fromEntries([...this.assets].map(([id, item]) => [id, { width: item.width, height: item.height, hasAudio: item.hasAudio, waveform: item.waveform,
      spectrum: item.spectrum || null, url: `ocut-media://asset/${id}`, thumbnail: item.thumbnail ? `ocut-media://thumb/${id}` : null }]));
  }
}
module.exports = { MediaLibrary, probe, tool, run, waveform, mediaKey };
