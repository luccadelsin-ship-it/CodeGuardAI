import {
  AbstractMesh,
  AssetContainer,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  SceneLoader,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createArena, type Arena, type ArenaLayout, type Cover } from '../shared/arena';
import { flareTexture } from './fx';
import { MAPS, type MapId } from '../shared/maps';
import { createWorldGraphics } from './worldGraphics';

export type ThemeId = 'day' | 'dusk' | 'storm';

export interface ThemeInfo { id: ThemeId; label: string; detail: string }

export const THEMES: ThemeInfo[] = [
  { id: 'day', label: 'DIA POLAR', detail: 'Céu limpo, visibilidade máxima e neve leve.' },
  { id: 'dusk', label: 'ALVORADA GLACIAL', detail: 'Sol rasante, sombras longas e brilho âmbar.' },
  { id: 'storm', label: 'TEMPESTADE NOTURNA', detail: 'Nevasca, neblina densa e aurora boreal.' },
];

interface ThemePreset {
  skyTop: string; skyHorizon: string; fog: [number, number, number]; fogDensity: number;
  hemi: number; hemiSky: [number, number, number]; hemiGround: [number, number, number];
  sun: number; sunColor: [number, number, number]; sunDir: [number, number, number];
  snow: number; wind: [number, number]; aurora: number; accent: [number, number, number]; exposure: number;
}

const PRESETS: Record<ThemeId, ThemePreset> = {
  day: {
    skyTop: '#2f6b9c', skyHorizon: '#b9d6e6', fog: [0.6, 0.73, 0.83], fogDensity: 0.0068,
    hemi: 0.95, hemiSky: [0.72, 0.87, 1], hemiGround: [0.22, 0.29, 0.36], sun: 1.55, sunColor: [1, 0.97, 0.92], sunDir: [-0.55, -1, 0.42],
    snow: 220, wind: [1.2, 0.6], aurora: 0, accent: [0.38, 0.9, 1], exposure: 1.05,
  },
  dusk: {
    skyTop: '#2b2550', skyHorizon: '#f08a5d', fog: [0.55, 0.43, 0.46], fogDensity: 0.0082,
    hemi: 0.72, hemiSky: [0.85, 0.7, 0.75], hemiGround: [0.2, 0.15, 0.22], sun: 1.65, sunColor: [1, 0.68, 0.42], sunDir: [-0.85, -0.42, 0.3],
    snow: 120, wind: [2.2, 0.4], aurora: 0, accent: [1, 0.55, 0.25], exposure: 1.1,
  },
  storm: {
    skyTop: '#02050c', skyHorizon: '#16304a', fog: [0.09, 0.15, 0.23], fogDensity: 0.0155,
    hemi: 0.48, hemiSky: [0.45, 0.6, 0.95], hemiGround: [0.08, 0.1, 0.16], sun: 0.62, sunColor: [0.6, 0.75, 1], sunDir: [0.4, -1, 0.5],
    snow: 1300, wind: [6.5, 2.4], aurora: 1, accent: [0.35, 1, 0.75], exposure: 1.15,
  },
};

export interface Barrel {
  id: number;
  cover: Cover;
  node: TransformNode;
  position: Vector3;
  health: number;
  alive: boolean;
}

export type World = {
  arena: Arena;
  /** Bottom-centre start position on the metal deck. */
  spawn: Vector3;
  deckY: number;
  shadows: ShadowGenerator;
  theme: ThemeId;
  readonly exposure: number;
  barrels: Barrel[];
  canMoveTo(position: Vector3, radius?: number, feetY?: number): boolean;
  raycastCover(origin: Vector3, direction: Vector3, maxDistance: number): number | null;
  resetBarrels(enabled: boolean): void;
  destroyBarrel(barrel: Barrel): void;
  createSupplyCrate(): TransformNode;
  setTheme(theme: ThemeId): void;
  setQuality(quality: 'high' | 'medium' | 'low' | 'minimal'): void;
  update(dt: number, time: number, cameraPosition: Vector3): void;
  dispose(): void;
};

const BARREL_SPOTS: Array<[number, number]> = [
  [7.1, 1.9], [-7.1, -1.9], [1.9, -7.1], [-1.9, 7.1],
  [24.6, -1.6], [-24.6, 1.6], [-1.6, -24.6], [1.6, 24.6],
];

function gradientTexture(scene: Scene, name: string, stops: Array<[number, string]>, width = 4, height = 256): DynamicTexture {
  const tex = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  tex.update();
  return tex;
}

function material(scene: Scene, name: string, hex: string, emissive = false, spec = 0.35): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(spec, spec, spec);
  if (emissive) { mat.emissiveColor = color; mat.disableLighting = true; }
  return mat;
}

async function loadContainer(scene: Scene, file: string): Promise<AssetContainer | null> {
  try {
    return await SceneLoader.LoadAssetContainerAsync('/assets/sketchfab/', file, scene);
  } catch (error) {
    console.warn(`Could not load Sketchfab prop ${file}`, error);
    return null;
  }
}

function instantiate(container: AssetContainer, name: string): TransformNode {
  const holder = new TransformNode(name, container.scene);
  const entries = container.instantiateModelsToScene((source) => `${name}:${source}`, false);
  for (const node of entries.rootNodes) node.parent = holder;
  for (const mesh of holder.getChildMeshes()) { mesh.isPickable = false; mesh.receiveShadows = true; }
  return holder;
}

/** Load the Blender-authored arena and dress it with new cover, props, weather and lighting themes. */
export async function createWorld(scene: Scene, onProgress?: (label: string) => void, mapId: MapId = 'frozen'): Promise<World> {
  const ownedMeshes: AbstractMesh[] = [];
  const importedNodes: Array<AbstractMesh | TransformNode> = [];
  const physics: PhysicsAggregate[] = [];
  const props: TransformNode[] = [];

  scene.fogMode = Scene.FOGMODE_EXP2;
  const hemisphere = new HemisphericLight('polar skylight', new Vector3(0, 1, 0), scene);
  const sunlight = new DirectionalLight('arctic sun', new Vector3(-0.6, -1, 0.45), scene);
  sunlight.position = new Vector3(18, 48, -24);
  const shadows = new ShadowGenerator(2048, sunlight);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.001;
  shadows.normalBias = 0.025;
  shadows.darkness = 0.18;

  onProgress?.('Lendo o layout da arena');
  const response = await fetch(`/assets/models/${MAPS[mapId].layoutFile}`);
  if (!response.ok) throw new Error(`${MAPS[mapId].name} layout: HTTP ${response.status}`);
  const layout = await response.json() as ArenaLayout;
  const arena = createArena(layout, { mapId });
  /** Training start: arena centre, on top of a low dais or beside a tall centrepiece. */
  const trainingSpawn = (): Vector3 => {
    let z = 0;
    const tall = arena.staticCover.some((c) => c.height > 1.2 && Math.abs(c.x) < c.widthX / 2 + 1 && Math.abs(c.z) < c.widthZ / 2 + 1);
    if (tall) z = -layout.centralArena.radius * 0.78;
    return new Vector3(0, arena.floorAt(0, z, 0.8, deckY + 1.2), z);
  };
  const deckY = layout.deckTopY;

  onProgress?.(`Montando ${MAPS[mapId].name} em 3D`);
  if (mapId === 'frozen') {
    const arenaImport = await SceneLoader.ImportMeshAsync('', '/assets/models/', 'frozen_outpost.glb', scene);
    importedNodes.push(...arenaImport.meshes, ...arenaImport.transformNodes);
    for (const mesh of arenaImport.meshes) { mesh.receiveShadows = true; mesh.isPickable = false; }
  } else {
    const steel = material(scene, `${mapId}-steel`, mapId === 'neon' ? '#172b48' : mapId === 'canyon' ? '#ad805b' : '#35414b', false, 0.4);
    const copper = material(scene, `${mapId}-trim`, mapId === 'neon' ? '#643579' : mapId === 'canyon' ? '#71412b' : '#a8582b', false, 0.5);
    const emissive = material(scene, `${mapId}-lights`, MAPS[mapId].color, true);
    const add = (mesh: Mesh, mat: StandardMaterial) => { mesh.material = mat; mesh.isPickable = false; mesh.receiveShadows = true; shadows.addShadowCaster(mesh); ownedMeshes.push(mesh); };
    for (const [i, platform] of [layout.centralArena, ...layout.stations].entries()) {
      const deck = MeshBuilder.CreateCylinder(`${mapId}-platform-${i}`, { diameter: platform.radius * 2, height: 0.8, tessellation: 32 }, scene);
      deck.position.set(platform.x, deckY - 0.4, platform.z); add(deck, steel);
      const rim = MeshBuilder.CreateTorus(`${mapId}-rim-${i}`, { diameter: platform.radius * 1.9, thickness: 0.13, tessellation: 32 }, scene);
      rim.position.set(platform.x, deckY + 0.05, platform.z); add(rim, mapId === 'neon' ? emissive : copper);
    }
    for (const [i, bridge] of layout.bridges.entries()) {
      const deck = MeshBuilder.CreateBox(`${mapId}-bridge-${i}`, { width: bridge.widthX, depth: bridge.widthZ, height: 0.65 }, scene);
      deck.position.set(bridge.x, deckY - 0.33, bridge.z); add(deck, steel);
      const alongX = bridge.widthX > bridge.widthZ;
      for (const side of [-1, 1]) {
        const rail = MeshBuilder.CreateBox(`${mapId}-rail-${i}-${side}`, { width: alongX ? bridge.widthX : 0.15, depth: alongX ? 0.15 : bridge.widthZ, height: 0.12 }, scene);
        rail.position.set(bridge.x + (alongX ? 0 : side * bridge.widthX * 0.46), deckY + 0.06, bridge.z + (alongX ? side * bridge.widthZ * 0.46 : 0)); add(rail, emissive);
      }
    }
    for (const [i, c] of layout.cover.entries()) {
      const tower = MeshBuilder.CreateBox(`${mapId}-cover-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      tower.position.set(c.x, deckY + c.height * 0.5, c.z); add(tower, copper);
      const light = MeshBuilder.CreateBox(`${mapId}-cover-light-${i}`, { width: c.widthX + 0.05, depth: c.widthZ + 0.05, height: 0.08 }, scene);
      light.position.set(c.x, deckY + c.height * 0.8, c.z); add(light, emissive);
    }
    // Landmarks stay beyond the walkable decks, so decoration never creates invisible cover.
    const ground = MeshBuilder.CreateCylinder(`${mapId}-backdrop-ground`, { diameter: 230, height: 1, tessellation: 48 }, scene);
    ground.position.y = -10; add(ground, steel);
    const landmarkTemplate = MeshBuilder.CreateBox(`${mapId}-landmark-template`, { size: 1 }, scene);
    landmarkTemplate.material = copper; landmarkTemplate.setEnabled(false); ownedMeshes.push(landmarkTemplate);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const distance = 48 + (i % 3) * 7;
      const landmark = landmarkTemplate.createInstance(`${mapId}-landmark-${i}`);
      landmark.isPickable = false;
      const height = mapId === 'neon' ? 12 + (i % 5) * 5 : 8 + (i % 4) * 5;
      landmark.scaling.set(mapId === 'neon' ? 5 : 9, height, mapId === 'neon' ? 6 : 10);
      landmark.position.set(Math.sin(angle) * distance, -9 + height / 2, Math.cos(angle) * distance);
      landmark.rotation.y = angle;
      ownedMeshes.push(landmark);
      if (mapId === 'neon' && i % 2 === 0) {
        const sign = MeshBuilder.CreatePlane(`neon-sign-${i}`, { width: 3.6, height: 1.1 }, scene);
        sign.position.set(landmark.position.x, landmark.position.y + height * 0.25, landmark.position.z);
        sign.rotation.y = angle; sign.billboardMode = Mesh.BILLBOARDMODE_Y; add(sign, emissive);
      }
    }
    if (mapId === 'canyon') {
      for (const side of [-1, 1]) {
        const pipe = MeshBuilder.CreateCylinder(`canyon-pipe-${side}`, { diameter: 2.3, height: 58, tessellation: 10 }, scene);
        pipe.position.set(side * 13.5, -3.2, 0); pipe.rotation.x = Math.PI / 2; add(pipe, copper);
      }
    }
  }

  const graphics = createWorldGraphics(scene, layout, mapId);

  // Invisible Havok proxies, as in the original build.
  const platformThickness = 0.7;
  const platformCenterY = deckY - platformThickness / 2;
  const collider = (mesh: Mesh, shape: PhysicsShapeType) => {
    mesh.isVisible = false;
    mesh.isPickable = false;
    if (scene.isPhysicsEnabled()) physics.push(new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.9 }, scene));
    ownedMeshes.push(mesh);
  };
  const deckCylinder = (name: string, x: number, z: number, radius: number) => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter: radius * 2, height: platformThickness, tessellation: 32 }, scene);
    mesh.position.set(x, platformCenterY, z);
    collider(mesh, PhysicsShapeType.CYLINDER);
  };
  deckCylinder('collision:central-deck', layout.centralArena.x, layout.centralArena.z, layout.centralArena.radius);
  layout.stations.forEach((s, i) => deckCylinder(`collision:station-${i}`, s.x, s.z, s.radius));
  for (const b of layout.bridges) {
    const mesh = MeshBuilder.CreateBox(`collision:bridge-${b.name}`, { width: b.widthX, depth: b.widthZ, height: platformThickness }, scene);
    mesh.position.set(b.x, platformCenterY, b.z);
    collider(mesh, PhysicsShapeType.BOX);
  }
  for (const [i, c] of arena.staticCover.entries()) {
    const mesh = MeshBuilder.CreateBox(`collision:cover-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
    mesh.position.set(c.x, deckY + c.height / 2, c.z);
    collider(mesh, PhysicsShapeType.BOX);
  }

  // New procedural cover: energy barricades in the ring and armoured blocks on the bridges.
  onProgress?.('Erguendo barricadas e coberturas');
  const plate = material(scene, 'barricade-plate', '#24343f', false, 0.5);
  const plateLight = material(scene, 'barricade-light', '#3d5566', false, 0.6);
  const hazard = material(scene, 'barricade-hazard', '#e8722f', false, 0.2);
  const strip = material(scene, 'barricade-strip', '#61e8ff', true);
  const accentMaterials: StandardMaterial[] = [strip];
  for (const [i, c] of arena.builtCover.entries()) {
    const root = new TransformNode(`cover-visual-${i}`, scene);
    root.position.set(c.x, deckY, c.z);
    const alongX = c.widthX >= c.widthZ;
    const long = Math.max(c.widthX, c.widthZ);
    const thin = Math.min(c.widthX, c.widthZ);
    const add = (mesh: Mesh, mat: StandardMaterial) => { mesh.parent = root; mesh.material = mat; mesh.isPickable = false; mesh.receiveShadows = true; shadows.addShadowCaster(mesh); ownedMeshes.push(mesh); };
    if (c.kind === 'barricade') {
      const body = MeshBuilder.CreateBox(`barricade-${i}`, { width: alongX ? long : thin, depth: alongX ? thin : long, height: c.height * 0.86 }, scene);
      body.position.y = c.height * 0.43;
      add(body, plate);
      const cap = MeshBuilder.CreateBox(`barricade-cap-${i}`, { width: (alongX ? long : thin) + 0.08, depth: (alongX ? thin : long) + 0.08, height: c.height * 0.14 }, scene);
      cap.position.y = c.height * 0.93;
      add(cap, plateLight);
      for (const side of [-1, 1]) {
        const light = MeshBuilder.CreateBox(`barricade-strip-${i}-${side}`, { width: alongX ? long * 0.8 : 0.03, depth: alongX ? 0.03 : long * 0.8, height: 0.07 }, scene);
        light.position.set(alongX ? 0 : side * (thin / 2 + 0.01), c.height * 0.7, alongX ? side * (thin / 2 + 0.01) : 0);
        add(light, strip);
        for (let k = -1; k <= 1; k += 2) {
          const stripe = MeshBuilder.CreateBox(`barricade-hazard-${i}-${side}-${k}`, { width: alongX ? 0.32 : 0.02, depth: alongX ? 0.02 : 0.32, height: c.height * 0.38 }, scene);
          stripe.position.set(alongX ? k * long * 0.36 : side * (thin / 2 + 0.012), c.height * 0.28, alongX ? side * (thin / 2 + 0.012) : k * long * 0.36);
          stripe.rotation[alongX ? 'z' : 'x'] = 0.5 * k;
          add(stripe, hazard);
        }
      }
    } else if (c.kind === 'pillar') {
      // Distillation column: boxy core (matches the collision box) with banded rings and a beacon.
      const body = MeshBuilder.CreateBox(`pillar-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      body.position.y = c.height / 2;
      add(body, plateLight);
      for (let k = 1; k <= 3; k++) {
        const band = MeshBuilder.CreateBox(`pillar-band-${i}-${k}`, { width: c.widthX + 0.06, depth: c.widthZ + 0.06, height: 0.12 }, scene);
        band.position.y = c.height * k / 4;
        add(band, k === 2 ? strip : hazard);
      }
      const cap = MeshBuilder.CreateCylinder(`pillar-cap-${i}`, { diameter: Math.min(c.widthX, c.widthZ) * 0.8, height: 0.5, tessellation: 12 }, scene);
      cap.position.y = c.height + 0.25;
      add(cap, plate);
      const beacon = MeshBuilder.CreateSphere(`pillar-beacon-${i}`, { diameter: 0.45, segments: 8 }, scene);
      beacon.position.y = c.height + 0.65;
      add(beacon, strip);
    } else if (c.kind === 'pipe') {
      // Pipe rack: two horizontal pipes on short legs; low enough to vault over.
      const along = alongX ? 'x' : 'z';
      for (const offset of [-0.17, 0.17]) {
        const pipe = MeshBuilder.CreateCylinder(`pipe-${i}-${offset}`, { diameter: 0.32, height: long, tessellation: 12 }, scene);
        pipe.rotation[along === 'x' ? 'z' : 'x'] = Math.PI / 2;
        pipe.position.set(alongX ? 0 : offset, c.height - 0.2, alongX ? offset : 0);
        add(pipe, offset < 0 ? hazard : plateLight);
      }
      for (const k of [-1, 0, 1]) {
        const leg = MeshBuilder.CreateBox(`pipe-leg-${i}-${k}`, { width: alongX ? 0.14 : thin, depth: alongX ? thin : 0.14, height: c.height - 0.2 }, scene);
        leg.position.set(alongX ? k * long * 0.42 : 0, (c.height - 0.2) / 2, alongX ? 0 : k * long * 0.42);
        add(leg, plate);
      }
      const valve = MeshBuilder.CreateTorus(`pipe-valve-${i}`, { diameter: 0.42, thickness: 0.06, tessellation: 16 }, scene);
      valve.position.y = c.height;
      add(valve, strip);
    } else if (c.kind === 'dais') {
      // Raised plaza: two-tone slab, glowing edge, beveled lip.
      const body = MeshBuilder.CreateBox(`dais-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      body.position.y = c.height / 2;
      add(body, plate);
      const top = MeshBuilder.CreateBox(`dais-top-${i}`, { width: c.widthX - 0.5, depth: c.widthZ - 0.5, height: 0.04 }, scene);
      top.position.y = c.height + 0.02;
      add(top, plateLight);
      for (const side of [-1, 1]) for (const axis of ['x', 'z'] as const) {
        const edge = MeshBuilder.CreateBox(`dais-edge-${i}-${axis}-${side}`, { width: axis === 'x' ? c.widthX : 0.06, depth: axis === 'x' ? 0.06 : c.widthZ, height: 0.08 }, scene);
        edge.position.set(axis === 'x' ? 0 : side * c.widthX / 2, c.height - 0.04, axis === 'x' ? side * c.widthZ / 2 : 0);
        add(edge, strip);
      }
    } else if (c.kind === 'wall') {
      // Neon light wall: dark frame with two bright horizontal tubes.
      const body = MeshBuilder.CreateBox(`wall-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      body.position.y = c.height / 2;
      add(body, plate);
      for (const h of [0.45, 0.78]) for (const side of [-1, 1]) {
        const tube = MeshBuilder.CreateBox(`wall-tube-${i}-${h}-${side}`, { width: alongX ? long * 0.9 : 0.04, depth: alongX ? 0.04 : long * 0.9, height: 0.07 }, scene);
        tube.position.set(alongX ? 0 : side * (thin / 2 + 0.02), c.height * h, alongX ? side * (thin / 2 + 0.02) : 0);
        add(tube, strip);
      }
    } else if (c.kind === 'ore') {
      // Ore block: rough two-tone rock with glowing veins.
      const body = MeshBuilder.CreateBox(`ore-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      body.position.y = c.height / 2;
      add(body, hazard);
      const cap = MeshBuilder.CreateBox(`ore-cap-${i}`, { width: c.widthX * 0.86, depth: c.widthZ * 0.86, height: 0.14 }, scene);
      cap.position.y = c.height + 0.05;
      add(cap, plate);
      const vein = MeshBuilder.CreateBox(`ore-vein-${i}`, { width: c.widthX + 0.03, depth: c.widthZ + 0.03, height: 0.06 }, scene);
      vein.position.y = c.height * 0.45;
      add(vein, strip);
    } else {
      const body = MeshBuilder.CreateBox(`block-${i}`, { width: c.widthX, depth: c.widthZ, height: c.height }, scene);
      body.position.y = c.height / 2;
      add(body, plateLight);
      const band = MeshBuilder.CreateBox(`block-band-${i}`, { width: c.widthX + 0.04, depth: c.widthZ + 0.04, height: 0.08 }, scene);
      band.position.y = c.height * 0.62;
      add(band, strip);
      const top = MeshBuilder.CreateBox(`block-top-${i}`, { width: c.widthX * 0.8, depth: c.widthZ * 0.8, height: 0.08 }, scene);
      top.position.y = c.height + 0.04;
      add(top, hazard);
    }
    props.push(root);
  }

  // Jump pads: glowing launch discs with chevrons (shared rule in arena.padAt / stepMech).
  const padRings: Mesh[] = [];
  for (const [i, pad] of arena.jumpPads.entries()) {
    const base = MeshBuilder.CreateCylinder(`jump-pad-${i}`, { diameter: pad.radius * 2.2, height: 0.12, tessellation: 28 }, scene);
    base.position.set(pad.x, deckY + 0.06, pad.z);
    base.material = plate; base.isPickable = false; base.receiveShadows = true; ownedMeshes.push(base);
    const core = MeshBuilder.CreateDisc(`jump-pad-core-${i}`, { radius: pad.radius * 0.8, tessellation: 28 }, scene);
    core.rotation.x = Math.PI / 2; core.position.set(pad.x, deckY + 0.13, pad.z);
    core.material = strip; core.isPickable = false; ownedMeshes.push(core);
    for (let k = 0; k < 2; k++) {
      const ring = MeshBuilder.CreateTorus(`jump-pad-ring-${i}-${k}`, { diameter: pad.radius * 1.6, thickness: 0.06, tessellation: 28 }, scene);
      ring.position.set(pad.x, deckY + 0.2, pad.z);
      ring.material = strip; ring.isPickable = false; ownedMeshes.push(ring);
      ring.metadata = { phase: k * 0.5 };
      padRings.push(ring);
    }
  }

  // Beacon pylons on the ring edge pulse in the theme accent colour.
  const pylonMat = material(scene, 'pylon', '#1a2a35', false, 0.5);
  const beaconMat = material(scene, 'pylon-beacon', '#61e8ff', true);
  accentMaterials.push(beaconMat);
  const beacons: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const pylon = MeshBuilder.CreateCylinder(`pylon-${i}`, { diameterTop: 0.18, diameterBottom: 0.42, height: 3.4, tessellation: 8 }, scene);
    pylon.position.set(Math.cos(angle) * 10.2, deckY + 1.7, Math.sin(angle) * 10.2);
    pylon.material = pylonMat;
    pylon.isPickable = false;
    shadows.addShadowCaster(pylon);
    const beacon = MeshBuilder.CreateSphere(`pylon-beacon-${i}`, { diameter: 0.42, segments: 8 }, scene);
    beacon.parent = pylon;
    beacon.position.y = 1.85;
    beacon.material = beaconMat;
    beacon.isPickable = false;
    beacons.push(beacon);
    ownedMeshes.push(pylon, beacon);
  }

  // Sketchfab props share asset containers so barrels and crates can be cloned cheaply.
  onProgress?.('Posicionando estruturas e equipamentos');
  const [cargo, loot, barrel, outpost, radar] = await Promise.all([
    loadContainer(scene, 'cargo_crate.glb'),
    loadContainer(scene, 'loot_crate.glb'),
    loadContainer(scene, 'energy_barrel.glb'),
    loadContainer(scene, 'outpost_tower.glb'),
    loadContainer(scene, 'radar_tower.glb'),
  ]);
  const place = (container: AssetContainer | null, name: string, x: number, z: number, y: number, rotation: number) => {
    if (!container) return;
    const node = instantiate(container, name);
    node.position.set(x, y, z);
    node.rotation.y = rotation;
    for (const mesh of node.getChildMeshes()) shadows.addShadowCaster(mesh);
    props.push(node);
  };
  place(cargo, 'cargo_crate', 28.7, -5.1, deckY, 0.2);
  place(loot, 'loot_crate', -28.8, 5.1, deckY, 0.65);
  place(barrel, 'energy_barrel', 4.9, 27.5, deckY, 0);
  place(outpost, 'outpost_tower', mapId === 'frozen' ? 31.5 : 40, mapId === 'frozen' ? -8.7 : -25, -0.13, -0.35);
  place(radar, 'radar_tower', mapId === 'frozen' ? -31.5 : -40, mapId === 'frozen' ? 8.7 : 25, -0.13, 0.35);
  // Reuse the shipped GLBs as distant loading yards and control towers.
  for (const side of [-1, 1]) {
    place(cargo, `${mapId}-yard-cargo-${side}`, side * 35, 13, -0.13, side * 0.35);
    place(cargo, `${mapId}-yard-cargo-stack-${side}`, side * 35, 16.2, -0.13, side * 0.35);
    place(mapId === 'neon' ? radar : outpost, `${mapId}-yard-tower-${side}`, side * 36, -17, -1.2, side * 0.4);
    if (mapId !== 'frozen') {
      for (const [z, top] of [[14.6, -0.13], [-17, -1.2]]) {
        const island = MeshBuilder.CreateCylinder(`${mapId}-yard-foundation-${side}-${z}`, { diameter: 9, height: top + 10, tessellation: 12 }, scene);
        island.position.set(side * (z < 0 ? 36 : 35), (top - 10) / 2, z);
        island.material = plate; island.isPickable = false; island.receiveShadows = true; ownedMeshes.push(island);
      }
      const towerIsland = MeshBuilder.CreateCylinder(`${mapId}-tower-foundation-${side}`, { diameter: 11, height: 9.87, tessellation: 12 }, scene);
      towerIsland.position.set(side * 40, -5.065, -side * 25); towerIsland.material = plate; towerIsland.isPickable = false; towerIsland.receiveShadows = true; ownedMeshes.push(towerIsland);
    }
  }

  // Explosive barrels (training mode). They are real cover until destroyed.
  const barrels: Barrel[] = BARREL_SPOTS.map(([x, z], id) => {
    const node = barrel ? instantiate(barrel, `explosive-barrel-${id}`) : new TransformNode(`explosive-barrel-${id}`, scene);
    node.position.set(x, deckY, z);
    node.rotation.y = id * 1.3;
    if (!barrel) {
      const fallback = MeshBuilder.CreateCylinder(`barrel-fallback-${id}`, { diameter: 0.85, height: 1.2, tessellation: 12 }, scene);
      fallback.parent = node;
      fallback.position.y = 0.6;
      fallback.material = hazard;
    }
    const ring = MeshBuilder.CreateTorus(`barrel-warning-${id}`, { diameter: 1.05, thickness: 0.05, tessellation: 24 }, scene);
    ring.parent = node;
    ring.position.y = 0.95;
    ring.material = hazard;
    ring.isPickable = false;
    for (const mesh of node.getChildMeshes()) shadows.addShadowCaster(mesh);
    node.setEnabled(false);
    return { id, node, position: new Vector3(x, deckY, z), cover: { x, z, widthX: 0.9, widthZ: 0.9, height: 1.2, kind: 'barrel', id: `barrel-${id}` }, health: 28, alive: false };
  });

  // Sky dome with a theme gradient.
  const skyDome = MeshBuilder.CreateSphere('sky-dome', { diameter: 560, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial('sky-mat', scene);
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  skyDome.material = skyMat;
  skyDome.infiniteDistance = true;
  skyDome.isPickable = false;
  skyDome.applyFog = false;

  // Aurora curtains for the night storm.
  const auroraTex = new DynamicTexture('aurora-tex', { width: 256, height: 128 }, scene, false);
  {
    const ctx = auroraTex.getContext() as CanvasRenderingContext2D;
    for (let x = 0; x < 256; x++) {
      const h = 0.45 + 0.4 * Math.sin(x * 0.07) * Math.sin(x * 0.023 + 1);
      const g = ctx.createLinearGradient(0, 128, 0, 128 - h * 128);
      g.addColorStop(0, 'rgba(60,255,170,0.9)');
      g.addColorStop(0.45, 'rgba(60,220,255,0.45)');
      g.addColorStop(1, 'rgba(160,80,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 1, 128);
    }
    auroraTex.update();
    auroraTex.hasAlpha = true;
    auroraTex.wrapU = Texture.WRAP_ADDRESSMODE;
  }
  const auroraMat = new StandardMaterial('aurora-mat', scene);
  auroraMat.emissiveTexture = auroraTex;
  auroraMat.opacityTexture = auroraTex;
  auroraMat.disableLighting = true;
  auroraMat.backFaceCulling = false;
  auroraMat.fogEnabled = false;
  auroraMat.alphaMode = 1; // ALPHA_ADD
  const auroras: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const curtain = MeshBuilder.CreatePlane(`aurora-${i}`, { width: 360, height: 70 }, scene);
    const angle = -0.6 + i * 0.75;
    curtain.position.set(Math.sin(angle) * 230, 105 + i * 12, Math.cos(angle) * 230);
    curtain.rotation.y = angle;
    curtain.rotation.x = -0.35;
    curtain.material = auroraMat;
    curtain.isPickable = false;
    curtain.applyFog = false;
    auroras.push(curtain);
  }

  // Snow follows the camera so it always surrounds the action.
  const snow = new ParticleSystem('snowfall', 2400, scene);
  snow.particleTexture = flareTexture(scene);
  const snowOrigin = new Vector3(0, 0, 0);
  snow.emitter = snowOrigin;
  snow.minEmitBox = new Vector3(-30, 8, -30);
  snow.maxEmitBox = new Vector3(30, 16, 30);
  snow.minSize = 0.05; snow.maxSize = 0.15;
  snow.minLifeTime = 3.5; snow.maxLifeTime = 6;
  snow.color1 = new Color4(1, 1, 1, 0.85);
  snow.color2 = new Color4(0.85, 0.93, 1, 0.6);
  snow.colorDead = new Color4(1, 1, 1, 0);
  snow.minEmitPower = 1; snow.maxEmitPower = 1.6;
  snow.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  snow.updateSpeed = 0.016;
  snow.start();

  let theme: ThemeId = 'day';
  let quality: 'high' | 'medium' | 'low' | 'minimal' = 'high';
  let preset = PRESETS.day;

  function applyTheme(id: ThemeId) {
    theme = id;
    preset = PRESETS[id];
    if (mapId === 'neon') preset = { ...preset, skyTop: '#0c1230', skyHorizon: '#463564', fog: [0.13, 0.13, 0.25], fogDensity: 0.0058, snow: 0, aurora: 0, hemi: 1.0, hemiGround: [0.17, 0.15, 0.24], sun: 0.95, accent: [0.85, 0.35, 1], exposure: 1.18 };
    if (mapId === 'canyon') preset = { ...preset, skyTop: id === 'storm' ? '#382628' : '#6b8996', skyHorizon: '#e7b17c', fog: [0.67, 0.5, 0.36], fogDensity: 0.006, snow: 0, aurora: 0, hemiSky: [1, 0.83, 0.65], hemiGround: [0.36, 0.22, 0.12], accent: [1, 0.67, 0.25] };
    const p = preset;
    graphics.setTheme(p.skyTop, p.skyHorizon, p.accent);
    scene.fogColor = new Color3(...p.fog);
    scene.fogDensity = p.fogDensity;
    scene.clearColor = new Color4(p.fog[0], p.fog[1], p.fog[2], 1);
    scene.ambientColor = new Color3(p.hemiGround[0] * 0.8, p.hemiGround[1] * 0.8, p.hemiGround[2] * 0.8);
    hemisphere.intensity = p.hemi;
    hemisphere.diffuse = new Color3(...p.hemiSky);
    hemisphere.groundColor = new Color3(...p.hemiGround);
    sunlight.intensity = p.sun;
    sunlight.diffuse = new Color3(...p.sunColor);
    sunlight.direction = new Vector3(...p.sunDir).normalize();
    sunlight.position = sunlight.direction.scale(-50);
    const old = skyMat.emissiveTexture;
    skyMat.emissiveTexture = gradientTexture(scene, `sky-${id}`, [[0, p.skyTop], [0.42, p.skyTop], [0.5, p.skyHorizon], [0.56, `rgb(${p.fog.map((v) => Math.round(v * 255)).join(',')})`], [1, `rgb(${p.fog.map((v) => Math.round(v * 200)).join(',')})`]]);
    old?.dispose();
    for (const a of auroras) a.setEnabled(p.aurora > 0);
    const accent = new Color3(...p.accent);
    for (const mat of accentMaterials) { mat.emissiveColor = accent; mat.diffuseColor = accent; }
    applySnow();
  }

  function applySnow() {
    const scale = quality === 'high' ? 1 : quality === 'medium' ? 0.55 : quality === 'low' ? 0.2 : 0;
    snow.emitRate = preset.snow * scale;
    snow.direction1 = new Vector3(preset.wind[0] * 0.7, -2.2, preset.wind[1] * 0.7);
    snow.direction2 = new Vector3(preset.wind[0] * 1.3, -3.6, preset.wind[1] * 1.3);
    snow.gravity = new Vector3(preset.wind[0] * 0.15, -0.4, 0);
  }

  applyTheme('day');

  const world: World = {
    arena,
    spawn: trainingSpawn(),
    deckY,
    shadows,
    get theme() { return theme; },
    get exposure() { return preset.exposure; },
    set theme(value: ThemeId) { applyTheme(value); },
    barrels,
    canMoveTo(position, radius = 0.65, feetY = deckY) {
      return arena.canMoveTo(position.x, position.z, radius, feetY);
    },
    raycastCover(origin, direction, maxDistance) {
      return arena.raycastCover(origin, direction, maxDistance);
    },
    resetBarrels(enabled) {
      arena.dynamicCover.length = 0;
      for (const b of barrels) {
        b.alive = enabled;
        b.health = 28;
        b.node.setEnabled(enabled);
        if (enabled) arena.dynamicCover.push(b.cover);
      }
    },
    destroyBarrel(b) {
      if (!b.alive) return;
      b.alive = false;
      b.node.setEnabled(false);
      const index = arena.dynamicCover.indexOf(b.cover);
      if (index >= 0) arena.dynamicCover.splice(index, 1);
    },
    createSupplyCrate() {
      const holder = loot ? instantiate(loot, 'supply-crate') : new TransformNode('supply-crate', scene);
      if (!loot) {
        const box = MeshBuilder.CreateBox('supply-fallback', { size: 1 }, scene);
        box.parent = holder;
        box.position.y = 0.5;
        box.material = hazard;
      }
      holder.scaling.setAll(0.42);
      for (const mesh of holder.getChildMeshes()) shadows.addShadowCaster(mesh);
      return holder;
    },
    setTheme(id) { applyTheme(id); },
    setQuality(next) {
      quality = next;
      shadows.mapSize = next === 'high' ? 2048 : next === 'minimal' ? 512 : 1024;
      shadows.filteringQuality = next === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
      graphics.setQuality(next);
      applySnow();
    },
    update(dt, time, cameraPosition) {
      snowOrigin.set(cameraPosition.x, Math.max(deckY, cameraPosition.y - 6), cameraPosition.z);
      const pulse = 0.55 + 0.45 * Math.sin(time * 2.4);
      for (const ring of padRings) {
        const t = (time * 0.9 + (ring.metadata?.phase ?? 0)) % 1;
        ring.position.y = deckY + 0.2 + t * 2.4;
        ring.scaling.setAll(1 - t * 0.45);
        ring.visibility = 1 - t;
      }
      for (const [i, beacon] of beacons.entries()) beacon.scaling.setAll(0.75 + 0.35 * Math.max(0, Math.sin(time * 3 + i * 1.57)));
      strip.emissiveColor = new Color3(...preset.accent).scale(0.65 + pulse * 0.35);
      if (preset.aurora > 0) auroraTex.uOffset = (auroraTex.uOffset + dt * 0.006) % 1;
      for (const b of barrels) if (b.alive) b.node.getChildMeshes().forEach((m) => { if (m.name.includes('warning')) m.rotation.y += dt * 1.5; });
    },
    dispose() {
      physics.forEach((body) => body.dispose());
      graphics.dispose();
      ownedMeshes.forEach((mesh) => mesh.dispose());
      props.forEach((prop) => prop.dispose(false, true));
      importedNodes.forEach((node) => node.dispose());
      shadows.dispose();
      sunlight.dispose();
      hemisphere.dispose();
      snow.dispose();
    },
  };
  return world;
}
