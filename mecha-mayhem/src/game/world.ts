import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  SceneLoader,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type Circle = { x: number; z: number; radius: number };
type Bridge = { name: string; x: number; z: number; widthX: number; widthZ: number };
type Cover = { x: number; z: number; widthX: number; widthZ: number; height: number };
type Spawn = { x: number; y: number; z: number; yaw: number };
type ArenaLayout = {
  visualAsset: string;
  deckTopY: number;
  centralArena: Circle;
  bridges: Bridge[];
  stations: Circle[];
  cover: Cover[];
  spawns: Spawn[];
};

export type World = {
  /** Bottom-center start position on the metal deck. */
  spawn: Vector3;
  /** Alternate bot entry points, ordered east, west, north, south. */
  botSpawns: Vector3[];
  /** Simple capsule-footprint guard for the kinematic player and bots. */
  canMoveTo(position: Vector3, radius?: number): boolean;
  /** First hit against an arena cover box, in metres along the ray. */
  raycastCover(origin: Vector3, direction: Vector3, maxDistance: number): number | null;
  /** Main sunlight; add dynamic mechs as shadow casters. */
  shadows: ShadowGenerator;
  dispose(): void;
};

function collidesWithCover(x: number, z: number, radius: number, cover: Cover): boolean {
  const closestX = Math.max(cover.x - cover.widthX / 2, Math.min(x, cover.x + cover.widthX / 2));
  const closestZ = Math.max(cover.z - cover.widthZ / 2, Math.min(z, cover.z + cover.widthZ / 2));
  return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius ** 2;
}

function rayCoverDistance(origin: Vector3, direction: Vector3, maxDistance: number, deckTopY: number, cover: Cover): number | null {
  const min = [cover.x - cover.widthX / 2, deckTopY, cover.z - cover.widthZ / 2];
  const max = [cover.x + cover.widthX / 2, deckTopY + cover.height, cover.z + cover.widthZ / 2];
  const start = [origin.x, origin.y, origin.z];
  const step = [direction.x, direction.y, direction.z];
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(step[axis]) < 1e-8) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) return null;
      continue;
    }
    let a = (min[axis] - start[axis]) / step[axis];
    let b = (max[axis] - start[axis]) / step[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}

function onWalkableDeck(x: number, z: number, radius: number, layout: ArenaLayout): boolean {
  const onCircle = (circle: Circle) => (x - circle.x) ** 2 + (z - circle.z) ** 2 <= (circle.radius - radius * 0.65) ** 2;
  if (onCircle(layout.centralArena) || layout.stations.some(onCircle)) return true;
  return layout.bridges.some((bridge) => {
    // Extend along the bridge axis so the circle/bridge joins have no invisible gap.
    const extendsX = bridge.widthX > bridge.widthZ;
    return Math.abs(x - bridge.x) <= bridge.widthX / 2 + (extendsX ? radius : -radius * 0.55)
      && Math.abs(z - bridge.z) <= bridge.widthZ / 2 + (extendsX ? -radius * 0.55 : radius);
  });
}

function invisibleCollider(mesh: Mesh, aggregate: PhysicsAggregate[], scene: Scene, shape: PhysicsShapeType): void {
  mesh.isVisible = false;
  mesh.isPickable = false;
  if (scene.isPhysicsEnabled()) aggregate.push(new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.9 }, scene));
}

async function addSketchfabProp(scene: Scene, file: string, x: number, z: number, y: number, rotation = 0): Promise<TransformNode | null> {
  try {
    const imported = await SceneLoader.ImportMeshAsync('', '/assets/sketchfab/', file, scene);
    const root = new TransformNode(`sketchfab:${file}`, scene);
    for (const node of [...imported.transformNodes, ...imported.meshes]) {
      if (!node.parent && node !== root) node.parent = root;
    }
    root.position.set(x, y, z);
    root.rotation.y = rotation;
    for (const mesh of imported.meshes) {
      mesh.isPickable = true;
      mesh.receiveShadows = true;
    }
    return root;
  } catch (error) {
    console.warn(`Could not load Sketchfab prop ${file}`, error);
    return null;
  }
}

/** Load the Blender-authored arena and create lightweight physics proxies from its layout metadata. */
export async function createWorld(scene: Scene, onProgress?: (label: string) => void): Promise<World> {
  const ownedMeshes: Mesh[] = [];
  const physics: PhysicsAggregate[] = [];
  const props: TransformNode[] = [];

  scene.clearColor = new Color4(0.045, 0.095, 0.15, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0065;
  scene.fogColor = new Color3(0.18, 0.32, 0.43);
  scene.ambientColor = new Color3(0.13, 0.21, 0.3);
  const hemisphere = new HemisphericLight('polar skylight', new Vector3(0, 1, 0), scene);
  hemisphere.intensity = 0.86;
  hemisphere.diffuse = new Color3(0.69, 0.86, 1);
  hemisphere.groundColor = new Color3(0.15, 0.23, 0.3);
  const sunlight = new DirectionalLight('arctic sun', new Vector3(-0.6, -1, 0.45), scene);
  sunlight.position = new Vector3(18, 48, -24);
  sunlight.intensity = 1.4;
  sunlight.diffuse = new Color3(0.82, 0.92, 1);
  const shadows = new ShadowGenerator(1024, sunlight);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 16;
  shadows.bias = 0.001;

  onProgress?.('Lendo o layout da arena');
  const response = await fetch('/assets/models/frozen_outpost.layout.json');
  if (!response.ok) throw new Error(`Frozen Outpost layout: HTTP ${response.status}`);
  const layout = await response.json() as ArenaLayout;

  onProgress?.('Carregando Frozen Outpost em 3D');
  const arena = await SceneLoader.ImportMeshAsync('', '/assets/models/', 'frozen_outpost.glb', scene);
  for (const mesh of arena.meshes) {
    mesh.receiveShadows = true;
    mesh.isPickable = true;
  }

  const platformThickness = 0.7;
  const platformCenterY = layout.deckTopY - platformThickness / 2;
  const addCylinder = (name: string, circle: Circle) => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter: circle.radius * 2, height: platformThickness, tessellation: 32 }, scene);
    mesh.position.set(circle.x, platformCenterY, circle.z);
    invisibleCollider(mesh, physics, scene, PhysicsShapeType.CYLINDER);
    ownedMeshes.push(mesh);
  };
  const addBox = (name: string, x: number, z: number, widthX: number, widthZ: number, height: number, centerY: number) => {
    const mesh = MeshBuilder.CreateBox(name, { width: widthX, depth: widthZ, height }, scene);
    mesh.position.set(x, centerY, z);
    invisibleCollider(mesh, physics, scene, PhysicsShapeType.BOX);
    ownedMeshes.push(mesh);
  };
  addCylinder('collision:central-deck', layout.centralArena);
  layout.stations.forEach((station, index) => addCylinder(`collision:station-${index}`, station));
  layout.bridges.forEach((bridge) => addBox(`collision:bridge-${bridge.name}`, bridge.x, bridge.z, bridge.widthX, bridge.widthZ, platformThickness, platformCenterY));
  layout.cover.forEach((cover, index) => addBox(`collision:cover-${index}`, cover.x, cover.z, cover.widthX, cover.widthZ, cover.height, layout.deckTopY + cover.height / 2));

  // These five CC BY Sketchfab props have ground pivots normalized in Blender.
  onProgress?.('Posicionando estruturas e equipamentos');
  const placements: Array<[string, number, number, number, number]> = [
    ['cargo_crate.glb', 28.7, -5.1, layout.deckTopY, 0.2],
    ['loot_crate.glb', -28.8, 5.1, layout.deckTopY, 0.65],
    ['energy_barrel.glb', 4.9, 27.5, layout.deckTopY, 0],
    ['outpost_tower.glb', 31.5, -8.7, -0.13, -0.35],
    ['radar_tower.glb', -31.5, 8.7, -0.13, 0.35],
  ];
  await Promise.all(placements.map(async ([file, x, z, y, rotation]) => {
    const prop = await addSketchfabProp(scene, file, x, z, y, rotation);
    if (prop) props.push(prop);
  }));

  const extraCover: Cover[] = [
    // Axis-aligned footprints account for the displayed prop dimensions and yaw.
    { x: 28.7, z: -5.1, widthX: 2.31, widthZ: 2.58, height: 1.5 },
    { x: -28.8, z: 5.1, widthX: 2.85, widthZ: 3.15, height: 1.35 },
    { x: 4.9, z: 27.5, widthX: 0.9, widthZ: 0.9, height: 1.2 },
  ];
  extraCover.forEach((cover, index) => addBox(`collision:sketchfab-prop-${index}`, cover.x, cover.z, cover.widthX, cover.widthZ, cover.height, layout.deckTopY + cover.height / 2));

  return {
    spawn: new Vector3(0, layout.deckTopY, 0),
    botSpawns: layout.spawns.slice(0, 3).map(({ x, z }) => new Vector3(x, layout.deckTopY, z)),
    shadows,
    canMoveTo(position, radius = 0.65) {
      return onWalkableDeck(position.x, position.z, radius, layout)
        && ![...layout.cover, ...extraCover].some((cover) => collidesWithCover(position.x, position.z, radius, cover));
    },
    raycastCover(origin, direction, maxDistance) {
      if (maxDistance <= 0 || direction.lengthSquared() < 1e-12) return null;
      const unitDirection = direction.normalizeToNew();
      let nearest: number | null = null;
      for (const cover of [...layout.cover, ...extraCover]) {
        const hit = rayCoverDistance(origin, unitDirection, maxDistance, layout.deckTopY, cover);
        if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
      }
      return nearest;
    },
    dispose() {
      physics.forEach((body) => body.dispose());
      ownedMeshes.forEach((mesh) => mesh.dispose());
      props.forEach((prop) => prop.dispose(false, true));
      [...arena.meshes, ...arena.transformNodes].forEach((node) => node.dispose());
      shadows.dispose();
      sunlight.dispose();
      hemisphere.dispose();
    },
  };
}
