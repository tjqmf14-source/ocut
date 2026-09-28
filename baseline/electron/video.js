'use strict'
// ── playlist video ───────────────────────────────────────────────────────────
// Turns finished songs into a video: background, spectrum, audio. The pipeline
// follows the SSOK 스펙트럼 WYSIWYG 지시서:
//
//   songs ─ffmpeg→ one continuous track (a "cycle"), padded to a whole number of
//                   video frames
//         ─ffmpeg→ mono float32 samples ─worker→ per-frame spectrum cache (on disk)
//   cache ─renderer (the same drawing code as the preview)→ RGBA frames
//         ─pipe→ ffmpeg: background under the frames, audio beside them, encode
//
// ffmpeg never draws the spectrum itself; it only composites, encodes and muxes.
// A video longer than the playlist renders the playlist once and repeats that file,
// which is why the cycle must end exactly on a frame boundary: otherwise the audio
// and the picture would drift a fraction of a frame further apart on every repeat.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const { Worker } = require('worker_threads')
const analysis = require('./spectrum-analysis')

const SAMPLE_RATE = 48000
const RESOLUTIONS = {
  '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160]
}
const FPS_CHOICES = [30, 60]

const sha1 = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 20)

function run (ffmpeg, args, { onStderr, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    let tail = ''
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      tail = (tail + text).slice(-4000)
      if (onStderr) onStderr(text)
    })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(tail) : reject(new Error(lastLine(tail) || `ffmpeg 종료 코드 ${code}`)))
  })
}

// ffmpeg's reason for stopping: the last line that reads like an error. Its progress
// lines ("frame= … speed=…", ended by \r) say nothing about why, so they never count.
const lastLine = (text) => String(text).split(/[\r\n]+/).map((line) => line.trim())
  .filter((line) => line && !/^(frame|size)=/.test(line))
  .filter((line) => /error|fail|invalid|cannot|could not|unable|no space|denied|not found/i.test(line))
  .pop() || ''

// "Duration: 00:03:45.12" from ffmpeg's banner — no ffprobe ships with the runtime.
async function probeSeconds (ffmpeg, file) {
  const text = await new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true })
    let out = ''
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('close', () => resolve(out))
    child.on('error', () => resolve(''))
  })
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

async function fileKey (file) {
  const stat = await fsp.stat(file)
  return { file: path.resolve(file), size: stat.size, mtime: Math.round(stat.mtimeMs) }
}

// Keeps the cache folder to the most recent few playlists.
async function pruneCache (dir, keep = 12) {
  try {
    const entries = await Promise.all((await fsp.readdir(dir)).map(async (name) => {
      const full = path.join(dir, name)
      return { full, time: (await fsp.stat(full)).mtimeMs }
    }))
    const groups = new Map()
    for (const entry of entries) {
      const key = path.basename(entry.full).split(/[._]/)[0]
      groups.set(key, Math.max(groups.get(key) || 0, entry.time))
    }
    const stale = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(keep).map(([key]) => key)
    for (const entry of entries) {
      if (stale.includes(path.basename(entry.full).split(/[._]/)[0])) await fsp.rm(entry.full, { force: true })
    }
  } catch { /* the cache is disposable */ }
}

// ── 1. the continuous track ──
// Every song is resampled to 48 kHz stereo and joined; the result is padded with
// silence to a whole number of frames. The mono float32 copy feeds the analysis.
async function prepareCycle ({ ffmpeg, cacheDir, tracks, fps, onProgress = () => {} }) {
  await fsp.mkdir(cacheDir, { recursive: true })
  const keys = await Promise.all(tracks.map((track) => fileKey(track.path)))
  const id = sha1({ v: 1, keys, fps, rate: SAMPLE_RATE })
  const wav = path.join(cacheDir, `${id}.wav`)
  const f32 = path.join(cacheDir, `${id}.f32`)
  const info = path.join(cacheDir, `${id}.json`)
  try {
    const cached = JSON.parse(await fsp.readFile(info, 'utf8'))
    if (fs.existsSync(wav) && fs.existsSync(f32)) return { id, wav, f32, ...cached, reused: true }
  } catch {}

  // Where each song starts, for the chapter list under the video.
  const seconds = []
  for (const track of tracks) seconds.push(await probeSeconds(ffmpeg, track.path) || 0)
  const total = seconds.reduce((sum, s) => sum + s, 0)

  const raw = path.join(cacheDir, `${id}.raw.wav`)
  const inputs = tracks.flatMap((track) => ['-i', track.path])
  const chains = tracks.map((_, i) =>
    `[${i}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
  const graph = `${chains.join(';')};${tracks.map((_, i) => `[a${i}]`).join('')}concat=n=${tracks.length}:v=0:a=1[all];` +
    '[all]asplit=2[st][mo];[mo]pan=mono|c0=0.5*c0+0.5*c1[mono]'
  await run(ffmpeg, ['-hide_banner', '-y', ...inputs, '-filter_complex', graph,
    '-map', '[st]', '-c:a', 'pcm_s16le', raw,
    '-map', '[mono]', '-f', 'f32le', '-c:a', 'pcm_f32le', f32], {
    onStderr: (text) => {
      const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (match && total) onProgress(Math.min(0.99, (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) / total))
    }
  })

  // Pad both copies to exactly frameCount frames of audio.
  const samples = Math.floor((await fsp.stat(f32)).size / 4)
  const frameCount = analysis.frameTotal(samples / SAMPLE_RATE, fps)
  const padded = Math.round((frameCount / fps) * SAMPLE_RATE)
  await run(ffmpeg, ['-hide_banner', '-y', '-i', raw, '-af', `apad=whole_len=${padded}`,
    '-t', String(padded / SAMPLE_RATE), '-c:a', 'pcm_s16le', wav])
  await fsp.rm(raw, { force: true })
  if (padded > samples) await fsp.appendFile(f32, Buffer.alloc((padded - samples) * 4))

  let start = 0
  const chapters = tracks.map((track, i) => {
    const chapter = { title: track.title, start, seconds: seconds[i] }
    start += seconds[i]
    return chapter
  })
  const meta = { seconds: frameCount / fps, frameCount, fps, sampleRate: SAMPLE_RATE, chapters, sourceHash: id }
  await fsp.writeFile(info, JSON.stringify(meta), 'utf8')
  pruneCache(cacheDir)
  return { id, wav, f32, ...meta, reused: false }
}

// ── 2. the spectrum cache ──
// Keyed by the audio and every analysis setting (§6): changing a colour never
// recomputes it, changing the bar count or the fps does.
async function spectrumCache ({ cacheDir, cycle, settings, onProgress = () => {} }) {
  const normalized = analysis.normalizeSettings(settings)
  const settingsHash = sha1(normalized)
  const bin = path.join(cacheDir, `${cycle.id}_${settingsHash}.bin`)
  const header = {
    version: analysis.CACHE_VERSION,
    sourceHash: cycle.sourceHash,
    durationSeconds: cycle.seconds,
    sampleRate: SAMPLE_RATE,
    fps: cycle.fps,
    frameCount: cycle.frameCount,
    barCount: normalized.barCount,
    analysisSettingsHash: settingsHash
  }
  try {
    const data = await fsp.readFile(bin)
    const stored = JSON.parse(data.subarray(0, data.indexOf(10)).toString('utf8'))
    const body = data.subarray(data.indexOf(10) + 1)
    if (JSON.stringify(stored) === JSON.stringify(header) &&
        body.length === header.frameCount * header.barCount * 4) {
      return { header, frames: body, key: path.basename(bin), reused: true }
    }
  } catch {}
  const result = await new Promise((resolve, reject) => {
    // Packaged, the worker must load from app.asar.unpacked: a worker thread cannot read
    // its script out of the asar archive.
    const script = path.join(__dirname, 'spectrum-worker.js')
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    const worker = new Worker(script, {
      workerData: { samplesPath: cycle.f32, sampleRate: SAMPLE_RATE, fps: cycle.fps, settings: normalized }
    })
    worker.on('message', (message) => {
      if (message.type === 'progress') onProgress(message.fraction)
      else if (message.type === 'done') resolve(message)
    })
    worker.on('error', reject)
    worker.on('exit', (code) => { if (code !== 0) reject(new Error(`분석 작업이 멈췄습니다 (${code})`)) })
  })
  if (result.frameCount !== header.frameCount) {
    throw new Error(`분석 프레임 수가 맞지 않습니다 (${result.frameCount} ≠ ${header.frameCount})`)
  }
  const frames = Buffer.from(result.frames)
  await fsp.writeFile(bin, Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), frames]))
  return { header, frames, key: path.basename(bin), reused: false }
}

// ── 3. rendering ──
function encoderArgs (renderer) {
  return renderer === 'cpu'
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']
    : ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0']
}

// Background: cover the frame, centred — the same fit the preview gets from CSS
// object-fit: cover, so both crop identically.
function backgroundInput (background, fps, width, height) {
  if (!background || background.kind === 'none' || !background.path) return null
  const video = background.kind === 'video'
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
  return {
    moving: video,
    // A picture is read once; a video loops for as long as the render runs.
    input: video ? ['-stream_loop', '-1', '-i', background.path] : ['-i', background.path],
    filter: video ? `fps=${fps},${cover},${TO_YUV},format=yuv420p` : `${cover},format=rgba`
  }
}

// Repeats a single frame from memory for ever, with proper timestamps — so a picture
// that never changes is decoded, scaled and converted once instead of every frame.
// The time base is set to exactly one frame first: a JPEG arrives with ffmpeg's 1/25 s
// default, and N/(30·TB) rounded in it gave two frames the same timestamp, which put
// every spectrum frame one frame late behind a picture background.
const holdFrame = (fps) => `loop=loop=-1:size=1:start=0,settb=1/${fps},setpts=N`

// Canvas pixels are sRGB; HD video is BT.709 in TV range, and that is what players
// (YouTube included) assume. Every conversion to YUV says so explicitly — ffmpeg's
// default is the SD matrix, and a JPEG background would otherwise pass its full-range
// flag on to the whole video.
const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv'
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

// How long the video runs:
//   once   — the playlist, one time
//   repeat — the playlist `count` times over, so it ends exactly on a song's end
//   minutes — a set length (hours and minutes); the last pass is cut where it falls
function targetSeconds (length, cycleSeconds) {
  if (!length || length.mode === 'once') return cycleSeconds
  if (length.mode === 'repeat') {
    return cycleSeconds * Math.max(1, Math.min(1000, Math.round(Number(length.count) || 1)))
  }
  return Math.max(1, Number(length.minutes) || 1) * 60
}

// Plans a render. A frame is two layers, drawn by the renderer with the same code as
// the preview:
//   layer — everything that never changes (the backdrop, or the darkening over a
//           picture), drawn once and repeated by ffmpeg
//   band  — the strip the spectrum moves in, drawn and piped every frame
// Sending only the band keeps each frame a fraction of a full picture, which is
// what limits render speed. `still` means nothing moves (spectrum hidden): the
// layer alone is the video.
function planRender ({ cycle, video }) {
  const [width, height] = RESOLUTIONS[video.resolution] || RESOLUTIONS['1080p']
  const fps = cycle.fps
  const cycleSeconds = cycle.frameCount / fps
  const target = targetSeconds(video.length, cycleSeconds)
  const still = !video.spectrum || !video.spectrum.visible
  const loop = !still && target > cycleSeconds + 1e-6
  const renderFrames = still ? 0 : loop ? cycle.frameCount : analysis.frameTotal(target, fps)
  // The band arrives from the renderer, which knows the spectrum's shape; it is
  // clamped here, and kept to even numbers for the encoder.
  const even = (n) => Math.max(0, Math.round(n / 2) * 2)
  const band = video.band || { y: 0, height }
  const bandY = Math.min(height - 2, even(Number(band.y) || 0))
  const bandHeight = Math.max(2, Math.min(height - bandY, even(Number(band.height) || height)))
  return { width, height, fps, target, cycleSeconds, still, loop, renderFrames,
    bandY, bandHeight, expectedFrames: analysis.frameTotal(target, fps) }
}

class RenderJob {
  constructor ({ ffmpeg, cycle, video, output, log }) {
    this.ffmpeg = ffmpeg
    this.cycle = cycle
    this.video = video
    this.output = output
    this.log = log
    this.plan = planRender({ cycle, video })
    this.work = path.join(os.tmpdir(), `ssokmusic-render-${Date.now()}`)
    this.layerFile = path.join(this.work, 'layer.rgba')
    // ffmpeg writes beside the target under a working name and the file takes its
    // real name only once it is complete, so a render that stops halfway never
    // leaves an unplayable video under the name the user chose.
    this.partial = output.replace(/(\.mp4)?$/i, '.rendering.mp4')
    this.cancelled = false
    this.failure = null // ffmpeg's last words, if it stopped by itself
    this.onFail = null
    this.child = null
    this.done = null
  }

  async start () {
    await fsp.mkdir(this.work, { recursive: true })
    const { width, height, fps, still, loop, bandY, bandHeight } = this.plan
    this.firstPass = loop ? path.join(this.work, 'cycle.mp4') : this.partial
    const bg = backgroundInput(this.video.background, fps, width, height)
    const args = ['-hide_banner', '-y']
    let index = 0
    let bgIndex = null
    if (bg) {
      args.push(...bg.input)
      bgIndex = index++
    }
    // The unchanging layer: one stored frame, held in memory by the graph below.
    args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
      '-r', String(fps), '-i', this.layerFile)
    const layerIndex = index++
    let bandIndex = null
    if (!still) {
      args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${bandHeight}`, '-r', String(fps), '-i', 'pipe:0')
      bandIndex = index++
    }
    let audioIndex = null
    if (!loop) {
      if (still) args.push('-stream_loop', '-1')
      args.push('-i', this.cycle.wav)
      audioIndex = index++
    }
    // Stacked in the order the preview paints: picture, layer, spectrum. Whatever
    // does not move is composed once and held; per frame only the spectrum's strip
    // is blended in, straight into the encoder's own pixel format.
    const chain = []
    const hold = holdFrame(fps)
    if (!bg) {
      chain.push(`[${layerIndex}:v]${TO_YUV},format=yuv420p,${hold}[base]`)
    } else if (!bg.moving) {
      chain.push(`[${bgIndex}:v]${bg.filter}[bg]`,
        `[bg][${layerIndex}:v]overlay=0:0:format=auto,${TO_YUV},format=yuv420p,${hold}[base]`)
    } else {
      chain.push(`[${bgIndex}:v]${bg.filter}[bg]`, `[${layerIndex}:v]${TO_YUV},format=yuva420p,${hold}[layer]`,
        '[bg][layer]overlay=0:0:format=yuv420[base]')
    }
    if (still) chain.push('[base]format=yuv420p[v]')
    else chain.push(`[${bandIndex}:v]${TO_YUV},format=yuva420p[band]`, `[base][band]overlay=0:${bandY}:format=yuv420,format=yuv420p[v]`)
    args.push('-filter_complex', chain.join(';'), '-map', '[v]')
    if (audioIndex !== null) args.push('-map', `${audioIndex}:a`, '-c:a', 'aac', '-b:a', '320k')
    args.push(...encoderArgs(this.video.renderer), '-pix_fmt', 'yuv420p', ...TAGS, '-r', String(fps), '-fps_mode', 'cfr')
    args.push('-t', String(loop ? this.plan.cycleSeconds : this.plan.target))
    args.push('-movflags', '+faststart', this.firstPass)
    this.args = args
    this.log('render plan', { ...this.plan, output: this.output, renderer: this.video.renderer,
      background: this.video.background && this.video.background.kind })
    return this.plan
  }

  // The unchanging layer; it must be on disk before ffmpeg starts.
  async layer (rgba) {
    await fsp.writeFile(this.layerFile, rgba)
  }

  launch () {
    this.stderr = ''
    this.child = spawn(this.ffmpeg, this.args, { windowsHide: true, stdio: [this.plan.still ? 'ignore' : 'pipe', 'ignore', 'pipe'] })
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-6000) })
    // Writing to an ffmpeg that has gone would otherwise throw in the main process.
    if (this.child.stdin) this.child.stdin.on('error', () => {})
    this.done = new Promise((resolve, reject) => {
      this.child.on('error', reject)
      this.child.on('close', (code) => {
        if (code === 0 && !this.cancelled) return resolve()
        if (!this.cancelled && !this.finishing) this.fail(lastLine(this.stderr) || `ffmpeg 종료 코드 ${code}`, code)
        reject(new Error(this.cancelled ? '취소했습니다' : lastLine(this.stderr) || `ffmpeg 종료 코드 ${code}`))
      })
    })
    this.done.catch(() => {}) // observed in finish()
  }

  // ffmpeg stopped while frames were still coming: say so at once, so the renderer
  // stops drawing instead of waiting on a pipe nobody reads.
  fail (message, code) {
    if (this.failure) return
    this.failure = message
    this.log('render stopped by ffmpeg', { code, frame: this.nextFrame, output: this.output,
      stderr: (this.stderr || '').slice(-1500) })
    if (this.onFail) this.onFail(message)
  }

  // One band from the renderer. Resolves when ffmpeg has taken it, so a slow encoder
  // slows the renderer instead of filling memory.
  frame (rgba) {
    if (!this.child) this.launch()
    if (this.cancelled || this.failure) return Promise.resolve(false)
    const { child } = this
    return new Promise((resolve) => {
      if (!child.stdin.writable) return resolve(false)
      if (child.stdin.write(rgba)) return resolve(true)
      // Either ffmpeg takes more, or it has stopped and never will.
      const settle = (ok) => {
        child.stdin.off('drain', drained)
        child.off('close', closed)
        resolve(ok)
      }
      const drained = () => settle(true)
      const closed = () => settle(false)
      child.stdin.once('drain', drained)
      child.once('close', closed)
    })
  }

  // A frame that may arrive ahead of its turn (several are sent at once); it is held
  // until every earlier frame has been written. Resolves once it is in the pipe.
  frameAt (index, rgba) {
    if (!this.waiting) {
      this.waiting = new Map()
      this.nextFrame = 0
    }
    return new Promise((resolve) => {
      this.waiting.set(index, { rgba, resolve })
      this.flush()
    })
  }

  async flush () {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.waiting.has(this.nextFrame)) {
        const { rgba, resolve } = this.waiting.get(this.nextFrame)
        this.waiting.delete(this.nextFrame)
        this.nextFrame += 1
        resolve(await this.frame(rgba))
        // A trace of long renders, for when one goes wrong on someone's machine.
        if (this.nextFrame % 9000 === 0) {
          this.log('render progress', { frame: this.nextFrame, of: this.plan.renderFrames,
            rssMb: Math.round(process.memoryUsage().rss / 1048576) })
        }
      }
    } finally {
      this.flushing = false
    }
  }

  async finish () {
    if (!this.child) this.launch() // a still video has no frames to start it
    if (this.failure) throw new Error(this.failure)
    this.finishing = true
    if (this.child.stdin) this.child.stdin.end()
    await this.done
    if (this.plan.loop) {
      // The rendered cycle, repeated to length; the audio is repeated beside it and
      // encoded once, so the joins stay seamless.
      await run(this.ffmpeg, ['-hide_banner', '-y',
        '-stream_loop', '-1', '-i', this.firstPass,
        '-stream_loop', '-1', '-i', this.cycle.wav,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
        '-t', String(this.plan.target), '-movflags', '+faststart', this.partial])
    }
    const seconds = await probeSeconds(this.ffmpeg, this.partial)
    if (!seconds) throw new Error('완성된 영상을 읽지 못했습니다')
    await fsp.rm(this.output, { force: true })
    await fsp.rename(this.partial, this.output)
    await fsp.rm(this.work, { recursive: true, force: true })
    this.log('render finished', { output: this.output, expectedSeconds: this.plan.target, actualSeconds: seconds,
      expectedFrames: this.plan.expectedFrames })
    return { path: this.output, seconds, expectedSeconds: this.plan.target }
  }

  // Also used after a failure. Only the working files go; a video already at the
  // chosen name (an earlier render) is left alone.
  async cancel () {
    this.cancelled = true
    if (this.child) {
      try { this.child.stdin && this.child.stdin.destroy() } catch {}
      this.child.kill()
    }
    try { await this.done } catch {}
    await fsp.rm(this.work, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(this.partial, { force: true }).catch(() => {})
    this.log(this.failure ? 'render cleaned up' : 'render cancelled', this.output)
  }
}

// Chapter lines for the video description: "00:00 제목". Repeats are listed too.
function chapters (cycle, targetSeconds) {
  const clock = (s) => {
    const whole = Math.floor(s)
    const h = Math.floor(whole / 3600)
    const m = Math.floor((whole % 3600) / 60)
    const sec = whole % 60
    const pad = (n) => String(n).padStart(2, '0')
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
  }
  const lines = []
  for (let offset = 0; offset < targetSeconds - 0.5; offset += cycle.seconds) {
    for (const chapter of cycle.chapters) {
      const at = offset + chapter.start
      if (at >= targetSeconds - 0.5) break
      lines.push(`${clock(at)} ${chapter.title}`)
    }
  }
  return lines
}

module.exports = { prepareCycle, spectrumCache, planRender, targetSeconds, RenderJob, chapters, probeSeconds, RESOLUTIONS, FPS_CHOICES, SAMPLE_RATE }
