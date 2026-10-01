'use strict';
const MAX_BYTES = 2 * 1024 * 1024, MAX_CUES = 5000;
function timestamp(value, vtt = false) {
  const match = value.match(vtt ? /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/ : /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw Error(`잘못된 자막 시간: ${value}`);
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  if (seconds > 28800) throw Error('자막은 최대 8시간까지 지원합니다.');
  return seconds;
}
function plainText(value, warnings) {
  let text = value.replace(/<br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\/?(?:b|i|u|c|v|lang|ruby|rt|font)(?:[.\s][^>]*)?>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/gi, () => { warnings.add('글꼴 서식·화자·단어별 타이밍은 일반 텍스트로 가져왔습니다.'); return ''; });
  const entities = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '\u200e', rlm: '\u200f' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|nbsp|quot|apos|lrm|rlm);/gi, (all, name) => {
    if (name[0] !== '#') return entities[name.toLowerCase()];
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  }).trim();
}
function parseCaptions(raw, format) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES || raw.includes('\0')) throw Error('자막 파일은 2 MiB 이하의 텍스트여야 합니다.');
  if (!['srt', 'vtt'].includes(format)) throw Error('SRT 또는 VTT 파일을 선택해 주세요.');
  let source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const vtt = format === 'vtt', warnings = new Set(), segments = [];
  if (vtt) {
    if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(source)) throw Error('WEBVTT 파일 헤더가 없습니다.');
    const firstBreak = /\n[ \t]*\n/.exec(source);
    if (!firstBreak) throw Error('WEBVTT 헤더 뒤에 빈 줄과 자막이 필요합니다.');
    source = source.slice(firstBreak.index + firstBreak[0].length);
  }
  for (const block of source.split(/\n[ \t]*\n+/)) {
    if (!block.trim()) continue;
    if (vtt && /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) {
      if (!block.startsWith('NOTE')) warnings.add('VTT 스타일·영역 설정은 적용하지 않았습니다.');
      continue;
    }
    const lines = block.split('\n');
    if (!lines[0].includes('-->')) {
      if (!vtt && !/^\d+$/.test(lines[0].trim())) throw Error('SRT 자막 번호 또는 시간이 잘못되었습니다.');
      lines.shift();
    }
    const times = (lines.shift() || '').match(/^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/);
    if (!times) throw Error('자막 시간 구간을 읽을 수 없습니다.');
    const startTime = timestamp(times[1], vtt), end = timestamp(times[2], vtt);
    if (end <= startTime) throw Error('자막 종료 시간은 시작보다 뒤여야 합니다.');
    if (times[3]) warnings.add('자막 배치 설정은 기본 위치로 가져왔습니다.');
    const text = plainText(lines.join('\n'), warnings);
    if (!text || text.length > 2000) throw Error('자막 한 구간은 1–2000자여야 합니다.');
    segments.push({ startTime, duration: end - startTime, text });
    if (segments.length > MAX_CUES) throw Error('한 번에 5000개 이하의 자막을 가져와 주세요.');
  }
  if (!segments.length) throw Error('가져올 자막이 없습니다.');
  return { segments: segments.sort((a, b) => a.startTime - b.startTime), warnings: [...warnings] };
}
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 28800000) throw Error('SRT 출력 시간 범위를 초과했습니다.');
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function serializeSrt(project, trackId) {
  const track = project.tracks.find(t => t.id === trackId && t.type === 'subtitle');
  if (!track) throw Error('저장할 자막 트랙을 선택해 주세요.');
  const clips = project.clips.filter(c => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
  if (!clips.length) throw Error('저장할 자막이 없습니다.');
  return clips.map((c, i) => {
    if (Math.round(c.duration * 1000) < 1 || !c.text.trim()) throw Error('내용과 길이가 있는 자막만 저장할 수 있습니다.');
    const text = c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?/g, '\n');
    if (/\n[ \t]*\n/.test(text)) throw Error('SRT 자막 안의 빈 줄을 제거해 주세요.');
    return `${i + 1}\n${srtTime(c.startTime)} --> ${srtTime(c.startTime + c.duration)}\n${text}`;
  }).join('\n\n') + '\n';
}
module.exports = { parseCaptions, serializeSrt, timestamp, srtTime, MAX_BYTES, MAX_CUES };
