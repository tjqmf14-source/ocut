'use strict'
// ── MIDI → YuE2 native ABC ───────────────────────────────────────────────────
// YuE2's score has exactly two monophonic lines, Vocal and Ins, with chord symbols
// in Vocal (YuE skills/yue2-music/references/abc-editing.md). A MIDI file has any
// number of polyphonic tracks with free timing. So the conversion picks one part per
// line, keeps the top note wherever notes overlap, snaps everything to a sixteenth-
// note grid and spells it in the model's dialect. Tempo, meter and key come from the
// file's first events; later changes are reported, not followed.
//
// The result is checked by the official validator (python/abc_tools.py) before use.

// ── reading ──
function readVarLen (buf, pos) {
  let value = 0
  let byte
  do {
    byte = buf[pos++]
    value = (value << 7) | (byte & 0x7f)
  } while (byte & 0x80 && pos < buf.length)
  return { value, pos }
}

// Track names are UTF-8 in newer files and CP949 in older Korean ones.
function decodeName (bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {}
  try {
    return new TextDecoder('euc-kr').decode(bytes).trim()
  } catch {}
  return Buffer.from(bytes).toString('latin1').trim()
}

function parseMidi (input) {
  const buf = Buffer.from(input)
  const tag = (at) => buf.toString('latin1', at, at + 4)
  if (buf.length < 14 || tag(0) !== 'MThd') throw new Error('MIDI 파일이 아닙니다.')
  const headerLength = buf.readUInt32BE(4)
  const format = buf.readUInt16BE(8)
  const trackCount = buf.readUInt16BE(10)
  const division = buf.readUInt16BE(12)
  if (division & 0x8000) throw new Error('SMPTE 시간 단위를 쓰는 MIDI는 지원하지 않습니다.')
  const tempos = []
  const meters = []
  const keys = []
  const tracks = []
  let pos = 8 + headerLength
  while (tracks.length < trackCount && pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos + 4)
    const start = pos + 8
    const end = Math.min(start + length, buf.length)
    const isTrack = tag(pos) === 'MTrk'
    pos = start + length
    if (!isTrack) continue // unknown chunk: skip it, as the standard says
    const track = { index: tracks.length, name: '', notes: [], programs: {} }
    const open = new Map()
    let tick = 0
    let running = 0
    let p = start
    while (p < end) {
      const delta = readVarLen(buf, p)
      tick += delta.value
      p = delta.pos
      let status = buf[p]
      if (status < 0x80) {
        status = running
      } else {
        p += 1
        if (status < 0xf0) running = status
      }
      if (status === 0xff) {
        const type = buf[p++]
        const size = readVarLen(buf, p)
        const data = buf.subarray(size.pos, size.pos + size.value)
        p = size.pos + size.value
        if (type === 0x03 && !track.name) track.name = decodeName(data)
        else if (type === 0x51 && data.length === 3) {
          tempos.push({ tick, bpm: 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]) })
        } else if (type === 0x58 && data.length >= 2) meters.push({ tick, n: data[0], d: 2 ** data[1] })
        else if (type === 0x59 && data.length >= 2) keys.push({ tick, sf: (data[0] << 24) >> 24, minor: data[1] === 1 })
        else if (type === 0x2f) break
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        const size = readVarLen(buf, p)
        p = size.pos + size.value
        continue
      }
      const kind = status & 0xf0
      const channel = status & 0x0f
      const a = buf[p++]
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : buf[p++]
      const key = `${channel}:${a}`
      if (kind === 0x90 && b > 0) {
        if (!open.has(key)) open.set(key, [])
        open.get(key).push({ tick, velocity: b })
      } else if (kind === 0x80 || kind === 0x90) {
        const started = (open.get(key) || []).shift()
        if (started && tick > started.tick) {
          track.notes.push({ start: started.tick, end: tick, pitch: a, channel, velocity: started.velocity })
        }
      } else if (kind === 0xc0) {
        track.programs[channel] = a
      }
    }
    // A note never switched off lasts to the end of its track.
    for (const [key, stack] of open) {
      const [channel, pitch] = key.split(':').map(Number)
      for (const started of stack) {
        if (tick > started.tick) track.notes.push({ start: started.tick, end: tick, pitch, channel, velocity: started.velocity })
      }
    }
    tracks.push(track)
  }
  const byTick = (a, b) => a.tick - b.tick
  return { format, ppq: division, tracks, tempos: tempos.sort(byTick), meters: meters.sort(byTick), keys: keys.sort(byTick) }
}

// ── parts ──
// A part is one track's notes on one channel: format-0 files keep every instrument
// in a single track, told apart only by channel. Channel 10 is General MIDI drums.
const DRUM_CHANNEL = 9
const VOCAL_NAME = /vocal|voice|vox|melody|lead|sing|topline|보컬|멜로디|노래|가창|주선율/i

function partsOf (midi) {
  const parts = []
  for (const track of midi.tracks) {
    const channels = [...new Set(track.notes.map((note) => note.channel))].sort((a, b) => a - b)
    for (const channel of channels) {
      const notes = track.notes.filter((note) => note.channel === channel).sort((a, b) => a.start - b.start)
      const pitches = notes.map((note) => note.pitch)
      let overlapping = 0
      for (let i = 1; i < notes.length; i++) if (notes[i].start < notes[i - 1].end - midi.ppq / 16) overlapping += 1
      const base = track.name || `트랙 ${track.index + 1}`
      parts.push({
        id: `${track.index}:${channel}`,
        name: channels.length > 1 ? `${base} (채널 ${channel + 1})` : base,
        channel,
        drums: channel === DRUM_CHANNEL,
        notes,
        count: notes.length,
        low: Math.min(...pitches),
        high: Math.max(...pitches),
        average: pitches.reduce((sum, p) => sum + p, 0) / pitches.length,
        chordy: notes.length ? overlapping / notes.length : 0
      })
    }
  }
  return parts
}

// The sung line: named as such, or the busiest single-note line sitting high enough
// to be a melody. The instrumental line: the next best melodic part, if any.
// Ins is a melody too — an intro theme, a solo — so a bass line is not offered for it.
const BASS_AVERAGE = 50

function suggestParts (parts) {
  const usable = parts.filter((part) => !part.drums && part.count >= 4)
  const melodic = (part) => part.average - 25 * part.chordy + Math.min(part.count, 200) / 40
  // A part named for the tune is taken at its word, however few notes it has.
  const named = parts.find((part) => !part.drums && part.count && VOCAL_NAME.test(part.name))
  const vocal = named || [...usable].sort((a, b) => melodic(b) - melodic(a))[0] || null
  const rest = usable.filter((part) => part !== vocal && part.average >= BASS_AVERAGE)
  // Its top line is what gets used, so chords are no reason to pass a part over here.
  const ins = [...rest].sort((a, b) => (b.average + Math.min(b.count, 200) / 40) -
    (a.average + Math.min(a.count, 200) / 40))[0] || null
  return { vocal: vocal ? vocal.id : '', ins: ins ? ins.id : '' }
}

// ── music ──
const DURATIONS = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1]
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const LETTERS = 'CDEFGAB'
const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m']
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// Krumhansl–Kessler key profiles, correlated against how long each pitch class sounds.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlate (a, b) {
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(a)
  const mb = mean(b)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

const tonicPc = (name) => {
  const bare = name.replace(/m$/, '')
  return (NATURAL[bare[0]] + (bare[1] === '#' ? 1 : bare[1] === 'b' ? -1 : 0) + 12) % 12
}

function estimateKey (notes) {
  const histogram = new Array(12).fill(0)
  for (const note of notes) histogram[note.pitch % 12] += note.end - note.start
  let best = { score: -Infinity, name: 'C' }
  for (let root = 0; root < 12; root++) {
    const rotated = histogram.slice(root).concat(histogram.slice(0, root))
    for (const [profile, names] of [[MAJOR_PROFILE, MAJOR_KEYS], [MINOR_PROFILE, MINOR_KEYS]]) {
      const score = correlate(rotated, profile)
      if (score <= best.score) continue
      // Of the enharmonic spellings (F# / Gb …), the one with fewer accidentals.
      const [choice] = names.map((name, index) => ({ name, sf: index - 7 }))
        .filter(({ name }) => tonicPc(name) === root)
        .sort((a, b) => Math.abs(a.sf) - Math.abs(b.sf))
      if (choice) best = { score, name: choice.name }
    }
  }
  return best.name
}

function keySignature (name) {
  const index = MAJOR_KEYS.includes(name) ? MAJOR_KEYS.indexOf(name) : MINOR_KEYS.indexOf(name)
  const sf = index - 7
  const alter = Object.fromEntries([...LETTERS].map((letter) => [letter, 0]))
  for (const letter of (sf > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0, Math.abs(sf))) alter[letter] = sf > 0 ? 1 : -1
  return { sf, alter }
}

// How a pitch is written in this key: the scale's own letter when it has one,
// otherwise sharps in sharp keys and flats in flat keys.
function spell (pitch, signature) {
  const pc = ((pitch % 12) + 12) % 12
  for (const letter of LETTERS) {
    if ((NATURAL[letter] + signature.alter[letter] + 12) % 12 === pc) return { letter, alter: signature.alter[letter] }
  }
  const name = (signature.sf < 0 ? FLAT_NAMES : SHARP_NAMES)[pc]
  return { letter: name[0], alter: name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0 }
}

function noteText (pitch, spelled) {
  const base = pitch - spelled.alter // the natural note on the staff
  const octave = Math.round((base - NATURAL[spelled.letter] - 60) / 12)
  return octave >= 1
    ? spelled.letter.toLowerCase() + "'".repeat(octave - 1)
    : spelled.letter + ','.repeat(-octave)
}

function splitDuration (units) {
  const pieces = []
  let left = units
  while (left > 0) {
    const piece = DURATIONS.find((d) => d <= left)
    pieces.push(piece)
    left -= piece
  }
  return pieces
}

// One line out of a polyphonic part: on the sixteenth grid, the highest note wins
// wherever two start together, and every note stops where the next one begins.
function monophonic (part, unitTicks) {
  if (!part) return []
  const byStart = new Map()
  for (const note of part.notes) {
    const start = Math.round(note.start / unitTicks)
    const end = Math.max(start + 1, Math.round(note.end / unitTicks))
    const held = byStart.get(start)
    if (!held || note.pitch > held.pitch) byStart.set(start, { start, end, pitch: note.pitch })
  }
  const line = [...byStart.values()].sort((a, b) => a.start - b.start)
  for (let i = 0; i < line.length - 1; i++) line[i].end = Math.min(line[i].end, line[i + 1].start)
  return line
}

// Singers need a singable register; a melody written an octave off is moved as a whole.
function fitVocalRange (line) {
  if (!line.length) return 0
  const sorted = line.map((note) => note.pitch).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let shift = 0
  while (median + shift > 76) shift -= 12
  while (median + shift < 55) shift += 12
  for (const note of line) note.pitch += shift
  return shift
}

const TRIADS = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]]]

// The chord of one stretch of music, from everything sounding in it. The lowest note
// counts double because it usually names the root; ties go to a root in the bass,
// then to a chord that belongs to the key.
function chordOf (weights, lowest, signature) {
  const w = weights.slice()
  const total = w.reduce((s, x) => s + x, 0)
  if (!total) return null
  if (lowest !== null) w[lowest % 12] *= 2
  let best = null
  for (let root = 0; root < 12; root++) {
    for (const [quality, intervals] of TRIADS) {
      const inside = intervals.reduce((sum, step) => sum + w[(root + step) % 12], 0)
      const diatonic = intervals.every((step) => {
        const { alter, letter } = spell(root + step, signature)
        return alter === signature.alter[letter]
      })
      const score = inside - 0.5 * (total - inside) - (quality === 'dim' ? 0.5 : 0) +
        (lowest !== null && lowest % 12 === root ? 0.3 : 0) + (diatonic ? 0.2 : 0)
      if (!best || score > best.score) best = { score, root, quality }
    }
  }
  const { letter, alter } = spell(best.root, signature)
  return `${letter}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}${best.quality}`
}

// Chord symbols per bar as { offset: symbol }. A bar is read whole, and again in two
// halves; when the halves disagree the bar changes chord in the middle.
function chordMap (parts, unitTicks, barUnits, bars, signature) {
  const halves = barUnits % 2 === 0 && barUnits >= 8
  const span = halves ? barUnits / 2 : barUnits
  const slots = bars * (barUnits / span)
  const weights = Array.from({ length: slots }, () => new Array(12).fill(0))
  const lowest = new Array(slots).fill(null)
  for (const part of parts) {
    for (const note of part.notes) {
      const start = note.start / unitTicks
      const end = note.end / unitTicks
      for (let slot = Math.floor(start / span); slot < slots && slot * span < end; slot++) {
        const from = Math.max(start, slot * span)
        const to = Math.min(end, (slot + 1) * span)
        if (to <= from) continue
        weights[slot][note.pitch % 12] += to - from
        if (lowest[slot] === null || note.pitch < lowest[slot]) lowest[slot] = note.pitch
      }
    }
  }
  const map = []
  let previous = null
  for (let bar = 0; bar < bars; bar++) {
    const chords = {}
    if (halves) {
      const [a, b] = [bar * 2, bar * 2 + 1]
      const first = chordOf(weights[a], lowest[a], signature)
      const second = chordOf(weights[b], lowest[b], signature)
      const whole = chordOf(weights[a].map((x, i) => x + weights[b][i]),
        [lowest[a], lowest[b]].filter((x) => x !== null).sort((x, y) => x - y)[0] ?? null, signature)
      if (first && second && first !== second) {
        chords[0] = first
        chords[span] = second
      } else if (whole) {
        chords[0] = whole
      }
    } else {
      const only = chordOf(weights[bar], lowest[bar], signature)
      if (only) chords[0] = only
    }
    // The native writer marks every bar's chord, repeated or not; so does this.
    if (!Object.keys(chords).length && previous) chords[0] = previous
    const offsets = Object.keys(chords).map(Number).sort((x, y) => x - y)
    if (offsets.length) previous = chords[offsets[offsets.length - 1]]
    map.push(chords)
  }
  return map
}

// Writes one voice, bar by bar. Accidentals are tracked per bar and per letter, across
// octaves, the way the native writer does; tie continuations are left unmarked. A chord
// change inside a held note splits it with a tie, as the dialect requires.
function voiceBars (line, bars, barUnits, signature, chordRows) {
  const out = []
  let index = 0
  let carry = null // a note still sounding from the previous bar: { pitch, spelled, left }
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barUnits
    const barEnd = barStart + barUnits
    const chords = (chordRows && chordRows[bar]) || {}
    const cuts = Object.keys(chords).map(Number).filter((offset) => offset > 0)
    const tokens = []
    const local = {}
    let cursor = barStart
    let sounding = false
    if (chords[0]) tokens.push(`"${chords[0]}"`)

    // Emits a note (or rest) from `from` to `to`, cut at chord changes. Only the first
    // piece of a fresh note is an attack; the rest are tied continuations.
    const emit = (from, to, text, isNote, tieAtEnd) => {
      const bounds = [from, ...cuts.map((cut) => barStart + cut).filter((at) => at > from && at < to), to]
      for (let i = 0; i < bounds.length - 1; i++) {
        // A chord changes where this piece starts — inside a held note, or exactly
        // where a note or rest begins.
        const offset = bounds[i] - barStart
        if (offset > 0 && chords[offset]) tokens.push(`"${chords[offset]}"`)
        const pieces = splitDuration(bounds[i + 1] - bounds[i])
        pieces.forEach((piece, j) => {
          const last = i === bounds.length - 2 && j === pieces.length - 1
          const tie = isNote && (!last || tieAtEnd) ? '-' : ''
          tokens.push(`${isNote ? text : 'z'}${piece === 1 ? '' : piece}${tie}`)
        })
      }
    }
    const written = (pitch, spelled, continuation) => {
      let prefix = ''
      if (!continuation) {
        const implied = local[spelled.letter] ?? signature.alter[spelled.letter]
        if (implied !== spelled.alter) {
          prefix = { 0: '=', 1: '^', 2: '^^', '-1': '_', '-2': '__' }[spelled.alter]
          local[spelled.letter] = spelled.alter
        }
      }
      return prefix + noteText(pitch, spelled)
    }
    // Every token after the first attack is written without its accidental.
    const noteEmit = (from, to, pitch, spelled, continuation, tieAtEnd) => {
      const first = written(pitch, spelled, continuation)
      const bare = noteText(pitch, spelled)
      const before = tokens.length
      emit(from, to, bare, true, tieAtEnd)
      tokens[before] = tokens[before].replace(bare, first)
    }

    if (carry) {
      const units = Math.min(carry.left, barUnits)
      carry.left -= units
      noteEmit(cursor, cursor + units, carry.pitch, carry.spelled, true, carry.left > 0)
      cursor += units
      sounding = true
      if (carry.left <= 0) carry = null
    }
    while (!carry && index < line.length && line[index].start < barEnd) {
      const note = line[index++]
      if (note.start < cursor) continue // swallowed by a longer note
      if (note.start > cursor) emit(cursor, note.start, 'z', false, false)
      const spelled = spell(note.pitch, signature)
      const inBarEnd = Math.min(note.end, barEnd)
      const left = note.end - inBarEnd
      noteEmit(note.start, inBarEnd, note.pitch, spelled, false, left > 0)
      if (left > 0) carry = { pitch: note.pitch, spelled, left }
      cursor = inBarEnd
      sounding = true
    }
    if (cursor < barEnd) emit(cursor, barEnd, 'z', false, false)
    // A bar with nothing in it is the whole-bar rest, unless a chord sits on it.
    out.push(!sounding && !Object.keys(chords).length ? 'Z' : tokens.join(''))
  }
  return out
}

const METER_OK = (n, d) => [1, 2, 4, 8, 16].includes(d) && Number.isInteger((n * 16) / d)

function midiToAbc (midi, { vocal = '', ins = '', chords = true } = {}) {
  const notes = []
  const parts = partsOf(midi)
  const find = (id) => parts.find((part) => part.id === id) || null
  const vocalPart = find(vocal)
  const insPart = find(ins)
  if (!vocalPart && !insPart) throw new Error('보컬이나 반주 멜로디로 쓸 트랙을 하나 이상 골라주세요.')
  const unitTicks = midi.ppq / 4

  const tempo = Math.round((midi.tempos.find((t) => t.tick === 0) || midi.tempos[0] || { bpm: 120 }).bpm)
  if (new Set(midi.tempos.map((t) => Math.round(t.bpm))).size > 1) {
    notes.push(`템포가 중간에 바뀌는 곡입니다. 처음 템포(${tempo} BPM)로 맞췄습니다`)
  }
  let meter = midi.meters[0] || { n: 4, d: 4 }
  if (!METER_OK(meter.n, meter.d)) {
    notes.push(`${meter.n}/${meter.d} 박자는 쓸 수 없어 4/4로 바꿨습니다`)
    meter = { n: 4, d: 4 }
  }
  if (new Set(midi.meters.map((m) => `${m.n}/${m.d}`)).size > 1) {
    notes.push(`박자가 중간에 바뀌는 곡입니다. 처음 박자(${meter.n}/${meter.d})로 맞췄습니다`)
  }
  const barUnits = (meter.n * 16) / meter.d

  const harmonic = parts.filter((part) => !part.drums)
  let key
  const signatureEvent = midi.keys[0]
  if (signatureEvent && signatureEvent.sf >= -7 && signatureEvent.sf <= 7) {
    key = (signatureEvent.minor ? MINOR_KEYS : MAJOR_KEYS)[signatureEvent.sf + 7]
  } else {
    key = estimateKey(harmonic.flatMap((part) => part.notes))
    notes.push(`조표가 없어 음을 보고 ${key} 조로 정했습니다`)
  }
  const signature = keySignature(key)

  const vocalLine = monophonic(vocalPart, unitTicks)
  const insLine = monophonic(insPart, unitTicks)
  const shift = fitVocalRange(vocalLine)
  if (shift) notes.push(`보컬 멜로디를 부르기 좋은 음역으로 ${Math.abs(shift / 12)}옥타브 ${shift > 0 ? '올렸' : '내렸'}습니다`)
  for (const [part, line, label] of [[vocalPart, vocalLine, '보컬'], [insPart, insLine, '반주']]) {
    if (part && part.chordy > 0.2) notes.push(`${label} 트랙에 화음이 있어 가장 높은 음만 남겼습니다`)
    if (part && line.length < part.count * 0.9 && part.chordy <= 0.2) {
      notes.push(`${label} 트랙의 짧게 겹친 음 일부를 정리했습니다`)
    }
  }

  const lastUnit = Math.max(0, ...[...vocalLine, ...insLine].map((note) => note.end))
  const bars = Math.max(1, Math.ceil(lastUnit / barUnits))
  // Chords are read from the accompaniment. A melody alone does not say which chord
  // lies under it, and a guessed one would steer the arrangement wrongly.
  const accompaniment = harmonic.filter((part) => part !== vocalPart)
  let withChords = chords
  if (chords && !accompaniment.length) {
    withChords = false
    notes.push('화음을 알 수 있는 반주 트랙이 없어 코드 없이 멜로디만 넣었습니다')
  }
  const chordRows = withChords ? chordMap(harmonic, unitTicks, barUnits, bars, signature) : null
  const vocalBars = voiceBars(vocalLine, bars, barUnits, signature, chordRows)
  const insBars = voiceBars(insLine, bars, barUnits, signature, null)

  const lines = ['X:1', 'T:', `M:${meter.n}/${meter.d}`, 'L:1/16', `Q:1/4=${tempo}`,
    'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"',
    'V: Ins clef=treble name="Ins Melody" snm="Inst."',
    `K:${key}`]
  for (let bar = 0; bar < bars; bar += 4) {
    lines.push('V: Vocal', vocalBars.slice(bar, bar + 4).join('|') + '|')
    lines.push('V: Ins', insBars.slice(bar, bar + 4).join('|') + '|')
  }
  const seconds = (bars * barUnits / 4) * 60 / tempo
  if (seconds > 355) notes.push(`곡 길이가 약 ${Math.round(seconds / 60)}분입니다. 6분을 넘는 부분은 만들어지지 않습니다`)
  return {
    abc: lines.join('\n') + '\n',
    tempo, meter: `${meter.n}/${meter.d}`, key, bars, seconds,
    vocalNotes: vocalLine.length, insNotes: insLine.length, chords: Boolean(withChords),
    notes
  }
}

// What the renderer shows for picking parts; the note lists stay here.
function describeParts (parts) {
  const name = (pitch) => `${SHARP_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
  return parts.map((part) => ({
    id: part.id, name: part.name, drums: part.drums, count: part.count,
    range: part.count ? `${name(part.low)}–${name(part.high)}` : '',
    chordy: part.chordy > 0.2
  }))
}

module.exports = { parseMidi, partsOf, suggestParts, midiToAbc, describeParts }
