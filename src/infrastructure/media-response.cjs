'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Readable } = require('node:stream');
const MIME = { '.mp4':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.mkv':'video/x-matroska', '.avi':'video/x-msvideo', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.aac':'audio/aac', '.flac':'audio/flac', '.ogg':'audio/ogg', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };
// Caller authorizes an asset ID first. Never accepts a path from the request URL.
async function mediaResponse(request, file) {
  let stat; try { stat = await fs.promises.stat(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const headers = { 'Access-Control-Allow-Origin':'*', 'Accept-Ranges':'bytes', 'Content-Type':MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store' };
  let start = 0, end = stat.size - 1, status = 200;
  const range = request.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !stat.size || !match[1] && !match[2]) return new Response(null, { status:416, headers:{ ...headers, 'Content-Range':`bytes */${stat.size}` } });
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, stat.size - suffix); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) return new Response(null, { status:416, headers:{ ...headers, 'Content-Range':`bytes */${stat.size}` } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  const body = request.method === 'HEAD' || !stat.size ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status, headers });
}
module.exports = { mediaResponse };
