'use strict'
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, screen, powerSaveBlocker } = require('electron')
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const os = require('os')
const { pathToFileURL } = require('url')
const appUpdate = require('./app-update')
const midiTools = require('./midi')
const videoTools = require('./video')

const UV_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
const YUE_URL = 'https://github.com/multimodal-art-projection/YuE/archive/refs/tags/yue2-v0.1.6.zip'
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
const MODEL_BYTES = 8.4 * 1024 ** 3 // both checkpoints, used for the download bar

let win = null
let worker = null
let currentJob = null
// Songs queue up and run one at a time: a single 8GB GPU cannot generate two at once.
const queue = []
// Jobs that died on their own keep their request here so one click can run them again.
const failed = []
let paused = false

// Pin the data folder to a stable name so renaming the product later never orphans
// an installed runtime or someone's settings.
app.setPath('userData', process.env.OCUT_BASELINE_DATA || path.join(app.getPath('appData'), 'O-CUT-Baseline'))

const userData = () => app.getPath('userData')
const unpacked = (p) => p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)

// 0.1 renamed the app from YueStudio. Carry the old settings over and keep using the
// runtime already installed under the old folder instead of downloading 4GB again
// (a venv cannot simply be moved: its interpreter paths are absolute).
function migrateLegacyData () {
  const target = path.join(userData(), 'settings.json')
  const legacyDir = path.join(app.getPath('appData'), 'yue-studio')
  const legacy = path.join(legacyDir, 'settings.json')
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return
  try {
    const settings = JSON.parse(fs.readFileSync(legacy, 'utf8'))
    const legacyPython = path.join(legacyDir, 'runtime', 'venv', 'Scripts', 'python.exe')
    if (!settings.pythonPath && fs.existsSync(legacyPython)) settings.pythonPath = legacyPython
    fs.mkdirSync(userData(), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(settings, null, 1), 'utf8')
  } catch (error) {
    console.error('migration skipped:', error.message)
  }
}

// O-CUT baseline: never import or mutate another application's user data.

// settings.json may pin an existing Python environment / model cache (used for
// development, and as an escape hatch when the runtime lives on another drive).
function settingsSync () {
  try { return JSON.parse(fs.readFileSync(path.join(userData(), 'settings.json'), 'utf8')) } catch { return {} }
}

const paths = () => {
  const root = userData()
  const pinned = settingsSync()
  // The runtime and the checkpoints together are ~11GB. dataDir lets them live on a
  // roomier drive; without it they stay where Windows puts app data.
  const dataDir = pinned.dataDir || root
  return {
    root,
    dataDir,
    runtime: path.join(dataDir, 'runtime'),
    uv: path.join(dataDir, 'runtime', 'uv.exe'),
    venv: path.join(dataDir, 'runtime', 'venv'),
    python: pinned.pythonPath || path.join(dataDir, 'runtime', 'venv', 'Scripts', 'python.exe'),
    // With a chosen data folder the models go beside the runtime; otherwise the
    // standard Hugging Face cache, which other local AI tools already share.
    hfHome: pinned.hfHome || process.env.YUESTUDIO_HF_HOME || process.env.HF_HOME ||
      (pinned.dataDir ? path.join(dataDir, 'models')
        : path.join(os.homedir(), '.cache', 'huggingface')),
    settings: path.join(root, 'settings.json'),
    songsPinned: pinned.songsDir || null,
    // Packaged scripts live inside app.asar, which Python cannot read; electron-builder
    // mirrors the unpacked copies next to it.
    worker: unpacked(path.join(__dirname, '..', 'python', 'worker.py')),
    setupModels: unpacked(path.join(__dirname, '..', 'python', 'setup_models.py'))
  }
}

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload)
const setupLog = (text) => send('setup:log', text)

// Durable log next to the settings file; the first place to look when the app
// misbehaves on someone else's machine.
function log (...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(
    (p) => typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`
  try {
    fs.mkdirSync(userData(), { recursive: true })
    fs.appendFileSync(path.join(userData(), 'app.log'), line, 'utf8')
  } catch { /* logging must never break the app */ }
  process.stdout.write(line)
}

async function readSettings () {
  try { return JSON.parse(await fsp.readFile(paths().settings, 'utf8')) } catch { return {} }
}
async function writeSettings (patch) {
  const next = { ...(await readSettings()), ...patch }
  await fsp.mkdir(userData(), { recursive: true })
  await fsp.writeFile(paths().settings, JSON.stringify(next, null, 1), 'utf8')
  return next
}

// ── helpers ──────────────────────────────────────────────────────────────────
function run (file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
      if (options.stream) String(d).split(/\r?\n/).filter(Boolean).forEach(setupLog)
    })
    child.stderr.on('data', (d) => {
      err += d
      if (options.stream) String(d).split(/\r?\n/).filter(Boolean).forEach(setupLog)
    })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve(out.trim())
      : reject(new Error(`${path.basename(file)} exited ${code}\n${(err || out).slice(-2000)}`)))
  })
}

function download (url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (link, redirects = 0) => https.get(link, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirects > 5) return reject(new Error('too many redirects'))
        res.resume()
        return get(res.headers.location, redirects + 1)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${link}`))
      const total = Number(res.headers['content-length'] || 0)
      let got = 0
      res.on('data', (chunk) => {
        got += chunk.length
        if (onProgress) onProgress(got, total)
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
    }).on('error', reject)
    get(url)
  })
}

const unzip = (zip, dest) => run('powershell.exe',
  ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`])

async function exists (p) { try { await fsp.access(p); return true } catch { return false } }

// A OneDrive-backed Documents folder can make mkdir hang forever instead of failing,
// which silently froze song creation. Probe candidates with a timeout and remember
// the first folder that actually accepts a write.
let songsDir = null

async function ensureSongsDir () {
  if (songsDir) return songsDir
  const p = paths()
  const candidates = [
    p.songsPinned,
    path.join(userData(), 'Songs')
  ].filter(Boolean)
  for (const dir of candidates) {
    const probe = path.join(dir, '.write-test')
    try {
      await withTimeout(fsp.mkdir(probe, { recursive: true }), 4000)
      await withTimeout(fsp.rmdir(probe), 4000)
      songsDir = dir
      if (dir !== p.songsPinned) await writeSettings({ songsDir: dir })
      log('songs folder', dir)
      return dir
    } catch (error) {
      log('songs folder unusable', dir, error.message)
    }
  }
  throw new Error('곡을 저장할 폴더를 만들지 못했습니다.')
}

// Songs live in Songs\<project>\<song>. One project is current at a time; everything
// made while it is selected lands in its folder.
const DEFAULT_PROJECT = '기본'
const projectName = () => settingsSync().project || DEFAULT_PROJECT

async function projectDir (name = projectName()) {
  const dir = path.join(await ensureSongsDir(), slug(name))
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

// 0.5 introduced projects; songs made before it sit loose in Songs\ and belong to
// the default project.
async function migrateLooseSongs () {
  const root = await ensureSongsDir()
  const home = await projectDir(DEFAULT_PROJECT)
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    if (full === home || !await exists(path.join(full, 'meta.json'))) continue
    try {
      await fsp.rename(full, path.join(home, entry.name))
      log('moved into default project', entry.name)
    } catch (error) {
      log('could not move song into project', entry.name, error.message)
    }
  }
  // Renaming a song folder in an older version could leave the empty original behind
  // at the root, where it then read as a project with no songs in it.
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{14}_/.test(entry.name)) continue
    try {
      if (!(await fsp.readdir(path.join(root, entry.name))).length) {
        await fsp.rmdir(path.join(root, entry.name))
        log('removed empty leftover folder', entry.name)
      }
    } catch { /* 지우지 못해도 그만이다 */ }
  }
}

async function listProjects () {
  const root = await ensureSongsDir()
  await projectDir(DEFAULT_PROJECT) // 최소 한 개는 늘 있게 한다
  const names = []
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const songs = (await fsp.readdir(path.join(root, entry.name), { withFileTypes: true }))
      .filter((child) => child.isDirectory()).length
    names.push({ name: entry.name, songs })
  }
  return names.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

// Windows' ransomware protection (Controlled Folder Access) guards Documents, Music,
// Desktop and the like against unsigned programs such as this one. A blocked write
// from the app itself can hang instead of failing, and a hung file call ties up one of
// the few threads every file operation shares. So a throwaway copy of this same
// executable — judged the same way by Windows Defender — tries first, and is killed
// if it stalls.
const BLOCKED_FOLDER = '이 폴더에는 저장할 수 없습니다.\n\n' +
  'Windows 보안의 "랜섬웨어 방지(제어된 폴더 액세스)"가 켜져 있으면 문서·음악·사진·바탕 화면 ' +
  '같은 폴더에 프로그램이 파일을 만들지 못하게 막습니다.\n\n' +
  '다른 폴더(예: D 드라이브의 폴더)를 고르거나, Windows 보안 → 바이러스 및 위협 방지 → ' +
  '랜섬웨어 방지 관리 → "제어된 폴더 액세스를 통해 앱 허용"에서 ssokMusic Free를 추가한 뒤 다시 시도해주세요.'

function canWrite (dir, ms = 8000) {
  return new Promise((resolve) => {
    const probe = path.join(dir, `.ssokmusic-probe-${process.pid}-${Date.now()}`)
    const script = "const fs=require('fs');fs.mkdirSync(process.argv[1]);fs.rmdirSync(process.argv[1])"
    execFile(process.execPath, ['-e', script, probe],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: ms, windowsHide: true },
      (error) => {
        if (error) log('folder not writable', dir, error.killed ? 'timed out' : error.message.split('\n')[0])
        resolve(!error)
      })
  })
}

function withTimeout (promise, ms) {
  return Promise.race([promise, new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`응답 없음 (${ms}ms 초과)`)), ms))])
}

// Prefer a full "cpython-3.12.14-..." directory over uv's minor-version link, which
// can be left behind broken; verify the interpreter actually runs before using it.
async function findManagedPython (dir) {
  let entries = []
  try { entries = await fsp.readdir(dir) } catch { return null }
  const candidates = entries
    .filter((name) => /^cpython-3\.12/.test(name))
    .sort((a, b) => (/^cpython-3\.12\.\d/.test(b) ? 1 : 0) - (/^cpython-3\.12\.\d/.test(a) ? 1 : 0))
  for (const name of candidates) {
    const exe = path.join(dir, name, 'python.exe')
    if (!await exists(exe)) continue
    try {
      await run(exe, ['-c', 'pass'])
      return exe
    } catch { /* broken link directory — try the next candidate */ }
  }
  return null
}

// YuE2 runs in BF16, which only Ampere and newer cards (compute capability 8.0+)
// execute natively. On a GTX 10/16 or RTX 20 series PyTorch reports bf16 as
// "supported" through emulation, so the check has to look at the card itself —
// otherwise the user downloads 11GB and only then finds out.
const MIN_COMPUTE = 8.0

async function detectGpu () {
  try {
    const out = await run('nvidia-smi',
      ['--query-gpu=name,memory.total,compute_cap', '--format=csv,noheader,nounits'])
    const [name, mb, cap] = out.split(/\n/)[0].split(',').map((s) => s.trim())
    const compute = Number(cap)
    return {
      ok: true,
      name,
      vramGb: Math.round(Number(mb) / 1024 * 10) / 10,
      compute: Number.isFinite(compute) ? compute : null,
      bf16: !Number.isFinite(compute) || compute >= MIN_COMPUTE
    }
  } catch {
    return { ok: false, name: null, vramGb: 0, compute: null, bf16: false }
  }
}

// ── first-run setup ──────────────────────────────────────────────────────────
const NEEDED_GB = 20
const NEEDED_VRAM_GB = 8

async function freeSpaceGb (target) {
  try {
    const stat = await fsp.statfs(path.parse(target).root)
    return Math.round(stat.bsize * stat.bavail / 1024 ** 3 * 10) / 10
  } catch {
    return null
  }
}

// Checked before the first byte is downloaded: finding out about a full disk after
// 11GB is a terrible first impression.
async function preflight () {
  const p = paths()
  const gpu = await detectGpu()
  // The runtime and the models can sit on different drives; the tighter one decides.
  const places = [p.dataDir, p.hfHome]
  const spaces = await Promise.all(places.map(freeSpaceGb))
  const worst = spaces.reduce((low, gb, i) => gb !== null && (low === -1 || gb < spaces[low]) ? i : low, -1)
  const drive = path.parse(places[worst === -1 ? 0 : worst]).root
  const freeGb = worst === -1 ? null : spaces[worst]
  const problems = []
  const warnings = []
  if (!gpu.ok) {
    problems.push('NVIDIA 그래픽카드를 찾지 못했습니다. 이 프로그램은 NVIDIA 그래픽카드에서만 작동합니다.')
  } else if (!gpu.bf16) {
    problems.push(`${gpu.name}는 이 프로그램이 쓰는 BF16 연산을 지원하지 않습니다. ` +
      'RTX 30 시리즈 이상(3050·3060·4060·5060 등)이 필요합니다. ' +
      'GTX 10/16 시리즈와 RTX 20 시리즈에서는 작동하지 않습니다.')
  } else if (gpu.vramGb < NEEDED_VRAM_GB - 0.5) {
    warnings.push(`그래픽카드 메모리가 ${gpu.vramGb}GB입니다. 권장은 ${NEEDED_VRAM_GB}GB 이상이라 곡 생성이 매우 느리거나 실패할 수 있습니다.`)
  }
  if (freeGb !== null && freeGb < NEEDED_GB) {
    problems.push(`${drive} 드라이브 여유 공간이 ${freeGb}GB입니다. 설치에 ${NEEDED_GB}GB가 필요합니다.`)
  }
  log('preflight', { gpu, drive, freeGb, problems, warnings })
  return { ok: problems.length === 0, gpu, drive, freeGb, needGb: NEEDED_GB, problems, warnings }
}

async function runSetup () {
  const p = paths()
  const check = await preflight()
  if (!check.ok) throw new Error(check.problems.join('\n'))
  const gpu = check.gpu
  send('setup:step', { step: 'gpu', status: 'done', detail: `${gpu.name} (${gpu.vramGb}GB)` })

  await fsp.mkdir(p.runtime, { recursive: true })
  await fsp.mkdir(p.hfHome, { recursive: true })

  // 1. uv (standalone Python/package manager)
  if (!await exists(p.uv)) {
    send('setup:step', { step: 'uv', status: 'run' })
    const zip = path.join(os.tmpdir(), 'uv.zip')
    await download(UV_URL, zip, (got, total) =>
      send('setup:progress', { step: 'uv', got, total }))
    await unzip(zip, p.runtime)
    await fsp.unlink(zip).catch(() => {})
  }
  send('setup:step', { step: 'uv', status: 'done' })

  // 2. Python 3.12 virtual environment
  if (!await exists(p.python)) {
    send('setup:step', { step: 'venv', status: 'run' })
    // uv finishes `python install` by creating a minor-version link directory; that
    // step fails on some Windows setups even though the interpreter itself unpacked
    // fine. Treat it as non-fatal and pick the interpreter off disk ourselves.
    try {
      await run(p.uv, ['python', 'install', '3.12'], { stream: true, env: uvEnv() })
    } catch (error) {
      setupLog(`python install 경고: ${error.message.split('\n')[0]}`)
    }
    const python = await findManagedPython(path.join(p.runtime, 'python'))
    if (!python) throw new Error('파이썬 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.')
    await run(p.uv, ['venv', '--python', python, p.venv], { stream: true, env: uvEnv() })
  }
  send('setup:step', { step: 'venv', status: 'done' })

  // 3. PyTorch (CUDA) — the big one, ~3GB
  send('setup:step', { step: 'torch', status: 'run' })
  await run(p.uv, ['pip', 'install', '--python', p.python, 'torch==2.10.0',
    '--index-url', TORCH_INDEX], { stream: true, env: uvEnv() })
  send('setup:step', { step: 'torch', status: 'done' })

  // 4. YuE2 + helpers
  send('setup:step', { step: 'yue', status: 'run' })
  await run(p.uv, ['pip', 'install', '--python', p.python, YUE_URL,
    'imageio-ffmpeg==0.6.0'], { stream: true, env: uvEnv() })
  send('setup:step', { step: 'yue', status: 'done' })

  // 5. model weights
  send('setup:step', { step: 'models', status: 'run' })
  await new Promise((resolve, reject) => {
    const child = spawn(p.python, ['-u', p.setupModels], {
      env: { ...process.env, HF_HOME: p.hfHome, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true
    })
    let err = ''
    child.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((line) => {
      try {
        const event = JSON.parse(line)
        if (event.type === 'progress') {
          send('setup:progress', { step: 'models', got: event.bytes, total: MODEL_BYTES })
        } else if (event.type === 'error') {
          err += event.message
        }
      } catch { setupLog(line) }
    }))
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err.slice(-2000) || `모델 다운로드 실패 (${code})`)))
  })
  send('setup:step', { step: 'models', status: 'done' })

  // 6. prove the engine actually starts here — a missing Visual C++ runtime or a
  // broken install otherwise only shows up when the user asks for their first song.
  send('setup:step', { step: 'verify', status: 'run' })
  try {
    const report = await run(p.python, ['-c',
      'import torch, yue2, soundfile; print("cuda", torch.cuda.is_available())'])
    log('engine check', report)
    if (!/cuda True/.test(report)) {
      throw new Error('그래픽카드를 인식하지 못했습니다. NVIDIA 드라이버를 최신으로 올린 뒤 다시 시도해 주세요.')
    }
  } catch (error) {
    throw new Error(`AI 엔진 점검에 실패했습니다.\n\n${explainCrash(String(error.message).split('\n'))}`)
  }
  send('setup:step', { step: 'verify', status: 'done' })

  // 7. remember the bundled ffmpeg that came with imageio-ffmpeg
  let ffmpeg = null
  try {
    ffmpeg = await run(p.python, ['-c',
      'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'])
  } catch { /* export falls back to WAV */ }

  await writeSettings({ setupDone: true, gpu, ffmpeg, installedAt: new Date().toISOString() })
  return { ok: true, gpu }
}

function uvEnv () {
  return { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(paths().runtime, 'python'), UV_NO_PROGRESS: '1' }
}

// ── worker process ───────────────────────────────────────────────────────────
let stderrTail = []

// The worker dies before it can report anything of its own, so read its last words
// and turn the known ones into something the user can act on.
const CRASH_HINTS = [
  [/WinError 126|fbgemm|shm\.dll|libomp|DLL load failed/i,
    'AI 엔진에 필요한 Microsoft Visual C++ 재배포 패키지가 없습니다.\n' +
    'microsoft.com 에서 "Visual C++ 재배포 가능 패키지 x64"를 설치한 뒤 다시 시도해 주세요.'],
  [/No such file|not found in the local cache|local_files_only|snapshot/i,
    '음악 모델 파일을 찾지 못했습니다. 저장 위치가 바뀌었거나 파일이 지워졌을 수 있습니다.\n' +
    '프로그램을 지웠다가 다시 설치하면 모델을 새로 받습니다.'],
  [/out of memory|OutOfMemoryError/i,
    '그래픽카드 메모리가 모자랍니다.\n' +
    '게임·영상편집·다른 AI 프로그램을 닫고 다시 시도해 주세요. ' +
    '브라우저 탭이 많아도 그래픽카드 메모리를 씁니다.'],
  [/CUDA (error|driver)|nvidia-smi|no kernel image/i,
    '그래픽카드 드라이버 문제로 보입니다. NVIDIA 드라이버를 최신으로 올린 뒤 다시 시도해 주세요.\n' +
    '다른 프로그램(게임·영상편집·다른 AI 도구)이 그래픽카드 메모리를 쓰고 있다면 먼저 종료해 주세요.'],
  [/MemoryError|paging file|cannot allocate|std::bad_alloc/i,
    '메모리(RAM)가 부족합니다. 이 프로그램은 16GB 이상을 권장합니다.\n' +
    '다른 프로그램을 닫거나 윈도우 가상 메모리를 늘린 뒤 다시 시도해 주세요.'],
  [/ModuleNotFoundError|ImportError/i,
    'AI 엔진 설치가 온전하지 않습니다. 프로그램을 지웠다가 다시 설치해 주세요.\n' +
    '(제거할 때 "AI 실행환경도 삭제"를 선택하면 깨끗하게 다시 받습니다.)']
]

function explainCrash (lines) {
  const text = lines.join('\n')
  for (const [pattern, hint] of CRASH_HINTS) if (pattern.test(text)) return hint
  const last = lines.filter((line) => !/warning/i.test(line)).slice(-2).join('\n')
  return last
    ? `엔진이 남긴 메시지:\n${last}`
    : '원인을 알 수 없습니다. 설정 폴더의 app.log 파일을 보내주시면 확인해 드립니다.'
}

function startWorker () {
  if (worker) return worker
  stderrTail = []
  const p = paths()
  log('starting worker', p.python, p.worker)
  worker = spawn(p.python, ['-u', p.worker], {
    env: { ...process.env, HF_HOME: p.hfHome, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    windowsHide: true
  })
  let buffer = ''
  worker.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try { handleWorkerEvent(JSON.parse(line)) } catch { send('worker:log', line) }
    }
  })
  worker.stderr.on('data', (d) => {
    const text = String(d).trim()
    log('worker stderr', text)
    send('worker:log', text)
    // Keep the tail so a crash can say what actually went wrong instead of "code 1".
    stderrTail.push(...text.split(/\r?\n/).filter(Boolean))
    stderrTail = stderrTail.slice(-12)
  })
  worker.on('error', (error) => {
    log('worker spawn error', error.message)
    if (currentJob) send('job:error', { jobId: currentJob.jobId, message: `생성 엔진을 시작하지 못했습니다: ${error.message}` })
    currentJob = null
    worker = null
  })
  worker.on('close', (code) => {
    log('worker closed', code, stderrTail.join(' | '))
    if (currentJob) {
      send('job:error', {
        jobId: currentJob.jobId,
        message: `생성 엔진이 종료되었습니다 (code ${code}).\n\n${explainCrash(stderrTail)}`,
        detail: stderrTail.join('\n')
      })
      currentJob = null
    }
    worker = null
    sendQueue()
    pump() // a crash should not strand the songs waiting behind it
  })
  return worker
}

let lastProgressLog = 0

// A cancelled or failed job leaves a folder behind. Only empty shells are thrown
// away: a folder that already holds a plan or song tokens represents real minutes of
// GPU time and can be finished later, so the library offers to resume it instead.
// Which stages this folder already holds. Generation is long, so a song that died
// half way resumes from the last finished stage instead of starting over.
async function stagesDone (dir) {
  const done = []
  if (await exists(path.join(dir, 'plan', 'plan_manifest.json'))) done.push('plan')
  if (await exists(path.join(dir, 'semantic.npy'))) done.push('semantic')
  if (await exists(path.join(dir, 'latent.npy'))) done.push('synth')
  if (await hasAudio(dir)) done.push('decode')
  return done
}

async function resumable (dir) {
  const done = await stagesDone(dir)
  return done.includes('plan') || done.includes('semantic')
}

async function discardPartial (dir) {
  if (!dir || !dir.startsWith(await ensureSongsDir())) return
  if (await hasAudio(dir) || await resumable(dir)) return
  try {
    await fsp.rm(dir, { recursive: true, force: true })
    log('removed partial song', dir)
  } catch (error) {
    log('could not remove partial song', dir, error.message)
  }
}

// A waiting song's folder holds nothing but the meta.json placeholder carrying the
// title the user typed, so it looks exactly like an abandoned one. Sweeping it away
// lost that title — every song after the second came out named "song".
function reservedDirs () {
  const dirs = new Set()
  if (currentJob) dirs.add(currentJob.outDir)
  for (const item of queue) dirs.add(item.outDir)
  for (const item of failed) dirs.add(item.outDir)
  return dirs
}

async function sweepPartials () {
  try {
    const reserved = reservedDirs()
    for (const project of await listProjects()) {
      const dir = await projectDir(project.name)
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const full = path.join(dir, entry.name)
        if (reserved.has(full)) continue
        await discardPartial(full)
      }
    }
  } catch (error) {
    log('sweep skipped', error.message)
  }
}

async function handleWorkerEvent (event) {
  if (event.type === 'progress' && Date.now() - lastProgressLog > 30000) {
    lastProgressLog = Date.now()
    log('progress', event)
  } else if (event.type === 'stage' || event.type === 'notice') {
    log(event.type, event.stage || '', event.status || event.message || '')
  }
  if (event.type === 'done') {
    const song = await saveSong(event)
    currentJob = null
    send('job:done', song)
    sendQueue()
    pump()
  } else if (event.type === 'error') {
    const crashed = currentJob
    currentJob = null
    if (crashed) {
      await discardPartial(crashed.outDir)
      // A cancelled song was the user's own decision; a failed one stays for a retry.
      if (!event.cancelled) {
        failed.unshift({ ...crashed, message: String(event.message || '').split('\n')[0] })
        failed.splice(8)
      }
    }
    send('job:error', event)
    sendQueue()
    pump()
  } else {
    send('job:event', event)
  }
}

// ── library ──────────────────────────────────────────────────────────────────
// '#' and '%' are legal in file names but break the file:// URL the player loads,
// so they never make it into a folder name.
const slug = (text, max = 60) => (text || '').replace(/[\\/:*?"<>|#%\r\n]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim() || '무제'

// Windows paths stop at 260 characters (unless long paths are switched on), and the
// engine and ffmpeg fail past that — a long title made up from a lyric line, in a deep
// songs folder, was enough. So a title names its folder and file only in part: short
// by default, and shorter still when the folder it goes into is already deep.
const PATH_BUDGET = 240
const FOLDER_TITLE = 30 // "20260928…_<title>"
const FILE_TITLE = 40 // "<title>.wav"
const DEEPEST_FILE = Math.max('plan/plan_manifest.json'.length, FILE_TITLE + 4) // inside a song folder

// Cut to at most `room` characters, never below a readable few, and never ending in
// the dot or space Windows would silently drop.
function fitName (name, room, min = 6) {
  const cut = name.slice(0, Math.max(min, room)).replace(/[. ]+$/, '')
  return cut || name.slice(0, min)
}

// ── audio files ──────────────────────────────────────────────────────────────
// A finished song's audio is named after its title ("비 오는 밤.wav"). Songs from
// before 0.12 still hold audio.wav / song.mp3 (song2.mp3… from an early build), so
// nothing may assume a fixed name: the folder is searched instead.
const LEGACY_AUDIO = /^(audio|song\d*)$/i
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

function audioName (title, room = FILE_TITLE) {
  // Windows drops trailing dots and spaces from file names, and refuses device names.
  const name = fitName(slug(title, FILE_TITLE), room) || '무제'
  return WINDOWS_RESERVED.test(name) ? `${name}_` : name
}

async function audioFiles (dir) {
  const found = { wav: null, mp3: null }
  let entries = []
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).slice(1).toLowerCase()
    if ((ext === 'wav' || ext === 'mp3') && !found[ext]) found[ext] = path.join(dir, entry.name)
  }
  return found
}

async function hasAudio (dir) {
  const { wav, mp3 } = await audioFiles(dir)
  return Boolean(wav || mp3)
}

// Give the song's audio its title as file name. Windows will not rename a file the
// player still holds open; that leaves the old name in place and says so.
async function nameAudio (dir, title) {
  // What is left of the path budget once the folder is counted, less ".wav".
  const base = audioName(title, PATH_BUDGET - dir.length - 1 - 4)
  const files = await audioFiles(dir)
  const named = { wav: files.wav, mp3: files.mp3, failed: false }
  for (const ext of ['wav', 'mp3']) {
    const from = files[ext]
    if (!from) continue
    const to = path.join(dir, `${base}.${ext}`)
    if (from === to) continue
    // Never overwrite a different file that already has the name (case-only changes
    // are the same file on Windows and are fine).
    if (from.toLowerCase() !== to.toLowerCase() && await exists(to)) continue
    try {
      await fsp.rename(from, to)
      named[ext] = to
    } catch (error) {
      named.failed = true
      log('could not rename audio', from, error.message)
    }
  }
  return named
}

// meta.json is hidden once a song is finished, and Windows refuses to overwrite a
// hidden file (EPERM) — which silently broke renaming and rating finished songs.
// Rewriting it in place keeps the attribute and works either way.
// Returns true when the file had to be created.
async function writeJsonInPlace (file, data) {
  const text = JSON.stringify(data, null, 1)
  let handle
  try {
    handle = await fsp.open(file, 'r+')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fsp.writeFile(file, text, 'utf8')
    return true
  }
  try {
    await handle.truncate(0)
    await handle.write(text, 0, 'utf8')
  } finally {
    await handle.close()
  }
  return false
}

const writeMeta = (dir, meta) => writeJsonInPlace(path.join(dir, 'meta.json'), meta)

// ── song order ──
// The order songs are dragged into is kept per project, in a hidden file inside the
// project folder, so it travels with the library when it is moved or copied.
const ORDER_FILE = '.ssokmusic-order.json'

async function readOrder (dir) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(dir, ORDER_FILE), 'utf8'))
    return Array.isArray(data.folders) ? data.folders.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

async function writeOrder (dir, folders) {
  const file = path.join(dir, ORDER_FILE)
  if (await writeJsonInPlace(file, { folders })) {
    await new Promise((resolve) => execFile('attrib', ['+h', file], () => resolve()))
  }
}
// What startGeneration wrote into the folder when the song was queued. Read back from
// the job itself so a lost or unreadable meta.json cannot cost the song its title.
function jobPlaceholder (dir) {
  const item = currentJob && currentJob.outDir === dir
    ? currentJob
    : queue.find((entry) => entry.outDir === dir)
  if (!item) return {}
  return { title: item.title, instrumental: Boolean(item.job && item.job.instrumental),
    targetSeconds: (item.job && item.job.targetSeconds) || null,
    parts: (item.job && item.job.parts) || null }
}

async function saveSong (event) {
  // A score-only draft has no audio yet: keep its stage files so rendering it later
  // skips the planning it already did.
  if (event.scoreOnly) {
    const dir = currentJob ? currentJob.outDir : null
    if (!dir) return { ...event.meta, scoreOnly: true }
    let placeholder = jobPlaceholder(dir)
    try {
      placeholder = { ...placeholder,
        ...JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) }
    } catch {}
    const meta = { ...event.meta, dir, scoreOnly: true, status: 'score',
      // The worker does not echo these back, but reuse and re-render need them.
      instrumental: Boolean(placeholder.instrumental),
      parts: placeholder.parts || null,
      title: placeholder.title || event.meta.id }
    await writeMeta(dir, meta)
    return meta
  }
  const dir = path.dirname(event.audio)
  // The worker rewrites meta.json without the title the user typed, so merge the
  // placeholder this process wrote when the job started back on top of it. Should the
  // file be missing, the running job still holds everything the placeholder carried.
  let placeholder = jobPlaceholder(dir)
  try {
    placeholder = { ...placeholder,
      ...JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) }
  } catch {}
  const title = placeholder.title || event.meta.title || event.meta.id
  await autoConvert(dir)
  // The worker always writes audio.wav; the file takes the song's title from here on.
  const named = await nameAudio(dir, title)
  const audio = named.wav || named.mp3 || event.audio
  const meta = { ...event.meta, dir, audio, mp3: named.mp3 || null, status: 'done',
    audioUrl: pathToFileURL(audio).href,
    // Carried from the request: the worker's result does not repeat them.
    instrumental: Boolean(placeholder.instrumental),
    targetSeconds: placeholder.targetSeconds || null,
    parts: placeholder.parts || null,
    appVersion: app.getVersion(),
    title }
  await writeMeta(dir, meta)
  await tidySong(dir)
  return meta
}

// 48kHz 24-bit WAV runs ~17MB per minute, so a library fills a disk quickly. Encoding
// to 320kbps MP3 keeps roughly a tenth of that and still sounds transparent.
async function encodeMp3 (dir) {
  const settings = await readSettings()
  const { wav } = await audioFiles(dir)
  if (!settings.ffmpeg || !wav) return null
  const mp3 = wav.replace(/\.wav$/i, '.mp3')
  await new Promise((resolve, reject) => execFile(settings.ffmpeg,
    ['-y', '-i', wav, '-b:a', '320k', mp3],
    (error) => error ? reject(error) : resolve()))
  return mp3
}

// Once a song is finished, only the audio and meta.json matter. The stage files exist
// so an interrupted song can be resumed; keeping them afterwards just clutters the
// folder (latent.npy alone is ~2MB). meta.json is hidden so the folder shows music only.
const LEFTOVERS = ['semantic.npy', 'latent.npy', 'result.json']

async function folderSize (dir) {
  let total = 0
  for (const entry of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    try { total += (await fsp.stat(path.join(entry.parentPath || entry.path, entry.name))).size } catch {}
  }
  return total
}

async function tidySong (dir) {
  try {
    // The score is the one stage file worth keeping: it is tiny, and it is what the
    // score editor reads and re-renders from.
    const score = path.join(dir, 'plan', 'score.abc')
    if (await exists(score) && !await exists(path.join(dir, 'score.abc'))) {
      await fsp.copyFile(score, path.join(dir, 'score.abc'))
    }
    for (const name of LEFTOVERS) await fsp.rm(path.join(dir, name), { force: true })
    await fsp.rm(path.join(dir, 'plan'), { recursive: true, force: true })
    const meta = path.join(dir, 'meta.json')
    if (await exists(meta)) {
      await new Promise((resolve) => execFile('attrib', ['+h', meta], () => resolve()))
    }
  } catch (error) {
    log('tidy skipped', dir, error.message)
  }
}

async function autoConvert (dir) {
  const settings = await readSettings()
  if (!settings.autoMp3) return {}
  try {
    const { wav } = await audioFiles(dir)
    const mp3 = await encodeMp3(dir)
    if (!mp3) return {}
    if (settings.dropWav) {
      await fsp.rm(wav, { force: true })
      // The latents are only needed to re-decode the same take; drop them too.
      await fsp.rm(path.join(dir, 'latent.npy'), { force: true })
    }
    log('mp3 saved', mp3, settings.dropWav ? '(wav removed)' : '')
    return { mp3 }
  } catch (error) {
    log('mp3 conversion failed', error.message)
    send('job:event', { type: 'notice', message: `MP3 변환에 실패했습니다: ${error.message}` })
    return {}
  }
}

// Folder names are "<stamp>_<title>"; the stamp is 14 digits.
const titleFromFolder = (name) => name.replace(/^\d{14}_/, '').trim() || '무제'

async function listSongs () {
  await migrateLooseSongs()
  const dir = await projectDir()
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const reserved = reservedDirs()
  const songs = []
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const songDir = path.join(dir, entry.name)
    const metaFile = path.join(songDir, 'meta.json')
    if (!await exists(metaFile)) continue
    let files = await audioFiles(songDir)
    if (!files.wav && !files.mp3 && !await resumable(songDir)) continue
    try {
      const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'))
      // Songs made before 0.11 could lose their title to the partial-folder sweep and
      // fall back to the worker's internal id. The folder name still has it.
      const title = meta.title && meta.title !== 'song' ? meta.title : titleFromFolder(entry.name)
      // Songs from before 0.12 still carry audio.wav / song.mp3; they take their title
      // the first time they are listed. A song being made is left alone.
      const current = files.wav || files.mp3
      if (current && !reserved.has(songDir) &&
          LEGACY_AUDIO.test(path.basename(current, path.extname(current)))) {
        await nameAudio(songDir, title)
        files = await audioFiles(songDir)
      }
      const audio = files.wav || files.mp3
      // Build the URL here: a path with '#', spaces or Korean text is not a valid
      // file:// URL until it is encoded, and the <audio> tag needs a URL.
      const score = await exists(path.join(songDir, 'score.abc')) ||
        await exists(path.join(songDir, 'plan', 'score.abc'))
      songs.push({ ...meta, dir: songDir, audio, folder: entry.name, unfinished: !audio, score,
        title,
        stages: audio ? null : await stagesDone(songDir),
        format: audio && audio === files.mp3 ? 'mp3' : 'wav',
        audioUrl: audio ? pathToFileURL(audio).href : null })
    } catch { /* skip unreadable entry */ }
  }
  // Songs the user has arranged keep their place; any made since then go on top,
  // newest first, the way the list has always shown new songs.
  const order = await readOrder(dir)
  const rank = new Map(order.map((folder, index) => [folder, index]))
  for (const song of songs) song.position = rank.has(song.folder) ? rank.get(song.folder) : null
  return songs.sort((a, b) => {
    if (a.position === null && b.position === null) return String(b.createdAt).localeCompare(String(a.createdAt))
    if (a.position === null) return -1
    if (b.position === null) return 1
    return a.position - b.position
  })
}

// ── ipc ──────────────────────────────────────────────────────────────────────
ipcMain.handle('app:state', async () => {
  const settings = await readSettings()
  const p = paths()
  const ready = Boolean(settings.setupDone) && await exists(p.python)
  // The folder button opens the project being worked on, not the library root.
  const dir = ready ? await projectDir().catch(() => null) : null
  return { ready, gpu: settings.gpu || await detectGpu(), songsDir: dir, version: app.getVersion() }
})

ipcMain.handle('setup:check', () => preflight())

ipcMain.handle('setup:location', async () => {
  const p = paths()
  return { dataDir: p.dataDir, models: p.hfHome, freeGb: await freeSpaceGb(p.dataDir), chosen: Boolean(settingsSync().dataDir) }
})

// Before anything is downloaded the whole 11GB can be pointed at another drive.
ipcMain.handle('setup:pick-location', async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: 'AI 실행환경과 모델을 저장할 폴더',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '이 폴더 사용'
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const chosen = path.join(picked.filePaths[0], 'ssokMusic')
  const freeGb = await freeSpaceGb(chosen)
  if (freeGb !== null && freeGb < NEEDED_GB) {
    return { ok: false, message: `${path.parse(chosen).root} 여유 공간이 ${freeGb}GB입니다. ${NEEDED_GB}GB가 필요합니다.` }
  }
  try {
    await fsp.mkdir(chosen, { recursive: true })
  } catch (error) {
    return { ok: false, message: `그 폴더를 쓸 수 없습니다: ${error.message}` }
  }
  // hfHome follows dataDir unless it was pinned by hand.
  await writeSettings({ dataDir: chosen, hfHome: path.join(chosen, 'models') })
  log('data folder', chosen, `${freeGb}GB free`)
  return { ok: true, dataDir: chosen, freeGb }
})

ipcMain.handle('setup:run', async () => {
  try { return await runSetup() } catch (error) { return { ok: false, message: error.message } }
})

ipcMain.handle('projects:list', async () => ({
  current: projectName(), projects: await listProjects()
}))

ipcMain.handle('projects:select', async (_e, name) => {
  await projectDir(name)
  await writeSettings({ project: name })
  log('project', name)
  return { ok: true, current: name }
})

ipcMain.handle('projects:create', async (_e, name) => {
  const clean = slug(name)
  const existing = await listProjects()
  if (existing.some((p) => p.name === clean)) return { ok: false, message: '같은 이름의 프로젝트가 있습니다.' }
  await projectDir(clean)
  await writeSettings({ project: clean })
  log('project created', clean)
  return { ok: true, current: clean }
})

ipcMain.handle('projects:rename', async (_e, { from, to }) => {
  const clean = slug(to)
  const root = await ensureSongsDir()
  if (clean === from) return { ok: true, current: clean }
  if (await exists(path.join(root, clean))) return { ok: false, message: '같은 이름의 프로젝트가 있습니다.' }
  try {
    await fsp.rename(path.join(root, from), path.join(root, clean))
  } catch (error) {
    return { ok: false, message: `이름을 바꾸지 못했습니다: ${error.message}` }
  }
  if (projectName() === from) await writeSettings({ project: clean })
  return { ok: true, current: projectName() }
})

ipcMain.handle('songs:list', async () => {
  await sweepPartials()
  return listSongs()
})

ipcMain.handle('song:generate', async (_e, payload) => {
  try {
    return await startGeneration(payload)
  } catch (error) {
    currentJob = null
    log('generate failed', error.stack || error.message)
    return { ok: false, message: `생성을 시작하지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('ui:log', (_e, text) => { log('renderer', text); return { ok: true } })

function queueState () {
  return {
    current: currentJob ? { jobId: currentJob.jobId, title: currentJob.title } : null,
    waiting: queue.map(({ jobId, title }) => ({ jobId, title })),
    failed: failed.map(({ jobId, title, message }) => ({ jobId, title, message })),
    paused
  }
}

const sendQueue = () => { saveQueue(); send('queue:update', queueState()) }

// The queue survives a restart: a batch left running overnight picks up where it
// stopped instead of vanishing with the window.
const queueFile = () => path.join(userData(), 'queue.json')

function saveQueue () {
  const items = queue.map(({ jobId, outDir, title, job }) => ({ jobId, outDir, title, job }))
  // The song being made goes back at the head, keeping its folder so its finished
  // stages are reused rather than regenerated.
  if (currentJob) {
    items.unshift({ ...currentJob, job: { ...currentJob.job, outDir: currentJob.outDir } })
  }
  try {
    fs.writeFileSync(queueFile(), JSON.stringify({ paused, items }, null, 1), 'utf8')
  } catch (error) {
    log('queue not saved', error.message)
  }
}

async function restoreQueue () {
  let saved = { items: [] }
  try {
    const text = await fsp.readFile(queueFile(), 'utf8')
    saved = JSON.parse(text.replace(/^﻿/, '')) // a hand-edited file may carry a BOM
  } catch (error) {
    if (error.code !== 'ENOENT') log('saved queue unreadable', error.message)
    return
  }
  for (const item of saved.items || []) {
    // Skip anything already finished or whose folder is gone.
    if (!item.outDir || await hasAudio(item.outDir)) continue
    queue.push({ ...item, job: { ...item.job, outDir: item.outDir } })
  }
  paused = Boolean(saved.paused)
  if (queue.length) log('queue restored', queue.length, paused ? '(일시정지 상태)' : '')
  sendQueue()
  pump()
}

// Hand the next waiting song to the worker. Called whenever the queue changes or a
// song finishes, so a full queue drains without the user watching.
function pump () {
  if (currentJob || !queue.length || paused) return
  currentJob = queue.shift()
  startWorker()
  worker.stdin.write(JSON.stringify(currentJob.job) + '\n')
  log('job started', { jobId: currentJob.jobId, title: currentJob.title })
  send('job:started', { jobId: currentJob.jobId, title: currentJob.title })
  sendQueue()
}

// The prompt builder's fields, kept with the song so a reuse or cover restores them.
// Only known keys with plain values are stored.
function cleanParts (parts) {
  if (!parts || typeof parts !== 'object') return null
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
  return {
    genre: text(parts.genre, 2000),
    instruments: Array.isArray(parts.instruments)
      ? parts.instruments.filter((item) => typeof item === 'string').slice(0, 3).map((item) => item.slice(0, 60))
      : [],
    bpm: Number(parts.bpm) > 0 ? Math.round(Number(parts.bpm)) : null,
    strict: Boolean(parts.strict),
    strong: Boolean(parts.strong),
    structure: text(parts.structure, 20),
    instrumental: Boolean(parts.instrumental)
  }
}

// A new song's folder: "<stamp>_<title>", the title cut so that the deepest file the
// folder will ever hold — the engine's plan manifest, or the song's audio — still fits.
async function songFolder (stamp, title) {
  const parent = await projectDir()
  const room = PATH_BUDGET - parent.length - 1 - (stamp.length + 1) - 1 - DEEPEST_FILE
  const full = path.join(parent, `${stamp}_${fitName(slug(title, FOLDER_TITLE), room)}`)
  if (full.length + 1 + DEEPEST_FILE > 260) {
    log('song path is long even with a short name', { length: full.length + 1 + DEEPEST_FILE, parent })
  }
  return full
}

async function startGeneration (payload) {
  const p = paths()
  log('generate request', { title: payload.title, seed: payload.seed, python: p.python })
  if (!await exists(p.python)) {
    return { ok: false, message: '실행 환경을 찾지 못했습니다. 앱을 다시 설치해주세요.' }
  }
  // Resuming reuses the existing folder: the worker picks up whatever stage files are
  // already there instead of regenerating them.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const outDir = payload.outDir || await songFolder(stamp, payload.title)
  await fsp.mkdir(outDir, { recursive: true })
  const jobId = `${Date.now()}`
  const job = {
    cmd: 'generate',
    jobId,
    outDir,
    id: 'song',
    style: payload.style,
    lyrics: payload.lyrics,
    instrumental: Boolean(payload.instrumental),
    // Expert overrides; the worker clamps them to what YuE2 accepts.
    advanced: payload.advanced && Object.keys(payload.advanced).length ? payload.advanced : null,
    cot: payload.cot || 'full',
    abc: payload.abc || null,
    mode: payload.mode === 'plan' ? 'plan' : 'song',
    targetSeconds: payload.targetSeconds || null,
    parts: cleanParts(payload.parts),
    // Fix the seed here rather than in the worker, so meta.json records it and a
    // resumed job keeps the seed its saved stages were generated with.
    seed: payload.seed === '' || payload.seed == null
      ? Math.floor(Math.random() * 2 ** 31)
      : Number(payload.seed)
  }
  const title = payload.title || '무제'
  await writeMeta(outDir, { title, ...job, status: 'queued' })
  queue.push({ jobId, outDir, title, job })
  log('job queued', { jobId, title, waiting: queue.length })
  sendQueue()
  pump()
  return { ok: true, jobId, position: currentJob && currentJob.jobId === jobId ? 0 : queue.length }
}

// ── score (ABC) ──────────────────────────────────────────────────────────────
ipcMain.handle('song:score', async (_e, dir) => {
  for (const file of [path.join(dir, 'score.abc'), path.join(dir, 'plan', 'score.abc')]) {
    if (await exists(file)) return { ok: true, abc: await fsp.readFile(file, 'utf8') }
  }
  return { ok: false, message: '이 곡에는 악보가 없습니다.' }
})

// A score from outside — typed, pasted, opened from a file or converted from MIDI —
// is checked by YuE2's own validator (python/abc_tools.py) before it is used. It runs
// in a short-lived process of its own, so a busy generation worker never delays it.
ipcMain.handle('score:check', async (_e, text) => {
  const p = paths()
  if (!await exists(p.python)) return { ok: false, error: '실행 환경이 없어 악보를 검사할 수 없습니다.' }
  const script = unpacked(path.join(__dirname, '..', 'python', 'abc_check.py'))
  return new Promise((resolve) => {
    const child = execFile(p.python, [script],
      { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } },
      (error, stdout, stderr) => {
        try {
          resolve(JSON.parse(String(stdout).trim().split('\n').pop()))
        } catch {
          log('score check failed', error ? error.message : '', String(stderr).slice(-400))
          resolve({ ok: false, error: '악보 검사를 실행하지 못했습니다.' })
        }
      })
    child.stdin.end(String(text || ''), 'utf8')
  })
})

// The MIDI last opened, kept so changing the chosen tracks re-converts it without
// asking for the file again.
let openedMidi = null

function convertMidi (choice) {
  const result = midiTools.midiToAbc(openedMidi.midi, choice)
  return { kind: 'midi', name: openedMidi.name, parts: midiTools.describeParts(openedMidi.parts), choice, result }
}

ipcMain.handle('score:open', async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: '악보 불러오기 (ABC 또는 MIDI)',
    properties: ['openFile'],
    filters: [
      { name: '악보·MIDI', extensions: ['abc', 'txt', 'mid', 'midi'] },
      { name: 'ABC 악보', extensions: ['abc', 'txt'] },
      { name: 'MIDI', extensions: ['mid', 'midi'] }
    ]
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const file = picked.filePaths[0]
  const name = path.basename(file, path.extname(file))
  try {
    if ((await fsp.stat(file)).size > 5 * 1024 * 1024) return { ok: false, message: '5MB가 넘는 파일은 불러올 수 없습니다.' }
    const data = await fsp.readFile(file)
    if (/\.midi?$/i.test(file)) {
      const midi = midiTools.parseMidi(data)
      const parts = midiTools.partsOf(midi)
      if (!parts.some((part) => !part.drums && part.count)) {
        return { ok: false, message: '이 MIDI에는 멜로디로 쓸 음표가 없습니다 (드럼만 있거나 비어 있습니다).' }
      }
      openedMidi = { name, midi, parts }
      log('midi opened', file, { parts: parts.length })
      return { ok: true, ...convertMidi({ ...midiTools.suggestParts(parts), chords: true }) }
    }
    return { ok: true, kind: 'abc', name, text: data.toString('utf8').replace(/^﻿/, '') }
  } catch (error) {
    log('score open failed', file, error.message)
    return { ok: false, message: `불러오지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('score:convert', (_e, choice) => {
  if (!openedMidi) return { ok: false, message: 'MIDI 파일을 다시 열어주세요.' }
  try {
    return { ok: true, ...convertMidi({ vocal: choice.vocal || '', ins: choice.ins || '', chords: Boolean(choice.chords) }) }
  } catch (error) {
    return { ok: false, message: error.message }
  }
})

// Render a song from a score the user edited. It becomes its own song, so the take
// it came from stays untouched.
ipcMain.handle('song:render', async (_e, { dir, abc, title }) => {
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'))
    if (!meta.lyrics || !meta.style) return { ok: false, message: '이 곡의 가사·스타일 정보가 없습니다.' }
    return await startGeneration({
      ...meta,
      title: title || `${meta.title || '무제'} (악보 수정)`,
      abc,
      // A supplied score needs full or melody mode, and the instruction has to match
      // it: after "코드 빼기" there are no chords left to announce.
      cot: /"[^"\n]+"/.test(abc.split('\n').filter((line) => !line.startsWith('V:')).join('\n')) ? 'full' : 'melody',
      outDir: null
    })
  } catch (error) {
    log('render from score failed', error.stack || error.message)
    return { ok: false, message: `악보로 만들지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('song:resume', async (_e, dir) => {
  try {
    if (!dir.startsWith(await ensureSongsDir())) return { ok: false, message: '알 수 없는 폴더입니다.' }
    const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'))
    if (!meta.lyrics || !meta.style) return { ok: false, message: '이 곡의 정보가 남아 있지 않아 이어서 만들 수 없습니다.' }
    return await startGeneration({ ...meta, outDir: dir })
  } catch (error) {
    log('resume failed', error.stack || error.message)
    return { ok: false, message: `이어서 만들지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('song:cancel', () => {
  // Named by job, so a cancel sent while the worker is still starting up is kept
  // until that job comes up instead of being lost.
  if (worker && currentJob) {
    worker.stdin.write(JSON.stringify({ cmd: 'cancel', jobId: currentJob.jobId }) + '\n')
    log('cancel requested', currentJob.jobId)
  }
  return { ok: true }
})

ipcMain.handle('queue:list', () => queueState())

ipcMain.handle('queue:remove', async (_e, jobId) => {
  const index = queue.findIndex((item) => item.jobId === jobId)
  if (index < 0) return { ok: false, message: '이미 시작했거나 없는 곡입니다.' }
  const [removed] = queue.splice(index, 1)
  await discardPartial(removed.outDir)
  log('queue removed', removed.title)
  sendQueue()
  return { ok: true }
})

// A drag hands over the whole new order. The queue may have moved on meanwhile — the
// head started, a song was added — so it is sorted by the order given rather than
// replaced; anything the order does not mention keeps its place at the end.
ipcMain.handle('queue:reorder', (_e, ids) => {
  if (!Array.isArray(ids)) return { ok: false }
  const rank = new Map(ids.map((id, index) => [String(id), index]))
  const at = (item) => rank.has(item.jobId) ? rank.get(item.jobId) : Infinity
  queue.sort((a, b) => at(a) - at(b))
  log('queue reordered', queue.map((item) => item.title))
  sendQueue()
  return { ok: true }
})

// Music made elsewhere, brought into the current project as finished songs, so it can
// be played, put in albums and in videos like any song made here. WAV and MP3 are
// copied as they are; other formats are converted to WAV, the one lossless format the
// library keeps. The originals are left where they were.
const IMPORT_TYPES = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff', 'aif']

const localStamp = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

ipcMain.handle('songs:import', async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: '이 프로젝트로 불러올 음악 파일',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '음악 파일', extensions: IMPORT_TYPES }]
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const settings = await readSettings()
  const failures = []
  let count = 0
  const started = Date.now()
  for (const [index, file] of picked.filePaths.entries()) {
    const ext = path.extname(file).slice(1).toLowerCase()
    const title = path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').trim() || '무제'
    let dir = null
    try {
      if (!IMPORT_TYPES.includes(ext)) throw new Error('지원하지 않는 형식입니다')
      // Songs sort by creation time; spacing the stamps keeps the chosen order.
      const when = new Date(started + index * 1000)
      const stamp = when.toISOString().replace(/[-:T]/g, '').slice(0, 14)
      dir = await songFolder(stamp, title)
      for (let n = 2; await exists(dir); n++) dir = await songFolder(stamp, `${title} ${n}`)
      await fsp.mkdir(dir, { recursive: true })
      const base = audioName(title, PATH_BUDGET - dir.length - 1 - 4)
      let audio
      if (ext === 'wav' || ext === 'mp3') {
        audio = path.join(dir, `${base}.${ext}`)
        await fsp.copyFile(file, audio)
      } else {
        if (!settings.ffmpeg) throw new Error('변환기를 찾지 못했습니다')
        audio = path.join(dir, `${base}.wav`)
        await convert(settings.ffmpeg, file, audio, ['-vn', '-c:a', 'pcm_s16le'])
      }
      const seconds = settings.ffmpeg ? await videoTools.probeSeconds(settings.ffmpeg, audio) : null
      await writeMeta(dir, {
        id: 'imported', title, imported: true, source: path.basename(file),
        status: 'done', seconds: seconds ? Math.round(seconds * 10) / 10 : null,
        style: '', lyrics: '', instrumental: false, createdAt: localStamp(when),
        appVersion: app.getVersion()
      })
      await tidySong(dir)
      count += 1
    } catch (error) {
      failures.push(`${path.basename(file)}: ${error.message}`)
      if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  log('songs imported', { count, failures })
  return { ok: true, count, failures }
})

ipcMain.handle('songs:reorder', async (_e, folders) => {
  if (!Array.isArray(folders)) return { ok: false, message: '순서를 저장하지 못했습니다.' }
  try {
    const dir = await projectDir()
    // Only folders that are songs of this project; a stale name would just sit there.
    const present = new Set((await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    await writeOrder(dir, folders.filter((folder) => typeof folder === 'string' && present.has(folder)))
    return { ok: true }
  } catch (error) {
    log('song order not saved', error.message)
    return { ok: false, message: `순서를 저장하지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('queue:move', (_e, { jobId, delta }) => {
  const index = queue.findIndex((item) => item.jobId === jobId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= queue.length) return { ok: false }
  queue.splice(target, 0, ...queue.splice(index, 1))
  sendQueue()
  return { ok: true }
})

// Pausing lets the current song finish; it only stops the next one from starting.
ipcMain.handle('queue:pause', (_e, value) => {
  paused = Boolean(value)
  log('queue', paused ? 'paused' : 'resumed')
  sendQueue()
  if (!paused) pump()
  return { ok: true, paused }
})

ipcMain.handle('queue:retry', async (_e, jobId) => {
  const index = failed.findIndex((item) => item.jobId === jobId)
  if (index < 0) return { ok: false, message: '다시 시도할 곡을 찾지 못했습니다.' }
  const [item] = failed.splice(index, 1)
  sendQueue()
  // Pick up where it stopped when the stage files survived; otherwise start clean.
  const keep = item.outDir && await exists(item.outDir) && await resumable(item.outDir)
  log('retry', item.title, keep ? '(이어서)' : '(처음부터)')
  return startGeneration({ ...item.job, title: item.title, outDir: keep ? item.outDir : null })
})

ipcMain.handle('queue:dismiss', (_e, jobId) => {
  const index = failed.findIndex((item) => item.jobId === jobId)
  if (index >= 0) failed.splice(index, 1)
  sendQueue()
  return { ok: true }
})

ipcMain.handle('queue:clear', async () => {
  const removed = queue.splice(0, queue.length)
  for (const item of removed) await discardPartial(item.outDir)
  log('queue cleared', removed.length)
  sendQueue()
  return { ok: true, removed: removed.length }
})

ipcMain.handle('song:delete', async (_e, dir) => {
  if (!dir || !dir.startsWith(await ensureSongsDir())) return { ok: false, message: '알 수 없는 폴더입니다.' }
  // A song being made or waiting to be made is cancelled from its card, not deleted.
  if ((currentJob && currentJob.outDir === dir) || queue.some((item) => item.outDir === dir)) {
    return { ok: false, message: '만들고 있거나 대기 중인 곡입니다. 먼저 취소한 뒤에 삭제해주세요.' }
  }
  try {
    await shell.trashItem(dir)
    log('song deleted', dir)
    // A failed song offered for retry goes with its folder.
    const before = failed.length
    failed.splice(0, failed.length, ...failed.filter((item) => item.outDir !== dir))
    if (failed.length !== before) sendQueue()
    return { ok: true }
  } catch (error) {
    log('delete failed', dir, error.message)
    return { ok: false, message: `삭제하지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('song:rename', async (_e, { dir, title }) => {
  try {
    const metaFile = path.join(dir, 'meta.json')
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'))
    meta.title = title
    // The audio file carries the title too. The renderer lets go of the file before
    // asking; if Windows still holds it, the title is saved and the file keeps its name.
    const named = await nameAudio(dir, title)
    const audio = named.wav || named.mp3
    if (audio) {
      meta.audio = audio
      meta.mp3 = named.mp3 || null
      meta.audioUrl = pathToFileURL(audio).href
    }
    await writeMeta(dir, meta)
    return { ok: true, fileRenamed: !named.failed }
  } catch (error) {
    log('rename failed', dir, error.message)
    return { ok: false, message: `이름을 바꾸지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('song:reveal', (_e, dir) => { shell.openPath(dir); return { ok: true } })

const convert = (ffmpeg, from, to, args) => new Promise((resolve, reject) =>
  execFile(ffmpeg, ['-y', '-i', from, ...args, to],
    (error) => error ? reject(error) : resolve()))

ipcMain.handle('song:export', async (_e, { dir, title, format = 'mp3' }) => {
  const settings = await readSettings()
  const { wav, mp3 } = await audioFiles(dir)
  const target = await dialog.showSaveDialog(win, {
    title: `${format.toUpperCase()}로 내보내기`,
    defaultPath: path.join(await exportBase(), `${audioName(title)}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  })
  if (target.canceled) return { ok: false, canceled: true }
  if (!await canWrite(path.dirname(target.filePath))) return { ok: false, blocked: true, message: BLOCKED_FOLDER }
  try {
    // Copy when the song is already in the wanted format; convert otherwise. Note a
    // WAV made from an auto-converted song comes from the MP3, so it cannot regain
    // what the MP3 dropped.
    const source = format === 'wav' ? (wav || mp3) : (mp3 || wav)
    if (!source) return { ok: false, message: '내보낼 음원 파일이 없습니다.' }
    if (path.extname(source).slice(1).toLowerCase() === format) {
      await fsp.copyFile(source, target.filePath)
    } else {
      if (!settings.ffmpeg) return { ok: false, message: '변환기를 찾지 못했습니다.' }
      await convert(settings.ffmpeg, source, target.filePath,
        format === 'mp3' ? ['-b:a', '320k'] : ['-c:a', 'pcm_s24le'])
    }
    log('exported', format, target.filePath)
    await rememberExportDir(path.dirname(target.filePath))
    return { ok: true, path: target.filePath, fromLossy: format === 'wav' && source === mp3 }
  } catch (error) {
    log('export failed', error.message)
    return { ok: false, message: `저장하지 못했습니다: ${error.message}` }
  }
})

// ── album export ─────────────────────────────────────────────────────────────
// A project is an album: its finished songs go out together into one folder, named
// "01. 제목.mp3" in the order they were made, each tagged with title, album and track
// number so music players and distributors list them properly.
ipcMain.handle('album:export', async (_e, { format = 'mp3', minRating = 0, numbered = true } = {}) => {
  if (!['mp3', 'wav'].includes(format)) return { ok: false, message: '알 수 없는 형식입니다.' }
  const album = projectName()
  // Once the songs have been dragged into an order, the list is the running order,
  // top to bottom. Until then tracks go in the order they were made.
  const listed = await listSongs()
  const arranged = listed.some((song) => song.position !== null)
  const songs = listed
    .filter((song) => song.audio && !song.unfinished && (song.rating || 0) >= minRating)
  if (!arranged) songs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  if (!songs.length) return { ok: false, message: '내보낼 완성곡이 없습니다.' }
  const picked = await dialog.showOpenDialog(win, {
    title: `"${album}" 앨범을 저장할 곳`,
    defaultPath: await exportBase(),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '여기에 내보내기'
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  if (!await canWrite(picked.filePaths[0])) return { ok: false, blocked: true, message: BLOCKED_FOLDER }
  // Always a folder of its own, never loose files in whatever folder was picked.
  const base = path.join(picked.filePaths[0], audioName(album))
  let target = base
  for (let n = 2; await exists(target); n++) target = `${base} (${n})`
  const settings = await readSettings()
  const failures = []
  let lossy = 0
  try {
    await fsp.mkdir(target, { recursive: true })
    const width = Math.max(2, String(songs.length).length)
    for (const [index, song] of songs.entries()) {
      const track = index + 1
      send('album:progress', { done: index, total: songs.length, title: song.title })
      try {
        const { wav, mp3 } = await audioFiles(song.dir)
        const source = format === 'wav' ? (wav || mp3) : (mp3 || wav)
        if (!source) throw new Error('음원 파일이 없습니다')
        if (format === 'wav' && source === mp3) lossy += 1
        const name = `${numbered ? `${String(track).padStart(width, '0')}. ` : ''}${audioName(song.title)}`
        // Takes of the same song share a title; unnumbered, one would overwrite another.
        let file = path.join(target, `${name}.${format}`)
        for (let n = 2; await exists(file); n++) file = path.join(target, `${name} (${n}).${format}`)
        const same = path.extname(source).slice(1).toLowerCase() === format
        if (settings.ffmpeg) {
          // Through ffmpeg even when nothing needs converting, to write the tags.
          const codec = same ? ['-c', 'copy'] : format === 'mp3' ? ['-b:a', '320k'] : ['-c:a', 'pcm_s24le']
          const tags = ['-metadata', `title=${song.title}`, '-metadata', `album=${album}`,
            '-metadata', `track=${track}/${songs.length}`]
          await convert(settings.ffmpeg, source, file,
            [...codec, ...tags, ...(format === 'mp3' ? ['-id3v2_version', '3'] : [])])
        } else if (same) {
          await fsp.copyFile(source, file)
        } else {
          throw new Error('변환기를 찾지 못했습니다')
        }
      } catch (error) {
        failures.push(`${song.title}: ${error.message}`)
      }
    }
  } catch (error) {
    log('album export failed', error.message)
    return { ok: false, message: `내보내지 못했습니다: ${error.message}` }
  }
  send('album:progress', { done: songs.length, total: songs.length })
  log('album exported', { album, format, target, count: songs.length, failures })
  await rememberExportDir(picked.filePaths[0])
  return { ok: true, path: target, count: songs.length - failures.length, failures, lossy }
})

// One-shot cleanup for libraries recorded before the option existed.
ipcMain.handle('songs:compact', async () => {
  if (currentJob) return { ok: false, message: '곡을 만드는 중에는 정리할 수 없습니다.' }
  let converted = 0
  let savedBytes = 0
  const failures = []
  for (const song of await listSongs()) {
    if (song.unfinished) continue
    try {
      // Drop the stage files whether or not this song still needs converting.
      const before = await folderSize(song.dir)
      const { wav } = await audioFiles(song.dir)
      if (wav && await encodeMp3(song.dir)) {
        await fsp.rm(wav, { force: true })
        converted += 1
      }
      await tidySong(song.dir)
      savedBytes += Math.max(0, before - await folderSize(song.dir))
    } catch (error) {
      failures.push(`${song.title}: ${error.message}`)
    }
  }
  log('compact', { converted, savedBytes, failures })
  return { ok: true, converted, savedGb: Math.round(savedBytes / 1024 ** 3 * 100) / 100, failures }
})

// Already installed and the C drive is filling up: the checkpoints are plain files and
// can be moved after the fact (the Python runtime cannot — its paths are absolute).
ipcMain.handle('settings:move-models', async () => {
  if (currentJob || queue.length) return { ok: false, message: '곡을 만드는 중에는 옮길 수 없습니다.' }
  const from = paths().hfHome
  const picked = await dialog.showOpenDialog(win, {
    title: '음악 모델을 옮길 폴더',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '이 폴더로 옮기기'
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const to = path.join(picked.filePaths[0], 'ssokMusic-models')
  if (path.resolve(to) === path.resolve(from)) return { ok: false, message: '같은 폴더입니다.' }
  const freeGb = await freeSpaceGb(to)
  if (freeGb !== null && freeGb < 9) {
    return { ok: false, message: `여유 공간이 ${freeGb}GB입니다. 9GB 이상 필요합니다.` }
  }
  try {
    send('job:event', { type: 'notice', message: '모델을 옮기는 중입니다. 몇 분 걸릴 수 있습니다…' })
    if (await exists(from)) {
      try {
        await fsp.rename(from, to) // same drive: instant
      } catch {
        await fsp.cp(from, to, { recursive: true }) // across drives: copy, then drop the original
        await fsp.rm(from, { recursive: true, force: true })
      }
    } else {
      await fsp.mkdir(to, { recursive: true })
    }
    await writeSettings({ hfHome: to })
    log('models moved', from, '→', to)
    return { ok: true, path: to }
  } catch (error) {
    log('model move failed', error.message)
    return { ok: false, message: `옮기지 못했습니다: ${error.message}` }
  }
})

// ── storage locations ────────────────────────────────────────────────────────
// Exports start where the last one went, or in a folder set ahead in the options.
// A remembered folder that has since gone — an unplugged USB drive — falls back to
// Music rather than opening the dialog somewhere that no longer exists.
async function exportBase () {
  const settings = await readSettings()
  if (settings.exportDir && await exists(settings.exportDir)) return settings.exportDir
  return app.getPath('music')
}

async function rememberExportDir (dir) {
  if ((await readSettings()).exportDir !== dir) await writeSettings({ exportDir: dir })
}

ipcMain.handle('settings:pick-export', async () => {
  const picked = await dialog.showOpenDialog(win, {
    title: '내보낸 곡을 저장할 기본 폴더',
    defaultPath: await exportBase(),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '이 폴더로 정하기'
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const dir = picked.filePaths[0]
  if (!await canWrite(dir)) return { ok: false, blocked: true, message: BLOCKED_FOLDER }
  await writeSettings({ exportDir: dir })
  log('export folder', dir)
  return { ok: true, path: dir }
})

// Every file under dir with its size, and every folder, so empty projects survive.
async function walk (dir) {
  const files = []
  const dirs = []
  for (const entry of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath || entry.path, entry.name)
    const rel = path.relative(dir, full)
    if (entry.isDirectory()) dirs.push(rel)
    else if (entry.isFile()) files.push({ rel, size: (await fsp.stat(full)).size })
  }
  return { files, dirs }
}

const within = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// The whole library — every project and song — moves to another folder or drive, and
// new songs are saved there from then on. Across drives nothing is deleted until every
// file has been copied and its size checked at the new place.
ipcMain.handle('settings:move-songs', async () => {
  if (currentJob || queue.length) {
    return { ok: false, message: '곡을 만드는 중이거나 대기열에 곡이 있으면 옮길 수 없습니다. 모두 끝난 뒤에 해주세요.' }
  }
  const from = await ensureSongsDir()
  const picked = await dialog.showOpenDialog(win, {
    title: '곡을 저장할 새 위치 (예: D 드라이브)',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '이 위치로 옮기기'
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const parent = picked.filePaths[0]
  const to = path.join(parent, 'ssokMusic Songs')
  if (within(to, from) || within(from, to)) {
    return { ok: false, message: '지금 곡 폴더와 같은 곳이거나 그 안쪽으로는 옮길 수 없습니다.' }
  }
  if (await exists(to) && (await fsp.readdir(to)).length) {
    return { ok: false, message: `"${to}" 폴더에 이미 파일이 있습니다. 다른 위치를 골라주세요.` }
  }
  if (!await canWrite(parent)) return { ok: false, blocked: true, message: BLOCKED_FOLDER }

  const { files, dirs } = await walk(from)
  const total = files.reduce((sum, file) => sum + file.size, 0)
  const sameDrive = path.parse(from).root.toLowerCase() === path.parse(to).root.toLowerCase()
  const freeGb = await freeSpaceGb(parent)
  const needGb = Math.round(total / 1024 ** 3 * 10) / 10
  if (!sameDrive && freeGb !== null && freeGb < needGb + 0.5) {
    return { ok: false, message: `공간이 부족합니다. 곡 ${needGb}GB를 옮길 공간이 필요한데 ${freeGb}GB 남아 있습니다.` }
  }
  log('moving songs', from, '→', to, { files: files.length, gb: needGb, sameDrive })
  try {
    if (sameDrive) {
      // Same drive: a rename is instant and moves no data. It is all or nothing.
      if (await exists(to)) await fsp.rmdir(to)
      await fsp.rename(from, to)
    } else {
      await fsp.mkdir(to, { recursive: true })
      for (const dir of dirs) await fsp.mkdir(path.join(to, dir), { recursive: true })
      let copied = 0
      let reported = 0
      for (const [index, file] of files.entries()) {
        await fsp.copyFile(path.join(from, file.rel), path.join(to, file.rel), fs.constants.COPYFILE_EXCL)
        copied += file.size
        if (Date.now() - reported > 400) {
          reported = Date.now()
          send('songs:move-progress', { copied, total, done: index + 1, count: files.length })
        }
      }
      for (const file of files) {
        const { size } = await fsp.stat(path.join(to, file.rel))
        if (size !== file.size) throw new Error(`${file.rel} 파일이 제대로 복사되지 않았습니다`)
      }
    }
  } catch (error) {
    log('move songs failed', error.message)
    // Only the new copy is removed; the original library has not been touched.
    if (!sameDrive) await fsp.rm(to, { recursive: true, force: true }).catch(() => {})
    return { ok: false, message: `옮기지 못했습니다: ${error.message}\n원래 곡 폴더는 그대로 있습니다.` }
  }

  songsDir = to
  await writeSettings({ songsDir: to })
  // A failed song waiting for a retry points into the old folder.
  for (const item of failed) {
    if (!item.outDir || !within(item.outDir, from)) continue
    item.outDir = path.join(to, path.relative(from, item.outDir))
    if (item.job) item.job.outDir = item.outDir
  }
  let leftover = null
  if (!sameDrive) {
    try {
      await fsp.rm(from, { recursive: true, force: true })
    } catch (error) {
      // Everything is safely at the new place; the old copy just could not be cleared.
      leftover = from
      log('old songs folder left behind', from, error.message)
    }
  }
  log('songs moved', from, '→', to)
  send('songs:move-progress', { copied: total, total, done: files.length, count: files.length })
  return { ok: true, path: to, count: files.length, gb: needGb, leftover }
})

// ── playlist video (electron/video.js) ───────────────────────────────────────
const videoCacheDir = () => path.join(userData(), 'video-cache')
const preparedCycles = new Map() // cycle id → cycle, for the render that follows
const renderJobs = new Map()
// A long render must not be cut short by the PC going to sleep.
let renderAwake = null
function keepAwakeWhileRendering () {
  if (renderJobs.size && renderAwake === null) renderAwake = powerSaveBlocker.start('prevent-app-suspension')
  if (!renderJobs.size && renderAwake !== null) {
    powerSaveBlocker.stop(renderAwake)
    renderAwake = null
  }
}

// Frames travel over a loopback HTTP connection rather than IPC. Electron's IPC runs
// every multi-megabyte frame through the V8 serializer on both sides, which held
// renders to about 40 fps; an HTTP body goes from Chromium's network service into
// the ffmpeg pipe with plain copies. Bound to 127.0.0.1 only, with a random token per
// render. Frames may arrive out of order; the job writes them in order.
let frameServer = null
function frameServerPort () {
  if (frameServer) return frameServer
  const server = http.createServer((req, res) => {
    const match = req.method === 'POST' && req.url.match(/^\/frame\/(\d+)\/([0-9a-f]{32})\/(\d+)$/)
    const job = match && renderJobs.get(match[1])
    if (!job || job.token !== match[2]) {
      res.writeHead(403)
      res.end()
      req.resume()
      return
    }
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', async () => {
      const ok = await job.frameAt(Number(match[3]), Buffer.concat(chunks)).catch(() => false)
      res.writeHead(ok ? 204 : 410, { 'Access-Control-Allow-Origin': '*' })
      res.end()
    })
  })
  frameServer = new Promise((resolve, reject) => {
    server.once('error', (error) => { frameServer = null; reject(error) })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  return frameServer
}

async function videoFfmpeg () {
  const settings = await readSettings()
  if (!settings.ffmpeg || !await exists(settings.ffmpeg)) throw new Error('영상 변환기(ffmpeg)를 찾지 못했습니다.')
  return settings.ffmpeg
}

ipcMain.handle('video:settings', async () => (await readSettings()).video || null)
ipcMain.handle('video:save-settings', async (_e, video) => {
  if (video && typeof video === 'object') await writeSettings({ video })
  return { ok: true }
})

// Joins the songs into one track and analyses it; both are cached, so preparing the
// same songs again — or with a new colour — is instant.
ipcMain.handle('video:prepare', async (_e, { tracks, fps, analysis: settings }) => {
  try {
    const root = await ensureSongsDir()
    const list = (tracks || []).filter((track) => track && typeof track.path === 'string' &&
      path.resolve(track.path).startsWith(path.resolve(root)))
    if (!list.length) return { ok: false, message: '영상으로 만들 완성곡이 없습니다.' }
    for (const track of list) {
      if (!await exists(track.path)) return { ok: false, message: `음원 파일이 없습니다: ${track.title}` }
    }
    const ffmpeg = await videoFfmpeg()
    const rate = videoTools.FPS_CHOICES.includes(Number(fps)) ? Number(fps) : 30
    const cycle = await videoTools.prepareCycle({
      ffmpeg, cacheDir: videoCacheDir(), fps: rate,
      tracks: list.map((track) => ({ path: track.path, title: String(track.title || '무제') })),
      onProgress: (fraction) => send('video:progress', { stage: 'audio', fraction })
    })
    const cache = await videoTools.spectrumCache({
      cacheDir: videoCacheDir(), cycle, settings,
      onProgress: (fraction) => send('video:progress', { stage: 'analysis', fraction })
    })
    preparedCycles.set(cycle.id, cycle)
    log('video prepared', { songs: list.length, seconds: cycle.seconds, frames: cycle.frameCount,
      bars: cache.header.barCount, reusedAudio: cycle.reused, reusedAnalysis: cache.reused })
    return {
      ok: true,
      cycle: { id: cycle.id, seconds: cycle.seconds, frameCount: cycle.frameCount, fps: cycle.fps,
        chapters: cycle.chapters, audioUrl: pathToFileURL(cycle.wav).href },
      header: cache.header,
      frames: new Uint8Array(cache.frames.buffer, cache.frames.byteOffset, cache.frames.byteLength)
    }
  } catch (error) {
    log('video prepare failed', error.stack || error.message)
    return { ok: false, message: `영상을 준비하지 못했습니다: ${error.message}` }
  }
})

ipcMain.handle('video:background', async (_e, kind) => {
  const picked = await dialog.showOpenDialog(win, {
    title: kind === 'video' ? '배경 영상 고르기' : '배경 이미지 고르기',
    properties: ['openFile'],
    filters: kind === 'video'
      ? [{ name: '영상', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }]
      : [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
  })
  if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true }
  const file = picked.filePaths[0]
  return { ok: true, kind: kind === 'video' ? 'video' : 'image', path: file, url: pathToFileURL(file).href }
})

// Asks where to save, plans the render and starts ffmpeg; the renderer then feeds it
// frames drawn by the same code as the preview.
ipcMain.handle('video:start', async (_e, { cycleId, video, name }) => {
  try {
    const cycle = preparedCycles.get(cycleId)
    if (!cycle) return { ok: false, message: '미리보기를 다시 준비해주세요.' }
    if (video.background && video.background.kind !== 'none' &&
        (!video.background.path || !await exists(video.background.path))) {
      return { ok: false, message: '배경 파일을 찾지 못했습니다. 배경을 다시 골라주세요.' }
    }
    // Tests in a dev checkout name the file up front instead of using the dialog.
    const testOutput = !app.isPackaged && process.env.SSOKMUSIC_TEST_VIDEO_OUT
    const target = testOutput ? { filePath: testOutput } : await dialog.showSaveDialog(win, {
      title: '영상 저장',
      defaultPath: path.join(await exportBase(), `${audioName(name || '플레이리스트')}.mp4`),
      filters: [{ name: 'MP4 영상', extensions: ['mp4'] }]
    })
    if (target.canceled || !target.filePath) return { ok: false, canceled: true }
    if (!await canWrite(path.dirname(target.filePath))) return { ok: false, blocked: true, message: BLOCKED_FOLDER }
    const job = new videoTools.RenderJob({ ffmpeg: await videoFfmpeg(), cycle, video, output: target.filePath, log })
    const plan = await job.start()
    const id = `${Date.now()}`
    job.token = crypto.randomBytes(16).toString('hex')
    job.onFail = (message) => send('video:failed', { jobId: id, message })
    renderJobs.set(id, job)
    keepAwakeWhileRendering()
    await rememberExportDir(path.dirname(target.filePath))
    // The fast path for frames; without it the renderer falls back to IPC.
    const port = await frameServerPort().catch((error) => {
      log('frame server unavailable', error.message)
      return null
    })
    return { ok: true, jobId: id, plan, path: target.filePath, port, token: job.token,
      chapters: videoTools.chapters(cycle, plan.target) }
  } catch (error) {
    log('video start failed', error.stack || error.message)
    return { ok: false, message: `영상을 시작하지 못했습니다: ${error.message}` }
  }
})

// The slower path, used when the loopback server is not available.
ipcMain.handle('video:frame', async (_e, jobId, index, data) => {
  const job = renderJobs.get(jobId)
  if (!job) return false
  return job.frameAt(index, Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength))
})

// The layer that never changes — backdrop or darkening — sent once, before any band.
ipcMain.handle('video:layer', async (_e, jobId, data) => {
  const job = renderJobs.get(jobId)
  if (!job) return false
  await job.layer(Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength))
  return true
})

ipcMain.handle('video:finish', async (_e, jobId) => {
  const job = renderJobs.get(jobId)
  if (!job) return { ok: false, message: '렌더 작업을 찾지 못했습니다.' }
  try {
    const result = await job.finish()
    return { ok: true, ...result }
  } catch (error) {
    log('video render failed', error.message, job.stderr ? job.stderr.slice(-1500) : '')
    await job.cancel().catch(() => {})
    const gpu = job.video.renderer !== 'cpu' && /nvenc|No capable devices|OpenEncodeSessionEx|driver/i.test(job.stderr || '')
    return { ok: false, gpuFailed: gpu,
      message: gpu
        ? 'GPU(NVIDIA NVENC)로 인코딩하지 못했습니다. 렌더링 옵션을 CPU로 바꿔 다시 시도해주세요.'
        : `영상을 만들지 못했습니다 (${error.message}). 만들던 파일은 지웠습니다. 다시 시도해 주시고, 되풀이되면 저장 위치를 다른 폴더로 바꾸거나 렌더링 옵션을 CPU로 바꿔 보세요.` }
  } finally {
    renderJobs.delete(jobId)
    keepAwakeWhileRendering()
  }
})

ipcMain.handle('video:cancel', async (_e, jobId) => {
  const job = renderJobs.get(jobId)
  if (job) await job.cancel()
  renderJobs.delete(jobId)
  keepAwakeWhileRendering()
  return { ok: true }
})

// Closing mid-render asks first, and a render that is given up is cleaned up before
// the app goes: its working files removed, nothing half-written left behind.
let quittingAfterRender = false
function stopRendersThenQuit (event) {
  if (quittingAfterRender || !renderJobs.size) return
  event.preventDefault()
  quittingAfterRender = true
  Promise.allSettled([...renderJobs.values()].map((job) => job.cancel()))
    .then(() => {
      renderJobs.clear()
      keepAwakeWhileRendering()
      app.quit()
    })
}
app.on('before-quit', stopRendersThenQuit)

// The WYSIWYG check (지시서 §14.3): a frame drawn the way the preview draws it — one
// canvas, backdrop and spectrum together — against the same frame decoded from the
// finished MP4. Both are brought to the encoder's 4:2:0 colour before SSIM, so only
// real differences count, not the chroma subsampling every MP4 applies.
ipcMain.handle('video:compare', async (_e, { output, frame, against = frame, fps, width, height, rgba, background }) => {
  const work = path.join(os.tmpdir(), `ssokmusic-compare-${Date.now()}-${frame}`)
  try {
    await fsp.mkdir(work, { recursive: true })
    const preview = path.join(work, 'preview.rgba')
    await fsp.writeFile(preview, Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.byteLength))
    const ffmpeg = await videoFfmpeg()
    const args = ['-hide_banner', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', preview,
      '-ss', (against / fps).toFixed(6), '-i', output]
    let graph = ''
    if (background && background.kind === 'image' && background.path) {
      // The preview's picture is CSS under the canvas; here it goes under the drawn frame.
      args.push('-i', background.path)
      graph = `[2:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba[bg];` +
        '[bg][0:v]overlay=0:0:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[a];'
    } else {
      graph = '[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[a];'
    }
    graph += '[1:v]trim=end_frame=1,format=yuv420p[b];[a][b]ssim'
    const text = await new Promise((resolve) => {
      const child = spawn(ffmpeg, [...args, '-filter_complex', graph, '-frames:v', '1', '-f', 'null', '-'], { windowsHide: true })
      let out = ''
      child.stderr.on('data', (chunk) => { out += chunk })
      child.on('close', () => resolve(out))
      child.on('error', () => resolve(''))
    })
    const match = text.match(/All:([0-9.]+)/)
    const ssim = match ? Number(match[1]) : null
    log('video compare', { frame, against, ssim })
    return { ok: ssim !== null, ssim }
  } catch (error) {
    log('video compare failed', error.message)
    return { ok: false }
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {})
  }
})

// User-made style presets live in settings so they survive updates.
ipcMain.handle('presets:list', async () => (await readSettings()).presets || [])

ipcMain.handle('presets:save', async (_e, preset) => {
  const name = String(preset.name || '').trim().slice(0, 40)
  if (!name) return { ok: false, message: '이름을 입력해주세요.' }
  const presets = ((await readSettings()).presets || []).filter((item) => item.name !== name)
  presets.push({ name, style: String(preset.style || '').trim(), instrumental: Boolean(preset.instrumental),
    parts: cleanParts(preset.parts) })
  await writeSettings({ presets: presets.slice(-40) })
  log('preset saved', name)
  return { ok: true, presets }
})

ipcMain.handle('presets:delete', async (_e, name) => {
  const presets = ((await readSettings()).presets || []).filter((item) => item.name !== name)
  await writeSettings({ presets })
  return { ok: true, presets }
})

ipcMain.handle('settings:get', async () => {
  const settings = await readSettings()
  return {
    autoMp3: Boolean(settings.autoMp3),
    dropWav: Boolean(settings.dropWav),
    songsDir: await ensureSongsDir().catch(() => null),
    exportDir: settings.exportDir || null,
    musicDir: app.getPath('music')
  }
})

ipcMain.handle('settings:set', async (_e, patch) => {
  const next = await writeSettings({
    autoMp3: Boolean(patch.autoMp3),
    dropWav: Boolean(patch.autoMp3) && Boolean(patch.dropWav)
  })
  log('settings', { autoMp3: next.autoMp3, dropWav: next.dropWav })
  return { autoMp3: next.autoMp3, dropWav: next.dropWav }
})

ipcMain.handle('shell:open', (_e, target) => { shell.openPath(target); return { ok: true } })

ipcMain.handle('log:open', () => {
  shell.showItemInFolder(path.join(userData(), 'app.log'))
  return { ok: true }
})

// ── updates ──────────────────────────────────────────────────────────────────
ipcMain.handle('update:check', async () => {
  const found = await appUpdate.check()
  log('update check', found ? { version: found.version, current: found.current } : 'up to date')
  return found
})

ipcMain.handle('update:install', async (_e, info) => {
  if (!info || !info.url) return { ok: false, error: '내려받을 주소가 없습니다.' }
  if (info.forMe === false) return appUpdate.openInBrowser(info.url)
  const downloaded = await appUpdate.download(
    info.url, (ratio) => send('update:progress', ratio), info.version)
  if (!downloaded.ok) {
    log('update download failed', downloaded.error)
    return downloaded
  }
  const started = appUpdate.run(downloaded.path)
  if (!started.ok) return started
  log('update installer started', downloaded.path)
  // The installer closes this app, overwrites it and restarts it; stepping aside
  // keeps the running window from holding a file lock on it.
  setTimeout(() => { if (win && !win.isDestroyed()) win.hide(); app.quit() }, 800)
  return started
})

// ── system stats ─────────────────────────────────────────────────────────────
// A small live readout: on an 8GB card people want to see whether the run is
// sitting inside VRAM or spilling, and that the GPU is actually working.
let statsTimer = null

async function readStats () {
  const total = os.totalmem()
  const stats = {
    ramUsedGb: Math.round((total - os.freemem()) / 2 ** 30 * 10) / 10,
    ramTotalGb: Math.round(total / 2 ** 30 * 10) / 10,
    busy: Boolean(currentJob)
  }
  try {
    const out = await run('nvidia-smi',
      ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'])
    const [used, capacity, load] = out.split(/\n/)[0].split(',').map((value) => Number(value.trim()))
    Object.assign(stats, {
      vramUsedGb: Math.round(used / 1024 * 10) / 10,
      vramTotalGb: Math.round(capacity / 1024 * 10) / 10,
      gpuLoad: load
    })
  } catch { /* no GPU reading; the RAM half still shows */ }
  return stats
}

function watchStats () {
  const tick = async () => {
    if (win && !win.isDestroyed() && win.isVisible()) send('system:stats', await readStats())
    // Poll briskly while a song is being made, and rarely when idle.
    statsTimer = setTimeout(tick, currentJob ? 2000 : 8000)
  }
  clearTimeout(statsTimer)
  tick()
}

// ── window ───────────────────────────────────────────────────────────────────
// Without an application menu the Ctrl+C/V/X/A accelerators are not registered, so
// copy and paste silently do nothing. The bar stays hidden; only the shortcuts matter.
function installEditMenu () {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: '편집',
    submenu: [
      { role: 'undo', label: '실행 취소' },
      { role: 'redo', label: '다시 실행' },
      { type: 'separator' },
      { role: 'cut', label: '잘라내기' },
      { role: 'copy', label: '복사' },
      { role: 'paste', label: '붙여넣기' },
      { role: 'selectAll', label: '전체 선택' }
    ]
  }]))
}

// Right-clicking a text box is how most people paste; Electron shows no menu of its own.
function installContextMenu (target) {
  target.webContents.on('context-menu', (_event, params) => {
    const flags = params.editFlags
    const items = []
    if (params.isEditable || params.selectionText) {
      items.push(
        { role: 'cut', label: '잘라내기', enabled: params.isEditable && flags.canCut },
        { role: 'copy', label: '복사', enabled: flags.canCopy },
        { role: 'paste', label: '붙여넣기', enabled: params.isEditable && flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: '전체 선택', enabled: flags.canSelectAll }
      )
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: target })
  })
}

function createWindow () {
  // Three columns — prompt, songs, video studio — want a wide window; the screen
  // decides how wide.
  const area = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width: Math.min(1640, area.width),
    height: Math.min(940, area.height),
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0f1115',
    title: 'ssokMusic Free',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  })
  win.setMenuBarVisibility(false)
  win.autoHideMenuBar = true
  installContextMenu(win)
  win.on('close', (event) => {
    if (!renderJobs.size || quittingAfterRender) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['계속 만들기', '취소하고 닫기'], defaultId: 0, cancelId: 0,
      title: '영상을 만드는 중', message: '영상을 만드는 중입니다.',
      detail: '지금 닫으면 영상 만들기가 취소되고, 만들던 파일은 지워집니다.'
    })
    if (choice === 0) event.preventDefault()
  })
  // Without the page no more frames come; the render cannot finish.
  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone', details)
    for (const [id, job] of renderJobs) {
      job.fail(`화면 처리가 멈췄습니다 (${details.reason})`)
      job.cancel().catch(() => {})
      renderJobs.delete(id)
    }
    keepAwakeWhileRendering()
  })
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  // Wait for the page: the restored queue is announced over IPC.
  win.webContents.once('did-finish-load', () => {
    restoreQueue().catch((error) => log('queue restore failed', error.message))
    watchStats()
  })
}

app.whenReady().then(() => {
  appUpdate.init({ app, shell, log })
  installEditMenu()
  createWindow()
})
app.on('window-all-closed', () => {
  if (worker) { try { worker.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n') } catch {} worker.kill() }
  // app.quit() waits for any render to be cleaned up (before-quit above).
  if (process.platform !== 'darwin') app.quit()
})
