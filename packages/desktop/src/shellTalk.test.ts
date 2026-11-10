import { expect, test } from "bun:test";

import {
  armTalk,
  bindShellTalk,
  talkCancelEvent,
  talkPressEvent,
  talkReleaseEvent,
} from "./shellTalk.ts";
import type { TalkHold } from "./talk.ts";

test("a taken chord does not block the other", async () => {
  const armed = await armTalk(
    ["Alt+Space", "Ctrl+Space"],
    async (accelerator) => {
      if (accelerator === "Alt+Space") {
        throw new Error("taken");
      }
    },
  );

  expect(armed).toEqual(["Ctrl+Space"]);
});

test("the shell hold presses, releases, and can stop", async () => {
  const heard: string[] = [];
  const hold = scriptedHold(heard);
  const listened: string[] = [];
  const armed: string[] = [];
  const disarmed: string[] = [];

  const stop = await bindShellTalk(
    hold,
    () => {
      heard.push("cancel");
    },
    async (name, run) => {
      listened.push(name);
      heard.push(name);
      run();

      return () => {
        heard.push(`stop ${name}`);
      };
    },
    async (accelerator) => {
      armed.push(accelerator);
    },
    async (accelerator) => {
      disarmed.push(accelerator);
    },
  );

  expect(listened).toEqual([talkPressEvent, talkReleaseEvent, talkCancelEvent]);
  expect(heard).toEqual([
    talkPressEvent,
    "press",
    talkReleaseEvent,
    "release",
    talkCancelEvent,
    "cancel",
  ]);
  expect(armed).toEqual(["Alt+Space", "Ctrl+Space"]);

  stop();

  await Promise.resolve();
  expect(disarmed).toEqual(["Alt+Space", "Ctrl+Space"]);
  expect(heard).toContain(`stop ${talkPressEvent}`);
});

function scriptedHold(heard: string[]): TalkHold {
  return {
    phase: () => "idle",
    press() {
      heard.push("press");
    },
    pressNow() {
      heard.push("press");
    },
    release() {
      heard.push("release");
    },
  };
}
