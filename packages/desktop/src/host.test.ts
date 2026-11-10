import {
  ok,
  openSession,
  stubModel,
  type Model,
  type ModelOutput,
  type Tool,
} from "@caprice/core";
import { recordingSpeaker, scriptedListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import {
  listenAndSay,
  remarkAndSpeak,
  sayAndSpeak,
  type TurnPace,
} from "./host.ts";
import type { PaceMark, PaceNote } from "./pace.ts";

const signal = new AbortController().signal;

test("a tool call is not spoken", async () => {
  const replies: ModelOutput[] = [
    {
      kind: "calls",
      calls: [{ id: "1", name: "note", input: "hi" }],
    },
    { kind: "message", text: "noted" },
  ];

  const model: Model = {
    async complete() {
      return ok(replies.shift() ?? { kind: "message", text: "empty" });
    },
  };

  const session = openSession("p", model, [noteTool(async (input) => input)]);

  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "look", signal);

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "noted" },
  });
  expect(recording.spoken()).toEqual(["noted"]);
});

test("sayAndSpeak speaks the capri line", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "yo", signal);

  expect(line.ok).toBe(true);

  if (!line.ok) {
    return;
  }

  expect(recording.spoken()).toEqual([line.value.text]);
});

test("listenAndSay feeds the heard line to say and speaks the reply", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();

  const line = await listenAndSay(
    session,
    scriptedListener(["yo"]),
    recording.speaker,
    signal,
  );

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "No model yet. You said: yo" },
  });
  expect(session.events()).toEqual([
    { kind: "user", text: "yo" },
    { kind: "assistant", text: "No model yet. You said: yo" },
  ]);
  expect(recording.spoken()).toEqual(["No model yet. You said: yo"]);
});

test("reply and voice are timed apart from playback", async () => {
  const session = openSession("p", stubModel(), []);
  const marks: PaceMark[] = [];
  let time = 10;

  const note: PaceNote = {
    begin() {},
    end(name, ms) {
      marks.push({ name, ms });
    },
  };

  const pace: TurnPace = {
    note,
    now: () => time,
    watchVoice(ready) {
      ready(40);

      return () => {};
    },
  };

  time = 25;

  const line = await sayAndSpeak(
    session,
    {
      async speak() {
        time = 90;
      },
    },
    "yo",
    signal,
    pace,
  );

  expect(line.ok).toBe(true);
  expect(marks).toEqual([
    { name: "reply", ms: 0 },
    { name: "voice", ms: 40 },
  ]);
});

test("listenAndSay drops a blank transcript before say", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();

  const line = await listenAndSay(
    session,
    scriptedListener(["   "]),
    recording.speaker,
    signal,
  );

  expect(line).toBeUndefined();
  expect(session.events()).toEqual([]);
  expect(recording.spoken()).toEqual([]);
});

test("a remark speaks the model line and strips a tag", async () => {
  const session = openSession(
    "p",
    {
      async complete() {
        return ok({
          kind: "message",
          text: "[excited] Draven again. Stop that. And another sentence.",
        });
      },
    },
    [],
  );

  const recording = recordingSpeaker();

  const spoken = await remarkAndSpeak(
    session,
    recording.speaker,
    "Live match. You died to Draven.",
    "You died. Rude.",
    signal,
  );

  expect(spoken).toBe(true);
  expect(recording.spoken()).toEqual(["Draven again. Stop that."]);
  expect(session.events()).toEqual([]);
});

test("a tool call during a remark speaks the fallback", async () => {
  let runs = 0;

  const session = openSession(
    "p",
    {
      async complete() {
        return ok({
          kind: "calls",
          calls: [{ id: "1", name: "note", input: "hi" }],
        });
      },
    },
    [
      noteTool(async () => {
        runs += 1;

        return "ran";
      }),
    ],
  );

  const recording = recordingSpeaker();

  const spoken = await remarkAndSpeak(
    session,
    recording.speaker,
    "Live match. You died.",
    "You died. Rude.",
    signal,
  );

  expect(spoken).toBe(true);
  expect(runs).toBe(0);
  expect(recording.spoken()).toEqual(["You died. Rude."]);
});

test("a cancelled remark stays quiet", async () => {
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const session = openSession(
    "p",
    {
      async complete() {
        await gate;

        return ok({ kind: "message", text: "late" });
      },
    },
    [],
  );

  const recording = recordingSpeaker();
  const controller = new AbortController();

  const pending = remarkAndSpeak(
    session,
    recording.speaker,
    "Live match.",
    "Match is up. Entertain me.",
    controller.signal,
  );

  controller.abort();
  release();

  expect(await pending).toBe(false);
  expect(recording.spoken()).toEqual([]);
  expect(session.events()).toEqual([]);
});

test("a lobby line is answered without tools and kept", async () => {
  let runs = 0;

  const session = openSession(
    "p",
    {
      async complete(turn) {
        const latest = turn.events.at(-1);

        if (latest?.kind === "user" && latest.text.startsWith("Lobby.")) {
          return ok({ kind: "message", text: "Queue's up." });
        }

        return ok({ kind: "message", text: "from say" });
      },
    },
    [
      noteTool(async () => {
        runs += 1;

        return "ran";
      }),
    ],
  );

  const recording = recordingSpeaker();

  const routed = await listenAndSay(
    session,
    scriptedListener(["find a match"]),
    recording.speaker,
    signal,
    undefined,
    async (text) => {
      if (text === "find a match") {
        return { cue: "Lobby. Started the queue.", fallback: "Queue's up." };
      }

      return undefined;
    },
  );

  expect(routed).toEqual({
    ok: true,
    value: { kind: "assistant", text: "Queue's up." },
  });
  expect(runs).toBe(0);
  expect(recording.spoken()).toEqual(["Queue's up."]);
  expect(session.events()).toEqual([
    { kind: "user", text: "find a match" },
    { kind: "assistant", text: "Queue's up." },
  ]);

  const open = await listenAndSay(
    session,
    scriptedListener(["hello"]),
    recording.speaker,
    signal,
    undefined,
    async () => undefined,
  );

  expect(open).toEqual({
    ok: true,
    value: { kind: "assistant", text: "from say" },
  });
});

function noteTool(run: (input: string) => Promise<string>): Tool {
  return {
    name: "note",
    description: "Keep a note.",
    kind: "read",
    parse(input) {
      return ok(input);
    },
    async run(input) {
      return run(input);
    },
  };
}
