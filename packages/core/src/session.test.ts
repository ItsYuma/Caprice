import { expect, test } from "bun:test";

import { requestBody } from "./chat.ts";
import { ok } from "./result.ts";
import {
  openSession,
  stubModel,
  toolTurnLimit,
  type Model,
  type ModelCall,
  type ModelOutput,
  type ModelTurn,
} from "./session.ts";
import type { Tool } from "./tool.ts";
import {
  toolResultLimit,
  threadLimit,
  type TranscriptEvent,
} from "./transcript.ts";

test("say records the user line and the assistant line", async () => {
  let persona = "";
  let request = "";

  const model: Model = {
    async complete(turn) {
      persona = turn.persona;
      request = turn.request;

      return ok({ kind: "message", text: "hi" });
    },
  };

  const session = openSession("be capri", model, []);
  const line = await session.say("wake up");

  expect(persona).toBe("be capri");
  expect(request).toBe("wake up");
  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "hi" },
  });
  expect(session.events()).toEqual([
    { kind: "user", text: "wake up" },
    { kind: "assistant", text: "hi" },
  ]);
});

test("events and tools are copies", async () => {
  const session = openSession("p", stubModel(), [note(async (input) => input)]);
  const said = await session.say("a");

  expect(said.ok).toBe(true);
  const events = session.events();
  const tools = session.tools();

  expect(events).not.toBe(session.events());
  expect(events).toEqual(session.events());
  expect(tools).not.toBe(session.tools());
  expect(tools.map((item) => item.name)).toEqual(["note"]);
});

test("a saved thread comes back and stays within the limit", async () => {
  const seen: TranscriptEvent[][] = [];

  const model: Model = {
    async complete(turn) {
      seen.push(turn.events.slice());

      return ok({ kind: "message", text: "n" });
    },
  };

  const prior: TranscriptEvent[] = [];

  for (let index = 0; index < 12; index += 1) {
    prior.push({ kind: "user", text: `h${index}` });
    prior.push({ kind: "assistant", text: `c${index}` });
  }

  const session = openSession("p", model, [], prior);

  expect(session.events()).toHaveLength(threadLimit);
  expect(session.events()[0]).toEqual({ kind: "user", text: "h2" });
  await session.say("next");
  expect(seen[0]?.at(-1)).toEqual({ kind: "user", text: "next" });
  expect(session.events()).toHaveLength(threadLimit);
  expect(prior).toHaveLength(24);
});

test("stub model quotes the request", async () => {
  const session = openSession("p", stubModel(), []);
  const line = await session.say("hello");

  expect(line.ok).toBe(true);

  if (!line.ok) {
    return;
  }

  expect(line.value.text).toContain("hello");
});

test("a tool call keeps the request and answers from the result", async () => {
  const seen: string[] = [];
  const requests: string[] = [];

  const replies: ModelOutput[] = [
    calls("note", "hi"),
    calls("note", "again"),
    { kind: "message", text: "done" },
  ];

  const model: Model = {
    async complete(turn) {
      requests.push(turn.request);

      return ok(replies.shift() ?? { kind: "message", text: "empty" });
    },
  };

  const session = openSession("p", model, [
    note(async (input) => {
      seen.push(input);

      return `saw ${input}`;
    }),
  ]);

  const answered = await session.say("look");

  expect(seen).toEqual(["hi", "again"]);
  expect(requests).toEqual(["look", "look", "look"]);
  expect(answered).toEqual({
    ok: true,
    value: { kind: "assistant", text: "done" },
  });
  expect(session.events()[0]).toEqual({ kind: "user", text: "look" });
  expect(session.events().at(-1)).toEqual({
    kind: "assistant",
    text: "done",
  });
  expect(session.events()[2]).toEqual({
    kind: "tool-result",
    id: "1",
    name: "note",
    ok: true,
    text: "saw hi",
  });
});

test("a tool result is clipped before it is kept", async () => {
  const model: Model = {
    async complete(turn) {
      const last = turn.events.at(-1);

      if (last?.kind === "tool-result") {
        return ok({ kind: "message", text: "done" });
      }

      return ok(calls("note", "hi"));
    },
  };

  const session = openSession("p", model, [
    note(async () => "x".repeat(toolResultLimit + 500)),
  ]);

  const answered = await session.say("look");
  const result = session.events()[2];

  expect(answered.ok).toBe(true);

  if (result?.kind !== "tool-result") {
    throw new Error("missing tool result");
  }

  expect(result.text.length).toBeLessThanOrEqual(toolResultLimit);
  expect(result.text.endsWith("[truncated]")).toBe(true);
});

test("the tool budget ends with one final answer", async () => {
  let runs = 0;
  let completes = 0;

  const model: Model = {
    async complete(turn) {
      completes += 1;

      if (!turn.acceptTools) {
        return ok({ kind: "message", text: "enough" });
      }

      return ok(calls("note", "hi"));
    },
  };

  const session = openSession("p", model, [
    note(async () => {
      runs += 1;

      return "ran";
    }),
  ]);

  const line = await session.say("look");

  expect(runs).toBe(toolTurnLimit);
  expect(completes).toBe(toolTurnLimit + 1);
  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "enough" },
  });
});

test("a model that keeps calling stops after the final answer", async () => {
  let runs = 0;
  let completes = 0;

  const model: Model = {
    async complete() {
      completes += 1;

      return ok(calls("note", "hi"));
    },
  };

  const session = openSession("p", model, [
    note(async () => {
      runs += 1;

      return "ran";
    }),
  ]);

  const line = await session.say("look");

  expect(runs).toBe(toolTurnLimit);
  expect(completes).toBe(toolTurnLimit + 1);
  expect(line.ok).toBe(false);

  if (line.ok) {
    return;
  }

  expect(line.error.message).toBe("too many tool calls");
});

test("a tool that throws is feedback the model can answer", async () => {
  const replies: ModelOutput[] = [
    calls("note", "hi"),
    { kind: "message", text: "it broke" },
  ];

  const session = openSession(
    "p",
    {
      async complete() {
        return ok(replies.shift() ?? { kind: "message", text: "empty" });
      },
    },
    [
      note(async () => {
        throw new Error("note broke");
      }),
    ],
  );

  const line = await session.say("look");
  const result = session.events()[2];

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "it broke" },
  });

  if (result?.kind !== "tool-result") {
    throw new Error("missing tool result");
  }

  expect(result.ok).toBe(false);
  expect(result.text).toBe("note broke");
});

test("an unknown tool call is feedback and is not the reply", async () => {
  const replies: ModelOutput[] = [
    calls("missing_tool", "later"),
    { kind: "message", text: "I can't" },
  ];

  const session = openSession(
    "p",
    {
      async complete() {
        return ok(replies.shift() ?? { kind: "message", text: "empty" });
      },
    },
    [],
  );

  const line = await session.say("hey");
  const result = session.events()[2];

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "I can't" },
  });

  if (result?.kind !== "tool-result") {
    throw new Error("missing tool result");
  }

  expect(result.ok).toBe(false);
  expect(result.text).toBe("no tool named missing_tool");
});

test("a request runs its action without an approval round", async () => {
  const seen: string[] = [];
  let completes = 0;

  const model: Model = {
    async complete(turn) {
      completes += 1;
      expect(turn.request).toBe("pick Yasuo");

      if (completes === 1) {
        return ok(
          calls(
            "league_lcu",
            'PATCH /lol-champ-select/v1/session/actions/3\n{"championId":157,"completed":true}',
          ),
        );
      }

      return ok({ kind: "message", text: "Yasuo." });
    },
  };

  const session = openSession("p", model, [
    {
      name: "league_lcu",
      description: "Change the League client.",
      kind: "action",
      parse(input) {
        return ok(input);
      },
      async run(input, context) {
        void context.request;
        seen.push(input);

        return "locked";
      },
    },
  ]);

  const line = await session.say("pick Yasuo");

  expect(completes).toBe(2);
  expect(seen).toEqual([
    'PATCH /lol-champ-select/v1/session/actions/3\n{"championId":157,"completed":true}',
  ]);
  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "Yasuo." },
  });
});

test("cancel keeps completed work and a later say can run", async () => {
  let completes = 0;
  let cancel = () => {};
  let armed = true;

  const session = openSession(
    "p",
    {
      async complete() {
        completes += 1;

        if (completes === 1) {
          return ok(calls("note", "hi"));
        }

        if (armed) {
          armed = false;
          cancel();

          return ok({ kind: "message", text: "late" });
        }

        return ok({ kind: "message", text: "hello back" });
      },
    },
    [note(async () => "ran")],
  );

  cancel = () => {
    session.cancel();
  };

  const line = await session.say("look");

  expect(line.ok).toBe(false);

  if (line.ok) {
    return;
  }

  expect(line.error.message).toBe("cancelled");
  expect(session.events()).toEqual([
    { kind: "user", text: "look" },
    { kind: "tool-call", id: "1", name: "note", input: "hi" },
    { kind: "tool-result", id: "1", name: "note", ok: true, text: "ran" },
  ]);
  expect(JSON.stringify(session.events())).not.toContain("late");

  const again = await session.say("hello");

  expect(again).toEqual({
    ok: true,
    value: { kind: "assistant", text: "hello back" },
  });
});

test("a second say while one is running does not start", async () => {
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const session = openSession(
    "p",
    {
      async complete() {
        await gate;

        return ok({ kind: "message", text: "one" });
      },
    },
    [],
  );

  const first = session.say("a");
  const second = await session.say("b");

  expect(second.ok).toBe(false);

  if (second.ok) {
    return;
  }

  expect(second.error.message).toBe("still working");
  release();

  const finished = await first;

  expect(finished).toEqual({
    ok: true,
    value: { kind: "assistant", text: "one" },
  });
});

test("cancel stops later tools and ignores a late result", async () => {
  let resolveTool = (_value: string) => {};
  let started = () => {};

  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });

  const ran: string[] = [];

  const session = openSession(
    "p",
    {
      async complete() {
        return ok({
          kind: "calls",
          calls: [
            { id: "1", name: "note", input: "first" },
            { id: "2", name: "note", input: "second" },
          ],
        });
      },
    },
    [
      note(async (input) => {
        ran.push(input);
        started();

        return new Promise((resolve) => {
          resolveTool = resolve;
        });
      }),
    ],
  );

  const pending = session.say("look");

  await ready;
  session.cancel();
  resolveTool("late");

  const line = await pending;

  expect(line.ok).toBe(false);

  if (line.ok) {
    return;
  }

  expect(line.error.message).toBe("cancelled");
  expect(ran).toEqual(["first"]);
  expect(session.events()).toEqual([
    { kind: "user", text: "look" },
    { kind: "tool-call", id: "1", name: "note", input: "first" },
    {
      kind: "tool-result",
      id: "1",
      name: "note",
      ok: false,
      text: "cancelled",
    },
  ]);
});

test("a synchronous model or tool throw is a result", async () => {
  const exploded = openSession(
    "p",
    {
      complete() {
        throw new Error("model exploded");
      },
    },
    [],
  );

  const boom = await exploded.say("hi");

  expect(boom.ok).toBe(false);

  if (boom.ok) {
    return;
  }

  expect(boom.error.message).toBe("model exploded");

  const replies: ModelOutput[] = [
    calls("note", "hi"),
    { kind: "message", text: "caught" },
  ];

  const session = openSession(
    "p",
    {
      async complete() {
        return ok(replies.shift() ?? { kind: "message", text: "empty" });
      },
    },
    [
      {
        name: "note",
        description: "Keep a note.",
        kind: "read",
        parse() {
          throw new Error("bad input");
        },
        async run() {
          return "no";
        },
      },
    ],
  );

  const line = await session.say("look");
  const result = session.events()[2];

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "caught" },
  });

  if (result?.kind !== "tool-result") {
    throw new Error("missing tool result");
  }

  expect(result.ok).toBe(false);
  expect(result.text).toBe("bad input");
});

test("extra native calls record the budget and stay paired", async () => {
  const ran: string[] = [];

  const callsOut: ModelCall[] = [
    { id: "a", name: "note", input: "1" },
    { id: "b", name: "note", input: "2" },
    { id: "c", name: "note", input: "3" },
    { id: "d", name: "note", input: "4" },
    { id: "e", name: "note", input: "5" },
  ];

  const session = openSession(
    "p",
    {
      async complete(turn) {
        for (const event of turn.events) {
          if (event.kind === "tool-result") {
            return ok({ kind: "message", text: "enough" });
          }
        }

        return ok({ kind: "calls", calls: callsOut });
      },
    },
    [
      note(async (input) => {
        ran.push(input);

        return input;
      }),
    ],
  );

  const line = await session.say("look");

  const body = JSON.parse(
    requestBody("brain", "native", wireTurn("look", session.events())),
  );

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "enough" },
  });
  expect(ran).toEqual(["1", "2", "3", "4"]);
  expect(paired(session.events())).toBe(true);

  const skipped = session.events().find((event) => {
    return event.kind === "tool-result" && event.id === "e";
  });

  if (skipped?.kind !== "tool-result") {
    throw new Error("missing budget result");
  }

  expect(skipped.ok).toBe(false);
  expect(skipped.text).toBe("too many tool calls");
  expect(toolIds(body.messages)).toEqual(["a", "b", "c", "d", "e"]);
});

function calls(name: string, input: string): ModelOutput {
  const call: ModelCall = { id: "1", name, input };

  return { kind: "calls", calls: [call] };
}

function wireTurn(
  request: string,
  events: readonly TranscriptEvent[],
): ModelTurn {
  return {
    persona: "p",
    request,
    events,
    tools: [],
    acceptTools: false,
    signal: new AbortController().signal,
  };
}

function paired(events: readonly TranscriptEvent[]): boolean {
  const open: string[] = [];

  for (const event of events) {
    if (event.kind === "tool-call") {
      open.push(event.id);
    }

    if (event.kind === "tool-result") {
      const index = open.indexOf(event.id);

      if (index < 0) {
        return false;
      }

      open.splice(index, 1);
    }
  }

  return open.length === 0;
}

type WireMessage = {
  role?: string;
  tool_calls?: readonly { id?: string }[];
  tool_call_id?: string;
};

function toolIds(messages: readonly WireMessage[]): string[] {
  const ids: string[] = [];
  let open: string[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls !== undefined) {
      if (open.length > 0) {
        throw new Error("orphan tool call");
      }

      open = [];

      for (const call of message.tool_calls) {
        const id = call.id ?? "";

        open.push(id);
        ids.push(id);
      }

      continue;
    }

    if (message.role === "tool") {
      const index = open.indexOf(message.tool_call_id ?? "");

      if (index < 0) {
        throw new Error("orphan tool result");
      }

      open.splice(index, 1);
    }
  }

  if (open.length > 0) {
    throw new Error("orphan tool call");
  }

  return ids;
}

function note(run: (input: string) => Promise<string>): Tool {
  return {
    name: "note",
    description: "Keep a note.",
    kind: "read",
    parse(input) {
      return ok(input);
    },
    async run(input, context) {
      void context.request;

      if (context.signal.aborted) {
        throw new Error("cancelled");
      }

      return run(input);
    },
  };
}
