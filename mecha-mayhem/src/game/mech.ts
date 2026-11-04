import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export type MechPalette = 'arctic' | 'ember' | 'phantom' | 'steel';

export interface MechVisual {
  root: TransformNode;
  muzzle: TransformNode;
  setPalette(palette: MechPalette): void;
  animate(dt: number, speed: number): void;
  setShield(active: boolean): void;
  flashHit(): void;
  loadShowcase(): Promise<boolean>;
  setShowcase(active: boolean): void;
  dispose(): void;
}

const PALETTES: Record<MechPalette, string> = {
  arctic: '#D9E9F4',
  ember: '#EC702F',
  phantom: '#7455B9',
  steel: '#8C9AA7',
};

let mechCounter = 0;

/**
 * Builds an original, low-poly combat chassis from actual 3D meshes. The root
 * pivot is on the ground and +Z is forward, matching Babylon's left-hand scene.
 */
export function createMech(scene: Scene, palette: MechPalette, enemy = false): MechVisual {
  const id = ++mechCounter;
  const root = new TransformNode(`mech-${id}`, scene);
  const armor = material('armor', enemy ? '#596A75' : PALETTES[palette], scene, id);
  const armorEdge = material('armor-edge', enemy ? '#A43D33' : '#E9743A', scene, id);
  const chassis = material('chassis', '#17232D', scene, id);
  const dark = material('deep-metal', '#0B1720', scene, id);
  const joint = material('joint-metal', '#415869', scene, id);
  const glow = material('reactor-light', enemy ? '#FF4C3A' : '#58DEFF', scene, id, true);
  const whiteGlow = material('status-light', '#D7F8FF', scene, id, true);
  const gunMetal = material('gunmetal', '#263844', scene, id);

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

  // Hip and articulated legs. The knees and feet have their own pivots so
  // walking reads as a weighted machine instead of a sliding static statue.
  const hipShell = cube('pelvis', root, [1.02, .40, .56], [0, 1.62, .02], chassis);
  cube('pelvis-plate', root, [.89, .27, .14], [0, 1.7, .37], armor);
  cube('pelvis-buckle', root, [.28, .17, .07], [0, 1.68, .465], glow);
  const legPivots: TransformNode[] = [];
  const kneePivots: TransformNode[] = [];
  const footPivots: TransformNode[] = [];
  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const hip = new TransformNode(`${id}-${label}-hip`, scene);
    hip.parent = root;
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

  // The torso pivots over the hip. All major armor panels remain a coherent
  // silhouette while details give the chassis a practical mechanical scale.
  const body = new TransformNode(`${id}-upper-body`, scene);
  body.parent = root;
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
  cyl('reactor', body, .25, .10, [0, .95, .67], glow, [Math.PI / 2, 0, 0], 12);
  cube('chest-top', body, [1.04, .14, .55], [0, 1.31, 0], armor);
  for (const side of [-1, 1] as const) {
    cube(`torso-side-${side}`, body, [.24, .56, .43], [side * .66, .90, .01], joint, [0, 0, side * -.13]);
    cube(`back-fin-${side}`, body, [.25, .75, .28], [side * .42, .93, -.42], armor, [side * -.18, 0, side * .09]);
    cube(`back-thruster-${side}`, body, [.20, .35, .11], [side * .43, .65, -.61], dark);
    cube(`back-thruster-glow-${side}`, body, [.13, .25, .045], [side * .43, .64, -.675], glow);
  }

  // Helmet, cyan visor, ear sensors, and a short orange command crest.
  const neck = new TransformNode(`${id}-neck`, scene);
  neck.parent = body;
  neck.position.y = 1.34;
  cyl('neck-gimbal', neck, .27, .22, [0, .08, 0], joint, [0, 0, 0], 10);
  cube('helmet-skull', neck, [.62, .47, .49], [0, .39, .01], armor);
  cube('helmet-brow', neck, [.68, .17, .38], [0, .56, .12], armorEdge, [-.13, 0, 0]);
  cube('visor', neck, [.54, .13, .08], [0, .41, .294], glow);
  cube('visor-slit', neck, [.42, .04, .024], [0, .41, .344], whiteGlow);
  cube('helmet-mouth', neck, [.32, .18, .13], [0, .22, .28], dark);
  cube('crest', neck, [.16, .16, .55], [0, .70, -.08], armorEdge, [-.19, 0, 0]);
  for (const side of [-1, 1] as const) {
    cyl(`ear-${side}`, neck, .23, .15, [side * .37, .39, -.02], joint, [0, 0, Math.PI / 2], 10);
    cyl(`ear-light-${side}`, neck, .12, .03, [side * .46, .39, -.02], glow, [0, 0, Math.PI / 2], 10);
    cube(`cheek-${side}`, neck, [.18, .18, .18], [side * .24, .22, .25], armor);
  }

  // Arms are integral to the torso module as requested in the concept brief.
  const armPivots: TransformNode[] = [];
  const elbowPivots: TransformNode[] = [];
  let muzzle: TransformNode | undefined;
  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const shoulder = new TransformNode(`${id}-${label}-shoulder`, scene);
    shoulder.parent = body;
    shoulder.position.set(side * .74, 1.10, 0);
    armPivots.push(shoulder);
    cyl(`${label}-shoulder-joint`, shoulder, .36, .27, [0, 0, 0], joint, [0, 0, Math.PI / 2], 10);
    cube(`${label}-pauldron-core`, shoulder, [.43, .35, .46], [side * .10, -.04, .01], chassis);
    cube(`${label}-pauldron`, shoulder, [.55, .30, .53], [side * .13, .07, .04], armor, [0, 0, side * -.19]);
    cube(`${label}-pauldron-stripe`, shoulder, [.40, .055, .05], [side * .13, .16, .323], armorEdge);
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
      // Machine gun points along +Z. It is actually mounted to the articulated
      // right forearm, and the muzzle node is used by the projectile effect.
      const gun = new TransformNode(`${id}-machine-gun`, scene);
      gun.parent = elbow;
      gun.position.set(0, -.63, .23);
      cube('gun-body', gun, [.38, .31, .69], [0, 0, .33], gunMetal);
      cube('gun-upper-cover', gun, [.43, .10, .56], [0, .19, .27], armor);
      cube('gun-side-magazine', gun, [.17, .31, .28], [.31, -.09, .15], dark);
      cube('gun-ammo-light', gun, [.025, .12, .17], [.41, -.08, .15], armorEdge);
      for (const x of [-.12, .12]) {
        for (const y of [-.075, .075]) {
          cyl(`barrel-${x}-${y}`, gun, .075, .55, [x, y, .83], dark, [Math.PI / 2, 0, 0], 8);
          cyl(`barrel-tip-${x}-${y}`, gun, .10, .09, [x, y, 1.10], gunMetal, [Math.PI / 2, 0, 0], 8);
        }
      }
      cyl('barrel-ring', gun, .39, .08, [0, 0, .77], armorEdge, [Math.PI / 2, 0, 0], 12);
      cube('gun-optic', gun, [.16, .13, .27], [0, .29, .19], dark);
      cube('gun-optic-light', gun, [.10, .055, .04], [0, .30, .345], glow);
      muzzle = new TransformNode(`${id}-muzzle`, scene);
      muzzle.parent = gun;
      muzzle.position.set(0, 0, 1.18);
    }
  }

  // Shield shell is intentionally simple and only enabled during the ability.
  const shieldMat = material('shield', enemy ? '#FF6546' : '#53DCFF', scene, id, true);
  shieldMat.alpha = .14;
  shieldMat.backFaceCulling = false;
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

  // A Triverse image-to-3D mesh, cleaned and colored in Blender, is the menu
  // showcase. The original Blender model remains the loading fallback. The
  // articulated procedural chassis underneath handles live gameplay.
  const proceduralNodes = root.getChildren().filter((node) => node !== shield && node !== shieldRing);
  let showcaseRoot: TransformNode | null = null;
  let showcaseMaterials: Array<StandardMaterial | PBRMaterial> = [];
  let showcaseAllMaterials: Material[] = [];
  let showcasePromise: Promise<boolean> | null = null;
  let showcaseRequested = false;
  let disposed = false;

  function recolorShowcase(next: MechPalette) {
    if (enemy) return;
    const base = Color3.FromHexString(PALETTES[next]);
    for (const mat of showcaseMaterials) {
      const shaded = mat.name.toLowerCase().includes('shaded');
      const color = shaded ? base.scale(.60) : base;
      if (mat instanceof PBRMaterial) {
        mat.albedoColor.copyFrom(color);
      } else {
        mat.diffuseColor.copyFrom(color);
      }
    }
  }

  function setShowcase(active: boolean) {
    showcaseRequested = active;
    if (!showcaseRoot) return;
    for (const node of proceduralNodes) node.setEnabled(!active);
    showcaseRoot.setEnabled(active);
    // Shield nodes are not included in the procedural switch because their
    // visibility is driven by the ability, even after leaving the garage.
    shield.setEnabled(!active && shieldActive);
    shieldRing.setEnabled(!active && shieldActive);
  }

  function loadShowcase(): Promise<boolean> {
    if (showcasePromise) return showcasePromise;
    showcasePromise = (async () => {
      for (const [folder, file] of [
        ['/assets/triverse/', 'striker_full_colored.glb'],
        ['/assets/models/striker/', 'striker_full.glb'],
      ]) {
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
        for (const node of imported.transformNodes) {
          if (!node.parent) node.parent = holder;
        }
        for (const mesh of imported.meshes) {
          if (!mesh.parent) mesh.parent = holder;
          mesh.isPickable = false;
        }
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

  let phase = 0;
  let hitTime = 0;
  let shieldActive = false;
  const normalEmissive = glow.emissiveColor.clone();
  const normalArmorEmissive = armor.emissiveColor.clone();

  function setPalette(next: MechPalette) {
    if (enemy) return;
    palette = next;
    armor.diffuseColor = Color3.FromHexString(PALETTES[next]);
    armor.specularColor = armor.diffuseColor.scale(.55);
    recolorShowcase(next);
  }

  function animate(dt: number, speed: number) {
    const gait = Math.min(1, Math.max(0, speed / 5.8));
    phase += dt * (2.6 + gait * 7.6);
    const stride = Math.sin(phase) * gait;
    const strideOpposite = Math.sin(phase + Math.PI) * gait;
    legPivots[0].rotation.x = stride * .48;
    legPivots[1].rotation.x = strideOpposite * .48;
    kneePivots[0].rotation.x = Math.max(0, -stride) * .43;
    kneePivots[1].rotation.x = Math.max(0, -strideOpposite) * .43;
    footPivots[0].rotation.x = -legPivots[0].rotation.x * .35 - kneePivots[0].rotation.x * .25;
    footPivots[1].rotation.x = -legPivots[1].rotation.x * .35 - kneePivots[1].rotation.x * .25;
    armPivots[0].rotation.x = -stride * .16;
    armPivots[1].rotation.x = -strideOpposite * .08;
    elbowPivots[0].rotation.x = -.09 + Math.max(0, stride) * .06;
    elbowPivots[1].rotation.x = -.20;
    body.position.y = 1.70 + Math.abs(Math.sin(phase)) * gait * .027;
    body.rotation.z = Math.sin(phase) * gait * .018;
    if (shieldActive) shieldRing.rotation.y += dt * 1.8;
    if (hitTime > 0) {
      hitTime = Math.max(0, hitTime - dt);
      armor.emissiveColor = Color3.Lerp(normalArmorEmissive, new Color3(.8, .09, .04), hitTime / .18);
      glow.emissiveColor = Color3.Lerp(normalEmissive, new Color3(1, .25, .05), hitTime / .18);
    } else {
      armor.emissiveColor.copyFrom(normalArmorEmissive);
      glow.emissiveColor.copyFrom(normalEmissive);
    }
  }

  function setShield(active: boolean) {
    shieldActive = active;
    shield.setEnabled(active);
    shieldRing.setEnabled(active);
  }

  function flashHit() { hitTime = .18; }

  function dispose() {
    disposed = true;
    root.dispose(false);
    for (const mat of [armor, armorEdge, chassis, dark, joint, glow, whiteGlow, gunMetal, shieldMat]) mat.dispose();
    for (const mat of showcaseAllMaterials) mat.dispose();
  }

  // Hide a few internal mesh faces through regular depth testing; no texture
  // assets or 2D cutouts are used for this character.
  hipShell.receiveShadows = true;
  return { root, muzzle: muzzle!, setPalette, animate, setShield, flashHit, loadShowcase, setShowcase, dispose };
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
