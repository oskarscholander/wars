import { query } from "@anthropic-ai/claude-agent-sdk";
import { checkRepo, ConfigError, loadConfig } from "./config.ts";
import { Db } from "./db.ts";
import { Diffs } from "./diffs.ts";
import { Shipping } from "./shipping/shipping.ts";
import { Discovery } from "./discovery.ts";
import { buildServer, HOST } from "./server.ts";
import { Store } from "./store.ts";
import { ensureToken, tokenPath } from "./token.ts";
import { UnitManager } from "./units/manager.ts";
import { PermissionQueue } from "./units/permissions.ts";

async function main() {
  const config = await loadConfig();
  await checkRepo(config);
  const token = await ensureToken();
  const store = new Store();
  const discovery = new Discovery({ repoPath: config.repoPath, store });
  await discovery.start();

  const db = new Db();
  const permissions = new PermissionQueue(store);
  const diffs = new Diffs(store, config.repoPath);
  const units = new UnitManager({
    store,
    db,
    permissions,
    queryFn: query,
    // Refreshing the diff after each turn also gives the unit its files-changed count.
    changedFiles: async (front) => (await diffs.refresh(front.id)).length,
    ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
    log: console.log,
  });

  const shipping = new Shipping({
    store,
    testCommand: config.testCommand,
    saveTests: (id, tests) => db.saveTests(id, tests),
    loadTests: (id) => db.loadTests(id),
  });
  void shipping.pollAll();
  const prPoll = setInterval(() => void shipping.pollAll(), 30_000);

  const app = await buildServer({ config, store, discovery, units, permissions, diffs, shipping, token });
  await app.listen({ host: HOST, port: config.port });

  const n = Object.keys(store.state.fronts).length;
  console.log(`worktree-wars daemon on ws://${HOST}:${config.port}/ws`);
  console.log(`repo ${config.repoPath}: ${n} worktree${n === 1 ? "" : "s"}`);
  console.log(`token in ${tokenPath()}`);

  const shutdown = async () => {
    discovery.stop();
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
