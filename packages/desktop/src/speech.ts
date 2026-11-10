import { deadlineError, openDeadline } from "@caprice/core";
import {
  captureListener,
  type Capture,
  type PushListener,
  type Speaker,
} from "@caprice/voice";

import { talkChordLabel } from "./talk.ts";

export const modelUnavailable = "speech model is unavailable in this window";

export const speechUnconfigured = "speech is not configured";

export const speechDeadlineDefaultMs = 60_000;

const speechTimedOut = "speech timed out";

export type SpeechCommands = {
  listenStart: () => Promise<void>;
  listenStop: () => Promise<string>;
  cancelListen: () => Promise<void>;
  speak: (text: string) => Promise<string>;
  cancelReply: () => Promise<void>;
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
  CAPRICE_TTS_DEADLINE_MS?: string;
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
    return `Hold ${talkChordLabel()}. Release to send. Drag the box to move it.`;
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
    cancelListen() {
      return bridge.run("speech_cancel");
    },
    speak(text) {
      return bridge.speak("speech_speak", text);
    },
    cancelReply() {
      return bridge.run("speech_reply_cancel");
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
    async cancel() {},
  });
}

export function shellSpeaker(
  commands: SpeechCommands,
  play: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
  ready: (ms: number) => void = voiceUnnoted,
): Speaker {
  return audioSpeaker(
    (text, signal) => shellBytes(commands, text, signal),
    play,
    ready,
    () => commands.cancelReply(),
  );
}

export function pageSpeaker(
  env: TtsEnv,
  engine: string,
  post: (exchange: TtsExchange, deadlineMs: number) => Promise<Uint8Array>,
  play: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
  ready: (ms: number) => void = voiceUnnoted,
): Speaker {
  return audioSpeaker(
    (text, signal) => pageBytes(env, engine, post, text, signal),
    play,
    ready,
    async () => {},
  );
}

export function readSpeechDeadline(raw: string | undefined): number {
  const text = raw?.trim() ?? "";

  if (text.length === 0) {
    return speechDeadlineDefaultMs;
  }

  if (!isWholeMilliseconds(text)) {
    throw new Error(
      "CAPRICE_TTS_DEADLINE_MS is not a whole number of milliseconds",
    );
  }

  return Number(text);
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

export async function postSpeech(
  exchange: TtsExchange,
  deadlineMs: number = speechDeadlineDefaultMs,
): Promise<Uint8Array> {
  const parent = new AbortController();
  const deadline = openDeadline(parent.signal, deadlineMs);
  const headers = new Headers({ "content-type": "application/json" });

  if (exchange.apiKey.length > 0) {
    headers.set("authorization", `Bearer ${exchange.apiKey}`);
  }

  try {
    const early = deadlineError(deadline, speechTimedOut);

    if (early !== undefined) {
      throw early;
    }

    const response = await fetch(exchange.url, {
      method: "POST",
      headers,
      body: exchange.body,
      signal: deadline.signal,
    });

    if (!response.ok) {
      throw new Error(`speech request failed: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (caught) {
    const reason = deadlineError(deadline, speechTimedOut);

    if (reason !== undefined) {
      throw reason;
    }

    throw caught;
  } finally {
    deadline.stop();
  }
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
    cancel() {
      return readSpeech(commands.cancelListen());
    },
  };
}

const voiceUnnoted = (_ms: number) => {};

function audioSpeaker(
  load: (text: string, signal: AbortSignal) => Promise<Uint8Array>,
  play: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
  ready: (ms: number) => void,
  cancelSynthesis: () => Promise<void>,
): Speaker {
  let cleanup: Promise<void> = Promise.resolve();

  const startCancel = () => {
    cleanup = quiet(cancelSynthesis);

    return cleanup;
  };

  return {
    async speak(text, signal) {
      await cleanup;

      if (signal.aborted) {
        throw new Error("cancelled");
      }

      const trimmed = text.trim();

      if (trimmed.length === 0) {
        ready(0);

        return;
      }

      const onAbort = () => {
        startCancel();
      };

      signal.addEventListener("abort", onAbort, { once: true });

      try {
        const started = performance.now();
        const bytes = await load(trimmed, signal);

        ready(Math.max(0, performance.now() - started));

        if (signal.aborted) {
          await cleanup;

          throw new Error("cancelled");
        }

        if (bytes.byteLength === 0) {
          return;
        }

        await play(bytes, signal);

        if (signal.aborted) {
          await cleanup;

          throw new Error("cancelled");
        }
      } catch (cause) {
        if (signal.aborted) {
          await cleanup;

          throw new Error("cancelled");
        }

        throw cause;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

async function shellBytes(
  commands: SpeechCommands,
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const encoded = await abandonOnAbort(
    readSpeech(commands.speak(text)),
    signal,
  );

  if (encoded.length === 0) {
    return new Uint8Array();
  }

  return bytesFromBase64(encoded);
}

async function pageBytes(
  env: TtsEnv,
  engine: string,
  post: (exchange: TtsExchange, deadlineMs: number) => Promise<Uint8Array>,
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!pageCanSpeak(engine)) {
    throw new Error(`speech engine runs in the shell: ${engine.trim()}`);
  }

  const exchange = ttsExchange(env, text);

  if (exchange === undefined) {
    throw new Error(speechUnconfigured);
  }

  return abandonOnAbort(
    post(exchange, readSpeechDeadline(env.CAPRICE_TTS_DEADLINE_MS)),
    signal,
  );
}

function abandonOnAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    pending.then(
      () => undefined,
      () => undefined,
    );

    return Promise.reject(new Error("cancelled"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const stop = () => {
      if (settled) {
        return false;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);

      return true;
    };

    const onAbort = () => {
      pending.then(
        () => undefined,
        () => undefined,
      );

      if (stop()) {
        reject(new Error("cancelled"));
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        if (!stop()) {
          return;
        }

        if (signal.aborted) {
          reject(new Error("cancelled"));

          return;
        }

        resolve(value);
      },
      (cause) => {
        if (!stop()) {
          return;
        }

        if (signal.aborted) {
          reject(new Error("cancelled"));

          return;
        }

        if (cause instanceof Error) {
          reject(cause);

          return;
        }

        reject(new Error("speech request failed"));
      },
    );
  });
}

function quiet(run: () => Promise<void>): Promise<void> {
  try {
    return run().then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function isWholeMilliseconds(text: string): boolean {
  if (text.length === 0 || text.length > 15) {
    return false;
  }

  for (const char of text) {
    if (char < "0" || char > "9") {
      return false;
    }
  }

  const value = Number(text);

  return Number.isSafeInteger(value) && value > 0;
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
