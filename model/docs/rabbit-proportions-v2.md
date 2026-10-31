# Realtime rabbit v2: reproducible proportions

Run `npm run build:rabbit3d` from `game/`, followed by the existing asset sync command. The wrapper first runs `proportion_rabbit_v2.py`, then exports and audits `rabbit_realtime_v2.blend`. The generator always starts from the original `rabbit_rigged.blend`; it never overwrites either original Blender source.

Original GLB and report are retained in `model/dist/rabbit3d/backup-v1/`. The new derived editable source is `model/assets/blender/rabbit/rabbit_realtime_v2.blend`. Runtime-compatible output remains `model/dist/rabbit3d/rabbit_realtime.glb`. To independently export the original, invoke `export_rabbit_glb.py -- --source <original blend> --output-dir <separate directory>` through Blender.

## Proportions and binding

- Upper arm, forearm and hand rest bone lengths increase 38%; arm radial mesh dimensions decrease 18%. The original continuous arm topology is retained and weights are rebuilt around the new shoulder, elbow and wrist.
- Hip-to-ankle vertical span increases 45%. Actual thigh length increases 40.38% and shin length 44.07% because their depth offsets are retained. Hip/knee/ankle heights are .681/.4055/.13 model units.
- The original foot-like leg meshes are replaced by continuous smooth ring surfaces for thigh, knee, shin and paw, with three normalized weight groups per side. Foot bone lengths stay unchanged. Paw width is narrower than the original; the sole remains a fully foot-weighted region.
- Torso rest bone length increases 12%, torso width decreases 4%. A smooth lower-belly lift of up to .17 units and pelvis taper of up to 12% expose the thighs. Final body mesh height is approximately unchanged after this silhouette refinement; the overall character is taller and more anthropomorphic.
- Head, facial details and ears scale together to 93%, preserving facial positions, pink inner ears, vertex-color blush and every original material. No face redesign or texture replacement.
- All 19 bone names remain available. Thighs are intentionally reparented from `body` to `root`, preserving world rest locations, to prevent torso lean from dragging the feet. Shoulder/elbow/hip/knee/ankle remain independently controllable. No animation clips are exported.

At the same 342 px standing height, the full character height grows from 3.59959 to 3.72690 units. Arm-chain screen length increases approximately 33.3%, thigh 35.6%, and shin 39.2%. The detailed JSON report records actual rest lengths, per-mesh bounds, original hashes and export consistency.

## Asset audit

The exporter checks the 19-bone skin, hierarchy, material values, vertex colors, normalized skin weights, independent arm deformation, both elbow/thigh/knee responses, and exported geometry against Blender's evaluated rest geometry. The v2 file contains 21 mesh nodes, 23,605 vertices, 46,496 triangles and seven original materials. The source-to-export maximum nearest-vertex discrepancy is below 0.000002 units.

Original source hashes:

- `rabbit_base.blend`: `7bbaa295ebd941fcac526692540872039b1aec453616efa771114c32502a0b34`
- `rabbit_rigged.blend`: `aa82f5bec29fa588696fa312b52f757f2ad30915e8bb1d6a9847412b64479f29`
- Original GLB: `0e547611b70c5273efa205b8275693430ece7670750c14182d31b6dd8c7890be`

The exporter reports linear skinning fidelity and retains the limitation that arbitrary combined joint poses do not constitute a full collision or planted-foot IK system. Runtime pose, foot-coordinate and game compatibility checks are documented separately by the integration verification.

## Runtime integration and acceptance (2026-10-24)

`RabbitRigController` now derives symmetric knee support compensation from the actual hip-to-knee and knee-to-ankle rest vectors, including the small depth correction. Foot counterrotation cancels the composed hip/knee rotation during simultaneous bend and lateral extension. Limits remain arm115°, elbow55°, torso14°, thigh bend15°/knee30°, and lateral leg extension32°. Continuous MediaPipe targets and existing gain settings are retained; no animation clips or new scoring rules were introduced.

`Rabbit3D` computes precise evaluated mesh bounds before fitting to342 logical pixels and placing the sole anchor. The tracker continues to project the foot-bone origin (ankle), consistently used by Berry's existing reach calibration and hit testing. It is not a toe or sole marker. Tests verify soles at Carrot y681 / Berry y730, mirrored left/right contact inside the unchanged tree zones, standing foot outside the trunk, and a stationary support foot. All tested shallow bend samples keep sole height within0.001 model units. Torso lean keeps the skinned legs fixed; horizontal movement intentionally translates the whole avatar.

The runtime file in `public/assets/rabbit3d/` and the built copy in `dist/assets/rabbit3d/` have the same SHA-256 as the audited export:
`08c6ad9f8f3aaf127a7ee3dadd5138a9f0f05e4e9d292d3dbf0d918d41108c4b` (918,392 bytes). Repeating the full Blender generation/export produced the same hash.

Validation completed:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` |155/155 PASS |
| `npm run build` | PASS |
| `qa:rabbit3d` |15/15 PASS: controls, five viewports, complete five-carrot sprite game, fallback and cleanup |
| `qa:mocap` |13/13 PASS: continuous arms/lean/knee/translation, tracking loss, pause and cleanup |
| `qa:berry` |7/7 PASS: full six-hit keyboard round, left/right geometric contact, pause/restart/failure |
| `qa:berry-camera` |7/7 PASS: synthetic landmarks through input, actual rig, projection, scoring and cleanup |

Browser checks used installed Google Chrome156 via Playwright because the Browser plugin was unavailable. The local entry was `http://127.0.0.1:5173/`; the main television-size viewport was1920×1080, with additional1440×900,1512×982,900×700 and600×800 checks. Page identity, nonblank rendering, framework overlay absence and interactions passed. Console logs contained only deliberately triggered model-load/context-loss errors in fallback tests. Detailed browser logs remain under `/private/tmp/rabbit-proportions/`.

The full Carrot Pull gameplay path remains its existing Sprite mode; the new GLB is used in its3D development preview. Berry Kick actively uses the new GLB for gameplay. Neither scene artwork, UI nor scoring logic was redesigned.

## Visual comparison and remaining manual check

Saved requested previews in `model/qa/proportions-v2/`:

- `comparison-front-side-actions.png`: same342px standing height; original above, revised below; front, side, both arms, left/right leg and shallow knee.
- `comparison-lean-move.png`: both torso lean directions, horizontal movement, joint limits, bend+kick and forward lean.
- `berry-contact-1920.png` and `carrot-preview-1920.png`: actual16:9 game captures.

At the same screen height and70° arm command, hand rise increases49.87→66.47 logical px (+33.3%). Full lateral foot reach increases19.13→26.79px (+40.0%). These are geometry measurements, not human recognition scores. The inspected poses show connected joints and no obvious open gaps or gross self-penetration; this is sampled visual inspection, not exhaustive mesh-collision proof.

Camera regression used a virtual camera and synthetic landmarks. No physical television, viewing-distance study or real-person webcam session was performed. The user should inspect the new silhouette and motion readability on their television and complete their deferred manual webcam check. No subsequent task was started.
