# Task 4A rabbit GLB export

Run from the repository root:

```sh
./game/model/scripts/build_rabbit_glb.sh
```

The wrapper uses `/Applications/Blender.app/Contents/MacOS/Blender`, falls back to `blender` on PATH, or accepts `BLENDER_BIN`. It opens the existing `rabbit_rigged.blend`, clears pose/action evaluation in memory, exports the `Rabbit_Character` collection, audits the staged binary, and replaces `dist/rabbit3d/rabbit_realtime.glb` only after validation. It never saves a `.blend` file. The adjacent `rabbit_realtime.report.json` records source SHA-256 hashes, actual node hierarchy, bone rest matrices, pivots, axes, mesh counts, materials, floor bounds, and deformation evidence.

Verified using Blender 5.2.1 LTS:

- Exactly 19 original bones retained; original names are also stored in bone `extras.originalBoneName` for loaders that sanitize punctuation.
- Four skinned limb meshes, rigid bone-parented body/head/ears/tail, inherited face features, and the carrot socket retain their hierarchy.
- 21 mesh objects, 25,173 exported vertices, 49,632 triangles, seven materials; 967,988-byte GLB.
- No animation clips, cameras, or lights are exported.
- Exported rest geometry matches evaluated source geometry with maximum bidirectional nearest-vertex error `0.000001462` model units. Material factors and the blush vertex-color ranges are preserved.
- CPU evaluation of the actual exported joint/weight/inverse-bind accessors verifies arm, thigh, shin, body, head, and ear movement. Opposite arms remain unchanged during independent shoulder probes.
- Both source `.blend` files remain byte-identical, checked before and after export.

## Coordinate and controller contract

Blender uses +Z up and rabbit front -Y. The export uses glTF +Y up and front +Z: `(x, y, z)_gltf = (x, z, -y)_Blender`. The rest bounds are approximately `[-0.856344, 0.004381, -0.641985]` to `[0.856344, 3.603972, 0.648712]`; the source sole starts slightly above y=0. A runtime container may translate by the negative minimum y to put the soles on its floor.

The existing arm bone rest axes are skewed. Read `bones_gltf` in the report and derive each control axis from the inverse of its rest world quaternion. For model-space control axes: +Z raises the anatomical left arm (+X), -Z raises the right arm, -X raises either arm forward, +X bows the upright body toward the front (+Z). Approximate knee flexion can use thigh -X, shin +2X and foot -X. These knee poses are FK approximations and do not provide planted-foot IK.

The exporter preserves the source hybrid rig without renaming or rerigging it. glTF uses linear blend skinning, so the source Armature modifier's preserve-volume dual quaternion deformation is approximated when joints bend. The exact rest geometry and rig bindings are verified; this numeric audit complements the application's rendered visual QA.
