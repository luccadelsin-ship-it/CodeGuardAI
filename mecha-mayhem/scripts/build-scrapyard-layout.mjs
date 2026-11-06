// Builds public/assets/models/scrapyard.layout.json from the Ferro-Velho Titã collision volumes
// authored in Blender (docs/maps/ferro_velho_tita/colisoes_mapa.json).
// Blender is Z-up; the game is Y-up: game (x, y, z) = blender (x, z, -y), and a Blender rotation
// around Z becomes rot = -rotationZ around the game's Y axis.
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync('docs/maps/ferro_velho_tita/colisoes_mapa.json', 'utf8'));
const FLOOR_TOP = -0.075; // top of the concrete slab in Blender; the game deck is y = 0
const r2 = (n) => Math.round(n * 100) / 100;
const cover = [];
for (const c of src.colliders) {
  if (c.name === 'piso' || c.name.startsWith('limite_')) continue; // floor and outer walls: the deck rectangle
  const [bx, by, bz] = c.center;
  const [sx, sy, sz] = c.size;
  const top = bz + sz / 2 - FLOOR_TOP;
  const item = { id: c.id, name: c.name, x: r2(bx), z: r2(-by), widthX: r2(sx), widthZ: r2(sy), height: r2(top) };
  if (c.shape === 'cylinder') item.shape = 'cyl';
  if (c.rotationZ) item.rot = r2(-c.rotationZ);
  // Treads and the tower deck they lead onto block only a small footprint, so the climb flows onto the deck.
  if (c.name === 'degrau_torre' || c.name === 'deck_torre') item.kind = 'step';
  cover.push(item);
}
const yawTo = (x) => (x < 0 ? Math.PI / 2 : -Math.PI / 2); // face the centre line
const spawnPoints = [];
for (const side of [-1, 1]) {
  for (const [x, z] of [[31.5, 0], [31.5, -3], [31.5, 3], [27.5, -2], [27.5, 2], [34, 2.5]]) {
    spawnPoints.push({ x: side * x, y: 0, z, yaw: r2(yawTo(side)) });
  }
}
const navPoints = [];
for (let x = -36; x <= 36; x += 6) for (let z = -27; z <= 27; z += 6) navPoints.push({ x, z });
const layout = {
  visualAsset: 'glb:ferro_velho_tita.glb',
  source: 'Ferro-Velho Titã (Codex/ChatGPT, Blender 5.1) — colisoes_mapa.json v' + src.version,
  deckTopY: 0,
  centralArena: { x: 0, z: 0, radius: 7.5 },
  bridges: [{ name: 'patio', x: 0, z: 0, widthX: 79, widthZ: 61 }],
  stations: [
    { name: 'base-azul', x: -31, z: 0, radius: 5.5 },
    { name: 'base-vermelha', x: 31, z: 0, radius: 5.5 },
    { name: 'guindaste', x: 0, z: -20, radius: 5 },
    { name: 'tita', x: 0, z: 20, radius: 5 },
  ],
  teamBases: [{ team: 'blue', x: -31, z: 0, radius: 5.5 }, { team: 'red', x: 31, z: 0, radius: 5.5 }],
  cover,
  spawns: spawnPoints,
  spawnPoints,
  pads: [{ x: -19, z: 0 }, { x: 19, z: 0 }, { x: 0, z: -12 }, { x: 0, z: 12 }],
  navPoints,
  stepHeight: 0.45,
  noStationProps: true,
};
writeFileSync('public/assets/models/scrapyard.layout.json', JSON.stringify(layout, null, 1));
console.log(`scrapyard layout: ${cover.length} cover volumes, ${spawnPoints.length} spawns`);
