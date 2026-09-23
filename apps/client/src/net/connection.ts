import type { ServerEvent } from "@ww/shared";
import { setSender, useStore } from "../store.ts";

interface ConnectInfo {
  port: number;
  token: string;
}

async function fetchConnectInfo(): Promise<ConnectInfo> {
  const res = await fetch("/ww-connect.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`connect info ${res.status}`);
  return (await res.json()) as ConnectInfo;
}

/** Connects to the daemon and keeps reconnecting with backoff. Every (re)connect starts from a snapshot. */
export function startConnection(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { apply, setConnection } = useStore.getState();

  const schedule = () => {
    if (stopped) return;
    setConnection("offline");
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    timer = setTimeout(connect, delay);
  };

  const connect = async () => {
    setConnection("connecting");
    let info: ConnectInfo;
    try {
      info = await fetchConnectInfo();
    } catch {
      return schedule();
    }
    if (stopped) return;
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${encodeURIComponent(info.token)}`);
    ws = socket;
    socket.onopen = () => {
      retry = 0;
      setConnection("open");
    };
    socket.onmessage = (m) => {
      try {
        apply(JSON.parse(String(m.data)) as ServerEvent);
      } catch (err) {
        console.error("bad daemon message", err);
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      schedule();
    };
  };

  setSender((cmd) => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(cmd));
    return true;
  });
  void connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    setSender(null);
    ws?.close();
  };
}
