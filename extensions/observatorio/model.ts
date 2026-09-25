import { relative, resolve } from "node:path";

export type Outcome = "running" | "success" | "error" | "unknown";
export interface Call {
  id: string;
  tool: string;
  target: string;
  file: boolean;
  outcome: Outcome;
  startedAt?: number;
  durationMs?: number;
}
export interface Star {
  key: string;
  label: string;
  file: boolean;
  calls: Call[];
  reads: number;
  changes: number;
  errors: number;
  running: number;
  /** Index in `calls` of the star's most recent call. */
  last: number;
}
export const MAX_CALLS = 1000;

// Never render terminal controls or retain shell arguments / tool outputs.
export function safeLabel(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 180);
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

export class Observatory {
  calls: Call[] = [];
  revision = 0;
  private byId = new Map<string, Call>();

  cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  private add(id: string, tool: string, args: unknown, outcome: Outcome): Call {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const input = object(args);
    const file = ["read", "write", "edit"].includes(tool) && typeof input?.path === "string";
    const path = file ? relative(this.cwd, resolve(this.cwd, (input!.path as string).replace(/^@/, ""))) : "";
    const call: Call = {
      id, tool: safeLabel(tool), file,
      target: file ? safeLabel(path || ".") : safeLabel(tool), outcome,
    };
    this.calls.push(call);
    this.byId.set(id, call);
    if (this.calls.length > MAX_CALLS) {
      const removed = this.calls.shift()!;
      this.byId.delete(removed.id);
    }
    this.revision++;
    return call;
  }

  start(id: string, tool: string, args: unknown, now: number): void {
    const call = this.add(id, tool, args, "running");
    call.outcome = "running";
    call.startedAt ??= now;
    this.revision++;
  }

  finish(id: string, tool: string, isError: boolean, now: number): void {
    let call = this.byId.get(id);
    // An old result must not evict a retained start (and its file path).
    if (!call && this.calls.length >= MAX_CALLS) return;
    call ??= this.add(id, tool, undefined, "unknown");
    call.outcome = isError ? "error" : "success";
    if (call.startedAt !== undefined) call.durationMs = Math.max(0, now - call.startedAt);
    this.revision++;
  }

  rebuild(entries: readonly unknown[], cwd: string, keepDurations = true): void {
    const previous = keepDurations ? this.byId : new Map<string, Call>();
    this.calls = [];
    this.byId = new Map();
    this.cwd = cwd;
    for (const item of entries) {
      const entry = object(item);
      if (entry?.type !== "message") continue;
      const message = object(entry.message);
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) {
          const block = object(part);
          if (block?.type !== "toolCall" || typeof block.id !== "string" || typeof block.name !== "string") continue;
          this.add(block.id, block.name, block.arguments, "unknown");
        }
      } else if (message?.role === "toolResult" && typeof message.toolCallId === "string" && typeof message.toolName === "string") {
        this.finish(message.toolCallId, message.toolName, message.isError === true, 0);
      }
    }
    for (const call of this.calls) {
      const old = previous.get(call.id);
      if (old?.durationMs !== undefined) call.durationMs = old.durationMs;
    }
    this.revision++;
  }
}

export function starsFor(calls: readonly Call[]): Star[] {
  const stars = new Map<string, Star>();
  for (const [index, call] of calls.entries()) {
    const key = `${call.file ? "file" : "tool"}:${call.target}`;
    let star = stars.get(key);
    if (!star) {
      star = { key, label: call.target, file: call.file, calls: [], reads: 0, changes: 0, errors: 0, running: 0, last: index };
      stars.set(key, star);
    }
    star.calls.push(call);
    star.last = index;
    if (call.tool === "read") star.reads++;
    if ((call.tool === "edit" || call.tool === "write") && call.outcome === "success") star.changes++;
    if (call.outcome === "error") star.errors++;
    if (call.outcome === "running") star.running++;
  }
  return [...stars.values()];
}
