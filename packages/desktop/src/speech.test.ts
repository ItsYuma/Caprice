import { expect, test } from "bun:test";

import {
  bytesFromBase64,
  pageCanSpeak,
  pageListener,
  readSpeechCredit,
  readSpeechDeadline,
  speechDeadlineDefaultMs,
  speechHint,
  pageSpeaker,
  postSpeech,
  shellListener,
  shellSpeaker,
  speechUnconfigured,
  tauriCommands,
  ttsExchange,
  modelUnavailable,
  type SpeechBridge,
  type SpeechCommands,
  type TtsEnv,
} from "./speech.ts";

const live = new AbortController().signal;

test("shell audio is decoded before it is played", async () => {
  const played: number[][] = [];

  const speaker = shellSpeaker(spoken("AQID/w=="), async (bytes) => {
    played.push(Array.from(bytes));
  });

  await speaker.speak("  hey  ", live);
  expect(played).toEqual([[1, 2, 3, 255]]);
});

test("a page without the shell cannot listen", async () => {
  const listener = pageListener();

  listener.release();
  await expect(listener.listen()).rejects.toThrow(modelUnavailable);
});

test("page speech posts json and plays the response bytes", async () => {
  const payload = new Uint8Array([9, 8, 7]);
  let method = "";
  let authorization = "";
  let contentType = "";
  let body = "";

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      method = request.method;
      authorization = request.headers.get("authorization") ?? "";
      contentType = request.headers.get("content-type") ?? "";

      return request.text().then((text) => {
        body = text;

        return new Response(payload);
      });
    },
  });

  try {
    const played: number[][] = [];

    const speaker = pageSpeaker(
      {
        CAPRICE_TTS_URL: new URL("/speech", server.url).href,
        CAPRICE_TTS_MODEL: "voice-a",
        CAPRICE_TTS_VOICE: "soft",
        CAPRICE_TTS_API_KEY: "token-a",
      },
      "",
      postSpeech,
      async (bytes) => {
        played.push(Array.from(bytes));
      },
    );

    await speaker.speak("  hey  ", live);
    expect(method).toBe("POST");
    expect(authorization).toBe("Bearer token-a");
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      model: "voice-a",
      input: "hey",
      voice: "soft",
    });
    expect(played).toEqual([[9, 8, 7]]);
  } finally {
    server.stop(true);
  }
});

test("page speech omits voice and authorization when they are empty", async () => {
  let authorization: string | null = "present";
  let body = "";

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      authorization = request.headers.get("authorization");

      return request.text().then((text) => {
        body = text;

        return new Response(new Uint8Array([1]));
      });
    },
  });

  try {
    const speaker = pageSpeaker(
      {
        CAPRICE_TTS_URL: server.url.href,
        CAPRICE_TTS_MODEL: "voice-b",
        CAPRICE_TTS_VOICE: " ",
        CAPRICE_TTS_API_KEY: "",
      },
      "http",
      postSpeech,
      async () => {},
    );

    await speaker.speak("hey", live);
    expect(authorization).toBeNull();
    expect(JSON.parse(body)).toEqual({ model: "voice-b", input: "hey" });
  } finally {
    server.stop(true);
  }
});

test("a failed speech response keeps the status", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("no", { status: 503 });
    },
  });

  try {
    const bytes = postSpeech({
      url: server.url.href,
      body: "{}",
      apiKey: "",
    });

    await expect(bytes).rejects.toThrow("speech request failed: 503");
  } finally {
    server.stop(true);
  }
});

test("empty audio is not played", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new Uint8Array());
    },
  });

  try {
    let plays = 0;

    const speaker = pageSpeaker(
      {
        CAPRICE_TTS_URL: server.url.href,
        CAPRICE_TTS_MODEL: "voice-c",
      },
      " http ",
      postSpeech,
      async () => {
        plays += 1;
      },
    );

    await speaker.speak("hey", live);
    expect(plays).toBe(0);
  } finally {
    server.stop(true);
  }
});

test("missing speech configuration does not post", async () => {
  let posts = 0;

  const speaker = pageSpeaker(
    missingModel,
    "",
    async () => {
      posts += 1;

      return new Uint8Array([1]);
    },
    async () => {},
  );

  await expect(speaker.speak("hey", live)).rejects.toThrow(speechUnconfigured);
  expect(posts).toBe(0);
  expect(
    ttsExchange({ CAPRICE_TTS_URL: " ", CAPRICE_TTS_MODEL: "m" }, "hey"),
  ).toBeUndefined();
  expect(
    ttsExchange(
      { CAPRICE_TTS_URL: "http://voice", CAPRICE_TTS_MODEL: "" },
      "hey",
    ),
  ).toBeUndefined();
});

test("standard base64 decodes to the same bytes", () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);

  expect(Array.from(bytesFromBase64(encode(bytes)))).toEqual([
    0, 1, 127, 128, 255,
  ]);
  expect(bytesFromBase64("").byteLength).toBe(0);
});

test("the page speaks over http and refuses a shell engine", async () => {
  let posts = 0;

  const post = async () => {
    posts += 1;

    return new Uint8Array([4]);
  };

  const env = {
    CAPRICE_TTS_URL: "http://voice.example/speech",
    CAPRICE_TTS_MODEL: "voice-d",
  };

  const local = pageSpeaker(env, " piper ", post, async () => {});

  await expect(local.speak("hey", live)).rejects.toThrow(
    "speech engine runs in the shell: piper",
  );
  expect(posts).toBe(0);
  expect(pageCanSpeak("")).toBe(true);
  expect(pageCanSpeak("   ")).toBe(true);
  expect(pageCanSpeak("http")).toBe(true);
  expect(pageCanSpeak(" http ")).toBe(true);
  expect(pageCanSpeak("piper")).toBe(false);
  expect(pageCanSpeak("HTTP")).toBe(false);
  expect(pageCanSpeak("https")).toBe(false);

  const http = pageSpeaker(env, " http ", post, async () => {});

  await http.speak("hey", live);
  expect(posts).toBe(1);
});

test("speech credit is empty outside the shell and kept from the command", async () => {
  let reads = 0;

  expect(
    await readSpeechCredit(false, async () => {
      reads += 1;

      return "spoken voice";
    }),
  ).toBe("");
  expect(reads).toBe(0);
  expect(await readSpeechCredit(true, async () => "spoken voice")).toBe(
    "spoken voice",
  );
  expect(await readSpeechCredit(true, async () => "")).toBe("");
  await expect(
    readSpeechCredit(true, async () => {
      throw new Error("unknown reply engine: bark");
    }),
  ).resolves.toBe("");
});

test("the shell hint says how to talk", () => {
  expect(speechHint(true)).toBe(
    "Hold Alt+Space or Ctrl+Space. Release to send.",
  );
  expect(speechHint(false)).toBe(modelUnavailable);
});

const missingModel: TtsEnv = {
  CAPRICE_TTS_URL: "http://voice.example/speech",
  CAPRICE_TTS_MODEL: " ",
};

function spoken(encoded: string): SpeechCommands {
  return {
    async listenStart() {},
    async listenStop() {
      return "";
    },
    async cancelListen() {},
    async speak() {
      return encoded;
    },
    async cancelReply() {},
  };
}

test("cancel suppresses late speech bytes", async () => {
  const controller = new AbortController();
  let played = 0;
  let release = (_bytes: Uint8Array) => {};

  const speaker = pageSpeaker(
    {
      CAPRICE_TTS_URL: "http://voice.example/speech",
      CAPRICE_TTS_MODEL: "voice-a",
    },
    "http",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    async () => {
      played += 1;
    },
  );

  const pending = speaker.speak("hey", controller.signal);

  await Promise.resolve();
  controller.abort();
  release(new Uint8Array([9, 9, 9]));
  await expect(pending).rejects.toThrow("cancelled");
  expect(played).toBe(0);
});

test("speech fetch stays bounded by the deadline after cancel would have returned", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise(() => undefined);
    },
  });

  try {
    const pending = postSpeech(
      { url: server.url.href, body: "{}", apiKey: "" },
      30,
    );

    await expect(pending).rejects.toThrow("speech timed out");
  } finally {
    server.stop(true);
  }
});

test("the speech deadline defaults to 60s and rejects a bad value", () => {
  expect(readSpeechDeadline(undefined)).toBe(speechDeadlineDefaultMs);
  expect(readSpeechDeadline(" ")).toBe(60_000);
  expect(readSpeechDeadline("500")).toBe(500);
  expect(() => readSpeechDeadline("later")).toThrow(
    "CAPRICE_TTS_DEADLINE_MS is not a whole number of milliseconds",
  );
  expect(() => readSpeechDeadline("0")).toThrow(
    "CAPRICE_TTS_DEADLINE_MS is not a whole number of milliseconds",
  );
});

test("a reply cancel finishes before the next synthesis", async () => {
  const order: string[] = [];
  let releaseSpeak = () => {};
  let releaseCancel = () => {};
  let speaks = 0;

  const commands: SpeechCommands = {
    async listenStart() {},
    async listenStop() {
      return "";
    },
    async cancelListen() {},
    speak() {
      speaks += 1;
      order.push(`speak-${speaks}`);

      if (speaks === 1) {
        return new Promise((resolve) => {
          releaseSpeak = () => {
            resolve("AQID");
          };
        });
      }

      return Promise.resolve("AQID");
    },
    cancelReply() {
      order.push("cancel");

      return new Promise((resolve) => {
        releaseCancel = () => {
          order.push("cancel-done");
          resolve();
        };
      });
    },
  };

  const speaker = shellSpeaker(commands, async () => {
    order.push("play");
  });

  const first = new AbortController();
  const pending = speaker.speak("hey", first.signal);

  await Promise.resolve();
  expect(order).toEqual(["speak-1"]);
  first.abort();
  releaseSpeak();

  const second = speaker.speak("again", new AbortController().signal);

  await Promise.resolve();
  expect(order).toEqual(["speak-1", "cancel"]);
  releaseCancel();
  await expect(pending).rejects.toThrow("cancelled");
  await second;
  expect(order).toEqual([
    "speak-1",
    "cancel",
    "cancel-done",
    "speak-2",
    "play",
  ]);
});

test("listener cancel asks the shell to cancel and does not transcribe", async () => {
  const commands: string[] = [];

  const bridge: SpeechBridge = {
    async run(command) {
      commands.push(command);
    },
    async text(command) {
      commands.push(command);

      return "partial hello";
    },
    async speak() {
      return "";
    },
  };

  const listener = shellListener(tauriCommands(bridge));
  const pending = listener.listen();

  await Promise.resolve();
  await Promise.resolve();
  listener.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(commands).toContain("speech_cancel");
  expect(commands).not.toContain("speech_listen_stop");
  expect(commands).not.toContain("speech_transcribe");
});

function encode(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return btoa(binary);
}
