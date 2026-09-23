import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { ServerEvent } from "@ww/shared";
import { parseClientCommand } from "./commands.ts";
import { CommandError, handleCommand, type Deps } from "./handlers.ts";
import { tokensMatch } from "./token.ts";

export const HOST = "127.0.0.1";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Guards against DNS rebinding and cross-site pages: only local Host and Origin values. */
export function isLocalRequest(host: string | undefined, origin: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, "");
  if (!LOCAL_HOSTNAMES.has(hostname)) return false;
  if (origin === undefined) return true;
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname) || LOCAL_HOSTNAMES.has(`[${new URL(origin).hostname}]`);
  } catch {
    return false;
  }
}

export async function buildServer(deps: Deps & { token: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });

  app.get("/health", async () => ({ ok: true }));

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const token = (req.query as Record<string, string | undefined>).token;
        if (!isLocalRequest(req.headers.host, req.headers.origin)) return reply.code(403).send();
        if (!tokensMatch(deps.token, token)) return reply.code(401).send();
      },
    },
    (socket: WebSocket) => {
      const send = (ev: ServerEvent) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
      };
      send({ type: "state.snapshot", state: deps.store.state });
      const unsubscribe = deps.store.subscribe(send);

      let alive = true;
      socket.on("pong", () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, 30_000);

      socket.on("message", async (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString());
        } catch {
          return send({ type: "error", message: "Malformed JSON" });
        }
        const cmd = parseClientCommand(raw);
        if (!cmd) return send({ type: "error", message: "Unknown or invalid command" });
        try {
          const reply = await handleCommand(cmd, deps);
          if (reply) send(reply);
        } catch (err) {
          const message = err instanceof CommandError ? err.message : "Internal error";
          if (!(err instanceof CommandError)) console.error(`command ${cmd.type} failed`, err);
          send({ type: "error", message, command: cmd.type });
        }
      });

      socket.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
    },
  );

  return app;
}
