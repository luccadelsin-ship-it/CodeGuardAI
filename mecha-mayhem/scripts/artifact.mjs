// Post-build step for `npm run build:artifact`: makes dist-artifact publishable as a claude.ai Artifact.
// - converts every .glb to glTF JSON with an embedded base64 buffer (the host does not serve .glb)
// - drops files the game never loads in that build
// - writes mecha-mayhem.html: the page body without the <html>/<head>/<body> wrapper the host adds
import { readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-artifact';
const unused = ['assets/physics', 'assets/models/striker/striker_head.glb', 'assets/models/striker/striker_legs.glb',
  'assets/models/striker/striker_torso_arms.glb', 'assets/models/striker/striker_weapon.glb', 'assets/sketchfab/ATTRIBUTION.md', 'favicon.svg'];
for (const p of unused) rmSync(join(out, p), { recursive: true, force: true });

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

for (const file of walk(out).filter((p) => p.endsWith('.glb'))) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  let offset = 12; let json = null; let bin = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset); const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/, ''));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + len;
  }
  if (bin && json.buffers?.length) {
    json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  }
  writeFileSync(file.replace(/\.glb$/, '.gltf.json'), JSON.stringify(json));
  rmSync(file);
}

const html = readFileSync(join(out, 'index.html'), 'utf8');
let head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
head = head.replace(/\s*<meta charset[^>]*>/, '').replace(/\s*<meta name="viewport"[^>]*>/, '')
  .replace(/\s*<link rel="icon"[^>]*>/, '').replace(/<title>[\s\S]*?<\/title>/, '<title>Mecha Mayhem</title>');
const style = '<style>html,body{height:100%;background:#07101b;color:#e9f2ff;overflow:hidden}</style>';
writeFileSync(join(out, 'mecha-mayhem.html'), `${head.trim()}\n    ${style}\n${body.trim()}\n`);

const files = walk(out).map((p) => p.slice(out.length + 1)).filter((p) => p.startsWith('assets/'));
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.fromEntries(files.map((p) => [p, p]))));
console.log(`artifact ready: ${files.length} supporting files`);
