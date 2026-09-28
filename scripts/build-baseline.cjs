const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
async function main() {
  const { createPackageWithOptions, extractFile } = await import('@electron/asar');
  const input = path.join(root, 'original/extracted');
  const out = path.join(root, 'dist/baseline');
  fs.mkdirSync(out, { recursive: true });
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    if (entry.name === 'resources') continue;
    fs.cpSync(path.join(input, entry.name), path.join(out, entry.name === 'ssokMusic Free.exe' ? 'O-CUT.exe' : entry.name), { recursive: true });
  }
  fs.mkdirSync(path.join(out, 'resources'), { recursive: true });
  const archive = path.join(out, 'resources/app.asar');
  await createPackageWithOptions(path.join(root, 'baseline'), archive, { unpackDir: '{python,electron}' });
  const pkg = JSON.parse(extractFile(archive, 'package.json'));
  if (pkg.name !== 'o-cut-baseline') throw Error('Wrong package identity');
  for (const file of ['python/worker.py','electron/spectrum-worker.js','electron/spectrum-analysis.js']) {
    if (!fs.existsSync(archive + '.unpacked/' + file)) throw Error('Missing unpacked worker: ' + file);
  }
  const result = { time: new Date().toISOString(), type: 'source-repacked Electron application (not a new Electron compilation or installer)', executable: path.join(out, 'O-CUT.exe'), electron: '33.4.11', package: pkg, asarSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') };
  fs.writeFileSync(path.join(root, 'evidence/phase0/build.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
