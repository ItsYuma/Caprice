export const settingsEvent = "caprice-settings";

export type RecordingMode = "hold" | "vad";

export type TalkChordChoice = "both" | "alt-space" | "ctrl-space";

export type SpeechEngine = "parakeet" | "http";

export type ReplyEngine = "http" | "piper" | "kokoro";

export type ModelFamily =
  "parakeet" | "gguf" | "onnx" | "bark" | "piper" | "kokoro" | "other";

export type ModelRole = "stt" | "tts";

export type ModelEntry = {
  id: string;
  family: ModelFamily;
  path: string;
  bytes: number;
  languages: string[];
  note: string;
  loadable: boolean;
  role: ModelRole;
};

export type CapriceSettings = {
  version: 1;
  modelUrl: string;
  model: string;
  modelApiKey: string;
  modelProtocol: string;
  modelRuntime: string;
  modelExecutable: string;
  modelDeadlineMs: string;
  sttEngine: string;
  sttModel: string;
  sttUrl: string;
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsWoof: string;
  ttsVoice: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
  python: string;
  repo: string;
  container: string;
  modelDirectory: string;
  recordingMode: RecordingMode;
  vadSensitivity: number;
  talkChord: TalkChordChoice;
  enabledGames: string[];
  sttModelId: string;
  ttsModelId: string;
};

const families: readonly ModelFamily[] = [
  "parakeet",
  "gguf",
  "onnx",
  "bark",
  "piper",
  "kokoro",
  "other",
];

const stringFields = [
  "modelUrl",
  "model",
  "modelApiKey",
  "modelProtocol",
  "modelRuntime",
  "modelExecutable",
  "modelDeadlineMs",
  "sttEngine",
  "sttModel",
  "sttUrl",
  "sttDeadlineMs",
  "ttsEngine",
  "ttsWoof",
  "ttsVoice",
  "ttsUrl",
  "ttsModel",
  "ttsApiKey",
  "ttsDeadlineMs",
  "python",
  "repo",
  "container",
  "modelDirectory",
  "sttModelId",
  "ttsModelId",
] as const;

export function showsSettings(inShell: boolean, label: string): boolean {
  return inShell && label === "settings";
}

export function isCapriceSettings(value: unknown): value is CapriceSettings {
  if (!isPlainObject(value)) {
    return false;
  }

  if (readNumber(value, "version") !== 1) {
    return false;
  }

  for (const key of stringFields) {
    if (readString(value, key) === undefined) {
      return false;
    }
  }

  const mode = readString(value, "recordingMode");

  if (mode !== "hold" && mode !== "vad") {
    return false;
  }

  const chord = readString(value, "talkChord");

  if (chord !== "both" && chord !== "alt-space" && chord !== "ctrl-space") {
    return false;
  }

  const sensitivity = readNumber(value, "vadSensitivity");

  if (
    sensitivity === undefined ||
    !Number.isInteger(sensitivity) ||
    sensitivity < 0 ||
    sensitivity > 100
  ) {
    return false;
  }

  return readGames(value) !== undefined;
}

export function isModelList(value: unknown): value is ModelEntry[] {
  if (!isArray(value)) {
    return false;
  }

  for (const item of value) {
    if (!isModelEntry(item)) {
      return false;
    }
  }

  return true;
}

export function gamesText(games: readonly string[]): string {
  return games.join("\n");
}

export function gamesFromText(text: string): string[] {
  const games: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      games.push(trimmed);
    }
  }

  return games;
}

export function speechEngineOf(engine: string): SpeechEngine {
  if (engine === "http") {
    return "http";
  }

  return "parakeet";
}

export function replyEngineOf(engine: string): ReplyEngine {
  if (engine === "piper" || engine === "kokoro") {
    return engine;
  }

  return "http";
}

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

function isModelEntry(value: unknown): value is ModelEntry {
  if (!isPlainObject(value)) {
    return false;
  }

  const family = readString(value, "family");
  const role = readString(value, "role");
  const bytes = readNumber(value, "bytes");
  const loadable = readBoolean(value, "loadable");
  const languages = readGames(value, "languages");

  if (
    readString(value, "id") === undefined ||
    readString(value, "path") === undefined ||
    readString(value, "note") === undefined ||
    family === undefined ||
    !isFamily(family) ||
    (role !== "stt" && role !== "tts") ||
    bytes === undefined ||
    !Number.isFinite(bytes) ||
    bytes < 0 ||
    loadable === undefined ||
    languages === undefined
  ) {
    return false;
  }

  return true;
}

function isFamily(value: string): value is ModelFamily {
  for (const family of families) {
    if (family === value) {
      return true;
    }
  }

  return false;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isArray(value: unknown): value is readonly JsonValue[] {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isNumber(value: unknown): value is number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function isBoolean(value: unknown): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
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

function readGames(
  value: JsonRecord,
  key = "enabledGames",
): string[] | undefined {
  let items: readonly JsonValue[] | undefined;

  for (const [name, field] of Object.entries(value)) {
    if (name === key && isArray(field)) {
      items = field;
    }
  }

  if (items === undefined) {
    return undefined;
  }

  const games: string[] = [];

  for (const item of items) {
    if (!isString(item)) {
      return undefined;
    }

    games.push(item);
  }

  return games;
}
