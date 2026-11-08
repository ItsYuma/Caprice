import { expect, test } from "bun:test";

import {
  bytesFromBase64,
  pageCanSpeak,
  pageListener,
  pageSpeaker,
  postSpeech,
  shellSpeaker,
  speechUnconfigured,
  ttsExchange,
  modelUnavailable,
  type SpeechCommands,
  type TtsEnv,
} from "./speech.ts";

test("shell audio is decoded before it is played", async () => {
  const played: number[][] = [];

  const speaker = shellSpeaker(spoken("AQID/w=="), async (bytes) => {
    played.push(Array.from(bytes));
  });

  await speaker.speak("  hey  ");
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
      "http",
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
      " http ",
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
    "",
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

  const woof = pageSpeaker(env, " woof ", post, async () => {});

  await expect(woof.speak("hey")).rejects.toThrow(
    "speech engine runs in the shell: woof",
  );
  expect(posts).toBe(0);
  expect(pageCanSpeak("")).toBe(true);
  expect(pageCanSpeak("   ")).toBe(true);
  expect(pageCanSpeak("http")).toBe(true);
  expect(pageCanSpeak(" http ")).toBe(true);
  expect(pageCanSpeak("woof")).toBe(false);
  expect(pageCanSpeak("HTTP")).toBe(false);
  expect(pageCanSpeak("https")).toBe(false);

  const http = pageSpeaker(env, " http ", post, async () => {});

  await http.speak("hey");
  expect(posts).toBe(1);
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

function encode(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return btoa(binary);
}
