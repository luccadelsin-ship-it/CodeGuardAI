"""Export Ferro-Velho Tita (detailed) to a game GLB: no colliders/cameras/lights, modifiers applied
with lighter bevels, everything joined and split by material (one draw call per material)."""
import bpy, sys, collections
src, out, mode = sys.argv[1], sys.argv[2], sys.argv[3]  # mode: chamfer | nobevel
bpy.ops.wm.open_mainfile(filepath=src)
scene = bpy.context.scene
# Unparent everything first (keeping world transforms) so removing helper empties moves nothing.
for o in list(scene.objects):
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.context.view_layer.update()
for o in list(scene.objects):
    if o.type in ('CAMERA', 'LIGHT', 'EMPTY') or any(c.name == '09_COLISORES' for c in o.users_collection):
        bpy.data.objects.remove(o, do_unlink=True)
nouv = 0
for o in scene.objects:
    for m in list(getattr(o, 'modifiers', [])):
        if m.type == 'BEVEL':
            if mode == 'nobevel': o.modifiers.remove(m)
            else: m.segments = 1; m.limit_method = 'ANGLE'
    if o.type == 'MESH' and not o.data.uv_layers: nouv += 1
print('objects without uv', nouv)
# Representative flat colours for the procedural ramps; keep the slot names for the game to restyle.
for m in bpy.data.materials:
    if not m.node_tree: continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    ramp = next((n for n in m.node_tree.nodes if n.type == 'VALTORGB'), None)
    if bsdf and ramp:
        a, b = ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[-1].color
        for l in list(bsdf.inputs['Base Color'].links): m.node_tree.links.remove(l)
        bsdf.inputs['Base Color'].default_value = tuple((a[i] + b[i]) / 2 for i in range(3)) + (1,)
    if bsdf:
        for l in list(bsdf.inputs['Normal'].links): m.node_tree.links.remove(l)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if o.type in ('MESH', 'CURVE'): o.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in scene.objects if o.type == 'MESH')
bpy.ops.object.convert(target='MESH')
for o in scene.objects:
    if o.type != 'MESH': o.select_set(False)
meshes = [o for o in scene.objects if o.type == 'MESH']
bpy.context.view_layer.objects.active = meshes[0]
for o in meshes: o.select_set(True)
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
import bmesh
UV_METERS = 2.0  # one texture repeat every 2 m, box-projected in world space
for o in scene.objects:
    if o.type != 'MESH': continue
    me = o.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    bm = bmesh.new(); bm.from_mesh(me); uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for loop in f.loops:
            co = loop.vert.co; loop[uv].uv = (co[a] / UV_METERS, co[b] / UV_METERS)
    bm.to_mesh(me); bm.free()
for o in scene.objects:
    if o.type == 'MESH' and o.material_slots:
        o.name = 'scrap:' + o.material_slots[0].material.name
        me = o.data; me.calc_loop_triangles()
        print('part', o.name, len(me.loop_triangles), 'uv' if me.uv_layers else 'NO-UV',
              tuple(round(v, 1) for v in o.bound_box[0]), tuple(round(v, 1) for v in o.bound_box[6]))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=False)
