# Task 4D-1 — 3D carrot and live hand attachment

## Scope and development entry

This prototype adds an independent carrot and grab controller to the existing rabbit preview. The scene clock drives the final bone pose, hand sampling, attachment and a single Three.js render. The Sprite round owns the complete five-carrot game.

```sh
npm run sync:assets
npm run dev -- --port 5178 --strictPort
```

Open `http://127.0.0.1:5178/?rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1`, then choose 開始遊戲 → 拔蘿蔔 → 使用鍵盤測試. The grab prototype, test placement and distance bypass are gated by `import.meta.env.DEV` and `carrotGrabDebug=1`.

The panel provides 重設蘿蔔, 抓住蘿蔔, 放開蘿蔔, 顯示抓握點 and 啟用抓取距離限制. 擺放到雙手中間（測試） explicitly repositions the carrot as a developer fixture. Reset restores the original placement. Manual controls remain available without a webcam. Camera mode retains automatic calibration and exclusive mocap/manual bone ownership.

## Reused Blender asset

The exporter reads the saved `carrot` collection in `model/assets/blender/scenes/carrot_pull_scene.blend`. It retains the original taproot, two soft creases, five leaves and five materials. It opens the source in memory and exports selected carrot objects. The saved source hash remains `fca00b17c627c16eb74f324ceb0506f8d6417143bdafb3129ad0ead313144ba0`.

```sh
npm run build:carrot3d
npm run sync:assets
```

`BLENDER_BIN` can select a Blender executable. The verified exporter uses Blender 5.2.1 glTF 2.0. It stages and audits the GLB before replacing `model/dist/carrot3d/carrot_realtime.glb`. The runtime copy lives at `public/assets/carrot3d/carrot_realtime.glb`. Repeated export produced byte-identical SHA-256 `35d112f6924b02432dd8342e5ee1ba7700817db1dd495e4105e5a13e2b95aaa0`.

| Property | Measured value |
| --- | --- |
| GLB size | 148,596 bytes |
| Meshes / materials | 8 / 5 |
| Vertices / triangles | 4,684 / 9,336 |
| Cameras / lights / animations / skins / textures | 0 / 0 / 0 / 0 / 0 |
| Local bounds minimum | (-0.346277, -1.099661, -0.252586) |
| Local bounds maximum | (0.360586, 0.648417, 0.297917) |
| Grip | `Carrot_Grip_Root → Carrot_Grip_Point`, origin (0, 0, 0) |
| Axes | Leaves +Y, taproot −Y, front +Z |

Blender `(x,y,z)` converts to glTF `(x,z,-y)`. The named Empty marks the authored leaf-root junction. Source-to-export geometry maximum error is zero in the export audit. The runtime uses a uniform carrot scale of 0.6, approximately 1.049 model units tall.

## Pose ownership and hand data flow

```text
Mocap OR manual targets
  → RabbitRigController.update
  → existing RabbitArmIK / RabbitLegIK / RabbitPoseBuffer
  → one final actual-bone commit
  → updateWorldMatrix
  → RabbitHandTracker
  → CarrotAttachmentController
  → debug helpers
  → renderer.render
  → Phaser CanvasTexture copy and refresh
```

`ThreeOverlay.render` invokes its attachment callback after the rig update and before rendering. Hand tracking reads the actual `hand.L` and `hand.R` bones, their final world positions and quaternions. The tracker centralizes measured hand-local grip offsets. The midpoint is the average of the two world grip positions. The grab controller reads these transforms and owns the carrot transform.

New grabs in camera mode require current reliable tracking, both arm confidences at least 0.65, a raw pose age of at most 250 ms, and ready, unsuspended input. Manual bone mode supplies its own reliable synthetic pose. Attached tracking continues to use the rendered rabbit bones during the existing short hold and gradual neutral recovery after tracking loss. Re-entry uses the existing motion smoother. Tracking loss preserves the attachment and score.

## Coordinate transforms and placement

The scene hierarchy is `Three Scene → rabbit.pivot → glTF scene → armature / bones` plus a separate carrot root under the same Three Scene. The rabbit floor pivot compensates its measured minimum Y. `pixelsPerUnit = configuredVisibleHeight / modelHeight` supplies the shared uniform logical-pixel conversion.

```text
Phaser X = 894 + Three X × pixelsPerUnit
Phaser Y = 681 − Three Y × pixelsPerUnit
Three X = (Phaser X − 894) / pixelsPerUnit
Three Y = (681 − Phaser Y) / pixelsPerUnit
```

The initial carrot grip maps the authored Phaser planted anchor `(894,668)` back to Three world units, with front-facing world Z 0.65. Model dimensions and depth remain independent of Phaser pixel coordinates. The full taproot extends below this initial ground-level grip.

## Rendering and crop

The prototype shares the rabbit's renderer, camera, lighting, scene and dynamic texture. Three.js depth testing orders rabbit and carrot geometry. Phaser displays that combined texture at rabbit depth 40. The existing background, soil back, basket and foreground retain their Phaser layers.

With the grab prototype active, the old Sprite carrot and front soil lip are hidden. This exposes the whole 3D carrot and avoids a duplicate target. It is an explicit development-preview ground-occlusion simplification. The combined texture cannot independently occupy planted-carrot depth 41 and carried-carrot depth 43. Task 4D-2 will need a ground-occlusion decision for production integration.

The grab viewport is `(574,119,640,700)`, compared with the normal rabbit viewport `(634,229,520,520)`. Each RGBA surface grows from 1,081,600 to 1,792,000 bytes, a 65.7% pixel increase. This applies to the offscreen surface and Phaser texture separately, with additional GPU/copy buffers owned by their renderers. Browser QA checks combined-pose bounds at supported rabbit scales and released positions, including maximum-scale FK lean/root corners. The wider crop leaves clearance around the measured 588.405…1199.595 logical-X extrema. A released object keeps its world transform while the rabbit continues to move.

## Pause, release and lifecycle

Pause freezes the existing scene update, mocap, rig and attachment transition. Grab buttons and toggles are disabled. Resume continues from the same transition time. Release preserves the last carrot world transform, and reset restores the initial position, orientation and state.

Mode changes and scene shutdown abort the current fetch, reject stale generations, remove debug DOM/helpers, dispose carrot geometry/materials and the grab controller, then release the original rabbit overlay. The carrot class remains independently loadable for later ground, held, released and basket owners. CarrotRound and Sprite animation frame attachment remain on the existing game path.

## Verification

The completed command results, Chrome measurements and persisted evidence are listed in the verification table at the end of this document.

## Measured hand grip and distance rule

`RabbitHandTracker` isolates vertices with at least 0.5 influence from each actual hand bone, builds their model-space bounds and chooses an inner/front palm reference. It converts that reference into hand-local coordinates once. The actual V3 offsets are `L=(0.069496965,0.075360673,0.044440859)` and `R=(-0.069496954,0.075360627,0.044440864)`. Other assets can use a measured forearm-length fallback when hand-weighted skin is unavailable. A disposed tracker marks subsequent samples invalid.

The V3 palm bounding-sphere radius is 0.130503570. Each hand must be within `1.6 × radius = 0.208805711` model units of the carrot grip. The threshold scales with the actual rabbit model world scale. Both hands, valid transforms and reliable input are required. The normal rest palm span is 1.574778533, so a distant central carrot is rejected. A developer can explicitly disable distance checking, and the panel reports when the hands remain outside the contact range. The click handler refreshes tracking eligibility synchronously, including the latest rejected-frame status, before confirming a grab.

## Approved inward arm extension

The existing V3 shoulder plane covered lateral to forward motion, from 0° to 90°. The original V3 hand-bone separation was at least 1.6973 in the accessible manual range. This prevented a narrow central hold. The user approved extending the existing arm IK's inward range during this task.

`setArmInwardEnabled(true)` enables a maximum 145° plane only for this V3 prototype. The same existing solver, target slew, interpolation buffer and final bone commit own the pose. The manual panel exposes the extra plane range. Camera extraction preserves the signed inward upper-arm direction relative to its anatomical shoulder side, and its existing retargeting/slew carries the bounded plane. The default controller path and V2 use their original range.

The added geometry envelope couples all three arm parameters. For planes above 90°, maximum raise falls linearly from 150° to 90° at plane 145°. The elbow limit falls to 10° by plane 100°, alongside the existing raise-dependent curve. The maximum inward plane is 140° below raise 75°, increasing to 145° at raise 85°. Applied interpolated joints are constrained again before final commit.

The reproducible manual contact pose is bilateral raise 85–90°, elbow 10°, plane 145°. A 0° elbow produces a closer hold. At `90/10/145`, palm reference span is 0.328145520 and each distance to the midpoint is 0.164072760. At `90/0/145`, span is 0.232849680. The inner range therefore supports a bounded near-straight-arm hold. High overhead raises and deep elbow bends use the coupled limits, and widely separated hands can continue to drive the attachment midpoint while the panel reports lost contact proximity.

## Grab state machine and attachment transform

```text
IDLE ↔ NEAR_TARGET → GRABBING → ATTACHED → RELEASING → RELEASED
  ↑                    │           │                     │
  └────────────────────┴──── reset ┴─────────────────────┘
```

`NEAR_TARGET` expresses current eligibility. A button confirms `GRABBING`; valid proximity alone does not trigger a grab. `RELEASED` can be explicitly grabbed again. Release ends carrot ownership immediately and the next update advances `RELEASING` to `RELEASED`.

The 200 ms transition interpolates the current world grip and rotation toward the current hand midpoint with smoothstep. Each step consumes at most 50 ms. Once attached, placement uses the current final-bone midpoint on every frame. A bounded world-upright orientation derives roll and yaw from the hand line, limits them to 25° and 20°, and keeps the last valid orientation when the line degenerates.

`Carrot3D.setGripWorld` subtracts the scaled, rotated local grip offset from the desired root placement and transforms the desired world matrix through the inverse parent matrix. For nonuniform ancestors, it retains the exact local affine matrix when decomposition would discard shear. This preserves the requested world grip and orientation. Reset restores the complete original transform and matrix-update mode. Release preserves the last world transform and introduces no gravity or basket motion.

## Automated verification coverage

The new tests cover actual GLB parsing, explicit grip/axes, failed and aborted loads, missing grip, repeated resource disposal, nonzero local grips, rotated/scaled parents including affine transforms, actual hand skin measurement, world/local conversion, root and model scales, post-IK sampling, midpoint computation, strict distance acceptance/rejection, bypass capability, six states, smooth transition, exact following, bounded/degenerate orientation, release/reset, reliability/loss, pause/resume, invalid numbers and controller destruction.

A strict-distance actual-GLB test follows 180 frames of independent arms, side/forward lean, shallow knees and root travel. Distance bypass is forbidden in this test. Maximum per-hand distance is 0.169073717 and maximum attachment error is 0 model units. A separate 240-frame stress test exercises the broader original pose range through the explicitly labelled developer bypass. Six new inward tests additionally check optional activation, V2 behavior, solver/FK/IK agreement, applied per-frame limits, representative actual skinned-mesh clearance and reset/invalid requests. Four camera-mapping tests check signed anatomical direction, unreliable arms, original default behavior, unchanged standing reference and target slew.

The Blender export-equivalent V3 LBS audit checks 442 inward envelope poses and 30 combined head-boundary poses. All sampled poses pass the declared head/distal-torso penetration and triangle-crossing checks. Nominal geometry is bilaterally symmetric. The shoulder connector region is intentionally excluded from distal torso collision checks because it joins the body. The source rig file hash remains unchanged. This audit supports the sampled envelope.

## Known limitations and Task 4D-2 interfaces

- The original ground-level carrot remains below the reach of the current shallow-knee/short-arm pose. Local acceptance uses the explicit test-placement button to bring a loose carrot into the accessible two-hand hold. Ground pickup requires subsequent game/target integration.
- Two-hand contact depends on the bounded inward envelope. The panel reports proximity separately from midpoint attachment. Finger articulation and a collision-based grasp solver remain future work.
- The combined texture uses the documented hidden-soil-lip simplification. Production planted/carried occlusion and basket transfer need a later rendering/game integration decision.
- Human webcam contact quality, monocular depth, real-user jitter/latency, other browsers and target hardware require device/participant validation. Browser motion evidence uses manual or synthetic inputs.
- `Carrot3D` can load independently, expose its root/grip, accept world placement and release its resources. `RabbitHandTracker` samples final bones. `CarrotAttachmentController` exposes grab/release/reset, pause/resume and snapshots. These are the reusable interfaces for a separately authorized Task 4D-2.

## Final validation and browser evidence

Final verification completed on 2026-11-12. Chrome 157 runs through the installed Playwright package because the Browser plugin is unavailable. Development uses `127.0.0.1:5178`, and the built production player uses `127.0.0.1:5179`. The main viewport is 1512×982, with 600×800 responsive and rabbit-scale 0.5/1.5 checks.

| Command / check | Final result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 260/260, comprising 215 original and 45 new tests, zero skipped |
| `npm run build` | PASS |
| `npm run sync:assets` | PASS, including the required carrot GLB |
| `npm run qa:carrot-grab` | PASS, 24 checks |
| `npm run qa:rabbit3d` | PASS, 15 checks, including the full five-carrot Sprite round |
| `npm run qa:mocap` | PASS, 22 checks with synthetic poses |
| `npm run qa:ik` | PASS, 11 checks |
| `npm run qa:rig-v3` | PASS, 7 checks |
| `npm run qa:berry` | PASS, 7 checks, including six-hit keyboard completion |
| `npm run qa:berry-camera` | PASS, 7 checks with synthetic poses |
| `npm run qa:mocap-engine` | PASS, 121 real-model frames from an empty virtual camera |
| Production player | PASS, 5 checks, query flags retain the player interface and ordinary Sprite scoring |
| Geometry / export | PASS, repeat GLB export, 442 inward poses and 30 head-boundary combinations |
| Source / diff | Original Blender and Rabbit exports unchanged, Node/Python/Bash syntax and whitespace checks PASS |

The final grab suite covers page identity, meaningful content, overlay/console health, normal UI controls, strict proximity rejection and acceptance, synchronous rejected/suspended-camera gating, release/reset, short attach interpolation, tracking-loss handling, pause during attachment, repeated mode changes, load failure, pending-load shutdown, resource release, and crop bounds. Chrome inspected initial, near, transition, held, raised, side-lean, knee, lateral, released and reset states. Both hands visibly meet the upper carrot root/leaf base in the strict inward sample. Sampled inward poses show no obvious head/torso penetration. The recorded continuous sequence contains 82 scene-clock samples with contact proximity satisfied in every sample and maximum attachment error 0. The 45-frame GIF records actual final bones, attachment and rendering under changing pose targets.

The matched 640×700 benchmark measured 60.08 FPS with carrot drawing and attachment/debug updates omitted, and 60.13 FPS with them enabled. Loaded asset allocation remained present in both samples. Carrot rendering adds 8 draw calls and 9,336 triangles. Attachment plus debug update averaged 0.122 ms, with p95 0.30 ms and maximum 0.40 ms. The crop's additional copy/memory cost is described above. These measurements describe this local Chrome run.

The existing IK and V3 QA scripts used async `waitForFunction` predicates. The installed Playwright runtime treated their returned Promise as immediately truthy, exposing a model-reload assertion before loading finished. Their readiness checks now explicitly await and poll real scene snapshots. The completed reruns pass their original assertions.

Persisted evidence lives in `docs/qa/task-4d1/`.

- `browser-report.json` contains the 24 grab checks, strict contact poses, continuous samples, matched-crop performance and extreme FK crop boundaries.
- `inward-geometry-report.json` records the 472 sampled geometry checks and source hash.
- `regression-summary.json` and `production-report.json` summarize the existing suites and production query gating.
- `strict-01-two-hand-grasp.png` and `strict-01-two-hand-grasp-three.png` show the final UI and actual transparent render.
- `grab-contact-sheet.png` collects eight states, preserving screenshot aspect ratios. `strict-continuous.gif` shows the bounded two-hand hold during live pose changes.

Full temporary regression captures remain under `/private/tmp/motion-garden-4d1-regression/`. The expected Berry model-failure resource error and MediaPipe initialization diagnostics are identified in the reports.

## Changed file inventory

| Change | Paths |
| --- | --- |
| New independent model / interaction | `src/game/3d/Carrot3D.ts`, `src/game/3d/CarrotGrabDebug.ts`, `src/game/3d/interaction/RabbitHandTracker.ts`, `src/game/3d/interaction/CarrotAttachmentController.ts` |
| Preview / final pose integration | `src/game/3d/Rabbit3DPreview.ts`, `ThreeOverlay.ts`, `Rabbit3DDebug.ts`, `RabbitRigController.ts`, `rabbit3dConfig.ts`, `ik/RabbitArmIK.ts` |
| Optional inward mocap path | `src/game/mocap/HumanPoseExtractor.ts`, `MotionRetargeter.ts`, `MotionSmoother.ts`, `MocapController.ts` |
| Scene / UI | `src/game/scenes/CarrotPullScene.ts`, `src/style.css` |
| New asset pipeline | `model/scripts/blender/export_carrot_glb.py`, `model/scripts/build_carrot_glb.sh`, `model/dist/carrot3d/carrot_realtime.glb`, `carrot_realtime.report.json`, `public/assets/carrot3d/carrot_realtime.glb` |
| Commands / asset sync | `package.json`, `scripts/sync-game-assets.mjs` |
| Browser checks | New `scripts/qa-carrot-grab.mjs`, readiness fixes in `scripts/qa-rabbit-ik.mjs` and `scripts/qa-rabbit-rig-v3.mjs` |
| New unit tests | `tests/Carrot3D.test.ts`, `Carrot3DInteraction.test.ts`, `CarrotGrabMocap.test.ts`, `RabbitArmInward.test.ts`, `RabbitHandTracker.test.ts` |
| Documentation / evidence | `README.md`, `AGENTS.md`, this document and `docs/qa/task-4d1/` |

## 21 項驗收匯報

| 項目 | 結果 |
| --- | --- |
| 1 新增與修改檔案 | 上方 inventory 列出全部程式、資產、測試和文檔路徑 |
| 2 Blender 來源 | 完整重用 Task2E 已保存的 carrot collection |
| 3 GLB 大小與結構 | 148,596 bytes，8 meshes、5 materials、4,684 vertices、9,336 triangles |
| 4 Grip Point | 葉根接合處，`Carrot_Grip_Root → Carrot_Grip_Point`，本地原點 |
| 5 雙手位置 | 量度手掌蒙皮參考點，轉為手骨局部 offset，再讀最終世界座標 |
| 6 IK 後讀取 | 統一 bone commit 與世界矩陣更新後、同一幀 render 前取樣 |
| 7 抓取距離 | 每手距離上限約 0.208806 模型單位，按模型世界縮放調整 |
| 8 狀態機 | 六個獨立 grab states，按鈕確認及明確拒絕原因 |
| 9 附著跟隨 | 200ms 過渡，隨後每幀按雙手中點與有界朝向計算世界變換 |
| 10 可見偏移 | 掌心參考點至物體中央約 0.163–0.169 單位，前視畫面雙手接觸蘿蔔上端 |
| 11 穿模 | 已測內收姿勢沒有明顯頭／軀幹穿插，472 個幾何樣本通過 |
| 12 釋放與重設 | 通過，釋放保留世界變換，重設恢復初始位置及狀態 |
| 13 遮擋 | 同一 Three scene 的深度測試，開發預覽隱藏 Sprite 蘿蔔與泥土前唇 |
| 14 Crop | 擴為 640×700，涵蓋最大縮放 FK 側傾／平移邊界 |
| 15 Tracking Lost | 保留附著，跟隨兔子既有保持及平滑回復策略，重新抓取需可靠雙手 |
| 16 Pause / Resume | 通過，變換、過渡時間及開發操作同步凍結／恢復 |
| 17 性能 | 同 crop 基線 60.08 FPS，啟用 60.13 FPS，附著連 debug 平均 0.122ms |
| 18 自動測試 | 260/260 通過，保留原有 215 項並新增 45 項 |
| 19 Chrome QA | 抓取 24 項及全部既有相關 suites、production 5 項通過 |
| 20 真人 Webcam | 尚待真人及目標裝置實測，現有證據為手動／合成輸入與空鏡頭引擎驗證 |
| 21 Task4D-2 | 已具備接口整合基礎。地面實際拾取、正式遮擋與真人接觸品質仍需後續驗收；本次在 Task4D-1 停止 |
