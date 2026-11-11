export function readDetectedIds(raw: string): readonly string[] {
  try {
    const parsed = JSON.parse(raw);

    if (!isStringList(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

export function readEnabledGames(raw: string): readonly string[] {
  try {
    const parsed = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return [];
    }

    const enabled = parsed.enabledGames;

    if (!isStringList(enabled)) {
      return [];
    }

    return enabled;
  } catch {
    return [];
  }
}

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

function isRecord(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isStringList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  for (const item of value) {
    if (!isString(item)) {
      return false;
    }
  }

  return true;
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}
