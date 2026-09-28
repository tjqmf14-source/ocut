'use strict'

const $ = (id) => document.getElementById(id)
const PRESETS = [
  { name: '시티팝', style: 'Korean, 1980s city pop, groovy funk bass, Rhodes electric piano, bright brass stabs, clean funky guitar cutting, analog synth pads, tight disco drums, sweet airy Korean female vocal, nostalgic night drive mood, 112 BPM' },
  { name: '트로트', style: 'Korean trot, ppongjjak, upbeat cheerful festival mood, electric organ, bright saxophone fills, brass section, synth strings, shuffle drums with strong backbeat, walking electric bass, warm mature Korean female trot vocal with kkeokgi bending and wide vibrato, 128 BPM' },
  { name: '발라드', style: 'Korean ballad, emotional piano, lush string section, soft electric guitar solo, slow build to a big chorus, tender Korean female vocal with airy head voice, sorrowful and warm, 68 BPM' },
  { name: 'K-pop 댄스', style: 'K-pop dance pop, punchy synth bass, bright plucks, trap-influenced hi-hats, big layered chorus with group vocals, confident young Korean female vocal, glossy modern production, 124 BPM' },
  { name: 'R&B', style: 'Korean R&B, smooth Rhodes chords, mellow bass groove, laid-back drums, subtle vinyl texture, breathy soulful Korean female vocal with rich harmonies, late night mood, 86 BPM' },
  { name: '어쿠스틱 포크', style: 'Korean acoustic folk, fingerpicked steel string guitar, soft cajon, warm upright bass, gentle strings, intimate Korean female vocal, sunny afternoon mood, 96 BPM' },
  { name: '신스웨이브', style: 'synthwave retro pop, analog synth arpeggio, gated reverb drums, fat bass synth, neon 1980s atmosphere, dreamy Korean female vocal with reverb, 108 BPM' },
  { name: '록 밴드', style: 'Korean modern rock band, distorted electric guitars, driving bass, energetic live drums, anthemic chorus, powerful Korean female rock vocal, 142 BPM' },
  { name: '재즈 보사노바', style: 'bossa nova jazz, nylon string guitar, brushed drums, upright bass, soft flugelhorn, relaxed swing feel, smooth Korean female jazz vocal, cafe mood, 92 BPM' },
  { name: '동요', style: 'Korean childrens song, bright xylophone, playful piano, light percussion, simple cheerful melody, clear friendly Korean female vocal, happy and innocent mood, 116 BPM' },
  { name: '크리스마스 캐롤', style: 'Korean, christmas carol, festive holiday pop, sleigh bells, glockenspiel, warm piano, pizzicato and lush strings, soft brushed drums, cozy snowy winter night, bright warm Korean female vocal with gentle backing harmonies, 104 BPM' }
]

// Instrumental work has its own vocabulary; these replace the vocal presets while
// 연주곡 is on. None of them mention a voice.
const INSTRUMENTAL_PRESETS = [
  { name: '피아노 솔로', style: 'solo piano, intimate close-miked grand piano, gentle pedal, expressive rubato, warm and reflective, 72 BPM' },
  { name: '클래식 기타 듀오', style: 'classical guitar duo, two nylon string guitars, interlocking arpeggios and melody, intimate recital recording, 88 BPM' },
  { name: '피아노 트리오', style: 'classical piano trio, piano violin and cello, chamber music, balanced acoustic blend, flowing dialogue between the three, 92 BPM' },
  { name: '현악 4중주', style: 'string quartet, two violins viola and cello, classical chamber music, clean acoustic recording in a small hall, elegant counterpoint, 96 BPM' },
  { name: '피아노 + 첼로', style: 'cello and piano duo, singing cello melody over warm piano accompaniment, romantic chamber music, close intimate recording, 68 BPM' },
  { name: '플루트 + 기타', style: 'flute and classical guitar duo, airy flute melody over nylon string guitar, pastoral chamber music, light and clear, 100 BPM' },
  { name: '피아노 2대', style: 'two pianos, interlocking parts between both instruments, bright concert hall, rhythmic and virtuosic, 112 BPM' },
  { name: '실내 관현악', style: 'chamber orchestra, small string section with woodwinds and light brass, classical concert hall, refined dynamics, 100 BPM' },
  { name: '오케스트라', style: 'cinematic orchestra, sweeping strings, warm brass, timpani, woodwind counter-melody, film score, wide dynamic range, 88 BPM' },
  { name: '로파이 BGM', style: 'lo-fi hip hop beat, dusty Rhodes piano, soft vinyl crackle, muted bass, laid-back drums, study background music, 78 BPM' },
  { name: '재즈 트리오', style: 'jazz piano trio, upright bass walking lines, brushed drums, swinging feel, late night club, 118 BPM' },
  { name: '앰비언트', style: 'ambient soundscape, slow evolving synth pads, soft granular texture, deep reverb, calm and spacious, very slow, 60 BPM' },
  { name: '기타 연주', style: 'fingerstyle acoustic guitar, steel string, warm room recording, gentle percussive taps, folk instrumental, 92 BPM' },
  { name: '신스웨이브', style: 'synthwave instrumental, analog arpeggios, gated reverb drums, fat bass synth, neon night drive, 110 BPM' },
  { name: '게임 BGM', style: 'game background music, bright chiptune-inspired synths, driving rhythm, loopable adventure theme, 132 BPM' },
  { name: '캐롤 연주', style: 'christmas carol instrumental, sleigh bells, celesta and glockenspiel melody, warm piano, pizzicato strings, music box sparkle, cozy festive winter mood, 100 BPM' },
  {
    name: '국악 느낌',
    style: 'Korean historical drama soundtrack, east asian traditional flavour, ' +
      'plucked zither and bamboo flute timbres, hand drum, pentatonic melody, ' +
      'meditative and spacious, 76 BPM',
    note: '실제 국악기 연주가 아니라 국악 분위기를 흉내 낸 소리입니다. ' +
      '가야금 농현, 대금 청울림, 자진모리 같은 장단은 재현되지 않습니다.'
  }
]

const STAGES = {
  plan: { label: '작곡 (악보 만드는 중)' },
  semantic: { label: '노래 생성 중' },
  synth: { label: '소리로 바꾸는 중' },
  decode: { label: '파일로 저장 중' }
}
const ORDER = ['plan', 'semantic', 'synth', 'decode']

// Measured on an RTX 3050 in fast mode (CUDA graphs). Token counts come from four
// finished songs: 55/408/475/898 lyric characters produced 1526/4395/5147/6456
// song tokens, so length drives the estimate and the bar no longer stalls at 50%.
const SPEED = { plan: 14, semantic: 30, synthPerToken: 0.034, decode: 8, load: 55 }
const MAX_SONG_TOKENS = 9000 // generation cap in the model's sampling config (~6 min)
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

function estimate (lyrics, { firstRun = true } = {}) {
  const chars = (lyrics || '').replace(/^\s*\[.*\]\s*$/gm, '').replace(/\s/g, '').length
  const tokens = {
    plan: clamp(Math.round(500 + 3 * chars), 700, 4096),
    semantic: clamp(Math.round(1200 + 7 * chars), 1500, 9000)
  }
  const seconds = {
    plan: tokens.plan / SPEED.plan,
    semantic: tokens.semantic / SPEED.semantic,
    synth: tokens.semantic * SPEED.synthPerToken,
    decode: SPEED.decode
  }
  const total = ORDER.reduce((sum, key) => sum + seconds[key], 0) + (firstRun ? SPEED.load : 0)
  const weights = {}
  for (const key of ORDER) weights[key] = seconds[key] / total
  return { tokens, seconds, weights, total }
}

let plan = estimate('')

// Prompt helpers (style tags, structure, lyric cleanup, score analysis) live in prompt.js.

let songs = []
let selected = null
let running = false
let jobStart = 0
let warmed = false // the model only pays its ~1 minute load cost on the first song
let currentProject = null
let runningJob = null // {jobId, title} of the song being made, shown atop the library
let queueState = { current: null, waiting: [] }
const plans = new Map() // jobId → time estimate, so a queued song keeps its own

// ── setup ────────────────────────────────────────────────────────────────────
function setStep (step, status, detail) {
  const li = document.querySelector(`.steps li[data-step="${step}"]`)
  if (!li) return
  li.classList.remove('run', 'done')
  if (status) li.classList.add(status)
  if (detail) li.querySelector('.detail').textContent = detail
}

const fmtGb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)}GB`

function wireSetup () {
  window.yue.onSetupStep(({ step, status, detail }) => {
    setStep(step, status === 'run' ? 'run' : 'done', detail)
    const order = ['gpu', 'uv', 'venv', 'torch', 'yue', 'models', 'verify']
    const index = order.indexOf(step)
    if (index >= 0 && status === 'done') $('setupBar').style.width = `${((index + 1) / order.length) * 100}%`
  })
  window.yue.onSetupProgress(({ step, got, total }) => {
    const li = document.querySelector(`.steps li[data-step="${step}"] .detail`)
    if (li && total) li.textContent = `${fmtGb(got)} / ${fmtGb(total)}`
  })
  window.yue.onSetupLog((line) => {
    const log = $('setupLog')
    log.textContent = (log.textContent + '\n' + line).split('\n').slice(-400).join('\n')
    log.scrollTop = log.scrollHeight
  })
  $('setupLogToggle').onclick = () => $('setupLog').classList.toggle('hidden')
  $('setupStart').disabled = true
  $('pickLocation').onclick = async () => {
    const result = await window.yue.pickLocation()
    if (!result.ok) return result.canceled ? null : toast(result.message, 6000)
    await showPreflight() // 새 드라이브의 여유 공간으로 다시 점검한다
  }
  $('setupStart').onclick = async () => {
    $('setupStart').disabled = true
    $('setupError').classList.add('hidden')
    const result = await window.yue.runSetup()
    if (result.ok) {
      $('setup').classList.add('hidden')
      await boot()
    } else {
      $('setupStart').disabled = false
      $('setupStart').textContent = '다시 시도'
      $('setupError').textContent = result.message
      $('setupError').classList.remove('hidden')
      $('setupLog').classList.remove('hidden')
    }
  }
}

// ── library ──────────────────────────────────────────────────────────────────
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>'
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>'

// Which song the shared <audio> element currently holds, and whether it is running.
let playingDir = null

function playButton (song) {
  const button = document.createElement('button')
  const active = playingDir === song.dir && !$('audio').paused
  button.className = 'play' + (active ? ' playing' : '')
  button.title = active ? '멈춤' : '미리듣기'
  button.innerHTML = active ? PAUSE_ICON : PLAY_ICON
  button.onclick = (event) => {
    event.stopPropagation() // 카드 선택과 겹치지 않게
    toggle(song)
  }
  return button
}

function toggle (song) {
  const audio = $('audio')
  if (playingDir === song.dir && !audio.paused) {
    audio.pause()
    return
  }
  select(song) // 아래 재생기도 같은 곡으로 맞춘다
  playingDir = song.dir
  audio.play().catch((error) => toast(`재생하지 못했습니다: ${error.message}`, 6000))
}

// The song being made and the ones waiting sit at the top of the library, so the
// whole pipeline is visible in one column.
function runningCard () {
  const card = document.createElement('div')
  card.className = 'song making'
  card.innerHTML = `
    <div class="song-info">
      <div class="name" id="runTitle"></div>
      <div class="sub"><span id="runStage">준비 중</span> <span class="muted" id="runMeta"></span></div>
      <div class="bar"><div id="runBar"></div></div>
    </div>
    <button class="drop" id="runCancel" title="취소">✕</button>`
  card.querySelector('#runTitle').textContent = runningJob.title || '무제'
  if (runningJob.cancelling) markCancelling(card)
  card.querySelector('#runCancel').onclick = async (event) => {
    event.stopPropagation()
    if (!confirm('지금 만들고 있는 곡을 취소할까요?')) return
    runningJob.cancelling = true
    markCancelling(card)
    await window.yue.cancel()
  }
  return card
}

// The handle marks a card as draggable; the whole card can be dragged, though.
const GRIP = '<span class="grip" aria-hidden="true" title="끌어서 순서 바꾸기"></span>'

function sortable (card, group, id, count) {
  if (count < 2) return
  card.dataset.sortGroup = group
  card.dataset.sortId = id
  card.insertAdjacentHTML('afterbegin', GRIP)
  card.classList.add('sortable')
}

function waitingCard (item, index, total) {
  const card = document.createElement('div')
  card.className = 'song waiting'
  card.innerHTML = '<div class="song-info"><div class="name"></div><div class="sub"></div></div>' +
    '<button class="drop" title="대기 취소">✕</button>'
  card.querySelector('.name').textContent = item.title
  card.querySelector('.sub').textContent = queueState.paused
    ? `일시정지됨 · ${index + 1}번째`
    : `대기 중 · ${index + 1}번째`
  sortable(card, 'queue', item.jobId, total)
  card.querySelector('.drop').onclick = async (event) => {
    event.stopPropagation()
    const result = await window.yue.queueRemove(item.jobId)
    if (!result.ok) toast(result.message)
  }
  return card
}

function failedCard (item) {
  const card = document.createElement('div')
  card.className = 'song failed'
  card.innerHTML = '<div class="song-info"><div class="name"></div><div class="sub"></div></div>' +
    '<button class="retry" title="다시 시도">↻</button><button class="drop" title="목록에서 지우기">✕</button>'
  card.querySelector('.name').textContent = item.title
  card.querySelector('.sub').textContent = `실패 · ${item.message || '알 수 없는 오류'}`
  card.querySelector('.retry').onclick = async (event) => {
    event.stopPropagation()
    const result = await window.yue.queueRetry(item.jobId)
    if (!result.ok) toast(result.message)
  }
  card.querySelector('.drop').onclick = async (event) => {
    event.stopPropagation()
    await window.yue.queueDismiss(item.jobId)
  }
  return card
}

function renderSongs () {
  // Redrawing mid-drag would pull the card from under the pointer; the drag shows
  // whatever changed once it ends.
  if (Sortable.active) {
    Sortable.pending = true
    return
  }
  const list = $('songs')
  const waiting = queueState.waiting || []
  const broken = queueState.failed || []
  $('queueClear').classList.toggle('hidden', waiting.length === 0)
  $('queuePause').classList.toggle('hidden', waiting.length === 0 && !queueState.paused)
  $('queuePause').textContent = queueState.paused ? '재개' : '일시정지'
  if (!songs.length && !runningJob && !waiting.length && !broken.length) {
    list.innerHTML = '<div class="empty">아직 만든 곡이 없습니다.<br>가사와 스타일을 적고<br>곡 만들기를 눌러보세요.</div>'
    return
  }
  list.innerHTML = ''
  if (runningJob) list.appendChild(runningCard())
  waiting.forEach((item, index) => list.appendChild(waitingCard(item, index, waiting.length)))
  broken.forEach((item) => list.appendChild(failedCard(item)))
  for (const song of songs) {
    const card = document.createElement('div')
    card.className = 'song' + (selected && selected.dir === song.dir ? ' active' : '')
    const length = song.seconds ? `${Math.floor(song.seconds / 60)}:${String(Math.round(song.seconds % 60)).padStart(2, '0')}` : ''
    card.innerHTML = '<div class="song-info"><div class="name"></div><div class="sub"></div></div>'
    card.querySelector('.name').textContent = song.title || song.id || '무제'
    // An unfinished song says how far it got, so resuming feels like continuing.
    const STAGE_NAMES = { plan: '악보', semantic: '노래', synth: '합성', decode: '저장' }
    const done = (song.stages || []).map((stage) => STAGE_NAMES[stage]).filter(Boolean)
    card.querySelector('.sub').textContent = song.scoreOnly
      ? '악보만 · 눌러서 악보 보기'
      : song.unfinished
        ? `미완성 · ${done.length ? `${done.join('·')} 완료 · ` : ''}눌러서 이어 만들기`
        : [song.imported ? '불러온 곡' : '', length, (song.createdAt || '').replace('T', ' ').slice(0, 16)].filter(Boolean).join(' · ')
    if (song.unfinished) {
      card.classList.add('unfinished')
      // A cancelled or failed song stays so it can be finished later — or thrown away.
      const drop = document.createElement('button')
      drop.className = 'drop'
      drop.title = '이 미완성 곡 삭제'
      drop.textContent = '✕'
      drop.onclick = async (event) => {
        event.stopPropagation()
        if (!confirm(`미완성 곡 "${song.title || '무제'}"을(를) 삭제할까요?\n(휴지통으로 이동)`)) return
        const result = await window.yue.remove(song.dir)
        if (!result.ok) return toast(result.message || '삭제하지 못했습니다.', 6000)
        await refresh()
        toast('미완성 곡을 삭제했습니다.')
      }
      card.appendChild(drop)
    } else {
      card.appendChild(playButton(song)) // 목록에서 바로 들어볼 수 있게
    }
    // With "체크한 곡" chosen in the video studio, finished songs get a tick box.
    if (!song.unfinished && typeof studioCheckbox === 'function') {
      const box = studioCheckbox(song)
      if (box) card.prepend(box)
    }
    sortable(card, 'songs', song.folder, songs.length)
    card.onclick = () => song.scoreOnly
      ? openScore(song)
      : song.unfinished ? resume(song) : select(song)
    list.appendChild(card)
  }
}

function select (song) {
  selected = song
  $('player').classList.remove('hidden')
  $('nowTitle').textContent = song.title || song.id
  $('audio').src = song.audioUrl || `file:///${encodeURI(song.audio.replace(/\\/g, '/'))}`
  // A file brought in from elsewhere has no lyrics or style to copy.
  $('reuseSong').disabled = Boolean(song.imported)
  $('reuseSong').title = song.imported ? '불러온 곡에는 복제할 가사·스타일이 없습니다' : ''
  // Only a song that kept its score can be covered: the score is the tune.
  $('coverSong').disabled = !song.score
  $('coverSong').title = song.score
    ? '원곡의 멜로디로 스타일만 바꿔 다시 만들기'
    : '이 곡에는 악보가 없어 커버할 수 없습니다'
  renderSongMeta(song)
  renderSongs()
  if (typeof showStudioInfo === 'function') showStudioInfo() // the video studio notes a changed selection
}

async function resume (song) {
  const names = { plan: '악보', semantic: '노래 생성', synth: '음향 합성' }
  const done = (song.stages || []).map((stage) => names[stage]).filter(Boolean)
  const detail = done.length
    ? `${done.join(', ')}까지 끝나 있어 그다음부터 이어집니다.`
    : '처음부터 만듭니다.'
  const question = running
    ? `"${song.title || '무제'}"를 대기열에 넣어 이어서 완성할까요?\n${detail}`
    : `"${song.title || '무제'}"를 이어서 완성할까요?\n${detail}`
  if (!confirm(question)) return
  const estimated = estimate(song.lyrics || '', { firstRun: !warmed })
  const result = await window.yue.resume(song.dir)
  if (!result.ok) return toast(result.message)
  plans.set(result.jobId, estimated)
  toast(result.position > 0
    ? `대기열 ${result.position}번째로 넣었습니다`
    : '이어서 만드는 중입니다', 5000)
}

// Long paths are cut in the middle: the drive and the last folders are what tell two
// locations apart. The full path is in the tooltip.
function shortPath (full) {
  if (!full) return ''
  const parts = full.split(/[\\/]/).filter(Boolean)
  return parts.length <= 3 ? full : `${parts[0]}\\…\\${parts.slice(-2).join('\\')}`
}

async function showLocations () {
  const settings = await window.yue.getSettings()
  $('songsDirText').textContent = shortPath(settings.songsDir) || '—'
  $('songsDirText').title = settings.songsDir || ''
  $('exportDirText').textContent = settings.exportDir
    ? shortPath(settings.exportDir)
    : '음악 폴더 (마지막 위치 기억)'
  $('exportDirText').title = settings.exportDir || settings.musicDir || ''
}

// Everything needed to reproduce a take, kept together and readable.
function renderSongMeta (song) {
  const rows = [
    ['길이', song.seconds
      ? (song.targetSeconds ? `${clock(song.seconds)} (목표 ${clock(song.targetSeconds)})` : clock(song.seconds))
      : null],
    ['형식', song.format === 'mp3' ? 'MP3 320kbps' : song.format === 'wav' ? '무손실 WAV' : null],
    ['시드', song.seed],
    ['작곡 방식', { full: '전체 (코드 + 멜로디)', melody: '멜로디만', off: '악보 없이' }[song.cot]],
    ['연주곡', song.instrumental ? '예 (보컬 차단)' : null],
    ['고급 설정', song.advanced && Object.keys(song.advanced).length
      ? Object.entries(song.advanced).map(([key, value]) => `${key}=${value}`).join(', ')
      : '기본값'],
    ['스타일', song.style],
    ['가사', song.lyrics ? song.lyrics.replace(/\n+/g, ' / ').slice(0, 300) : null],
    ['악보', song.score ? '있음 ([악보 보기]에서 확인)' : null],
    ['만든 때', (song.createdAt || '').replace('T', ' ')],
    ['걸린 시간', song.wallSeconds ? `${Math.round(song.wallSeconds / 60)}분` : null],
    ['엔진', song.engine],
    ['프로그램', song.appVersion ? `ssokMusic ${song.appVersion}` : null],
    ['폴더', song.dir]
  ]
  $('songMeta').innerHTML = ''
  for (const [label, value] of rows) {
    if (value == null || value === '') continue
    const row = document.createElement('div')
    row.className = 'meta-row'
    row.innerHTML = '<span class="meta-key"></span><span class="meta-value"></span>'
    row.querySelector('.meta-key').textContent = label
    row.querySelector('.meta-value').textContent = String(value)
    $('songMeta').appendChild(row)
  }
}

async function renderProjects () {
  const state = await window.yue.projects()
  currentProject = state.current
  const select = $('project')
  select.innerHTML = ''
  for (const project of state.projects) {
    const option = document.createElement('option')
    option.value = project.name
    option.textContent = `${project.name} (${project.songs})`
    option.selected = project.name === state.current
    select.appendChild(option)
  }
}

async function refresh () {
  await renderProjects()
  songs = await window.yue.listSongs()
  if (selected) selected = songs.find((s) => s.dir === selected.dir) || null
  renderSongs()
  if (typeof showStudioInfo === 'function') showStudioInfo()
}

// ── generation ───────────────────────────────────────────────────────────────
function stageProgress (stage, fraction) {
  let base = 0
  for (const key of ORDER) {
    if (key === stage) break
    base += plan.weights[key]
  }
  return Math.min(0.995, base + plan.weights[stage] * clamp(fraction, 0, 1))
}

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

// A title made up from lyrics: at most `max` characters, cut at a space where one is
// near, so "창문을 열면 불빛이 흘러 한강 위로…" becomes "창문을 열면 불빛이 흘러".
function shortTitle (text, max = 20) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space >= max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.·…]+$/, '')
}

const minutes = (seconds) => seconds >= 3600
  ? `${Math.floor(seconds / 3600)}시간 ${Math.round((seconds % 3600) / 60)}분`
  : `${Math.max(1, Math.round(seconds / 60))}분`

// The engine checks for a cancel between steps; while it is still starting up, or
// preparing the first song on the graphics card, that can take a minute. The card
// says so, rather than looking as if the button did nothing.
function markCancelling (card) {
  card.querySelector('#runStage').textContent = '취소하는 중…'
  card.querySelector('#runMeta').textContent = '지금 단계가 끝나는 대로 멈춥니다'
  card.querySelector('#runCancel').disabled = true
}

function showProgress (stage, fraction, note) {
  // Writes into the card at the top of the library; nothing to do before it exists.
  const bar = $('runBar')
  if (!bar) return
  if (runningJob && runningJob.cancelling) return
  $('runStage').textContent = STAGES[stage] ? STAGES[stage].label : stage
  const done = stageProgress(stage, fraction)
  bar.style.width = `${(done * 100).toFixed(1)}%`
  const elapsed = (Date.now() - jobStart) / 1000
  // Blend the up-front estimate with the pace this run is actually keeping, so a
  // slower or faster machine converges instead of showing a fixed guess.
  const projected = done > 0.05 ? elapsed / done : plan.total
  const totalSeconds = done > 0.05 ? (projected + plan.total) / 2 : plan.total
  const eta = `약 ${minutes(Math.max(0, totalSeconds - elapsed))} 남음`
  $('runMeta').textContent = note ? `${note} · ${eta}` : eta
}

function setRunning (on) {
  running = on
  // The button stays available while a song is being made: pressing it adds the next
  // song to the queue instead of starting a second one.
  $('generate').textContent = on ? '대기열에 추가' : '곡 만들기'
  $('generateHint').textContent = on ? '오른쪽에서 진행 상황을 볼 수 있습니다' : ''
}

function wireJobs () {
  window.yue.onQueue((state) => {
    queueState = state
    renderSongs()
  })
  window.yue.onJobStarted(({ jobId, title }) => {
    runningJob = { jobId, title }
    plan = plans.get(jobId) || estimate('')
    warmed = true
    jobStart = Date.now()
    setRunning(true)
    renderSongs() // 카드를 먼저 만들고 그 안에 진행 상황을 쓴다
    showProgress('plan', 0)
  })
  window.yue.onJobEvent((event) => {
    if (event.type === 'stage' && event.stage === 'load') {
      showProgress('plan', 0, '모델 불러오는 중 (처음 한 번만 오래 걸립니다)')
    } else if (event.type === 'stage' && event.status === 'start') {
      showProgress(event.stage, 0)
    } else if (event.type === 'notice') {
      toast(event.message, 6000)
    } else if (event.type === 'progress') {
      if (event.stage === 'synth') showProgress('synth', event.step / event.steps)
      else showProgress(event.stage, event.tokens / plan.tokens[event.stage],
        `초당 ${event.rate}개`)
    }
  })
  window.yue.onJobDone(async (song) => {
    showProgress('decode', 1, '완성!')
    plans.delete(runningJob && runningJob.jobId)
    runningJob = null
    setRunning(false)
    await refresh()
    if (song && song.scoreOnly) {
      const draft = songs.find((item) => item.dir === song.dir)
      if (draft) openScore(draft) // 악보가 나오면 바로 열어 준다
      toast('악보가 나왔습니다. 고친 뒤 "이 악보로 곡 만들기"를 누르세요.', 8000)
      return
    }
    if (songs[0]) select(songs[0])
    const cut = song && song.truncated && song.truncated.semantic
    // With a target, the first thing anyone checks is how close it landed.
    const length = song && song.targetSeconds && song.seconds
      ? ` (목표 ${clock(song.targetSeconds)} · 실제 ${clock(song.seconds)})`
      : ''
    toast(cut
      ? `곡이 완성됐지만 가사가 길어 끝부분이 잘렸습니다${length}. 가사를 줄이면 끝까지 나옵니다.`
      : `곡이 완성되었습니다 🎵${length}`, cut || length ? 9000 : 3000)
  })
  window.yue.onJobError((event) => {
    plans.delete(runningJob && runningJob.jobId)
    runningJob = null
    setRunning(false)
    if (event.cancelled) toast('생성을 취소했습니다.')
    else showProblem(event.message, event.detail)
    refresh()
  })
}

// A crash message needs room and a copy button; a toast would cut it off.
function showProblem (message, detail, title = '곡을 만들지 못했습니다') {
  $('problemTitle').textContent = title
  $('problemText').textContent = message
  $('problemDetail').textContent = detail || ''
  $('problemDetail').classList.toggle('hidden', !detail)
  // Copy and log only make sense for an actual failure.
  const failure = title === '곡을 만들지 못했습니다'
  $('problemCopy').classList.toggle('hidden', !failure)
  $('problemLog').classList.toggle('hidden', !failure)
  $('problem').classList.remove('hidden')
  $('problemCopy').onclick = async () => {
    await navigator.clipboard.writeText([message, detail].filter(Boolean).join('\n\n'))
    toast('오류 내용을 복사했습니다.')
  }
  $('problemClose').onclick = () => $('problem').classList.add('hidden')
  $('problemLog').onclick = () => window.yue.openLog()
}

// Electron blocks window.prompt(), so text input gets its own small dialog.
function askText (title, value = '') {
  return new Promise((resolve) => {
    const input = $('askInput')
    $('askTitle').textContent = title
    input.value = value
    $('ask').classList.remove('hidden')
    input.focus()
    input.select()
    const close = (answer) => {
      $('ask').classList.add('hidden')
      input.onkeydown = null
      resolve(answer)
    }
    $('askOk').onclick = () => close(input.value.trim() || null)
    $('askCancel').onclick = () => close(null)
    input.onkeydown = (event) => {
      if (event.key === 'Enter') close(input.value.trim() || null)
      if (event.key === 'Escape') close(null)
    }
  })
}

function toast (message, ms = 3000) {
  const el = $('toast')
  el.textContent = message
  el.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.add('hidden'), ms)
}

// ── score (ABC) ──────────────────────────────────────────────────────────────
// Same rewrite rules the worker uses: chord symbols are protected, pitches become
// rests, and ties left hanging on a rest are dropped.
const CHORD = /"[^"]*"/g
const NOTE_GROUP = /\[(?:[_^=]*[A-Ga-g][,']*\d*\/?\d*)+\]/g
const NOTE = /[_^=]*[A-Ga-g][,']*/g

function restVoice (abc, voiceName) {
  let voice = null
  return abc.split('\n').map((line) => {
    const header = line.match(/^V:\s*(\w+)/)
    if (header) {
      voice = header[1]
      return line
    }
    if (voice !== voiceName || !line || /^[A-Za-z]:/.test(line) || line.startsWith('%')) return line
    const symbols = line.match(CHORD) || []
    let body = line.replace(CHORD, '\u0000').replace(NOTE_GROUP, 'z').replace(NOTE, 'z')
    body = body.replace(/(z[0-9/]*)-/g, '$1')
    for (const symbol of symbols) body = body.replace('\u0000', symbol)
    return body
  }).join('\n')
}

const dropChords = (abc) => abc.replace(CHORD, '')

let scoreSong = null
let scoreOriginal = ''
// 'song' edits the score of a finished song; 'import' takes one from outside.
let scoreMode = 'song'
let importName = ''
let lastCheck = { text: null, result: null }

// ── cover and imported scores ────────────────────────────────────────────────
// Both hand the model a finished score — melody, chords, bars — to sing under the
// current style and lyrics. A cover takes it from a finished song; an import from a
// MIDI or ABC file. Nothing of any old recording is reused.
let coverFrom = null

const hasChordSymbols = (abc) => /"[^"\n]+"/.test(String(abc || '').split('\n').filter((line) => !/^V:/.test(line)).join('\n'))

function showCover () {
  $('coverBar').classList.toggle('hidden', !coverFrom)
  if (!coverFrom) return
  const imported = coverFrom.source === 'import'
  $('coverBar').querySelector('b').textContent = imported ? '불러온 악보' : '커버'
  $('coverFrom').textContent = imported
    ? `"${coverFrom.title}"${coverFrom.seconds ? ` · ${clock(coverFrom.seconds)}` : ''}`
    : `"${coverFrom.title}"의 악보로`
  $('coverBar').querySelector('.muted').textContent = imported
    ? `이 멜로디${coverFrom.hasChords ? '와 코드' : ''}에 지금 적은 가사·스타일을 입혀 만듭니다. 곡 길이는 악보가 정합니다.`
    : '원곡의 멜로디·화성을 그대로 두고 스타일·가사만 새로 만듭니다.'
}

async function startCover (song) {
  const result = await window.yue.score(song.dir)
  if (!result.ok) {
    return toast('이 곡에는 악보가 없어 커버를 만들 수 없습니다. ' +
      '고급 설정의 작곡 방식을 "전체" 또는 "멜로디만"으로 두고 만든 곡만 커버할 수 있습니다.', 9000)
  }
  coverFrom = { source: 'cover', dir: song.dir, abc: result.abc, title: song.title || '무제',
    hasChords: hasChordSymbols(result.abc) }
  const instrumental = Boolean(song.instrumental)
  $('instrumental').checked = instrumental
  $('instrumental').onchange()
  const request = userRequest(song)
  if (!instrumental) $('lyrics').value = request.lyrics
  writeParts(request.parts)
  $('title').value = `${song.title || '무제'} (커버)`
  $('seed').value = ''
  // The score fixes the tune, so the arrangement knobs are the ones that matter;
  // the score-stage settings no longer apply.
  writeAdvanced({ ...request.advanced, cot: song.cot === 'off' ? 'full' : song.cot })
  const target = song.targetSeconds ? String(song.targetSeconds) : ''
  $('target').value = [...$('target').options].some((o) => o.value === target) ? target : ''
  showCover()
  document.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'))
  $('style').focus()
  $('style').scrollIntoView({ block: 'nearest' })
  toast('스타일 프롬프트를 새로 적고 "곡 만들기"를 누르세요. 가사도 바꿀 수 있지만, ' +
    '원곡과 글자 수가 많이 다르면 멜로디에 얹히지 않을 수 있습니다.', 10000)
}

async function openScore (song) {
  const result = await window.yue.score(song.dir)
  if (!result.ok) return toast(result.message)
  scoreSong = song
  scoreOriginal = result.abc
  setScoreMode('song')
  $('scoreTitle').textContent = song.title || ''
  // An instrumental keeps its vocal line empty no matter what is edited here.
  $('scoreInstrumental').classList.toggle('hidden', !song.instrumental)
  $('scoreText').value = result.abc
  showScoreRequest(song)
  markScore()
  $('score').classList.remove('hidden')
}

// The same window serves both jobs; only the introduction, the file controls and
// the final button differ.
function setScoreMode (mode) {
  scoreMode = mode
  const imported = mode === 'import'
  $('scoreIntroSong').classList.toggle('hidden', imported)
  $('scoreIntroImport').classList.toggle('hidden', !imported)
  $('scoreImportBar').classList.toggle('hidden', !imported)
  $('scoreRequestBox').classList.toggle('hidden', imported)
  if (!imported) $('midiPanel').classList.add('hidden')
  $('scoreInstrumental').classList.add('hidden')
  $('scoreText').placeholder = imported
    ? 'X:1\nT:\nM:4/4\nL:1/16\nQ:1/4=90\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\n' +
      'V: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\nV: Vocal\n"C"c4e4g4e4|…'
    : ''
}

function openImport () {
  scoreSong = null
  setScoreMode('import')
  $('scoreTitle').textContent = importName ? `· ${importName}` : '불러오기'
  $('scoreFileName').textContent = importName ? `${importName}` : ''
  scoreOriginal = $('scoreText').value = coverFrom && coverFrom.source === 'import' ? coverFrom.abc : ''
  markScore()
  $('score').classList.remove('hidden')
}

// ── MIDI track choice ──
function fillMidiPanel (result) {
  const describe = (part) => `${part.name} · ${part.count}음${part.range ? ` · ${part.range}` : ''}` +
    `${part.chordy ? ' · 화음' : ''}${part.drums ? ' · 드럼' : ''}`
  for (const [id, value] of [['midiVocal', result.choice.vocal], ['midiIns', result.choice.ins]]) {
    const select = $(id)
    select.innerHTML = ''
    select.appendChild(new Option(id === 'midiVocal' ? '없음 (보컬 없이 연주곡)' : '없음', ''))
    for (const part of result.parts) {
      const option = new Option(describe(part), part.id)
      option.disabled = part.drums // drums have no pitch line to sing or play
      select.appendChild(option)
    }
    select.value = value || ''
  }
  $('midiChords').checked = result.choice.chords
  showMidiNotes(result.result)
  $('midiPanel').classList.remove('hidden')
}

function showMidiNotes (result) {
  const facts = [`${result.key} 조`, `${result.meter}`, `${result.tempo} BPM`, `${result.bars}마디`,
    result.chords ? '코드 있음' : '코드 없음 (멜로디만)']
  $('midiNotes').textContent = [facts.join(' · '), ...result.notes].join('\n')
}

// Every edit is checked by YuE2's validator, a moment after typing stops.
function scheduleCheck () {
  clearTimeout(scheduleCheck.timer)
  scheduleCheck.timer = setTimeout(runCheck, 450)
}

async function runCheck () {
  const text = $('scoreText').value
  if (lastCheck.text === text && lastCheck.result) return lastCheck.result
  const line = $('scoreCheck')
  if (!text.trim()) {
    line.className = 'score-check'
    line.textContent = scoreMode === 'import' ? '파일을 열거나 ABC 악보를 붙여넣으세요.' : ''
    lastCheck = { text, result: null }
    return null
  }
  line.className = 'score-check'
  line.textContent = '규칙 검사 중…'
  const result = await window.yue.checkScore(text)
  if ($('scoreText').value !== text) return result // edited again meanwhile; a newer check follows
  lastCheck = { text, result }
  if (result.ok) {
    line.className = 'score-check good'
    line.textContent = `✓ YuE2 악보 규칙 통과 · ${clock(result.seconds)} · ${result.measures}마디 · ` +
      `보컬 음 ${result.vocalNotes}개 · 반주 음 ${result.insNotes}개 · 코드 ${result.chords}개`
  } else {
    line.className = 'score-check bad'
    line.textContent = `✗ YuE2 악보 규칙에 맞지 않습니다 — ${explainCheck(result.error)}`
    line.title = result.error // the checker's own words, for anyone fixing the ABC by hand
  }
  return result
}

// Reads the score back in words: the sections, how busy each line is, and — the
// question behind most "why is there a cello?" reports — whether the plan could have
// chosen an instrument at all. YuE2's native score cannot: it has no such field.
function showScoreInfo (abc) {
  const info = analyzeScore(abc)
  const box = $('scoreInfo')
  box.innerHTML = ''
  const row = (label, value, className = '') => {
    const line = document.createElement('div')
    line.className = `score-row ${className}`
    const key = document.createElement('span')
    key.className = 'score-key'
    key.textContent = label
    const text = document.createElement('span')
    text.textContent = value
    line.append(key, text)
    box.appendChild(line)
  }
  row('박자·템포', [info.meter, info.tempo && `${info.tempo} BPM`, info.key && `${info.key} 조`]
    .filter(Boolean).join(' · ') || '표시 없음')
  const sections = info.sections
    .map((item) => `${SECTION_NAMES[item.name] || item.name} ${item.bars}마디`)
  row('구간', sections.length ? sections.join(' → ') : '구간 표시 없음')
  row('보컬 멜로디', info.vocalNotes ? `음표 ${info.vocalNotes}개` : '없음 (쉼표만 — 보컬이 나오지 않습니다)')
  row('반주 멜로디', info.insNotes ? `음표 ${info.insNotes}개 (한 줄짜리 멜로디)` : '없음')
  row('코드', info.chords ? `${info.chords}개` : '없음 (멜로디만 있는 악보)')
  row('악기 정보', info.namesInstruments
    ? '악보에 악기 지정이 있습니다 (YuE2 기본 형식이 아닙니다)'
    : '없음 — 이 악보는 어떤 악기로 연주할지 정하지 않습니다', 'score-instruments')
  if (!info.namesInstruments) {
    const note = document.createElement('p')
    note.className = 'score-note'
    note.textContent = 'YuE2 악보에는 보컬 멜로디, 반주 멜로디 한 줄, 코드만 있습니다. 기타인지 첼로인지는 ' +
      '다음 단계(음원 만들기)에서 스타일 태그를 보고 정해집니다. 그래서 원하지 않은 악기가 들렸다면 ' +
      '악보 단계가 아니라 음원 단계에서 생긴 것이고, 악보를 고쳐서는 바꿀 수 없습니다. ' +
      '스타일 태그를 바꾸거나 같은 악보로 여러 번 만들어 골라주세요.'
    box.appendChild(note)
  }
}

// What the model was actually given, so a surprise can be traced to the request.
function showScoreRequest (song) {
  const box = $('scoreRequest')
  box.innerHTML = ''
  const add = (label, value) => {
    if (!value) return
    const title = document.createElement('div')
    title.className = 'score-key'
    title.textContent = label
    const body = document.createElement('pre')
    body.className = 'score-request-text'
    body.textContent = value
    box.append(title, body)
  }
  const parts = song.parts || {}
  add('고른 악기', (parts.instruments || [])
    .map((value) => (INSTRUMENTS.find((item) => item.value === value) || {}).label || value).join(', '))
  add('스타일 태그 [Tags]', song.style)
  add('가사 [Lyrics]', song.lyrics)
}

function markScore () {
  showScoreInfo($('scoreText').value)
  scheduleCheck()
  const changed = $('scoreText').value !== scoreOriginal
  $('scoreState').textContent = changed ? '· 수정됨' : '· 원본'
  $('scoreRender').textContent = scoreMode === 'import'
    ? '이 악보 쓰기'
    : changed ? '수정한 악보로 만들기' : '이 악보로 곡 만들기'
}

// ── advanced settings ────────────────────────────────────────────────────────
// Empty means "use YuE2's own default", so only what the user typed is sent.
const ADVANCED = {
  advTemperature: 'temperature',
  advTopP: 'topP',
  advTopK: 'topK',
  advRepetitionPenalty: 'repetitionPenalty',
  advCfgScale: 'cfgScale',
  advAbcTemperature: 'abcTemperature',
  advAbcMaxTokens: 'abcMaxTokens',
  advOdeSteps: 'odeSteps'
}
const TOKENS_PER_SECOND = 25 // the codec's frame rate; length is set in seconds here

// Aiming at a length: the cap ends the song, and min_tokens keeps the model from
// finishing early. Long targets also need material to fill — hence the extra
// instrumental sections and the arrangement hint.
const LONG_FORM = 'extended arrangement, instrumental intro, an instrumental interlude ' +
  'and a solo section between verses, a final chorus and an outro, ' +
  'let sections breathe rather than rushing'
const FILLER_SECTIONS = '\n\n[Interlude]\n[instrumental]\n\n[Solo]\n[instrumental]\n\n[Outro]\n[instrumental]'

// A saved request holds what was sent to the model, including the clauses and
// sections the app added on its own. Loading it back for another take strips them,
// so they are not added a second time and the box shows only what the user wrote.
function userRequest (song) {
  let style = song.style || ''
  const onlyListed = style.includes(ONLY_LISTED)
  for (const clause of [LONG_FORM, NO_VOICE, ONLY_LISTED]) style = style.split(`, ${clause}`).join('')
  // Songs from 0.12 on keep the builder's fields; older ones only the finished tags.
  const parts = song.parts
    ? { ...song.parts }
    : { genre: style, strict: onlyListed }
  let lyrics = song.lyrics || ''
  if (lyrics.endsWith(FILLER_SECTIONS)) lyrics = lyrics.slice(0, -FILLER_SECTIONS.length)
  // A target length writes its own token limits into the request. Loaded back into
  // the expert panel they would pin the length and override whatever target is picked
  // next, so only knobs the user set by hand come back.
  const advanced = { ...(song.advanced || {}) }
  if (song.targetSeconds) {
    delete advanced.maxTokens
    delete advanced.minTokens
  }
  // Likewise the guidance "프롬프트 강하게" added: it comes back as the checkbox.
  if (parts.strong && advanced.cfgScale === STRONG_CFG) delete advanced.cfgScale
  return { style, lyrics, onlyListed, parts, advanced }
}

function lengthPlan (seconds, lyrics) {
  if (!seconds) return null
  const tokens = Math.min(Math.round(seconds * TOKENS_PER_SECOND), MAX_SONG_TOKENS)
  const words = lyrics.replace(/^\s*\[.*\]\s*$/gm, '').replace(/\s/g, '').length
  return {
    seconds,
    maxTokens: tokens,
    minTokens: Math.round(tokens * 0.82), // 목표의 82% 전에는 끝내지 않는다
    longForm: seconds >= 240,
    // Four minutes of song needs more than a verse and a chorus to sing.
    needsFiller: seconds >= 240 && words < seconds * 2.2
  }
}

function readAdvanced () {
  const values = {}
  for (const [id, key] of Object.entries(ADVANCED)) {
    const raw = $(id).value.trim()
    if (raw !== '') values[key] = Number(raw)
  }
  const seconds = $('advMaxSeconds').value.trim()
  if (seconds !== '') values.maxTokens = Math.round(Number(seconds) * TOKENS_PER_SECOND)
  return values
}

function writeAdvanced (values = {}) {
  for (const [id, key] of Object.entries(ADVANCED)) {
    $(id).value = values[key] == null ? '' : values[key]
  }
  $('advMaxSeconds').value = values.maxTokens == null
    ? ''
    : Math.round(values.maxTokens / TOKENS_PER_SECOND)
  $('advCot').value = values.cot || 'full'
  showAdvancedState()
}

function showAdvancedState () {
  const count = Object.keys(readAdvanced()).length + ($('advCot').value === 'full' ? 0 : 1)
  $('advancedState').textContent = count ? `· ${count}개 변경됨` : '· 기본값'
}

// ── prompt builder ───────────────────────────────────────────────────────────
// Style, instruments, tempo and structure are asked for separately and assembled into
// one tag line (composeStyle in prompt.js); the preview shows exactly what is sent.
const INSTRUMENT_SLOTS = ['inst1', 'inst2', 'inst3']
const STRONG_CFG = 1.5

// Said plainly because users expect a hard lock and YuE2 has none to offer.
const BUILDER_HINT = {
  plain: '악기를 고르면 YuE2가 알아듣는 형식("two classical guitars, classical guitar duet")으로 태그를 만들어 줍니다.',
  strict: '⚠ 악기는 "요청"까지만 됩니다. YuE2가 쓰는 악보에는 보컬 멜로디, 반주 멜로디 한 줄, 코드만 있고 ' +
    '악기를 적는 칸이 없습니다. 어떤 악기 소리가 날지는 음원을 만드는 단계에서 이 태그를 보고 정해지기 때문에, ' +
    '엄격 모드로도 다른 악기가 섞이는 것을 완전히 막을 수는 없습니다. 섞이면 "한 번에 3곡"으로 만들어 골라주세요. ' +
    '보컬 끄기("가사 없이")는 악보 단계에서 강제로 적용됩니다.'
}

function fillBuilder () {
  INSTRUMENT_SLOTS.forEach((id, index) => {
    const select = $(id)
    select.innerHTML = ''
    select.appendChild(new Option(index === 0 ? '악기 선택' : '＋ 악기', ''))
    for (const item of INSTRUMENTS) select.appendChild(new Option(item.label, item.value))
  })
  const structure = $('structure')
  structure.innerHTML = ''
  for (const item of STRUCTURES) structure.appendChild(new Option(item.label, item.value))
}

function readParts () {
  return {
    genre: $('style').value.trim(),
    instruments: INSTRUMENT_SLOTS.map((id) => $(id).value).filter(Boolean),
    bpm: Number($('bpm').value) || null,
    strict: $('onlyListed').checked,
    strong: $('onlyListed').checked && $('strongPrompt').checked,
    structure: $('structure').value
  }
}

function writeParts (parts = {}) {
  $('style').value = parts.genre || ''
  INSTRUMENT_SLOTS.forEach((id, index) => { $(id).value = (parts.instruments || [])[index] || '' })
  $('bpm').value = parts.bpm || ''
  $('onlyListed').checked = Boolean(parts.strict)
  $('strongPrompt').checked = Boolean(parts.strong)
  $('structure').value = parts.structure || ''
  updatePreview()
}

function updatePreview () {
  const instrumental = $('instrumental').checked
  const { style } = composeStyle({
    ...readParts(), instrumental, lyrics: instrumental ? '' : $('lyrics').value
  })
  $('tagPreview').textContent = style || '—'
  const strict = $('onlyListed').checked
  $('builderHint').textContent = strict ? BUILDER_HINT.strict : BUILDER_HINT.plain
  $('builderHint').classList.toggle('warn', strict)
  $('strongWrap').classList.toggle('hidden', !strict)
  $('structure').title = instrumental
    ? '연주곡의 구간 구성'
    : '고르면 가사 칸이 비어 있을 때 구간 틀을 넣어 줍니다. 노래는 가사의 [Verse] [Chorus] 태그가 곧 구조입니다.'
}

// ── wiring ───────────────────────────────────────────────────────────────────
let userPresets = []

function presetChip (preset, { own = false } = {}) {
  const chip = document.createElement('button')
  chip.className = 'chip' + (own ? ' own' : '')
  chip.textContent = preset.name
  chip.title = [preset.note, preset.style].filter(Boolean).join('\n\n')
  chip.onclick = () => {
    // A saved preset brings its instruments and tempo back too; a built-in one only
    // sets the style and leaves the rest of the builder as the user has it.
    if (own && preset.parts) writeParts(preset.parts)
    else $('style').value = preset.style
    if (own) $('instrumental').checked = Boolean(preset.instrumental)
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'))
    chip.classList.add('active')
    if (own) $('instrumental').onchange()
    updatePreview()
    // Some presets promise less than their name suggests; say so when picked.
    if (preset.note) toast(preset.note, 9000)
  }
  if (own) {
    const drop = document.createElement('span')
    drop.className = 'chip-drop'
    drop.textContent = '✕'
    drop.title = '이 프리셋 지우기'
    drop.onclick = async (event) => {
      event.stopPropagation()
      if (!confirm(`"${preset.name}" 프리셋을 지울까요?`)) return
      const result = await window.yue.deletePreset(preset.name)
      userPresets = result.presets
      renderPresets()
    }
    chip.appendChild(drop)
  }
  return chip
}

function renderPresets () {
  const box = $('presets')
  box.innerHTML = ''
  const instrumental = $('instrumental').checked
  for (const preset of instrumental ? INSTRUMENTAL_PRESETS : PRESETS) {
    box.appendChild(presetChip(preset))
  }
  // The user's own presets sit at the end, marked and removable.
  for (const preset of userPresets.filter((item) => Boolean(item.instrumental) === instrumental)) {
    box.appendChild(presetChip(preset, { own: true }))
  }
  const save = document.createElement('button')
  save.className = 'chip add'
  save.textContent = '＋ 내 프리셋'
  save.title = '지금 프롬프트를 이름 붙여 저장'
  save.onclick = async () => {
    const parts = readParts()
    const style = parts.genre
    if (!style && !parts.instruments.length) return toast('저장할 스타일이나 악기를 먼저 정해주세요.')
    const name = await askText('프리셋 이름', '')
    if (!name) return
    const result = await window.yue.savePreset({ name, style, instrumental, parts })
    if (!result.ok) return toast(result.message)
    userPresets = result.presets
    renderPresets()
    toast(`"${name}" 프리셋을 저장했습니다.`)
  }
  box.appendChild(save)
}

function wireUi () {
  renderPresets()
  fillBuilder()

  // The settings box folds away and stays the way it was left.
  const options = $('optionsBox')
  try { if (localStorage.getItem('optionsOpen') === '0') options.open = false } catch {}
  options.addEventListener('toggle', () => {
    try { localStorage.setItem('optionsOpen', options.open ? '1' : '0') } catch {}
  })
  // Opening 곡 정보 brings it into view inside the (now scrolling) player.
  const meta = document.querySelector('#player .meta')
  meta.addEventListener('toggle', () => {
    if (meta.open) requestAnimationFrame(() => meta.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  })

  // Dragging reorders the waiting queue, or the finished songs of the project. The
  // new order shows at once; saving it follows.
  enableSorting($('songs'), {
    onIdle: renderSongs,
    onDrop: async (group, ids) => {
      const arrange = (items, key) => [
        ...ids.map((id) => items.find((item) => String(item[key]) === id)).filter(Boolean),
        ...items.filter((item) => !ids.includes(String(item[key])))
      ]
      if (group === 'queue') {
        queueState.waiting = arrange(queueState.waiting || [], 'jobId')
        renderSongs()
        await window.yue.queueReorder(ids)
        return
      }
      songs = arrange(songs, 'folder')
      renderSongs()
      const result = await window.yue.reorderSongs(ids)
      if (!result.ok) return toast(result.message, 6000)
      await refresh() // picks up the saved positions the album export goes by
    }
  })
  for (const id of ['style', 'bpm', 'lyrics']) $(id).addEventListener('input', updatePreview)
  for (const id of [...INSTRUMENT_SLOTS, 'onlyListed', 'strongPrompt']) {
    $(id).addEventListener('change', updatePreview)
  }
  // For a song with words the structure is its section tags, so picking one writes
  // the skeleton into an empty lyrics box; an instrumental uses it at generation time.
  $('structure').onchange = () => {
    updatePreview()
    if ($('instrumental').checked) return
    if ($('lyrics').value.trim()) {
      return toast('가사 칸이 비어 있지 않아 구간 틀을 넣지 않았습니다. 가사를 지운 뒤 다시 고르면 틀이 들어갑니다.', 7000)
    }
    $('lyrics').value = structureLyrics($('structure').value)
    $('lyrics').focus()
    updatePreview()
  }
  $('tagPreview').onclick = () => $('tagPreview').classList.toggle('expanded')
  updatePreview()

  for (const id of [...Object.keys(ADVANCED), 'advMaxSeconds', 'advCot']) {
    $(id).oninput = showAdvancedState
    $(id).onchange = showAdvancedState
  }
  $('showScore').onclick = () => selected && openScore(selected)
  $('coverSong').onclick = () => selected && startCover(selected)
  $('coverCancel').onclick = () => {
    const imported = coverFrom && coverFrom.source === 'import'
    coverFrom = null
    showCover()
    toast(imported
      ? '불러온 악보를 해제했습니다. 이제 악보부터 새로 만듭니다.'
      : '커버를 해제했습니다. 이제 악보부터 새로 만듭니다.')
  }
  $('clearLyrics').onclick = () => {
    $('title').value = ''
    $('lyrics').value = ''
    $('lyrics').focus()
  }
  $('clearStyle').onclick = () => {
    writeParts({})
    document.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'))
    $('style').focus()
  }
  $('scoreClose').onclick = () => $('score').classList.add('hidden')
  $('scoreText').oninput = markScore
  const applyScore = (fn) => () => { $('scoreText').value = fn($('scoreText').value); markScore() }
  $('scoreMelodyOnly').onclick = applyScore(dropChords)
  $('scoreVocalRest').onclick = applyScore((abc) => restVoice(abc, 'Vocal'))
  $('scoreInsRest').onclick = applyScore((abc) => restVoice(abc, 'Ins'))
  $('scoreRevert').onclick = () => { $('scoreText').value = scoreOriginal; markScore() }
  $('scoreCopy').onclick = async () => {
    await navigator.clipboard.writeText($('scoreText').value)
    toast('악보를 복사했습니다.')
  }
  $('scoreRender').onclick = async () => {
    const text = $('scoreText').value
    if (!text.trim()) return toast('악보가 비어 있습니다. 파일을 열거나 ABC를 붙여넣으세요.')
    // The validator is YuE2's own; a score it rejects may still tokenize, but what the
    // model makes of it is anyone's guess — so going ahead is the user's call.
    const check = await runCheck()
    if (check && !check.ok && !confirm(
      `YuE2 악보 규칙 검사를 통과하지 못했습니다.\n${explainCheck(check.error)}\n\n` +
      '이대로 쓰면 결과가 이상하거나 멜로디를 따르지 않을 수 있습니다. 그래도 쓸까요?')) return
    if (scoreMode === 'import') return useImportedScore(text, check)
    if (!scoreSong) return
    const result = await window.yue.render(scoreSong.dir, text)
    if (!result.ok) return toast(result.message)
    plans.set(result.jobId, estimate(scoreSong.lyrics || ''))
    $('score').classList.add('hidden')
    toast(result.position > 0
      ? `대기열 ${result.position}번째로 넣었습니다`
      : '악보로 곡을 만들기 시작했습니다', 6000)
  }

  $('planOnly').onclick = () => startFromEditor({ mode: 'plan' })

  // ── importing a score (MIDI / ABC) ──
  $('importScore').onclick = openImport
  $('scoreOpenFile').onclick = async () => {
    const result = await window.yue.openScore()
    if (!result.ok) {
      if (!result.canceled) showProblem(result.message, null, '악보를 불러오지 못했습니다')
      return
    }
    importName = result.name
    $('scoreTitle').textContent = `· ${importName}`
    $('scoreFileName').textContent = `${result.name}.${result.kind === 'midi' ? 'mid' : 'abc'}`
    if (result.kind === 'midi') {
      fillMidiPanel(result)
      $('scoreText').value = result.result.abc
    } else {
      $('midiPanel').classList.add('hidden')
      $('scoreText').value = result.text
    }
    scoreOriginal = $('scoreText').value
    markScore()
  }
  const reconvert = async () => {
    const result = await window.yue.convertMidi({
      vocal: $('midiVocal').value, ins: $('midiIns').value, chords: $('midiChords').checked
    })
    if (!result.ok) return toast(result.message, 6000)
    $('scoreText').value = scoreOriginal = result.result.abc
    showMidiNotes(result.result)
    markScore()
  }
  for (const id of ['midiVocal', 'midiIns', 'midiChords']) $(id).onchange = reconvert

  // The score waits in the banner above the style box; "곡 만들기" then sings it with
  // whatever lyrics and style are on screen.
  function useImportedScore (text, check) {
    const info = analyzeScore(text)
    coverFrom = {
      source: 'import', abc: text, title: importName || '불러온 악보',
      hasChords: hasChordSymbols(text), seconds: check && check.ok ? check.seconds : null
    }
    showCover()
    $('score').classList.add('hidden')
    if (!$('title').value.trim() && importName) $('title').value = importName
    // Tempo lives in the score; the style should say the same thing, not argue with it.
    if (info.tempo && Number($('bpm').value) !== info.tempo) {
      $('bpm').value = info.tempo
      updatePreview()
    }
    const vocalLess = check && check.ok ? !check.vocalNotes : !info.vocalNotes
    if (vocalLess && !$('instrumental').checked) {
      $('instrumental').checked = true
      $('instrumental').onchange()
      return toast('악보에 보컬 멜로디가 없어 "가사 없이 (연주곡)"으로 바꿨습니다. 스타일을 정하고 "곡 만들기"를 누르세요.', 9000)
    }
    if (check && check.ok && check.seconds > 355) {
      toast('악보가 6분 가까이 되거나 넘습니다. 6분이 넘는 부분은 만들어지지 않습니다.', 9000)
    }
    toast($('instrumental').checked
      ? '악보를 준비했습니다. 스타일을 정하고 "곡 만들기"를 누르세요.'
      : '악보를 준비했습니다. 가사와 스타일을 적고 "곡 만들기"를 누르세요. 가사 글자 수가 멜로디 음표 수와 비슷해야 자연스럽게 불립니다.', 9000)
  }

  $('advReset').onclick = () => {
    writeAdvanced({})
    toast('기본값으로 되돌렸습니다.')
  }

  $('instrumental').onchange = () => {
    const on = $('instrumental').checked
    $('lyrics').disabled = on
    $('lyricsHint').textContent = on
      ? '연주곡 모드입니다. 악보의 보컬 성부를 비우고 허밍·합창·내레이션까지 막습니다. 구간 구성은 아래 "구조"에서 고릅니다.'
      : '[Verse] [Pre-Chorus] [Chorus] [Bridge] 로 구간을 나누면 곡 구조가 좋아집니다. 알 수 없는 태그와 지시문은 자동으로 빠집니다.'
    renderPresets() // 연주곡에는 연주곡용 프리셋만 보여 준다
    updatePreview()
  }

  $('generate').onclick = () => startFromEditor({})

  // Shared by "곡 만들기" and "악보만": mode 'plan' stops after the score.
  async function startFromEditor ({ mode }) {
    const instrumental = $('instrumental').checked
    const raw = instrumental
      ? structureLyrics($('structure').value, { instrumental: true })
      : $('lyrics').value.trim()
    const parts = readParts()
    if (!raw) return toast('가사를 입력하거나 "가사 없이 (연주곡)"을 선택해주세요.')
    if (!parts.genre && !parts.instruments.length) {
      return toast('스타일을 적거나 프리셋·악기를 골라주세요.')
    }
    const { text: cleaned, notes } = cleanLyrics(raw)
    let lyrics = cleaned
    if (!instrumental && !lyrics.split('\n').some((line) => line.trim() && !line.startsWith('['))) {
      return toast('부를 가사가 없습니다. 구간 태그 아래에 가사를 적거나 "가사 없이 (연주곡)"을 선택해주세요.', 7000)
    }
    // Style, instruments, tempo and the strict/instrumental clauses become one tag
    // line in the shape YuE2 was trained on; brackets and prose are taken out.
    const composed = composeStyle({ ...parts, instrumental, lyrics })
    let style = composed.style
    notes.push(...composed.notes)
    if (!style) return toast('스타일에 쓸 수 있는 내용이 남지 않았습니다. 짧은 단어로 다시 적어주세요.', 7000)
    // An imported score already fixes the song's length bar by bar.
    const imported = Boolean(coverFrom && coverFrom.source === 'import')
    const length = imported ? null : lengthPlan(Number($('target').value) || 0, lyrics)
    if (imported && $('target').value) notes.push('불러온 악보가 곡 길이를 정하므로 "길이" 설정은 쓰지 않았습니다')
    if (length) {
      if (length.longForm) style = `${style}, ${LONG_FORM}`
      if (length.needsFiller && !instrumental) {
        lyrics += FILLER_SECTIONS
        notes.push('긴 곡을 위해 간주·솔로·아웃트로 구간을 덧붙였습니다')
      }
    }
    const heading = raw.split('\n').find((line) => /^\s*#/.test(line)) || ''
    const payload = {
      // A typed title is kept as typed; one made up from a heading or the first sung
      // line is kept short, since it also names the song's folder and file.
      title: $('title').value.trim() ||
        shortTitle(heading.replace(/^\s*#+\s*/, '')) ||
        (imported ? shortTitle(coverFrom.title) : '') ||
        shortTitle(lyrics.split('\n').find((line) => line && !line.startsWith('[')) || '') ||
        (instrumental ? '연주곡' : '무제'),
      lyrics,
      style,
      instrumental,
      // A target length and "프롬프트 강하게" only fill in what the expert panel left
      // empty. The latter is classifier-free guidance on the style and lyrics: the
      // one engine-side lever for making the tags count for more.
      advanced: {
        ...(length ? { maxTokens: length.maxTokens, minTokens: length.minTokens } : {}),
        ...(parts.strict && parts.strong ? { cfgScale: STRONG_CFG } : {}),
        ...readAdvanced()
      },
      // The builder's fields, so 설정 복제 and 커버 can put them back as they were.
      parts: { ...parts, instrumental },
      targetSeconds: length ? length.seconds : null,
      // A supplied score leaves the plan stage nothing to invent. Its instruction must
      // describe it truthfully — "chord-annotated" only when it has chords — and
      // "악보 없이 바로" would throw it away, so the mode follows the score.
      abc: coverFrom ? coverFrom.abc : null,
      cot: coverFrom ? (coverFrom.hasChords ? 'full' : 'melody') : $('advCot').value,
      mode,
      seed: $('seed').value.trim() || null
    }
    if (mode === 'plan' && coverFrom) {
      return toast(imported
        ? '불러온 악보가 이미 있어 "악보만"은 만들 필요가 없습니다. 악보는 "악보 불러오기"에서 다시 볼 수 있습니다.'
        : '커버는 원곡의 악보를 그대로 쓰기 때문에 "악보만"은 만들 필요가 없습니다. ' +
          '원곡의 악보는 "악보 보기"에서 볼 수 있습니다.', 8000)
    }
    if (mode === 'plan' && payload.cot === 'off') {
      return toast('악보만 만들려면 고급 설정의 작곡 방식을 "전체" 또는 "멜로디만"으로 두세요.', 7000)
    }
    plan = estimate(lyrics, { firstRun: !warmed })
    if (length) {
      // A target length decides the token count, so the time estimate follows it.
      plan = estimate(lyrics, { firstRun: !warmed })
      plan.tokens.semantic = length.maxTokens
      plan.seconds.semantic = length.maxTokens / SPEED.semantic
      plan.seconds.synth = length.maxTokens * SPEED.synthPerToken
      plan.total = ORDER.reduce((sum, key) => sum + plan.seconds[key], 0) +
        (warmed ? 0 : SPEED.load)
      for (const key of ORDER) plan.weights[key] = plan.seconds[key] / plan.total
    }
    // Guidance runs the song stage twice per token: once with the tags, once without.
    if ((payload.advanced.cfgScale || 1) > 1) {
      plan.seconds.semantic *= 2
      plan.total = ORDER.reduce((sum, key) => sum + plan.seconds[key], 0) +
        (warmed ? 0 : SPEED.load)
      for (const key of ORDER) plan.weights[key] = plan.seconds[key] / plan.total
    }
    // The model stops at 9000 song tokens (~6 minutes); past that the ending is lost.
    // With a target length the cap is the user's own choice, so no warning is due.
    if (!length && plan.tokens.semantic >= MAX_SONG_TOKENS && !confirm(
      `가사가 길어 노래가 약 ${Math.round(MAX_SONG_TOKENS / 25 / 60)}분에서 끊길 수 있습니다.\n` +
      '가사를 줄이면 끝까지 완성됩니다. 이대로 진행할까요?')) return
    const estimated = plan
    // A batch is the same request several times over with different seeds, so the
    // takes can be compared and the best one kept.
    const count = mode === 'plan' ? 1 : (Number($('count').value) || 1)
    const base = payload.seed === null ? null : Number(payload.seed)
    let queued = 0
    for (let index = 0; index < count; index++) {
      const take = {
        ...payload,
        title: count > 1 ? `${payload.title} ${String.fromCharCode(65 + index)}` : payload.title,
        seed: base === null ? null : base + index
      }
      const result = await window.yue.generate(take)
      if (!result.ok) {
        toast(result.message)
        break
      }
      // Each song carries its own estimate; the bar switches to it when that song starts.
      plans.set(result.jobId, estimated)
      queued += 1
    }
    if (!queued) return
    if (runningJob) plan = plans.get(runningJob.jobId) || estimated
    const summary = mode === 'plan'
      ? `악보만 만듭니다 (약 ${minutes(estimated.seconds.plan)})`
      : count > 1
        ? `${queued}곡을 예약했습니다 (시드가 다른 ${queued}가지 버전)`
        : coverFrom
          ? `"${coverFrom.title}" 커버를 만듭니다 (예상 약 ${minutes(estimated.total)})`
          : `예상 시간 약 ${minutes(estimated.total)}`
    toast([summary, ...notes].join(' · '), 7000)
  }
  $('queuePause').onclick = async () => {
    const result = await window.yue.queuePause(!queueState.paused)
    toast(result.paused
      ? '대기열을 멈췄습니다. 만들고 있는 곡은 끝까지 진행됩니다.'
      : '대기열을 다시 시작합니다.')
  }
  $('queueClear').onclick = async () => {
    if (!confirm('대기 중인 곡을 모두 취소할까요?\n지금 만들고 있는 곡은 계속 진행됩니다.')) return
    const result = await window.yue.queueClear()
    toast(`대기 중인 ${result.removed}곡을 취소했습니다.`)
  }

  $('lyricsHelp').onclick = () => toast('[Verse] 벌스 · [Pre-Chorus] 프리코러스 · [Chorus] 후렴 · [Bridge] 브릿지 — 대괄호 태그로 구간을 나눠주세요.', 6000)
  const exportAs = (format) => async () => {
    if (!selected) return
    const result = await window.yue.exportSong(selected.dir, selected.title || selected.id, format)
    if (!result.ok) {
      if (result.blocked) showProblem(result.message, null, '저장할 수 없는 폴더')
      else if (!result.canceled) toast(result.message || '저장하지 못했습니다.')
      return
    }
    showLocations() // 방금 저장한 폴더를 다음에도 쓴다
    // Saying so beats letting someone think a WAV rebuilt from an MP3 is lossless.
    toast(result.fromLossy
      ? 'WAV로 저장했습니다. 원본 WAV가 이미 지워져 MP3에서 변환한 것이라 음질은 MP3와 같습니다.'
      : `${format.toUpperCase()}로 저장했습니다.`, result.fromLossy ? 8000 : 3000)
  }
  $('exportMp3').onclick = exportAs('mp3')
  $('exportWav').onclick = exportAs('wav')
  $('renameSong').onclick = async () => {
    if (!selected) return
    const title = await askText('곡 이름 변경', selected.title || '')
    if (!title) return
    // The audio file is renamed with the song, and Windows will not rename a file the
    // player still has open: let go of it first.
    const player = $('audio')
    const wasPlaying = !player.paused
    const position = player.currentTime
    player.pause()
    player.removeAttribute('src')
    player.load()
    const result = await window.yue.rename(selected.dir, title)
    await refresh()
    if (selected) select(selected)
    if (!result.ok) return toast(result.message, 7000)
    if (!result.fileRenamed) {
      toast('이름은 바꿨지만 음원 파일 이름은 그대로입니다. 다른 프로그램에서 파일을 열어두었다면 닫고 다시 바꿔주세요.', 8000)
    } else if (wasPlaying) {
      // Pick up where it was, not from the top.
      player.addEventListener('loadedmetadata', () => {
        player.currentTime = position
        player.play().catch(() => {})
      }, { once: true })
    }
  }

  // ── album export ──
  const albumSongs = () => {
    return songs.filter((song) => song.audio && !song.unfinished)
  }
  const showAlbumSummary = () => {
    const picked = albumSongs()
    const total = songs.filter((song) => song.audio && !song.unfinished).length
    const lines = [picked.length
      ? `완성곡 ${total}곡 중 <b>${picked.length}곡</b>을 내보냅니다.`
      : '<span class="warn">내보낼 완성곡이 없습니다.</span>']
    // A WAV rebuilt from an MP3 is no better than the MP3; say so before, not after.
    const fromMp3 = picked.filter((song) => song.format === 'mp3').length
    if ($('albumFormat').value === 'wav' && fromMp3) {
      lines.push(`<span class="warn">${fromMp3}곡은 원본 WAV를 지워 MP3에서 변환하므로 음질이 MP3와 같습니다.</span>`)
    }
    lines.push(songs.some((song) => song.position !== null && song.position !== undefined)
      ? '트랙 순서: 목록에서 정한 순서 (위에서부터 1번)'
      : '트랙 순서: 만든 순서 · 목록에서 곡을 끌어 순서를 바꾸면 그 순서를 따릅니다')
    $('albumSummary').innerHTML = lines.join('<br>')
    $('albumOk').disabled = !picked.length
  }
  $('albumExport').onclick = () => {
    if (!songs.some((song) => song.audio && !song.unfinished)) {
      return toast('이 프로젝트에는 아직 완성된 곡이 없습니다.')
    }
    $('albumName').textContent = currentProject || ''
    showAlbumSummary()
    $('album').classList.remove('hidden')
  }
  $('albumFormat').onchange = showAlbumSummary
  $('albumCancel').onclick = () => $('album').classList.add('hidden')
  $('albumOk').onclick = async () => {
    $('album').classList.add('hidden')
    const result = await window.yue.exportAlbum({
      format: $('albumFormat').value,
      numbered: $('albumNumbered').checked
    })
    if (!result.ok) {
      if (result.blocked) showProblem(result.message, null, '저장할 수 없는 폴더')
      else if (!result.canceled) toast(result.message || '내보내지 못했습니다.', 7000)
      return
    }
    if (result.failures.length) {
      showProblem(`${result.count}곡을 저장했고, ${result.failures.length}곡은 저장하지 못했습니다.`,
        result.failures.join('\n'), '앨범 내보내기')
    } else {
      toast(`${result.count}곡을 앨범으로 저장했습니다.`, 5000)
    }
    showLocations()
    window.yue.open(result.path)
  }
  window.yue.onAlbumProgress(({ done, total, title }) => {
    if (done < total) toast(`앨범 내보내는 중… ${done + 1}/${total} ${title || ''}`, 60000)
  })
  $('revealSong').onclick = () => selected && window.yue.reveal(selected.dir)

  // Music made elsewhere joins the current project as finished songs.
  $('importSongs').onclick = async () => {
    $('importSongs').disabled = true
    $('importSongs').textContent = '불러오는 중…'
    const result = await window.yue.importSongs()
    $('importSongs').disabled = false
    $('importSongs').textContent = '불러오기'
    if (!result.ok) return
    await refresh()
    if (result.failures.length) {
      showProblem(`${result.count}곡을 불러왔고, ${result.failures.length}곡은 불러오지 못했습니다.`,
        result.failures.join('\n'), '음악 파일 불러오기')
    } else {
      toast(`${result.count}곡을 "${currentProject}" 프로젝트로 불러왔습니다. 영상 만들기·앨범 내보내기에 쓸 수 있습니다.`, 6000)
    }
  }

  // Load a finished song's request back into the editor: the basis for exploring
  // around a take you liked instead of starting over.
  $('reuseSong').onclick = () => {
    if (!selected) return
    const instrumental = Boolean(selected.instrumental)
    $('instrumental').checked = instrumental
    $('instrumental').onchange()
    const request = userRequest(selected)
    if (!instrumental) $('lyrics').value = request.lyrics
    writeParts(request.parts)
    $('seed').value = selected.seed == null ? '' : selected.seed
    $('title').value = selected.title || ''
    // Bring the expert knobs back too, so a take can be reproduced exactly.
    writeAdvanced({ ...request.advanced, cot: selected.cot })
    if (Object.keys(request.advanced).length) $('advanced').open = true
    // The target length is part of the request as much as the seed is.
    const target = selected.targetSeconds ? String(selected.targetSeconds) : ''
    $('target').value = [...$('target').options].some((o) => o.value === target) ? target : ''
    document.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'))
    coverFrom = null // 설정 복제는 악보까지 새로 만든다
    showCover()
    $('lyrics').scrollIntoView({ block: 'nearest' })
    toast('설정을 불러왔습니다. 시드를 비우면 같은 가사로 다른 곡이, 그대로 두면 같은 곡이 나옵니다.', 8000)
  }

  const saveOptions = async () => {
    const settings = await window.yue.setSettings({
      autoMp3: $('autoMp3').checked, dropWav: $('dropWav').checked
    })
    $('dropWav').disabled = !settings.autoMp3
    $('dropWav').checked = settings.dropWav
  }
  $('autoMp3').onchange = saveOptions
  $('dropWav').onchange = async () => {
    if ($('dropWav').checked && !confirm(
      '원본 WAV를 지우면 용량이 약 10분의 1로 줄어듭니다.\n' +
      'MP3만 남으므로 음질 손실이 조금 있습니다. 사용할까요?')) {
      $('dropWav').checked = false
    }
    await saveOptions()
  }
  // The bottom player and the list buttons drive the same element, so keep the
  // icons in step with whatever started or stopped playback.
  const audio = $('audio')
  for (const event of ['play', 'pause', 'ended']) {
    audio.addEventListener(event, () => {
      if (event === 'play' && selected) playingDir = selected.dir
      renderSongs()
    })
  }

  $('project').onchange = async (event) => {
    await window.yue.selectProject(event.target.value)
    selected = null
    $('player').classList.add('hidden')
    await refresh()
  }
  $('newProject').onclick = async () => {
    const name = await askText('새 프로젝트 이름', '')
    if (!name) return
    const result = await window.yue.createProject(name)
    if (!result.ok) return toast(result.message)
    selected = null
    $('player').classList.add('hidden')
    await refresh()
    toast(`"${result.current}" 프로젝트로 바꿨습니다.`)
  }
  $('renameProject').onclick = async () => {
    const name = await askText('프로젝트 이름 변경', currentProject || '')
    if (!name) return
    const result = await window.yue.renameProject(currentProject, name)
    if (!result.ok) return toast(result.message)
    await refresh()
  }

  $('moveModels').onclick = async () => {
    if (!confirm('음악 모델(약 8GB)을 다른 폴더로 옮깁니다.\nC 드라이브 공간을 비울 때 쓰세요. 몇 분 걸릴 수 있습니다.')) return
    $('moveModels').disabled = true
    $('moveModels').textContent = '옮기는 중…'
    const result = await window.yue.moveModels()
    $('moveModels').disabled = false
    $('moveModels').textContent = '모델 위치 옮기기'
    if (result.ok) toast(`모델을 옮겼습니다: ${result.path}`, 7000)
    else if (!result.canceled) toast(result.message, 7000)
  }

  // ── storage locations ──
  $('moveSongs').onclick = async () => {
    if (running || queueState.waiting.length) {
      return toast('곡을 만드는 중이거나 대기열에 곡이 있으면 옮길 수 없습니다. 모두 끝난 뒤에 해주세요.', 7000)
    }
    if (!confirm('만든 곡 전체(모든 프로젝트)를 다른 위치로 옮깁니다.\n' +
      '고른 곳 안에 "ssokMusic Songs" 폴더가 생기고, 앞으로 만드는 곡도 그곳에 저장됩니다.\n' +
      '다른 드라이브로 옮기면 모두 복사해 확인한 뒤에 원래 폴더를 지웁니다. 곡이 많으면 몇 분 걸릴 수 있습니다.')) return
    // A song loaded in the player keeps its file open, and Windows will not move it.
    const player = $('audio')
    player.pause()
    player.removeAttribute('src')
    player.load()
    selected = null
    $('player').classList.add('hidden')
    $('moveSongs').disabled = true
    $('moveSongs').textContent = '옮기는 중…'
    const result = await window.yue.moveSongs()
    $('moveSongs').disabled = false
    $('moveSongs').textContent = '옮기기'
    await refresh()
    await showLocations()
    if (!result.ok) {
      if (result.blocked) showProblem(result.message, null, '저장할 수 없는 폴더')
      else if (!result.canceled) showProblem(result.message, null, '곡을 옮기지 못했습니다')
      return
    }
    toast(`곡 파일 ${result.count}개(${result.gb}GB)를 옮겼습니다: ${result.path}`, 8000)
    if (result.leftover) {
      showProblem(`곡은 모두 새 위치로 옮겨졌지만, 원래 폴더를 지우지 못했습니다.\n${result.leftover}\n` +
        '다른 프로그램이 파일을 열고 있었을 수 있습니다. 확인한 뒤 직접 지워도 됩니다.', null, '곡을 옮겼습니다')
    }
  }
  window.yue.onSongsMoveProgress(({ copied, total, done, count }) => {
    if (done >= count) return
    const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1)
    toast(`곡 옮기는 중… ${done}/${count}개 · ${gb(copied)}/${gb(total)}GB`, 60000)
  })
  $('pickExport').onclick = async () => {
    const result = await window.yue.pickExport()
    if (result.blocked) return showProblem(result.message, null, '저장할 수 없는 폴더')
    if (!result.ok) return
    await showLocations()
    toast(`앞으로 내보내기는 이 폴더에서 시작합니다: ${result.path}`, 6000)
  }
  $('compact').onclick = async () => {
    if (!confirm('이미 만든 곡들을 MP3로 바꾸고 원본 WAV를 지울까요?\n곡 하나당 용량이 약 10분의 1로 줄어듭니다.')) return
    $('compact').disabled = true
    $('compact').textContent = '정리하는 중…'
    const result = await window.yue.compact()
    $('compact').disabled = false
    $('compact').textContent = '이미 만든 곡 정리'
    toast(result.ok
      ? `${result.converted}곡을 정리해 ${result.savedGb}GB를 확보했습니다.`
      : result.message, 6000)
    await refresh()
  }
  $('deleteSong').onclick = async () => {
    if (!selected || !confirm('이 곡을 삭제할까요? (휴지통으로 이동)')) return
    await window.yue.remove(selected.dir)
    selected = null
    $('player').classList.add('hidden')
    await refresh()
  }
}

// Show what the machine has before anything is downloaded, and block the install
// when a requirement is missing rather than failing 11GB later.
async function showLocation () {
  const place = await window.yue.location()
  $('dataDir').textContent = place.freeGb === null
    ? place.dataDir
    : `${place.dataDir} (여유 ${place.freeGb}GB)`
}

async function showPreflight () {
  await showLocation()
  const box = $('preflight')
  box.classList.remove('hidden')
  box.innerHTML = '<div class="row"><span class="mark">…</span><span>컴퓨터 사양을 확인하는 중</span></div>'
  const check = await window.yue.checkSetup()
  const rows = []
  const line = (cls, mark, text) => rows.push(
    `<div class="row"><span class="mark ${cls}">${mark}</span><span class="${cls === 'good' ? '' : cls}">${text}</span></div>`)
  const gpuOk = check.gpu.ok && check.gpu.bf16 !== false
  line(gpuOk ? 'good' : 'bad', gpuOk ? '✓' : '✕',
    check.gpu.ok
      ? `그래픽카드 ${check.gpu.name} (${check.gpu.vramGb}GB)${gpuOk ? '' : ' — 지원하지 않는 세대'}`
      : '그래픽카드 없음')
  if (check.freeGb !== null) {
    const enough = check.freeGb >= check.needGb
    line(enough ? 'good' : 'bad', enough ? '✓' : '✕',
      `${check.drive} 여유 공간 ${check.freeGb}GB (필요 ${check.needGb}GB)`)
  }
  // The GPU and disk rows above already state the blocking problems; only warnings
  // add anything new here.
  for (const text of check.warnings) line('warn', '!', text)
  if (!check.ok) line('bad', '✕', '위 항목을 해결한 뒤 프로그램을 다시 실행해주세요.')
  box.innerHTML = rows.join('')
  $('setupStart').disabled = !check.ok
  $('setupStart').textContent = check.ok ? '설치 시작' : '설치할 수 없습니다'
}

// ── updates ──────────────────────────────────────────────────────────────────
let updateInfo = null
let updateSkipped = false

function showUpdate (info) {
  updateInfo = info
  $('updateFrom').textContent = `버전 ${info.current}`
  $('updateTo').textContent = `버전 ${info.version}`
  $('updateNotes').textContent = info.notes || ''
  $('updateNotes').classList.toggle('hidden', !info.notes)
  $('updateLater').classList.toggle('hidden', Boolean(info.mandatory))
  $('updateNow').textContent = info.forMe === false ? '내려받는 곳 열기' : '지금 업데이트'
  $('update').classList.remove('hidden')
}

async function checkUpdate () {
  if (updateSkipped || running) return // 곡을 만드는 중에 끼어들지 않는다
  try {
    const info = await window.yue.checkUpdate()
    if (info) showUpdate(info)
  } catch (error) {
    report('update check', error)
  }
}

// ── system gauges ────────────────────────────────────────────────────────────
function showStats (stats) {
  const gauge = (prefix, used, total) => {
    const wrap = $(`${prefix}Gauge`)
    if (used == null || !total) return wrap.classList.add('hidden')
    wrap.classList.remove('hidden')
    const ratio = Math.min(1, used / total)
    $(`${prefix}Bar`).style.width = `${(ratio * 100).toFixed(0)}%`
    // Amber near the limit, red at it: on 8GB cards this is the spill warning.
    $(`${prefix}Bar`).className = ratio > 0.95 ? 'full' : ratio > 0.85 ? 'high' : ''
    $(`${prefix}Text`).textContent = `${used}/${total}GB`
  }
  gauge('vram', stats.vramUsedGb, stats.vramTotalGb)
  gauge('ram', stats.ramUsedGb, stats.ramTotalGb)
  $('gpuLoad').textContent = stats.gpuLoad == null ? '' : `GPU ${stats.gpuLoad}%`
}

function wireUpdate () {
  window.yue.onStats(showStats)
  window.yue.onUpdateProgress((ratio) => {
    $('updateBarWrap').classList.remove('hidden')
    $('updateBar').style.width = `${(ratio * 100).toFixed(0)}%`
    $('updateStatus').textContent = `내려받는 중 ${(ratio * 100).toFixed(0)}%`
    $('updateStatus').classList.remove('hidden')
  })
  $('updateLater').onclick = () => {
    updateSkipped = true // 이번에 켜 둔 동안은 다시 묻지 않는다
    $('update').classList.add('hidden')
  }
  $('updateNow').onclick = async () => {
    $('updateNow').disabled = true
    $('updateLater').disabled = true
    $('updateStatus').textContent = '준비하는 중…'
    $('updateStatus').classList.remove('hidden')
    const result = await window.yue.installUpdate(updateInfo)
    if (!result.ok) {
      $('updateNow').disabled = false
      $('updateLater').disabled = false
      $('updateStatus').textContent = result.error || '업데이트에 실패했습니다.'
    } else if (result.manual) {
      $('updateStatus').textContent = '내려받은 파일을 열었습니다.'
    } else {
      $('updateStatus').textContent = '설치 프로그램을 실행했습니다. 잠시 후 다시 열립니다.'
    }
  }
  $('versionInfo').title = '눌러서 업데이트 확인'
  $('versionInfo').style.cursor = 'pointer'
  $('versionInfo').onclick = async () => {
    updateSkipped = false
    const info = await window.yue.checkUpdate()
    if (info) showUpdate(info)
    else toast('최신 버전을 쓰고 있습니다.')
  }
  // 첫 확인은 boot() 이 화면을 준비한 직후 곧바로 한다(첫 실행 설치 화면일 때는 건너뛴다).
  // 며칠씩 켜 두는 사람을 위해 여섯 시간마다 한 번 더 본다.
  setInterval(checkUpdate, 6 * 60 * 60 * 1000)
}

async function boot () {
  const state = await window.yue.state()
  $('gpuInfo').textContent = state.gpu && state.gpu.name
    ? `${state.gpu.name} ${state.gpu.vramGb}GB` : 'GPU 없음'
  // package.json carries a semver patch level the product name never shows.
  $('versionInfo').textContent = `버전 ${String(state.version || '0.1.0').replace(/\.0$/, '')}`
  // Resolve on click: the folder follows whichever project is selected now.
  $('openFolder').onclick = async () => {
    const now = await window.yue.state()
    if (now.songsDir) window.yue.open(now.songsDir)
  }
  userPresets = await window.yue.presets()
  renderPresets()
  const settings = await window.yue.getSettings()
  $('autoMp3').checked = settings.autoMp3
  $('dropWav').checked = settings.dropWav
  $('dropWav').disabled = !settings.autoMp3
  showLocations()
  if (!state.ready) {
    $('setup').classList.remove('hidden')
    await showPreflight()
    return
  }
  checkUpdate() // 기다리지 않고 바로 — 곡 목록을 읽기 전에 시작한다
  queueState = await window.yue.queue()
  await refresh()
}

// Renderer failures are invisible without DevTools, so mirror them into app.log.
const report = (what, error) => {
  const text = `${what}: ${(error && (error.stack || error.message)) || error}`
  try { window.yue.log(text) } catch { /* nothing else we can do */ }
  toast(`문제가 생겼습니다: ${String((error && error.message) || error).slice(0, 120)}`, 8000)
}
window.addEventListener('error', (e) => report('error', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => report('rejection', e.reason))

try {
  wireSetup()
  wireJobs()
  wireUi()
  wireUpdate()
  boot()
} catch (error) {
  report('startup', error)
}
