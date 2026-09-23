import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/**
 * Dev-only endpoint that hands the page the daemon's port and handshake token,
 * read from the same files the daemon uses. Vite binds to localhost only.
 */
function daemonConnect(): Plugin {
  return {
    name: "ww-daemon-connect",
    configureServer(server) {
      server.middlewares.use("/ww-connect.json", (_req, res) => {
        try {
          const configPath = process.env.WW_CONFIG ?? join(REPO_ROOT, "worktree-wars.config.json");
          const port = (JSON.parse(readFileSync(configPath, "utf8")) as { port?: number }).port ?? 4477;
          const home = process.env.WW_HOME ?? join(homedir(), ".worktree-wars");
          const token = readFileSync(join(home, "token"), "utf8").trim();
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify({ port, token }));
        } catch {
          res.statusCode = 503;
          res.end("daemon not initialised");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), daemonConnect()],
  server: { host: "127.0.0.1", port: 5173 },
});
