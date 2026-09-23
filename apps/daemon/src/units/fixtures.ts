import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** Minimal SDK message shapes for tests. Only the fields the mapper reads. */
const m = (x: unknown) => x as SDKMessage;

export const init = (sessionId: string, permissionMode = "auto") =>
  m({ type: "system", subtype: "init", session_id: sessionId, permissionMode });
export const messageStart = (id: string) =>
  m({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } });
export const textStart = () =>
  m({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
export const textDelta = (text: string, parent: string | null = null) =>
  m({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
export const assistant = (id: string, content: unknown[], parent: string | null = null) =>
  m({ type: "assistant", parent_tool_use_id: parent, message: { id, content } });
export const result = (over: Record<string, unknown> = {}) =>
  m({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
    errors: [],
    ...over,
  });
