# Task 4B — continuous motion retargeting

Status: Task 4B software implementation and automated verification complete. Final results: 125/125 unit tests, typecheck, production build, 13/13 mocap browser checks, the real MediaPipe engine smoke test and 15/15 existing Task 4A browser checks and 5/5 production UI checks passed. Human webcam accuracy and motion latency are intentionally unverified: the user chose to perform the real-person check manually. Task 4C has not been started.

## Open the preview

From `game/`:

```sh
npm run dev -- --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/?rabbit3dDebug=1&mocapDebug=1**, then:

1. Choose **開始遊戲 → 拔蘿蔔 → 開啟鏡頭**. Grant camera permission when the browser asks.
2. Complete the existing natural-standing and comfortable shallow-bend calibration. Press its **開始遊戲** button.
3. Return to natural standing with arms relaxed. In the right-hand Task 4B panel, click **啟用即時動作同步**. Remain stable for about 600 ms until the reference is ready.
4. Raise one arm, then both; lean gently to either side; bend within the calibrated comfortable range; move a small distance sideways and return. The rabbit receives continuously varying bone targets.
5. Use **重設參考姿勢** after changing camera/standing position. Return to natural standing for reference capture. Use **停止動作同步** to return to manual bone controls.
6. Select **Sprite 完整遊戲** for the original full Carrot Pull game. Returning home or choosing keyboard input closes the camera stream. Stopping only bone synchronization leaves the existing Camera input/preview active.

`DEV_MOCAP_DEBUG` defaults off and is gated by `import.meta.env.DEV`. Enable it with `mocapDebug=1` or `VITE_DEV_MOCAP_DEBUG=true`; manual sliders separately use `rabbit3dDebug=1`. The production build has no mocap panel, manual debug UI or render selector, even with these queries. Camera starts only after the existing camera button is clicked. Nothing is stored or uploaded by the new pipeline.

The known colon-path development workaround remains unchanged. Restart Vite after source edits if its symlink watcher serves stale code.

## Files

New: `src/game/mocap/HumanPoseExtractor.ts`, `MotionRetargeter.ts`, `RabbitPose.ts`, `MotionSmoother.ts`, `MocapController.ts`, `MocapDebug.ts`, `mocapConfig.ts`; `tests/MotionRetargeter.test.ts`, `tests/MocapController.test.ts`; `scripts/qa-rabbit-mocap.mjs`, `scripts/qa-mocap-engine.mjs`; this document.

Updated: `MotionInputController.ts` (shared callback/profile/reset bridge), `CarrotPullScene.ts` (forwarding/pause hooks), `Rabbit3DPreview.ts` (exclusive control lifecycle/debug), `ThreeOverlay.ts` (idempotent context-loss release), `src/style.css` (scrolling tools and narrow preview), `package.json` (QA commands), `qa-rabbit-3d.mjs` (optional external evidence directory). No dependencies, source rig, GLB, calibration math or game rules changed.

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

`HumanPoseExtractor.extract(frame, poseSnapshot, calibration)` returns aspect-correct, **raw/unmirrored camera** 2D measurements:

```ts
interface HumanPose {
  leftArmElevation?: number; rightArmElevation?: number;
  leftElbowBend?: number; rightElbowBend?: number;
  leftArmConfidence: number; rightArmConfidence: number;
  torsoLean: number; activeKneeAngle: number;
  centerX: number; bodyScale: number;
  trackingConfidence: number; timestampMs: number;
}
```

Angles are degrees. `centerX` is normalized image X of the hip midpoint; `bodyScale` is shoulder distance in pixels divided by image width. Geometry first converts normalized coordinates to pixels with the actual video width and height. No arm-forward/depth angle is emitted: the current shared PoseFrame contains normalized image landmarks, and monocular estimated depth is not treated as precise 3D motion.

```ts
interface RabbitPose {
  leftArmElevation: number; rightArmElevation: number;
  leftElbowBend: number; rightElbowBend: number;
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

The natural reference's arm and elbow values are subtracted. Targets are clamped to the current rig's safe configured range. Each shoulder uses its anatomical side, and the rig applies its already verified opposite local-axis signs. Planar measurements cannot reliably distinguish a forward reach from foreshortening or crossing the torso; those are limitations, not solved 3D retargeting.

### Torso side lean

```text
rawLean = atan2(shoulderMidX - hipMidX, hipMidY - shoulderMidY) × 180/π
rabbitLean = clamp(rawLean - referenceLean, -14°, +14°)
```

Raw camera-right shoulder motion gives positive lean; the rig's positive lean moves the head screen-left, matching the mirrored preview. The baseline preserves an individual's stable natural posture. ±14° is a display constraint, never a user exercise target.

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

Targets inherit rig clamps: upper arm 0…115°, elbow 0…55°, torso ±14°, knees 0…1 and lateral root ±0.45. The underlying Task 4A manual rig permits a small negative arm range, but the mocap mapper emits no negative elevation. NaN/Infinity, out-of-frame/unreliable landmarks, degenerate segments, stale/future/replayed timestamps, mismatched snapshots and implausible discontinuities are rejected before bone setters.

The mocap confidence threshold is 0.65. Torso and calibrated knee confidence determine overall tracking; each arm has independent confidence. A briefly missing arm holds its own last target; after 600 ms it targets neutral while the other arm/body continue. Reliable arm recovery goes through the same limits.

No second strong landmark EMA was added. Knees already use PoseClassifier's EMA (`alpha=.35`). `MotionSmoother` bounds target rates: arms/elbows 180°/s, torso 60°/s, bend 1.8/s, root 0.6 model units/s. The existing rig exponential quaternion slerp with rate 14 supplies visual interpolation at Phaser's render cadence. A render step is capped at 50 ms to avoid consuming a pause in one jump. The rig interpolation time constant is approximately 71 ms; this is a mathematical filter property, not a measured human end-to-end delay. Large changes intentionally take longer due to rate limiting.

Freshness is 250 ms. Short unreliable/stale periods hold the current smoothed pose; at 600 ms since the last reliable frame the target becomes neutral and returns gradually. Fresh tracking recovers without a pose snap. The existing Camera input still requests its safety pause at approximately 3 seconds of tracking loss. Returning after that pause requires **繼續**; it does not auto-resume. Pause blocks incoming consumer frames/writes, resume preserves the reference but clears stale observations and awaits fresh frames. Recalibration/input change clears reference and observations.

## Debug, lifecycle and performance

The panel shows tracking/reference status, confidence, left/right angles, torso, bend, root, MediaPipe FPS, Three FPS, rejected-frame count, raw HumanPose, mapped RabbitPose, rate-limited RabbitPose and actual GLB bone rotations relative to rest. Actual bone angles are quaternion rotation magnitudes, not signed per-axis Euler values. Rendering is throttled to about 6.7 UI updates/s; inference and bone interpolation remain independently scheduled by their original owners.

The right-hand tools scroll. They hide during the original calibration flow so the camera/calibration UI stays usable; in narrow windows the webcam preview moves to the lower-left, leaving mocap controls accessible. Stopping mocap recreates manual controls; leaving 3D removes both. Input generations reject late callbacks, existing camera destruction ends all tracks, and existing Three disposal releases model/texture/context resources. Repeated context-loss disposal avoids issuing a second loseContext call.

Final macOS Google Chrome 155.0.8059.80 headless results:

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

Reports/screenshots default to `/private/tmp/motion-garden-4b-qa` (override `QA_OUTPUT`); temporary evidence is not shipped as model assets. Reusable browser tests live in `scripts/`. Unit tests add 14 mapping/reference cases and 9 temporal/controller cases, including the actual GLB driven by 25 Hz synthetic frames with 60 Hz rig updates, while retaining all 102 original tests. Browser tests cover calibration/reference gating, continuous independent actual bones, both torso/root directions, calibrated knees, partial/full confidence loss and recovery, mutual exclusion, pause, responsive non-overlap, WebGL sprite fallback, one-model ownership, safety pause and ended camera tracks on home. The existing Task 4A suite additionally exercises full five-carrot sprite gameplay and renderer disposal.

Expected diagnostic logs from the real engine are retained in its report: the TensorFlow Lite XNNPACK delegate INFO line is emitted through the error console stream despite being informational; MediaPipe also warns about disabled OpenGL error checking and unused feedback tensors for this model. Unrelated console errors still fail the checks. The forced-context-loss test's explicit sprite fallback warning is expected.

## Remaining manual acceptance and next boundary

Real-person testing is **not completed** by user choice. Before treating motion fidelity as accepted, manually check anatomical left/right, mirrored movement intuition, slow raise/lower/hold, gentle lean, comfortable bend, small side steps/return, stability at rest, brief occlusion/re-entry, longer-loss pause, and camera indicator off after returning home. Record actual MediaPipe/Three FPS, jitter, visible delay and any reverse bending or mesh breakage. No real-person latency, jitter, accuracy, arbitrary combined-pose quality or Raspberry Pi compatibility is claimed.

The software interface is ready for Task 4C investigation after the human check. Full-body/foot/hand IK, foot locking, 3D carrot interaction, motion quality/speed scoring, fall detection, audio and new games are outside Task 4B. Task 4C is not implemented.
