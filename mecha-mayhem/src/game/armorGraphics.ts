import { DynamicTexture, Geometry, Mesh, Scene, Texture, Vector3, VertexData } from '@babylonjs/core';

const geometryCache = new WeakMap<Scene, Map<string, Geometry>>();
const paintCache = new WeakMap<Scene, { paint: DynamicTexture; normal: DynamicTexture }>();

/** Shared flat chamfers catch the light without modifiers or downloaded meshes. */
export function armorBox(name: string, size: [number, number, number], scene: Scene): Mesh {
  let cache = geometryCache.get(scene);
  if (!cache) { cache = new Map(); geometryCache.set(scene, cache); }
  const bevel = Math.min(0.045, Math.min(...size) * 0.18);
  const key = size.join(',');
  let geometry = cache.get(key);
  if (!geometry || geometry.isDisposed()) {
    const half = size.map((value) => value * 0.5);
    const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
    const face = (points: number[][]) => {
      const a = Vector3.FromArray(points[0]), b = Vector3.FromArray(points[1]), c = Vector3.FromArray(points[2]);
      let normal = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize();
      const center = points.reduce((sum, point) => sum.add(Vector3.FromArray(point)), Vector3.Zero()).scale(1 / points.length);
      if (Vector3.Dot(normal, center) < 0) { points.reverse(); normal = normal.scale(-1); }
      const start = positions.length / 3;
      const mainAxis = Math.abs(normal.x) > 0.9 ? 0 : Math.abs(normal.y) > 0.9 ? 1 : 2;
      for (const point of points) {
        positions.push(...point); normals.push(normal.x, normal.y, normal.z);
        const u = (mainAxis + 1) % 3, v = (mainAxis + 2) % 3;
        uvs.push(point[u] / size[u] + 0.5, point[v] / size[v] + 0.5);
      }
      for (let i = 1; i < points.length - 1; i++) indices.push(start, start + i, start + i + 1);
    };
    // Six broad armour faces.
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      face([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
        const point = [0, 0, 0]; point[axis] = sign * half[axis]; point[u] = su * (half[u] - bevel); point[v] = sv * (half[v] - bevel); return point;
      }));
    }
    // Twelve edge bevels and eight clipped corners.
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) face([[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([along, side]) => {
        const point = [0, 0, 0]; point[axis] = along * (half[axis] - bevel); point[u] = su * (half[u] - (side ? bevel : 0)); point[v] = sv * (half[v] - (side ? 0 : bevel)); return point;
      }));
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const signs = [sx, sy, sz];
      face([0, 1, 2].map((axis) => half.map((value, i) => signs[i] * (value - (i === axis ? 0 : bevel)))));
    }
    const data = new VertexData(); data.positions = positions; data.normals = normals; data.indices = indices; data.uvs = uvs;
    geometry = new Geometry(`armor-chamfer-${key}`, scene, data, false);
    cache.set(key, geometry);
  }
  const mesh = new Mesh(name, scene);
  geometry.applyToMesh(mesh);
  return mesh;
}

/** One pair of restrained procedural surface maps shared by every chassis. */
export function armorSurface(scene: Scene): { paint: DynamicTexture; normal: DynamicTexture } {
  const cached = paintCache.get(scene);
  if (cached) return cached;
  const paint = new DynamicTexture('armor-paint-grain', 256, scene, true);
  const normal = new DynamicTexture('armor-micro-normal', 256, scene, true);
  const paintContext = paint.getContext() as CanvasRenderingContext2D, normalContext = normal.getContext() as CanvasRenderingContext2D;
  const colorData = paintContext.createImageData(256, 256), normalData = normalContext.createImageData(256, 256);
  let seed = 14731;
  for (let i = 0; i < 256 * 256; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed & 255) / 255;
    const x = i % 256, y = Math.floor(i / 256);
    const scratch = ((x * 3 + y) % 149 === 0 && (y % 57) < 34) ? 12 : 0;
    const value = Math.round(230 + grain * 20 - scratch);
    colorData.data.set([value, value, value, 255], i * 4);
    normalData.data.set([Math.round(126 + grain * 5), Math.round(127 + (1 - grain) * 3), 254, 255], i * 4);
  }
  paintContext.putImageData(colorData, 0, 0); normalContext.putImageData(normalData, 0, 0);
  paint.update(); normal.update();
  for (const texture of [paint, normal]) { texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE; texture.anisotropicFilteringLevel = 4; }
  normal.gammaSpace = false; normal.level = 0.22;
  const result = { paint, normal }; paintCache.set(scene, result); return result;
}
