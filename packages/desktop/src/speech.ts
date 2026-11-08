import {
  captureListener,
  type Capture,
  type PushListener,
  type Speaker,
} from "@caprice/voice";

import { talkChordLabel } from "./talk.ts";

export const modelUnavailable = "speech model is unavailable in this window";

export const speechUnconfigured = "speech is not configured";

export type SpeechCommands = {
  listenStart: () => Promise<void>;
  listenStop: () => Promise<string>;
  speak: (text: string) => Promise<string>;
};

export type SpeechBridge = {
  run: (command: string) => Promise<void>;
  text: (command: string) => Promise<string>;
  speak: (command: string, text: string) => Promise<string>;
};

export type TtsEnv = {
  CAPRICE_TTS_URL?: string;
  CAPRICE_TTS_MODEL?: string;
  CAPRICE_TTS_VOICE?: string;
  CAPRICE_TTS_API_KEY?: string;
};

export type TtsExchange = {
  url: string;
  body: string;
  apiKey: string;
};

type SpokenBody = {
  model: string;
  input: string;
  voice?: string;
};

export function pageCanSpeak(engine: string): boolean {
  const name = engine.trim();

  return name.length === 0 || name === "http";
}

export function readSpeechCredit(
  inShell: boolean,
  read: () => Promise<string>,
): Promise<string> {
  if (!inShell) {
    return Promise.resolve("");
  }

  return read().then(
    (text) => text,
    () => "",
  );
}

export function speechHint(inShell: boolean): string {
  if (inShell) {
    return `Hold ${talkChordLabel()}. Release to send.`;
  }

  return modelUnavailable;
}

export function tauriCommands(bridge: SpeechBridge): SpeechCommands {
  return {
    listenStart() {
      return bridge.run("speech_listen_start");
    },
    listenStop() {
      return bridge.text("speech_listen_stop");
    },
    speak(text) {
      return bridge.speak("speech_speak", text);
    },
  };
}

export function shellListener(commands: SpeechCommands): PushListener {
  return captureListener(shellCapture(commands));
}

export function pageListener(): PushListener {
  return captureListener({
    async begin() {
      throw new Error(modelUnavailable);
    },
    async finish() {
      return "";
    },
  });
}

export function shellSpeaker(
  commands: SpeechCommands,
  play: (bytes: Uint8Array) => Promise<void>,
): Speaker {
  return audioSpeaker((text) => shellBytes(commands, text), play);
}

export function pageSpeaker(
  env: TtsEnv,
  engine: string,
  post: (exchange: TtsExchange) => Promise<Uint8Array>,
  play: (bytes: Uint8Array) => Promise<void>,
): Speaker {
  return audioSpeaker((text) => pageBytes(env, engine, post, text), play);
}

export function bytesFromBase64(encoded: string): Uint8Array {
  if (encoded.length === 0) {
    return new Uint8Array();
  }

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function ttsExchange(
  env: TtsEnv,
  text: string,
): TtsExchange | undefined {
  const url = env.CAPRICE_TTS_URL?.trim() ?? "";
  const model = env.CAPRICE_TTS_MODEL?.trim() ?? "";

  if (url.length === 0 || model.length === 0) {
    return undefined;
  }

  const voice = env.CAPRICE_TTS_VOICE?.trim() ?? "";

  return {
    url,
    apiKey: env.CAPRICE_TTS_API_KEY?.trim() ?? "",
    body: JSON.stringify(spokenBody(model, text, voice)),
  };
}

export async function postSpeech(exchange: TtsExchange): Promise<Uint8Array> {
  const headers = new Headers({ "content-type": "application/json" });

  if (exchange.apiKey.length > 0) {
    headers.set("authorization", `Bearer ${exchange.apiKey}`);
  }

  const response = await fetch(exchange.url, {
    method: "POST",
    headers,
    body: exchange.body,
  });

  if (!response.ok) {
    throw new Error(`speech request failed: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function readSpeech<Result>(
  pending: Promise<Result>,
): Promise<Result> {
  try {
    return await pending;
  } catch (error) {
    if (isError(error)) {
      throw error;
    }

    if (isMessage(error)) {
      // Tauri command errors arrive as strings.
      throw new Error(error);
    }

    throw new Error("speech request failed");
  }
}

function shellCapture(commands: SpeechCommands): Capture {
  return {
    begin() {
      return readSpeech(commands.listenStart());
    },
    finish() {
      return readSpeech(commands.listenStop());
    },
  };
}

function audioSpeaker(
  load: (text: string) => Promise<Uint8Array>,
  play: (bytes: Uint8Array) => Promise<void>,
): Speaker {
  return {
    async speak(text) {
      const trimmed = text.trim();

      if (trimmed.length === 0) {
        return;
      }

      const bytes = await load(trimmed);

      if (bytes.byteLength === 0) {
        return;
      }

      await play(bytes);
    },
  };
}

async function shellBytes(
  commands: SpeechCommands,
  text: string,
): Promise<Uint8Array> {
  const encoded = await readSpeech(commands.speak(text));

  if (encoded.length === 0) {
    return new Uint8Array();
  }

  return bytesFromBase64(encoded);
}

async function pageBytes(
  env: TtsEnv,
  engine: string,
  post: (exchange: TtsExchange) => Promise<Uint8Array>,
  text: string,
): Promise<Uint8Array> {
  if (!pageCanSpeak(engine)) {
    throw new Error(`speech engine runs in the shell: ${engine.trim()}`);
  }

  const exchange = ttsExchange(env, text);

  if (exchange === undefined) {
    throw new Error(speechUnconfigured);
  }

  return post(exchange);
}

function spokenBody(model: string, input: string, voice: string): SpokenBody {
  if (voice.length === 0) {
    return { model, input };
  }

  return { model, input, voice };
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isMessage(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}
