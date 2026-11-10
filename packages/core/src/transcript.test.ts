import { expect, test } from "bun:test";

import {
  clipText,
  conversationEvents,
  eventSize,
  threadLimit,
  threadSizeLimit,
  toolResultLimit,
  transcriptSizeLimit,
  trimTranscript,
  type TranscriptEvent,
} from "./transcript.ts";

test("conversation storage drops tool payloads and old lines", () => {
  const events: TranscriptEvent[] = [];

  for (let index = 0; index < 30; index += 1) {
    events.push({ kind: "user", text: `h${index}` });
    events.push({ kind: "assistant", text: "c".repeat(2000) });
  }

  events.push({
    kind: "tool-result",
    id: "1",
    name: "league_live",
    ok: true,
    text: "x".repeat(100_000),
  });

  const kept = conversationEvents(events);
  let size = 0;

  for (const event of kept) {
    size +=
      event.kind === "user" || event.kind === "assistant"
        ? event.text.length
        : 0;
    expect(event.kind === "user" || event.kind === "assistant").toBe(true);
  }

  expect(kept.length).toBeLessThanOrEqual(threadLimit);
  expect(size).toBeLessThanOrEqual(threadSizeLimit);
  expect(JSON.stringify(kept)).not.toContain("league_live");
  expect(kept.at(-1)?.kind).toBe("assistant");
});

test("twenty events stay and the next turn drops a whole turn", () => {
  const events: TranscriptEvent[] = [
    { kind: "user", text: "u0" },
    { kind: "tool-call", id: "c0", name: "note", input: "in" },
    {
      kind: "tool-result",
      id: "c0",
      name: "note",
      ok: true,
      text: "out",
    },
    { kind: "assistant", text: "a0" },
  ];

  for (let index = 1; index < 9; index += 1) {
    events.push({ kind: "user", text: `u${index}` });
    events.push({ kind: "assistant", text: `a${index}` });
  }

  expect(events).toHaveLength(threadLimit);
  trimTranscript(events);
  expect(events).toHaveLength(threadLimit);
  expect(events[0]).toEqual({ kind: "user", text: "u0" });
  expect(paired(events)).toBe(true);

  events.push({ kind: "user", text: "new" });
  trimTranscript(events);
  expect(events[0]).toEqual({ kind: "user", text: "u1" });
  expect(events.at(-1)).toEqual({ kind: "user", text: "new" });
  expect(events.length).toBeLessThanOrEqual(threadLimit);
  expect(paired(events)).toBe(true);
  expect(JSON.stringify(events)).not.toContain("c0");
});

test("the size boundary drops tool pairs together", () => {
  const events: TranscriptEvent[] = [{ kind: "user", text: "ask" }];

  for (let index = 0; index < 6; index += 1) {
    events.push({
      kind: "tool-call",
      id: String(index),
      name: "note",
      input: "i".repeat(toolResultLimit),
    });
    events.push({
      kind: "tool-result",
      id: String(index),
      name: "note",
      ok: true,
      text: "r".repeat(toolResultLimit),
    });
  }

  events.push({ kind: "assistant", text: "done" });
  trimTranscript(events);

  expect(size(events)).toBeLessThanOrEqual(transcriptSizeLimit);
  expect(events.length).toBeLessThanOrEqual(threadLimit);
  expect(events.length).toBeGreaterThan(2);
  expect(paired(events)).toBe(true);
  expect(events[0]?.kind).toBe("user");
  expect(events.at(-1)?.kind).toBe("assistant");
  expect(
    events.some((event) => event.kind === "tool-call" && event.id === "0"),
  ).toBe(false);
  expect(
    events.some((event) => event.kind === "tool-result" && event.id === "0"),
  ).toBe(false);
});

test("a huge tool input and reply are clipped together", () => {
  const events: TranscriptEvent[] = [
    { kind: "user", text: "ask" },
    {
      kind: "tool-call",
      id: "huge",
      name: "note",
      input: "x".repeat(toolResultLimit + 5_000),
    },
    {
      kind: "tool-result",
      id: "huge",
      name: "note",
      ok: true,
      text: "y".repeat(toolResultLimit + 5_000),
    },
    { kind: "assistant", text: "done" },
  ];

  trimTranscript(events);

  const call = events[1];
  const result = events[2];

  expect(paired(events)).toBe(true);
  expect(size(events)).toBeLessThanOrEqual(transcriptSizeLimit);

  if (call?.kind !== "tool-call" || result?.kind !== "tool-result") {
    throw new Error("tool pair was split");
  }

  expect(call.input.length).toBeLessThanOrEqual(toolResultLimit);
  expect(call.input.endsWith("[truncated]")).toBe(true);
  expect(result.text.length).toBeLessThanOrEqual(toolResultLimit);
  expect(result.text.endsWith("[truncated]")).toBe(true);
});

test("clip marks a tool result that does not fit", () => {
  const clipped = clipText("x".repeat(toolResultLimit + 20), toolResultLimit);

  expect(clipped.length).toBeLessThanOrEqual(toolResultLimit);
  expect(clipped.endsWith("[truncated]")).toBe(true);
  expect(clipText("short", toolResultLimit)).toBe("short");
});

function paired(events: readonly TranscriptEvent[]): boolean {
  const open: string[] = [];

  for (const event of events) {
    if (event.kind === "tool-call") {
      open.push(event.id);
    }

    if (event.kind === "tool-result") {
      const index = open.indexOf(event.id);

      if (index < 0) {
        return false;
      }

      open.splice(index, 1);
    }
  }

  return open.length === 0;
}

function size(events: readonly TranscriptEvent[]): number {
  let total = 0;

  for (const event of events) {
    total += eventSize(event);
  }

  return total;
}
