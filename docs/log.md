# Build log

## Milestone 1: Plumbing (2026-09-23)

**What works**

- pnpm monorepo: `packages/shared` (protocol, domain types, reducer, progress
  heuristic), `apps/daemon` (Fastify + ws), `apps/client` (Vite + React + R3F).
- The daemon polls `git worktree list --porcelain` every 5 s and watches the git
  common dir plus `worktrees/` for immediate refreshes. The main worktree and bare
  entries are excluded. Front ids are a hash of the worktree path.
- `front.create {branch}` validates the name with `git check-ref-format`, then runs
  `git worktree add -b <branch> -- ../<repo>-<slug>` (or checks out the branch if it
  already exists).
- WebSocket on `127.0.0.1` only. The handshake needs the token from
  `~/.worktree-wars/token` (created on first run, mode 0600) and a local Host and
  Origin. The client gets port and token from a dev-only Vite endpoint
  (`/ww-connect.json`) that reads the same files.
- On connect the daemon sends `state.snapshot`, then incremental events. The daemon
  runs its own state through the shared reducer before broadcasting, so snapshot
  plus events always equals daemon state. The client reconnects with backoff.
- Client: one placeholder island per worktree (coastline, beach and flag seeded
  from the branch name), laid out side by side on landscape and stacked on portrait.
  It also has a top bar with one chip per front, click-to-focus camera framing, branch
  labels as projected HTML overlays, and a panel for opening a new front.

**Demo (acceptance)**

With the daemon and client running against a scratch repo that had two worktrees,
`git worktree add -b ai/feedback-summary ../target-ai-feedback-summary` run from a
shell showed up as a new island and chip in about 0.3 to 0.5 s. That's under the 5 s
target. Creating `feat/mention-popover` from the panel worked too, and an invalid name
(`bad..name`) came back as an error toast. Reloading the page kept every front.

**Notes for later milestones**

- The full protocol (units, permissions, diffs, tests, PRs) is already typed in
  `packages/shared`. Commands the daemon can't handle yet return an `error` event
  that names their milestone.
- `hud/FrontLabels` + `world/OverlayProjector` is the projection layer that
  bubbles and "Needs you" markers will reuse. drei `<Html>` was dropped because
  it creates a React root per label and raced on unmount under React 19.
- Agent SDK and SQLite are not installed yet. They arrive with milestone 2.

## Milestones 2 and 3: Talking and Permissions (2026-09-23)

**What works**

- Deploy a unit on a selected island: pick Opus (tank), Sonnet (squad) or Haiku
  (scout), name it or take the default, and it marches onto the road and gets
  selected. Units are stored in SQLite (`~/.worktree-wars/state.sqlite`).
- Orders run through `query()` from `@anthropic-ai/claude-agent-sdk` with `cwd`
  set to the worktree, the unit's model, `includePartialMessages`, and the
  `claude_code` system-prompt preset plus a short note about the speech bubble.
  The session id from the init message is stored, and later orders pass
  `resume`. If a stored session can't be found, the unit starts fresh once.
- Streamed text arrives as `unit.text`, tool calls as `unit.tool`, status as
  `unit.status`. On each result the daemon records turns, tokens (including
  cache), cost, and changed files since the branch forked from main.
- One query per unit at a time. Orders sent while it works are queued, and the
  panel shows how many.
- Every `canUseTool` call goes through a single `PermissionQueue`. Read, Glob
  and Grep are auto-allowed. Everything else emits `permission.request`, sets the
  unit to `waiting` (red beacon), and waits for Allow or Deny from the bubble. An
  aborted query denies whatever is still pending.
- "Needs you" markers float over every waiting unit and stick to the screen
  edge when that unit is out of view. The top-bar chips count them per front and
  in total. The panel also lists each front's units as buttons, so you can reach
  them without clicking in 3D.

**Demo (acceptance, real Claude with Haiku)**

- Multi-turn: "Pick a random two-digit number" gave "47", and "What number did
  you just give me?" gave "I gave you 47."
- Resume: I killed and restarted the daemon. The page reconnected, the bubble
  still showed the last reply, and "Which number was it?" answered "The number
  was 47." through `resume`.
- Permissions: I asked Scout 1 (feat/tiptap-comments) and Scout 2
  (fix/assignment-grading) to write a file. Both went `waiting` at the same time
  ("2 need you", one per island). I allowed Scout 2 and denied Scout 1. Only
  the grading worktree got `NOTE.txt`, and the top bar went back to "All quiet".

## Milestone 4: Review (2026-09-23)

**What works**

- The daemon diffs each worktree against the commit where its branch left main.
  That covers committed, staged and unstaged work. Untracked files are diffed
  against `/dev/null` one by one, so the index is never touched. `--numstat`
  supplies the counts, the patch is parsed into hunks with old and new line
  numbers, and very large files are truncated to 1500 lines while keeping their
  full counts.
- The diff is published as `diff.updated` after every unit turn (which also
  sets the unit's files-changed count) and on `diff.request`.
- Field report sheet: "Open report" appears in the bubble when there are
  unreviewed changes, and "Field report" is always in the quick orders. Tapping
  a line closes the sheet and fills the radio with `On <file>:<line>: ` with
  focus in the input. "Request changes" prefills `Please change: `. "Approve"
  hides "Open report" until the diff changes. Escape closes the sheet and
  returns focus.

**Demo (acceptance, real Claude)**

In Scout 2's report, `NOTE.txt` showed `+hi`. I tapped the line and the radio
read `On NOTE.txt:1: `. I added "replace hi with hello", Scout 2 asked to Edit
`NOTE.txt`, I allowed it, and it replied "Done.". The report then showed
`+hello` and the file on disk said `hello`.

## Milestone 5: The world (2026-09-23)

**What works**

- Islands are ported from the prototype as pure functions in
  `world/terrain.ts`: an irregular coastline, a noise height field with hills
  that flatten along the road, and vertex colours for wet sand, beach, road,
  shaded grass and rock tops. Off the coast the floor drops below the seabed, so
  the square terrain edge never shows through the water and a soft sandy shelf
  is left instead. Everything is seeded from the branch name, so an island
  looks the same on every reload.
- Trees (pines and round), rocks, the HQ tent, the objective flag (red, gold
  once a PR is open, team colour once merged, cloth waving) and the bunker. The
  bunker stands on the road while tests fail and sinks and greys out, with a
  puff, when they pass.
- Units follow the terrain along the Catmull-Rom road, face the flag and march
  in from HQ. While working they bob and show a yellow beacon. Waiting units show
  a red beacon. Each tool call fires a volley of tracers ahead, or at the bunker
  when they're pinned in front of it, and each tracer ends in a puff of smoke.
- The camera frames all islands, an island you tap, or a unit's island, and
  keeps your orbit angle. Drag orbits, and wheel or pinch zooms.
- Reduced motion: no tracers, bobbing, pulsing or waving, the camera and units
  snap, and the bunker disappears instead of sinking.

**Demo**

Screenshots at 1280×800 and 390×844 compared against the prototype: organic
islands with roads, trees and rocks side by side (stacked on portrait). A working
Haiku scout showed its yellow beacon and tracer smoke. With emulated
`prefers-reduced-motion` the page rendered with no errors.
