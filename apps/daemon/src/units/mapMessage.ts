import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { summarizeTool } from "./summary.ts";

export type Effect =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; messageId: string; delta: string }
  | { kind: "tool"; tool: string; summary: string }
  | {
      kind: "result";
      ok: boolean;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      errorText: string | null;
    };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Turns the SDK's message stream for one query into the few things the game
 * cares about. Stateful only to join streamed text deltas to their message and
 * to avoid repeating text the stream already delivered.
 */
export class TurnMapper {
  constructor(private cwd?: string) {}

  #current: string | null = null;
  #currentHasText = false;
  #streamed = new Set<string>();

  map(msg: SDKMessage): Effect[] {
    switch (msg.type) {
      case "system":
        return msg.subtype === "init" ? [{ kind: "session", sessionId: msg.session_id }] : [];

      case "stream_event": {
        if (msg.parent_tool_use_id) return [];
        const ev = msg.event;
        if (ev.type === "message_start") {
          this.#current = ev.message.id;
          this.#currentHasText = false;
          return [];
        }
        if (!this.#current) return [];
        if (ev.type === "content_block_start" && ev.content_block.type === "text" && this.#currentHasText) {
          return [{ kind: "text", messageId: this.#current, delta: "\n\n" }];
        }
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          this.#currentHasText = true;
          this.#streamed.add(this.#current);
          return [{ kind: "text", messageId: this.#current, delta: ev.delta.text }];
        }
        return [];
      }

      case "assistant": {
        if (msg.parent_tool_use_id) return [];
        const out: Effect[] = [];
        const id = msg.message.id;
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text && !this.#streamed.has(id)) {
            out.push({ kind: "text", messageId: id, delta: block.text });
          } else if (block.type === "tool_use") {
            const input = (block.input ?? {}) as Record<string, unknown>;
            out.push({ kind: "tool", tool: block.name, summary: summarizeTool(block.name, input, this.cwd) });
          }
        }
        return out;
      }

      case "result": {
        const u = msg.usage as unknown as Record<string, unknown>;
        const ok = msg.subtype === "success" && !msg.is_error;
        const errorText = ok
          ? null
          : msg.subtype === "success"
            ? msg.result || "The turn ended with an error."
            : msg.errors.join("\n") || msg.subtype.replace(/_/g, " ");
        return [
          {
            kind: "result",
            ok,
            costUsd: num(msg.total_cost_usd),
            inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
            outputTokens: num(u.output_tokens),
            errorText,
          },
        ];
      }

      default:
        return [];
    }
  }
}
