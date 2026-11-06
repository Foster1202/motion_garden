# Motion Garden — agent handoff and working agreement

Updated: 2026-11-06. This is the shared entry point for every agent/task working in this repository. Read it before changes; verify live code rather than treating historical notes as current evidence.

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

None. See the latest handoff below for completed work.

## Verification and handoff history

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
