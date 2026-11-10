import { threadLimit, type TranscriptEvent } from "@caprice/core";
import { expect, test } from "bun:test";

import { readThread, writeThread, type ThreadStore } from "./thread.ts";

test("the thread round-trips and keeps the latest lines", () => {
  const store = memoryStore();
  const events: TranscriptEvent[] = [];

  for (let index = 0; index < 12; index += 1) {
    events.push({ kind: "user", text: `h${index}` });
    events.push({ kind: "assistant", text: `c${index}` });
  }

  expect(writeThread(store, events).ok).toBe(true);
  const read = readThread(store);

  expect(read).toHaveLength(threadLimit);
  expect(read[0]).toEqual({ kind: "user", text: "h2" });
  expect(read.at(-1)).toEqual({ kind: "assistant", text: "c11" });
});

test("a saved thread drops tool payloads", () => {
  const store = memoryStore();
  const blob = "x".repeat(100_000);

  writeThread(store, [
    { kind: "user", text: "pick Yasuo" },
    {
      kind: "tool-result",
      id: "1",
      name: "league_live",
      ok: true,
      text: blob,
    },
    { kind: "assistant", text: "locked" },
  ]);

  const raw = store.getItem("caprice.thread") ?? "";

  expect(raw).not.toContain(blob);
  expect(raw).not.toContain("league_live");
  expect(readThread(store)).toEqual([
    { kind: "user", text: "pick Yasuo" },
    { kind: "assistant", text: "locked" },
  ]);
});

test("a broken thread is an empty conversation", () => {
  const store = memoryStore();

  store.setItem("caprice.thread", "{");
  expect(readThread(store)).toEqual([]);

  store.setItem(
    "caprice.thread",
    JSON.stringify({ who: "host", text: "nope" }),
  );
  expect(readThread(store)).toEqual([]);

  store.setItem(
    "caprice.thread",
    JSON.stringify([
      { who: "host", text: "pine" },
      { who: "other", text: "drop" },
      {
        kind: "tool-result",
        id: "1",
        name: "league_live",
        ok: true,
        text: "big",
      },
      { who: "capri", text: 4 },
      { who: "capri", text: "cedar" },
    ]),
  );
  expect(readThread(store)).toEqual([
    { kind: "user", text: "pine" },
    { kind: "assistant", text: "cedar" },
  ]);
});

test("a storage failure is returned", () => {
  const saved = writeThread(
    {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("quota");
      },
    },
    [{ kind: "user", text: "hi" }],
  );

  expect(saved.ok).toBe(false);

  if (saved.ok) {
    return;
  }

  expect(saved.error.message).toBe("couldn't save the conversation");
});

function memoryStore(): ThreadStore {
  const items = new Map<string, string>();

  return {
    getItem(key) {
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      items.set(key, value);
    },
  };
}
