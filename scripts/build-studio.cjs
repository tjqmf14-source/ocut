'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
async function main() {
  const { createPackageWithOptions } = await import('@electron/asar');
  const out = path.join(root, 'dist/studio');
  fs.mkdirSync(path.join(root, '.runtime'), { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, '.runtime/studio-package-'));
  const input = path.join(root, 'original/extracted');
  fs.mkdirSync(staging, { recursive: true });
  const manifest = [];
  function copy(dir, relative = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(relative, e.name); const source = path.join(dir, e.name);
      if (e.isDirectory()) { copy(source, name); continue; }
      if (/\.(cjs|js)$/.test(e.name)) execFileSync(process.execPath, ['--check', source]);
      const target = path.join(staging, 'src', name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
      manifest.push({ file: name.replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
    }
  }
  copy(path.join(root, 'src'));
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'o-cut-studio', productName: 'O-CUT', version: '0.9.0', private: true, main: 'src/desktop/main.cjs' }));
  fs.mkdirSync(out, { recursive: true });
  for (const e of fs.readdirSync(input)) {
    if (e === 'resources') continue;
    fs.cpSync(path.join(input, e), path.join(out, e === 'ssokMusic Free.exe' ? 'O-CUT.exe' : e), { recursive: true });
  }
  fs.mkdirSync(path.join(out, 'resources'), { recursive: true });
  const musicWorker=path.join(out,'resources/music-worker');fs.mkdirSync(musicWorker,{recursive:true});
  fs.copyFileSync(path.join(root,'baseline/python/worker.py'),path.join(musicWorker,'worker.py'));
  fs.writeFileSync(path.join(musicWorker,'PROVENANCE.txt'),'Preserved local generation worker from the supplied ssokMusic Free 0.50.2 archive. Source: baseline/python/worker.py. Unmodified; separate from the O-CUT UI.\n');
  const transcription=path.join(out,'resources/transcribe');fs.mkdirSync(transcription,{recursive:true});fs.copyFileSync(path.join(root,'src/infrastructure/transcribe.py'),path.join(transcription,'transcribe.py'));
  await createPackageWithOptions(staging, path.join(out, 'resources/app.asar'), {});
  fs.mkdirSync(path.join(root, 'evidence/studio'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence/studio/build.json'), JSON.stringify({ time: new Date().toISOString(), executable: path.join(out, 'O-CUT.exe'), files: manifest }, null, 2));
  console.log('O-CUT build PASS:', manifest.length, 'source files');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
