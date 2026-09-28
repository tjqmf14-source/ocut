const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'original/extracted/resources/app.asar');
const destination = path.join(root, 'original/source');
const bytes = fs.readFileSync(archive);
const header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
const dataStart = 8 + bytes.readUInt32LE(4);
const manifest = [];
function walk(files, prefix = '') {
  for (const [name, entry] of Object.entries(files)) {
    if (name === '..' || name === '.' || /[\\/:]/.test(name) || entry.link) throw Error('Unsafe archive entry');
    const relative = prefix + name;
    if (entry.files) { walk(entry.files, relative + '/'); continue; }
    const offset = Number(entry.offset);
    const data = entry.unpacked ? fs.readFileSync(archive + '.unpacked/' + relative) : bytes.subarray(dataStart + offset, dataStart + offset + entry.size);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    if (data.length !== entry.size || hash !== entry.integrity?.hash) throw Error('Integrity mismatch: ' + relative);
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    manifest.push({ path: relative, size: data.length, sha256: hash, unpacked: !!entry.unpacked });
  }
}
walk(header.files);
fs.writeFileSync(path.join(root, 'evidence/phase0/source-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Verified and extracted ${manifest.length} files`);
