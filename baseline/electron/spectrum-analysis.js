'use strict'
// ── offline spectrum analysis ────────────────────────────────────────────────
// One FFT pass over the whole decoded track, producing one row of bar heights per
// video frame. The preview and the final render both read these rows; neither ever
// asks a live AnalyserNode, so a paused preview frame and the same frame in the MP4
// are drawn from identical numbers (SSOK 스펙트럼 WYSIWYG 지시서 §4–6).
//
// Everything here is a pure function of (samples, settings): no clocks, no randomness.

const DEFAULT_ANALYSIS = Object.freeze({
  fftSize: 2048, // 1024 | 2048 | 4096 | 8192
  windowFunction: 'hann',
  minFrequency: 40,
  maxFrequency: 16000,
  frequencyScale: 'log',
  barCount: 64,
  minDb: -90,
  maxDb: -10,
  attackMs: 35,
  releaseMs: 180,
  smoothing: 0.65,
  channelMode: 'mix'
})

const FFT_SIZES = [1024, 2048, 4096, 8192]
const CACHE_VERSION = 1

// Frame ↔ time, the one formula every part of the app uses (§5.3).
const frameAt = (seconds, fps) => Math.max(0, Math.floor(seconds * fps + 1e-7))
const timeOf = (frame, fps) => frame / fps
const frameTotal = (seconds, fps) => Math.ceil(seconds * fps - 1e-7)

function normalizeSettings (settings = {}) {
  const s = { ...DEFAULT_ANALYSIS, ...settings }
  if (!FFT_SIZES.includes(s.fftSize)) s.fftSize = DEFAULT_ANALYSIS.fftSize
  s.barCount = Math.max(8, Math.min(256, Math.round(s.barCount)))
  return s
}

function hann (n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

// In-place iterative radix-2 FFT over separate real/imaginary arrays.
function fft (re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const a = start + k
        const b = a + half
        const tr = re[b] * cos - im[b] * sin
        const ti = re[b] * sin + im[b] * cos
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

// Log-spaced bar edges mapped to FFT bins. A low bar narrower than one bin still
// gets the nearest bin, so no bar is permanently empty.
function barBins (s, sampleRate) {
  const binHz = sampleRate / s.fftSize
  const nyquistBin = s.fftSize / 2 - 1
  const maxFrequency = Math.min(s.maxFrequency, sampleRate / 2)
  const ratio = maxFrequency / s.minFrequency
  const bins = []
  for (let bar = 0; bar < s.barCount; bar++) {
    const lowHz = s.minFrequency * ratio ** (bar / s.barCount)
    const highHz = s.minFrequency * ratio ** ((bar + 1) / s.barCount)
    let from = Math.max(1, Math.floor(lowHz / binHz))
    let to = Math.min(nyquistBin, Math.ceil(highHz / binHz))
    if (to <= from) {
      from = Math.max(1, Math.min(nyquistBin, Math.round(((lowHz + highHz) / 2) / binHz)))
      to = from + 1
    }
    bins.push([from, to])
  }
  return bins
}

// dB → 0..1, with anything that is not a finite non-negative number becoming 0.
function normalizeDb (db, minDb, maxDb) {
  const value = (db - minDb) / (maxDb - minDb)
  return Number.isFinite(value) && value > 0 ? Math.min(1, value) : 0
}

// The whole track, frame by frame, in order: temporal smoothing depends on the
// previous frame, so frames are never computed out of sequence. Stage order is fixed:
// raw bar level → attack/release over time → spatial smoothing across bars.
function analyze (samples, sampleRate, fps, settings = {}, onProgress = null) {
  return analyzeSource({
    length: samples.length,
    read: (start, into) => {
      for (let i = 0; i < into.length; i++) {
        const at = start + i
        into[i] = at >= 0 && at < samples.length ? samples[at] : 0
      }
    }
  }, sampleRate, fps, settings, onProgress)
}

// The same analysis over any sample source that can fill a window — an array in
// tests, a file read window by window for an hour-long playlist, so the whole track
// never has to sit in memory. read(start, into) fills `into` with samples from
// `start`, zeros outside the track.
function analyzeSource (source, sampleRate, fps, settings = {}, onProgress = null) {
  const s = normalizeSettings(settings)
  const n = s.fftSize
  const window = hann(n)
  const windowGain = window.reduce((sum, w) => sum + w, 0) / 2 // amplitude of a full-scale sine
  const bins = barBins(s, sampleRate)
  const frameCount = frameTotal(source.length / sampleRate, fps)
  const chunk = new Float32Array(n)
  const out = new Float32Array(frameCount * s.barCount)
  const level = new Float64Array(s.barCount)
  const raw = new Float64Array(s.barCount)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const frameMs = 1000 / fps
  const attack = 1 - Math.exp(-frameMs / Math.max(1, s.attackMs))
  const release = 1 - Math.exp(-frameMs / Math.max(1, s.releaseMs))
  const spread = Math.max(0, Math.min(1, s.smoothing))

  for (let frame = 0; frame < frameCount; frame++) {
    // The window is centred on the frame's instant; outside the track is silence.
    const centre = Math.round(timeOf(frame, fps) * sampleRate)
    source.read(centre - n / 2, chunk)
    for (let i = 0; i < n; i++) {
      re[i] = chunk[i] * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let bar = 0; bar < s.barCount; bar++) {
      const [from, to] = bins[bar]
      let peak = 0
      for (let k = from; k < to; k++) {
        const magnitude = Math.hypot(re[k], im[k]) / windowGain
        if (magnitude > peak) peak = magnitude
      }
      raw[bar] = normalizeDb(20 * Math.log10(peak + 1e-12), s.minDb, s.maxDb)
    }
    for (let bar = 0; bar < s.barCount; bar++) {
      const target = raw[bar]
      level[bar] += (target > level[bar] ? attack : release) * (target - level[bar])
    }
    const row = frame * s.barCount
    for (let bar = 0; bar < s.barCount; bar++) {
      const left = level[Math.max(0, bar - 1)]
      const right = level[Math.min(s.barCount - 1, bar + 1)]
      const value = level[bar] * (1 - spread / 2) + (left + right) * (spread / 4)
      out[row + bar] = Number.isFinite(value) && value > 0 ? Math.min(1, value) : 0
    }
    if (onProgress && frame % 500 === 0) onProgress(frame / frameCount)
  }
  return { settings: s, frameCount, barCount: s.barCount, frames: out }
}

module.exports = {
  DEFAULT_ANALYSIS, CACHE_VERSION, FFT_SIZES,
  frameAt, timeOf, frameTotal, normalizeSettings, barBins, normalizeDb, fft, hann, analyze, analyzeSource
}
