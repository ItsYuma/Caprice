import {
  fail,
  postJson,
  tryCatch,
  type ModelEnv,
  type Session,
  type ShellModelPayload,
  type TranscriptEvent,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";
import hostSkill from "../../../skills/host/SKILL.md?raw";

import { openCaprice, type CapriceDeps } from "./compose.ts";
import { readDetectedIds, readEnabledGames } from "./gameFlags.ts";
import { listenAndSay, type TurnPace } from "./host.ts";
import type { Integration } from "./integration.ts";
import { openMatchRemarks } from "./matchRemarks.ts";
import { paceListener, type PaceName, type PaceNote } from "./pace.ts";
import { stopPlayback } from "./playback.ts";
import { playing, type Playing } from "./playing.ts";
import { bindShellTalk } from "./shellTalk.ts";
import { postModel } from "./postChat.ts";
import {
  bindCancel,
  bindTalk,
  holdToTalk,
  type TalkHold,
  type TalkPhase,
} from "./talk.ts";
import { readThread, threadStore, writeThread } from "./thread.ts";
import { windowVoice, type WindowVoice } from "./windowVoice.ts";

export type CapriceSession = {
  problem: string;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  hint: string;
  step: PaceName | "";
};

type StartupName = "loading" | "ready" | "misconfigured";

export function useSession(): CapriceSession {
  const voice = useVoice();
  const session = useRef<Session | undefined>(undefined);
  const startup = useRef<StartupName>("loading");
  const [problem, setProblem] = useState("loading");
  const [hold, setHold] = useState<TalkHold | undefined>(undefined);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("idle");
  const [step, setStep] = useState<PaceName | "">("");

  const note = useRef<PaceNote>({
    begin() {},
    end() {},
  });

  note.current = {
    begin(name) {
      setStep(name);
    },
    end(name) {
      setStep((current) => (current === name ? "" : current));
    },
  };

  useEffect(() => {
    let alive = true;
    const listener = paceListener(voice.listener, note, readClock);

    const pace: TurnPace = {
      note: note.current,
      now: readClock,
      watchVoice: voice.watchVoice,
    };

    let turnAbort: AbortController | undefined;
    let phaseNow: TalkPhase = "idle";
    const watch = new AbortController();
    let followers = new AbortController();

    let games = playing({
      inShell: voice.inShell,
      enabled: [],
      detected: [],
    });

    let generation = 0;

    watch.signal.addEventListener("abort", () => {
      followers.abort();
    });

    const host = {
      session: () => session.current,
      speaker: voice.speaker,
      idle: () => phaseNow === "idle",
    };

    let remarks = openMatchRemarks(host, followers.signal);

    const stopTurn = () => {
      remarks.stop();
      session.current?.cancel();
      listener.cancel();
      turnAbort?.abort();
      stopPlayback();
    };

    const next = holdToTalk(
      listener,
      async () => {
        const current = session.current;

        setStep("");

        if (current === undefined) {
          if (startup.current === "loading") {
            setProblem("loading");
          }

          return;
        }

        const controller = new AbortController();
        turnAbort = controller;

        const heard = await tryCatch(
          listenAndSay(
            current,
            listener,
            voice.speaker,
            controller.signal,
            {
              ...pace,
              note: note.current,
            },
            async (text) => {
              const hear = games.hear;

              if (hear === undefined) {
                return undefined;
              }

              return hear(text);
            },
          ),
          "the model request failed",
        );

        if (turnAbort === controller) {
          turnAbort = undefined;
        }

        const saved = remember(current);

        if (!alive) {
          return;
        }

        if (!heard.ok) {
          setProblem(heard.error.message);

          return;
        }

        if (heard.value === undefined) {
          setProblem("didn't catch that");

          return;
        }

        if (!heard.value.ok) {
          setProblem(heard.value.error.message);

          return;
        }

        if (!saved.ok) {
          setProblem(saved.error.message);

          return;
        }

        setProblem("");
      },
      (phase) => {
        phaseNow = phase;
        setTalkPhase(phase);
      },
    );

    const hold: TalkHold = {
      phase: () => next.phase(),
      press() {
        remarks.stop();
        session.current?.cancel();
        next.press();
      },
      pressNow() {
        if (next.phase() === "idle" || next.phase() === "armed") {
          remarks.stop();
          session.current?.cancel();
        }

        next.pressNow();
      },
      release() {
        next.release();
      },
    };

    setHold(hold);

    let stopShell = () => {};

    if (voice.inShell) {
      void tryCatch(
        bindShellTalk(
          hold,
          stopTurn,
          async (name, run) => {
            const unlisten = await listen(name, () => {
              run();
            });

            return unlisten;
          },
          (accelerator) => invoke<void>("talk_arm", { accelerator }),
          (accelerator) => invoke<void>("talk_disarm", { accelerator }),
        ).then((stop) => {
          if (!alive) {
            stop();

            return;
          }

          stopShell = stop;
        }),
        "the talk key is taken",
      );
    }

    const unbind = bindTalk(hold, window);

    const unbindCancel = bindCancel(window, stopTurn);

    const publish = async (loaded: Playing) => {
      const mine = generation + 1;
      generation = mine;

      const remembered =
        session.current === undefined
          ? rememberedEvents()
          : session.current.events().slice();

      try {
        const opened = await openCaprice(
          browserDeps(remembered, voice.inShell, loaded.integrations),
        );

        if (!alive || mine !== generation) {
          if (opened.status === "ready") {
            opened.session.cancel();
          }

          return;
        }

        if (opened.status === "misconfigured") {
          startup.current = "misconfigured";
          setProblem(opened.message);

          return;
        }

        const previous = session.current;
        games = loaded;
        followers.abort();
        followers = new AbortController();
        remarks = openMatchRemarks(host, followers.signal);
        startup.current = "ready";
        session.current = opened.session;
        previous?.cancel();
        setProblem("");
        remarks.follow(loaded.remarks);
      } catch (caught) {
        if (!alive || mine !== generation) {
          return;
        }

        startup.current = "misconfigured";
        setProblem(caughtMessage(caught));
      }
    };

    const loadPlaying = async () => {
      try {
        if (!voice.inShell) {
          await publish(
            playing({
              inShell: false,
              enabled: [],
              detected: [],
            }),
          );

          return;
        }

        const [detectedRaw, enabledRaw] = await Promise.all([
          invokeText("games_detected"),
          invokeText("settings_get"),
        ]);

        if (!alive) {
          return;
        }

        await publish(
          playing({
            inShell: true,
            detected: readDetectedIds(detectedRaw),
            enabled: readEnabledGames(enabledRaw),
          }),
        );
      } catch (caught) {
        if (!alive) {
          return;
        }

        startup.current = "misconfigured";
        setProblem(caughtMessage(caught));
      }
    };

    void loadPlaying();

    let stopSettings = () => {};

    if (voice.inShell) {
      void tryCatch(
        listen("caprice-settings", () => {
          void loadPlaying();
        }).then((unlisten) => {
          if (!alive) {
            unlisten();

            return;
          }

          stopSettings = unlisten;
        }),
        "settings did not load",
      );
    }

    return () => {
      alive = false;
      watch.abort();
      stopSettings();
      stopShell();
      unbind();
      unbindCancel();
      stopTurn();
    };
  }, [voice]);

  return {
    problem,
    hold,
    talkPhase,
    hint: voice.hint,
    step,
  };
}

function caughtMessage(cause: unknown): string {
  if (isError(cause) && cause.message.length > 0) {
    return cause.message;
  }

  return "the model is not configured";
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

async function invokeText(command: string): Promise<string> {
  const result = await tryCatch(invoke<string>(command), "missing");

  if (!result.ok) {
    return "";
  }

  return result.value;
}

function readClock(): number {
  return performance.now();
}

function useVoice(): WindowVoice {
  const voice = useRef<WindowVoice | undefined>(undefined);

  if (voice.current === undefined) {
    voice.current = windowVoice();
  }

  return voice.current;
}

function rememberedEvents(): TranscriptEvent[] {
  const store = threadStore();

  if (store === undefined) {
    return [];
  }

  return readThread(store);
}

function remember(current: Session) {
  const store = threadStore();

  if (store === undefined) {
    return fail<boolean>("couldn't save the conversation");
  }

  return writeThread(store, current.events());
}

function browserDeps(
  remembered: readonly TranscriptEvent[],
  inShell: boolean,
  integrations: readonly Integration[],
): CapriceDeps {
  return {
    voiceSkill: skill,
    hostSkill,
    env: modelEnv(),
    inShell,
    readShell: () => invoke<ShellModelPayload>("model_endpoint"),
    postShell: postModel,
    postBrowser: postJson,
    remembered,
    integrations,
  };
}

function modelEnv(): ModelEnv {
  return {
    CAPRICE_MODEL_URL: import.meta.env.CAPRICE_MODEL_URL,
    CAPRICE_MODEL: import.meta.env.CAPRICE_MODEL,
    CAPRICE_MODEL_API_KEY: import.meta.env.CAPRICE_MODEL_API_KEY,
    CAPRICE_MODEL_PROTOCOL: import.meta.env.CAPRICE_MODEL_PROTOCOL,
  };
}
