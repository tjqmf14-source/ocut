'use strict'
// ── video studio (right column) ──────────────────────────────────────────────
// Turns finished songs into a playlist video. The preview and the render draw with
// the same function (spectrum-renderer.js) from the same per-frame cache (built in
// the main process), so what is seen here is what the MP4 contains.
//
// Time in the preview comes from a master clock, not from the audio element: the
// frame shown is frameAt(clock). The audio is started alongside and nudged back if
// it drifts. The render uses no clock at all — it walks frame 0, 1, 2, …

const VIDEO_DEFAULTS = Object.freeze({
  source: 'selected',
  background: { kind: 'none', path: null, url: null, name: '' },
  length: { mode: 'once', count: 10, minutes: 60 },
  resolution: '1080p',
  fps: 30,
  renderer: 'gpu',
  spectrum: { ...SPECTRUM_DEFAULTS }
})

const studio = {
  video: JSON.parse(JSON.stringify(VIDEO_DEFAULTS)),
  cycle: null, // the prepared continuous track
  frames: null, // Float32Array, frameCount × barCount
  barCount: 0,
  preparedKey: '',
  clock: { playing: false, anchorPerf: 0, anchorTime: 0 },
  shown: -1, // frame currently on the preview canvas
  frame: null, // the render in progress
  loop: 0
}

const studioEl = (id) => document.getElementById(id)

// Output sizes, as in electron/video.js RESOLUTIONS.
const RESOLUTION_SIZES = {
  '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160]
}

// ── settings ──
function spectrumStyle () {
  return { ...SPECTRUM_DEFAULTS, ...studio.video.spectrum }
}

let saveTimer = 0
function saveVideo () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => window.yue.saveVideoSettings(studio.video), 400)
}

function writeControls () {
  const v = studio.video
  const s = spectrumStyle()
  studioEl('vSource').value = v.source
  studioEl('vLength').value = ['once', 'repeat', 'minutes'].includes(v.length.mode) ? v.length.mode : 'once'
  studioEl('vRepeat').value = v.length.count || 10
  studioEl('vHours').value = Math.floor((v.length.minutes || 60) / 60)
  studioEl('vMins').value = (v.length.minutes || 60) % 60
  showLengthInputs()
  studioEl('vResolution').value = v.resolution
  studioEl('vFps').value = String(v.fps)
  for (const radio of document.querySelectorAll('input[name="vRenderer"]')) radio.checked = radio.value === v.renderer
  studioEl('sVisible').checked = s.visible
  studioEl('sKind').value = s.kind
  studioEl('sSymmetric').checked = s.symmetric
  studioEl('sBars').value = String(s.barCount)
  studioEl('sPosition').value = s.position
  studioEl('sSize').value = s.size
  studioEl('sWidth').value = s.width
  studioEl('sColor1').value = s.color1
  studioEl('sColor2').value = s.color2
  studioEl('sGlow').value = s.glow
  studioEl('sDim').value = s.dim
  showBackground()
}

function showLengthInputs () {
  const mode = studioEl('vLength').value
  studioEl('vRepeatRow').classList.toggle('hidden', mode !== 'repeat')
  studioEl('vTimeRow').classList.toggle('hidden', mode !== 'minutes')
}

// Reads the length controls into the settings: a repeat count, or hours and minutes.
function readLength () {
  const mode = studioEl('vLength').value
  const count = Math.max(1, Math.min(1000, Math.round(Number(studioEl('vRepeat').value) || 1)))
  const minutes = Math.max(1, Math.min(600,
    (Math.round(Number(studioEl('vHours').value) || 0) * 60) + Math.round(Number(studioEl('vMins').value) || 0)))
  studio.video.length = { mode, count, minutes }
}

// ── preview drawing ──
function previewSize () {
  const canvas = studioEl('vCanvas')
  const box = studioEl('vStage').getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  // A proxy resolution for the preview; the drawing is resolution-independent.
  const width = Math.max(2, Math.round(box.width * ratio))
  const height = Math.round((width * 9) / 16)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return { width, height }
}

function rowAt (frame) {
  if (!studio.frames || !studio.barCount) return null
  const last = studio.frames.length / studio.barCount - 1
  const index = Math.min(Math.max(0, frame), last)
  return studio.frames.subarray(index * studio.barCount, (index + 1) * studio.barCount)
}

function drawPreview (frame, force = false) {
  if (!force && frame === studio.shown) return
  studio.shown = frame
  const canvas = studioEl('vCanvas')
  const size = previewSize()
  const ctx = canvas.getContext('2d')
  const fps = studio.cycle ? studio.cycle.fps : studio.video.fps
  renderFrame(ctx, rowAt(frame), spectrumStyle(), studio.video.background,
    { width: size.width, height: size.height, fps, frameIndex: frame, pixelRatio: window.devicePixelRatio || 1 })
}

const redraw = () => drawPreview(studio.shown < 0 ? 0 : studio.shown, true)

// ── master clock ──
function clockTime () {
  const c = studio.clock
  return c.playing ? c.anchorTime + (performance.now() - c.anchorPerf) / 1000 : c.anchorTime
}

function duration () {
  return studio.cycle ? studio.cycle.frameCount / studio.cycle.fps : 0
}

function showTime (time) {
  const total = duration()
  studioEl('vTime').textContent = `${clock(time)} / ${clock(total)}`
  if (!studio.seeking) studioEl('vSeek').value = String(frameAt(time, studio.cycle ? studio.cycle.fps : 30))
}

function tick () {
  if (!studio.clock.playing) return
  let time = clockTime()
  if (time >= duration()) {
    pausePreview()
    seekPreview(duration() - 1 / studio.cycle.fps)
    return
  }
  const audio = studioEl('vAudio')
  // The clock leads; the audio is pulled back into line if it wanders.
  if (!audio.paused && Math.abs(audio.currentTime - time) > 0.08) audio.currentTime = time
  if (audio.paused && audio.readyState >= 2) audio.play().catch(() => {})
  drawPreview(frameAt(time, studio.cycle.fps))
  showTime(time)
  studio.loop = requestAnimationFrame(tick)
}

function playPreview () {
  if (!studio.cycle) return
  if (clockTime() >= duration() - 0.05) studio.clock.anchorTime = 0
  studio.clock.anchorPerf = performance.now()
  studio.clock.playing = true
  const audio = studioEl('vAudio')
  audio.currentTime = studio.clock.anchorTime
  audio.play().catch(() => {})
  const video = studioEl('vBgVideo')
  if (studio.video.background.kind === 'video' && video.duration) {
    video.currentTime = studio.clock.anchorTime % video.duration
    video.play().catch(() => {})
  }
  studioEl('vPlay').textContent = '❚❚'
  cancelAnimationFrame(studio.loop)
  studio.loop = requestAnimationFrame(tick)
}

function pausePreview () {
  studio.clock.anchorTime = clockTime()
  studio.clock.playing = false
  cancelAnimationFrame(studio.loop)
  studioEl('vAudio').pause()
  studioEl('vBgVideo').pause()
  studioEl('vPlay').textContent = '▶'
}

function seekPreview (time) {
  const t = Math.max(0, Math.min(duration(), time))
  studio.clock.anchorTime = t
  studio.clock.anchorPerf = performance.now()
  const audio = studioEl('vAudio')
  if (audio.src) audio.currentTime = t
  const video = studioEl('vBgVideo')
  if (studio.video.background.kind === 'video' && video.duration) video.currentTime = t % video.duration
  drawPreview(frameAt(t, studio.cycle ? studio.cycle.fps : 30), true)
  showTime(t)
}

// ── background ──
function showBackground () {
  const bg = studio.video.background
  const image = studioEl('vBgImage')
  const video = studioEl('vBgVideo')
  image.classList.toggle('hidden', bg.kind !== 'image')
  video.classList.toggle('hidden', bg.kind !== 'video')
  if (bg.kind === 'image' && image.getAttribute('src') !== bg.url) image.src = bg.url
  if (bg.kind === 'video' && video.getAttribute('src') !== bg.url) video.src = bg.url
  if (bg.kind !== 'video') { video.pause(); video.removeAttribute('src'); video.load() }
  if (bg.kind !== 'image') image.removeAttribute('src')
  studioEl('vBgName').textContent = bg.kind === 'none' ? '없음 (기본 그라데이션)' : bg.name || bg.path
  studioEl('vBgName').title = bg.path || ''
  studioEl('sDim').disabled = bg.kind === 'none'
}

async function pickBackground (kind) {
  const result = await window.yue.videoBackground(kind)
  if (!result.ok) return
  studio.video.background = { kind: result.kind, path: result.path, url: result.url,
    name: result.path.split(/[\\/]/).pop() }
  showBackground()
  redraw()
  saveVideo()
}

// ── preparing the audio and the spectrum cache ──
// ── picking songs for the video ──
// "체크한 곡": the songs ticked in the list, in list order (drag to reorder). The
// ticks are kept per project, in this browser's storage.
const pickKey = () => `videoPicks:${currentProject || ''}`
function picks () {
  if (!studio.picks || studio.picksFor !== pickKey()) {
    let saved = []
    try { saved = JSON.parse(localStorage.getItem(pickKey()) || '[]') } catch {}
    studio.picks = new Set(Array.isArray(saved) ? saved : [])
    studio.picksFor = pickKey()
  }
  return studio.picks
}

function savePicks () {
  try { localStorage.setItem(pickKey(), JSON.stringify([...picks()])) } catch {}
}

// While the studio is open every finished song has a tick box; ticking one switches
// the video to "체크한 곡".
function studioCheckbox (song) {
  if (studioEl('studio').classList.contains('hidden')) return null
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'v-pick'
  box.title = '영상에 넣기'
  box.checked = picks().has(song.folder)
  box.onclick = (event) => event.stopPropagation()
  box.onchange = () => {
    if (box.checked) picks().add(song.folder)
    else picks().delete(song.folder)
    savePicks()
    useChecked()
    showPickCount()
    showStudioInfo()
  }
  return box
}

function useChecked () {
  if (studio.video.source === 'checked') return
  studio.video.source = 'checked'
  studioEl('vSource').value = 'checked'
  saveVideo()
}

function showPickCount () {
  const count = songs.filter((song) => song.audio && !song.unfinished && picks().has(song.folder)).length
  studioEl('vPickCount').textContent = studio.video.source === 'checked'
    ? `체크한 곡 ${count}곡`
    : `곡 앞 체크박스로 영상에 넣을 곡을 고르세요 (체크 ${count}곡)`
}

function studioTracks () {
  const finished = (song) => song && song.audio && !song.unfinished
  if (studio.video.source === 'project') return songs.filter(finished)
  if (studio.video.source === 'checked') return songs.filter((song) => finished(song) && picks().has(song.folder))
  return finished(selected) ? [selected] : []
}

function tracksKey (tracks) {
  return JSON.stringify([tracks.map((t) => t.audio), studio.video.fps, spectrumStyle().barCount])
}

function busy (text, fraction) {
  studioEl('vBusy').classList.toggle('hidden', text === null)
  if (text === null) return
  studioEl('vBusyText').textContent = text
  studioEl('vBusyBar').style.width = `${Math.round((fraction || 0) * 100)}%`
}

async function prepareStudio ({ quiet = false } = {}) {
  const tracks = studioTracks()
  if (!tracks.length) {
    if (!quiet) toast(studio.video.source === 'project'
      ? '이 프로젝트에는 완성곡이 없습니다.'
      : studio.video.source === 'checked'
        ? '영상에 넣을 곡을 목록에서 체크해주세요.'
        : '영상으로 만들 완성곡을 목록에서 먼저 선택해주세요.', 6000)
    return false
  }
  const key = tracksKey(tracks)
  const keepTime = studio.cycle ? clockTime() : 0
  pausePreview()
  studioEl('vPrepare').disabled = true
  busy('음원을 합치는 중…', 0)
  const result = await window.yue.videoPrepare({
    tracks: tracks.map((song) => ({ path: song.audio, title: song.title || '무제' })),
    fps: studio.video.fps,
    analysis: { barCount: spectrumStyle().barCount }
  })
  busy(null)
  studioEl('vPrepare').disabled = false
  if (!result.ok) {
    showProblem(result.message, null, '영상 미리보기를 준비하지 못했습니다')
    return false
  }
  studio.cycle = result.cycle
  studio.barCount = result.header.barCount
  // A copy, so the Float32 view starts on an aligned offset.
  studio.frames = new Float32Array(result.frames.slice().buffer)
  studio.preparedKey = key
  studio.titles = tracks.map((song) => song.title || '무제')
  const audio = studioEl('vAudio')
  audio.src = result.cycle.audioUrl
  studioEl('vEmpty').classList.add('hidden')
  studioEl('vSeek').max = String(result.cycle.frameCount - 1)
  for (const id of ['vPlay', 'vSeek', 'vRender']) studioEl(id).disabled = false
  showStudioInfo()
  seekPreview(Math.min(keepTime, duration()))
  return true
}

// The same rule as electron/video.js targetSeconds.
function targetSeconds () {
  const length = studio.video.length
  if (length.mode === 'repeat') return duration() * Math.max(1, Math.round(Number(length.count) || 1))
  if (length.mode === 'minutes') return Math.max(1, Number(length.minutes) || 1) * 60
  return duration()
}

const longClock = (seconds) => seconds >= 3600
  ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  : clock(seconds)

function showStudioInfo () {
  showPickCount()
  if (!studio.cycle) return
  const target = targetSeconds()
  const lines = [
    `${studio.titles.length}곡 · ${clock(duration())} · ${studio.cycle.fps}fps · ${studio.cycle.frameCount.toLocaleString()}프레임 · 막대 ${studio.barCount}개`
  ]
  if (studio.video.length.mode === 'repeat') {
    lines.push(`영상 길이 ${longClock(target)} — 재생목록을 ${Math.round(target / duration())}번 반복합니다`)
  } else if (studio.video.length.mode === 'minutes') {
    lines.push(target > duration()
      ? `영상 길이 ${longClock(target)} — 재생목록을 약 ${(target / duration()).toFixed(1)}번 반복합니다 (마지막 곡은 시간에 맞춰 끊김)`
      : `영상 길이 ${longClock(target)} — 재생목록 앞부분만 씁니다`)
  }
  const stale = studio.preparedKey && studio.preparedKey !== tracksKey(studioTracks())
  if (stale) lines.push('⚠ 곡 선택이나 설정이 바뀌었습니다. "미리보기 준비"를 다시 누르세요.')
  studioEl('vInfo').textContent = lines.join('\n')
}

// Bar count and fps are analysis settings: the cache is rebuilt, a moment after the
// last change (§11).
let reanalyseTimer = 0
function reanalyseSoon () {
  clearTimeout(reanalyseTimer)
  if (!studio.cycle) return showStudioInfo()
  reanalyseTimer = setTimeout(() => prepareStudio({ quiet: true }), 400)
}

// ── rendering ──
async function renderVideo () {
  if (!studio.cycle) return
  if (studio.preparedKey !== tracksKey(studioTracks()) && !confirm(
    '곡 선택이나 설정이 미리보기와 다릅니다. 지금 미리보기에 준비된 곡으로 영상을 만들까요?')) return
  pausePreview()
  // The look is fixed at the start, so adjusting the panel meanwhile cannot change
  // the video halfway through.
  const style = JSON.parse(JSON.stringify(spectrumStyle()))
  const background = { ...studio.video.background }
  const [outWidth, outHeight] = RESOLUTION_SIZES[studio.video.resolution] || RESOLUTION_SIZES['1080p']
  const video = {
    background: { kind: background.kind, path: background.path },
    spectrum: { visible: style.visible },
    band: spectrumBand(style, { width: outWidth, height: outHeight }),
    length: { ...studio.video.length },
    resolution: studio.video.resolution,
    renderer: studio.video.renderer
  }
  const name = studio.video.source === 'project'
    ? `${currentProject || '플레이리스트'} 플레이리스트`
    : (studio.titles[0] || '영상')
  const start = await window.yue.videoStart({ cycleId: studio.cycle.id, video, name })
  if (!start.ok) {
    if (start.blocked) showProblem(start.message, null, '저장할 수 없는 폴더')
    else if (!start.canceled) showProblem(start.message, null, '영상을 만들지 못했습니다')
    return
  }
  const { jobId, plan } = start
  const job = { jobId, cancelled: false }
  studio.frame = job
  setRendering(true)
  const began = performance.now()
  try {
    // CPU mode keeps the canvases in main memory (software raster); GPU mode lets
    // Chromium draw on the graphics card and reads each frame back.
    const options = { alpha: true, willReadFrequently: video.renderer === 'cpu' }
    const rc = (frameIndex) => ({ width: plan.width, height: plan.height, fps: plan.fps, frameIndex, pixelRatio: 1 })
    // The unchanging layer, once.
    const full = new OffscreenCanvas(plan.width, plan.height)
    const fullCtx = full.getContext('2d', options)
    drawLayer(fullCtx, style, background, rc(0))
    await window.yue.videoLayer(jobId, fullCtx.getImageData(0, 0, plan.width, plan.height).data)
    if (plan.still) {
      progress(0, 1, began, '정지 화면 영상 만드는 중…')
    } else {
      // Then only the spectrum's strip, frame by frame, at the height ffmpeg puts it back.
      const band = new OffscreenCanvas(plan.width, plan.bandHeight)
      const ctx = band.getContext('2d', options)
      // Frames go to the loopback server when there is one (see main.js), else by IPC.
      // Several are in flight at once; the main process writes them in order.
      let viaHttp = Boolean(start.port)
      const send = (frame, pixels) => viaHttp
        ? fetch(`http://127.0.0.1:${start.port}/frame/${jobId}/${start.token}/${frame}`,
          { method: 'POST', body: pixels, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } })
          .catch(() => {
            viaHttp = false
            return window.yue.videoFrame(jobId, frame, pixels)
          })
        : window.yue.videoFrame(jobId, frame, pixels)
      const pending = []
      const spent = { draw: 0, read: 0, wait: 0 } // where the time goes, for the log
      for (let frame = 0; frame < plan.renderFrames; frame++) {
        if (job.cancelled || job.failed) break
        const t0 = performance.now()
        drawBand(ctx, rowAt(frame), style, rc(frame), plan.bandY)
        const t1 = performance.now()
        const pixels = ctx.getImageData(0, 0, plan.width, plan.bandHeight).data
        const t2 = performance.now()
        pending.push(send(frame, pixels))
        // A few frames in flight keep drawing and encoding busy at the same time.
        if (pending.length >= 4) await pending.shift()
        const t3 = performance.now()
        spent.draw += t1 - t0
        spent.read += t2 - t1
        spent.wait += t3 - t2
        if (frame % 15 === 0) progress(frame, plan.renderFrames, began)
      }
      await Promise.all(pending)
      const per = (ms) => (ms / Math.max(1, plan.renderFrames)).toFixed(1)
      window.yue.log(`video timing per frame (${viaHttp ? 'http' : 'ipc'}): draw ${per(spent.draw)}ms, readback ${per(spent.read)}ms, send ${per(spent.wait)}ms`)
    }
    if (job.cancelled && !job.failed) {
      await window.yue.videoCancel(jobId)
      toast('영상 만들기를 취소했습니다.')
      return
    }
    progress(plan.renderFrames, plan.renderFrames, began,
      plan.loop ? '반복 구간을 이어 붙이는 중…' : '마무리하는 중…')
    const result = await window.yue.videoFinish(jobId)
    if (!result.ok) {
      showProblem(result.message, null, '영상을 만들지 못했습니다')
      if (result.gpuFailed) {
        studio.video.renderer = 'cpu'
        writeControls()
        saveVideo()
      }
      return
    }
    showResult(result, start.chapters, performance.now() - began)
    if (!plan.still) verifyRender({ result, plan, style, background })
  } catch (error) {
    await window.yue.videoCancel(jobId).catch(() => {})
    showProblem(`영상을 만들다 멈췄습니다: ${error.message}`, null, '영상을 만들지 못했습니다')
  } finally {
    studio.frame = null
    setRendering(false)
  }
}

// After a render: the preview's way of drawing (one canvas, everything at once)
// against the finished MP4, at the frames the 지시서 names — first, 1 s, 10 s,
// middle, 1 s before the end. The score shows in the result panel and the log.
async function verifyRender ({ result, plan, style, background }) {
  if (background.kind === 'video') {
    studioEl('vResultCheck').textContent = '미리보기 일치 검사: 영상 배경은 프레임마다 달라 건너뜁니다'
    return
  }
  const last = plan.renderFrames - 1
  const picks = [...new Set([0, plan.fps, plan.fps * 10, Math.floor(last / 2), last - plan.fps]
    .filter((frame) => frame >= 0 && frame <= last))]
  const canvas = new OffscreenCanvas(plan.width, plan.height)
  const ctx = canvas.getContext('2d', { alpha: true })
  const scores = []
  studioEl('vResultCheck').textContent = '미리보기와 최종 영상 비교 중…'
  for (const frame of picks) {
    renderFrame(ctx, rowAt(frame), style, background,
      { width: plan.width, height: plan.height, fps: plan.fps, frameIndex: frame, pixelRatio: 1 })
    const check = await window.yue.videoCompare({
      output: result.path, frame, fps: plan.fps, width: plan.width, height: plan.height,
      rgba: ctx.getImageData(0, 0, plan.width, plan.height).data,
      background: { kind: background.kind, path: background.path }
    })
    if (check.ok) scores.push({ frame, ssim: check.ssim })
  }
  if (!scores.length) {
    studioEl('vResultCheck').textContent = '미리보기 일치 검사를 하지 못했습니다'
    return
  }
  // Neighbouring frames look alike, so a high score alone cannot rule out an
  // off-by-one; the preview frame must match its own MP4 frame best (§14.3: 0 frames).
  // The probe is the frame whose bars differ most from both neighbours: during a held
  // note two adjacent frames can be indistinguishable, and the test would prove nothing.
  let offset = null
  let probe = null
  let motion = 0
  const step = Math.max(1, Math.floor(last / 3000))
  const diff = (a, b) => {
    const ra = rowAt(a)
    const rb = rowAt(b)
    let sum = 0
    for (let i = 0; i < ra.length; i++) sum += Math.abs(ra[i] - rb[i])
    return sum
  }
  for (let frame = 1; frame < last; frame += step) {
    const change = Math.min(diff(frame, frame - 1), diff(frame, frame + 1))
    if (change > motion) {
      motion = change
      probe = frame
    }
  }
  if (probe !== null) {
    renderFrame(ctx, rowAt(probe), style, background,
      { width: plan.width, height: plan.height, fps: plan.fps, frameIndex: probe, pixelRatio: 1 })
    const rgba = ctx.getImageData(0, 0, plan.width, plan.height).data
    const around = []
    for (const shift of [-1, 0, 1]) {
      const check = await window.yue.videoCompare({
        output: result.path, frame: probe, against: probe + shift, fps: plan.fps,
        width: plan.width, height: plan.height, rgba, background: { kind: background.kind, path: background.path }
      })
      if (check.ok) around.push({ shift, ssim: check.ssim })
    }
    if (around.length === 3) offset = around.reduce((best, x) => x.ssim > best.ssim ? x : best).shift
  }
  const worst = Math.min(...scores.map((s) => s.ssim))
  const label = (frame) => frame === 0 ? '첫 프레임' : `${clock(frame / plan.fps)}`
  studioEl('vResultCheck').textContent =
    `미리보기 일치도 (SSIM, 1이 완전 일치): ${scores.map((s) => `${label(s.frame)} ${s.ssim.toFixed(4)}`).join(' · ')}` +
    (worst >= 0.99 ? ' ✓' : ' — 기준(0.99)보다 낮습니다') +
    (offset === null ? '' : offset === 0 ? ' · 프레임 위치 오차 0 ✓' : ` · 프레임이 ${offset}칸 어긋났습니다`)
  window.yue.log(`video preview/render SSIM ${scores.map((s) => `#${s.frame}=${s.ssim.toFixed(5)}`).join(' ')} frame offset ${offset}`)
}

function setRendering (on) {
  studioEl('vRender').disabled = on
  studioEl('vPrepare').disabled = on
  studioEl('vCancel').classList.toggle('hidden', !on)
  studioEl('vProgress').classList.toggle('hidden', !on)
  if (on) studioEl('vResult').classList.add('hidden')
}

function progress (done, total, began, note) {
  const elapsed = (performance.now() - began) / 1000
  const rate = done > 0 ? done / elapsed : 0
  const left = rate > 0 ? (total - done) / rate : 0
  studioEl('vProgressBar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`
  studioEl('vProgressText').textContent = note ||
    `${done.toLocaleString()} / ${total.toLocaleString()} 프레임 · ${rate.toFixed(0)}fps · ` +
    `지난 시간 ${clock(elapsed)} · 남은 시간 약 ${clock(left)}`
}

function showResult (result, chapters, ms) {
  const box = studioEl('vResult')
  box.classList.remove('hidden')
  studioEl('vResultText').textContent =
    `✓ 영상을 만들었습니다 · 길이 ${clock(result.seconds || result.expectedSeconds)} · 걸린 시간 ${clock(ms / 1000)}\n${result.path}`
  studioEl('vResultText').style.whiteSpace = 'pre-line'
  studioEl('vChapters').textContent = chapters.join('\n')
  studioEl('vOpen').onclick = () => window.yue.reveal(result.path.replace(/[\\/][^\\/]+$/, ''))
  studioEl('vCopyChapters').onclick = async () => {
    await navigator.clipboard.writeText(chapters.join('\n'))
    toast('유튜브 설명란에 붙여 넣을 타임스탬프를 복사했습니다.')
  }
}

// ── wiring ──
async function initStudio () {
  const saved = await window.yue.videoSettings()
  if (saved) {
    studio.video = { ...studio.video, ...saved,
      background: { ...VIDEO_DEFAULTS.background, ...(saved.background || {}) },
      length: { ...VIDEO_DEFAULTS.length, ...(saved.length || {}) },
      spectrum: { ...SPECTRUM_DEFAULTS, ...(saved.spectrum || {}) } }
  }
  writeControls()
  showPickCount()
  renderSongs() // the list may have been drawn before these settings arrived

  // The studio column can be put away when only making songs.
  const panel = studioEl('studio')
  try { if (localStorage.getItem('studioOpen') === '0') panel.classList.add('hidden') } catch {}
  studioEl('studioToggle').onclick = () => {
    panel.classList.toggle('hidden')
    try { localStorage.setItem('studioOpen', panel.classList.contains('hidden') ? '0' : '1') } catch {}
    if (!panel.classList.contains('hidden')) redraw()
    renderSongs() // tick boxes only while the studio is open
  }

  // ffmpeg stopped mid-render: stop drawing; videoFinish then reports why.
  window.yue.onVideoFailed(({ jobId, message }) => {
    if (studio.frame && studio.frame.jobId === jobId) studio.frame.failed = message
  })

  window.yue.onVideoProgress(({ stage, fraction }) => {
    busy(stage === 'audio' ? '음원을 합치는 중…' : '스펙트럼 분석 중…', fraction)
  })

  studioEl('vPrepare').onclick = () => prepareStudio()
  studioEl('vPlay').onclick = () => studio.clock.playing ? pausePreview() : playPreview()
  const seek = studioEl('vSeek')
  seek.addEventListener('input', () => {
    studio.seeking = true
    const fps = studio.cycle ? studio.cycle.fps : 30
    const wasPlaying = studio.clock.playing
    if (wasPlaying) pausePreview()
    seekPreview(Number(seek.value) / fps)
    studio.resumeAfterSeek = studio.resumeAfterSeek || wasPlaying
  })
  seek.addEventListener('change', () => {
    studio.seeking = false
    if (studio.resumeAfterSeek) playPreview()
    studio.resumeAfterSeek = false
  })

  studioEl('vSource').onchange = (event) => {
    studio.video.source = event.target.value
    saveVideo()
    showPickCount()
    showStudioInfo()
  }
  studioEl('vPickAll').onclick = () => {
    for (const song of songs) if (song.audio && !song.unfinished) picks().add(song.folder)
    savePicks()
    useChecked()
    renderSongs()
    showPickCount()
    showStudioInfo()
  }
  studioEl('vPickNone').onclick = () => {
    picks().clear()
    savePicks()
    renderSongs()
    showPickCount()
    showStudioInfo()
  }
  studioEl('vBgPickImage').onclick = () => pickBackground('image')
  studioEl('vBgPickVideo').onclick = () => pickBackground('video')
  studioEl('vBgClear').onclick = () => {
    studio.video.background = { ...VIDEO_DEFAULTS.background }
    showBackground()
    redraw()
    saveVideo()
  }
  for (const id of ['vLength', 'vRepeat', 'vHours', 'vMins']) {
    studioEl(id).addEventListener(id === 'vLength' ? 'change' : 'input', () => {
      readLength()
      showLengthInputs()
      showStudioInfo()
      saveVideo()
    })
  }
  studioEl('vResolution').onchange = (event) => { studio.video.resolution = event.target.value; saveVideo() }
  studioEl('vFps').onchange = (event) => {
    studio.video.fps = Number(event.target.value)
    saveVideo()
    reanalyseSoon()
  }
  for (const radio of document.querySelectorAll('input[name="vRenderer"]')) {
    radio.onchange = () => { studio.video.renderer = radio.value; saveVideo() }
  }

  // Visual settings redraw at once; the cache stays as it is (§6).
  const visual = {
    sVisible: (el) => ({ visible: el.checked }),
    sKind: (el) => ({ kind: el.value }),
    sSymmetric: (el) => ({ symmetric: el.checked }),
    sPosition: (el) => ({ position: el.value }),
    sSize: (el) => ({ size: Number(el.value) }),
    sWidth: (el) => ({ width: Number(el.value) }),
    sColor1: (el) => ({ color1: el.value }),
    sColor2: (el) => ({ color2: el.value }),
    sGlow: (el) => ({ glow: Number(el.value) }),
    sDim: (el) => ({ dim: Number(el.value) })
  }
  for (const [id, read] of Object.entries(visual)) {
    const el = studioEl(id)
    el.addEventListener('input', () => {
      studio.video.spectrum = { ...studio.video.spectrum, ...read(el) }
      redraw()
      saveVideo()
    })
  }
  studioEl('sBars').onchange = (event) => {
    studio.video.spectrum = { ...studio.video.spectrum, barCount: Number(event.target.value) }
    saveVideo()
    reanalyseSoon()
  }

  studioEl('vRender').onclick = renderVideo
  studioEl('vCancel').onclick = () => {
    if (studio.frame) studio.frame.cancelled = true
  }

  new ResizeObserver(() => redraw()).observe(studioEl('vStage'))
  redraw()
}

initStudio()
