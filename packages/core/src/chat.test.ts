import { expect, test } from "bun:test";

import {
  chatModel,
  httpChatClient,
  messagesFromTurn,
  readAssistantContent,
  readModelEndpoint,
} from "./chat.ts";

test("persona is the system message and the current line is not repeated", () => {
  const messages = messagesFromTurn({
    persona: "## Voice\nbe capri",
    lines: [
      { who: "host", text: "wake up" },
      { who: "capri", text: "hm" },
      { who: "host", text: "again" },
    ],
    hostText: "again",
  });

  expect(messages).toEqual([
    { role: "system", content: "## Voice\nbe capri" },
    { role: "user", content: "wake up" },
    { role: "assistant", content: "hm" },
    { role: "user", content: "again" },
  ]);
});

test("host text is sent when the lines do not already end with it", () => {
  const messages = messagesFromTurn({
    persona: "voice",
    lines: [],
    hostText: "hello",
  });

  expect(messages).toEqual([
    { role: "system", content: "voice" },
    { role: "user", content: "hello" },
  ]);
});

test("endpoint comes only from the environment", () => {
  expect(
    readModelEndpoint({
      CAPRICE_MODEL_URL: " http://brain.example:9/v1/chat/completions ",
      CAPRICE_MODEL: " brain-a ",
      CAPRICE_MODEL_API_KEY: "secret",
    }),
  ).toEqual({
    url: "http://brain.example:9/v1/chat/completions",
    model: "brain-a",
    apiKey: "secret",
  });

  expect(() =>
    readModelEndpoint({
      CAPRICE_MODEL_URL: undefined,
      CAPRICE_MODEL: "brain-a",
      CAPRICE_MODEL_API_KEY: undefined,
    }),
  ).toThrow("CAPRICE_MODEL_URL is required");

  expect(() =>
    readModelEndpoint({
      CAPRICE_MODEL_URL: "http://brain.example/v1/chat/completions",
      CAPRICE_MODEL: " ",
      CAPRICE_MODEL_API_KEY: undefined,
    }),
  ).toThrow("CAPRICE_MODEL is required");
});

test("chat model returns the assistant content", async () => {
  const model = chatModel({
    async complete(completion) {
      expect(completion.messages[0]).toEqual({
        role: "system",
        content: "voice",
      });

      return "yo";
    },
  });

  const reply = await model.reply({
    persona: "voice",
    lines: [{ who: "host", text: "hi" }],
    hostText: "hi",
  });

  expect(reply).toEqual({ text: "yo" });
});

test("assistant content is the first choice message", () => {
  expect(
    readAssistantContent(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hey" } }],
      }),
    ),
  ).toBe("hey");

  expect(() => readAssistantContent("{}")).toThrow(
    "model response has no choices",
  );
  expect(() => readAssistantContent("[]")).toThrow(
    "model response is not an object",
  );
});

test("http client posts the configured url, model, and key", async () => {
  let method = "";
  let authorization = "";
  let contentType = "";
  let body = "";

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      method = request.method;
      authorization = request.headers.get("authorization") ?? "";
      contentType = request.headers.get("content-type") ?? "";
      body = await request.text();

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "from the brain" } }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });

  try {
    const url = new URL("/whatever/chat", server.url).href;

    const client = httpChatClient({
      url,
      model: "brain-b",
      apiKey: "token-b",
    });

    const text = await client.complete({
      messages: [
        { role: "system", content: "voice" },
        { role: "user", content: "hi" },
      ],
    });

    expect(text).toBe("from the brain");
    expect(method).toBe("POST");
    expect(authorization).toBe("Bearer token-b");
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      model: "brain-b",
      messages: [
        { role: "system", content: "voice" },
        { role: "user", content: "hi" },
      ],
    });
  } finally {
    server.stop(true);
  }
});

test("missing api key sends no authorization header", async () => {
  let authorization: string | null = "present";

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      authorization = request.headers.get("authorization");

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
      );
    },
  });

  try {
    const endpoint = readModelEndpoint({
      CAPRICE_MODEL_URL: new URL("/chat", server.url).href,
      CAPRICE_MODEL: "brain-c",
      CAPRICE_MODEL_API_KEY: undefined,
    });

    const text = await httpChatClient(endpoint).complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(text).toBe("ok");
    expect(endpoint.apiKey).toBe("");
    expect(authorization).toBeNull();
  } finally {
    server.stop(true);
  }
});
