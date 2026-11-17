# Build the SUNCOAST: HEATLINE rigged citizen (original character, no GTA assets).
# Run: ~/workspace/tools/blender/blender -b --python game/src/characters/build_character.py
# Output: game/assets/characters/citizen.glb  (armature + mesh + 10 animation clips)
# Character faces +Y in Blender (= +Z in three.js / glTF), origin at the feet,
# total height ~1.80 units. One GLB is reused for player / pedestrians / enemies;
# the JS side tints the "Jacket" material per instance.
import bpy
import math
from mathutils import Vector

OUT = "/home/hatch/workspace/makefun/gta6-01-entry-kanbara12/game/assets/characters/citizen.glb"
RENDER_DIR = "/tmp/citizen-check"

# ---------------------------------------------------------------- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

# ---------------------------------------------------------------- materials
def make_mat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m

SKIN = make_mat("Skin", (0.78, 0.56, 0.42))
JACKET = make_mat("Jacket", (0.11, 0.32, 0.40), 0.85)   # player teal base; tinted in JS
SHIRT = make_mat("Shirt", (0.91, 0.88, 0.82))
PANTS = make_mat("Pants", (0.13, 0.17, 0.20))
SHOES = make_mat("Shoes", (0.10, 0.10, 0.11), 0.6)
HAIR = make_mat("Hair", (0.16, 0.10, 0.07))
WEAPON = make_mat("Weapon", (0.13, 0.13, 0.14), 0.45)

# ---------------------------------------------------------------- armature
# (name, head, tail, parent) — Blender coords, z up, character faces +Y.
BONES = [
    ("hips",      (0, 0, 0.98), (0, 0, 1.12), None),
    ("spine",     (0, 0, 1.12), (0, 0, 1.38), "hips"),
    ("chest",     (0, 0, 1.38), (0, 0, 1.52), "spine"),
    ("neck",      (0, 0, 1.52), (0, 0, 1.58), "chest"),
    ("head",      (0, 0, 1.58), (0, 0, 1.80), "neck"),
    ("shoulder.L", (-0.20, 0, 1.50), (-0.30, 0, 1.48), "chest"),
    ("upperArm.L", (-0.30, 0, 1.48), (-0.32, 0, 1.20), "shoulder.L"),
    ("forearm.L", (-0.32, 0, 1.20), (-0.32, 0, 0.96), "upperArm.L"),
    ("hand.L",    (-0.32, 0, 0.96), (-0.32, 0, 0.86), "forearm.L"),
    ("shoulder.R", (0.20, 0, 1.50), (0.30, 0, 1.48), "chest"),
    ("upperArm.R", (0.30, 0, 1.48), (0.32, 0, 1.20), "shoulder.R"),
    ("forearm.R", (0.32, 0, 1.20), (0.32, 0, 0.96), "upperArm.R"),
    ("hand.R",    (0.32, 0, 0.96), (0.32, 0, 0.86), "forearm.R"),
    ("thigh.L",   (-0.11, 0, 0.96), (-0.11, 0, 0.52), "hips"),
    ("shin.L",    (-0.11, 0, 0.52), (-0.11, 0, 0.10), "thigh.L"),
    ("foot.L",    (-0.11, 0, 0.10), (-0.11, 0.14, 0.03), "shin.L"),
    ("thigh.R",   (0.11, 0, 0.96), (0.11, 0, 0.52), "hips"),
    ("shin.R",    (0.11, 0, 0.52), (0.11, 0, 0.10), "thigh.R"),
    ("foot.R",    (0.11, 0, 0.10), (0.11, 0.14, 0.03), "shin.R"),
]

arm_data = bpy.data.armatures.new("CitizenRig")
arm = bpy.data.objects.new("CitizenRig", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- meshes
# (name, kind, params, location, scale, material, bone)
# kind: box | cyl | sphere. Each part is skinned rigidly to ONE bone so the
# deformation stays clean; parts overlap slightly at the joints (shoulder /
# elbow / knee / hip balls) so bends do not open gaps.
def add_part(name, kind, params, loc, scale, material, bone):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=params[0],
                                            depth=params[1], location=loc)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12,
                                             radius=params[0], location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # soften the boxy torso / limbs a little
    if kind == "box":
        mod = obj.modifiers.new("soft", "BEVEL")
        mod.width = 0.02
        mod.segments = 2
    obj.data.materials.append(material)
    # rigid skin to one bone
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj

S = 0.5  # left/right sign helper is inlined below
add_part("Pelvis", "box", None, (0, 0, 0.99), (0.38, 0.26, 0.24), PANTS, "hips")
add_part("TorsoJacket", "box", None, (0, 0, 1.30), (0.48, 0.30, 0.56), JACKET, "spine")
add_part("ChestJacket", "box", None, (0, 0, 1.45), (0.46, 0.28, 0.26), JACKET, "chest")
add_part("ShirtFront", "box", None, (0, 0.145, 1.33), (0.30, 0.03, 0.42), SHIRT, "chest")
add_part("Collar", "box", None, (0, 0.10, 1.56), (0.30, 0.10, 0.06), SHIRT, "chest")
add_part("Head", "sphere", (0.14,), (0, 0, 1.68), (1.0, 0.95, 1.12), SKIN, "head")
add_part("Nose", "box", None, (0, 0.13, 1.67), (0.045, 0.05, 0.07), SKIN, "head")
add_part("Hair", "sphere", (0.145,), (0, -0.015, 1.72), (1.0, 0.95, 0.75), HAIR, "head")
for s, side in ((-1, "L"), (1, "R")):
    add_part(f"ShoulderBall.{side}", "sphere", (0.085,), (s * 0.30, 0, 1.48),
             (1, 1, 1), JACKET, f"shoulder.{side}")
    add_part(f"UpperArm.{side}", "cyl", (0.07, 0.30), (s * 0.315, 0, 1.34),
             (1, 1, 1), JACKET, f"upperArm.{side}")
    add_part(f"ElbowBall.{side}", "sphere", (0.065,), (s * 0.32, 0, 1.20),
             (1, 1, 1), SKIN, f"upperArm.{side}")
    add_part(f"Forearm.{side}", "cyl", (0.058, 0.26), (s * 0.32, 0, 1.08),
             (1, 1, 1), SKIN, f"forearm.{side}")
    add_part(f"Hand.{side}", "box", None, (s * 0.32, 0.01, 0.90),
             (0.08, 0.11, 0.15), SKIN, f"hand.{side}")
    add_part(f"HipBall.{side}", "sphere", (0.105,), (s * 0.11, 0, 0.96),
             (1, 1, 1), PANTS, f"thigh.{side}")
    add_part(f"Thigh.{side}", "cyl", (0.105, 0.44), (s * 0.11, 0, 0.74),
             (1, 1, 1), PANTS, f"thigh.{side}")
    add_part(f"KneeBall.{side}", "sphere", (0.095,), (s * 0.11, 0, 0.52),
             (1, 1, 1), PANTS, f"thigh.{side}")
    add_part(f"Shin.{side}", "cyl", (0.08, 0.42), (s * 0.11, 0, 0.31),
             (1, 1, 1), PANTS, f"shin.{side}")
    add_part(f"Shoe.{side}", "box", None, (s * 0.11, 0.05, 0.05),
             (0.12, 0.30, 0.10), SHOES, f"foot.{side}")

# Weapons parented to the right hand bone (SMG hidden by default in JS).
add_part("PistolGrip", "box", None, (0.32, 0.06, 0.90), (0.05, 0.05, 0.13), WEAPON, "hand.R")
add_part("PistolBarrel", "box", None, (0.32, 0.13, 0.965), (0.045, 0.16, 0.045), WEAPON, "hand.R")
add_part("SmgBody", "box", None, (0.32, 0.10, 0.95), (0.06, 0.34, 0.09), WEAPON, "hand.R")
add_part("SmgMag", "box", None, (0.32, 0.06, 0.86), (0.045, 0.05, 0.12), WEAPON, "hand.R")

# ---------------------------------------------------------------- animation
# Bone rotation convention (bones point down, -Z): rotation.x > 0 swings a limb
# FORWARD (+Y); knee flexion (shin back) is rotation.x < 0; elbow flexion
# (forearm forward) is rotation.x > 0.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
pose_bones = arm.pose.bones
for pb in pose_bones:
    pb.rotation_mode = "XYZ"

ALL_BONES = [n for n, _, _, _ in BONES]

def key_pose(frame, pose, hips_dz=0.0, hips_dy=0.0):
    for name in ALL_BONES:
        pb = pose_bones[name]
        rx, ry, rz = pose.get(name, (0.0, 0.0, 0.0))
        pb.rotation_euler = (rx, ry, rz)
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    hips = pose_bones["hips"]
    hips.location = (0.0, hips_dy, hips_dz)
    hips.keyframe_insert(data_path="location", frame=frame)

def build_clip(name, length, sampler):
    """sampler(t01) -> (pose_dict, hips_dz, hips_dy). Sampled every 2 frames."""
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    frames = list(range(1, length + 1, 2))
    if frames[-1] != length:
        frames.append(length)
    for f in frames:
        t = (f - 1) / max(1, length - 1)
        pose, dz, dy = sampler(t)
        key_pose(f, pose, dz, dy)
    action.frame_range = (1, length)
    return action

def L(name, v):
    return {f"thigh.L": (v, 0, 0)}

# --- idle: breathing, slight sway (2 s loop) -------------------------------
def idle_pose(t):
    s = math.sin(t * math.tau)
    return ({
        "spine": (0.02 + 0.015 * s, 0, 0),
        "chest": (0.01 * s, 0, 0),
        "head": (0, 0, 0.08 * math.sin(t * math.tau * 0.5)),
        "upperArm.L": (0.03 * s, 0, 0.04),
        "upperArm.R": (-0.03 * s, 0, -0.04),
        "forearm.L": (0.08, 0, 0),
        "forearm.R": (0.08, 0, 0),
    }, 0.006 * s, 0.0)

# --- walk: 1 s loop ---------------------------------------------------------
def walk_pose(t):
    p = t * math.tau
    s = math.sin(p)
    return ({
        "thigh.L": (0.55 * s, 0, 0),
        "thigh.R": (-0.55 * s, 0, 0),
        "shin.L": (-0.65 * max(0.0, math.sin(p + 0.9)), 0, 0),
        "shin.R": (-0.65 * max(0.0, math.sin(p + math.pi + 0.9)), 0, 0),
        "upperArm.L": (-0.38 * s, 0, 0),
        "upperArm.R": (0.38 * s, 0, 0),
        "forearm.L": (0.25, 0, 0),
        "forearm.R": (0.25, 0, 0),
        "spine": (0.06, 0, 0.04 * s),
        "hips": (0, 0, 0.03 * s),
    }, 0.03 * abs(math.cos(p)), 0.0)

# --- run: 0.75 s loop -------------------------------------------------------
def run_pose(t):
    p = t * math.tau
    s = math.sin(p)
    return ({
        "thigh.L": (0.85 * s, 0, 0),
        "thigh.R": (-0.85 * s, 0, 0),
        "shin.L": (-1.05 * max(0.0, math.sin(p + 0.9)), 0, 0),
        "shin.R": (-1.05 * max(0.0, math.sin(p + math.pi + 0.9)), 0, 0),
        "upperArm.L": (-0.70 * s, 0, 0),
        "upperArm.R": (0.70 * s, 0, 0),
        "forearm.L": (0.95, 0, 0),
        "forearm.R": (0.95, 0, 0),
        "spine": (0.15, 0, 0.05 * s),
        "chest": (0.05, 0, 0),
        "hips": (0, 0, 0.05 * s),
    }, 0.05 * abs(math.cos(p)), 0.0)

# --- sprint: 0.66 s loop, bigger drive --------------------------------------
def sprint_pose(t):
    p = t * math.tau
    s = math.sin(p)
    return ({
        "thigh.L": (1.05 * s, 0, 0),
        "thigh.R": (-1.05 * s, 0, 0),
        "shin.L": (-1.25 * max(0.0, math.sin(p + 0.9)), 0, 0),
        "shin.R": (-1.25 * max(0.0, math.sin(p + math.pi + 0.9)), 0, 0),
        "upperArm.L": (-0.90 * s, 0, 0),
        "upperArm.R": (0.90 * s, 0, 0),
        "forearm.L": (1.15, 0, 0),
        "forearm.R": (1.15, 0, 0),
        "spine": (0.22, 0, 0.06 * s),
        "chest": (0.06, 0, 0),
        "hips": (0, 0, 0.06 * s),
    }, 0.06 * abs(math.cos(p)), 0.0)

# --- jump: crouch -> takeoff -> tuck -> land (0.9 s, one-shot) --------------
def jump_pose(t):
    if t < 0.25:  # crouch
        k = t / 0.25
        pose = {"thigh.L": (0.55 * k, 0, 0), "thigh.R": (0.55 * k, 0, 0),
                "shin.L": (-0.95 * k, 0, 0), "shin.R": (-0.95 * k, 0, 0),
                "spine": (0.28 * k, 0, 0), "upperArm.L": (-0.4 * k, 0, 0),
                "upperArm.R": (-0.4 * k, 0, 0)}
        return pose, -0.10 * k, 0.0
    if t < 0.45:  # extend / takeoff
        k = (t - 0.25) / 0.20
        pose = {"thigh.L": (0.55 - 0.85 * k, 0, 0), "thigh.R": (0.55 - 0.85 * k, 0, 0),
                "shin.L": (-0.95 + 0.95 * k, 0, 0), "shin.R": (-0.95 + 0.95 * k, 0, 0),
                "spine": (0.28 - 0.28 * k, 0, 0),
                "upperArm.L": (-0.4 + 1.2 * k, 0, 0), "upperArm.R": (-0.4 + 1.2 * k, 0, 0)}
        return pose, -0.10 + 0.28 * k, 0.0
    if t < 0.75:  # air tuck
        k = (t - 0.45) / 0.30
        pose = {"thigh.L": (-0.30 + 0.85 * k, 0, 0), "thigh.R": (-0.30 + 0.55 * k, 0, 0),
                "shin.L": (-1.15 * (1 - k * 0.3), 0, 0), "shin.R": (-1.0 * (1 - k * 0.3), 0, 0),
                "spine": (0.08, 0, 0),
                "upperArm.L": (0.8, 0, 0), "upperArm.R": (0.8, 0, 0)}
        return pose, 0.18 - 0.10 * k, 0.0
    k = (t - 0.75) / 0.25  # land + recover
    pose = {"thigh.L": (0.55 - 0.55 * k, 0, 0), "thigh.R": (0.25 - 0.25 * k, 0, 0),
            "shin.L": (-0.80 + 0.80 * k, 0, 0), "shin.R": (-0.70 + 0.70 * k, 0, 0),
            "spine": (0.25 - 0.25 * k, 0, 0),
            "upperArm.L": (0.8 - 0.8 * k, 0, 0), "upperArm.R": (0.8 - 0.8 * k, 0, 0)}
    return pose, 0.08 - 0.18 * k, 0.0

# --- aim: two-hand stance (1 s loop) ----------------------------------------
def aim_pose(t):
    s = math.sin(t * math.tau) * 0.02
    return ({
        "upperArm.R": (1.35 + s, 0, -0.12),
        "forearm.R": (0.12, 0, 0),
        "upperArm.L": (1.05, 0, 0),
        "forearm.L": (1.05, 0, 0),
        "chest": (0, -0.18, 0),
        "head": (0, -0.10, 0),
        "spine": (0.06, 0, 0),
        "thigh.L": (0.18, 0, 0),
        "thigh.R": (-0.22, 0, 0),
        "shin.R": (-0.15, 0, 0),
    }, 0.0, 0.0)

# --- shoot: aim + recoil kick (0.35 s, one-shot) ----------------------------
def shoot_pose(t):
    kick = math.sin(min(1.0, t * 3.0) * math.pi) * 0.22
    base, dz, dy = aim_pose(0.0)
    base["upperArm.R"] = (1.35 + kick, 0, -0.12)
    base["chest"] = (-0.06 * math.sin(min(1.0, t * 3.0) * math.pi), -0.18, 0)
    base["head"] = (-0.06 * math.sin(min(1.0, t * 3.0) * math.pi), -0.10, 0)
    return base, dz, dy

# --- reload: mag swap, both hands to chest (1.2 s, one-shot) ----------------
def reload_pose(t):
    if t < 0.3:  # bring weapon in, left hand across
        k = t / 0.3
        return ({"upperArm.R": (1.35 - 1.15 * k, 0, -0.12 * (1 - k)),
                 "forearm.R": (0.12 + 0.85 * k, 0, 0),
                 "upperArm.L": (0.25 + 0.75 * k, 0, 0.55 * k),
                 "forearm.L": (0.15 + 1.05 * k, 0, 0),
                 "chest": (0.10 * k, 0, 0), "head": (0.18 * k, 0, 0),
                 "spine": (0.10 * k, 0, 0)}, 0.0, 0.0)
    if t < 0.7:  # swap the mag (small wrist dip)
        dip = math.sin((t - 0.3) / 0.4 * math.pi) * 0.25
        return ({"upperArm.R": (0.20, 0, 0), "forearm.R": (0.97 + dip, 0, 0),
                 "upperArm.L": (1.00, 0, 0), "forearm.L": (1.20 - dip, 0, 0),
                 "chest": (0.10, 0, 0), "head": (0.18, 0, 0),
                 "spine": (0.10, 0, 0)}, 0.0, 0.0)
    k = (t - 0.7) / 0.3  # back to aim
    base, dz, dy = aim_pose(0.0)
    mid = {"upperArm.R": (0.20, 0, 0), "forearm.R": (0.97, 0, 0),
           "upperArm.L": (1.00, 0, 0), "forearm.L": (1.20, 0, 0),
           "chest": (0.10, 0, 0), "head": (0.18, 0, 0), "spine": (0.10, 0, 0)}
    out = {}
    for bone in set(mid) | set(base):
        a = mid.get(bone, (0, 0, 0))
        b = base.get(bone, (0, 0, 0))
        out[bone] = tuple(a[i] + (b[i] - a[i]) * k for i in range(3))
    return out, dz, dy

# --- enter_car: step in + duck (1 s, one-shot) ------------------------------
def enter_pose(t):
    if t < 0.4:  # step toward the door, right leg up
        k = t / 0.4
        return ({"thigh.R": (0.75 * k, 0, 0), "shin.R": (-0.9 * k, 0, 0),
                 "thigh.L": (0.15 * k, 0, 0),
                 "upperArm.R": (0.9 * k, 0, 0), "forearm.R": (0.3 * k, 0, 0),
                 "spine": (0.10 * k, 0, 0)}, -0.02 * k, 0.25 * k)
    k = (t - 0.4) / 0.6  # duck + slide in
    return ({"thigh.R": (0.75 - 0.45 * k, 0, 0), "shin.R": (-0.9 + 0.5 * k, 0, 0),
             "thigh.L": (0.15 + 0.55 * k, 0, 0), "shin.L": (-0.7 * k, 0, 0),
             "upperArm.R": (0.9 - 0.4 * k, 0, 0), "forearm.R": (0.3 + 0.4 * k, 0, 0),
             "spine": (0.10 + 0.30 * k, 0, 0), "head": (0.15 * k, 0, 0)},
            -0.02 - 0.10 * k, 0.25 + 0.45 * k)

# --- exit_car: rise + step out (1 s, one-shot) ------------------------------
def exit_pose(t):
    if t < 0.4:  # rise out of the seat
        k = t / 0.4
        return ({"thigh.L": (0.70 - 0.45 * k, 0, 0), "shin.L": (-0.70 + 0.4 * k, 0, 0),
                 "thigh.R": (0.30 - 0.1 * k, 0, 0), "shin.R": (-0.40 + 0.2 * k, 0, 0),
                 "spine": (0.40 - 0.30 * k, 0, 0), "head": (0.15 - 0.15 * k, 0, 0),
                 "upperArm.L": (0.5 - 0.3 * k, 0, 0)}, -0.12 + 0.10 * k, 0.70 - 0.45 * k)
    k = (t - 0.4) / 0.6  # step clear of the car
    return ({"thigh.L": (0.25 + 0.35 * k, 0, 0), "shin.L": (-0.30 - 0.3 * k, 0, 0),
             "thigh.R": (0.20 - 0.2 * k, 0, 0),
             "spine": (0.10 - 0.10 * k, 0, 0),
             "upperArm.L": (0.2 - 0.2 * k, 0, 0)}, -0.02 + 0.02 * k, 0.25 - 0.25 * k)

CLIPS = [
    ("idle", 48, idle_pose),
    ("walk", 24, walk_pose),
    ("run", 18, run_pose),
    ("sprint", 16, sprint_pose),
    ("jump", 22, jump_pose),
    ("aim", 24, aim_pose),
    ("shoot", 8, shoot_pose),
    ("reload", 29, reload_pose),
    ("enter_car", 24, enter_pose),
    ("exit_car", 24, exit_pose),
]

bpy.ops.object.mode_set(mode="OBJECT")
actions = []
for name, length, sampler in CLIPS:
    actions.append(build_clip(name, length, sampler))

# NLA tracks: one strip per clip so the glTF exporter writes named clips.
arm.animation_data_create()
for action in actions:
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 1, action)
    strip.blend_type = "REPLACE"
arm.animation_data.action = None

# ---------------------------------------------------------------- export
import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_skins=True,
    export_apply=True,
    export_yup=True,
)
print("EXPORTED", OUT)

# ---------------------------------------------------------------- visual check renders
os.makedirs(RENDER_DIR, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
cam_data = bpy.data.cameras.new("checkcam")
cam = bpy.data.objects.new("checkcam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.collection.objects.link(sun)
checks = [("walk", "walk", 12, (2.4, 2.6, 1.5)), ("aim", "aim", 12, (3.6, 0.0, 1.4)), ("jump", "jump", 14, (2.4, -2.6, 1.5))]
for fname, clip, frame, campos in checks:
    cam.location = campos
    look_at(cam, (0, 0, 1.0))
    arm.animation_data.action = bpy.data.actions[clip]
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(RENDER_DIR, fname + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", fname)
print("DONE")
