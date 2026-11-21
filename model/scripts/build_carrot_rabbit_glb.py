#!/usr/bin/env python3
"""Derive Carrot's rigid Berry arms on the preserved V3 body using only stdlib."""

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct


MODEL = Path(__file__).resolve().parents[1]
COMPONENTS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
TRANSFORMS = ("translation", "rotation", "scale", "matrix")
ARM_BONES = tuple(f"{part}.{side}" for side in "LR" for part in ("upper_arm", "forearm", "hand"))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(path):
    data = path.read_bytes()
    assert struct.unpack_from("<4sII", data) == (b"glTF", 2, len(data)), "Invalid GLB header"
    offset, document, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        if kind == b"JSON":
            document = json.loads(chunk)
        elif kind == b"BIN\0":
            binary = chunk
        offset += length + 8
    assert document is not None and binary is not None
    assert len(document["buffers"]) == 1 and "uri" not in document["buffers"][0]
    assert not document.get("animations"), "This derivative requires static exported Rest poses"
    return document, binary[:document["buffers"][0]["byteLength"]], sha(data)


def identity():
    return [[float(r == c) for c in range(4)] for r in range(4)]


def multiply(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def inverse(matrix):
    a = [row[:] + identity()[i] for i, row in enumerate(matrix)]
    for c in range(4):
        pivot = max(range(c, 4), key=lambda r: abs(a[r][c]))
        assert abs(a[pivot][c]) > 1e-12, "Singular Rest transform"
        a[c], a[pivot] = a[pivot], a[c]
        divisor = a[c][c]
        a[c] = [v / divisor for v in a[c]]
        for r in range(4):
            if r != c:
                factor = a[r][c]
                a[r] = [v - factor * w for v, w in zip(a[r], a[c])]
    return [row[4:] for row in a]


def from_column(values):
    return [[values[c * 4 + r] for c in range(4)] for r in range(4)]


def to_column(matrix):
    return [matrix[r][c] for c in range(4) for r in range(4)]


def local_matrix(node):
    if "matrix" in node:
        return from_column(node["matrix"])
    x, y, z, w = node.get("rotation", [0., 0., 0., 1.])
    rotation = [[1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
                [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
                [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y]]
    scale = node.get("scale", [1., 1., 1.])
    translation = node.get("translation", [0., 0., 0.])
    result = identity()
    for r in range(3):
        result[r][:3] = [rotation[r][c] * scale[c] for c in range(3)]
        result[r][3] = translation[r]
    return result


def world_matrices(document):
    nodes = document["nodes"]
    parents = {}
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            assert child not in parents, "Multiple parents are unsupported"
            parents[child] = index
    cache = {}

    def world(index):
        if index not in cache:
            local = local_matrix(nodes[index])
            cache[index] = multiply(world(parents[index]), local) if index in parents else local
        return cache[index]

    return [world(index) for index in range(len(nodes))]


def point(matrix, xyz):
    return [sum(matrix[r][c] * xyz[c] for c in range(3)) + matrix[r][3] for r in range(3)]


def accessor(document, binary, index):
    item = document["accessors"][index]
    assert "sparse" not in item and not item.get("normalized"), "Unsupported source accessor encoding"
    view = document["bufferViews"][item["bufferView"]]
    fmt = "<" + COMPONENTS[item["componentType"]] * WIDTHS[item["type"]]
    stride = view.get("byteStride", struct.calcsize(fmt))
    start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    return [struct.unpack_from(fmt, binary, start + i * stride) for i in range(item["count"])]


def names(document):
    return {node["name"]: index for index, node in enumerate(document["nodes"]) if "name" in node}


def rendered_skin_points(document, binary, mesh_node, worlds):
    node = document["nodes"][mesh_node]
    primitive = document["meshes"][node["mesh"]]["primitives"][0]
    attributes = primitive["attributes"]
    positions = accessor(document, binary, attributes["POSITION"])
    joints = accessor(document, binary, attributes["JOINTS_0"])
    weights = accessor(document, binary, attributes["WEIGHTS_0"])
    skin = document["skins"][node["skin"]]
    ibms = accessor(document, binary, skin["inverseBindMatrices"])
    transforms = [multiply(worlds[joint], from_column(ibm)) for joint, ibm in zip(skin["joints"], ibms)]
    evaluated = []
    for position, indices, weight in zip(positions, joints, weights):
        transformed = [point(transforms[index], position) for index in indices]
        evaluated.append([sum(weight[k] * transformed[k][r] for k in range(4)) for r in range(3)])
    return evaluated, joints, weights, skin["joints"]


def build(v2_path, v3_path, output_path):
    assert output_path.resolve() not in (v2_path.resolve(), v3_path.resolve()), "Never overwrite an input asset"
    donor, donor_bin, donor_sha = read_glb(v2_path)
    document, base_bin, base_sha = read_glb(v3_path)
    donor_names, base_names = names(donor), names(document)
    donor_worlds = world_matrices(donor)
    binary = bytearray(base_bin)
    copied_views, copied_accessors = {}, {}

    def append_view(data, template=None):
        binary.extend(b"\0" * (-len(binary) % 4))
        view = copy.deepcopy(template or {})
        view.update(buffer=0, byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
        document["bufferViews"].append(view)
        return len(document["bufferViews"]) - 1

    def copy_accessor(index):
        if index not in copied_accessors:
            item = copy.deepcopy(donor["accessors"][index])
            assert "sparse" not in item
            view_index = item["bufferView"]
            if view_index not in copied_views:
                view = donor["bufferViews"][view_index]
                start = view.get("byteOffset", 0)
                copied_views[view_index] = append_view(donor_bin[start:start + view["byteLength"]], view)
            item["bufferView"] = copied_views[view_index]
            document["accessors"].append(item)
            copied_accessors[index] = len(document["accessors"]) - 1
        return copied_accessors[index]

    for name in ARM_BONES:
        source, target = donor["nodes"][donor_names[name]], document["nodes"][base_names[name]]
        for key in TRANSFORMS:
            target.pop(key, None)
            if key in source:
                target[key] = copy.deepcopy(source[key])

    rig = document["nodes"][base_names["Rabbit_Rig"]]
    extras = rig.setdefault("extras", {})
    assert extras.get("rig_version") == "v3", "The body must be canonical V3"
    limits = json.loads(extras["rig_motion_limits"])
    limits.update(arm={"min": 0, "max": 90}, forearm={"min": 0, "max": 0})
    extras.update(arm_control="shoulder", rig_motion_limits=json.dumps(limits, sort_keys=True),
                  elbow_limits_by_raise=json.dumps([[0, 0], [90, 0]]),
                  head_limits_by_raise=json.dumps([[0, 40], [45, 20], [65, 10], [90, 0]]),
                  binding_strategy="Canonical Berry V2 arm surfaces rigidly parented to V2 shoulders; V3 body and legs",
                  arm_donor_sha256=donor_sha, carrot_body_sha256=base_sha)

    # Keep virtual wrist/hand inverse binds consistent with the copied Rest chain.
    donor_skin = donor["skins"][0]
    donor_ibms = accessor(donor, donor_bin, donor_skin["inverseBindMatrices"])
    donor_joint_names = {donor["nodes"][node]["name"]: i for i, node in enumerate(donor_skin["joints"])}
    for skin in document["skins"]:
        values = accessor(document, binary, skin["inverseBindMatrices"])
        for i, joint in enumerate(skin["joints"]):
            name = document["nodes"][joint].get("name")
            if name in ARM_BONES:
                values[i] = donor_ibms[donor_joint_names[name]]
        view = append_view(b"".join(struct.pack("<16f", *value) for value in values))
        document["accessors"].append({"bufferView": view, "componentType": 5126,
                                      "count": len(values), "type": "MAT4"})
        skin["inverseBindMatrices"] = len(document["accessors"]) - 1

    surfaces, palms = {}, {}
    for side in "LR":
        name = f"Rabbit_Arm_{side}"
        source_node = donor["nodes"][donor_names[name]]
        node_index = base_names[name]
        node = document["nodes"][node_index]
        source_mesh = donor["meshes"][source_node["mesh"]]
        assert len(source_mesh["primitives"]) == 1
        mesh = copy.deepcopy(source_mesh)
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {key: copy_accessor(index) for key, index in primitive["attributes"].items()
                                       if not key.startswith(("JOINTS_", "WEIGHTS_"))}
            primitive["indices"] = copy_accessor(primitive["indices"])
            material = donor["materials"][primitive["material"]]
            assert material in document["materials"], "A donor material changed; explicit review is required"
            primitive["material"] = document["materials"].index(material)
        document["meshes"][node["mesh"]] = mesh
        node.pop("skin", None)
        for key in TRANSFORMS:
            node.pop(key, None)
        upper_index = base_names[f"upper_arm.{side}"]
        # The inverse Rest transform cancels the parent at Rest without touching a vertex or normal.
        upper_world = donor_worlds[donor_names[f"upper_arm.{side}"]]
        node["matrix"] = to_column(multiply(inverse(upper_world), donor_worlds[donor_names[name]]))
        node["extras"] = {"binding": "Rigid upper_arm parent; exact canonical Berry V2 exported surface",
                          "arm_donor_sha256": donor_sha}
        document["nodes"][upper_index].setdefault("children", []).append(node_index)
        rig["children"].remove(node_index)

        evaluated, indices, weights, joint_nodes = rendered_skin_points(donor, donor_bin, donor_names[name], donor_worlds)
        hand_index = donor_names[f"hand.{side}"]
        hand_joint = joint_nodes.index(hand_index)
        palm_points = [p for p, js, ws in zip(evaluated, indices, weights)
                       if sum(w for j, w in zip(js, ws) if j == hand_joint) >= .5]
        assert palm_points, "The canonical donor hand region was not found"
        low = [min(p[r] for p in palm_points) for r in range(3)]
        high = [max(p[r] for p in palm_points) for r in range(3)]
        size = [hi - lo for lo, hi in zip(low, high)]
        palm = [(lo + hi) / 2 for lo, hi in zip(low, high)]
        palm[0] = low[0] + size[0] * .15 if side == "L" else high[0] - size[0] * .15
        palm[2] = high[2] - size[2] * .25
        radius = math.sqrt(sum(v*v for v in size)) / 2
        palm_offset = point(inverse(donor_worlds[hand_index]), palm)
        hand_extras = document["nodes"][base_names[f"hand.{side}"]].setdefault("extras", {})
        hand_extras.update(palm_offset=palm_offset, palm_radius=radius,
                           palm_measurement_source="canonical-v2 hand-weighted skin bounds",
                           palm_donor_sha256=donor_sha)
        raw_points = accessor(donor, donor_bin, source_mesh["primitives"][0]["attributes"]["POSITION"])
        rest_error = max(math.dist(a, b) for a, b in zip(raw_points, evaluated))
        assert rest_error < 5e-6, "Donor skin Rest differs materially from its exported surface"
        surfaces[side] = {"vertices": len(raw_points), "raw_vs_rendered_rest_max_error": rest_error}
        palms[side] = {"offset": palm_offset, "radius": radius, "model_point": palm,
                       "hand_weighted_vertices": len(palm_points)}

    removed = {base_names["Rabbit_Shoulder_L"], base_names["Rabbit_Shoulder_R"]}
    removed_meshes = {document["nodes"][index]["mesh"] for index in removed}
    node_map = {old: new for new, old in enumerate(i for i in range(len(document["nodes"])) if i not in removed)}
    mesh_map = {old: new for new, old in enumerate(i for i in range(len(document["meshes"])) if i not in removed_meshes)}
    document["nodes"] = [node for index, node in enumerate(document["nodes"]) if index not in removed]
    document["meshes"] = [mesh for index, mesh in enumerate(document["meshes"]) if index not in removed_meshes]
    for node in document["nodes"]:
        if "children" in node:
            node["children"] = [node_map[child] for child in node["children"] if child not in removed]
        if "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]
    for scene in document["scenes"]:
        scene["nodes"] = [node_map[index] for index in scene["nodes"]]
        scene.setdefault("extras", {})["asset_version"] = "Carrot V3 body with canonical Berry V2 shoulder-only arms"
    for skin in document["skins"]:
        skin["joints"] = [node_map[index] for index in skin["joints"]]
        if "skeleton" in skin:
            skin["skeleton"] = node_map[skin["skeleton"]]
    assert len(document["skins"][0]["joints"]) == 19
    assert not any("Rabbit_Shoulder_" in node.get("name", "") for node in document["nodes"])
    worlds, final_names = world_matrices(document), names(document)
    for name in ARM_BONES:
        assert max(abs(a-b) for a, b in zip(to_column(worlds[final_names[name]]),
                                               to_column(donor_worlds[donor_names[name]]))) < 1e-10

    document["buffers"][0]["byteLength"] = len(binary)
    json_chunk = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    result = (struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_chunk) + 8 + len(binary))
              + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
              + struct.pack("<I4s", len(binary), b"BIN\0") + binary)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(result)
    assert sha(v2_path.read_bytes()) == donor_sha and sha(v3_path.read_bytes()) == base_sha
    return {"output": str(output_path), "sha256": sha(result), "bytes": len(result),
            "donor_sha256": donor_sha, "body_sha256": base_sha, "bones": 19,
            "arm_surfaces": surfaces, "palms": palms}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v2", type=Path, default=MODEL / "dist/rabbit3d/rabbit_realtime.glb")
    parser.add_argument("--v3", type=Path, default=MODEL / "dist/rabbit3d/rabbit_realtime_v3.glb")
    parser.add_argument("--output", type=Path, default=MODEL / "dist/rabbit3d/rabbit_carrot.glb")
    args = parser.parse_args()
    print(json.dumps(build(args.v2, args.v3, args.output), indent=2))
