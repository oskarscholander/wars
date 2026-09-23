# Worktree Wars

A local 3D strategy game that is also a control room for Claude Code agents.
Each git worktree of a target repo is an island at war. Each agent session running
in that worktree is a unit (Opus = tank, Sonnet = infantry squad, Haiku = scout).
You give orders through a speech-bubble radio; the unit answers in a bubble above it.

Read `docs/SPEC.md` before starting any task. The visual and interaction reference
is `docs/prototype/worktree-wars.html` (a single-file three.js prototype with mock
data). Match its look and behavior; do not copy its code structure.

## Architecture

pnpm monorepo, TypeScript everywhere, Node 20+.

- `packages/shared`: the typed event protocol (`ServerEvent`, `ClientCommand`) and
  domain types (`Front`, `Unit`, `PermissionRequest`, `DiffFile`). Both apps import
  from here. Any protocol change starts here.
- `apps/daemon`: Fastify + `ws`. Owns all real state and all side effects:
  worktree discovery, Claude Agent SDK sessions, permission queue, git, tests, `gh`.
  Persists session IDs and unit metadata in SQLite (`better-sqlite3`).
- `apps/client`: Vite + React + React Three Fiber + drei + Zustand. Renders state
  from the daemon. Holds no authoritative state: reloading the page must lose nothing.

## Rules

- The daemon is the single source of truth. The client sends commands and renders
  events; it never infers state on its own.
- Bind the daemon to `127.0.0.1` only. Require a token (generated on first run,
  stored in `~/.worktree-wars/token`) on the WebSocket handshake.
- Never run shell commands built from unescaped user input. Use `execa` with
  argument arrays.
- Auth: do not read or set `ANTHROPIC_API_KEY` by default. The SDK uses the user's
  `claude login`. Support an optional `ANTHROPIC_API_KEY` passthrough via config.
- Verify Claude Agent SDK APIs against the installed package's type definitions
  (`@anthropic-ai/claude-agent-sdk`) rather than assuming. Key pieces: `query()`
  with `cwd`, `resume`, `model`, and a `canUseTool` permission callback.
- Every permission request from any worktree goes through one queue in the daemon
  and pauses that session until the client answers Allow or Deny.
- Keep 3D code in `apps/client/src/world/`, HTML UI (bubbles, radio, report sheet)
  in `apps/client/src/hud/`. Speech bubbles and markers are HTML overlays projected
  from 3D positions, not 3D text.
- Respect `prefers-reduced-motion` in all animation.
- Write tests for the daemon's pure logic (worktree parsing, event mapping,
  permission queue) with Vitest. The 3D world does not need unit tests.

## Commands

- `pnpm dev`: daemon and client together
- `pnpm test`: Vitest across packages
- `pnpm typecheck`, `pnpm lint`

## Config

Repos to monitor are picked in the app (Repos sheet) and stored in SQLite; several
can be monitored at once. `worktree-wars.config.json` in the repo root is optional
(gitignored, with a committed `.example`): `defaultModel`, `port`, `scanDirs` (where
repo suggestions come from), `testCommand` (fallback when detection finds nothing),
`anthropicApiKey`, and a legacy `repoPath` that is added as a monitored repo on start.
