# Worktree Wars

A local 3D strategy game that doubles as a control room for Claude Code agents.
Each git worktree of a repo you monitor is an island, and each agent session is a unit.
See `docs/SPEC.md` for the v1 spec and `docs/log.md` for milestone progress.

## Quick start

Requires Node 20+, pnpm, and Claude Code logged in (`claude login`).

```sh
pnpm install
pnpm dev        # daemon on 127.0.0.1:4477, client on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. The **Repos** sheet opens on first run. Pick repos found in
`~/Repos`, `~/code`, `~/src`, `~/Projects` and similar folders, or type any repo's path.
Every linked worktree of a monitored repo becomes an island. Test commands are detected
per repo (pnpm/yarn/npm/bun, cargo, go, pytest, mix, rspec, make) and you can edit them
in the same sheet. Monitored repos are remembered in `~/.worktree-wars/state.sqlite`.

No config file is needed. To change defaults, create `worktree-wars.config.json` in
this folder:

```json
{
  "defaultModel": "sonnet",
  "port": 4477,
  "scanDirs": ["~/work", "~/oss"],
  "testCommand": ["make", "test"],
  "anthropicApiKey": "optional passthrough"
}
```

`scanDirs` sets where suggestions come from, and `testCommand` is the fallback when
nothing is detected.

Agents use your existing `claude login`. Opening and merging PRs needs a git remote
named `origin` and the GitHub CLI (`gh`) signed in. Without `gh`, everything else still
works and PR polling turns itself off.

The daemon creates its handshake token in `~/.worktree-wars/token` on first run. The
Vite dev server passes it to the page. Set `WW_CONFIG` or `WW_HOME` to point at a
different config file or state directory.

## Controls

- Drag to orbit, scroll or pinch to zoom. Hold **Space** and drag to pan.
- Click an island to focus it (its agents' terminals open on the left). Clicking
  islands never zooms out.
- Click the water or **All fronts** for the full view.

## Checks

```sh
pnpm test       # Vitest (shared + daemon, including real-git integration tests)
pnpm typecheck
pnpm lint
```
