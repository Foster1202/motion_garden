# Motion Garden — agent handoff and working agreement

Updated: 2026-11-12. This is the shared entry point for every agent/task working in this repository. Read it before changes; verify live code rather than treating historical notes as current evidence.

## Mandatory workflow

1. Read this file, inspect `git status`, current branch/remote, relevant source and documentation.
2. Keep scope within the user's request. For medium/complex work, assess parallel tracks; use bounded subagents with disjoint write ownership when useful. Lead owns integration and verification. Announce dispatch and summarize collected results.
3. Before work, record the task, owner, scope and expected validation under Active work. Record significant decisions/blockers as work progresses. Coordinate shared-file edits; never overwrite another agent's entry blindly.
4. **Every change must update this file in the same commit**: changed behavior/files, tests actually run, remaining limitations and next action. Documentation and asset-only work count. Use dated concise history; distinguish current findings from historical QA.
5. Run checks appropriate to the change. For runtime/code changes run `npm run typecheck`, `npm test`, `npm run build`; for UI/game changes inspect real browser output and exercise the affected flow. Do not claim simulated webcam as human validation.
6. Review diff and staged files for unrelated work, secrets, large artifacts and missing exports. Stage only authorized work. Never discard existing user changes.
7. **Commit and push all completed changes to GitHub**, using concise, meaningful messages (for example `Improve berry orchard art`). Use the current authorized branch/upstream; do not force-push or rewrite shared history. Verify push and clean status. If credentials/network/rejection block push, record the exact blocker and report it; never claim synchronization without success. Do not embed a commit's own hash in this file; use `git log` to identify it.
8. Stop at the requested milestone. Code comments must be concise English.

## Team agent rules

These rules apply to every team member's AI agent. Keep `AGENTS.md` tracked and share updates through Git. A handoff is documentation, not authorization to start the next task.

### Read and synchronize before editing

1. Read this entire file, `README.md`, applicable nested `AGENTS.md` files, the latest handoff and any Active work entries. Read the task-relevant source, tests and docs before proposing changes. For Berry Kick read `docs/berry-kick-game.md`; for rabbit 3D/retargeting read `docs/task-4a-rabbit-realtime-3d.md` and `docs/task-4b-motion-retargeting.md`. Verify historical statements against current code.
2. Before each new change task or resumed editing session, inspect `git status --short --branch`, `git remote -v`, and the current branch/upstream. With a clean worktree, run `git pull --ff-only` against the intended upstream **before editing**, then re-read any updated instructions and relevant files. Do not pull before every individual file edit.
3. If there are existing changes, identify their owner and preserve them. Never automatically stash, discard, commit or stage someone else's work. Coordinate with the owner or use a separate worktree based on the updated remote branch. If pull fails, branches diverge, or the upstream is unclear, report the blocker and resolve it before proceeding with dependent edits; do not pretend the checkout is current.
4. Add an Active work entry before editing: task ID, date, team member/agent, branch, goal, owned paths, explicit exclusions and planned validation. Use a unique task ID such as `YYYY-MM-DD-owner-short-topic`. Concurrent agents must own disjoint paths or agree who integrates shared files. Preserve other Active work entries.

### Scope and integration

- Implement only the assigned task and acceptance criteria. Do not perform unrelated cleanup, dependency upgrades, asset regeneration, API changes or future tasks. Explain necessary scope expansions to the task owner.
- Preserve source assets, licenses, existing behavior and teammates' changes. Keep code comments concise and in English. Do not commit credentials, personal data, local caches or disposable builds. Do not use `git add -f` to bypass ignore rules without an explicit task reason.
- Use the branch authorized for the task; never assume permission to merge other branches or bypass branch protection. For parallel work, prefer separate task branches/worktrees and name the integration owner.
- Resolve conflicts by understanding both changes. Never blanket-select ours/theirs, force-push, rewrite shared history, or use destructive reset/clean commands to make a check pass. Ask the task owner when intended behavior is ambiguous.

### Validate, hand off, commit and push

1. Run the applicable checks in Mandatory workflow. Record actual commands and outcomes; use PASS, FAIL or NOT RUN with a reason. Documentation-only tasks require diff/link/content checks, not gameplay tests. Historical test results are not evidence for the current task.
2. Add a handoff using the template below to Verification and handoff history in this file. Update Current implemented state when behavior changes. Remove only your completed Active work entry; retain blocked or ongoing tasks with their blocker. Longer evidence may live in `docs/handoffs/<task-id>.md`, linked from the summary here.
3. Inspect `git diff`, stage only explicit task paths, and inspect `git diff --cached` and `git diff --cached --check`. Commit the completed changes and handoff together with a meaningful message. Never commit unrelated work merely to obtain a clean status.
4. Push every completed change to the intended GitHub branch. If the remote advanced, fetch and integrate its changes without rewriting shared history, resolve conflicts, rerun affected checks and retry a normal push. Respect protected branches: push an authorized task branch and provide a PR when required; do not bypass protection.
5. Verify the push succeeded and fetch/check that the remote branch contains the delivered commit; report remaining local changes or ahead/behind state. In the final response include the commit hash, remote branch or PR, validation and remaining issues. Never describe a local commit as uploaded. If authentication, network or permissions prevent upload, keep the local commit and report the exact blocker and next action without exposing secrets.

### Required handoff template

Use every field; write `None` or `Not applicable` where appropriate. Keep entries factual and concise, with repository-relative paths. Do not put the handoff commit's own hash inside itself; report it after committing.

```markdown
### YYYY-MM-DD — <task-id> — <short title>
- Owner / agent: <team member and agent; do not invent an identity>
- Branch / base: <working branch and starting commit>
- Request / scope: <goal, acceptance criteria and exclusions>
- Changes: <paths and resulting behavior; important decisions and reasons>
- Validation: <exact commands or manual scenarios; PASS / FAIL / NOT RUN and reasons; evidence paths>
- Risks / blockers: <known limitations, conflicts or remaining issues; None if absent>
- Next action: <specific follow-up and owner, or None; follow-up requires authorization>
- Delivery: <intended remote branch or PR; verify push in the final response>
```

## Repository and surrounding workspace

- Git root: `game/` within the BME3S02 workspace (or `motion_garden/` if clone from GitHub); origin `git@github.com:Foster1202/motion_garden.git`, current branch `main` (verify before use).
- `src/game/`: Phaser scenes, input, vision, mocap, Three.js bridge, game rules and UI/settings.
- `model/scripts/`, `model/assets/blender/`: reproducible Blender sources and scripts.
- `model/dist/`: required exported rabbit/berry assets used by `sync:assets`; intentionally tracked. `/dist/` is the disposable Vite build.
- `public/assets/`, `public/mediapipe/`: runtime images/GLB, local WASM/model; retain provenance and third-party licenses.
- `tests/`, `scripts/qa-*.mjs`, `docs/`: unit tests, browser QA and detailed task/design records.
- Siblings outside Git: `../room_modeling/` (6×6.4 m room, editable Blender scene, renders and 10-second video); `../proposal_presentation/` (14-slide proposal, PDF/PPTX, speaker notes and original photos); parent folder contains course PDFs/proposal documents. They are reference/deliverable tracks, not automatically included in Git pushes. Do not upload service photos/course materials without explicit scope and rights review.

## Current implemented state

- Vite + TypeScript + Phaser 3, 1600×900 logical world with FIT scaling. Traditional Hong Kong Chinese UI.
- Menu offers Carrot Pull and Berry Kick; Apple Harvest and Rabbit Goes Home remain disabled.
- Carrot Pull: complete five-carrot Sprite gameplay, camera/keyboard input, pause/replay/home. Three.js rabbit mode is still explicitly a development preview; do not report it as full 3D Carrot scoring.
- Carrot development preview defaults to separately exported V3 Rabbit Rig. V2 chain lengths/head scale are preserved, shoulder pivots widen, head/face/ears rise together, joint weights use export-equivalent LBS. Nineteen bone names/hierarchy remain. Straight lateral/forward/diagonal raise reaches150° with neutral head; at120° elbow≤45° and head target norm≤10°. Measured model curves also constrain interpolated actual joints. `rabbitRig=v2` restores the canonical V2 asset/limits; Berry continues V2. Task4C-2 supplies optional runtime IK and flat-ground foot contact. See `docs/task-4c1-rabbit-rig-improvement.md`.
- Task4D-1 adds the original Task2E carrot as a separate149KB GLB, measured final-bone palm tracking and independent six-state grab/attachment. DEV `carrotGrabDebug=1` enables explicit grab/release/reset/placement, proximity/debug controls, optional bounded145° inward arm planes and signed inward mocap through the existing solver/slew. Manual85–90°raise/0–10°elbow/145°plane holds the upper carrot root; local acceptance uses the explicit placement fixture because ground pickup exceeds the shallow stance reach. Same Three scene/texture,640×700 crop, duplicate Sprite carrot/front soil lip hidden only in this preview. Full Sprite scoring remains the game path. Geometry/Chrome/manual-pose tests pass; human/device acceptance and Task4D-2 production integration remain pending. See `docs/task-4d1-3d-carrot-grabbing.md`.
- V3 IK is enabled by the preview, with `rabbitIK=0` FK comparison and persistent DEV-only enable/disable/metrics. Class-level rig API defaults FK for compatibility. Actual Rest lengths feed analytic two-bone legs, fixed model-space sole targets and a feasible Root projection (x±.12/z±.08, knee≤48°); hand targets use an analytic seed and bounded V3 shoulder/elbow manifold search. A transform-only pose buffer owns the final real-bone commit. V3 mocap uses an optional two-speed arm target limiter (540°/s large errors,180°/s final12°), no extra EMA/inference/RAF. See `docs/task-4c2-realtime-ik-motion-coordination.md` and `docs/qa/task-4c2/`.
- Homepage settings retain manual thresholds, hold times, smoothing/confidence and display controls. Carrot camera now waits for reliable person detection, guides session-only personal standing/shallow-bend calibration automatically, waits for relaxed standing reference and enables mocap without an extra click.
- Local MediaPipe Pose Landmarker, one inference scheduler, camera lifecycle/error handling, pose extraction/retargeting and continuous GLB pose control (V3 IK / preserved V2 FK). Ordinary tracking loss suspends actions and waits without a rest modal, retains calibration/reference and recovers after reliable-frame confirmation. Explicit Pause/Rest and page-focus safeguards remain. Bottom-right debounced person status and developer pipeline telemetry are available.
- Berry Kick: actual continuous GLB leg motion, independent lateral movement, normalized no-calibration leg detection, real foot-bone projection into Phaser trunk hit zones, left/right three hits each, retraction plus cooldown, pause and cleanup. A/D movement, Q/E extension, release to retract, Esc pause. GLB failure disables scoring with an honest fallback message.
- Berry visual v2: separately rendered curved leafy trees, raspberry clusters, layered orchard, sand clearing, botanical foreground and woven basket. `npm run build:berry-art` regenerates assets. Rabbit driving, game rules and hitboxes were preserved during art work.
- AudioManager sound/voice hooks are currently silent; licensed audio remains a future task. No account/backend, long-term pose storage, action-quality scoring or clinical efficacy validation.

## Commands and known environment constraints

From repository root: `npm ci`, `npm run dev` (default 5173), `npm run typecheck`, `npm test`, `npm run build`.
Use `npm run dev -- --port 5175 --strictPort` when needed. `scripts/dev.mjs` handles the parent's colon-containing path with a temporary symlink; do not bypass Vite filesystem protections. Restart Vite if symlink watching serves stale source/assets.

`npm run sync:assets` syncs required model exports and MediaPipe. `npm run build:rabbit3d` rebuilds V2 GLB; `npm run build:rabbit3d -- --version v3` derives the separate V3 from saved V2 and exports a named GLB; `npm run build:berry-art` rebuilds berry art (Blender required). Preserve original Blender sources. V3 diagnostics, fixed-bind geometry validator, rendering and contact-sheet tools live under `model/scripts/`; final evidence lives in `model/qa/rig-v3/`.

`npm run build:carrot3d` exports the saved Task2E carrot without saving its source scene. `sync:assets` includes the required `model/dist/carrot3d/carrot_realtime.glb` runtime copy.

Browser suites: `qa:carrot-grab`, `qa:ik`, `qa:rig-v3`, `qa:rabbit3d`, `qa:mocap`, `qa:mocap-engine`, `qa:berry`, `qa:berry-camera`. Set `QA_URL` explicitly and `QA_OUTPUT` to an absolute temporary directory. Existing scripts use installed Chrome/Playwright; most default to 5173 while Berry defaults to 5175 and V3 to5177. Check script defaults. Readiness checks must await actual snapshots; the installed Playwright runtime treats async `waitForFunction` predicate Promises as immediately truthy. Never accept Xcode licenses on the user's behalf.

## Open work / next ideas (not authorization)

1. Human webcam trials, especially comfortable small leg extensions, varied camera height/distance, occlusion and elderly usability; record failures without storing personal video by default.
2. Verify Safari/Firefox, TV/laptop and target Mini-PC performance. Current historical QA primarily Chrome with keyboard/synthetic input.
3. Decide with user whether Carrot 3D preview should become full gameplay; do not silently replace stable Sprite path.
4. Complete third-party attribution/license audit before external redistribution; optimize duplicate source/runtime assets only with a reproducible clean-clone workflow.
5. Consider CI for typecheck/tests/build and browser smoke checks. Currently no verified CI/deployment pipeline.
6. Keep historical Task4A/V2 and Task4B-Fix limits distinct from current V3 model evidence. Personal calibration remains active for Carrot camera. Task4C-1 completes the bounded Blender review; Task4C-2 adds constrained arm/leg IK and fixed flat-ground foot targets. Task4D-1 adds a bounded development grasp. Moving contacts, production ground pickup/basket/score integration and Task4D-2 require separate authorization. High raise plus deep elbow flexion still collides outside the declared V3 envelope.
7. Further visual polish and future minigames require explicit user authorization.

## Active work

None.

## Verification and handoff history

### 2026-11-12 — 2026-11-11-lead-task4d1-grab — Live 3D carrot hand attachment
- Owner / agent: Codex Lead with bounded asset, interaction/test and Chrome QA workers; independent review collected and reliability/crop findings fixed.
- Branch / base: main / 1dc1480; clean upstream pulled before edits, final fetch confirms no remote divergence.
- Request / scope: Task4D-1 original Blender carrot GLB, actual post-IK hand transforms, independent grab/hold/release/reset, DEV manual/camera tools, rendering/lifecycle and regression QA. User additionally approved bounded inward extension of the existing arm IK. Stop at this prototype milestone.
- Changes: Reproducible `model/scripts/blender/export_carrot_glb.py` and build wrapper, required model/runtime GLB, asset sync/commands. New `Carrot3D`, `interaction/RabbitHandTracker`, `CarrotAttachmentController` and `CarrotGrabDebug`; exact parent-aware world grip including affine transforms, measured palms,0.208806model-unit per-hand gate,200ms transition then strict tracking, upright bounded orientation, loss/pause/cleanup. Preview callback runs after final rig commit and before render,640×700 grab-only crop with extreme FK coverage. Same scene/texture with explicit soil-lip/Sprite-carrot preview simplification. Optional V3 inward range145° uses coupled raise/elbow/low-raise clearance and the existing solver, interpolation and mocap slew; default/V2/Berry retain original range. HK debug UI, manual fixture, accurate owner/proximity/error, fresh click-time tracking/rejection checks. Existing IK/V3 QA readiness corrected to explicit awaited snapshot polling. README, detailed task document,45new unit tests and persisted `docs/qa/task-4d1/` evidence.
- Validation: PASS `npm run typecheck`, `npm test`260/260 (215original+45new,0skipped), `npm run build`, `npm run sync:assets`, Python/Bash/Node syntax and whitespace checks. Actual saved Task2E GLB148596bytes/8meshes/5materials/4684vertices/9336triangles, byte-identical repeated export, source geometry/material audit and unchanged source SHA.472inward/head-boundary LBS geometry samples PASS. Strict actual-GLB180frame maxhanddistance.169074 and griperror0. Chrome157 PASS grab24checks/45frameGIF/82continuoussamples, maxerror0 andcontact100%; qa:rabbit3d15 inclfive-carrotSprite, qa:mocap22, qa:ik11, qa:rig-v37, qa:berry7, qa:berry-camera7, realmodel qa:mocap-engine121virtual-empty frames. Production player5checks PASS. Final640×700 matchedcrop baseline60.08FPS/enabled60.13FPS, grab+debugmean.122ms/p95.30/max.40ms,8drawcalls/9336triangles added. Original Blender/Rabbit assets unchanged. Detailed limits and reports in task document/evidence directory.
- Risks / blockers: No delivery blocker. Human webcam, other browsers and target hardware NOT RUN. Original ground carrot requires the explicit reachable-placement test fixture. Contact is limited to the declared near-straight inward envelope; distant hands retain midpoint tracking with a visible proximity warning. Production ground occlusion uses a future integration decision, current preview hides the front soil lip. Geometry sampling covers declared cases and excludes intentional shoulder/body connectors. No full3D score/basket/physics delivery.
- Next action: None in Task4D-1. Task4D-2 can reuse the interfaces after separate authorization; ground pickup, production occlusion and human/device contact acceptance remain follow-up work.
- Delivery: Normal commit and push to origin/main requested; commit hash, remote parity and clean status verified in final response.

### 2026-11-10 — 2026-11-10-lead-task4c2-ik — Runtime IK and planted-foot coordination
- Owner / agent: Codex Lead with bounded leg solver, arm solver and Chrome/latency QA workers; independent integration review collected and telemetry findings fixed.
- Branch / base: main / e743637; clean `git pull --ff-only` PASS before editing.
- Request / scope: Runtime leg/arm IK, fixed foot contacts, unified motion ownership/blending, response analysis, DEV FK/IK comparison and QA. Preserve all183 tests/API, Blender/GLB/assets and human extraction/calibration/game rules. Commit/push requested; stop before Task4D.
- Changes: New `src/game/3d/ik/{TwoBoneIK,FootContactController,RabbitLegIK,RabbitArmIK,RabbitPoseBuffer}.ts`; actual rest lengths/axes, analytic legs and fixed flat-model contacts, Root reach projection, constrained nearest hand position within V3 measured joint manifold, shadow-only solving and one final bone commit. Existing rig setters preserved; Mocap uses optional atomic applyPose. V3 preview enables IK; V2/Berry remain FK. Mode toggle blends200ms, ordinary loss/neutral/recovery/pause retained. V3 responsive arm slew reduces large target lag without adding EMA. Persistent RabbitIKDebug exposes independent immutable foot/hand measurements, solved vs actual residuals and complete pose update timing. New QA/script/tests/docs and README. Existing forward-arm browser assertion now waits for its unchanged actual>50° condition as faster target response arrives sooner; V3 legacy QA explicitly selects FK.
- Validation: PASS `npm run typecheck`, `npm test`215/215 (183original +32new,0skipped), `npm run build`, Node syntax and `git diff --check`. Actual V3 mesh combined poses: minarea.05586/maxedge1.70321, no arm/head penetration in samples;45mixed leg poses minarea.3814/maxedge1.7517. Chrome157 at5178: qa:ik11checks/24FK-IKposes; qa:mocap22, qa:rabbit3d15 including full five-carrot Sprite, qa:rig-v37, qa:berry7, qa:berry-camera7 PASS; real MediaPipe qa:mocap-engine121empty-camera frames PASS. Page/content/overlay/console, target interactions, pause/reset/resize/fallback/cleanup and actual screenshots inspected. Fixed foot maxankle5.95e-7/maxsole5.33e-7modelunits;1000frames no accumulation; lateral.1 FKslide.1 vsIK4.11e-7. Solo FK60.03FPS/IK59.90FPS, full controllermean.204/.272ms, IKp95.50/max.60ms. Numerical120°display90%response671→308ms excluding camera. Original protected source/GLB hashes match base; no asset/calibration/extractor/retargeter/game-rule diff. Persisted evidence `docs/qa/task-4c2/`, detailed report `docs/task-4c2-realtime-ik-motion-coordination.md`;8row FK/IK sheet and520²/60frame/6sec GIF inspected.
- Risks / blockers: None for delivery. Human webcam, target device and other browsers NOT RUN; synthetic motion and empty real-model input do not establish human accuracy/latency. Contacts are fixed flat model-space stance, no walking/moving-platform/balance physics. Large Root targets are limited; unreachable hand targets keep explicit residuals, bounded search does not prove global optimum. V3 inner elbow/knee LBS compression remains. Timer includes entire controller update and is browser-quantized; mode transition may temporarily have contact error, measured on applied pose.
- Next action: None in Task4C-2. Suitable as a prototype foundation for separately authorized Task4D after human/device acceptance; do not start Task4D automatically.
- Delivery: Commit and normal push to origin/main requested; final response verifies commit and remote parity. No Blender/GLB or new game delivery.

### 2026-11-10 — 2026-11-09-lead-task4c1-rig-v3 — V3 Blender joint clearance and skinning
- Owner / agent: Codex Lead with bounded export/build, geometry QA and runtime compatibility workers; final read-only review collected.
- Branch / base: main / 2b4e2f0, clean upstream synchronized before edits.
- Request / scope: Diagnose saved V2, improve Blender shoulder/elbow/leg geometry and weights, produce separate reproducible V3, preserve19-bone API and verify actual GLB/runtime. Excludes IK, human extraction/calibration/retargeting algorithm changes, CarrotRound/game rules, new games and old asset regeneration. Stops at Task4C-1.
- Changes: `improve_rabbit_rig_v3.py` retains V2 segment lengths/head scale, moves shoulders±.515→±.770, changes rest splay23°→6°, raises head/face/ears.18, adds rounded connectors and rebakes V2 rounded rest surfaces before linear skinning with joint-based weights. Same19bones/parents, root-parented controllable carrot_socket. Separate V3 blend/GLB, exporter/build/sync extensions preserve V2. Controller reads verified per-model curves, uses V3 anatomical elbow hinge and constrains targets plus actual interpolation. Carrot dev preview defaults V3; explicit V2 fallback and Berry V2 remain. Blender validator/render/contact tools, V3 unit/browser QA, README and Task4C-1 document added.
- Validation: PASS `npm run typecheck`, `npm test`183/183 zero skipped, `npm run build`, V3 build/export/sync, Python/Node/Bash syntax and `git diff --check`. Fixed-rest topology Blender QA: PASS_WITH_LIMITS,973 raw poses,945 supported PASS,0 supported failures,19 unsupported clear and9 unsupported geometric FAIL; max supported head penetration0, symmetry4.92e-7, rest recovery0. Actual exported GLB static/continuous mesh tests PASS. Chrome157: `qa:rig-v3`7checks/17poses, `qa:rabbit3d`15, `qa:mocap`22, `qa:berry`7, `qa:berry-camera`7 PASS; `qa:mocap-engine`121real WASM/model empty-camera frames PASS. V3 Three~60.04FPS; simulated pose/Three~20/60FPS. Inspected86 Blender renders/five contact sheets and actual browser screenshots. Base/rigged/V2/canonical old GLB hashes unchanged, no old Sprite/animation/scene PNG or human-pipeline/game-rule diff. Repeated build has identical attributes/oriented geometry, only rigid-shoulder triangle ordering differs. Evidence: `model/qa/rig-v3/acceptance-summary.json`, geometry/browser/reproducibility reports and contact sheets; details `docs/task-4c1-rabbit-rig-improvement.md`.
- Risks / blockers: No delivery blocker.150° raise requires straight elbows/neutral head;120° permits elbow45°/head norm10°. Elbow110° supported at low raises, with residual LBS compression; knee inner crease remains. Elbow110° maxedge stretch1.614→1.703 versus V2 while area compression improves; knee area ratio.0738→.139. Extreme raw high-raise/deep-elbow combinations still collide and remain visible in reports. Root/ankle compensation is FK, no all-pose foot lock. Human webcam/target hardware/other browsers NOT RUN; synthetic pose and empty-camera engine tests do not establish human accuracy.
- Next action: None within Task4C-1. Assets/interfaces can support separately authorized Task4C-2 IK work within measured geometry limits; do not start automatically.
- Delivery: Local main commit only. User explicitly requested reporting before remote push, overriding the normal push workflow for this task. No remote push performed; final reply reports local commit/status.

- 2026-10-25 (historical): Berry visual v2; 155 tests and browser keyboard six-hit flow reported passing; no human webcam validation. See `docs/berry-kick-game.md`.
- 2026-10-31: Repository-wide source/docs/assets audit; established this agreement, expanded .gitignore, added software/art noncommercial licensing and README pointers. Identified untracked required `model/dist` exports hidden by broad `dist/` ignore; include current exports so clean clones can run asset sync. No gameplay changes. Current validation recorded below after checks. Git synchronization is verified by upstream status rather than assumed from this history.

Current maintenance validation (2026-10-31): typecheck PASS; 155/155 tests PASS; production build PASS. No runtime code changed, so browser suites were not rerun in this documentation/licensing task. Required export directories are included in this commit; runtime/source asset sync is checked separately.

- 2026-10-31: User requested local-only AGENTS.md. Existing .gitignore rule matches; remove from index and retain local instructions. Historical policy, superseded on 2026-11-06: AGENTS.md is now tracked and shared with the team. No gameplay changes; validation uses Git tracking/ignore checks, not runtime tests.

### 2026-11-06 — 2026-11-06-lead-team-rules — Shared agent workflow
- Owner / agent: Requesting team member / Codex Lead
- Branch / base: main / fd849b2
- Request / scope: Standardize team agents' reading, synchronization, handoff and Git delivery; documentation only.
- Changes: AGENTS.md adds required reading, pre-edit pull, ownership and conflict safeguards, validation/delivery rules and a uniform handoff template. Restores the shared tracked-file policy over the historical local-only policy.
- Validation: `git pull --ff-only` PASS (already current); `git diff --check` PASS; referenced existing documentation paths checked PASS. Runtime tests NOT RUN (documentation-only change).
- Risks / blockers: Rules require agent compliance; no automated enforcement added.
- Next action: None.
- Delivery: origin/main; push verification reported in the final response.

### 2026-11-09 — 2026-11-09-lead-task4b-fix — Automatic mocap and non-blocking tracking recovery
- Owner / agent: Codex Lead with bounded rig, tracking and QA workers
- Branch / base: main / e57bf20
- Request / scope: Diagnose camera-to-rabbit failure, automatically calibrate and enable continuous mocap, improve bounded FK and replace ordinary tracking-loss rest dialogs with waiting. Scope ends at Task 4B-Fix.
- Changes: Rabbit3DPreview previously constructed the mocap consumer only behind a debug flag and left it disabled. It now creates one controller per 3D preview and enables on calibrated camera frames with exclusive manual/mocap ownership. MotionInputController restores automatic two-step session calibration and stable standing reference, retains manual reset, pauses calibration on missing/stale frames and displays debounced bottom-right person status. MediapipeMotionInput/PoseClassifier never request automatic rest for ordinary loss, require stable reliable-frame recovery and expose camera/person/FPS/frame telemetry. CarrotPullScene freezes holds, animations, timers and tween callbacks during suspension, preserves score and restores clocks on replay. Extractor/retargeter/smoother carry multi-axis forward/side arm, torso, head and normalized comfortable knee targets. Rig uses quaternion FK, shoulder90°, pose-constrained elbow≤100°, torso18°/16°, hip24°/shin48° and a12° head target envelope with raised-arm attenuation. Debug slider range65→90°. Actual mesh checks required a conservative shoulder cap because old115° and experimental145° intersected the large head. No Blender, GLB, dependencies or CarrotRound rules changed. README and docs/task-4b-motion-retargeting.md describe the current flow and geometric limits.
- Validation: PASS `git pull --ff-only` before editing, `npm run typecheck`, `npm test` (172/172), `npm run build`, `git diff --check`. PASS final Chrome156 `qa:mocap`22/22, `qa:mocap-engine` (121 real WASM/model virtual-empty-camera frames, no automatic rest), `qa:rabbit3d`15/15 including full five-carrot Sprite game, `qa:berry`7/7 and `qa:berry-camera`7/7. PASS temporary production player UI suite5/5. Page identity/content, no framework overlay, screenshots, target interactions and console checks pass, with expected explicit context-loss/model-abort diagnostics. Main synthetic pose/Three rates ~20/60 FPS, actual empty-camera engine average17.28ms inference and Three~60 FPS. 120 neutral-head and150 combined-pose actual skinned-mesh probes check arm/head clearance. Evidence directories are under /private/tmp/motion-garden-4b-fix-*, details in the Task4B document. No extra inference/Three RAF or duplicate model load introduced.
- Risks / blockers: Human webcam validation NOT RUN, no participant motion supplied. Full vertical-overhead imitation remains limited by the large head/shoulder geometry. Extreme sampled combinations retain only shoulder-seam contact up to0.0031model units (~0.28logical px), wrists remain outside the head. Monocular depth, human latency/jitter, exhaustive collisions, other browsers and target hardware remain unverified. Personal calibration retains its10° minimum recognizable range. No delivery blocker.
- Next action: None within this task. Human/device acceptance and any Blender shoulder/rest-splay/mesh-weight changes require a separately authorized follow-up. Task4C remains outside this delivery.
- Delivery: origin/main, commit and normal push verification reported in the final response.
