import { ConfigError, loadConfig } from "./config.ts";
import { Discovery } from "./discovery.ts";
import { buildServer, HOST } from "./server.ts";
import { Store } from "./store.ts";
import { ensureToken, tokenPath } from "./token.ts";

async function main() {
  const config = await loadConfig();
  const token = await ensureToken();
  const store = new Store();
  const discovery = new Discovery({ repoPath: config.repoPath, store });
  await discovery.start();

  const app = await buildServer({ config, store, discovery, token });
  await app.listen({ host: HOST, port: config.port });

  const n = Object.keys(store.state.fronts).length;
  console.log(`worktree-wars daemon on ws://${HOST}:${config.port}/ws`);
  console.log(`repo ${config.repoPath}: ${n} worktree${n === 1 ? "" : "s"}`);
  console.log(`token in ${tokenPath()}`);

  const shutdown = async () => {
    discovery.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
