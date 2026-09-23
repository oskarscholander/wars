# Worktree Wars v1 spec

## Goal

Play one real repo with real agents: see every worktree as an island, talk to
agents, approve their tool use, review their diffs, run tests, open and merge PRs.

Out of scope for v1: explosions and weather, multiple repos, remote/phone access,
sound, imported 3D models.

## Game mapping

| Real thing | In the game |
| --- | --- |
| Git worktree | Island with a winding road from HQ (start) to a flag (main) |
| Claude Code session in that worktree | Unit on the road |
| Model | Unit type: Opus tank, Sonnet infantry squad, Haiku scout |
| Session progress | Distance along the road (see "Progress" below) |
| Session working | Yellow beacon, unit bobs and fires tracers ahead |
| Permission request pending | Red beacon, "Needs you" marker visible from any view |
| Failing tests in the worktree | Bunker on the road; units cannot pass it |
| Tests pass | Bunker sinks; road clear |
| PR open | Flag turns gold |
| PR merged | Flag turns team color; island is won |

Progress v1 heuristic: `min(0.95, filesChanged * 0.08 + turns * 0.03)`, capped just
before the bunker while tests fail, and set to 1 when a PR is open. Keep it in one
function so it's easy to tune.

## Daemon

### Worktree discovery
- On start and every 5 s, run `git -C <repoPath> worktree list --porcelain` and parse
  it into fronts (path, branch, HEAD). The main worktree is excluded from islands.
- Watch `<repoPath>/.git/worktrees/` for changes to refresh immediately.
- Command `front.create {branch}` runs `git worktree add ../<repo>-<slug> -b <branch>`.

### Sessions
- `unit.create {frontId, model, name}` creates a unit record. The first order starts
  a session with `query({ prompt, options: { cwd: worktreePath, model, canUseTool } })`.
- Capture the session ID from the SDK's init message and store it. Later orders use
  `resume: sessionId`.
- Stream assistant text as `unit.text` deltas, tool calls as `unit.tool` (these drive
  the firing animation), and status changes as `unit.status`.
- On the result message, record token usage/cost onto the unit.
- One active query per unit; orders sent while working are queued.

### Permissions
- `canUseTool` creates a `PermissionRequest {id, unitId, tool, input, summary}`,
  emits `permission.request`, sets the unit to `waiting`, and awaits the client's
  `permission.resolve {id, allow, message?}`.
- Read-only tools (Read, Glob, Grep) are auto-allowed. Everything else asks.

### Diffs and review
- After each result and on `diff.request {frontId}`, run `git diff --numstat` and
  `git diff` in the worktree; emit `diff.updated` with parsed files and hunks.
- Review comments come from the client as normal orders, prefixed with
  `On <file>:<line>:`. No special handling beyond that.

### Tests and PRs
- `tests.run {frontId}` runs `testCommand` in the worktree, emits `tests.result
  {passed, failed, outputTail}`, and updates the bunker state.
- `pr.open {frontId}`: `git push -u origin <branch>` then `gh pr create --fill`;
  emit `pr.opened {number, url}`. Blocked while tests fail.
- `pr.merge {frontId}`: `gh pr merge --squash`; emit `pr.merged`.
- PR state is also polled with `gh pr view --json number,state,url` every 30 s.

### Protocol
All messages are JSON `{type, ...payload}` defined in `packages/shared`. On connect,
the daemon sends a full `state.snapshot`; after that, incremental events. The client
applies events with a reducer, so snapshot + events always equals daemon state.

## Client

- World: port the prototype's islands (noise terrain with irregular coastline,
  vertex-colored beaches, grass, rock), winding road (Catmull-Rom curve), trees,
  rocks, HQ tent, bunker, flag, water. Seed terrain from the branch name so each
  island is stable across reloads.
- Units follow the road with terrain height and face their direction of travel.
- Camera: overview of all islands, tap an island to focus, tap a unit to select.
  Drag to orbit, pinch or wheel to zoom. Use drei `CameraControls`.
- Layout: islands side by side on landscape, stacked on portrait.
- HUD: top bar with one chip per front (status, needs-you count), bottom radio panel
  with the selected unit's stats, quick order chips, and the prompt input. Unit
  replies stream into a speech bubble anchored above the unit, with Allow/Deny,
  Open report and Merge actions inside it.
- Report sheet: diff viewer; tapping a line fills the prompt with `On file:line: `.

## Milestones

Each milestone ends with working software and a short demo note in `docs/log.md`.

1. **Plumbing.** Monorepo, shared types, daemon lists worktrees, client shows one
   placeholder island per worktree. Accept: create a worktree in the target repo and
   an island appears within 5 s.
2. **Talking.** Deploy a unit, send an order, see streamed text in its bubble; resume
   works after daemon restart. Accept: a real multi-turn conversation in one worktree.
3. **Permissions.** Allow/Deny round trip; "Needs you" markers across islands.
   Accept: two units on different islands both waiting, both resolvable.
4. **Review.** Diff report with line comments sent back as orders.
5. **The world.** Full organic islands, unit models, beacons, tracers, bunker, flag,
   camera behavior, reduced motion. Accept: visually matches the prototype.
6. **Shipping.** Tests clear bunkers, open PR raises the gold flag, merge wins the
   island.

## Later (not v1)

Explosions with particles and bloom, debris physics, camera shake, sound, weather
tied to test status, idle soldier animations, flares on completion, construction
effects as code lands, glTF unit models.
