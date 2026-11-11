import type { GameFollow } from "@caprice/games";

import { parseLiveMatch, type LiveMatch } from "./liveMatch.ts";
import { remarkCue, remarkFallback } from "./matchLine.ts";
import {
  freshWatch,
  markNoted,
  stepWatch,
  type Remark,
  type Watch,
} from "./matchWatch.ts";

export const liveMatchPath = "/liveclientdata/allgamedata";

export const matchPollMs = 1100;

export const matchIdlePollMs = 3000;

export const matchMissLimit = 4;

export const remarkGapMs = 12_000;

export const urgentGapMs = 4_000;

export function followLeague(read: () => Promise<string>): GameFollow {
  return (speak, signal) =>
    followMatch(read, speak, signal, abortableSleep, () => Date.now());
}

export async function followMatch(
  read: () => Promise<string>,
  speak: (cue: string, fallback: string) => Promise<boolean>,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  now: () => number,
): Promise<void> {
  let watch = freshWatch();
  let misses = 0;
  let spokenAt = -1;

  while (!signal.aborted) {
    const match = await readMatch(read);

    if (signal.aborted) {
      return;
    }

    if (match === undefined) {
      misses += 1;

      if (misses >= matchMissLimit) {
        watch = freshWatch();
        spokenAt = -1;
      }
    } else {
      misses = 0;
      const stepped = stepWatch(watch, match);
      watch = stepped.watch;

      if (
        stepped.remark !== undefined &&
        due(stepped.remark, spokenAt, now())
      ) {
        const said = await sayRemark(watch, match, stepped.remark, speak);

        if (said.spoken) {
          spokenAt = now();
          watch = said.watch;
        }
      }
    }

    if (signal.aborted) {
      return;
    }

    await sleep(watch.inMatch ? matchPollMs : matchIdlePollMs, signal);
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      signal.removeEventListener("abort", finish);
      resolve();
    };

    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function readMatch(
  read: () => Promise<string>,
): Promise<LiveMatch | undefined> {
  try {
    return parseLiveMatch(await read());
  } catch {
    return undefined;
  }
}

function due(remark: Remark, spokenAt: number, now: number): boolean {
  if (spokenAt < 0 || remark.kind === "ended") {
    return true;
  }

  const gap =
    remark.kind === "death" || remark.kind === "multikill"
      ? urgentGapMs
      : remarkGapMs;

  return now - spokenAt >= gap;
}

async function sayRemark(
  watch: Watch,
  match: LiveMatch,
  remark: Remark,
  speak: (cue: string, fallback: string) => Promise<boolean>,
): Promise<{ watch: Watch; spoken: boolean }> {
  try {
    const said = await speak(remarkCue(match, remark), remarkFallback(remark));

    if (!said) {
      return { watch, spoken: false };
    }

    if (remark.kind === "player") {
      return { watch: markNoted(watch, remark.key), spoken: true };
    }

    return { watch, spoken: true };
  } catch {
    return { watch, spoken: false };
  }
}
