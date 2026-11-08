import { threadLimit, type Line } from "@caprice/core";
import { expect, test } from "bun:test";

import { readThread, writeThread, type ThreadStore } from "./thread.ts";

test("the thread round-trips and keeps the latest lines", () => {
  const store = memoryStore();
  const lines: Line[] = [];

  for (let index = 0; index < 12; index += 1) {
    lines.push({ who: "host", text: `h${index}` });
    lines.push({ who: "capri", text: `c${index}` });
  }

  writeThread(store, lines);
  const read = readThread(store);

  expect(read).toHaveLength(threadLimit);
  expect(read[0]).toEqual({ who: "host", text: "h2" });
  expect(read.at(-1)).toEqual({ who: "capri", text: "c11" });
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
      { who: "capri", text: 4 },
      { who: "capri", text: "cedar" },
    ]),
  );
  expect(readThread(store)).toEqual([
    { who: "host", text: "pine" },
    { who: "capri", text: "cedar" },
  ]);
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
