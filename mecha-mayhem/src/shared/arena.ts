/**
 * Pure arena collision model shared by the browser client and the online
 * server. It only depends on the Blender layout JSON, so the server can run the
 * exact same movement and line-of-sight rules as the client prediction.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Circle = { x: number; z: number; radius: number; name?: string };
export type Bridge = { name: string; x: number; z: number; widthX: number; widthZ: number };
export type Cover = { x: number; z: number; widthX: number; widthZ: number; height: number; id?: string; kind?: 'layout' | 'prop' | 'barricade' | 'block' | 'barrel' };
export type Spawn = { x: number; y: number; z: number; yaw: number };
export type ArenaLayout = {
  visualAsset: string;
  deckTopY: number;
  centralArena: Circle;
  bridges: Bridge[];
  stations: Circle[];
  cover: Cover[];
  spawns: Spawn[];
};

/** Axis-aligned footprints of the Sketchfab props placed on the stations. */
export const PROP_COVER: Cover[] = [
  { x: 28.7, z: -5.1, widthX: 2.31, widthZ: 2.58, height: 1.5, kind: 'prop' },
  { x: -28.8, z: 5.1, widthX: 2.85, widthZ: 3.15, height: 1.35, kind: 'prop' },
  { x: 4.9, z: 27.5, widthX: 0.9, widthZ: 0.9, height: 1.2, kind: 'prop' },
];

/**
 * New procedural map pieces: energy barricades around the central ring and
 * low blocks along the bridges. They give the open middle real lanes and cover
 * without changing the Blender-authored arena.
 */
export const BUILT_COVER: Cover[] = [
  { x: 4.5, z: 5.0, widthX: 2.7, widthZ: 0.6, height: 1.35, kind: 'barricade' },
  { x: -4.5, z: -5.0, widthX: 2.7, widthZ: 0.6, height: 1.35, kind: 'barricade' },
  { x: 5.0, z: -4.5, widthX: 0.6, widthZ: 2.7, height: 1.35, kind: 'barricade' },
  { x: -5.0, z: 4.5, widthX: 0.6, widthZ: 2.7, height: 1.35, kind: 'barricade' },
  { x: 15.5, z: 1.45, widthX: 1.3, widthZ: 1.3, height: 1.15, kind: 'block' },
  { x: -15.5, z: -1.45, widthX: 1.3, widthZ: 1.3, height: 1.15, kind: 'block' },
  { x: -1.45, z: -15.5, widthX: 1.3, widthZ: 1.3, height: 1.15, kind: 'block' },
  { x: 1.45, z: 15.5, widthX: 1.3, widthZ: 1.3, height: 1.15, kind: 'block' },
];

export interface Arena {
  layout: ArenaLayout;
  deckY: number;
  /** Static cover, including the layout blocks, props and procedural barricades. */
  staticCover: Cover[];
  /** Mutable cover, such as explosive barrels that can be destroyed. */
  dynamicCover: Cover[];
  /** Spawn points used by the online server, spread over the four stations. */
  spawnPoints: Spawn[];
  onDeck(x: number, z: number, radius: number): boolean;
  /** Footprint check. Cover lower than `feetY` is ignored so mechs can hover over it. */
  canMoveTo(x: number, z: number, radius: number, feetY?: number): boolean;
  /** Floor height under a footprint, including the tops of cover boxes. */
  floorAt(x: number, z: number, radius: number, feetY: number): number;
  /** Distance along a unit ray to the first cover hit, or null. */
  raycastCover(origin: Vec3, direction: Vec3, maxDistance: number): number | null;
  lineOfSight(from: Vec3, to: Vec3): boolean;
  /** Random walkable point, optionally near a centre. */
  randomDeckPoint(random?: () => number, near?: { x: number; z: number; radius: number }): { x: number; z: number };
}

function coverOverlap(x: number, z: number, radius: number, cover: Cover): boolean {
  const closestX = Math.max(cover.x - cover.widthX / 2, Math.min(x, cover.x + cover.widthX / 2));
  const closestZ = Math.max(cover.z - cover.widthZ / 2, Math.min(z, cover.z + cover.widthZ / 2));
  return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius ** 2;
}

function rayBox(origin: Vec3, dir: Vec3, maxDistance: number, deckY: number, cover: Cover): number | null {
  const min = [cover.x - cover.widthX / 2, deckY - 0.4, cover.z - cover.widthZ / 2];
  const max = [cover.x + cover.widthX / 2, deckY + cover.height, cover.z + cover.widthZ / 2];
  const start = [origin.x, origin.y, origin.z];
  const step = [dir.x, dir.y, dir.z];
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

export function createArena(layout: ArenaLayout, options: { builtCover?: boolean } = {}): Arena {
  const deckY = layout.deckTopY;
  const staticCover: Cover[] = [
    ...layout.cover.map((cover) => ({ ...cover, kind: 'layout' as const })),
    ...PROP_COVER,
    ...(options.builtCover === false ? [] : BUILT_COVER),
  ];
  const dynamicCover: Cover[] = [];
  const allCover = () => staticCover.concat(dynamicCover);

  const onDeck = (x: number, z: number, radius: number): boolean => {
    const onCircle = (circle: Circle) => (x - circle.x) ** 2 + (z - circle.z) ** 2 <= (circle.radius - radius * 0.65) ** 2;
    if (onCircle(layout.centralArena) || layout.stations.some(onCircle)) return true;
    return layout.bridges.some((bridge) => {
      const extendsX = bridge.widthX > bridge.widthZ;
      return Math.abs(x - bridge.x) <= bridge.widthX / 2 + (extendsX ? radius : -radius * 0.55)
        && Math.abs(z - bridge.z) <= bridge.widthZ / 2 + (extendsX ? -radius * 0.55 : radius);
    });
  };

  const spawnPoints: Spawn[] = [];
  for (const station of layout.stations) {
    const yaw = Math.atan2(-station.x, -station.z);
    const sideX = Math.cos(yaw);
    const sideZ = -Math.sin(yaw);
    for (const offset of [-2.6, 2.6]) {
      spawnPoints.push({ x: station.x + sideX * offset * 0.4 - Math.sin(yaw) * 1.5, y: deckY, z: station.z + sideZ * offset * 0.4 - Math.cos(yaw) * 1.5, yaw });
    }
  }

  const arena: Arena = {
    layout,
    deckY,
    staticCover,
    dynamicCover,
    spawnPoints,
    onDeck,
    canMoveTo(x, z, radius, feetY = deckY) {
      if (!onDeck(x, z, radius)) return false;
      for (const cover of allCover()) {
        if (feetY >= deckY + cover.height - 0.05) continue;
        if (coverOverlap(x, z, radius, cover)) return false;
      }
      return true;
    },
    floorAt(x, z, radius, feetY) {
      let floor = deckY;
      for (const cover of allCover()) {
        const top = deckY + cover.height;
        if (top <= feetY + 0.06 && top > floor && coverOverlap(x, z, radius * 0.55, cover)) floor = top;
      }
      return floor;
    },
    raycastCover(origin, direction, maxDistance) {
      const length = Math.hypot(direction.x, direction.y, direction.z);
      if (maxDistance <= 0 || length < 1e-9) return null;
      const dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      let nearest: number | null = null;
      for (const cover of allCover()) {
        const hit = rayBox(origin, dir, maxDistance, deckY, cover);
        if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
      }
      return nearest;
    },
    lineOfSight(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const distance = Math.hypot(dx, dy, dz);
      return arena.raycastCover(from, { x: dx, y: dy, z: dz }, distance - 0.05) === null;
    },
    randomDeckPoint(random = Math.random, near) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = near ? near.x + (random() * 2 - 1) * near.radius : (random() * 2 - 1) * 34;
        const z = near ? near.z + (random() * 2 - 1) * near.radius : (random() * 2 - 1) * 34;
        if (arena.canMoveTo(x, z, 1.1)) return { x, z };
      }
      return { x: 0, z: 0 };
    },
  };
  return arena;
}

/** Closest-approach test between a ray segment and a vertical capsule. Returns distance along the ray or null. */
export function rayCapsule(origin: Vec3, dir: Vec3, maxT: number, base: Vec3, y0: number, y1: number, radius: number): number | null {
  // Segment A: ray origin -> origin + dir * maxT. Segment B: capsule axis.
  const ax = origin.x, ay = origin.y, az = origin.z;
  const ux = dir.x * maxT, uy = dir.y * maxT, uz = dir.z * maxT;
  const bx = base.x, by = base.y + y0, bz = base.z;
  const vx = 0, vy = y1 - y0, vz = 0;
  const wx = ax - bx, wy = ay - by, wz = az - bz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denom = a * c - b * b;
  let s = denom > 1e-9 ? (b * e - c * d) / denom : 0;
  s = Math.max(0, Math.min(1, s));
  let t = c > 1e-9 ? (b * s + e) / c : 0;
  if (t < 0 || t > 1) {
    t = Math.max(0, Math.min(1, t));
    s = a > 1e-9 ? Math.max(0, Math.min(1, (t * b - d) / a)) : 0;
  }
  const px = ax + ux * s - (bx + vx * t);
  const py = ay + uy * s - (by + vy * t);
  const pz = az + uz * s - (bz + vz * t);
  const distSq = px * px + py * py + pz * pz;
  if (distSq > radius * radius) return null;
  const along = s * maxT - Math.sqrt(Math.max(0, radius * radius - distSq));
  return Math.max(0, along);
}

export function raySphere(origin: Vec3, dir: Vec3, maxT: number, center: Vec3, radius: number): number | null {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0 && t <= maxT) return t;
  if (c < 0) return 0;
  return null;
}

/** Mech hit volume: body capsule plus a head weak point worth extra damage. */
export const MECH_HITBOX = { y0: 0.45, y1: 2.75, radius: 0.85, headY: 3.18, headRadius: 0.42 } as const;

export type HitZone = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export function rayMech(origin: Vec3, dir: Vec3, maxT: number, base: Vec3, scale = 1): { t: number; critical: boolean; zone: HitZone } | null {
  const head = raySphere(origin, dir, maxT, { x: base.x, y: base.y + MECH_HITBOX.headY * scale, z: base.z }, MECH_HITBOX.headRadius * scale);
  const body = rayCapsule(origin, dir, maxT, base, MECH_HITBOX.y0 * scale, MECH_HITBOX.y1 * scale, MECH_HITBOX.radius * scale);
  const limbs: Array<{ zone: HitZone; t: number }> = [];
  for (const side of [-1, 1]) {
    const arm = rayCapsule(origin, dir, maxT, { x: base.x + side * 1.03 * scale, y: base.y, z: base.z }, 1.38 * scale, 2.62 * scale, 0.36 * scale);
    const leg = rayCapsule(origin, dir, maxT, { x: base.x + side * 0.49 * scale, y: base.y, z: base.z }, 0.12 * scale, 1.4 * scale, 0.37 * scale);
    if (arm !== null) limbs.push({ zone: side < 0 ? 'leftArm' : 'rightArm', t: arm });
    if (leg !== null) limbs.push({ zone: side < 0 ? 'leftLeg' : 'rightLeg', t: leg });
  }
  limbs.sort((a, b) => a.t - b.t);
  if (head !== null && (body === null || head <= body + 0.5) && (!limbs.length || head <= limbs[0].t + 0.1)) return { t: head, critical: true, zone: 'head' };
  if (limbs.length && (body === null || limbs[0].t <= body + 0.45)) return { t: limbs[0].t, critical: false, zone: limbs[0].zone };
  if (body !== null) return { t: body, critical: false, zone: 'torso' };
  return null;
}
