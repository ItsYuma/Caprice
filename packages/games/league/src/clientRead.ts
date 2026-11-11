export type Champion = {
  id: number;
  name: string;
  alias: string;
};

export type ChampAction = {
  id: number;
  actorCellId: number;
  championId: number;
  type: string;
  completed: boolean;
  inProgress: boolean;
};

export type ChampSelect = {
  localPlayerCellId: number;
  phase: string;
  actions: readonly ChampAction[];
};

export type ReadyCheck = {
  state: string;
  response: string;
};

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

export function parsePhase(body: string): string | undefined {
  const text = body.trim();

  if (text.length === 0) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (isString(parsed)) {
      return phaseWord(parsed.trim());
    }
  } catch {
    return phaseWord(text);
  }

  return phaseWord(text);
}

export function parseReadyCheck(body: string): ReadyCheck | undefined {
  const record = parseRecord(body);

  if (record === undefined) {
    return undefined;
  }

  const state = readString(record, "state");

  if (state === undefined || state.trim().length === 0) {
    return undefined;
  }

  return {
    state: state.trim(),
    response: readString(record, "playerResponse")?.trim() ?? "",
  };
}

export function parseChampions(body: string): readonly Champion[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  if (!isJsonArray(parsed)) {
    return [];
  }

  const champions: Champion[] = [];

  for (const item of parsed) {
    const champion = readChampion(item);

    if (champion !== undefined) {
      champions.push(champion);
    }
  }

  return champions;
}

export function findChampion(
  champions: readonly Champion[],
  query: string,
): Champion | undefined {
  const wanted = compact(query);

  if (wanted.length === 0) {
    return undefined;
  }

  for (const champion of champions) {
    if (
      compact(champion.name) === wanted ||
      compact(champion.alias) === wanted
    ) {
      return champion;
    }
  }

  if (wanted.length < 3) {
    return undefined;
  }

  let found: Champion | undefined;

  for (const champion of champions) {
    const name = compact(champion.name);
    const alias = compact(champion.alias);
    const named = name.startsWith(wanted);
    const aliased = alias.length > 0 && alias.startsWith(wanted);

    if (!named && !aliased) {
      continue;
    }

    if (found !== undefined && found.id !== champion.id) {
      return undefined;
    }

    found = champion;
  }

  return found;
}

export function parseChampSelect(body: string): ChampSelect | undefined {
  const record = parseRecord(body);

  if (record === undefined) {
    return undefined;
  }

  const localPlayerCellId = readNumber(record, "localPlayerCellId");

  if (
    localPlayerCellId === undefined ||
    !Number.isInteger(localPlayerCellId) ||
    localPlayerCellId < 0
  ) {
    return undefined;
  }

  const timer = readObject(record, "timer");
  const phase = timer === undefined ? "" : (readString(timer, "phase") ?? "");

  return {
    localPlayerCellId,
    phase,
    actions: readActions(record),
  };
}

export function openAction(
  session: ChampSelect,
  kind: "ban" | "pick",
): ChampAction | undefined {
  for (const action of session.actions) {
    if (action.actorCellId !== session.localPlayerCellId) {
      continue;
    }

    if (action.type !== kind || action.completed || !action.inProgress) {
      continue;
    }

    return action;
  }

  return undefined;
}

export function actionKindPresent(
  session: ChampSelect,
  kind: "ban" | "pick",
): boolean {
  for (const action of session.actions) {
    if (action.type === kind) {
      return true;
    }
  }

  return false;
}

function readChampion(value: JsonValue): Champion | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }

  const id = readNumber(value, "id");
  const name = readString(value, "name")?.trim() ?? "";

  if (
    id === undefined ||
    !Number.isInteger(id) ||
    id < 1 ||
    name.length === 0
  ) {
    return undefined;
  }

  return {
    id,
    name,
    alias: readString(value, "alias")?.trim() ?? "",
  };
}

function readActions(value: JsonRecord): ChampAction[] {
  const actions: ChampAction[] = [];

  for (const item of readArray(value, "actions")) {
    if (isPlainObject(item)) {
      const action = readAction(item);

      if (action !== undefined) {
        actions.push(action);
      }

      continue;
    }

    if (!isJsonArray(item)) {
      continue;
    }

    for (const inner of item) {
      if (!isPlainObject(inner)) {
        continue;
      }

      const action = readAction(inner);

      if (action !== undefined) {
        actions.push(action);
      }
    }
  }

  return actions;
}

function readAction(value: JsonRecord): ChampAction | undefined {
  const id = readNumber(value, "id");
  const actorCellId = readNumber(value, "actorCellId");
  const type = readString(value, "type")?.trim().toLowerCase() ?? "";

  if (
    id === undefined ||
    !Number.isInteger(id) ||
    id < 0 ||
    actorCellId === undefined ||
    !Number.isInteger(actorCellId) ||
    actorCellId < 0 ||
    (type !== "ban" && type !== "pick")
  ) {
    return undefined;
  }

  return {
    id,
    actorCellId,
    championId: readNumber(value, "championId") ?? 0,
    type,
    completed: readBoolean(value, "completed") ?? false,
    inProgress: readBoolean(value, "isInProgress") ?? false,
  };
}

function parseRecord(body: string): JsonRecord | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  return parsed;
}

function phaseWord(text: string): string | undefined {
  if (text.length === 0) {
    return undefined;
  }

  for (const char of text) {
    const code = char.charCodeAt(0);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

    if (!letter) {
      return undefined;
    }
  }

  return text;
}

function compact(text: string): string {
  let word = "";

  for (const part of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length === 0 || part === "and") {
      continue;
    }

    word += part;
  }

  return word;
}

function readArray(value: JsonRecord, key: string): readonly JsonValue[] {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isJsonArray(field)) {
      return field;
    }
  }

  return [];
}

function readObject(value: JsonRecord, key: string): JsonRecord | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isPlainObject(field)) {
      return field;
    }
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

function readNumber(value: JsonRecord, key: string): number | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isNumber(field)) {
      return field;
    }
  }

  return undefined;
}

function readBoolean(value: JsonRecord, key: string): boolean | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isBoolean(field)) {
      return field;
    }
  }

  return undefined;
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isBoolean(value: unknown): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
}

function isNumber(value: unknown): value is number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    Number.isFinite(value)
  );
}
