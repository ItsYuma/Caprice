import { expect, test } from "bun:test";

import {
  bytesFromBase64,
  pageListener,
  pageSpeaker,
  playOpenClip,
  postSpeech,
  shellListener,
  shellSpeaker,
  speechBlob,
  speechHint,
  speechUnconfigured,
  tauriCommands,
  ttsExchange,
  workerUnavailable,
  type SpeechCommands,
  type TtsEnv,
} from "./speech.ts";

test("the shell hint names the chord and the page says the worker is unavailable", () => {
  expect(speechHint(true)).toBe("Hold Alt+Space. Release to send.");
  expect(speechHint(false)).toBe(workerUnavailable);
});

test("tauri commands use the speech invoke names", async () => {
  const calls: string[] = [];

  const commands = tauriCommands({
    async run(command) {
      calls.push(command);
    },
    async text(command) {
      calls.push(command);

      return "  yo  ";
    },
    async speak(command, text) {
      calls.push(`${command}:${text}`);

      return "";
    },
  });

  const listener = shellListener(commands);
  const pending = listener.listen();

  await Promise.resolve();
  listener.release();
  await expect(pending).resolves.toEqual({ text: "yo" });

  let plays = 0;

  const speaker = shellSpeaker(commands, async () => {
    plays += 1;
  });

  await speaker.speak("hey");
  expect(calls).toEqual([
    "speech_listen_start",
    "speech_listen_stop",
    "speech_speak:hey",
  ]);
  expect(plays).toBe(0);
});

test("shell audio is decoded before it is played", async () => {
  const played: number[][] = [];

  const speaker = shellSpeaker(spoken("AQID/w=="), async (bytes) => {
    played.push(Array.from(bytes));
  });

  await speaker.speak("  hey  ");
  expect(played).toEqual([[1, 2, 3, 255]]);
});

test("shell errors stay unchanged and blank text does not speak", async () => {
  let speaks = 0;

  const commands = failingCommands(() => {
    speaks += 1;

    return Promise.reject("CAPRICE_TTS_MODEL is not set");
  });

  const speaker = shellSpeaker(commands, async () => {});

  await speaker.speak("   ");
  await expect(speaker.speak("hey")).rejects.toThrow(
    "CAPRICE_TTS_MODEL is not set",
  );
  expect(speaks).toBe(1);
});

test("a listen error from the shell stays unchanged", async () => {
  const commands = failingCommands(() => Promise.resolve(""));

  commands.listenStart = () => Promise.reject("no microphone is available");
  const listener = shellListener(commands);
  const pending = listener.listen();

  await expect(pending).rejects.toThrow("no microphone is available");
});

test("a page without the shell cannot listen", async () => {
  const listener = pageListener();

  listener.release();
  await expect(listener.listen()).rejects.toThrow(workerUnavailable);
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
      postSpeech,
      async (bytes) => {
        played.push(Array.from(bytes));
      },
    );

    await speaker.speak("  hey  ");
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
      postSpeech,
      async () => {},
    );

    await speaker.speak("hey");
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
      postSpeech,
      async () => {
        plays += 1;
      },
    );

    await speaker.speak("hey");
    expect(plays).toBe(0);
  } finally {
    server.stop(true);
  }
});

test("missing speech configuration does not post", async () => {
  let posts = 0;

  const speaker = pageSpeaker(
    missingModel,
    async () => {
      posts += 1;

      return new Uint8Array([1]);
    },
    async () => {},
  );

  await expect(speaker.speak("hey")).rejects.toThrow(speechUnconfigured);
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
  expect(speechBlob(bytes).size).toBe(bytes.byteLength);
});

test("playback revokes the clip when it ends", async () => {
  let revoked = 0;
  let end = () => {};

  const pending = playOpenClip({
    play() {
      return Promise.resolve();
    },
    ended(listener) {
      end = listener;
    },
    failed() {},
    revoke() {
      revoked += 1;
    },
  });

  expect(revoked).toBe(0);
  end();
  await pending;
  expect(revoked).toBe(1);
});

test("playback failure revokes once and rejects", async () => {
  let revoked = 0;
  let fail = () => {};

  const pending = playOpenClip({
    play() {
      fail();

      return Promise.reject(new Error("autoplay"));
    },
    ended() {},
    failed(listener) {
      fail = listener;
    },
    revoke() {
      revoked += 1;
    },
  });

  await expect(pending).rejects.toThrow("could not play speech");
  expect(revoked).toBe(1);
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
    async speak() {
      return encoded;
    },
  };
}

function failingCommands(speak: () => Promise<string>): SpeechCommands {
  return {
    async listenStart() {},
    async listenStop() {
      return "";
    },
    speak,
  };
}

function encode(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return btoa(binary);
}
