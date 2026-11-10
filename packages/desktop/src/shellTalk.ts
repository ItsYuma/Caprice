import { tryCatch } from "@caprice/core";

import { talkChords, type TalkHold } from "./talk.ts";

export const talkPressEvent = "talk-press";
export const talkReleaseEvent = "talk-release";
export const talkCancelEvent = "talk-cancel";

export async function armTalk(
  accelerators: readonly string[],
  arm: (accelerator: string) => Promise<void>,
): Promise<readonly string[]> {
  const armed: string[] = [];

  for (const accelerator of accelerators) {
    const result = await tryCatch(arm(accelerator), "the talk key is taken");

    if (result.ok) {
      armed.push(accelerator);
    }
  }

  return armed;
}

export async function bindShellTalk(
  hold: TalkHold,
  cancel: () => void,
  listen: (name: string, run: () => void) => Promise<() => void>,
  arm: (accelerator: string) => Promise<void>,
  disarm: (accelerator: string) => Promise<void>,
): Promise<() => void> {
  const stops = [
    await listen(talkPressEvent, () => {
      hold.pressNow();
    }),
    await listen(talkReleaseEvent, () => {
      hold.release();
    }),
    await listen(talkCancelEvent, cancel),
  ];

  const armed = await armTalk(
    talkChords.map((chord) => chord.label),
    arm,
  );

  return () => {
    for (const stop of stops) {
      stop();
    }

    for (const accelerator of armed) {
      void disarm(accelerator);
    }
  };
}
