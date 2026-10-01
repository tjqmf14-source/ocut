'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { mediaResponse } = require('../src/infrastructure/media-response.cjs');
test('media byte range response has correct 206, length, content range and exact bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocut-range-')), file = path.join(dir, 'sample.mp4'); await fs.writeFile(file, '0123456789');
  const r = await mediaResponse(new Request('https://local.test/a', { headers:{ Range:'bytes=2-4' } }),file);
  assert.equal(r.status,206); assert.equal(r.headers.get('Content-Length'),'3'); assert.equal(r.headers.get('Content-Range'),'bytes 2-4/10'); assert.equal(await r.text(),'234');
  const full = await mediaResponse(new Request('https://local.test/a'),file); assert.equal(full.status,200); assert.equal(full.headers.get('Content-Length'),'10'); assert.equal(await full.text(),'0123456789');
});
test('media range suffix, HEAD and unsatisfiable ranges never overread', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocut-range-')), file = path.join(dir, 'sample.wav'); await fs.writeFile(file,'0123456789');
  const suffix = await mediaResponse(new Request('https://local.test/a',{headers:{Range:'bytes=-3'}}),file); assert.equal(await suffix.text(),'789');
  const head = await mediaResponse(new Request('https://local.test/a',{method:'HEAD',headers:{Range:'bytes=3-'}}),file); assert.equal(head.status,206); assert.equal(head.headers.get('Content-Length'),'7'); assert.equal(await head.text(),'');
  for (const range of ['bytes=20-','bytes=4-2','bytes=-0','bytes=0-1,4-5','bytes=-','not-a-range']) { const r = await mediaResponse(new Request('https://local.test/a',{headers:{Range:range}}),file); assert.equal(r.status,416); assert.equal(await r.text(),''); }
});
