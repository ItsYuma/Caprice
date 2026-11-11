import type { GameFollow } from "@caprice/games";

import { tryCatch } from "./result.ts";
import { abortableSleep } from "./watchLeague.ts";
import { parseLobby } from "./lobbyAsk.ts";
import { lobbyCue, lobbyFallback } from "./lobbyCue.ts";
import {
  emptyMemory,
  runLobby,
  applyAsk,
  type LobbyCall,
  type LobbyFact,
  type LobbyMemory,
} from "./lobbyRun.ts";

export const lobbyPollMs = 1100;

export const lobbyIdlePollMs = 3000;

export type LobbyRoute = {
  cue: string;
  fallback: string;
};

export type LobbyDesk = {
  hear: (text: string) => Promise<LobbyRoute | undefined>;
  follow: GameFollow;
};

const cancelPath = "DELETE /lol-lobby/v2/lobby/matchmaking/search";

export function openLobby(
  lcu: LobbyCall,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = abortableSleep,
): LobbyDesk {
  let memory = emptyMemory();
  let unsaid: LobbyFact | undefined;
  let tail: Promise<void> = Promise.resolve();
  let wake = new AbortController();

  const kick = () => {
    const current = wake;
    wake = new AbortController();
    current.abort();
  };

  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run, run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  };

  const hear = async (text: string): Promise<LobbyRoute | undefined> => {
    const ask = parseLobby(text);

    if (ask === undefined) {
      return undefined;
    }

    const route = await exclusive(async () => {
      if (ask.cancel) {
        await tryCatch(lcu(cancelPath), "league client failed");
        const facts: LobbyFact[] = [{ kind: "cancelled" }];
        memory = {
          plan: undefined,
          champions: memory.champions,
          misses: 0,
          downTold: false,
        };
        unsaid = undefined;

        return {
          cue: lobbyCue(text, undefined, facts),
          fallback: lobbyFallback(undefined, facts),
        };
      }

      const earlier = unsaid;
      unsaid = undefined;
      memory = applyAsk(memory, ask);
      const stepped = await runLobby(memory, lcu);
      memory = stepped.memory;
      const facts: LobbyFact[] = [];

      if (earlier !== undefined) {
        facts.push(earlier);
      }

      if (stepped.fact !== undefined) {
        facts.push(stepped.fact);
      }

      return {
        cue: lobbyCue(text, stepped.snapshot, facts),
        fallback: lobbyFallback(stepped.snapshot, facts),
      };
    });

    kick();

    return route;
  };

  const follow: GameFollow = async (speak, signal) => {
    while (!signal.aborted) {
      const fact = await exclusive(async () => {
        if (unsaid !== undefined) {
          return unsaid;
        }

        if (memory.plan === undefined) {
          return undefined;
        }

        const stepped = await runLobby(memory, lcu);
        memory = stepped.memory;
        unsaid = stepped.fact;

        return unsaid;
      });

      if (signal.aborted) {
        return;
      }

      if (fact !== undefined) {
        const said = await speak(
          lobbyCue("", undefined, [fact]),
          lobbyFallback(undefined, [fact]),
        );

        if (said) {
          await exclusive(async () => {
            if (unsaid === fact) {
              unsaid = undefined;
            }
          });
        }
      }

      if (signal.aborted) {
        return;
      }

      const waiting = waitingOn(memory, unsaid);
      await sleepEither(
        waiting ? lobbyPollMs : lobbyIdlePollMs,
        signal,
        () => wake.signal,
        sleep,
      );
    }
  };

  return { hear, follow };
}

function waitingOn(
  memory: LobbyMemory,
  unsaid: LobbyFact | undefined,
): boolean {
  return memory.plan !== undefined || unsaid !== undefined;
}

async function sleepEither(
  ms: number,
  outer: AbortSignal,
  inner: () => AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const linked = new AbortController();
  const current = inner();

  const stop = () => {
    linked.abort();
  };

  outer.addEventListener("abort", stop);
  current.addEventListener("abort", stop);

  if (outer.aborted || current.aborted) {
    linked.abort();
  }

  try {
    await sleep(ms, linked.signal);
  } finally {
    outer.removeEventListener("abort", stop);
    current.removeEventListener("abort", stop);
  }
}
