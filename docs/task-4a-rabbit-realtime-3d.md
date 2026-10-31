# Task 4A — realtime rabbit preview

Status: Task 4A complete. Final verification: 102/102 unit tests (including 8 real GLB/controller tests), typecheck and production build passed; 15/15 real Chrome checks and 4 production UI checks passed. The 3D character is a development preview; it does not implement Carrot Pull animation/attachment or MediaPipe retargeting. Sprite mode retains the complete game. Task 4B has not been started.

## Preview and controls

From `game/`:

```sh
npm install
npm run sync:assets
npm run dev -- --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/?rabbit3dDebug=1`, choose 開始遊戲 → 拔蘿蔔 → 使用鍵盤測試. Development defaults to 3D. The right-hand panel has live arm, body, head, knee and root sliders plus reset; scroll the panel for lower controls. Input events update targets continuously, without waiting for pointer release. Use the render selector to switch to Sprite 完整遊戲. Alternatively open `?rabbitRender=sprite` for the old game directly.

`DEV_RABBIT_3D_DEBUG` defaults off. Enable it with the above query or `VITE_DEV_RABBIT_3D_DEBUG=true`; both are gated by `import.meta.env.DEV`. Production defaults to sprite and exposes no debug panel or mode selector, even when the query is present. Normal development without the debug query still shows the explicitly labelled 3D preview and mode selector.

The existing Vite colon-path symlink workaround is retained. Sync assets before starting Vite. During this run its symlink watcher did not reliably invalidate changed source/new public directories, so restart the dev server after syncing newly generated assets or changing source if the displayed code is stale.

## Export and source preservation

```sh
npm run build:rabbit3d
npm run sync:assets
```

`BLENDER_BIN` can select another Blender executable. The script uses Blender's glTF 2.0 exporter with no animations, cameras or lights. It opens the original rig in memory, clears evaluated animation poses, exports only the character collection, audits a staged GLB, then replaces the output. It does not save either source blend.

Outputs: `model/dist/rabbit3d/rabbit_realtime.glb` and `rabbit_realtime.report.json`; runtime copy: `public/assets/rabbit3d/rabbit_realtime.glb`. The existing sprite build scripts, atlases and attachment tracker are preserved. Three.js is pinned to `0.186.1`, types to `0.186.0`. Playwright is a development dependency for real Chrome QA.

Blender 5.2.1 LTS verified 967,988 bytes, 21 mesh objects, 25,173 vertices, 49,632 triangles and seven materials. One glTF skin is shared by four skinned limb meshes. Rigid bone-parented body, head, ears and tail plus inherited face features remain in their actual hierarchy. The GLB preserves all 19 bones:

```text
root
├── body
│   ├── head → ear.L, ear.R
│   ├── upper_arm.L → forearm.L → hand.L
│   ├── upper_arm.R → forearm.R → hand.R
│   ├── thigh.L → shin.L → foot.L
│   ├── thigh.R → shin.R → foot.R
│   └── tail
└── carrot_socket
```

The report contains actual object hierarchy, rest matrices/local axes, bone pivots, modifier/weight audit, material factors, floor bounds and deformation probes. `extras.originalBoneName` retains exact names because GLTFLoader sanitizes punctuation in runtime names. No bones are renamed or rerigged in the source. Source SHA-256 hashes remain unchanged. Repeated GLB builds have SHA-256 `0e547611b70c5273efa205b8275693430ece7670750c14182d31b6dd8c7890be`. Source-to-export rest geometry maximum error is below 0.000001462 model units; all seven material factors and blush vertex colors are preserved.

## Coordinates, camera and placement

Actual conversion: Blender `(x,y,z)` → glTF `(x,z,-y)`. Thus +Y is up and +Z faces the camera. The exported rest bounds are about `[-0.856344,0.004381,-0.641985]` to `[0.856344,3.603972,0.648712]`.

`Rabbit3D` computes the actual rest bounding box, sets a floor pivot at `-minY`, and uses one uniform conversion of `342 / modelHeight` ≈ 95.011 logical pixels per model unit. There is no nonuniform stretch. Camera: OrthographicCamera at `(0,0,12)`, looking along `(0,0,-1)`, near 0.1, far 50. Frustum is derived from the fixed crop and this conversion. The front view and face/ear placement were checked in real Chrome screenshots.

Three world → Phaser world:

```text
phaserX = 894 + pixelsPerUnit * threeX
phaserY = 681 - pixelsPerUnit * threeY
```

The transparent render crop is Phaser logical `(634,229,520,520)`. It includes the model, ears and limited sideways movement. The mapping anchors the geometry soles at the original `(894,681)` platform position. Phaser's existing 1600×900 FIT canvas then applies the same scale/letterboxing to the rabbit and every world object; there is no independently resized DOM canvas to drift. The 520² offscreen surface has DPR 1, independent of window/DPR, trading some high-DPI sharpness for bounded copying cost.

## Layering and update lifecycle

`ThreeOverlay` renders only the rabbit into a transparent WebGL canvas. `Rabbit3DPreview` copies each live frame into a Phaser CanvasTexture, displayed as an image at depth 40. The texture is created from real 3D geometry, not a PNG or animation clip. This keeps the existing single Phaser world renderer and its native ordering:

```text
background (0/10) → platform (20) → shadow (25) → rabbit (40)
→ carrot (41/43) → soil/front/basket → foreground (60) → DOM HUD/dialog
```

This replaces the suggested stacked DOM canvases with a small dynamic texture bridge, avoiding a second Phaser renderer and any scene layering rewrite. The CPU/GPU canvas copy is a known cost; it is restricted to 520×520 pixels. Garden layers remain pre-rendered assets.

Phaser scene update is the sole clock. No additional RAF/setAnimationLoop is used. Three frames stop when the scene pauses or the document is hidden; scene shutdown aborts fetches, invalidates pending async results, removes the preview image/texture/debug DOM, disposes bones/model geometry/materials/textures and renderer, releases its WebGL context and removes the canvas. Late GLB completion is disposed instead of attached. Hidden sprite animations remain paused during 3D preview, including after Pause → Continue.

## Rig API

All angles are degrees; offsets are unscaled model units. Examples:

```ts
rig.setArmRotation('left', 50, 15); // Upper arm and forearm.
rig.setArmRotation('right', 50);
rig.setBodyLean(-10, 5); // Side, forward.
rig.setHeadRotation(15, 0, 0); // Yaw, pitch, roll.
rig.setKneeBend(0.5); // Continuous 0…1.
rig.setRootOffset(0.3, 0.02, 0);
rig.resetPose(); // Smooth return; true restores immediately.
rig.update(deltaSeconds);
rig.dispose();
```

Both `left/right` and `L/R` are accepted. Each control generates a target from stored rest pose; no rotation accumulates. Rest-world inverse quaternions convert the measured model axes to each bone's local coordinates, so skewed arm bone orientations are respected. Anatomical left and right arm raises use opposite model-Z signs; positive body-X bows toward the front. Controls use exponential quaternion slerp/position lerp with rate 14 and no spring overshoot.

API clamps: upper arm -12…115°, forearm 0…55°, body side/forward ±14°, head yaw ±25°, pitch ±18°, roll ±14°, root X±0.45/Y±0.04/Z±0.12. The visible panel deliberately uses smaller ranges: arm 0…65°, body side ±12°/forward ±8°, head yaw ±18°, root X±0.45/Y0…0.04. Nonfinite inputs resolve to zero. Future Task 4B can supply these targets after a separate human-to-rabbit mapping design; no such mapping or calibration change is present here.

Knees use thigh -15°, shin +30°, foot -15° at full input plus an analytically calculated root descent from measured rest segment dimensions. The static symmetric FK approximation maintains sampled mesh sole height within 0.001 units in automated tests; full bend changes foot depth by about 0.00136 units. This does not provide IK, asymmetric foot locking or guarantees for combined arbitrary poses. These remain future Task 4C issues.

## Render mode and fallback

3D preview freezes CarrotRound progression while retaining existing Camera/Keyboard setup, pause, state machine, score and input modules. It has no harvest attachment/animation implementation. Switch to sprite for a complete playable session. GLB HTTP/parse/rig/WebGL initialization failure or context loss returns to the original sprite with a visible notice; only one rabbit is displayed. Cancellation/mode generations stop stale loads from creating duplicate models. Existing sprite animation assets and RabbitAttachmentTracker remain unchanged.

## Lighting, performance and limitations

The renderer uses sRGB output, NeutralToneMapping/exposure 1, hemisphere intensity 2, ambient .35 and a warm directional key intensity 2.2 at `(-3,5,7)`. No dynamic shadows, fur, postprocessing, physics or environment reflection were added. Output color space follows the [official Three.js color-management guidance](https://threejs.org/manual/pages/color-management.html). These are renderer/light adjustments; original material colors remain untouched. Browser PBR/tone mapping differs from Eevee/AgX, so an exact pixel color match is not claimed.

Final Chrome 155.0.8059.80 samples were 60.0 FPS at 1920×1080, 60.0 at 1440×900, 53.1 at 1512×982, 52.1 at 900×700 and 59.0 at 600×800. These short windows include resize/screenshot automation overhead and canvas-copy cost; no isolated bottleneck profile was performed. See `qa/task-4a/browser-report.json` for actual Chrome version, FPS and each viewport. FPS is live Phaser/Three update throughput, not a synthetic renderer benchmark. The QA runner uses installed macOS Google Chrome in headless mode with real WebGL; the Browser plugin was not available. It does not verify visible Chrome window composition, live human webcam exercise, Raspberry Pi performance or arbitrary-pose deformation. The existing camera/calibration unit suites are rerun, but no camera-to-bone connection has been added or claimed.

## Verification and evidence

```sh
npm run typecheck
npm test
npm run build
npm run qa:rabbit3d
```

Start the development service before the last command. The QA runner imports the development scene snapshot, so use Vite dev, not production preview. It requires local Google Chrome and Playwright; on this machine sandboxed browser launch failed and the permitted macOS execution path was used. `QA_URL` can override the localhost address.

The unit suite includes eight actual GLB/controller tests rather than substituting mock geometry: parse/all bones/hybrid bindings, independent deformed arms, body/head/face hierarchy, continuous knee mesh soles, clamps, rest reset/no drift, frame-rate interpolation and missing rigs. The real-browser suite tests page identity/nonblank/framework overlays, live slider interpolation, both arms/body/head, continuous knees/root, reset, pause/resume, five FIT viewports (1920×1080,1440×900,1512×982,900×700,600×800), layer ordering, full five-carrot sprite gameplay, actual GLB HTTP failure fallback, repeated mode switching, scene shutdown and renderer memory disposal. Console errors from the deliberate HTTP 404 are excluded; unrelated errors fail the suite. The suite also forces actual WebGL context loss and leaves during a delayed GLB load. Renderer cleanup verifies zero model geometries/programs, no scene children, removed Phaser texture and a lost WebGL context. Three r186 retains a counter for its shared 16×16 DFG lighting lookup texture after disposal; source inspection identifies this engine LUT, and forced context loss releases its native allocation. The assertion allows exactly this one internal counter rather than claiming all Three counters are zero.

Screenshots and the machine-readable report are in `docs/qa/task-4a/`. Standing, arms/body/head, knee, resized layouts and completed sprite game are retained as evidence. During development, QA caught and corrected independent body-slider target preservation and hidden sprite resume after pause; acceptance uses the final rerun.

Task 4A establishes the rendering/controller interface needed for Task 4B. Entering Task 4B still requires explicit authorization. Combined movement quality, retargeting, IK/foot locking and device performance remain separate work.
