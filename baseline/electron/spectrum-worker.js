'use strict'
// Runs the spectrum analysis off the main thread (지시서 §12): a long playlist is tens
// of thousands of FFTs, and the window must stay responsive meanwhile. The samples
// are read from a raw mono float32 file one analysis window at a time, so even an
// hour of audio never has to be held in memory.
const fs = require('fs')
const { parentPort, workerData } = require('worker_threads')
const { analyzeSource } = require('./spectrum-analysis')

const { samplesPath, sampleRate, fps, settings } = workerData
const fd = fs.openSync(samplesPath, 'r')
try {
  const length = Math.floor(fs.fstatSync(fd).size / 4)
  const bytes = Buffer.alloc(16 * 8192) // big enough for the largest FFT window
  const source = {
    length,
    read (start, into) {
      into.fill(0)
      const from = Math.max(0, start)
      const to = Math.min(length, start + into.length)
      if (to <= from) return
      const got = fs.readSync(fd, bytes, 0, (to - from) * 4, from * 4)
      const values = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(got / 4))
      into.set(values, from - start)
    }
  }
  const result = analyzeSource(source, sampleRate, fps, settings,
    (fraction) => parentPort.postMessage({ type: 'progress', fraction }))
  parentPort.postMessage({
    type: 'done',
    frameCount: result.frameCount,
    barCount: result.barCount,
    settings: result.settings,
    frames: result.frames.buffer
  }, [result.frames.buffer])
} finally {
  fs.closeSync(fd)
}
