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
