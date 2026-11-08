import { threadLimit, type Line, type Who } from "@caprice/core";

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

export function readThread(store: ThreadStore): Line[] {
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

  const lines: Line[] = [];

  for (const item of parsed) {
    if (!isPlainObject(item)) {
      continue;
    }

    const who = readWho(item);
    const text = readString(item, "text");

    if (who === undefined || text === undefined) {
      continue;
    }

    lines.push({ who, text });
  }

  return tail(lines);
}

export function writeThread(store: ThreadStore, lines: readonly Line[]): void {
  const kept = tail(lines);

  try {
    store.setItem(threadKey, JSON.stringify(kept));
  } catch {
    return;
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

function tail(lines: readonly Line[]): Line[] {
  const start = lines.length > threadLimit ? lines.length - threadLimit : 0;
  const kept: Line[] = [];

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    kept.push({ who: line.who, text: line.text });
  }

  return kept;
}

function readWho(value: JsonRecord): Who | undefined {
  const who = readString(value, "who");

  if (who === "host" || who === "capri") {
    return who;
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
