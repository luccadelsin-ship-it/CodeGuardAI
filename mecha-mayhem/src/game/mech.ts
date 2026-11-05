import {
  Color3,
  FresnelParameters,
  Material,
  Mesh,
  MeshBuilder,
  Observer,
  PBRMaterial,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MELEE_DURATION, type WeaponId } from '../shared/weapons';
import type { MechPalette } from '../shared/palette';
import type { HitZone } from '../shared/arena';
import { DEFAULT_PARTS, normalizeParts, type MechPartConfig, type PartStyle } from '../shared/customization';
import { FAMILIES, type FamilyId } from '../shared/parts';
import { armorBox, armorSurface } from './armorGraphics';

export type { MechPalette };
export type { MechPartConfig, PartStyle };
export type MechVariant = 'player' | 'sentinel' | 'brute' | 'sniper' | 'boss';

export interface MechMotion {
  /** Local forward speed (m/s, negative = backwards). */
  forward: number;
  /** Local strafe speed (m/s, positive = right). */
  lateral: number;
  airborne?: boolean;
  /** Jet thrust 0..1. */
  jet?: number;
  /** Aim pitch in radians; positive looks down. */
  aim?: number;
  sprint?: boolean;
  dash?: boolean;
}

export interface MechVisual {
  root: TransformNode;
  muzzle: TransformNode;
  weapon: WeaponId;
  setPalette(palette: MechPalette): void;
  setWeapon(weapon: WeaponId): void;
  /** Cosmetic weapon light colour (hex) or null for each weapon's own colour. */
  setGlowOverride(hex: string | null): void;
  setParts(parts: MechPartConfig): void;
  restoreParts(): void;
  animate(dt: number, motion: number | MechMotion): void;
  setShield(active: boolean): void;
  setCharge(charge01: number): void;
  setAlert(level: number): void;
  flashHit(): void;
  kick(amount: number): void;
  punch(): void;
  land(force: number): void;
  breakApart(impulse: Vector3): void;
  detachPart(zone: HitZone): void;
  loadShowcase(): Promise<boolean>;
  setShowcase(active: boolean): void;
  dispose(): void;
}

export const PALETTES: Record<MechPalette, string> = {
  arctic: '#D9E9F4',
  ember: '#EC702F',
  phantom: '#7455B9',
  steel: '#8C9AA7',
};

const VARIANT_COLORS: Record<Exclude<MechVariant, 'player'>, { armor: string; edge: string; glow: string; scale: number }> = {
  sentinel: { armor: '#596A75', edge: '#A43D33', glow: '#FF4C3A', scale: 0.86 },
  brute: { armor: '#4A5560', edge: '#FF8A2A', glow: '#FFB03A', scale: 1.02 },
  sniper: { armor: '#4B3F6B', edge: '#D23CFF', glow: '#FF45D0', scale: 0.84 },
  boss: { armor: '#2A3138', edge: '#FF3A2A', glow: '#FF2A1A', scale: 1.55 },
};

const WEAPON_GLOW: Record<WeaponId, string> = { mg: '#58DEFF', shotgun: '#FFB45A', laser: '#FF4FD8', missile: '#FF8A2A', sword: '#46DFFF', hammer: '#FF9B36' };

let mechCounter = 0;

/**
 * Builds an original, low-poly combat chassis from actual 3D meshes. The root
 * pivot is on the ground and +Z is forward, matching Babylon's left-hand scene.
 */
export function createMech(scene: Scene, palette: MechPalette, variant: MechVariant | boolean = 'player', weapon: WeaponId = 'mg'): MechVisual {
  const kind: MechVariant = variant === true ? 'sentinel' : variant === false ? 'player' : variant;
  const enemy = kind !== 'player';
  const colors = enemy ? VARIANT_COLORS[kind as Exclude<MechVariant, 'player'>] : null;
  const id = ++mechCounter;
  const root = new TransformNode(`mech-${id}`, scene);
  const rig = new TransformNode(`mech-${id}-rig`, scene);
  rig.parent = root;
  const armor = material('armor', colors ? colors.armor : PALETTES[palette], scene, id);
  const armorEdge = material('armor-edge', colors ? colors.edge : '#E9743A', scene, id);
  const chassis = material('chassis', '#17232D', scene, id);
  const dark = material('deep-metal', '#0B1720', scene, id);
  const joint = material('joint-metal', '#415869', scene, id);
  const glow = material('reactor-light', colors ? colors.glow : '#58DEFF', scene, id, true);
  const whiteGlow = material('status-light', '#D7F8FF', scene, id, true);
  const gunMetal = material('gunmetal', '#263844', scene, id);
  const weaponGlow = material('weapon-light', WEAPON_GLOW[weapon], scene, id, true);
  const flame = material('jet-flame', '#7FE9FF', scene, id, true);
  flame.alpha = 0.8;
  const allMaterials = [armor, armorEdge, chassis, dark, joint, glow, whiteGlow, gunMetal, weaponGlow, flame];

  function cube(name: string, parent: TransformNode, size: [number, number, number], pos: [number, number, number], mat: StandardMaterial, rotation: [number, number, number] = [0, 0, 0]): Mesh {
    const mesh = mat.disableLighting || Math.min(...size) < 0.025
      ? MeshBuilder.CreateBox(`${id}-${name}`, { width: size[0], height: size[1], depth: size[2] }, scene)
      : armorBox(`${id}-${name}`, size, scene);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rotation);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }

  function cyl(name: string, parent: TransformNode, diameter: number, height: number, pos: [number, number, number], mat: StandardMaterial, rotation: [number, number, number] = [0, 0, 0], sides = 8): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${id}-${name}`, { diameter, height, tessellation: sides }, scene);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rotation);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }

  // Hip and articulated legs.
  const hipShell = cube('pelvis', rig, [1.02, .40, .56], [0, 1.62, .02], chassis);
  cube('pelvis-plate', rig, [.89, .27, .14], [0, 1.7, .37], armor);
  cube('pelvis-buckle', rig, [.28, .17, .07], [0, 1.68, .465], glow);
  const legPivots: TransformNode[] = [];
  const kneePivots: TransformNode[] = [];
  const footPivots: TransformNode[] = [];
  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const hip = new TransformNode(`${id}-${label}-hip`, scene);
    hip.parent = rig;
    hip.position.set(side * .39, 1.56, 0);
    legPivots.push(hip);
    cyl(`${label}-hip-joint`, hip, .34, .29, [0, 0, 0], joint, [0, 0, Math.PI / 2], 10);
    cube(`${label}-thigh-core`, hip, [.31, .66, .34], [side * .035, -.37, .01], chassis, [0, 0, side * -.05]);
    cube(`${label}-thigh-armor`, hip, [.43, .53, .42], [side * .05, -.32, .16], armor, [0, 0, side * -.07]);
    cube(`${label}-thigh-side`, hip, [.12, .49, .33], [side * .28, -.36, .07], armorEdge);
    cube(`${label}-thigh-stripe`, hip, [.22, .07, .04], [side * .05, -.31, .393], glow);

    const knee = new TransformNode(`${id}-${label}-knee`, scene);
    knee.parent = hip;
    knee.position.set(side * .06, -.77, .02);
    kneePivots.push(knee);
    cyl(`${label}-knee-hinge`, knee, .32, .38, [0, 0, 0], dark, [0, 0, Math.PI / 2], 10);
    cube(`${label}-knee-cap`, knee, [.40, .21, .23], [0, .01, .22], armorEdge);
    cube(`${label}-shin-core`, knee, [.30, .65, .34], [0, -.38, -.02], chassis);
    cube(`${label}-shin-plate`, knee, [.42, .59, .30], [0, -.37, .17], armor);
    cube(`${label}-shin-vent`, knee, [.20, .19, .06], [0, -.48, .338], dark);
    cube(`${label}-shin-glow`, knee, [.16, .025, .07], [0, -.45, .38], glow);

    const foot = new TransformNode(`${id}-${label}-ankle`, scene);
    foot.parent = knee;
    foot.position.set(0, -.72, 0);
    footPivots.push(foot);
    cyl(`${label}-ankle-joint`, foot, .24, .28, [0, .01, 0], joint, [0, 0, Math.PI / 2]);
    cube(`${label}-foot`, foot, [.48, .19, .77], [0, -.04, .24], dark);
    cube(`${label}-toe-armor`, foot, [.49, .12, .38], [0, .04, .46], armor);
    cube(`${label}-toe-strip`, foot, [.34, .025, .06], [0, .115, .61], armorEdge);
    cube(`${label}-heel`, foot, [.39, .12, .25], [0, -.08, -.18], joint);
  }

  // Torso.
  const body = new TransformNode(`${id}-upper-body`, scene);
  body.parent = rig;
  body.position.y = 1.70;
  cube('waist-column', body, [.62, .40, .42], [0, .13, 0], joint);
  cube('abdomen', body, [.83, .48, .45], [0, .40, .02], chassis);
  cube('abdomen-plating', body, [.72, .28, .13], [0, .35, .27], armor);
  cube('chest-main', body, [1.24, .74, .64], [0, .91, .01], chassis);
  cube('chest-front', body, [1.11, .55, .16], [0, .95, .39], armor, [-.05, 0, 0]);
  cube('chest-left-plate', body, [.37, .42, .10], [-.35, .96, .49], armor, [0, 0, -.09]);
  cube('chest-right-plate', body, [.37, .42, .10], [.35, .96, .49], armor, [0, 0, .09]);
  cube('sternum', body, [.19, .58, .15], [0, 1.0, .52], dark);
  cyl('reactor-rim', body, .39, .08, [0, .95, .61], armorEdge, [Math.PI / 2, 0, 0], 12);
  const reactor = cyl('reactor', body, .25, .10, [0, .95, .67], glow, [Math.PI / 2, 0, 0], 12);
  cube('chest-top', body, [1.04, .14, .55], [0, 1.31, 0], armor);
  const flames: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    cube(`torso-side-${side}`, body, [.24, .56, .43], [side * .66, .90, .01], joint, [0, 0, side * -.13]);
    cube(`back-fin-${side}`, body, [.25, .75, .28], [side * .42, .93, -.42], armor, [side * -.18, 0, side * .09]);
    cube(`back-thruster-${side}`, body, [.20, .35, .11], [side * .43, .65, -.61], dark);
    cube(`back-thruster-glow-${side}`, body, [.13, .25, .045], [side * .43, .64, -.675], glow);
    const jet = MeshBuilder.CreateCylinder(`${id}-jet-flame-${side}`, { diameterTop: 0.2, diameterBottom: 0.02, height: 1, tessellation: 8 }, scene);
    jet.parent = body;
    jet.position.set(side * .43, .25, -.66);
    jet.rotation.x = 0.35;
    jet.material = flame;
    jet.isPickable = false;
    jet.scaling.set(1, 0.01, 1);
    jet.setEnabled(false);
    flames.push(jet);
  }
  if (kind === 'boss' || kind === 'brute') {
    // Heavy chassis: armoured back pack and reactor stacks.
    cube('heavy-pack', body, [1.0, .8, .45], [0, .95, -.62], armor);
    for (const side of [-1, 1]) cyl(`stack-${side}`, body, .2, .7, [side * .3, 1.55, -.62], dark, [0, 0, 0], 8);
    cube('heavy-pack-light', body, [.6, .06, .04], [0, 1.15, -.86], glow);
  }

  // Helmet.
  const neck = new TransformNode(`${id}-neck`, scene);
  neck.parent = body;
  neck.position.y = 1.34;
  cyl('neck-gimbal', neck, .27, .22, [0, .08, 0], joint, [0, 0, 0], 10);
  cube('helmet-skull', neck, [.62, .47, .49], [0, .39, .01], armor);
  cube('helmet-brow', neck, [.68, .17, .38], [0, .56, .12], armorEdge, [-.13, 0, 0]);
  const visor = cube('visor', neck, [.54, .13, .08], [0, .41, .294], glow);
  cube('visor-slit', neck, [.42, .04, .024], [0, .41, .344], whiteGlow);
  cube('helmet-mouth', neck, [.32, .18, .13], [0, .22, .28], dark);
  cube('crest', neck, [.16, .16, kind === 'sniper' ? .85 : .55], [0, .70, -.08], armorEdge, [-.19, 0, 0]);
  if (kind === 'sniper') cube('scope-eye', neck, [.14, .14, .2], [.24, .47, .3], glow);
  for (const side of [-1, 1] as const) {
    cyl(`ear-${side}`, neck, .23, .15, [side * .37, .39, -.02], joint, [0, 0, Math.PI / 2], 10);
    cyl(`ear-light-${side}`, neck, .12, .03, [side * .46, .39, -.02], glow, [0, 0, Math.PI / 2], 10);
    cube(`cheek-${side}`, neck, [.18, .18, .18], [side * .24, .22, .25], armor);
  }

  // Arms.
  const armPivots: TransformNode[] = [];
  const elbowPivots: TransformNode[] = [];
  let gunMount: TransformNode | undefined;
  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const shoulder = new TransformNode(`${id}-${label}-shoulder`, scene);
    shoulder.parent = body;
    shoulder.position.set(side * .74, 1.10, 0);
    armPivots.push(shoulder);
    const pad = new TransformNode(`${id}-${label}-pad`, scene);
    pad.parent = shoulder;
    if (kind === 'brute' || kind === 'boss') pad.scaling.setAll(1.35);
    cyl(`${label}-shoulder-joint`, shoulder, .36, .27, [0, 0, 0], joint, [0, 0, Math.PI / 2], 10);
    cube(`${label}-pauldron-core`, pad, [.43, .35, .46], [side * .10, -.04, .01], chassis);
    cube(`${label}-pauldron`, pad, [.55, .30, .53], [side * .13, .07, .04], armor, [0, 0, side * -.19]);
    cube(`${label}-pauldron-stripe`, pad, [.40, .055, .05], [side * .13, .16, .323], armorEdge);
    cube(`${label}-bicep`, shoulder, [.34, .51, .35], [side * .08, -.42, 0], chassis);
    cube(`${label}-bicep-armor`, shoulder, [.35, .39, .26], [side * .09, -.37, .18], armor);
    const elbow = new TransformNode(`${id}-${label}-elbow`, scene);
    elbow.parent = shoulder;
    elbow.position.set(side * .08, -.70, 0);
    elbowPivots.push(elbow);
    cyl(`${label}-elbow-hinge`, elbow, .27, .28, [0, 0, 0], joint, [0, 0, Math.PI / 2]);
    cube(`${label}-forearm`, elbow, [.36, .52, .37], [0, -.31, .02], chassis);
    cube(`${label}-forearm-shell`, elbow, [.40, .44, .27], [0, -.32, .19], armor);
    cube(`${label}-forearm-light`, elbow, [.22, .035, .045], [0, -.38, .345], glow);
    if (side < 0) {
      cube('left-fist', elbow, [.27, .21, .30], [0, -.65, .07], dark);
      cube('left-knuckle', elbow, [.30, .12, .14], [0, -.68, .25], armorEdge);
    } else {
      gunMount = new TransformNode(`${id}-gun-mount`, scene);
      gunMount.parent = elbow;
      gunMount.position.set(0, -.63, .23);
    }
  }

  // Interchangeable ranged and melee weapons mounted on the right forearm.
  const muzzle = new TransformNode(`${id}-muzzle`, scene);
  const guns = {} as Record<WeaponId, { node: TransformNode; muzzle: [number, number, number] }>;
  const coils: Mesh[] = [];
  // Tapered piece (blade tips, nozzles): a cylinder with a different top diameter.
  function taper(name: string, parent: TransformNode, bottom: number, top: number, height: number, pos: [number, number, number], mat: StandardMaterial, rotation: [number, number, number] = [Math.PI / 2, 0, 0], sides = 8): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${id}-${name}`, { diameterBottom: bottom, diameterTop: top, height, tessellation: sides }, scene);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rotation);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }
  const X: [number, number, number] = [Math.PI / 2, 0, 0];
  {
    // MK I rotary machine gun: six-barrel cluster, heat-sink fins, ammo drum and feed belt.
    const mg = new TransformNode(`${id}-machine-gun`, scene);
    mg.parent = gunMount!;
    cube('gun-body', mg, [.38, .31, .69], [0, 0, .33], gunMetal);
    cube('gun-upper-cover', mg, [.43, .10, .56], [0, .19, .27], armor);
    for (let i = 0; i < 4; i++) cube(`gun-fin-${i}`, mg, [.34, .05, .035], [0, .265, .1 + i * .11], dark);
    cyl('gun-drum', mg, .36, .2, [.33, -.1, .14], dark, [0, 0, Math.PI / 2], 14);
    cyl('gun-drum-cap', mg, .26, .03, [.44, -.1, .14], armorEdge, [0, 0, Math.PI / 2], 14);
    for (let i = 0; i < 4; i++) cube(`gun-belt-${i}`, mg, [.07, .05, .06], [.2 - i * .04, -.2 + i * .03, .28 + i * .06], armorEdge);
    cube('gun-ammo-light', mg, [.025, .12, .17], [.47, -.08, .15], weaponGlow);
    const barrels = new TransformNode(`${id}-mg-barrels`, scene);
    barrels.parent = mg;
    barrels.position.z = .83;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * .11, y = Math.sin(a) * .11;
      cyl(`barrel-${i}`, barrels, .06, .62, [x, y, .02], dark, X, 8);
      cyl(`barrel-tip-${i}`, barrels, .085, .07, [x, y, .32], gunMetal, X, 8);
    }
    cyl('barrel-spindle', barrels, .07, .66, [0, 0, 0], gunMetal, X, 8);
    cyl('barrel-clamp', barrels, .34, .06, [0, 0, .18], armor, X, 12);
    cyl('barrel-ring', mg, .39, .08, [0, 0, .77], armorEdge, X, 12);
    cube('gun-optic', mg, [.16, .13, .27], [0, .3, .19], dark);
    cyl('gun-optic-lens', mg, .1, .03, [0, .3, .335], weaponGlow, X, 12);
    cube('gun-rail', mg, [.06, .04, .5], [-.21, .05, .35], armorEdge);
    guns.mg = { node: mg, muzzle: [0, 0, 1.18] };
    (mg as TransformNode & { spin?: TransformNode }).spin = barrels;

    // Breacher shotgun: twin vented barrels, muzzle brake, pump grip with ridges, side shell rack.
    const sg = new TransformNode(`${id}-shotgun`, scene);
    sg.parent = gunMount!;
    cube('sg-receiver', sg, [.46, .36, .62], [0, 0, .26], gunMetal);
    cube('sg-receiver-plate', sg, [.48, .08, .5], [0, .2, .24], armor);
    cube('sg-shell-rack', sg, [.12, .24, .36], [.3, -.03, .2], dark);
    for (let i = 0; i < 4; i++) cyl(`sg-shell-${i}`, sg, .06, .14, [.37, -.03 + (i % 2) * .08, .1 + Math.floor(i / 2) * .18], armorEdge, [0, 0, Math.PI / 2], 8);
    for (const x of [-.11, .11]) {
      cyl(`sg-barrel-${x}`, sg, .17, .78, [x, .04, .88], dark, X, 10);
      for (let k = 0; k < 3; k++) cyl(`sg-vent-${x}-${k}`, sg, .2, .04, [x, .04, .66 + k * .17], gunMetal, X, 10);
      cyl(`sg-bore-${x}`, sg, .1, .03, [x, .04, 1.29], weaponGlow, X, 10);
    }
    cube('sg-brake', sg, [.48, .24, .12], [0, .04, 1.24], armorEdge);
    cube('sg-pump', sg, [.36, .14, .34], [0, -.18, .72], armor);
    for (let k = 0; k < 3; k++) cube(`sg-pump-ridge-${k}`, sg, [.38, .03, .04], [0, -.25, .62 + k * .1], dark);
    cube('sg-top-rail', sg, [.12, .07, .7], [0, .26, .55], armor);
    cube('sg-sight', sg, [.05, .08, .05], [0, .33, .88], weaponGlow);
    guns.shotgun = { node: sg, muzzle: [0, .04, 1.32] };

    // Lance laser cannon: capacitor bank, rails framing the coil stack, cooling fins and a lens.
    const lz = new TransformNode(`${id}-laser`, scene);
    lz.parent = gunMount!;
    cube('lz-capacitor', lz, [.34, .34, .58], [0, 0, .22], gunMetal);
    for (let k = 0; k < 3; k++) cube(`lz-cell-${k}`, lz, [.06, .2, .1], [.2, .02, .06 + k * .14], weaponGlow);
    for (let k = 0; k < 5; k++) cube(`lz-fin-${k}`, lz, [.42, .03, .05], [0, .19, .02 + k * .1], dark);
    cyl('lz-barrel', lz, .13, 1.25, [0, .02, 1.0], dark, X, 10);
    for (const y of [-.17, .21]) cube(`lz-rail-${y}`, lz, [.06, .05, 1.05], [0, y, 1.0], armor);
    for (let i = 0; i < 4; i++) {
      const coil = cyl(`lz-coil-${i}`, lz, .27 - i * .025, .07, [0, .02, .62 + i * .22], weaponGlow, X, 14);
      coils.push(coil);
    }
    cyl('lz-tip', lz, .2, .08, [0, .02, 1.6], armorEdge, X, 10);
    cyl('lz-lens', lz, .12, .03, [0, .02, 1.65], whiteGlow, X, 12);
    guns.laser = { node: lz, muzzle: [0, .02, 1.68] };

    // Hornet missile pod: 2×3 tube grid with frame, lock-on sensor dish and rear exhaust vents.
    const ms = new TransformNode(`${id}-missile-pod`, scene);
    ms.parent = gunMount!;
    cube('ms-pod', ms, [.66, .58, .78], [0, .06, .38], gunMetal);
    cube('ms-pod-armor', ms, [.7, .12, .72], [0, .4, .36], armor);
    cube('ms-frame-v', ms, [.04, .58, .05], [0, .06, .78], dark);
    for (const x of [-.2, 0.0, .2]) for (const y of [-.08, .2]) {
      if (x === 0) continue;
      cyl(`ms-tube-${x}-${y}`, ms, .17, .06, [x, y, .78], dark, X, 10);
      taper(`ms-warhead-${x}-${y}`, ms, .11, .02, .1, [x, y, .82], weaponGlow, X, 8);
    }
    for (const y of [-.08, .2]) { cyl(`ms-tube-mid-${y}`, ms, .17, .06, [0, y, .79], dark, X, 10); taper(`ms-warhead-mid-${y}`, ms, .11, .02, .1, [0, y, .83], weaponGlow, X, 8); }
    cyl('ms-dish', ms, .22, .04, [.36, .3, .5], armorEdge, [0, 0, Math.PI / 2], 12);
    cyl('ms-dish-eye', ms, .07, .05, [.39, .3, .5], weaponGlow, [0, 0, Math.PI / 2], 8);
    for (let k = 0; k < 3; k++) cube(`ms-exhaust-${k}`, ms, [.5, .04, .04], [0, -.08 + k * .14, -.02], dark);
    guns.missile = { node: ms, muzzle: [0, .06, .92] };

    // Arc energy sword: wrapped grip, pronged emitter guard, tapered blade with a bright core.
    const sword = new TransformNode(`${id}-energy-sword`, scene);
    sword.parent = gunMount!;
    cube('sword-grip', sword, [.2, .22, .63], [0, -.02, .23], gunMetal);
    for (let k = 0; k < 4; k++) cyl(`sword-wrap-${k}`, sword, .25, .04, [0, -.02, .02 + k * .13], dark, X, 8);
    cyl('sword-pommel', sword, .2, .1, [0, -.02, -.1], armorEdge, X, 8);
    cube('sword-guard', sword, [.55, .12, .18], [0, 0, .59], armorEdge);
    for (const side of [-1, 1]) cube(`sword-prong-${side}`, sword, [.06, .08, .22], [side * .24, 0, .74], armor, [0, side * -.25, 0]);
    cube('sword-blade-core', sword, [.08, .06, 1.42], [0, .02, 1.38], whiteGlow);
    cube('sword-blade-glow', sword, [.2, .12, 1.4], [0, .02, 1.38], weaponGlow);
    taper('sword-tip', sword, .2, 0, .32, [0, .02, 2.24], weaponGlow, X, 4);
    guns.sword = { node: sword, muzzle: [0, .02, 2.32] };

    // Quake mechanical hammer: wrapped haft, pistons and a rocket nozzle on the back of the head.
    const hammer = new TransformNode(`${id}-mechanical-hammer`, scene);
    hammer.parent = gunMount!;
    cube('hammer-grip', hammer, [.22, .24, 1.43], [0, 0, .67], gunMetal);
    for (let k = 0; k < 3; k++) cyl(`hammer-wrap-${k}`, hammer, .28, .05, [0, 0, .08 + k * .14], dark, X, 8);
    cube('hammer-head', hammer, [.95, .45, .52], [0, 0, 1.45], armor);
    cube('hammer-head-band', hammer, [.98, .48, .08], [0, 0, 1.3], dark);
    cube('hammer-impact-face', hammer, [1.02, .48, .10], [0, 0, 1.77], dark);
    for (const x of [-.3, 0, .3]) for (const y of [-.12, .12]) cube(`hammer-stud-${x}-${y}`, hammer, [.1, .1, .06], [x, y, 1.84], gunMetal);
    for (const x of [-.32, .32]) cyl(`hammer-piston-${x}`, hammer, .12, .36, [x, .27, 1.38], gunMetal, X, 8);
    taper('hammer-nozzle', hammer, .3, .18, .22, [0, 0, 1.14], dark, [-Math.PI / 2, 0, 0], 10);
    cyl('hammer-nozzle-glow', hammer, .16, .02, [0, 0, 1.02], weaponGlow, X, 10);
    cube('hammer-energy', hammer, [.65, .055, .56], [0, .25, 1.45], weaponGlow);
    for (const side of [-1, 1]) cube(`hammer-vent-${side}`, hammer, [.04, .22, .3], [side * .49, 0, 1.45], weaponGlow);
    guns.hammer = { node: hammer, muzzle: [0, 0, 1.75] };
  }
  muzzle.parent = gunMount!;

  // Chassis kits: each family uses one of three silhouettes (scout/striker/titan),
  // its own accent and light colours per slot, and a signature helmet detail.
  type Shape = 'scout' | 'striker' | 'titan';
  const partKits: Record<keyof MechPartConfig, Record<Shape, TransformNode[]>> = {
    head: { scout: [], striker: [], titan: [] },
    torso: { scout: [], striker: [], titan: [] },
    legs: { scout: [], striker: [], titan: [] },
  };
  const slotAccent = {
    head: material('head-accent', '#E9743A', scene, id),
    torso: material('torso-accent', '#E9743A', scene, id),
    legs: material('legs-accent', '#E9743A', scene, id),
  };
  const slotLight = {
    head: material('head-light', '#58DEFF', scene, id, true),
    torso: material('torso-light', '#58DEFF', scene, id, true),
    legs: material('legs-light', '#58DEFF', scene, id, true),
  };
  allMaterials.push(...Object.values(slotAccent), ...Object.values(slotLight));
  function kit(part: keyof MechPartConfig, style: Shape, parent: TransformNode): TransformNode {
    const node = new TransformNode(`${id}-${part}-${style}-kit`, scene);
    node.parent = parent;
    partKits[part][style].push(node);
    return node;
  }
  const scoutHead = kit('head', 'scout', neck);
  for (const side of [-1, 1]) {
    cube(`scout-helmet-fin-${side}`, scoutHead, [.09, .28, .58], [side * .38, .61, -.13], slotAccent.head, [-.35, 0, side * -.32]);
    cyl(`scout-antenna-${side}`, scoutHead, .025, .45, [side * .27, .91, -.16], dark);
    cyl(`scout-antenna-tip-${side}`, scoutHead, .065, .07, [side * .27, 1.15, -.16], slotLight.head);
  }
  const strikerHead = kit('head', 'striker', neck);
  cube('striker-helmet-ridge', strikerHead, [.12, .1, .42], [0, .64, .08], slotAccent.head, [-.1, 0, 0]);
  const titanHead = kit('head', 'titan', neck);
  cube('titan-helmet-brow', titanHead, [.83, .16, .26], [0, .66, .16], armor);
  cube('titan-helmet-jaw', titanHead, [.69, .18, .17], [0, .12, .3], slotAccent.head);
  for (const side of [-1, 1]) cube(`titan-helmet-ear-${side}`, titanHead, [.20, .42, .45], [side * .44, .38, -.02], armor);
  const scoutTorso = kit('torso', 'scout', body);
  for (const side of [-1, 1]) {
    cube(`scout-chest-fin-${side}`, scoutTorso, [.13, .67, .14], [side * .69, 1.12, -.29], slotAccent.torso, [0, 0, side * -.32]);
    cube(`scout-reactor-slat-${side}`, scoutTorso, [.06, .32, .07], [side * .43, 1.0, .55], slotLight.torso, [0, 0, side * -.25]);
  }
  const strikerTorso = kit('torso', 'striker', body);
  for (const side of [-1, 1]) cube(`striker-chest-trim-${side}`, strikerTorso, [.08, .44, .06], [side * .55, .95, .47], slotAccent.torso, [0, 0, side * .09]);
  const titanTorso = kit('torso', 'titan', body);
  for (const side of [-1, 1]) {
    cube(`titan-chest-plate-${side}`, titanTorso, [.52, .66, .19], [side * .4, 1.01, .55], armor, [0, 0, side * .10]);
    cube(`titan-chest-guard-${side}`, titanTorso, [.23, .64, .63], [side * .73, .91, .0], slotAccent.torso);
    cube(`titan-reactor-vent-${side}`, titanTorso, [.23, .055, .04], [side * .4, .97, .66], slotLight.torso);
  }
  cube('titan-back-armor', titanTorso, [1.08, .76, .3], [0, 1.0, -.58], armor);
  for (const [i, side] of [-1, 1].entries()) {
    const scoutLeg = kit('legs', 'scout', kneePivots[i]);
    cube(`scout-calf-fin-${side}`, scoutLeg, [.10, .61, .22], [side * .27, -.34, -.13], slotAccent.legs, [.12, 0, side * -.2]);
    const strikerLeg = kit('legs', 'striker', kneePivots[i]);
    cube(`striker-shin-trim-${side}`, strikerLeg, [.08, .4, .05], [side * .19, -.36, .33], slotAccent.legs);
    const titanLeg = kit('legs', 'titan', kneePivots[i]);
    cube(`titan-shin-guard-${side}`, titanLeg, [.57, .62, .21], [0, -.31, .35], armor);
    cube(`titan-knee-guard-${side}`, titanLeg, [.62, .29, .17], [0, .04, .3], slotAccent.legs);
    cube(`titan-calf-pack-${side}`, titanLeg, [.45, .54, .23], [0, -.32, -.29], dark);
    cube(`legs-light-${side}`, kneePivots[i] as TransformNode, [.05, .2, .05], [side * .2, -.2, .34], slotLight.legs);
  }
  // Signature helmet details so every family reads at a glance.
  const signatures = new Map<FamilyId, TransformNode>();
  const signature = (family: FamilyId) => { const node = new TransformNode(`${id}-sig-${family}`, scene); node.parent = neck; signatures.set(family, node); return node; };
  { const n = signature('phantom'); for (const side of [-1, 1]) cube(`phantom-v-${side}`, n, [.07, .38, .07], [side * .11, .78, .2], slotAccent.head, [0, 0, side * .55]); cube('phantom-visor-v', n, [.5, .05, .05], [0, .43, .335], slotLight.head); }
  { const n = signature('industrial'); for (const y of [.55, .62]) cube(`industrial-cage-${y}`, n, [.72, .04, .06], [0, y, .33], dark); for (const side of [-1, 1]) cyl(`industrial-eye-${side}`, n, .13, .05, [side * .14, .4, .34], slotLight.head, [Math.PI / 2, 0, 0], 12); }
  { const n = signature('spectre'); for (const side of [-1, 1]) { const ring = MeshBuilder.CreateTorus(`${id}-spectre-ring-${side}`, { diameter: .3, thickness: .04, tessellation: 20 }, scene); ring.parent = n; ring.position.set(side * .47, .39, -.02); ring.rotation.z = Math.PI / 2; ring.material = slotLight.head; ring.isPickable = false; } }
  { const n = signature('vanguard'); cube('vanguard-brow-plate', n, [.32, .13, .1], [0, .58, .27], material('vanguard-ivory', '#E9E2C8', scene, id)); cyl('vanguard-antenna', n, .03, .55, [.18, .85, -.22], dark); }
  { const n = signature('ronin'); for (const side of [-1, 1]) cube(`ronin-horn-${side}`, n, [.06, .46, .1], [side * .18, .86, .18], slotAccent.head, [.35, 0, side * -.42]); cube('ronin-crest', n, [.2, .12, .06], [0, .66, .28], slotLight.head); }
  { const n = signature('warden'); cube('warden-face-slab', n, [.56, .3, .08], [0, .32, .31], slotAccent.head); cube('warden-slit', n, [.36, .03, .03], [0, .41, .36], slotLight.head); }
  { const n = signature('tempest'); for (const side of [-1, 1]) cube(`tempest-fin-${side}`, n, [.05, .22, .62], [side * .2, .72, -.18], slotAccent.head, [-.5, side * .15, 0]); cube('tempest-crest', n, [.06, .16, .5], [0, .74, -.02], material('tempest-silver', '#C9D3DA', scene, id)); }
  let partConfig: MechPartConfig = { ...DEFAULT_PARTS };
  function setParts(next: MechPartConfig): void {
    partConfig = normalizeParts(next);
    for (const part of ['head', 'torso', 'legs'] as const) {
      const family = FAMILIES[partConfig[part]];
      for (const style of ['scout', 'striker', 'titan'] as const) for (const node of partKits[part][style]) node.setEnabled(style === family.shape);
      if (!enemy) {
        slotAccent[part].diffuseColor = Color3.FromHexString(family.accent);
        slotAccent[part].specularColor = slotAccent[part].diffuseColor.scale(.5);
        const light = Color3.FromHexString(family.light);
        slotLight[part].diffuseColor = light;
        slotLight[part].emissiveColor = light.scale(.85);
      }
    }
    for (const [family, node] of signatures) node.setEnabled(family === partConfig.head);
    const headShape = FAMILIES[partConfig.head].shape, legShape = FAMILIES[partConfig.legs].shape, torsoShape = FAMILIES[partConfig.torso].shape;
    neck.scaling.setAll(headShape === 'scout' ? .91 : headShape === 'titan' ? 1.08 : 1);
    const legWidth = legShape === 'scout' ? .88 : legShape === 'titan' ? 1.10 : 1;
    for (const hip of legPivots) hip.scaling.set(legWidth, 1, legWidth);
    body.scaling.set(torsoShape === 'titan' ? 1.07 : torsoShape === 'scout' ? .94 : 1, 1, torsoShape === 'titan' ? 1.06 : 1);
    root.metadata = { ...(root.metadata ?? {}), parts: { ...partConfig } };
    if (showcaseRoot) setShowcase(showcaseRequested);
  }

  // Energy shield shell.
  const shieldMat = material('shield', enemy ? '#FF6546' : '#53DCFF', scene, id, true);
  shieldMat.alpha = .16;
  shieldMat.backFaceCulling = false;
  allMaterials.push(shieldMat);
  const shield = MeshBuilder.CreateSphere(`${id}-shield`, { diameter: 4.25, segments: 14 }, scene);
  shield.parent = root;
  shield.position.y = 1.75;
  shield.material = shieldMat;
  shield.isPickable = false;
  shield.setEnabled(false);
  const shieldRing = MeshBuilder.CreateTorus(`${id}-shield-ring`, { diameter: 4.22, thickness: .025, tessellation: 44 }, scene);
  shieldRing.parent = root;
  shieldRing.position.y = 1.75;
  shieldRing.material = glow;
  shieldRing.isPickable = false;
  shieldRing.setEnabled(false);

  if (colors) root.scaling.setAll(colors.scale);

  // Triverse showcase model (menu only); the articulated chassis handles gameplay.
  let showcaseRoot: TransformNode | null = null;
  let showcaseMaterials: Array<StandardMaterial | PBRMaterial> = [];
  let showcaseAllMaterials: Material[] = [];
  let showcasePromise: Promise<boolean> | null = null;
  let showcaseRequested = false;
  let disposed = false;
  let shieldActive = false;

  function recolorShowcase(next: MechPalette) {
    if (enemy) return;
    const base = Color3.FromHexString(PALETTES[next]);
    for (const mat of showcaseMaterials) {
      const shaded = mat.name.toLowerCase().includes('shaded');
      const color = shaded ? base.scale(.60) : base;
      if (mat instanceof PBRMaterial) mat.albedoColor.copyFrom(color);
      else mat.diffuseColor.copyFrom(color);
    }
  }

  function setShowcase(active: boolean) {
    showcaseRequested = active;
    if (!showcaseRoot) return;
    const showImported = active && Object.values(partConfig).every((style) => style === 'striker');
    rig.setEnabled(!showImported);
    showcaseRoot.setEnabled(showImported);
    shield.setEnabled(!showImported && shieldActive);
    shieldRing.setEnabled(!showImported && shieldActive);
  }

  function loadShowcase(): Promise<boolean> {
    if (showcasePromise) return showcasePromise;
    showcasePromise = (async () => {
      for (const [folder, file] of [['/assets/triverse/', 'striker_full_colored.glb'], ['/assets/models/striker/', 'striker_full.glb']]) {
        try {
          const imported = await SceneLoader.ImportMeshAsync('', folder, file, scene);
          const importedMaterials = [...new Set(imported.meshes.map((mesh) => mesh.material).filter((mat): mat is Material => mat !== null))];
          if (disposed) {
            for (const mesh of imported.meshes) mesh.dispose(false, false);
            for (const mat of importedMaterials) mat.dispose();
            return false;
          }
          const holder = new TransformNode(`${id}-blender-showcase`, scene);
          holder.parent = root;
          for (const node of imported.transformNodes) if (!node.parent) node.parent = holder;
          for (const mesh of imported.meshes) { if (!mesh.parent) mesh.parent = holder; mesh.isPickable = false; }
          showcaseRoot = holder;
          showcaseAllMaterials = importedMaterials;
          showcaseMaterials = importedMaterials.filter(
            (mat): mat is StandardMaterial | PBRMaterial =>
              (mat instanceof StandardMaterial || mat instanceof PBRMaterial) &&
              (mat.name.toLowerCase().includes('ceramic white') || mat.name.toLowerCase().includes('shaded white')),
          );
          recolorShowcase(palette);
          setShowcase(showcaseRequested);
          return true;
        } catch (error) {
          console.warn(`Modelo de apresentação indisponível: ${folder}${file}`, error);
        }
      }
      return false;
    })();
    return showcasePromise;
  }

  // Animation state.
  let phase = 0;
  let time = Math.random() * 10;
  let hitTime = 0;
  let recoil = 0;
  let punchTime = 0;
  let punchDuration = .38;
  let swingSide = 1;
  let landTime = 0;
  let landForce = 0;
  let air = 0;
  let jetLevel = 0;
  let charge = 0;
  let alert = 0;
  let lastStepPhase = 0;
  let spin = 0;
  const normalEmissive = glow.emissiveColor.clone();
  const normalArmorEmissive = armor.emissiveColor.clone();
  const normalWeaponGlow = weaponGlow.emissiveColor.clone();

  const visual: MechVisual = {
    root, muzzle, weapon,
    setPalette, setWeapon, setGlowOverride, setParts, restoreParts, animate, setShield, setCharge, setAlert, flashHit, kick, punch, land,
    breakApart, detachPart, loadShowcase, setShowcase, dispose,
  };

  function setPalette(next: MechPalette) {
    if (enemy) return;
    palette = next;
    armor.diffuseColor = Color3.FromHexString(PALETTES[next]);
    armor.specularColor = Color3.Lerp(armor.diffuseColor, Color3.White(), .38).scale(.65);
    recolorShowcase(next);
  }

  function setWeapon(next: WeaponId) {
    visual.weapon = next;
    for (const [key, gun] of Object.entries(guns)) gun.node.setEnabled(key === next);
    muzzle.position.set(...guns[next].muzzle);
    const color = Color3.FromHexString(glowOverride ?? WEAPON_GLOW[next]);
    weaponGlow.emissiveColor = color;
    weaponGlow.diffuseColor = color;
    normalWeaponGlow.copyFrom(color);
    charge = 0;
  }
  let glowOverride: string | null = null;
  function setGlowOverride(hex: string | null) { glowOverride = hex; setWeapon(visual.weapon); }
  setWeapon(weapon);
  setParts(DEFAULT_PARTS);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

  function animate(dt: number, motionInput: number | MechMotion) {
    const motion: MechMotion = typeof motionInput === 'number' ? { forward: motionInput, lateral: 0 } : motionInput;
    time += dt;
    const speed = Math.hypot(motion.forward, motion.lateral);
    const gait = Math.min(1.35, speed / 6);
    // Phase follows distance, so a stationary mech does not march in place.
    phase += dt * (0.4 + gait * 8.4);
    const stride = Math.sin(phase) * Math.min(1, gait);
    const fwd = speed > 0.1 ? motion.forward / speed : 1;
    const lat = speed > 0.1 ? motion.lateral / speed : 0;
    air = lerp(air, motion.airborne ? 1 : 0, dt * 10);
    const ground = 1 - air;
    const strideSign = fwd < -0.2 ? -1 : 1;
    const fwdWeight = Math.abs(fwd) * ground;
    const latWeight = Math.abs(lat) * ground;
    for (const [i, hip] of legPivots.entries()) {
      if (detached.has(i === 0 ? 'leftLeg' : 'rightLeg')) continue;
      const s = i === 0 ? stride : -stride;
      hip.rotation.x = s * .5 * fwdWeight * strideSign + air * (i === 0 ? -.55 : -.2);
      hip.rotation.z = s * .22 * latWeight * Math.sign(lat || 1);
      kneePivots[i].rotation.x = Math.max(0, -s) * .5 * Math.max(fwdWeight, latWeight * .7) + air * (i === 0 ? .9 : .45) + landTime * landForce * .9;
      footPivots[i].rotation.x = -hip.rotation.x * .35 - kneePivots[i].rotation.x * .3;
    }
    // Footstep pulse for audio (exposed through the root metadata).
    if (gait > 0.2 && ground > 0.9 && Math.floor(phase / Math.PI) !== lastStepPhase) {
      lastStepPhase = Math.floor(phase / Math.PI);
      root.metadata = { ...(root.metadata ?? {}), step: (root.metadata?.step ?? 0) + 1 };
    }

    recoil = Math.max(0, recoil - dt * 6);
    punchTime = Math.max(0, punchTime - dt);
    landTime = Math.max(0, landTime - dt * 4);
    const bob = Math.abs(Math.sin(phase)) * Math.min(1, gait) * (motion.sprint ? .07 : .045) * ground;
    const breathe = Math.sin(time * 1.8) * .018 * (1 - Math.min(1, gait));
    body.position.y = 1.70 + bob + breathe - landTime * landForce * .22;
    rig.position.y = -landTime * landForce * .12;
    body.rotation.x = (motion.sprint ? .14 : .05) * fwd * Math.min(1, gait) - recoil * .12 + (motion.dash ? .2 : 0);
    body.rotation.z = -lat * .13 * Math.min(1, gait) + Math.sin(phase) * Math.min(1, gait) * .028;
    body.rotation.y = lerp(body.rotation.y, lat * .18 * Math.min(1, gait), dt * 6);
    body.position.z = -recoil * .1;
    const aim = motion.aim ?? 0.05;
    const detachedLeftRotation = detached.has('leftArm') ? armPivots[0].rotation.clone() : null;
    const detachedRightRotation = detached.has('rightArm') ? armPivots[1].rotation.clone() : null;
    if (!detached.has('head')) { neck.rotation.x = aim * .45 - body.rotation.x * .25; neck.rotation.y = -body.rotation.y * .35 + Math.sin(time * .7) * .025 * (1 - Math.min(1, gait)); }
    // Right arm aims the weapon, left arm swings or throws the punch.
    armPivots[1].rotation.x = aim * .9 - .06 - recoil * .45;
    armPivots[1].rotation.y = 0;
    elbowPivots[1].rotation.x = -.2 - recoil * .3;
    if (punchTime > 0) {
      const t = 1 - punchTime / punchDuration;
      const extend = t < .35 ? t / .35 : 1 - (t - .35) / .65;
      armPivots[0].rotation.x = -1.45 * extend;
      elbowPivots[0].rotation.x = -.15 * extend;
      body.rotation.y -= .35 * extend;
    } else {
      armPivots[0].rotation.x = -stride * .2 * fwdWeight + air * -.35;
      elbowPivots[0].rotation.x = -.09 + Math.max(0, stride) * .08;
    }
    armPivots[0].rotation.z = air * -.25;
    armPivots[1].rotation.z = air * .15;

    if (punchTime > 0 && visual.weapon === 'sword' && !detached.has('rightArm')) {
      const t = 1 - punchTime / punchDuration;
      // Strike window centred on MELEE_CONTACT.sword / MELEE_DURATION.sword (≈ 0.36).
      const wind = smooth(t / .22), strike = smooth((t - .22) / .27), recover = 1 - smooth((t - .64) / .36);
      const sweep = (-1.05 * wind + 2.1 * strike) * recover * swingSide;
      armPivots[1].rotation.x = -.78 * wind * recover;
      armPivots[1].rotation.y = sweep;
      armPivots[1].rotation.z = -.38 * wind * recover;
      elbowPivots[1].rotation.x = -.45 * (1 - strike) * recover;
      body.rotation.y += sweep * .37;
      body.rotation.x += .08 * strike * recover;
      armPivots[0].rotation.x = -.42 * wind * recover;
      armPivots[0].rotation.z = -.35 * recover;
    } else if (punchTime > 0 && visual.weapon === 'hammer' && !detached.has('rightArm')) {
      const t = 1 - punchTime / punchDuration;
      // Hammer lands at MELEE_CONTACT.hammer / MELEE_DURATION.hammer (≈ 0.47): long wind-up, fast drop.
      const wind = smooth(t / .36), strike = smooth((t - .36) / .22), recover = 1 - smooth((t - .66) / .34);
      armPivots[1].rotation.x = (-2.15 * wind + 2.75 * strike) * recover;
      armPivots[1].rotation.y = -.2 * wind * recover;
      elbowPivots[1].rotation.x = -.6 * (1 - strike) * recover;
      armPivots[0].rotation.x = -1.1 * wind * recover;
      body.rotation.x += (-.13 * wind + .48 * strike) * recover;
      body.position.y -= .14 * strike * recover;
      rig.position.y -= .1 * strike * recover;
    }

    // Detached limbs keep their debris trajectory instead of being reanimated.
    if (detachedLeftRotation) armPivots[0].rotation.copyFrom(detachedLeftRotation);
    if (detachedRightRotation) armPivots[1].rotation.copyFrom(detachedRightRotation);

    // Rotating machine-gun barrels and weapon glow.
    const mgSpin = (guns.mg.node as TransformNode & { spin?: TransformNode }).spin;
    spin = lerp(spin, recoil > 0.02 && visual.weapon === 'mg' ? 22 : 0, dt * 4);
    if (mgSpin) mgSpin.rotation.z += spin * dt;
    if (visual.weapon === 'laser') {
      for (const [i, coil] of coils.entries()) coil.scaling.setAll(1 + charge * .35 * (0.6 + 0.4 * Math.sin(time * 30 + i)));
      weaponGlow.emissiveColor = normalWeaponGlow.scale(.6 + charge * 1.4);
    }

    // Jets and shield.
    jetLevel = lerp(jetLevel, motion.jet ?? (motion.dash ? 1 : 0), dt * 12);
    for (const jet of flames) {
      jet.setEnabled(jetLevel > .03);
      const flicker = .85 + Math.random() * .3;
      jet.scaling.set(1 + jetLevel * .4, (.2 + jetLevel * 1.4) * flicker, 1 + jetLevel * .4);
      jet.position.y = .25 - jet.scaling.y * .42;
    }
    if (shieldActive) { shieldRing.rotation.y += dt * 1.8; shield.rotation.y -= dt * .4; }

    // Hit flash / telegraph glow.
    if (hitTime > 0) {
      hitTime = Math.max(0, hitTime - dt);
      armor.emissiveColor = Color3.Lerp(normalArmorEmissive, new Color3(.85, .12, .05), hitTime / .18);
      glow.emissiveColor = Color3.Lerp(normalEmissive, new Color3(1, .3, .05), hitTime / .18);
    } else {
      armor.emissiveColor.copyFrom(normalArmorEmissive);
      const boost = 1 + alert * (1.6 + Math.sin(time * 40) * .5);
      glow.emissiveColor = normalEmissive.scale(boost);
    }
    visor.scaling.y = 1 + alert * .8;
    reactor.scaling.setAll(1 + alert * .3);
  }

  function setShield(active: boolean) {
    shieldActive = active;
    shield.setEnabled(active);
    shieldRing.setEnabled(active);
  }

  function setCharge(value: number) { charge = Math.max(0, Math.min(1, value)); }
  function setAlert(level: number) { alert = Math.max(0, Math.min(1, level)); }
  function flashHit() { hitTime = .18; }
  function kick(amount: number) { recoil = Math.min(1, recoil + amount); }
  function punch() {
    swingSide *= -1;
    punchDuration = MELEE_DURATION[visual.weapon] ?? .38;
    punchTime = punchDuration;
  }
  function land(force: number) { landTime = 1; landForce = Math.min(1, force / 14); }

  // Death: the chassis comes apart into its real 3D parts.
  let breakObserver: Observer<Scene> | null = null;
  const pieces: Array<{ mesh: Mesh; vel: Vector3; spin: Vector3 }> = [];
  const detached = new Set<HitZone>();
  const detachedNodes: TransformNode[] = [];
  const detachedOrigins = new Map<TransformNode, { parent: TransformNode; position: Vector3; rotation: Vector3; quaternion: Quaternion | null; scaling: Vector3 }>();
  const detachObservers = new Map<TransformNode, Observer<Scene>>();
  function restoreParts() {
    for (const [node, origin] of detachedOrigins) {
      const observer = detachObservers.get(node);
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      node.setParent(origin.parent);
      node.position.copyFrom(origin.position);
      node.rotation.copyFrom(origin.rotation);
      node.rotationQuaternion = origin.quaternion?.clone() ?? null;
      node.scaling.copyFrom(origin.scaling);
      node.setEnabled(true);
    }
    detachedOrigins.clear();
    detachObservers.clear();
    detachedNodes.length = 0;
    detached.clear();
    setParts(partConfig);
  }
  function detachPart(zone: HitZone) {
    if (detached.has(zone) || zone === 'torso') return;
    detached.add(zone);
    const node = zone === 'head' ? neck : zone === 'leftArm' ? armPivots[0] : zone === 'rightArm' ? armPivots[1] : zone === 'leftLeg' ? legPivots[0] : legPivots[1];
    detachedOrigins.set(node, { parent: node.parent as TransformNode, position: node.position.clone(), rotation: node.rotation.clone(), quaternion: node.rotationQuaternion?.clone() ?? null, scaling: node.scaling.clone() });
    node.computeWorldMatrix(true);
    const position = node.getAbsolutePosition().clone();
    node.setParent(null);
    node.position.copyFrom(position);
    detachedNodes.push(node);
    let velocity = new Vector3((Math.random() - 0.5) * 5, 5, (Math.random() - 0.5) * 5);
    let time = 0;
    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      time += dt;
      velocity.y -= 19 * dt;
      node.position.addInPlace(velocity.scale(dt));
      node.rotation.x += dt * 3;
      node.rotation.z += dt * 2;
      if (node.position.y < root.position.y + 0.15) { node.position.y = root.position.y + 0.15; velocity = velocity.scale(0.35); velocity.y = Math.abs(velocity.y) * 0.25; }
      if (time > 2.5 || disposed) { scene.onBeforeRenderObservable.remove(observer); detachObservers.delete(node); }
    });
    detachObservers.set(node, observer);
  }
  function breakApart(impulse: Vector3) {
    if (breakObserver) return;
    setShield(false);
    const center = root.getAbsolutePosition().add(new Vector3(0, 1.8 * root.scaling.y, 0));
    for (const mesh of rig.getChildMeshes(false) as Mesh[]) {
      if (!mesh.isEnabled()) continue;
      mesh.setParent(null);
      const out = mesh.getAbsolutePosition().subtract(center);
      out.y = Math.abs(out.y) + 0.6;
      out.normalize();
      const vel = out.scale(3 + Math.random() * 6).add(impulse.scale(0.6 + Math.random() * 0.6));
      vel.y += 3 + Math.random() * 4;
      pieces.push({ mesh, vel, spin: new Vector3((Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 14) });
    }
    rig.setEnabled(false);
    let elapsed = 0;
    const floor = root.position.y;
    breakObserver = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      elapsed += dt;
      for (const p of pieces) {
        p.vel.y -= 20 * dt;
        p.mesh.position.addInPlace(p.vel.scale(dt));
        if (p.mesh.rotationQuaternion) {
          p.mesh.rotationQuaternion = null;
        }
        p.mesh.rotation.addInPlace(p.spin.scale(dt));
        if (p.mesh.position.y < floor + 0.1) { p.mesh.position.y = floor + 0.1; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; p.spin.scaleInPlace(0.6); }
        if (elapsed > 2.2) p.mesh.scaling.scaleInPlace(Math.max(0, 1 - dt * 3));
      }
      if (elapsed > 3.4) dispose();
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (breakObserver) { scene.onBeforeRenderObservable.remove(breakObserver); breakObserver = null; }
    for (const observer of detachObservers.values()) scene.onBeforeRenderObservable.remove(observer);
    detachObservers.clear();
    for (const p of pieces) p.mesh.dispose();
    pieces.length = 0;
    for (const node of detachedNodes) node.dispose(false, true);
    root.dispose(false);
    for (const mat of allMaterials) mat.dispose();
    for (const mat of showcaseAllMaterials) mat.dispose();
  }

  hipShell.receiveShadows = true;
  return visual;
}

function material(name: string, hex: string, scene: Scene, id: number, emissive = false): StandardMaterial {
  const result = new StandardMaterial(`${id}-${name}`, scene);
  const color = Color3.FromHexString(hex);
  result.diffuseColor = color;
  result.specularColor = emissive ? color : color.scale(.55);
  result.specularPower = emissive ? 16 : name === 'joint-metal' || name === 'gunmetal' ? 112 : 76;
  result.emissiveColor = emissive ? color.scale(.8) : Color3.Black();
  result.ambientColor = color.scale(.08);
  if (!emissive) {
    const surface = armorSurface(scene);
    result.diffuseTexture = surface.paint;
    result.bumpTexture = surface.normal;
    result.roughness = name === 'joint-metal' ? 0.24 : name === 'armor' ? 0.46 : 0.58;
    result.specularColor = Color3.Lerp(color, Color3.White(), name === 'armor' ? .38 : .58).scale(.65);
    if (scene.environmentTexture) {
      result.reflectionTexture = scene.environmentTexture;
      result.reflectionFresnelParameters = new FresnelParameters();
      result.reflectionFresnelParameters.leftColor = new Color3(.32, .35, .38);
      result.reflectionFresnelParameters.rightColor = new Color3(.035, .04, .05);
      result.reflectionFresnelParameters.power = 4;
      result.useReflectionFresnelFromSpecular = true;
    }
  }
  return result;
}
