import type { Session } from "@caprice/core";
import type { GameFollow, GameSpeak } from "@caprice/games";
import type { Speaker } from "@caprice/voice";

import { remarkAndSpeak } from "./host.ts";

export type RemarkHost = {
  session: () => Session | undefined;
  speaker: Speaker;
  idle: () => boolean;
};

export type RemarkSpeak = GameSpeak;

export type RemarkFollow = GameFollow;

export type MatchRemarks = {
  stop: () => void;
  follow: (followers: readonly RemarkFollow[]) => void;
};

export function openMatchRemarks(
  host: RemarkHost,
  signal: AbortSignal,
): MatchRemarks {
  let line = new AbortController();
  let busy = false;

  const speak: RemarkSpeak = async (cue, fallback) => {
    const current = host.session();
    const currentLine = line.signal;

    if (current === undefined || !host.idle() || busy || currentLine.aborted) {
      return false;
    }

    busy = true;

    try {
      return await remarkAndSpeak(
        current,
        host.speaker,
        cue,
        fallback,
        currentLine,
      );
    } finally {
      busy = false;
    }
  };

  return {
    stop() {
      line.abort();
      line = new AbortController();
    },
    follow(followers) {
      for (const follower of followers) {
        void follower(speak, signal);
      }
    },
  };
}
