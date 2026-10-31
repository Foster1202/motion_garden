# Motion Garden — agent handoff and working agreement

Updated: 2026-10-31. This is the shared entry point for every agent/task working in this repository. Read it before changes; verify live code rather than treating historical notes as current evidence.

## Mandatory workflow

1. Read this file, inspect `git status`, current branch/remote, relevant source and documentation.
2. Keep scope within the user's request. For medium/complex work, assess parallel tracks; use bounded subagents with disjoint write ownership when useful. Lead owns integration and verification. Announce dispatch and summarize collected results.
3. Before work, record the task, owner, scope and expected validation under Active work. Record significant decisions/blockers as work progresses. Coordinate shared-file edits; never overwrite another agent's entry blindly.
4. **Every change must update this file in the same commit**: changed behavior/files, tests actually run, remaining limitations and next action. Documentation and asset-only work count. Use dated concise history; distinguish current findings from historical QA.
5. Run checks appropriate to the change. For runtime/code changes run `npm run typecheck`, `npm test`, `npm run build`; for UI/game changes inspect real browser output and exercise the affected flow. Do not claim simulated webcam as human validation.
6. Review diff and staged files for unrelated work, secrets, large artifacts and missing exports. Stage only authorized work. Never discard existing user changes.
7. **Commit and push all completed changes to GitHub**, using concise, meaningful messages (for example `Improve berry orchard art`). Use the current authorized branch/upstream; do not force-push or rewrite shared history. Verify push and clean status. If credentials/network/rejection block push, record the exact blocker and report it; never claim synchronization without success. Do not embed a commit's own hash in this file; use `git log` to identify it.
8. Stop at the requested milestone. Code comments must be concise English.

## Repository and surrounding workspace

- Git root: `game/` within the BME3S02 workspace; origin `git@github.com:Foster1202/motion_garden.git`, current branch `main` (verify before use).
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
- Homepage settings: manual motion thresholds, hold times, smoothing/confidence and rabbit display controls; persisted settings. No personal calibration wizard in active game flow.
- Local MediaPipe Pose Landmarker, camera lifecycle/error handling, pose extraction/retargeting and GLB rabbit FK controls. Legacy calibration files/types remain for compatibility/history; their presence does not mean the wizard is active.
- Berry Kick: actual continuous GLB leg motion, independent lateral movement, normalized no-calibration leg detection, real foot-bone projection into Phaser trunk hit zones, left/right three hits each, retraction plus cooldown, pause and cleanup. A/D movement, Q/E extension, release to retract, Esc pause. GLB failure disables scoring with an honest fallback message.
- Berry visual v2: separately rendered curved leafy trees, raspberry clusters, layered orchard, sand clearing, botanical foreground and woven basket. `npm run build:berry-art` regenerates assets. Rabbit driving, game rules and hitboxes were preserved during art work.
- AudioManager sound/voice hooks are currently silent; licensed audio remains a future task. No account/backend, long-term pose storage, action-quality scoring or clinical efficacy validation.

## Commands and known environment constraints

From repository root: `npm ci`, `npm run dev` (default 5173), `npm run typecheck`, `npm test`, `npm run build`.
Use `npm run dev -- --port 5175 --strictPort` when needed. `scripts/dev.mjs` handles the parent's colon-containing path with a temporary symlink; do not bypass Vite filesystem protections. Restart Vite if symlink watching serves stale source/assets.

`npm run sync:assets` syncs required model exports and MediaPipe. `npm run build:rabbit3d` rebuilds GLB; `npm run build:berry-art` rebuilds berry art (Blender required). Preserve original Blender sources.

Browser suites: `qa:rabbit3d`, `qa:mocap`, `qa:mocap-engine`, `qa:berry`, `qa:berry-camera`. Set `QA_URL` explicitly and `QA_OUTPUT` to an absolute temporary directory. Existing scripts use installed Chrome/Playwright; most default to 5173 while Berry defaults to 5175. Check script defaults. Never accept Xcode licenses on the user's behalf.

## Open work / next ideas (not authorization)

1. Human webcam trials, especially comfortable small leg extensions, varied camera height/distance, occlusion and elderly usability; record failures without storing personal video by default.
2. Verify Safari/Firefox, TV/laptop and target Mini-PC performance. Current historical QA primarily Chrome with keyboard/synthetic input.
3. Decide with user whether Carrot 3D preview should become full gameplay; do not silently replace stable Sprite path.
4. Complete third-party attribution/license audit before external redistribution; optimize duplicate source/runtime assets only with a reproducible clean-clone workflow.
5. Consider CI for typecheck/tests/build and browser smoke checks. Currently no verified CI/deployment pipeline.
6. Reconcile historical Task 4A/4B docs with latest behavior, and remove unused legacy calibration code only in a separately scoped, tested cleanup.
7. Further visual polish and future minigames require explicit user authorization.

## Active work

None after the handoff-maintenance commit. Next agent must add its task here before editing.

## Verification and handoff history

- 2026-10-25 (historical): Berry visual v2; 155 tests and browser keyboard six-hit flow reported passing; no human webcam validation. See `docs/berry-kick-game.md`.
- 2026-10-31: Repository-wide source/docs/assets audit; established this agreement, expanded .gitignore, added software/art noncommercial licensing and README pointers. Identified untracked required `model/dist` exports hidden by broad `dist/` ignore; include current exports so clean clones can run asset sync. No gameplay changes. Current validation recorded below after checks. Git synchronization is verified by upstream status rather than assumed from this history.

Current maintenance validation (2026-10-31): typecheck PASS; 155/155 tests PASS; production build PASS. No runtime code changed, so browser suites were not rerun in this documentation/licensing task. Required export directories are included in this commit; runtime/source asset sync is checked separately.
