"""Inspect the Triverse GLB in Blender before cleanup.

Run: blender --background --factory-startup --python assets/triverse/inspect_mecha.py
"""

import bpy
import json
from mathutils import Vector
from pathlib import Path

source = Path.home() / "Downloads" / "mecha.glb"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
minimum = [min(point[i] for point in points) for i in range(3)]
maximum = [max(point[i] for point in points) for i in range(3)]
report = {
    "source": str(source),
    "objects": len(bpy.context.scene.objects),
    "meshes": len(meshes),
    "triangles": sum(len(obj.data.polygons) for obj in meshes),
    "vertices": sum(len(obj.data.vertices) for obj in meshes),
    "bounds_min": minimum,
    "bounds_max": maximum,
    "dimensions": [maximum[i] - minimum[i] for i in range(3)],
    "materials": [
        {
            "name": mat.name,
            "diffuse": tuple(round(v, 3) for v in mat.diffuse_color),
            "nodes": [node.type for node in mat.node_tree.nodes] if mat.use_nodes else [],
        }
        for mat in bpy.data.materials
    ],
    "images": [(image.name, tuple(image.size)) for image in bpy.data.images],
    "mesh_info": [
        {
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
            "location": tuple(round(v, 3) for v in obj.location),
            "scale": tuple(round(v, 3) for v in obj.scale),
        }
        for obj in meshes
    ],
}
print("TRIVERSE_REPORT=" + json.dumps(report))
