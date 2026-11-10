import {
  conversationEvents,
  fail,
  ok,
  type Result,
  type TranscriptEvent,
} from "@caprice/core";

export type ThreadStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const threadKey = "caprice.thread";

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

export function readThread(store: ThreadStore): TranscriptEvent[] {
  const raw = readRaw(store);

  if (raw.length === 0) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const events: TranscriptEvent[] = [];

  for (const item of parsed) {
    if (!isPlainObject(item)) {
      continue;
    }

    const event = readEvent(item);

    if (event === undefined) {
      continue;
    }

    events.push(event);
  }

  return conversationEvents(events);
}

export function writeThread(
  store: ThreadStore,
  events: readonly TranscriptEvent[],
): Result<boolean> {
  try {
    store.setItem(threadKey, JSON.stringify(conversationEvents(events)));

    return ok(true);
  } catch {
    return fail("couldn't save the conversation");
  }
}

export function threadStore(): ThreadStore | undefined {
  try {
    const store = globalThis.localStorage;

    store.getItem(threadKey);

    return store;
  } catch {
    return undefined;
  }
}

function readRaw(store: ThreadStore): string {
  try {
    return store.getItem(threadKey) ?? "";
  } catch {
    return "";
  }
}

function readEvent(value: JsonRecord): TranscriptEvent | undefined {
  const text = readString(value, "text");

  if (text === undefined) {
    return undefined;
  }

  const kind = readString(value, "kind");

  if (kind === "user" || kind === "assistant") {
    return { kind, text };
  }

  if (kind === "tool-call" || kind === "tool-result") {
    return undefined;
  }

  const who = readString(value, "who");

  if (who === "host") {
    return { kind: "user", text };
  }

  if (who === "capri") {
    return { kind: "assistant", text };
  }

  return undefined;
}

function readString(value: JsonRecord, key: string): string | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isString(field)) {
      return field;
    }
  }

  return undefined;
}

function isString(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}
