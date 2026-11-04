import { Color3, DynamicTexture, Engine, MeshBuilder, RawCubeTexture, Scene, StandardMaterial, Texture, type AbstractMesh } from '@babylonjs/core';
import type { ArenaLayout } from '../shared/arena';
import type { MapId } from '../shared/maps';

/** Locally generated reflection and deck detail; no downloads or collision geometry. */
export function createWorldGraphics(scene: Scene, layout: ArenaLayout, mapId: MapId) {
  const meshes: AbstractMesh[] = [];
  const optional: AbstractMesh[] = [];
  const materials: StandardMaterial[] = [];
  const textures: Texture[] = [];
  const size = 64;
  const reflection = new RawCubeTexture(scene, null, size, Engine.TEXTUREFORMAT_RGBA, Engine.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  reflection.name = 'local-industrial-environment';
  reflection.coordinatesMode = Texture.CUBIC_MODE;
  reflection.gammaSpace = true;
  reflection.level = 0.62;
  scene.environmentTexture = reflection;
  scene.environmentIntensity = 0.65;

  function updateEnvironment(top: string, horizon: string, accent: [number, number, number]) {
    const zenith = Color3.FromHexString(top), sky = Color3.FromHexString(horizon);
    const faces = Array.from({ length: 6 }, (_, face) => {
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const elevation = face === 2 ? 0.9 : face === 3 ? 0.04 : 1 - y / (size - 1);
        const blend = Math.min(1, Math.max(0, elevation * 1.35));
        const color = Color3.Lerp(sky.scale(0.72), zenith, blend);
        // Broad softbox strips give metal a legible reflected highlight, even at night.
        const strip = Math.max(0, 1 - Math.abs(x / size - (face % 2 ? 0.7 : 0.28)) / 0.075) * Math.max(0, 1 - Math.abs(elevation - 0.63) / 0.24);
        const floor = elevation < 0.15 ? 0.28 : 1;
        const i = (y * size + x) * 4;
        data[i] = Math.min(255, (color.r * floor + strip * (0.42 + accent[0] * 0.2)) * 255);
        data[i + 1] = Math.min(255, (color.g * floor + strip * (0.46 + accent[1] * 0.2)) * 255);
        data[i + 2] = Math.min(255, (color.b * floor + strip * (0.5 + accent[2] * 0.2)) * 255);
        data[i + 3] = 255;
      }
      return data;
    });
    reflection.update(faces, Engine.TEXTUREFORMAT_RGBA, Engine.TEXTURETYPE_UNSIGNED_BYTE, false);
  }

  const panel = new DynamicTexture('industrial-deck-panels', { width: 512, height: 512 }, scene, true);
  const ctx = panel.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#101a23'; ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const px = x * 128 + 3, py = y * 128 + 3;
    const gradient = ctx.createLinearGradient(px, py, px + 124, py + 124);
    gradient.addColorStop(0, '#465562'); gradient.addColorStop(0.12, '#33424f'); gradient.addColorStop(1, '#26333e');
    ctx.fillStyle = gradient; ctx.fillRect(px, py, 122, 122);
    ctx.strokeStyle = '#687781'; ctx.lineWidth = 1; ctx.strokeRect(px + 1, py + 1, 120, 120);
    for (let k = 0; k < 18; k++) { ctx.fillStyle = k % 3 === 0 ? '#ffffff06' : '#00000009'; ctx.fillRect(px + 3, py + 5 + k * 6, 116, 1); }
    for (const bx of [9, 114]) for (const by of [9, 114]) {
      ctx.fillStyle = '#14202b'; ctx.beginPath(); ctx.arc(px + bx, py + by, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7f8d94'; ctx.fillRect(px + bx - 2, py + by - 1, 4, 1);
    }
  }
  panel.update(); panel.uScale = 3; panel.vScale = 3; panel.anisotropicFilteringLevel = 8; textures.push(panel);
  const deck = new StandardMaterial('industrial-deck-surface', scene);
  deck.diffuseTexture = panel; deck.diffuseColor = Color3.FromHexString(mapId === 'canyon' ? '#b4a18b' : mapId === 'neon' ? '#8396ba' : '#a3bac8');
  deck.specularColor = new Color3(0.65, 0.7, 0.74); deck.specularPower = 88; deck.ambientColor = new Color3(.13, .15, .19); materials.push(deck);
  const paint = new StandardMaterial('deck-marking-paint', scene); paint.diffuseColor = Color3.FromHexString('#dfd9bc'); paint.specularColor.setAll(.18); materials.push(paint);
  const accent = new StandardMaterial('deck-marking-accent', scene); accent.diffuseColor = Color3.FromHexString('#f29039'); accent.emissiveColor = accent.diffuseColor.scale(.18); materials.push(accent);
  const support = new StandardMaterial('deck-structure', scene); support.diffuseColor = Color3.FromHexString('#1d2b37'); support.specularColor.setAll(.5); support.specularPower = 64; materials.push(support);
  const add = (mesh: AbstractMesh, mat: StandardMaterial, extra = false) => { mesh.material = mat; mesh.isPickable = false; mesh.receiveShadows = true; meshes.push(mesh); if (extra) optional.push(mesh); };
  const y = layout.deckTopY;
  const platforms = [layout.centralArena, ...layout.stations];
  // Thin cosmetic inlays sit on the existing walkable deck; all movement still uses Arena.
  for (const [i, p] of platforms.entries()) {
    const inset = MeshBuilder.CreateCylinder(`graphics-deck-inlay-${i}`, { diameter: p.radius * 1.82, height: .018, tessellation: 64 }, scene);
    inset.position.set(p.x, y + .009, p.z); add(inset, deck);
    const ring = MeshBuilder.CreateTorus(`graphics-deck-ring-${i}`, { diameter: p.radius * 1.58, thickness: .035, tessellation: 64 }, scene);
    ring.position.set(p.x, y + .024, p.z); add(ring, i === 0 ? paint : accent);
    const pillar = MeshBuilder.CreateCylinder(`graphics-deck-support-${i}`, { diameterTop: p.radius * .8, diameterBottom: p.radius * .55, height: 7, tessellation: 12 }, scene);
    pillar.position.set(p.x, y - 3.65, p.z); add(pillar, support);
    for (let k = 0; k < 12; k++) {
      const angle = k * Math.PI / 6;
      const tick = MeshBuilder.CreateBox(`graphics-deck-tick-${i}-${k}`, { width: .42, height: .012, depth: .13 }, scene);
      tick.position.set(p.x + Math.sin(angle) * p.radius * .84, y + .027, p.z + Math.cos(angle) * p.radius * .84); tick.rotation.y = angle; add(tick, k % 3 ? paint : accent, true);
    }
  }
  // One source geometry supplies instanced bridge lane dashes.
  const dash = MeshBuilder.CreateBox('graphics-lane-template', { width: .1, height: .012, depth: .85 }, scene); dash.material = paint; dash.setEnabled(false); meshes.push(dash);
  for (const [i, bridge] of layout.bridges.entries()) {
    const alongX = bridge.widthX > bridge.widthZ;
    const length = alongX ? bridge.widthX : bridge.widthZ;
    for (let k = -Math.floor(length / 2.6); k <= Math.floor(length / 2.6); k++) for (const side of [-1, 1]) {
      const mark = dash.createInstance(`graphics-lane-${i}-${k}-${side}`);
      mark.position.set(bridge.x + (alongX ? k * 1.15 : side * bridge.widthX * .35), y + .026, bridge.z + (alongX ? side * bridge.widthZ * .35 : k * 1.15));
      mark.rotation.y = alongX ? Math.PI / 2 : 0; mark.isPickable = false; meshes.push(mark); optional.push(mark);
    }
  }
  const coreLabel = new DynamicTexture('core-deck-label', { width: 512, height: 256 }, scene, false);
  const text = coreLabel.getContext() as CanvasRenderingContext2D; text.clearRect(0, 0, 512, 256); text.textAlign = 'center'; text.fillStyle = '#d6e4dd'; text.font = 'bold 96px Arial'; text.fillText('CORE', 256, 116); text.fillStyle = '#f39b50'; text.font = 'bold 32px Arial'; text.fillText('//  SECTOR 01  //', 256, 172); coreLabel.update(); coreLabel.hasAlpha = true; textures.push(coreLabel);
  const labelMat = new StandardMaterial('core-deck-label-material', scene); labelMat.diffuseTexture = coreLabel; labelMat.opacityTexture = coreLabel; labelMat.emissiveColor.set(.15, .18, .2); labelMat.specularColor.setAll(0); labelMat.backFaceCulling = false; materials.push(labelMat);
  const label = MeshBuilder.CreateGround('graphics-core-label', { width: 3.6, height: 1.8 }, scene); label.position.set(layout.centralArena.x, y + .04, layout.centralArena.z + 3.6); add(label, labelMat);
  scene.metadata = { ...(scene.metadata ?? {}), graphics: { environment: 'local-cube-64', deckDetails: meshes.length } };

  return {
    setTheme(top: string, horizon: string, color: [number, number, number]) { updateEnvironment(top, horizon, color); accent.emissiveColor = new Color3(...color).scale(.22); },
    setQuality(quality: 'high' | 'medium' | 'low') { for (let i = 0; i < optional.length; i++) optional[i].setEnabled(quality === 'high' || (quality === 'medium' && i % 2 === 0)); panel.anisotropicFilteringLevel = quality === 'high' ? 8 : 2; },
    dispose() { for (const mesh of meshes) mesh.dispose(); for (const mat of materials) mat.dispose(); for (const texture of textures) texture.dispose(); reflection.dispose(); if (scene.environmentTexture === reflection) scene.environmentTexture = null; },
  };
}
