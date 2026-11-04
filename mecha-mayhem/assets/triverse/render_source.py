"""Render the raw Triverse mesh from the likely front for inspection."""

import bpy
from mathutils import Vector
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = Path.home() / 'Downloads' / 'mecha.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        mat = bpy.data.materials.new('inspection | white')
        mat.diffuse_color = (.78, .85, .90, 1)
        mat.use_nodes = True
        mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.78, .85, .90, 1)
        obj.data.materials.clear()
        obj.data.materials.append(mat)

world = bpy.context.scene.world
world.color = (.15, .20, .25)
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.025, .055, .085, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6

for name, loc, power, color, size in [
    ('Key', (3, -4, 5), 850, (0.65, .85, 1), 4),
    ('Rim', (-4, 3, 4), 1000, (.16, .66, 1), 3),
    ('Orange', (3, 4, 2), 600, (1, .35, .08), 3),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'DISK'
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = loc
    light.rotation_euler = (Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()

for label, location in [('front', (3,-6,2.5)), ('back', (-3,6,2.5))]:
    camera_data = bpy.data.cameras.new(label)
    camera = bpy.data.objects.new(label, camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = location
    camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 3.0
    bpy.context.scene.camera = camera
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 24
    bpy.context.scene.render.resolution_x = 700
    bpy.context.scene.render.resolution_y = 700
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    bpy.context.scene.render.filepath = str(root / 'assets' / 'triverse' / f'source_{label}.png')
    bpy.ops.render.render(write_still=True)
