# Task 4B — continuous motion retargeting

Current update 2026-11-09. Task 4B-Fix repairs automatic camera-to-rabbit startup, restores guided personal calibration, expands bounded FK and replaces tracking-loss rest dialogs with waiting. Verification and limitations are recorded below. Earlier numerical results are historical. Human webcam validation remains outstanding. Work stops at Task 4B-Fix.

## Open the preview

From `game/`:

```sh
npm run dev -- --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/?rabbit3dDebug=1&mocapDebug=1**, then:

1. Choose **開始遊戲 → 拔蘿蔔 → 開啟鏡頭**. Grant camera permission when the browser asks.
2. Wait for reliable person detection, then follow the natural-standing and comfortable shallow-bend instructions. Steps advance automatically. When no person is detected, the camera waits indefinitely.
3. Return to natural standing with arms relaxed. A stable reference is collected over about 600 ms and mocap starts automatically. The controller is created for every 3D preview, independently of debug flags.
4. Raise one arm, then both; lean gently to either side; bend within the calibrated comfortable range; move a small distance sideways and return. The rabbit receives continuously varying bone targets.
5. Use **重設參考姿勢** after changing camera/standing position. Return to natural standing for reference capture. Use **改用手動骨骼測試** to return to exclusive manual bone controls. **恢復自動體感同步** releases manual control.
6. Select **Sprite 完整遊戲** for the original full Carrot Pull game. Returning home or choosing keyboard input closes the camera stream. Stopping only bone synchronization leaves the existing Camera input/preview active.

`DEV_MOCAP_DEBUG` defaults off and is gated by `import.meta.env.DEV`. Enable it with `mocapDebug=1` or `VITE_DEV_MOCAP_DEBUG=true`; manual sliders separately use `rabbit3dDebug=1`. The production build has no mocap panel, manual debug UI or render selector, even with these queries. Camera starts only after the existing camera button is clicked. Nothing is stored or uploaded by the new pipeline.

The known colon-path development workaround remains unchanged. Restart Vite after source edits if its symlink watcher serves stale code.

## Files

New: `src/game/mocap/HumanPoseExtractor.ts`, `MotionRetargeter.ts`, `RabbitPose.ts`, `MotionSmoother.ts`, `MocapController.ts`, `MocapDebug.ts`, `mocapConfig.ts`; `tests/MotionRetargeter.test.ts`, `tests/MocapController.test.ts`; `scripts/qa-rabbit-mocap.mjs`, `scripts/qa-mocap-engine.mjs`; this document.

Updated: `MotionInputController.ts` (shared callback/profile/reset bridge), `CarrotPullScene.ts` (forwarding/pause hooks), `Rabbit3DPreview.ts` (exclusive control lifecycle/debug), `ThreeOverlay.ts` (idempotent context-loss release), `src/style.css` (scrolling tools and narrow preview), `package.json` (QA commands), `qa-rabbit-3d.mjs` (optional external evidence directory). Task 4B-Fix also changes input waiting/recovery, calibration orchestration, rig limits and debug telemetry. Dependencies, Blender sources, GLB and CarrotRound rules are preserved.

## Architecture and ownership

```text
Existing PoseCamera webcam
→ Existing PoseEstimator / Pose Landmarker (one inference scheduler, maximum 25 FPS)
→ Existing MediapipeMotionInput / PoseClassifier
→ MotionInputController callback: PoseFrame + PoseSnapshot + installed CalibrationProfile
→ HumanPoseExtractor
→ MotionRetargeter + temporary MotionReference
→ MotionSmoother (bounded target velocities)
→ RabbitRigController target setters
→ Existing Phaser update / ThreeOverlay quaternion interpolation and render
```

No second camera, Pose Landmarker instance, inference RAF, animation clip, state-driven rabbit animation, IK solver or game project was added. The new consumer is attached to the existing frame callback only after calibration is accepted. Recalibration, input switch, camera error or input release invalidates its reference and old targets. Calibration algorithms/profile schema, scoring and CarrotRound state transitions remain unchanged.

Ownership is exclusive:

| Mode | Rabbit source | Game progression |
| --- | --- | --- |
| Sprite | Existing discrete MotionInput and original spritesheet | Original complete game |
| 3D manual | Existing Task 4A sliders | Development preview; game state frozen |
| 3D mocap | Continuous landmarks through the retargeter | Development preview; game state frozen |

Enabling mocap removes the manual slider UI and gives the controller exclusive writes. Stopping mocap releases its writes immediately, smoothly resets the rig target and creates fresh zeroed manual controls. Switching to sprite, GLB/WebGL failure or scene shutdown disposes the mocap controller. Hidden sprites remain paused in 3D, including after Pause/Resume.

## Data structures and coordinates

`HumanPoseExtractor.extract(frame, poseSnapshot, calibration)` returns aspect-correct, **raw/unmirrored camera** measurements with optional bounded monocular depth cues:

```ts
interface HumanPose {
  leftArmElevation?: number; rightArmElevation?: number;
  leftElbowBend?: number; rightElbowBend?: number;
  leftArmPlane?: number; rightArmPlane?: number;
  torsoForward?: number; headYaw?: number; headPitch?: number;
  leftArmConfidence: number; rightArmConfidence: number;
  torsoLean: number; activeKneeAngle: number;
  centerX: number; bodyScale: number;
  trackingConfidence: number; timestampMs: number;
}
```

Angles are degrees. `centerX` is normalized image X of the hip midpoint; `bodyScale` is shoulder distance in pixels divided by image width. Geometry first converts normalized coordinates to pixels with the actual video width and height. Finite normalized landmark z is scaled by image width to estimate a bounded forward-arm plane, torso pitch and continuous arm elevation. Missing z falls back to 2D. Face points provide optional head cues. These monocular values require human validation.

```ts
interface RabbitPose {
  leftArmElevation: number; rightArmElevation: number;
  leftElbowBend: number; rightElbowBend: number;
  leftArmPlane: number; rightArmPlane: number;
  torsoForward: number; headYaw: number; headPitch: number;
  torsoLean: number; bendAmount: number; lateralOffset: number;
  trackingConfidence: number; timestampMs: number;
}
```

Rabbit angles are rest-relative degrees; `bendAmount` is 0…1; `lateralOffset` is glTF model units. The verified Task 4A model has +Y up, +Z front and +X screen-right. `RabbitRigController` still converts model-space axes to each measured bone local frame. No Blender, GLB or rig modification was needed.

## Anatomical sides and mirror behavior

MediaPipe labels are anatomical identities: left shoulder/elbow/wrist = 11/13/15; right = 12/14/16. These are never swapped or derived by sorting image X. The existing webcam video is mirrored only by CSS. A frontal rabbit's anatomical left arm is on the viewer's right; the debug panel explicitly explains this distinction.

The acceptance rule is **human anatomical left → rabbit anatomical left**, and likewise right. Mirrored screen displacement is a separate operation used for torso/root display. It would be incorrect to swap arm labels merely to place both left hands on the same screen side. Synthetic tests prove landmark/bone identities and mirrored formulas; only the user's manual test can establish perceived mirror intuitiveness with a real person.

Official landmark and normalized/world coordinate definitions: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), [anatomical landmark enumeration](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmark).

## Mapping formulas

### Arms and elbows

Let `down = hipMidpoint - shoulderMidpoint`, using pixels. The upper-arm elevation is the unsigned angle between `elbow - shoulder` and `down`: natural downward arm ≈0°, horizontal ≈90°, upward ≈180°. Elbow bend is `180° - angle(shoulder, elbow, wrist)`. Both are measured continuously; no UP/DOWN event is used.

The natural reference's arm and elbow values are subtracted. Targets are clamped to the current rig's safe configured range. Each shoulder uses its anatomical side, and the rig applies its already verified opposite local-axis signs. The shoulder uses a normalized quaternion swing axis blended between lateral and forward motion around its fixed pivot. Elbow flexion uses a forward hinge with coordinated bounds near the head. Bone lengths and rest-relative rotations are preserved.

### Torso side lean

```text
rawLean = atan2(shoulderMidX - hipMidX, hipMidY - shoulderMidY) × 180/π
rabbitLean = clamp(rawLean - referenceLean, -18°, +18°)
```

Raw camera-right shoulder motion gives positive lean; the rig's positive lean moves the head screen-left, matching the mirrored preview. The baseline preserves an individual's stable natural posture. ±18° is a display constraint, never a user exercise target.

### Personal shallow knees

The extractor consumes `PoseSnapshot.activeKneeAngle` from the **existing classifier**, including its existing landmark EMA and calibration cohort. It checks that the selected left/right/both cohort is still present and agrees with the fused angle. A single-leg profile cannot silently switch sides or include a newly visible leg.

```text
bendAmount = clamp((profile.standingAngle - activeKneeAngle) / profile.range, 0, 1)
```

No new universal knee threshold or comfortable range is introduced. No averaging of differently normalized per-leg ratios replaces the existing fusion. The output goes directly to `rig.setKneeBend`, which uses the Task 4A shallow FK/root-lowering approximation. It never plays Rabbit_Bend/Rabbit_Return. This remains a projected 2D knee measure rather than proof of anatomical 3D joint angle or planted-foot IK.

### Relative lateral motion

```text
d = -(currentHipMidX - referenceHipMidX) / referenceShoulderWidth
m = max(0, abs(d) - 0.06)
lateralOffset = sign(d) × clamp(m / (0.65 - 0.06), 0, 1) × 0.45
```

The negative sign matches the mirrored camera display. The 0.06-shoulder-width deadzone suppresses small center noise; ±0.45 model units bounds travel. Returning to the reference returns the rabbit to zero without integrating drift. Absolute screen position is never mapped directly to rabbit position.

## Calibration and runtime MotionReference

`CalibrationProfile` is unchanged. After it is installed, a separate in-memory reference captures natural torso angle, arm/elbow baselines, hip center and shoulder scale. Capture requires reliable torso/selected knees and both arms, knee angle at or above the existing personal standing threshold, relaxed arms ≤25°/elbows ≤35°, and at least 600 ms of stable samples with gaps ≤250 ms. Stability bounds are 6° angular spread and 0.10 shoulder widths/10% scale spread.

Finishing the bend calibration does not immediately establish a reference while the person is bent. They must return to natural standing. Calibration changes reset the reference. More than 35% shoulder-scale change or 1.5 shoulder widths of center displacement requests a manual reference reset and targets neutral. The reference is neither persisted nor added to the calibration schema.

## Constraints, smoothing and tracking loss

Targets inherit rig clamps: upper arm 0…90°, elbow up to 100° with coordinated clearance bounds, torso side ±18°/forward ±16°, knees 0…1 (hip 24°/shin 48°) and lateral root ±0.45. The underlying Task 4A manual rig permits a small negative arm range, but the mocap mapper emits no negative elevation. NaN/Infinity, out-of-frame/unreliable landmarks, degenerate segments, stale/future/replayed timestamps, mismatched snapshots and implausible discontinuities are rejected before bone setters.

The mocap confidence threshold is 0.65. Torso and calibrated knee confidence determine overall tracking; each arm has independent confidence. A briefly missing arm holds its own last target; after 600 ms it targets neutral while the other arm/body continue. Reliable arm recovery goes through the same limits.

No second strong landmark EMA was added. Knees already use PoseClassifier's EMA (`alpha=.35`). `MotionSmoother` bounds target rates: arms/elbows 180°/s, torso 60°/s, bend 1.8/s, root 0.6 model units/s. The existing rig exponential quaternion slerp with rate 14 supplies visual interpolation at Phaser's render cadence. A render step is capped at 50 ms to avoid consuming a pause in one jump. The rig interpolation time constant is approximately 71 ms; this is a mathematical filter property, not a measured human end-to-end delay. Large changes intentionally take longer due to rate limiting.

Freshness is 250 ms. Short unreliable/stale periods hold the current smoothed pose; at 600 ms since the last reliable frame the target becomes neutral and returns gradually. Fresh tracking recovers without a pose snap. Ordinary tracking loss always returns requestPause=false and autoRestRecommended=false. The camera waits indefinitely. Input actions stop immediately and need 200 ms of continuous reliable observations to recover. Sprite hold progress, animation callbacks, scene timers and tweens freeze during loss, preserving score and round. The bottom-right state chip is debounced independently of immediate input suspension. Pause blocks incoming consumer frames/writes, resume preserves the reference but clears stale observations and awaits fresh frames. Recalibration/input change clears reference and observations.

## Debug, lifecycle and performance

The panel shows tracking/reference status, confidence, left/right angles, torso, bend, root, MediaPipe FPS, Three FPS, rejected-frame count, raw HumanPose, mapped RabbitPose, rate-limited RabbitPose and actual GLB bone rotations relative to rest. Actual bone angles are quaternion rotation magnitudes, not signed per-axis Euler values. Rendering is throttled to about 6.7 UI updates/s; inference and bone interpolation remain independently scheduled by their original owners.

The right-hand tools scroll. Calibration instructions occupy the left panel while the rabbit and diagnostic tools stay visible; in narrow windows the webcam preview moves to the lower-left, leaving mocap controls accessible. Stopping mocap recreates manual controls; leaving 3D removes both. Input generations reject late callbacks, existing camera destruction ends all tracks, and existing Three disposal releases model/texture/context resources. Repeated context-loss disposal avoids issuing a second loseContext call.

Historical Task 4B macOS Google Chrome 155.0.8059.80 headless results:

| Measurement | Result | Scope |
| --- | --- | --- |
| Simulated landmark output through existing scheduler | 20.00 FPS targets / 60.00 FPS Three | Actual calibration, controller and GLB rendering; synthetic pose |
| Actual MediaPipe WASM/model, virtual test pattern | 20.00 FPS; average 17.67 ms inference; 60.00 FPS Three | 109 inference frames; no detected human |
| Existing Task 4A resize/screenshot regression | 52.1…60.0 FPS | Includes resize and screenshot overhead |
| Human webcam accuracy, jitter and motion delay | Not tested | User will check manually |

No end-to-end human performance or forward-depth accuracy claim follows from these measurements.

## Verification commands and evidence

```sh
npm run typecheck
npm test
npm run build
npm run qa:mocap
npm run qa:mocap-engine
QA_OUTPUT=/private/tmp/motion-garden-4b-qa/4a/ npm run qa:rabbit3d
```

Start Vite dev before browser commands. The Browser plugin is unavailable in this session; tests use Playwright with installed macOS Google Chrome in headless mode. `qa:mocap` uses Chrome's virtual webcam and replaces only Landmarker output in the browser test process. It still exercises the real PoseCamera, original PoseEstimator scheduler, classifier EMA, two-step CalibrationController, forwarding hook, mocap pipeline and actual GLB renderer. This is explicitly **not a human webcam test**. `qa:mocap-engine` uses the actual MediaPipe WASM/model with a virtual test pattern, without replacing inference results; no person is present, so landmark accuracy is not tested.

Reports/screenshots default to `/private/tmp/motion-garden-4b-qa` (override `QA_OUTPUT`); temporary evidence is not shipped as model assets. Reusable browser tests live in `scripts/`. Unit tests add 14 mapping/reference cases and 9 temporal/controller cases, including the actual GLB driven by 25 Hz synthetic frames with 60 Hz rig updates, while retaining all 102 original tests. Browser tests cover calibration/reference gating, continuous independent actual bones, both torso/root directions, calibrated knees, partial/full confidence loss and recovery, mutual exclusion, pause, responsive non-overlap, WebGL sprite fallback, one-model ownership, indefinite waiting, replay-clock reset and ended camera tracks on home. The existing Task 4A suite additionally exercises full five-carrot sprite gameplay and renderer disposal.

Expected diagnostic logs from the real engine are retained in its report: the TensorFlow Lite XNNPACK delegate INFO line is emitted through the error console stream despite being informational; MediaPipe also warns about disabled OpenGL error checking and unused feedback tensors for this model. Unrelated console errors still fail the checks. The forced-context-loss test's explicit sprite fallback warning is expected.

## Remaining manual acceptance and next boundary

Real-person testing is **not completed**. This task used virtual camera and synthetic poses. Before treating motion fidelity as accepted, manually check anatomical left/right, mirrored movement intuition, slow raise/lower/hold, gentle lean, comfortable bend, small side steps/return, stability at rest, brief occlusion/re-entry, longer-loss waiting and automatic recovery, and camera indicator off after returning home. Record actual MediaPipe/Three FPS, jitter, visible delay and any reverse bending or mesh breakage. No real-person latency, jitter, accuracy, arbitrary combined-pose quality or Raspberry Pi compatibility is claimed.

Full-body/foot/hand IK, foot locking, 3D carrot interaction, motion quality/speed scoring, fall detection, audio and new games are outside Task 4B. Task 4C is not implemented.

## Task 4B-Fix diagnosis and current verification

The first disabled handoff was Rabbit3DPreview. It previously created MocapController only when mocapDebug was enabled, initialized mocapEnabled=false and forwarded frames only after the developer toggle. Camera and manual sliders could therefore work while all incoming pose data stopped before the mocap consumer. A second independent fault started loss timing at camera startup and requested a blocking rest dialog after 3 seconds even with nobody present.

Mocap now has one owner per 3D preview. Calibrated camera frames enable it automatically, and a stable relaxed standing reference gates mapping. Manual sliders are removed while mocap owns the rig. Explicit developer manual override persists until restored. The panel shows camera, person, calibration, reference, ACTIVE/waiting controller state, current source, inference-frame/human-pose/mapped-pose counts, target and actual arm angles, torso, knee and both FPS readings. UI refresh is throttled and no landmark arrays are logged.

Calibration starts after continuous reliable person detection and presents the natural-standing instruction before sampling the personal baseline. Initial personal standing may be below the manual default threshold. A bend-complete pose never establishes MotionReference. Lost or stalled inference pauses calibration sampling and its timeout, retaining an already completed standing baseline. User-guided natural stance and a reliable framing remain necessary.

The shoulder and elbow pivots/rest axes were valid. Restrictive debug slider maximum 65°, runtime shoulder limit 115°, elbow limit 55° and the old downward elbow rotation constrained expression.  Actual skinned-mesh checks found that the old 115° shoulder limit and an experimental 145° range intersect the large head in high lateral raises. The final shoulder cap is 90°, with coordinated elbow/plane clearance. This increases the manual slider range from 65° while keeping physical targets below the old unsafe limit. Full vertical overhead reach remains a model limitation. The large head extends to ±0.796 model-X while shoulder pivots are only ±0.515 at Y1.637. Future larger reach needs an authorized upper_arm.L/R pivot/rest-splay and adjacent arm/hand mesh-weight review, possibly head/neck proportions, then a regenerated Blender source, GLB and runtime copy. Carrot 3D and Berry share the GLB. Existing exported Sprites change only if separately regenerated. Full calibrated bend uses 24° hip/48° shin and gives approximately 4.1→8.1 px root lowering. Comfortable human knee normalization remains unchanged. Head requests include counter-roll of 40% of body side lean, subject to the composed head/arm clearance bounds. A 12° composed head target envelope and continuous attenuation from shoulder elevation 60° to 90° coordinate head/shoulder clearance. Final safe hand rise is approximately 89.9 logical px at 342 px rabbit height. Full vertical overhead copying is limited by the current geometry. Sampled extreme combinations retain shoulder-seam contact up to 0.0031 model units (about 0.28 logical px), with wrists and distal arm vertices outside the head in the checked poses. Blender source assets and GLB exports are preserved.

Validation commands, current results, evidence directories and remaining limitations are recorded in the 2026-11-09 AGENTS.md handoff. Chrome tests use simulated landmarks for full movement and the real MediaPipe WASM/model with a virtual empty pattern for engine/lifecycle validation. Human tracking accuracy, motion delay, self-occlusion, exhaustive mesh collisions and target-device performance remain open validation items. Task 4C requires a separate request.

### Core files changed in Task 4B-Fix

- `src/game/input/MotionInputController.ts` and `src/game/calibration/CalibrationPanel.ts` restore automatic guided calibration, standing return, player hints and person status.
- `src/game/input/MediapipeMotionInput.ts`, `MotionInput.ts` and `src/game/vision/PoseClassifier.ts` provide non-blocking wait, reliable-frame recovery and telemetry.
- `src/game/3d/Rabbit3DPreview.ts` and `src/game/mocap/MocapController.ts` connect the consumer independently of debug flags, own bones exclusively and expose each pipeline stage.
- `src/game/mocap/HumanPoseExtractor.ts`, `MotionRetargeter.ts`, `MotionSmoother.ts`, `RabbitPose.ts` and `mocapConfig.ts` carry bounded continuous arm-plane, body, knee and head channels.
- `src/game/3d/RabbitRigController.ts` and `rabbit3dConfig.ts` enforce model-space quaternion FK and coordinated head/arm clearance.
- `src/game/scenes/CarrotPullScene.ts` freezes game clocks, animations and callbacks during input suspension, and restores clocks on replay.
- `src/game/mocap/MocapDebug.ts`, `src/game/3d/Rabbit3DDebug.ts` and `src/style.css` provide diagnostic visibility, bounded manual sliders and unobtrusive status.
- Focused tests and `scripts/qa-rabbit-mocap.mjs` / `qa-mocap-engine.mjs` retain existing scenarios and exercise the new flow.

### Current verification on 2026-11-09

- `npm run typecheck`, `npm test` and `npm run build` pass. All 172 tests pass, including the original test cases with changed automatic-rest expectations.
- Final Chrome 156 uses `http://127.0.0.1:5175/` for development and `http://127.0.0.1:5176/` for the production player check. Browser plugin is unavailable, so installed Chrome runs through Playwright.
- The main mocap suite passes 22 checks. It covers empty-camera wait, bent arrival, calibration/inference stall, automatic activation, individual/combined movements, tracking recovery, exclusive manual ownership, clock replay and disposal. A separate run without mocapDebug verifies debug-independent startup and a personal standing baseline of 155°.
- Main synthetic motion measurements are about 20.00 pose FPS and 60.00 Three FPS. The real MediaPipe model runs 121 virtual-empty-camera frames, averages about 17.28 ms inference and renders at about 60.00 Three FPS.
- Production player UI passes 5 checks. The standard 3D/Sprite suite verifies the full five-carrot keyboard game. Berry regressions include deliberate model-load failure, which emits the expected failed-resource console entry. The mocap suite deliberately loses WebGL context and verifies Sprite recovery.
- Reports and screenshots live under `/private/tmp/motion-garden-4b-fix-qa`, `motion-garden-4b-fix-engine-final`, `motion-garden-4b-fix-production`, `motion-garden-4b-fix-rabbit-final`, `motion-garden-4b-fix-berry-final` and `motion-garden-4b-fix-berry-camera-final`.
- Human webcam testing remains unperformed. Monocular depth, camera placement, real latency/jitter, exhaustive collision coverage and target-device performance need participant/device validation. Existing personal calibration requires at least a 10° recognizable range and offers retry/keyboard within comfort.
