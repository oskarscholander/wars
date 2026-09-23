const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One readable line for a tool call, shown in bubbles and permission prompts. Paths inside `cwd` are shown relative. */
export function summarizeTool(tool: string, input: Record<string, unknown>, cwd?: string): string {
  const rel = (p: string) => (cwd && p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  switch (tool) {
    case "Bash":
      return clip(str("command") ?? "");
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return rel(str("file_path") ?? str("notebook_path") ?? tool);
    case "Glob":
    case "Grep":
      return clip(`${str("pattern") ?? ""}${str("path") ? ` in ${rel(str("path")!)}` : ""}`);
    case "WebFetch":
      return str("url") ?? tool;
    case "WebSearch":
      return str("query") ?? tool;
    case "Task":
    case "Agent":
      return clip(str("description") ?? str("prompt") ?? tool);
    default: {
      const json = JSON.stringify(input);
      return clip(json === "{}" ? tool : json);
    }
  }
}
