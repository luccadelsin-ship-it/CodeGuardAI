import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  Observer,
  PBRMaterial,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { WeaponId } from '../shared/weapons';
import type { MechPalette } from '../shared/palette';

export type { MechPalette };
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
  animate(dt: number, motion: number | MechMotion): void;
  setShield(active: boolean): void;
  setCharge(charge01: number): void;
  setAlert(level: number): void;
  flashHit(): void;
  kick(amount: number): void;
  punch(): void;
  land(force: number): void;
  breakApart(impulse: Vector3): void;
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

const WEAPON_GLOW: Record<WeaponId, string> = { mg: '#58DEFF', shotgun: '#FFB45A', laser: '#FF4FD8', missile: '#FF8A2A' };

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
    const mesh = MeshBuilder.CreateBox(`${id}-${name}`, { width: size[0], height: size[1], depth: size[2] }, scene);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rotation);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }

  function cyl(name: string, parent: TransformNode, diameter: number, height: number, pos: [number, number, number], mat: StandardMaterial, rotation: [number, number, number] = [0, 0, 0], sides = 8): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${id}-${name}`, { diameter, height, tessellation: sides }, scene);
    mesh.parent = parent;
    mesh.position.set(...pos);
    mesh.rotation.set(...rotation);
    mesh.material = mat;
    mesh.isPickable = false;
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

  // Four interchangeable weapon models mounted on the right forearm.
  const muzzle = new TransformNode(`${id}-muzzle`, scene);
  const guns = {} as Record<WeaponId, { node: TransformNode; muzzle: [number, number, number] }>;
  const coils: Mesh[] = [];
  {
    const mg = new TransformNode(`${id}-machine-gun`, scene);
    mg.parent = gunMount!;
    cube('gun-body', mg, [.38, .31, .69], [0, 0, .33], gunMetal);
    cube('gun-upper-cover', mg, [.43, .10, .56], [0, .19, .27], armor);
    cube('gun-side-magazine', mg, [.17, .31, .28], [.31, -.09, .15], dark);
    cube('gun-ammo-light', mg, [.025, .12, .17], [.41, -.08, .15], armorEdge);
    const barrels = new TransformNode(`${id}-mg-barrels`, scene);
    barrels.parent = mg;
    barrels.position.z = .83;
    for (const x of [-.12, .12]) for (const y of [-.075, .075]) {
      cyl(`barrel-${x}-${y}`, barrels, .075, .55, [x, y, 0], dark, [Math.PI / 2, 0, 0], 8);
      cyl(`barrel-tip-${x}-${y}`, barrels, .10, .09, [x, y, .27], gunMetal, [Math.PI / 2, 0, 0], 8);
    }
    cyl('barrel-ring', mg, .39, .08, [0, 0, .77], armorEdge, [Math.PI / 2, 0, 0], 12);
    cube('gun-optic', mg, [.16, .13, .27], [0, .29, .19], dark);
    cube('gun-optic-light', mg, [.10, .055, .04], [0, .30, .345], weaponGlow);
    guns.mg = { node: mg, muzzle: [0, 0, 1.18] };
    (mg as TransformNode & { spin?: TransformNode }).spin = barrels;

    const sg = new TransformNode(`${id}-shotgun`, scene);
    sg.parent = gunMount!;
    cube('sg-receiver', sg, [.46, .36, .62], [0, 0, .26], gunMetal);
    cube('sg-shell-box', sg, [.2, .28, .34], [.33, -.04, .2], armorEdge);
    for (const x of [-.11, .11]) {
      cyl(`sg-barrel-${x}`, sg, .17, .78, [x, .04, .88], dark, [Math.PI / 2, 0, 0], 10);
      cyl(`sg-bore-${x}`, sg, .1, .03, [x, .04, 1.27], weaponGlow, [Math.PI / 2, 0, 0], 10);
    }
    cube('sg-pump', sg, [.36, .14, .34], [0, -.18, .72], armor);
    cube('sg-top-rail', sg, [.12, .07, .7], [0, .22, .55], armor);
    guns.shotgun = { node: sg, muzzle: [0, .04, 1.3] };

    const lz = new TransformNode(`${id}-laser`, scene);
    lz.parent = gunMount!;
    cube('lz-capacitor', lz, [.34, .34, .58], [0, 0, .22], gunMetal);
    cube('lz-cell', lz, [.08, .22, .4], [.21, .02, .2], weaponGlow);
    cyl('lz-barrel', lz, .13, 1.25, [0, .02, 1.0], dark, [Math.PI / 2, 0, 0], 10);
    for (let i = 0; i < 4; i++) {
      const coil = cyl(`lz-coil-${i}`, lz, .27 - i * .025, .07, [0, .02, .62 + i * .22], weaponGlow, [Math.PI / 2, 0, 0], 14);
      coils.push(coil);
    }
    cyl('lz-tip', lz, .2, .08, [0, .02, 1.6], armorEdge, [Math.PI / 2, 0, 0], 10);
    guns.laser = { node: lz, muzzle: [0, .02, 1.68] };

    const ms = new TransformNode(`${id}-missile-pod`, scene);
    ms.parent = gunMount!;
    cube('ms-pod', ms, [.62, .54, .78], [0, .06, .38], gunMetal);
    cube('ms-pod-armor', ms, [.66, .12, .7], [0, .37, .36], armor);
    for (const x of [-.15, .15]) for (const y of [-.07, .19]) {
      cyl(`ms-tube-${x}-${y}`, ms, .19, .06, [x, y, .78], dark, [Math.PI / 2, 0, 0], 10);
      cyl(`ms-warhead-${x}-${y}`, ms, .09, .04, [x, y, .8], weaponGlow, [Math.PI / 2, 0, 0], 8);
    }
    cube('ms-side-light', ms, [.03, .1, .4], [.33, .1, .35], armorEdge);
    guns.missile = { node: ms, muzzle: [0, .06, .9] };
  }
  muzzle.parent = gunMount!;

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
    rig.setEnabled(!active);
    showcaseRoot.setEnabled(active);
    shield.setEnabled(!active && shieldActive);
    shieldRing.setEnabled(!active && shieldActive);
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
    setPalette, setWeapon, animate, setShield, setCharge, setAlert, flashHit, kick, punch, land,
    breakApart, loadShowcase, setShowcase, dispose,
  };

  function setPalette(next: MechPalette) {
    if (enemy) return;
    palette = next;
    armor.diffuseColor = Color3.FromHexString(PALETTES[next]);
    armor.specularColor = armor.diffuseColor.scale(.55);
    recolorShowcase(next);
  }

  function setWeapon(next: WeaponId) {
    visual.weapon = next;
    for (const [key, gun] of Object.entries(guns)) gun.node.setEnabled(key === next);
    muzzle.position.set(...guns[next].muzzle);
    const color = Color3.FromHexString(WEAPON_GLOW[next]);
    weaponGlow.emissiveColor = color;
    weaponGlow.diffuseColor = color;
    normalWeaponGlow.copyFrom(color);
    charge = 0;
  }
  setWeapon(weapon);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);

  function animate(dt: number, motionInput: number | MechMotion) {
    const motion: MechMotion = typeof motionInput === 'number' ? { forward: motionInput, lateral: 0 } : motionInput;
    time += dt;
    const speed = Math.hypot(motion.forward, motion.lateral);
    const gait = Math.min(1.35, speed / 6);
    phase += dt * (2.4 + gait * 7.2);
    const stride = Math.sin(phase) * Math.min(1, gait);
    const fwd = speed > 0.1 ? motion.forward / speed : 1;
    const lat = speed > 0.1 ? motion.lateral / speed : 0;
    air = lerp(air, motion.airborne ? 1 : 0, dt * 10);
    const ground = 1 - air;
    const strideSign = fwd < -0.2 ? -1 : 1;
    const fwdWeight = Math.abs(fwd) * ground;
    const latWeight = Math.abs(lat) * ground;
    for (const [i, hip] of legPivots.entries()) {
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
    const bob = Math.abs(Math.sin(phase)) * Math.min(1, gait) * .04 * ground;
    const breathe = Math.sin(time * 2) * .012 * (1 - Math.min(1, gait));
    body.position.y = 1.70 + bob + breathe - landTime * landForce * .22;
    rig.position.y = -landTime * landForce * .12;
    body.rotation.x = (motion.sprint ? .14 : .05) * fwd * Math.min(1, gait) - recoil * .12 + (motion.dash ? .2 : 0);
    body.rotation.z = -lat * .1 * Math.min(1, gait) + Math.sin(phase) * Math.min(1, gait) * .02;
    body.rotation.y = lerp(body.rotation.y, lat * .18 * Math.min(1, gait), dt * 6);
    body.position.z = -recoil * .1;
    const aim = motion.aim ?? 0.05;
    neck.rotation.x = aim * .45;
    // Right arm aims the weapon, left arm swings or throws the punch.
    armPivots[1].rotation.x = aim * .9 - .06 - recoil * .45;
    elbowPivots[1].rotation.x = -.2 - recoil * .3;
    if (punchTime > 0) {
      const t = 1 - punchTime / .38;
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
  function punch() { punchTime = .38; }
  function land(force: number) { landTime = 1; landForce = Math.min(1, force / 14); }

  // Death: the chassis comes apart into its real 3D parts.
  let breakObserver: Observer<Scene> | null = null;
  const pieces: Array<{ mesh: Mesh; vel: Vector3; spin: Vector3 }> = [];
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
    for (const p of pieces) p.mesh.dispose();
    pieces.length = 0;
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
  result.specularPower = emissive ? 16 : 80;
  result.emissiveColor = emissive ? color.scale(.8) : Color3.Black();
  result.ambientColor = color.scale(.15);
  return result;
}
