'use strict'
// ── Prompt building for YuE2 ─────────────────────────────────────────────────
// YuE2 reads a single text block (yue2/protocol.py, SongRequest.text):
//
//   <instruction>
//   [Tags]
//   <style>
//   [Lyrics]
//   <lyrics>
//
// Everything typed in the app lands in one of those two slots, which makes the
// failure modes specific. A [bracket] or a sentence in the style reads like the start
// of the lyrics and gets sung or spoken. A Suno-style [Mood: sad] in the lyrics is not
// a section the model knows, so it gets sung as well. And the score (ABC) the model
// plans has only a vocal line, one instrumental line and chord symbols: which
// instrument plays is decided later, from the style text alone.

// ── instruments ──
// value = the English tag YuE2 was trained on; mass = not countable ("two drums").
const INSTRUMENTS = [
  { value: 'piano', label: '피아노' },
  { value: 'acoustic guitar', label: '어쿠스틱 기타' },
  { value: 'classical guitar', label: '클래식 기타 (나일론)' },
  { value: 'electric guitar', label: '일렉 기타' },
  { value: 'bass guitar', label: '베이스 기타' },
  { value: 'upright bass', label: '콘트라베이스' },
  { value: 'drums', label: '드럼', mass: true },
  { value: 'brushed drums', label: '브러시 드럼', mass: true },
  { value: 'percussion', label: '퍼커션', mass: true },
  { value: 'violin', label: '바이올린' },
  { value: 'viola', label: '비올라' },
  { value: 'cello', label: '첼로' },
  { value: 'string ensemble', label: '현악 합주', mass: true },
  { value: 'harp', label: '하프' },
  { value: 'flute', label: '플루트' },
  { value: 'clarinet', label: '클라리넷' },
  { value: 'oboe', label: '오보에' },
  { value: 'saxophone', label: '색소폰' },
  { value: 'trumpet', label: '트럼펫' },
  { value: 'trombone', label: '트롬본' },
  { value: 'french horn', label: '호른' },
  { value: 'brass section', label: '브라스 섹션', mass: true },
  { value: 'pipe organ', label: '파이프 오르간' },
  { value: 'Rhodes electric piano', label: '일렉 피아노 (로즈)' },
  { value: 'synthesizer', label: '신시사이저' },
  { value: 'synth pads', label: '신스 패드', mass: true },
  { value: 'celesta', label: '첼레스타' },
  { value: 'glockenspiel', label: '글로켄슈필' },
  { value: 'sleigh bells', label: '썰매 방울', mass: true },
  { value: 'music box', label: '오르골' },
  { value: 'marimba', label: '마림바' },
  { value: 'vibraphone', label: '비브라폰' },
  { value: 'ukulele', label: '우쿨렐레' },
  { value: 'mandolin', label: '만돌린' },
  { value: 'harmonica', label: '하모니카' },
  { value: 'accordion', label: '아코디언' },
  { value: 'orchestra', label: '오케스트라', mass: true }
]
const NUMBERS = { 2: 'two', 3: 'three' }

const plural = (name) => name.endsWith('s') ? name : `${name}s`

// Turns picked instruments into the phrasing the model knows: "solo piano",
// "two classical guitars, classical guitar duet", "piano, violin and cello trio".
function instrumentPhrase (values, { instrumental = false } = {}) {
  const picked = (values || []).filter(Boolean)
  if (!picked.length) return ''
  const groups = []
  for (const value of picked) {
    const group = groups.find((item) => item.value === value)
    if (group) group.count += 1
    else groups.push({ value, count: 1 })
  }
  const info = (value) => INSTRUMENTS.find((item) => item.value === value) || {}
  const words = groups.map(({ value, count }) =>
    count > 1 && !info(value).mass ? `${NUMBERS[count] || count} ${plural(value)}` : value)
  const list = words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  if (picked.length === 1) {
    const [only] = picked
    return instrumental ? `solo ${only}, ${only} only` : `${only} only accompaniment`
  }
  // An ensemble word only makes sense for countable players.
  if (groups.some(({ value }) => info(value).mass)) return list
  const ensemble = picked.length === 2 ? 'duet' : 'trio'
  return groups.length === 1 ? `${list}, ${groups[0].value} ${ensemble}` : `${list} ${ensemble}`
}

// ── style ──
// "No vocals" alone still lets humming, choirs, chants and spoken lines through —
// they are not singing in the model's terms. Name each one.
const NO_VOICE = 'instrumental only, no vocals, no singing, no humming, no choir, ' +
  'no chanting, no spoken word, no narration, no vocal samples, no ad-libs, ' +
  'no vocal chops, no backing vocals, melody carried by lead instrument'

function instrumentalStyle (style) {
  return style.toLowerCase().includes('no humming') ? style : `${style}, ${NO_VOICE}`
}

// Keeps an ensemble to the instruments the prompt names — otherwise the model tends
// to add drums and pads to a string quartet.
const ONLY_LISTED = 'only the instruments listed above and nothing else, ' +
  'no additional instruments, no drum kit, no percussion unless listed, ' +
  'no synthesizers, no electronic elements, no sound effects, sparse clean arrangement'

function onlyListedStyle (style) {
  return style.toLowerCase().includes('nothing else') ? style : `${style}, ${ONLY_LISTED}`
}

// Style is a list of short tags. Brackets, line breaks and sentences are what get
// read out loud, so they are taken apart here.
const STYLE_LABEL = /\b(style|genre|tags?|instruments?|instrumentation|mood|vibe|tempo)\s*[:：]\s*/gi

function sanitizeStyle (raw) {
  const notes = []
  let text = String(raw || '').replace(/\r\n?/g, '\n')
  const brackets = text.match(/\[[^\]]*\]/g) || []
  if (brackets.length) {
    text = text.replace(/\[[^\]]*\]/g, ' ')
    notes.push(`스타일의 [ ] 태그 ${brackets.length}개를 뺐습니다 (가사처럼 읽힐 수 있어서)`)
  }
  text = text
    .replace(STYLE_LABEL, '')
    .replace(/["“”]/g, '')
    .replace(/[.!?。]+(?=\s|$|,)/g, ',')
    .replace(/[\n;|/]+/g, ',')
  const seen = new Set()
  const parts = []
  const sentences = []
  for (const part of text.split(/,|，|、/)) {
    const tag = part.replace(/\s+/g, ' ').trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    // The official examples keep every tag to a handful of words. Past ten it is
    // prose, and prose in [Tags] is what comes out as narration.
    if (tag.split(' ').length > 10) {
      sentences.push(tag)
      continue
    }
    parts.push(tag)
  }
  if (sentences.length) {
    notes.push(`스타일의 긴 문장 ${sentences.length}개를 뺐습니다 (나레이션으로 읽힐 수 있어서). 짧은 단어로 나눠 적어주세요`)
  }
  return { text: parts.join(', '), notes, dropped: sentences }
}

// Assembles what goes into [Tags], in the shape of the official examples:
// "English, warm female vocal, contemporary pop, 96 BPM, piano, rounded electric bass".
function composeStyle ({ genre = '', instruments = [], bpm = null, strict = false,
  instrumental = false, lyrics = '' } = {}) {
  const { text, notes } = sanitizeStyle(genre)
  let parts = text ? text.split(', ') : []
  if (!instrumental && /[가-힣]/.test(lyrics) && !/korean|한국/i.test(text)) parts.unshift('Korean')
  const tempo = Number(bpm)
  if (tempo) {
    parts = parts
      .map((part) => part.replace(/\b\d{2,3}\s*bpm\b/gi, '').trim())
      .filter(Boolean)
    parts.push(`${Math.round(tempo)} BPM`)
  }
  const phrase = instrumentPhrase(instruments, { instrumental })
  if (phrase) parts.push(phrase)
  let style = parts.join(', ')
  if (strict && style) style = onlyListedStyle(style)
  if (instrumental && style) style = instrumentalStyle(style)
  return { style, notes }
}

// ── structure ──
// Section names the model itself writes into its scores: intro, verse, pre-chorus,
// chorus, bridge, interlude, outro. Anything else is a word to sing.
const STRUCTURES = [
  { value: '', label: '기본 (인트로·벌스·코러스·브릿지·아웃트로)',
    sections: ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'] },
  { value: 'pop', label: '팝 (벌스·코러스 두 번 + 브릿지)',
    sections: ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro'] },
  { value: 'short', label: '짧게 (인트로·벌스·코러스·아웃트로)',
    sections: ['Intro', 'Verse', 'Chorus', 'Outro'] },
  { value: 'theme', label: '주제와 변주',
    sections: ['Intro', 'Verse', 'Verse', 'Interlude', 'Chorus', 'Verse', 'Outro'] },
  { value: 'loop', label: 'BGM 반복형 (A·B·A·B)',
    sections: ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'] }
]
const PLAYED_SECTIONS = ['Intro', 'Interlude', 'Outro']

// With no words to sing, the model still needs the song's shape: section markers with
// an instrumental cue keep the vocal line silent instead of inventing syllables. For
// a song with words, the same skeleton leaves room under each sung section.
function structureLyrics (value, { instrumental = false } = {}) {
  const structure = STRUCTURES.find((item) => item.value === (value || '')) || STRUCTURES[0]
  return structure.sections.map((section) =>
    instrumental || PLAYED_SECTIONS.includes(section)
      ? `[${section}]\n[instrumental]`
      : `[${section}]\n`).join('\n\n')
}
const INSTRUMENTAL_LYRICS = structureLyrics('', { instrumental: true })

// ── lyrics ──
// Decorated, numbered and Suno-style section names are folded into the ones above.
// Order matters: pre-chorus before chorus, "theme b" before "theme", and the loose
// solo/break words last, so "[Intro - piano solo]" stays an intro.
const TAG_RULES = [
  [/pre[\s-]*chorus|프리\s*코러스|build[\s-]*up|빌드\s*업/i, 'Pre-Chorus'],
  [/chorus|hook|refrain|후렴|코러스|\bdrop\b|드롭|theme\s*b|주제\s*b/i, 'Chorus'],
  [/verse|\d\s*절|벌스|\btheme\b|주제|variation|변주/i, 'Verse'],
  [/bridge|브릿지|development|전개/i, 'Bridge'],
  [/intro|인트로|전주|opening/i, 'Intro'],
  [/outro|아우트로|아웃트로|후주|coda|코다|ending|엔딩|fade/i, 'Outro'],
  [/interlude|간주|solo|솔로|\bbreak|브레이크|instrumental/i, 'Interlude']
]

// A line that is only a stage direction — "(guitar solo)", "*fade out*" — is sung
// word for word. Parenthesised echoes like "(사랑해)" are real backing vocals and stay.
const DIRECTION = /instrumental|solo|intro|outro|fade|break|drum|guitar|piano|bass|beat|bpm|tempo|key of|music|spoken|narrat|whisper|laugh|applause|repeat|x\s*\d|반복|간주|전주|연주|페이드|나레이션|내레이션|속삭/i
const LABEL_LINE = /^\s*(title|제목|style|스타일|genre|장르|tempo|템포|bpm|key|mood|분위기|instruments?|악기|vocals?|보컬|artist|가수|lyrics|가사)\s*[:：]/i
const BARE_SECTION = /^\s*(?:\*\*)?\s*((?:pre[\s-]*)?chorus|verse|bridge|intro|outro|hook|interlude|후렴|벌스|코러스|브릿지|인트로|아웃트로|간주|\d\s*절)\s*\d*\s*[:：]?\s*(?:\*\*)?\s*$/i

function sectionTag (inner) {
  if (/^\s*instrumental\s*$/i.test(inner)) return '[instrumental]'
  const rule = TAG_RULES.find(([pattern]) => pattern.test(inner))
  return rule ? `[${rule[1]}]` : null
}

function cleanLyrics (raw) {
  const notes = []
  let lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n')

  const titles = lines.filter((line) => /^\s*#/.test(line)).length
  if (titles) {
    lines = lines.filter((line) => !/^\s*#/.test(line))
    notes.push(`제목 줄 ${titles}개를 제외했습니다`)
  }

  const labels = lines.filter((line) => LABEL_LINE.test(line)).length
  if (labels) {
    lines = lines.filter((line) => !LABEL_LINE.test(line))
    notes.push(`"스타일:", "BPM:" 같은 설명 줄 ${labels}개를 뺐습니다 (스타일 칸에 적어주세요)`)
  }

  let retagged = 0
  const dropped = []
  let inline = 0
  let directions = 0
  const out = []
  for (const line of lines) {
    const whole = line.match(/^\s*\[([^\]]*)\]\s*$/)
    const bare = !whole && line.match(BARE_SECTION)
    if (whole || bare) {
      const tag = sectionTag(whole ? whole[1] : bare[1])
      if (!tag) {
        dropped.push(line.trim())
        continue
      }
      if (tag !== line.trim()) retagged += 1
      out.push(tag)
      continue
    }
    if (/^\s*[(*{（].*[)*}）]\s*$/.test(line) && DIRECTION.test(line)) {
      directions += 1
      continue
    }
    // Performance cues inside a sung line: "사랑해 [whisper]".
    const stripped = line.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+$/, '')
    if (stripped !== line.replace(/\s+$/, '')) inline += 1
    out.push(stripped.trim() ? stripped : '')
  }
  if (retagged) notes.push(`구간 태그 ${retagged}개를 YuE2가 아는 형태로 바꿨습니다`)
  if (dropped.length) {
    notes.push(`알 수 없는 태그 ${dropped.length}개를 뺐습니다 (${dropped.slice(0, 2).join(' ')}${dropped.length > 2 ? ' …' : ''}) — 가사로 불릴 수 있어서`)
  }
  if (inline) notes.push(`가사 줄 안의 [ ] 지시어 ${inline}개를 뺐습니다`)
  if (directions) notes.push(`"(기타 솔로)" 같은 지시 줄 ${directions}개를 뺐습니다`)

  // A played section with nothing under it gets the instrumental cue, so the model
  // does not borrow the next section's words for it.
  const filled = []
  for (let index = 0; index < out.length; index++) {
    filled.push(out[index])
    const match = out[index].match(/^\[(Intro|Interlude|Outro)\]$/)
    if (!match) continue
    const next = out.slice(index + 1).find((line) => line.trim())
    if (!next || /^\[(?!instrumental\])/.test(next)) filled.push('[instrumental]')
  }

  const text = filled.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, notes }
}

// ── score (ABC) ──
// What a YuE2 score holds, in words: sections, tempo, and how busy each line is. It
// also answers "was the cello already in the plan?" — the native score format has
// no field that could say so.
const SECTION_NAMES = {
  intro: '인트로', verse: '벌스', 'pre-chorus': '프리코러스', chorus: '코러스',
  bridge: '브릿지', interlude: '간주', outro: '아웃트로'
}

function countBars (music) {
  let bars = 0
  for (const token of music.split('|')) {
    const text = token.trim()
    if (!text) continue
    const rest = text.match(/^Z(\d*)$/)
    bars += rest ? Number(rest[1] || 1) : 1
  }
  return bars
}

function analyzeScore (abc) {
  const lines = String(abc || '').replace(/\r/g, '').split('\n')
  const field = (key) => {
    const line = lines.find((item) => item.startsWith(`${key}:`))
    return line ? line.slice(key.length + 1).trim() : ''
  }
  const voices = lines
    .filter((line) => /^V:\s*\S+\s+\S/.test(line))
    .map((line) => ({
      id: line.match(/^V:\s*(\S+)/)[1],
      name: (line.match(/\bname="([^"]*)"/) || [])[1] || ''
    }))
  const sections = []
  const notes = {}
  const tied = {} // per voice: the last note was tied, so the next token only continues it
  let chords = 0
  let section = null
  let voice = null
  for (const line of lines) {
    const heading = line.match(/^%\s*(.+)$/)
    if (heading && !line.startsWith('%%')) {
      section = { name: heading[1].trim().toLowerCase(), bars: 0 }
      sections.push(section)
      continue
    }
    const switched = line.match(/^V:\s*(\S+)\s*$/)
    if (switched) {
      voice = switched[1]
      continue
    }
    if (!voice || !line.trim() || /^[A-Za-z]:/.test(line) || line.startsWith('%')) continue
    chords += (line.match(/"[^"]*"/g) || []).length
    const music = line.replace(/"[^"]*"/g, '').replace(/\[[A-Za-z]:[^\]]*\]/g, '')
    if (section && voice === 'Vocal') section.bars += countBars(music)
    // Sounding notes, as the official checker counts them: a tie joins two tokens
    // into one note.
    for (const token of music.matchAll(/(?:\^\^|__|\^|_|=)?([A-Ga-gz])[,']*\d*(-?)/g)) {
      if (token[1] === 'z') {
        tied[voice] = false
        continue
      }
      if (!tied[voice]) notes[voice] = (notes[voice] || 0) + 1
      tied[voice] = token[2] === '-'
    }
  }
  // Only a nonstandard score could name instruments: extra voices or MIDI programs.
  const instrumentVoices = voices.filter((item) => !['Vocal', 'Ins'].includes(item.id))
  const midi = lines.filter((line) => /^%%MIDI\s+program/i.test(line)).length
  return {
    tempo: Number((field('Q').match(/=\s*(\d+)/) || [])[1]) || null,
    meter: field('M'),
    key: field('K'),
    voices,
    sections,
    vocalNotes: notes.Vocal || 0,
    insNotes: notes.Ins || 0,
    chords,
    namesInstruments: instrumentVoices.length > 0 || midi > 0
  }
}

// The validator speaks English and in terms of ABC internals; this says the same in
// Korean with the place it happened. Anything unrecognised is shown as it came.
const CHECK_MESSAGES = [
  [/unsupported duration (\d+)/, (m) => `음 길이 ${m[1]}은(는) 쓸 수 없습니다. 1·2·3·4·6·8·12·16·24·32·48 중 하나로 쓰고, 그 밖의 길이는 붙임줄(-)로 이어 주세요`],
  [/duration ([\d/]+) quarter notes != meter duration ([\d/]+)/, (m) => `마디 길이가 박자와 맞지 않습니다 (${m[1]}박인데 ${m[2]}박이어야 합니다)`],
  [/note\/rest exceeds meter duration/, () => '음이나 쉼표가 마디 끝을 넘어갑니다'],
  [/event after the measure end/, () => '마디가 끝난 뒤에 음이 더 있습니다'],
  [/unsupported token at '([^']*)'/, (m) => `YuE2가 모르는 기호가 있습니다: ${m[1]} (화음 [CEG], 셋잇단음, 꾸밈음, 도돌이표, 붙임표 외 장식은 쓸 수 없습니다)`],
  [/unsupported chord '([^']*)'/, (m) => `YuE2가 모르는 코드입니다: ${m[1]} (C, Cm, C7, Cmaj7, Cm7, Cdim, Caug, Csus4, C6 같은 형태만 됩니다)`],
  [/Unsupported key/, () => '쓸 수 없는 조표입니다 (장조·단조만 됩니다)'],
  [/tie changes pitch/, () => '붙임줄(-)로 이은 두 음의 높이가 다릅니다'],
  [/unresolved tie|tie enters/, () => '붙임줄(-)이 이어질 음 없이 끝났습니다'],
  [/voices have different measure counts/, () => '보컬과 반주의 마디 수가 다릅니다'],
  [/expected 1–4 measures/, () => '한 줄에는 1~4마디만 쓸 수 있습니다'],
  [/music line must end with a plain barline/, () => '줄 끝은 세로줄 | 로 끝나야 합니다'],
  [/empty measure or unsupported double\/repeat barline/, () => '빈 마디나 겹세로줄·도돌이표가 있습니다'],
  [/Incomplete native|Expected native X:1|Missing header|Expected L:|Expected integer quarter-note tempo|Preserve native Vocal and Ins|expected V: /,
    () => 'YuE2 악보 형식이 아닙니다. 머리말(X:1, T:, M:, L:, Q:, 보컬·반주 성부 두 줄, K:)이 정해진 순서로 있어야 하고, ' +
      '"V: Vocal"과 "V: Ins"가 번갈아 나와야 합니다. MIDI 파일로 불러오면 이 형식으로 자동으로 바뀝니다'],
  [/Native chord symbols belong in Vocal/, () => '코드는 보컬 줄(V: Vocal)에만 적을 수 있습니다']
]

function explainCheck (error) {
  const text = String(error || '')
  const place = text.match(/group \d+, (Vocal|Ins), bar (\d+)/)
  const where = place ? `${place[1] === 'Vocal' ? '보컬' : '반주'} ${place[2]}번째 마디: ` : ''
  for (const [pattern, say] of CHECK_MESSAGES) {
    const match = text.match(pattern)
    if (match) return where + say(match)
  }
  return text
}

if (typeof module !== 'undefined') {
  module.exports = {
    INSTRUMENTS, instrumentPhrase, sanitizeStyle, composeStyle, NO_VOICE, ONLY_LISTED,
    STRUCTURES, structureLyrics, INSTRUMENTAL_LYRICS, cleanLyrics, analyzeScore, SECTION_NAMES,
    explainCheck
  }
}
