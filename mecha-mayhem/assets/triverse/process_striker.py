"""Normalize and color the untextured Triverse Striker mesh in Blender.

Run from project root:
  blender --background --factory-startup --python assets/triverse/process_striker.py
"""
import bpy
import bmesh
from pathlib import Path
from mathutils import Vector

project = Path(__file__).resolve().parents[2]
source = project / 'assets/triverse/striker_untextured_original.glb'
out = project / 'public/assets/triverse/striker_full_colored.glb'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh in Triverse GLB')

for obj in meshes:
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.0004)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()

points = [v.co for o in meshes for v in o.data.vertices]
mins = [min(v[i] for v in points) for i in range(3)]
maxs = [max(v[i] for v in points) for i in range(3)]
scale = 3.62 / (maxs[2] - mins[2])
cx, cy = (mins[0]+maxs[0])/2, (mins[1]+maxs[1])/2
for obj in meshes:
    for v in obj.data.vertices:
        v.co.x = (v.co.x-cx)*scale
        v.co.y = (v.co.y-cy)*scale
        v.co.z = (v.co.z-mins[2])*scale
    obj.data.update()

def mat(name, color, metal=.45, rough=.42, emission=None):
    m = bpy.data.materials.new('Triverse Striker | '+name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color,1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*emission,1)
        p.inputs['Emission Strength'].default_value = 2.2
    m.diffuse_color = (*color,1)
    return m

materials = [
    mat('ceramic white', (.78,.86,.90), .42,.36),
    mat('shaded white', (.40,.53,.61), .50,.47),
    mat('graphite frame', (.035,.055,.07), .48,.61),
    mat('safety orange', (1,.27,.035), .37,.35),
    mat('energy cyan', (.03,.67,.92), .18,.23, (.01,.48,.9)),
]
for obj in meshes:
    data = obj.data
    data.materials.clear()
    for m in materials:
        data.materials.append(m)
    for face in data.polygons:
        vertices = [data.vertices[i].co for i in face.vertices]
        x = sum(v.x for v in vertices)/len(vertices)
        y = sum(v.y for v in vertices)/len(vertices)
        z = sum(v.z for v in vertices)/len(vertices)
        a = abs(x)
        front = y < -.03
        chosen = 0
        if z > 2.88:  # helmet and visor
            if z > 3.43 and a < .30 and front:
                chosen = 3
            elif 3.10 < z < 3.29 and a < .37 and y < -.14:
                chosen = 4
            elif 3.00 < z < 3.38 and a < .43 and y < -.10:
                chosen = 2
        elif z > 1.70:  # chest and arms
            if a < .16 and 2.20 < z < 2.35 and y < -.09:
                chosen = 4
            elif a < .48 and 1.82 < z < 2.35:
                chosen = 2
            elif a < .48 and 2.47 < z < 2.65 and y < -.10:
                chosen = 3
            elif a > .75 and 2.63 < z < 2.84 and y < .04:
                chosen = 3
            elif a > .61 and 1.81 < z < 2.16:
                chosen = 2
            elif a > .65 and y > .04:
                chosen = 1
            elif a < .48 and y > .18:
                chosen = 2
        else:  # legs, joints, and feet
            if 1.34 < z < 1.71 and a < .56:
                chosen = 2
            elif .82 < z < 1.07 and a > .36 and front:
                chosen = 3
            elif .82 < z < 1.07 and a > .30:
                chosen = 2
            elif .37 < z < .59 and a > .44 and y < -.12:
                chosen = 3
            elif y > .06 or (a < .30 and z > .60) or z < .18:
                chosen = 2
            elif y > -.05:
                chosen = 1
        face.material_index = chosen

for obj in meshes:
    obj.name = 'TRIVERSE | Striker full geometry'
    obj.data.name = 'Striker main mesh'

# Export only the generated geometry. One mesh and five reusable materials make
# the asset inexpensive to draw, while the feet origin fits the existing game.
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(project / 'assets/triverse/striker_triverse_colored.blend'))

# Render an evidence preview from the front quarter.
for obj in meshes:
    obj.select_set(False)
world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.018,.045,.068,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
for name, location, energy, color in [
    ('Key',(5,-7,7),1300,(.72,.88,1)),
    ('Rim',(-4,4,5),1800,(.12,.63,1)),
    ('Warm',(4,5,3),900,(1,.38,.1)),
]:
    ld = bpy.data.lights.new(name,'AREA'); ld.energy=energy; ld.color=color; ld.shape='DISK'; ld.size=5
    lo = bpy.data.objects.new(name,ld); bpy.context.collection.objects.link(lo); lo.location=location
    lo.rotation_euler=(Vector((0,0,1.8))-lo.location).to_track_quat('-Z','Y').to_euler()
cd=bpy.data.cameras.new('Preview camera'); cam=bpy.data.objects.new('Preview camera',cd)
bpy.context.collection.objects.link(cam); cam.location=(5,-8,5.0)
cam.rotation_euler=(Vector((0,0,1.8))-cam.location).to_track_quat('-Z','Y').to_euler()
cd.type='ORTHO'; cd.ortho_scale=5.7; bpy.context.scene.camera=cam
bpy.context.scene.render.engine='CYCLES'; bpy.context.scene.cycles.samples=24
bpy.context.scene.render.resolution_x=700; bpy.context.scene.render.resolution_y=700
bpy.context.scene.render.resolution_percentage=100; bpy.context.scene.render.film_transparent=True
bpy.context.scene.render.image_settings.file_format='PNG'
bpy.context.scene.render.filepath=str(project / 'assets/triverse/striker_colored_preview.png')
bpy.ops.render.render(write_still=True)
print('TRIVERSE_DONE',out,'triangles',sum(len(o.data.polygons) for o in meshes), 'height',3.62)
