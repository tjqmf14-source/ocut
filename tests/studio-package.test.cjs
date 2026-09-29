'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('studio ASAR contains exactly current source bytes without stale files', async () => {
  const asar = await import('@electron/asar'), archive = path.join(root, 'dist/studio/resources/app.asar');
  const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => fs.statSync(path.join(root, 'src', f)).isFile());
  for (const file of files) assert.deepEqual(asar.extractFile(archive, path.join('src', file)), fs.readFileSync(path.join(root, 'src', file)), file);
  const packaged = asar.listPackage(archive).filter(f => f.startsWith('\\src\\') || f.startsWith('/src/')).filter(f => !asar.statFile(archive, f.slice(1)).files);
  assert.equal(packaged.length, files.length);
});
