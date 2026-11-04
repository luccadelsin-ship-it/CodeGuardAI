import {
  Color3,
  Color4,
  DynamicTexture,
  InstancedMesh,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

type Rgb = [number, number, number];

interface Timed { ttl: number; life: number; update(t: number, dt: number): void; dispose(): void }

interface Debris { mesh: InstancedMesh; vel: Vector3; spin: Vector3; ttl: number; life: number; floor: number }

let flare: Texture | null = null;
let smokeTex: Texture | null = null;

/** Soft radial sprite generated in code; no texture asset needed. */
export function flareTexture(scene: Scene): Texture {
  if (flare) return flare;
  const tex = new DynamicTexture('fx-flare', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  tex.update();
  tex.hasAlpha = true;
  flare = tex;
  return tex;
}

function smokeTexture(scene: Scene): Texture {
  if (smokeTex) return smokeTex;
  const tex = new DynamicTexture('fx-smoke', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 7; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 12 + Math.random() * 12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  tex.update();
  tex.hasAlpha = true;
  smokeTex = tex;
  return tex;
}

function color4(rgb: Rgb, a = 1): Color4 { return new Color4(rgb[0], rgb[1], rgb[2], a); }

/** Pooled particle bursts, beams, tracers, debris, explosions and camera trauma. */
export class Fx {
  trauma = 0;
  quality: 'high' | 'medium' | 'low' = 'high';
  private readonly timed: Timed[] = [];
  private readonly debris: Debris[] = [];
  private readonly sparkPool: ParticleSystem[] = [];
  private readonly firePool: ParticleSystem[] = [];
  private readonly smokePool: ParticleSystem[] = [];
  private sparkIndex = 0;
  private fireIndex = 0;
  private smokeIndex = 0;
  private readonly beamTemplates = new Map<string, Mesh>();
  private readonly shockPool: Array<{ ring: Mesh; mat: StandardMaterial; thickness: number }> = [];
  private readonly debrisTemplate: Mesh;
  private readonly flashLight: PointLight;
  private flashTime = 0;
  private flashDuration = 0.06;
  private flashPower = 0;

  constructor(private readonly scene: Scene) {
    const tex = flareTexture(scene);
    for (let i = 0; i < 10; i++) {
      const ps = new ParticleSystem(`fx-sparks-${i}`, 120, scene);
      ps.particleTexture = tex;
      ps.emitter = Vector3.Zero();
      ps.minSize = 0.05; ps.maxSize = 0.16;
      ps.minLifeTime = 0.12; ps.maxLifeTime = 0.38;
      ps.minEmitPower = 4; ps.maxEmitPower = 11;
      ps.emitRate = 0;
      ps.gravity = new Vector3(0, -16, 0);
      ps.createSphereEmitter(0.12);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.color1 = new Color4(1, 0.85, 0.5, 1);
      ps.color2 = new Color4(1, 0.5, 0.2, 1);
      ps.colorDead = new Color4(0.4, 0.1, 0, 0);
      ps.updateSpeed = 0.016;
      ps.start();
      this.sparkPool.push(ps);
    }
    for (let i = 0; i < 6; i++) {
      const ps = new ParticleSystem(`fx-fire-${i}`, 160, scene);
      ps.particleTexture = tex;
      ps.emitter = Vector3.Zero();
      ps.minSize = 0.6; ps.maxSize = 1.8;
      ps.minLifeTime = 0.25; ps.maxLifeTime = 0.6;
      ps.minEmitPower = 2; ps.maxEmitPower = 7;
      ps.emitRate = 0;
      ps.gravity = new Vector3(0, 3, 0);
      ps.createSphereEmitter(0.6);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.color1 = new Color4(1, 0.75, 0.3, 1);
      ps.color2 = new Color4(1, 0.35, 0.1, 1);
      ps.colorDead = new Color4(0.2, 0.05, 0.02, 0);
      ps.addSizeGradient(0, 0.6); ps.addSizeGradient(0.4, 1.2); ps.addSizeGradient(1, 0.3);
      ps.updateSpeed = 0.016;
      ps.start();
      this.firePool.push(ps);
    }
    const smoke = smokeTexture(scene);
    for (let i = 0; i < 5; i++) {
      const ps = new ParticleSystem(`fx-smoke-${i}`, 80, scene);
      ps.particleTexture = smoke;
      ps.emitter = Vector3.Zero();
      ps.minSize = 1.2; ps.maxSize = 2.8;
      ps.minLifeTime = 0.9; ps.maxLifeTime = 1.8;
      ps.minEmitPower = 0.8; ps.maxEmitPower = 2.6;
      ps.emitRate = 0;
      ps.gravity = new Vector3(0, 1.6, 0);
      ps.createSphereEmitter(0.8);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.color1 = new Color4(0.22, 0.24, 0.27, 0.55);
      ps.color2 = new Color4(0.12, 0.13, 0.15, 0.45);
      ps.colorDead = new Color4(0.1, 0.1, 0.12, 0);
      ps.addSizeGradient(0, 0.5); ps.addSizeGradient(1, 2.2);
      ps.minAngularSpeed = -1; ps.maxAngularSpeed = 1;
      ps.updateSpeed = 0.016;
      ps.start();
      this.smokePool.push(ps);
    }
    this.debrisTemplate = MeshBuilder.CreateBox('fx-debris', { size: 1 }, scene);
    const debrisMat = new StandardMaterial('fx-debris-mat', scene);
    debrisMat.diffuseColor = new Color3(0.16, 0.2, 0.24);
    debrisMat.emissiveColor = new Color3(0.35, 0.12, 0.04);
    debrisMat.specularColor = new Color3(0.3, 0.3, 0.3);
    this.debrisTemplate.material = debrisMat;
    this.debrisTemplate.isPickable = false;
    this.debrisTemplate.setEnabled(false);
    this.flashLight = new PointLight('fx-flash', Vector3.Zero(), scene);
    this.flashLight.intensity = 0;
    this.flashLight.range = 18;
  }

  setQuality(quality: 'high' | 'medium' | 'low'): void { this.quality = quality; }

  private scaleCount(count: number): number {
    return Math.max(1, Math.round(count * (this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.65 : 0.35)));
  }

  shake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }

  /** Camera offset from accumulated trauma (squared for a punchy falloff). */
  cameraShake(dt: number, time: number): Vector3 {
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const power = this.trauma * this.trauma * 0.55;
    if (power <= 0.0001) return Vector3.Zero();
    return new Vector3(
      Math.sin(time * 47.3) * power + Math.sin(time * 91.1) * power * 0.4,
      Math.sin(time * 53.9 + 1.3) * power,
      Math.sin(time * 61.7 + 2.1) * power * 0.6,
    );
  }

  sparks(position: Vector3, color: Rgb = [1, 0.75, 0.35], count = 14, power = 1): void {
    const ps = this.sparkPool[this.sparkIndex++ % this.sparkPool.length];
    (ps.emitter as Vector3).copyFrom(position);
    ps.color1 = color4(color);
    ps.color2 = color4([color[0] * 0.9, color[1] * 0.6, color[2] * 0.5]);
    ps.minEmitPower = 3 * power; ps.maxEmitPower = 10 * power;
    ps.manualEmitCount = this.scaleCount(count);
  }

  /** Fireball, smoke, debris, shockwave ring and a light pulse. */
  explosion(position: Vector3, size = 1, color: Rgb = [1, 0.55, 0.2]): void {
    const fire = this.firePool[this.fireIndex++ % this.firePool.length];
    (fire.emitter as Vector3).copyFrom(position);
    fire.minSize = 0.5 * size; fire.maxSize = 1.7 * size;
    fire.minEmitPower = 2 * size; fire.maxEmitPower = 7 * size;
    fire.color1 = color4(color);
    fire.manualEmitCount = this.scaleCount(Math.round(45 * size));
    const smoke = this.smokePool[this.smokeIndex++ % this.smokePool.length];
    (smoke.emitter as Vector3).copyFrom(position);
    smoke.manualEmitCount = this.scaleCount(Math.round(14 * size));
    this.sparks(position, [1, 0.8, 0.45], Math.round(30 * size), 1.4 * size);
    this.shockwave(position, 4.2 * size, color, 0.45);
    this.lightFlash(position, color, 2.6 * size, 0.18);
    const chunks = this.scaleCount(Math.round(7 * size));
    for (let i = 0; i < chunks; i++) this.spawnDebris(position, size);
    this.shake(0.28 * size);
  }

  private spawnDebris(position: Vector3, size: number): void {
    if (this.debris.length > 90) { const old = this.debris.shift(); old?.mesh.dispose(); }
    const mesh = this.debrisTemplate.createInstance('debris');
    mesh.position.copyFrom(position);
    const s = (0.12 + Math.random() * 0.22) * Math.sqrt(size);
    mesh.scaling.set(s, s * (0.5 + Math.random()), s * (0.6 + Math.random()));
    mesh.isPickable = false;
    const angle = Math.random() * Math.PI * 2;
    const out = 3 + Math.random() * 6 * size;
    this.debris.push({ mesh, vel: new Vector3(Math.cos(angle) * out, 4 + Math.random() * 7 * size, Math.sin(angle) * out), spin: new Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), ttl: 1.6 + Math.random() * 0.8, life: 2.4, floor: 0.56 });
  }

  lightFlash(position: Vector3, color: Rgb, power: number, duration = 0.06): void {
    if (power < this.flashPower * (this.flashTime / Math.max(0.001, this.flashDuration))) return;
    this.flashLight.position.copyFrom(position);
    this.flashLight.diffuse = new Color3(color[0], color[1], color[2]);
    this.flashLight.specular = this.flashLight.diffuse;
    this.flashPower = power;
    this.flashDuration = duration;
    this.flashTime = duration;
  }

  private beamTemplate(color: Rgb): Mesh {
    const key = color.map((v) => v.toFixed(2)).join(',');
    let template = this.beamTemplates.get(key);
    if (!template) {
      template = MeshBuilder.CreateCylinder(`fx-beam-${key}`, { diameter: 1, height: 1, tessellation: 6 }, this.scene);
      const mat = new StandardMaterial(`fx-beam-mat-${key}`, this.scene);
      mat.emissiveColor = new Color3(color[0], color[1], color[2]);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.alpha = 0.9;
      template.material = mat;
      template.isPickable = false;
      template.setEnabled(false);
      this.beamTemplates.set(key, template);
    }
    return template;
  }

  /** Glowing line segment that thins out over its lifetime. */
  tracer(from: Vector3, to: Vector3, color: Rgb, width = 0.05, ttl = 0.09): void {
    const delta = to.subtract(from);
    const length = delta.length();
    if (length < 0.05) return;
    const mesh = this.beamTemplate(color).createInstance('tracer');
    mesh.isPickable = false;
    mesh.position.copyFrom(from.add(to).scale(0.5));
    mesh.rotationQuaternion = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), delta.scale(1 / length), mesh.rotationQuaternion);
    mesh.scaling.set(width, length, width);
    this.timed.push({
      ttl, life: ttl,
      update: (t) => { const k = Math.max(0.02, t); mesh.scaling.x = width * k; mesh.scaling.z = width * k; },
      dispose: () => mesh.dispose(),
    });
  }

  /** Laser beam: hot core plus a wide coloured sheath and sparks along the path. */
  beam(from: Vector3, to: Vector3, color: Rgb, width: number): void {
    this.tracer(from, to, color, width * 2.4, 0.32);
    this.tracer(from, to, [1, 0.92, 1], width * 0.75, 0.24);
    const length = Vector3.Distance(from, to);
    const steps = Math.min(8, Math.floor(length / 6));
    for (let i = 1; i <= steps; i++) this.sparks(Vector3.Lerp(from, to, i / (steps + 1)), color, 4, 0.5);
    this.lightFlash(from, color, 2.2, 0.12);
  }

  /** Expanding flat ring on the ground or in the air. */
  shockwave(position: Vector3, radius: number, color: Rgb, ttl = 0.4, thickness = 0.12): void {
    const reused = this.shockPool.findIndex((item) => item.thickness === thickness);
    const item = reused >= 0 ? this.shockPool.splice(reused, 1)[0] : (() => {
      const ring = MeshBuilder.CreateTorus('fx-shock', { diameter: 1, thickness, tessellation: 40 }, this.scene);
      const mat = new StandardMaterial('fx-shock-mat', this.scene);
      mat.disableLighting = true;
      ring.material = mat;
      return { ring, mat, thickness };
    })();
    const { ring, mat } = item;
    ring.setEnabled(true);
    ring.position.copyFrom(position);
    ring.isPickable = false;
    mat.emissiveColor = new Color3(color[0], color[1], color[2]);
    mat.alpha = 0.85;
    this.timed.push({
      ttl, life: ttl,
      update: (t) => { const s = 0.4 + (1 - t) * radius * 2; ring.scaling.set(s, 1, s); mat.alpha = t * 0.85; },
      dispose: () => { ring.setEnabled(false); if (this.shockPool.length < 40) this.shockPool.push(item); else { ring.dispose(); mat.dispose(); } },
    });
  }

  /** Billboard flash at a weapon muzzle. */
  muzzleFlash(node: TransformNode, color: Rgb, size = 0.6): void {
    const plane = MeshBuilder.CreatePlane('fx-muzzle', { size: 1 }, this.scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position.copyFrom(node.getAbsolutePosition());
    plane.isPickable = false;
    const mat = new StandardMaterial('fx-muzzle-mat', this.scene);
    mat.diffuseTexture = flareTexture(this.scene);
    mat.opacityTexture = mat.diffuseTexture;
    mat.emissiveColor = new Color3(color[0], color[1], color[2]);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    plane.scaling.setAll(size * (0.8 + Math.random() * 0.5));
    plane.rotation.z = Math.random() * Math.PI;
    this.timed.push({ ttl: 0.06, life: 0.06, update: (t) => plane.scaling.setAll(size * (0.4 + t)), dispose: () => { plane.dispose(); mat.dispose(); } });
    this.lightFlash(node.getAbsolutePosition(), color, 1.2, 0.05);
  }

  /** Floating glowing sphere used for telegraphs and pickups. */
  orb(position: Vector3 | TransformNode, color: Rgb, size: number, ttl: number, grow = false): Mesh {
    const sphere = MeshBuilder.CreateSphere('fx-orb', { diameter: 1, segments: 8 }, this.scene);
    if (position instanceof TransformNode) sphere.parent = position; else sphere.position.copyFrom(position);
    sphere.isPickable = false;
    const mat = new StandardMaterial('fx-orb-mat', this.scene);
    mat.emissiveColor = new Color3(color[0], color[1], color[2]);
    mat.disableLighting = true;
    mat.alpha = 0.8;
    sphere.material = mat;
    sphere.scaling.setAll(grow ? 0.05 : size);
    this.timed.push({
      ttl, life: ttl,
      update: (t) => { const s = grow ? size * (1 - t) + 0.05 : size * (0.3 + t * 0.7); sphere.scaling.setAll(s); mat.alpha = grow ? 0.5 + (1 - t) * 0.5 : t * 0.8; },
      dispose: () => { sphere.dispose(); mat.dispose(); },
    });
    return sphere;
  }

  /** Vertical light column for spawns and supply drops. */
  pillar(position: Vector3, color: Rgb, ttl = 1.1, height = 18): void {
    const column = MeshBuilder.CreateCylinder('fx-pillar', { diameterTop: 0.5, diameterBottom: 1.8, height, tessellation: 16, cap: Mesh.NO_CAP }, this.scene);
    column.position.set(position.x, position.y + height / 2, position.z);
    column.isPickable = false;
    const mat = new StandardMaterial('fx-pillar-mat', this.scene);
    mat.emissiveColor = new Color3(color[0], color[1], color[2]);
    mat.disableLighting = true;
    mat.alpha = 0.5;
    mat.backFaceCulling = false;
    column.material = mat;
    this.timed.push({ ttl, life: ttl, update: (t) => { mat.alpha = 0.55 * t; column.scaling.x = column.scaling.z = 0.4 + t * 0.8; }, dispose: () => { column.dispose(); mat.dispose(); } });
    this.shockwave(position.add(new Vector3(0, 0.1, 0)), 3, color, 0.6);
  }

  update(dt: number): void {
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const item = this.timed[i];
      item.ttl -= dt;
      if (item.ttl <= 0) { item.dispose(); this.timed.splice(i, 1); continue; }
      item.update(item.ttl / item.life, dt);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.ttl -= dt;
      d.vel.y -= 20 * dt;
      d.mesh.position.addInPlace(d.vel.scale(dt));
      d.mesh.rotation.addInPlace(d.spin.scale(dt));
      if (d.mesh.position.y < d.floor) { d.mesh.position.y = d.floor; d.vel.y *= -0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.scaleInPlace(0.5); }
      if (d.ttl < 0.4) d.mesh.scaling.scaleInPlace(Math.max(0, 1 - dt * 6));
      if (d.ttl <= 0) { d.mesh.dispose(); this.debris.splice(i, 1); }
    }
    if (this.flashTime > 0) {
      this.flashTime = Math.max(0, this.flashTime - dt);
      this.flashLight.intensity = this.flashPower * (this.flashTime / this.flashDuration);
    } else {
      this.flashLight.intensity = 0;
      this.flashPower = 0;
    }
  }

  clear(): void {
    for (const item of this.timed) item.dispose();
    this.timed.length = 0;
    for (const d of this.debris) d.mesh.dispose();
    this.debris.length = 0;
    this.trauma = 0;
  }
}
