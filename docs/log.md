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
