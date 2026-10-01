'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseCaptions, MAX_BYTES } = require('../core/captions.cjs');
async function readCaptions(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('2 MiB 이하의 자막 파일을 선택해 주세요.');
    const buffer = Buffer.alloc(MAX_BYTES + 1); let bytesRead = 0;
    while (bytesRead < buffer.length) { const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead); if (!chunk.bytesRead) break; bytesRead += chunk.bytesRead; }
    if (bytesRead > MAX_BYTES) throw Error('자막 파일이 너무 큽니다.');
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)); }
    catch { throw Error('자막 파일을 UTF-8 인코딩으로 저장한 뒤 다시 가져와 주세요.'); }
    return parseCaptions(text, path.extname(file).slice(1).toLowerCase());
  } finally { await handle.close(); }
}
async function writeSrt(file, contents) {
  if (path.extname(file).toLowerCase() !== '.srt') throw Error('SRT 출력 경로를 선택해 주세요.');
  const parent = await fs.realpath(path.dirname(file)), target = path.join(parent, path.basename(file));
  const existing = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw Error('일반 파일에만 저장할 수 있습니다.');
  const temp = path.join(parent, `.ocut-caption-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    const now = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (Boolean(existing) !== Boolean(now) || now && (now.ino !== existing.ino || now.mtimeMs !== existing.mtimeMs || now.size !== existing.size)) throw Error('저장 중 자막 파일이 변경되었습니다.');
    await fs.rename(temp, target); return target;
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
module.exports = { readCaptions, writeSrt };
