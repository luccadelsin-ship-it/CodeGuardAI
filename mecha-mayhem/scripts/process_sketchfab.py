"""Normalize licensed Sketchfab props for the Mecha Mayhem arena.

Usage: blender --background --python scripts/process_sketchfab.py -- input.glb output.glb target_height
"""

import sys

import bpy
from mathutils import Matrix, Vector


def main():
    src, dst, height_text = sys.argv[sys.argv.index("--") + 1 :]
    target_height = float(height_text)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=src)

    for obj in tuple(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No meshes in {src}")

    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    source_height = high.z - low.z
    if source_height <= 0:
        raise RuntimeError(f"Invalid height in {src}")

    scale = target_height / source_height
    offset = Vector((-(low.x + high.x) * 0.5 * scale, -(low.y + high.y) * 0.5 * scale, -low.z * scale))
    transform = Matrix.Translation(offset) @ Matrix.Scale(scale, 4)
    for obj in bpy.data.objects:
        if obj.parent is None:
            obj.matrix_world = transform @ obj.matrix_world

    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_apply=True)
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons) for obj in meshes)
    print(f"PROCESSED {src} -> {dst}; source bounds {tuple(round(x, 3) for x in (high - low))}; height {target_height}; triangles {triangles}")


if __name__ == "__main__":
    main()
