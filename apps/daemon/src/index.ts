import { query } from "@anthropic-ai/claude-agent-sdk";
import { ConfigError, loadConfig } from "./config.ts";
import { Db } from "./db.ts";
import { Diffs } from "./diffs.ts";
import { Shipping } from "./shipping/shipping.ts";
import { RepoManager } from "./repos.ts";
import { expandHome } from "./git/repos.ts";
import { buildServer, HOST } from "./server.ts";
import { Store } from "./store.ts";
import { ensureToken, tokenPath } from "./token.ts";
import { UnitManager } from "./units/manager.ts";
import { PermissionQueue } from "./units/permissions.ts";
import { UnitLog } from "./units/log.ts";

async function main() {
  const config = await loadConfig();
  const token = await ensureToken();
  const store = new Store();
  const db = new Db();
  const repos = new RepoManager({
    store,
    db,
    ...(config.testCommand ? { defaultTestCommand: config.testCommand } : {}),
    ...(config.scanDirs ? { scanRoots: config.scanDirs.map(expandHome) } : {}),
    log: console.log,
  });
  const permissions = new PermissionQueue(store);
  const diffs = new Diffs(store);
  const transcript = new UnitLog(store, db);
  const units = new UnitManager({
    store,
    db,
    permissions,
    queryFn: query,
    // Refreshing the diff after each turn also gives the unit its files-changed count.
    changedFiles: async (front) => (await diffs.refresh(front.id)).length,
    ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
    defaultPermissionMode: config.permissionMode,
    transcript,
    log: console.log,
  });

  // Units and shipping subscribe to the store, so restore repos after they exist.
  await repos.start();
  if (config.repoPath) {
    await repos.add(config.repoPath).catch((err) => console.log(`config repoPath skipped: ${err.message}`));
  }

  const shipping = new Shipping({
    store,
    saveTests: (id, tests) => db.saveTests(id, tests),
    loadTests: (id) => db.loadTests(id),
  });
  void shipping.pollAll();
  const prPoll = setInterval(() => void shipping.pollAll(), 30_000);

  const app = await buildServer({ config, store, repos, units, permissions, diffs, shipping, db, transcript, token });
  await app.listen({ host: HOST, port: config.port });

  const r = Object.keys(store.state.repos).length;
  const n = Object.keys(store.state.fronts).length;
  console.log(`worktree-wars daemon on ws://${HOST}:${config.port}/ws`);
  console.log(`monitoring ${r} repo${r === 1 ? "" : "s"} with ${n} worktree${n === 1 ? "" : "s"}; add repos in the app`);
  console.log(`token in ${tokenPath()}`);

  const shutdown = async () => {
    repos.stop();
    clearInterval(prPoll);
    units.stopAll();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? `worktree-wars: ${err.message}` : err);
  process.exit(1);
});
