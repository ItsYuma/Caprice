import { expect, test } from "bun:test";

import {
  chatModel,
  readAssistantContent,
  requestBody,
  toolInputFromArguments,
} from "./chat.ts";
import {
  postJson,
  readModelEndpoint,
  readShellModelConfig,
  type ModelEnv,
} from "./modelClient.ts";
import { ok } from "./result.ts";
import type { ModelTurn } from "./session.ts";
import type { ToolSpec } from "./tool.ts";
import type { TranscriptEvent } from "./transcript.ts";

const note: ToolSpec = {
  name: "note",
  description: "Keep a note.",
  kind: "read",
};

test("text requests keep the user line and do not send tools", () => {
  const body = JSON.parse(
    requestBody(
      "brain-a",
      "text",
      turn(
        "again",
        [
          { kind: "user", text: "wake up" },
          { kind: "assistant", text: "hm" },
          { kind: "user", text: "again" },
          {
            kind: "tool-call",
            id: "1",
            name: "note",
            input: "hi",
          },
          {
            kind: "tool-result",
            id: "1",
            name: "note",
            ok: true,
            text: "saw hi",
          },
        ],
        [note],
      ),
    ),
  );

  expect(body.tools).toBeUndefined();
  expect(body).toEqual({
    model: "brain-a",
    messages: [
      {
        role: "system",
        content: "voice\n\n## Tools\n\nnote (read)\nKeep a note.",
      },
      { role: "user", content: "wake up" },
      { role: "assistant", content: "hm" },
      { role: "user", content: "again" },
      { role: "user", content: "tool note\nsaw hi" },
    ],
  });
});

test("a missing user event is sent from the request", () => {
  const body = JSON.parse(requestBody("brain-a", "text", turn("hello", [])));

  expect(body.messages).toEqual([
    { role: "system", content: "voice" },
    { role: "user", content: "hello" },
  ]);
});

test("native requests send tools only while calls are accepted", () => {
  const open = JSON.parse(
    requestBody(
      "brain-a",
      "native",
      turn("hi", [{ kind: "user", text: "hi" }], [note], true),
    ),
  );

  const closed = JSON.parse(
    requestBody(
      "brain-a",
      "native",
      turn(
        "hi",
        [
          { kind: "user", text: "hi" },
          { kind: "tool-call", id: "call_1", name: "note", input: "yo" },
          {
            kind: "tool-result",
            id: "call_1",
            name: "note",
            ok: true,
            text: "saw",
          },
        ],
        [note],
        false,
      ),
    ),
  );

  expect(open.tools).toEqual([
    {
      type: "function",
      function: {
        name: "note",
        description: "read. Keep a note.",
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    },
  ]);
  expect(closed.tools).toBeUndefined();
  expect(closed.messages[0].content).toContain(
    "The tool budget for this turn is spent. Answer in words.",
  );
  expect(closed.messages[1]).toEqual({ role: "user", content: "hi" });
  expect(closed.messages[2].tool_calls).toEqual([
    {
      id: "call_1",
      type: "function",
      function: {
        name: "note",
        arguments: JSON.stringify({ input: "yo" }),
      },
    },
  ]);
  expect(closed.messages[3]).toEqual({
    role: "tool",
    tool_call_id: "call_1",
    content: "saw",
  });
  assertToolExchange(closed.messages);
});

test("native calls stay paired when grouped or split", () => {
  const grouped = JSON.parse(
    requestBody(
      "brain-a",
      "native",
      turn("hi", [
        { kind: "user", text: "hi" },
        { kind: "tool-call", id: "call_a", name: "note", input: "one" },
        { kind: "tool-call", id: "call_b", name: "note", input: "two" },
        {
          kind: "tool-result",
          id: "call_a",
          name: "note",
          ok: true,
          text: "saw one",
        },
        {
          kind: "tool-result",
          id: "call_b",
          name: "note",
          ok: true,
          text: "saw two",
        },
      ]),
    ),
  );

  const split = JSON.parse(
    requestBody(
      "brain-a",
      "native",
      turn("hi", [
        { kind: "user", text: "hi" },
        { kind: "tool-call", id: "call_a", name: "note", input: "one" },
        {
          kind: "tool-result",
          id: "call_a",
          name: "note",
          ok: true,
          text: "saw one",
        },
        { kind: "tool-call", id: "call_b", name: "note", input: "two" },
        {
          kind: "tool-result",
          id: "call_b",
          name: "note",
          ok: false,
          text: "too many tool calls",
        },
      ]),
    ),
  );

  expect(grouped.messages[2].tool_calls).toHaveLength(2);
  expect(split.messages[2].tool_calls).toHaveLength(1);
  expect(split.messages[4].tool_calls).toHaveLength(1);
  assertToolExchange(grouped.messages);
  assertToolExchange(split.messages);
});

test("endpoint and shell config keep the key out of the shell", () => {
  expect(
    readModelEndpoint({
      CAPRICE_MODEL_URL: " http://brain.example:9/v1/chat/completions ",
      CAPRICE_MODEL: " brain-a ",
      CAPRICE_MODEL_API_KEY: "secret",
      CAPRICE_MODEL_PROTOCOL: " native ",
    }),
  ).toEqual({
    url: "http://brain.example:9/v1/chat/completions",
    model: "brain-a",
    apiKey: "secret",
    protocol: "native",
  });

  const shell = {
    model: " shell-model ",
    protocol: "",
    apiKey: "secret",
  };

  expect(readShellModelConfig(shell)).toEqual({
    model: "shell-model",
    protocol: "text",
  });
  expect(Object.keys(readShellModelConfig(shell))).toEqual([
    "model",
    "protocol",
  ]);
  expect(
    readShellModelConfig({
      model: "shell-model",
      protocol: "native",
      timeoutMs: 1_500,
    }),
  ).toEqual({
    model: "shell-model",
    protocol: "native",
    timeoutMs: 1_500,
  });
  expect(() =>
    readShellModelConfig({ model: "shell-model", timeoutMs: 0 }),
  ).toThrow("model timeout is not valid");

  expect(() => readModelEndpoint(emptyEnv())).toThrow(
    "CAPRICE_MODEL_URL is required",
  );
  expect(() =>
    readModelEndpoint({
      ...emptyEnv(),
      CAPRICE_MODEL_URL: "http://brain.example/v1/chat/completions",
      CAPRICE_MODEL: " ",
    }),
  ).toThrow("CAPRICE_MODEL is required");
  expect(() =>
    readModelEndpoint({
      ...emptyEnv(),
      CAPRICE_MODEL_URL: "http://brain.example/v1/chat/completions",
      CAPRICE_MODEL: "brain-a",
      CAPRICE_MODEL_PROTOCOL: "tools",
    }),
  ).toThrow("CAPRICE_MODEL_PROTOCOL is text or native");
});

test("text protocol keeps call me later and ignores native tool calls", async () => {
  const model = chatModel("brain-a", "text", async () =>
    ok(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "call me later",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "note", arguments: '{"input":"hi"}' },
                },
              ],
            },
          },
        ],
      }),
    ),
  );

  const prose = await model.complete(
    turn("hey", [{ kind: "user", text: "hey" }], [note]),
  );

  expect(prose).toEqual({
    ok: true,
    value: { kind: "message", text: "call me later" },
  });

  const called = chatModel("brain-a", "text", async () =>
    ok(
      JSON.stringify({
        choices: [{ message: { content: "call note hi" } }],
      }),
    ),
  );

  const call = await called.complete(
    turn("hey", [{ kind: "user", text: "hey" }], [note]),
  );

  expect(call).toEqual({
    ok: true,
    value: {
      kind: "calls",
      calls: [{ id: "text-1", name: "note", input: "hi" }],
    },
  });

  const unknown = chatModel("brain-a", "text", async () =>
    ok(
      JSON.stringify({
        choices: [{ message: { content: "call missing_tool later" } }],
      }),
    ),
  );

  const missed = await unknown.complete(turn("hey", [], []));

  expect(missed).toEqual({
    ok: true,
    value: {
      kind: "calls",
      calls: [{ id: "text-1", name: "missing_tool", input: "later" }],
    },
  });
});

test("native protocol uses tool calls and leaves call me later as prose", async () => {
  const native = chatModel("brain-a", "native", async () =>
    ok(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "call me later",
              tool_calls: [
                {
                  id: "call_9",
                  type: "function",
                  function: {
                    name: "me",
                    arguments: '{"input":"later"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ),
  );

  const call = await native.complete(turn("hey", [], []));

  expect(call).toEqual({
    ok: true,
    value: {
      kind: "calls",
      calls: [{ id: "call_9", name: "me", input: "later" }],
    },
  });

  const prose = chatModel("brain-a", "native", async () =>
    ok(
      JSON.stringify({
        choices: [{ message: { content: "call me later" } }],
      }),
    ),
  );

  expect(await prose.complete(turn("hey", [], []))).toEqual({
    ok: true,
    value: { kind: "message", text: "call me later" },
  });
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
  expect(toolInputFromArguments('{"input":"/live"}')).toBe("/live");
  expect(toolInputFromArguments('"/live"')).toBe("/live");
  expect(toolInputFromArguments("/live")).toBe("/live");
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

    const model = chatModel("brain-b", "text", (posted, signal) =>
      postJson(url, posted, "token-b", signal),
    );

    const text = await model.complete(
      turn("hi", [{ kind: "user", text: "hi" }]),
    );

    expect(text).toEqual({
      ok: true,
      value: { kind: "message", text: "from the brain" },
    });
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
    expect(JSON.parse(body).tools).toBeUndefined();
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
      CAPRICE_MODEL_PROTOCOL: undefined,
    });

    const text = await chatModel(
      endpoint.model,
      endpoint.protocol,
      (body, signal) => postJson(endpoint.url, body, endpoint.apiKey, signal),
    ).complete(turn("hi", [{ kind: "user", text: "hi" }]));

    expect(text).toEqual({
      ok: true,
      value: { kind: "message", text: "ok" },
    });
    expect(endpoint.apiKey).toBe("");
    expect(authorization).toBeNull();
  } finally {
    server.stop(true);
  }
});

test("http client returns the status error", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("no", { status: 500 });
    },
  });

  try {
    const result = await chatModel("brain-d", "text", (body, signal) =>
      postJson(new URL("/chat", server.url).href, body, "", signal),
    ).complete(turn("hi", []));

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.message).toBe("model request failed: 500");
  } finally {
    server.stop(true);
  }
});

test("http client returns a parse error", async () => {
  const result = await chatModel("brain-e", "text", async () =>
    ok("{"),
  ).complete(turn("hi", []));

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error).toBeInstanceOf(SyntaxError);
});

test("a cancelled request does not wait for the model", async () => {
  const signal = new AbortController();

  signal.abort();

  const result = await postJson(
    "http://127.0.0.1:9/chat",
    "{}",
    "",
    signal.signal,
    5_000,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("cancelled");
});

test("a model request stops at the deadline", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise(() => undefined);
    },
  });

  try {
    const result = await postJson(
      new URL("/chat", server.url).href,
      "{}",
      "",
      new AbortController().signal,
      30,
    );

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.message).toBe("the model timed out");
  } finally {
    server.stop(true);
  }
});

function turn(
  request: string,
  events: readonly TranscriptEvent[],
  tools: readonly ToolSpec[] = [],
  acceptTools = true,
): ModelTurn {
  return {
    persona: "voice",
    request,
    events,
    tools,
    acceptTools,
    signal: new AbortController().signal,
  };
}

type WireMessage = {
  role?: string;
  tool_calls?: readonly { id?: string }[];
  tool_call_id?: string;
};

function assertToolExchange(messages: readonly WireMessage[]): void {
  let open: string[] = [];

  for (const message of messages) {
    const calls = message.tool_calls;

    if (message.role === "assistant" && calls !== undefined) {
      if (open.length > 0) {
        throw new Error("orphan tool call");
      }

      open = [];

      for (const call of calls) {
        open.push(call.id ?? "");
      }

      continue;
    }

    if (message.role === "tool") {
      const id = message.tool_call_id ?? "";
      const index = open.indexOf(id);

      if (index < 0) {
        throw new Error("orphan tool result");
      }

      open.splice(index, 1);

      continue;
    }

    if (open.length > 0) {
      throw new Error("orphan tool call");
    }
  }

  if (open.length > 0) {
    throw new Error("orphan tool call");
  }
}

function emptyEnv(): ModelEnv {
  return {
    CAPRICE_MODEL_URL: undefined,
    CAPRICE_MODEL: undefined,
    CAPRICE_MODEL_API_KEY: undefined,
    CAPRICE_MODEL_PROTOCOL: undefined,
  };
}
