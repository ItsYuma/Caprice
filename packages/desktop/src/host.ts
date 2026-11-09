import { tryCatch, type Line, type Result, type Session } from "@caprice/core";
import type { Listener, Speaker } from "@caprice/voice";

import type { PaceName, PaceNote } from "./pace.ts";

export type TurnPace = {
  note: PaceNote;
  now: () => number;
  watchVoice: (ready: (ms: number) => void) => () => void;
};

export async function sayAndSpeak(
  session: Session,
  speaker: Speaker,
  hostText: string,
  pace?: TurnPace,
): Promise<Result<Line>> {
  const line = await timed(pace, "reply", () => session.say(hostText));

  if (!line.ok) {
    return line;
  }

  if (line.value.text.length === 0) {
    return line;
  }

  const spoken = await tryCatch(
    voiced(pace, () => speaker.speak(line.value.text)),
    "the model request failed",
  );

  if (!spoken.ok) {
    return spoken;
  }

  return line;
}

export async function listenAndSay(
  session: Session,
  listener: Listener,
  speaker: Speaker,
  pace?: TurnPace,
): Promise<Result<Line> | undefined> {
  const heard = await listener.listen();
  const text = heard.text.trim();

  if (text.length === 0) {
    return undefined;
  }

  return sayAndSpeak(session, speaker, text, pace);
}

async function timed<T>(
  pace: TurnPace | undefined,
  name: PaceName,
  run: () => Promise<T>,
): Promise<T> {
  if (pace === undefined) {
    return run();
  }

  pace.note.begin(name);
  const started = pace.now();

  try {
    return await run();
  } finally {
    pace.note.end(name, Math.max(0, pace.now() - started));
  }
}

async function voiced(
  pace: TurnPace | undefined,
  speak: () => Promise<void>,
): Promise<void> {
  if (pace === undefined) {
    return speak();
  }

  pace.note.begin("voice");
  const started = pace.now();
  let closed = false;

  const stop = pace.watchVoice((ms) => {
    if (closed) {
      return;
    }

    closed = true;
    pace.note.end("voice", ms);
  });

  try {
    await speak();
  } finally {
    stop();

    if (!closed) {
      pace.note.end("voice", Math.max(0, pace.now() - started));
    }
  }
}
