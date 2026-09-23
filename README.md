# Worktree Wars

A local 3D strategy game that doubles as a control room for Claude Code agents.
Each git worktree of a target repo is an island, and each agent session is a unit.
See `docs/SPEC.md` for the v1 spec and `docs/log.md` for milestone progress.

## Quick start

Requires Node 20+ and pnpm.

```sh
pnpm install
cp worktree-wars.config.example.json worktree-wars.config.json   # set repoPath
pnpm dev        # daemon on 127.0.0.1:4477, client on http://127.0.0.1:5173
```

The daemon creates its handshake token in `~/.worktree-wars/token` on first run. The
Vite dev server passes it to the page. Set `WW_CONFIG` or `WW_HOME` to point at a
different config file or state directory.

## Checks

```sh
pnpm test       # Vitest (shared + daemon, including real-git integration tests)
pnpm typecheck
pnpm lint
```
