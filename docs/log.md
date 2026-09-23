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

## Milestone 6: Shipping (2026-09-23)

**What works**

- `tests.run` runs the configured `testCommand` (an argument array) in the
  worktree, with a 15-minute timeout. Pass/fail counts are parsed from vitest,
  jest, pytest, mocha and node:test summaries. A non-zero exit with no summary
  counts as one failure. The front goes `running`, then `passed` or `failed`,
  and results are saved to SQLite so bunkers survive a daemon restart.
- `pr.open` is refused while tests fail ("A failing-test bunker blocks the
  road") or are still running. Otherwise it runs `git push -u origin <branch>`
  then `gh pr create --fill --head <branch>`, emits `pr.opened`, and raises the
  gold flag. Units reach the flag. If a PR already exists for the branch, it's
  adopted.
- `pr.merge` runs `gh pr merge <n> --squash` and emits `pr.merged`. The flag
  turns team colour and the chip says "Won".
- PR state is polled every 30 s (and on start) with
  `gh pr view <branch> --json number,state,url`. Network or auth errors keep
  the last known state. If `gh` isn't installed, polling turns itself off once.
- UI: Run tests, Open PR (disabled behind a bunker) and Merge PR buttons in the
  panel, a Merge PR button in the bubble, test status and counts in the panel
  header (the output tail shows on hover), "testing…" in the top bar, and toasts
  for test results, a newly open PR and a won front.

**Demo (acceptance)**

The scratch repo got a local bare `origin`. A small fake `gh` script on the
daemon's PATH stood in for GitHub, since this sandbox has no `gh`. The test
command failed whenever a `FAIL` file existed in the worktree.

- With `FAIL` present, Run tests gave "3 passed, 1 failed. Bunker on
  fix/assignment-grading". The bunker rose on the road and Open PR was disabled.
- After removing `FAIL`, Run tests gave "4 passed, 0 failed. Road clear" and
  the bunker sank.
- Open PR pushed `fix/assignment-grading` to origin and opened PR #101. The flag
  turned gold and Scout 2 drove up to it.
- Merge PR from the bubble gave "Front won". The flag took the team colour and
  the chip read "Won".
- After a daemon restart, feat/tiptap-comments still showed its failing
  bunker (restored from SQLite), and polling found an external PR #7 on it.

## Beyond v1: pick repos in the app (2026-09-23)

The spec had one repo, set by `repoPath` in a config file. Now you pick repos
inside Wars, and several can be monitored at once.

- A Repos sheet, opened from the top bar or automatically on an empty first
  run. It suggests main worktrees found up to two levels below `~/Repos`,
  `~/code`, `~/src`, `~/Projects` and similar folders (or `scanDirs`), and
  accepts any typed path. A path inside a repo or one of its worktrees resolves
  to the main worktree.
- Monitored repos are stored in SQLite, and each gets its own worktree watcher.
  Removing a repo stops watching it and never touches files on disk.
- Test commands are detected per repo and editable in the sheet. The config
  `testCommand` is only a fallback.
- Islands are grouped into one row per repo (stacked in portrait). Labels and
  chips read `repo · branch` once more than one repo is monitored. New fronts
  pick their repo in the panel.
- The config file is optional. A legacy `repoPath` is added as a monitored repo,
  and the example placeholder is ignored.
- Protocol: `repo.upserted`/`repo.removed` events and a `repo.suggestions`
  reply; `repo.add`/`repo.remove`/`repo.update`/`repo.suggest` commands.
  `front.create` takes a `repoId`, and fronts carry `repoId`.

Demo: from empty state the sheet opened and suggested both scratch repos. Clicking
one added it with 4 islands. Typing a path inside the second repo's worktree added
that repo, with `npm test` detected. A new front in the second repo was created from
the panel. Both repos survived a daemon restart, and removing one took its islands off
the map while its worktrees stayed on disk.

## Island age and scattered archipelagos (2026-09-23)

- The daemon reads each worktree's creation time from git's admin folder
  (`.git/worktrees/<name>`: its birth time, or the `gitdir` file git writes once
  at creation). It's sent as `Front.createdAt` and looked up once per worktree.
- Age drives how the island looks, in tenths so geometry rebuilds only when the
  look visibly changes:
  - Growth, full at about two months: from about 12 to 60 trees, trees up to
    40% bigger, bushes creeping along the road, and grass taking over the road
    from the edges in.
  - Rubbish, starting after two days and full at about three months: up to 32
    crates, barrels, tyres, planks and bottles, tipped over on the beach or
    bobbing offshore (static with reduced motion).
  - Trees and junk are placed in a fixed seeded sequence, so an island gains
    them as it ages instead of reshuffling.
  - The panel shows "new", "5 h old", "12 d old" or "4 mo old", and chips
    show it on hover.
- Scattered layout: each repo is a loose archipelago. Islands take the first
  free spot on rings around the cluster, starting from a seeded angle, and get
  a seeded yaw of ±30°. Islands of the same repo are at least 31 apart, islands
  of different repos at least 45. Ordering is oldest first, so a new worktree
  never moves existing islands. Landscape stretches the map wider, portrait
  taller.
- Island labels hide when they'd overlap one already drawn (the selected
  island's label wins).
- Fix: the Repos sheet no longer auto-opens before the first snapshot has
  arrived.

Demo: nine islands across two repos, with ages from new to 120 days injected
through the WebSocket (the sandbox filesystem records real birth times). The
120-day island is dense and littered, with its road half grown over. The new one
is sparse and clean. Layout checks over 840 random configurations kept the
spacing guarantees and stable positions.

## Clickable toasts (2026-09-23)

- Toasts about a front (test results, a PR you opened, a won front) name the
  front, and clicking one selects it and flies the camera there. PR toasts add
  a "View PR ↗" link. Actionable toasts stay for 7 s, pause while hovered, and
  have a close button.
- PR polling no longer announces PRs it merely finds (existing ones at
  startup, ones opened elsewhere). Those update the flag quietly. Only a merge
  of a PR we saw open is announced.

## Delete a worktree (2026-09-23)

- "Delete worktree" on an island's panel opens a confirm dialog. It lists what
  happens (the folder is removed, commits on the branch are kept, units are
  stopped and forgotten, an open PR stays open).
- The daemon runs `git worktree remove`. If git refuses because of
  uncommitted or untracked files (or a unit is still working), the dialog
  explains and offers "Delete anyway" (`--force`). Locked worktrees are
  explained, not forced.
- Optional "Also delete branch" uses `git branch -d`, so an unmerged branch is
  kept and the toast says why.
- New `front.delete` command, a `front.deleted` reply, and `code`/`frontId` on
  error events. Units and saved test results for the front are removed from
  SQLite.

## Units fight: manoeuvres and enemy troops (2026-09-23)

- Working units manoeuvre around their progress point, shifting along and
  across the road every one to three seconds. They turn to face the nearest
  enemy and return to formation when idle.
  - Squad soldiers shuffle and duck on their own.
  - The scout's wheels spin.
  - Units never slip past a failing-test bunker.
- Enemy troops are grey uniforms with red helmets. They appear only while a unit
  on the island is working: 1 + 2 per working unit (plus 2 behind a bunker),
  at most 8.
  - They walk in from the flag side to posts well ahead of the lead unit (or
    around the bunker), strafe, face the nearest unit and fire red tracers.
  - Each `unit.tool` event fires an aimed shot. The nearest enemy topples when
    it lands, lies there, then sinks. Reinforcements keep coming.
  - When work stops, survivors retreat toward the flag and sink away.
- Red was removed from the team palette so friend and foe never share a colour.
- Reduced motion: no manoeuvres, tracers or retreat animation. Enemies appear
  at their posts and vanish instead of falling.
- The battlefield is a per-island `Battle` object outside React. Units and
  enemies publish positions to it each frame and pick targets from it.

## Pathfinding: nobody fights from the water (2026-09-23)

- Each island has a walkable grid (0.5-unit cells): land above the waterline,
  minus trees, rocks and the HQ tent, plus the bunker as a dynamic blocker
  while it stands (`world/nav.ts`).
- A* on the 8-connected grid with no corner cutting, smoothed by line of sight.
  Targets in the water snap to the nearest land.
- Units and enemies are path-following agents (`Mover`) with their own speeds
  (scout 2.6, tank 1.7, squad 1.5, enemy 1.4). They face the way they walk, and
  face and fire at their target when standing.
  - Units: home is their progress point on the road. New units march there
    from HQ. While working they move between reachable spots near home, keeping
    3.5 away from enemies and never passing a standing bunker.
  - Enemies: come ashore at the flag end, or somewhere at least 8 from every
    unit. They walk to cover 5–10 away from the lead unit on land (ahead up
    the road when possible, or around the bunker), shift between nearby spots,
    and walk back home to retreat.
  - A separation pass keeps agents from overlapping without pushing anyone off
    land.
- Client unit tests for the nav grid (lake detour, obstacles, dynamic blockers,
  snapping, mover, separation). The client is now a Vitest project.
- Measured in the browser via a dev-only hook: 40 samples over 20 s with three
  units near the flag and up to three enemies. No agent was ever off land, and
  the closest enemy stayed 7.8 away.

## Auto permissions, PR link, camera, spacing, links (2026-09-23)

- **Auto mode by default.** Every unit runs with the SDK's `permissionMode:
  "auto"`: Claude Code's classifier approves safe actions itself and only
  escalates the rest to the permission queue (Allow/Deny as before).
  - Existing units migrate to auto.
  - The panel has an Auto/Ask switch per unit.
  - `permissionMode` in the config sets the default; "bypassPermissions" is
    not allowed.
  - Verified with real sessions: Sonnet and Opus report `auto` and wrote a file
    without asking.
  - Haiku reports `default` (auto isn't available for it), so the unit records
    `activePermissionMode` and the panel says it asks instead.
- **Open the PR from the island.** A selected island with a PR shows
  "Open PR #n ↗" (or Merged/Closed) in the panel.
- **Camera never zooms out on island clicks.**
  - It moves only on explicit requests.
  - Picking another island (chip, label, click, toast or unit) pans there and
    zooms in only if needed.
  - Clicking the already selected island or the water leaves the camera alone.
  - Only All fronts zooms out.
  - Drags no longer count as clicks.
  - Measured: zoomed to 12, the distance stayed 12 after clicking the same
    island, its label and another island.
- **Closer islands.** Same repo at least 27 apart, other repos 36, less slack
  and stretch.
- **No vehicle overlap.** Separation uses body radii (tank 1.4, scout 1.0,
  squad 0.9, enemy 0.45), and units pick distinct formation spots when
  their road slots snap to the same patch of land. Measured three units
  parked at the flag: all pairs at or beyond their combined radii.
- **Links in bubbles.** Bare http(s) URLs and markdown links open in a new
  tab. Other schemes are never linked, and trailing punctuation stays
  outside the link.

## Distinct island shapes (2026-09-23)

- Every island gets its own seeded character (`IslandShape(seed)`):
  - Size (base radius 7.2–9.8) and aspect (1.05–1.65).
  - A crescent or banana bend.
  - Three coastline lobes with random counts (2–4, 5–7, 8–11) and strengths.
  - 0–2 bays cut in and 0–2 peninsulas pushed out.
  - Sometimes 1–2 islets offshore.
  - Terrain style: flat, rolling or peak (a rocky mountain away from the road).
  - Its own pine/round tree mix and density; peak islands get more rocks.
- The road follows the land's centreline: it starts at the widest slice of land
  and walks north and south through connected land, with a control point every
  1.5 units. It winds only as far as the land on each side allows, and a damping
  pass keeps the curve off the coast.
- The terrain square grew to 32×40, and shapes are scaled to fit it.
- The layout uses each island's real size (`extent`), so small islands sit
  closer and big ones get room. Land never overlaps.
- Tests over 300 seeds: every road stays on land, HQ and flag on solid ground,
  every island inside its square, a spread of sizes and areas (over 1.6×) and
  all three terrain styles.

## Agent terminals beside the island (2026-09-23)

- Selecting an island opens a column on the left with a terminal for every
  agent on it, and frames the island in the space to the right (the bottom
  panel moves over too). On screens narrower than 900 px, a Terminal button
  opens the selected agent's terminal as a sheet.
- Each terminal shows:
  - Header: status, model and permission mode.
  - Full transcript: `› orders`, the agent's replies (streamed, with links and
    code), `⏺ tool calls`, permission prompts and your decisions, errors, and a
    result line per turn (`Done · 8s · $0.02 · 1 file changed`).
  - An inline Allow/Deny prompt while it's waiting.
  - A prompt line to send orders (they queue while it works) with ↑/↓ history.
  - It follows new output unless you scroll up. A terminal that needs you, or
    the one you picked, scrolls into view.
- Daemon: `UnitLog` records transcripts in SQLite (`unit_log`, latest 1000 per
  unit) and broadcasts each new line as `unit.entry`. Assistant lines grow from
  the `unit.text` deltas clients already get. Clients fetch history with
  `unit.history`, so reloads and reconnects lose nothing.
- Verified with real sessions: Sonnet (Auto) wrote a file and ran `ls` with
  no prompts. Haiku asked inline, Allow went through, and the transcripts were
  intact after a reload.
