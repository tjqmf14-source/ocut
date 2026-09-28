'use strict'
// ── shared spectrum renderer ─────────────────────────────────────────────────
// The only code that draws the spectrum. The preview calls it on a small canvas; the
// final render calls it on a full-size one, frame by frame. Every position and size
// comes from normalised 0–1 coordinates times the canvas size, and every value from
// the per-frame cache, so a paused preview frame and the same frame of the MP4 have
// the same bars, gaps, colours and glow (SSOK 스펙트럼 WYSIWYG 지시서 §7).
// Nothing here reads a clock: time enters only as frameIndex / fps.

const SPECTRUM_DEFAULTS = Object.freeze({
  visible: true,
  kind: 'bars', // bars | mirror | line | circle
  symmetric: true,
  barCount: 64, // an analysis setting: changing it rebuilds the cache
  position: 'bottom', // bottom | center
  size: 0.3, // height of the spectrum as a share of the frame
  width: 0.82, // width as a share of the frame
  color1: '#7c5cff',
  color2: '#ff5c9d',
  glow: 0.5,
  dim: 0.25 // darkens a background image or video under the spectrum
})

// Time → frame, the same formula as electron/spectrum-analysis.js (§5.3); a unit
// test holds the two together.
const frameAt = (seconds, fps) => Math.max(0, Math.floor(seconds * fps + 1e-7))

// Where the spectrum sits, in 0–1 frame coordinates.
function spectrumBox (style) {
  const width = style.width
  const height = style.size
  const x = (1 - width) / 2
  const y = style.position === 'center' ? 0.5 - height / 2 : 0.93 - height
  return { x, y, width, height }
}

// Symmetric shapes put the low end in the middle and spread outwards. The full
// spectrum is folded to half as many bars (the louder of each pair) and mirrored, so
// the bar count on screen stays the same and nothing is dropped.
function arrange (values, symmetric) {
  if (!symmetric) return Array.from(values)
  const half = []
  for (let i = 0; i + 1 < values.length; i += 2) half.push(Math.max(values[i], values[i + 1]))
  return [...half.slice().reverse(), ...half]
}

function drawBackdrop (ctx, style, background, rc) {
  const { width: w, height: h } = rc
  if (!background || background.kind === 'none') {
    // No picture: a deep gradient with a soft glow behind the spectrum.
    const base = ctx.createLinearGradient(0, 0, 0, h)
    base.addColorStop(0, '#0d0f1a')
    base.addColorStop(1, '#171027')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)
    const box = spectrumBox(style)
    const glow = ctx.createRadialGradient(w / 2, (box.y + box.height / 2) * h, 0, w / 2, (box.y + box.height / 2) * h, 0.6 * w)
    glow.addColorStop(0, hexAlpha(style.color1, 0.18))
    glow.addColorStop(1, hexAlpha(style.color1, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
  } else if (style.dim > 0) {
    // The picture itself is composited underneath (CSS in the preview, ffmpeg in the
    // render); only the darkening is drawn here.
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, style.dim)})`
    ctx.fillRect(0, 0, w, h)
  }
}

function hexAlpha (hex, alpha) {
  const value = String(hex || '#ffffff').replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function drawSpectrum (ctx, values, style, rc) {
  if (!style.visible || !values) return
  const { width: w, height: h } = rc
  const box = spectrumBox(style)
  const px = box.x * w
  const py = box.y * h
  const pw = box.width * w
  const ph = box.height * h
  const bars = arrange(values, style.symmetric)
  const count = bars.length
  ctx.save()
  if (style.glow > 0) {
    ctx.shadowColor = hexAlpha(style.color2, 0.85)
    ctx.shadowBlur = style.glow * 0.03 * h
  }
  const vertical = ctx.createLinearGradient(0, py + ph, 0, py)
  vertical.addColorStop(0, style.color1)
  vertical.addColorStop(1, style.color2)

  if (style.kind === 'circle') {
    const cx = w / 2
    const cy = style.position === 'center' ? h / 2 : 0.58 * h
    const radius = 0.13 * h
    const reach = style.size * h * 0.55
    const stroke = Math.max(1, ((2 * Math.PI * radius) / count) * 0.55)
    const radial = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + reach)
    radial.addColorStop(0, style.color1)
    radial.addColorStop(1, style.color2)
    ctx.strokeStyle = radial
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2
      const length = Math.max(0.004 * h, bars[i] * reach)
      ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      ctx.lineTo(cx + Math.cos(angle) * (radius + length), cy + Math.sin(angle) * (radius + length))
    }
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, 0.004 * h)
    ctx.strokeStyle = hexAlpha(style.color1, 0.6)
    ctx.beginPath()
    ctx.arc(cx, cy, radius - 0.01 * h, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  const slot = pw / count
  if (style.kind === 'line') {
    const baseline = style.position === 'center' ? py + ph / 2 : py + ph
    const lift = style.position === 'center' ? ph / 2 : ph
    const points = bars.map((v, i) => [px + slot * (i + 0.5), baseline - Math.max(0, v) * lift])
    const trace = () => {
      ctx.moveTo(points[0][0], points[0][1])
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1]
        const [x1, y1] = points[i]
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      }
      ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1])
    }
    ctx.beginPath()
    ctx.moveTo(px, baseline)
    ctx.lineTo(points[0][0], points[0][1])
    trace()
    ctx.lineTo(px + pw, baseline)
    ctx.closePath()
    const fill = ctx.createLinearGradient(0, baseline - lift, 0, baseline)
    fill.addColorStop(0, hexAlpha(style.color2, 0.45))
    fill.addColorStop(1, hexAlpha(style.color1, 0.05))
    ctx.fillStyle = fill
    ctx.fill()
    ctx.beginPath()
    trace()
    ctx.strokeStyle = vertical
    ctx.lineWidth = Math.max(1, 0.005 * h)
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.restore()
    return
  }

  // bars and mirror bars
  const barWidth = slot * 0.72
  const corner = barWidth * 0.4
  const floor = 0.004 * h
  ctx.fillStyle = vertical
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const x = px + i * slot + (slot - barWidth) / 2
    if (style.kind === 'mirror') {
      const length = Math.max(floor, bars[i] * ph)
      roundRect(ctx, x, py + ph / 2 - length / 2, barWidth, length, corner)
    } else {
      const length = Math.max(floor, bars[i] * ph)
      roundRect(ctx, x, py + ph - length, barWidth, length, corner)
    }
  }
  ctx.fill()
  ctx.restore()
}

function roundRect (ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

// One whole frame: backdrop (or the dimming over a picture), then the spectrum.
function renderFrame (ctx, values, style, background, rc) {
  ctx.clearRect(0, 0, rc.width, rc.height)
  drawBackdrop(ctx, style, background, rc)
  drawSpectrum(ctx, values, style, rc)
}

// The horizontal strip, in pixels, that the spectrum can ever paint into — its tallest
// bars plus the glow around them. The render sends only this strip per frame and
// ffmpeg places it back at the same height, over the unchanging layer.
function spectrumBand (style, rc) {
  const h = rc.height
  const margin = Math.ceil((style.glow > 0 ? style.glow * 0.03 * h * 1.6 : 0) + 0.012 * h + 4)
  let top
  let bottom
  if (style.kind === 'circle') {
    const cy = style.position === 'center' ? h / 2 : 0.58 * h
    const reach = 0.13 * h + style.size * h * 0.55 + 0.004 * h
    top = cy - reach
    bottom = cy + reach
  } else {
    const box = spectrumBox(style)
    top = box.y * h
    bottom = (box.y + box.height) * h
  }
  const y = Math.max(0, Math.floor(top - margin))
  return { y, height: Math.min(h, Math.ceil(bottom + margin)) - y }
}

// The two render layers, drawn with the functions above so they compose to exactly
// what renderFrame paints in the preview.
function drawLayer (ctx, style, background, rc) {
  ctx.clearRect(0, 0, rc.width, rc.height)
  drawBackdrop(ctx, style, background, rc)
}

function drawBand (ctx, values, style, rc, bandY) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(1, 0, 0, 1, 0, -bandY)
  drawSpectrum(ctx, values, style, rc)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

if (typeof module !== 'undefined') {
  module.exports = { SPECTRUM_DEFAULTS, frameAt, spectrumBox, spectrumBand, arrange, renderFrame,
    drawSpectrum, drawBackdrop, drawLayer, drawBand }
}
