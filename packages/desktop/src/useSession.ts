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
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";
import hostSkill from "../../../skills/host/SKILL.md?raw";
import leagueSkill from "../../../skills/league/SKILL.md?raw";

import { openCaprice, type CapriceDeps } from "./compose.ts";
import { listenAndSay, remarkAndSpeak, type TurnPace } from "./host.ts";
import { leagueIntegration, shellLeagueBridge } from "./league/league.ts";
import {
  abortableSleep,
  followMatch,
  liveMatchPath,
} from "./league/watchLeague.ts";
import {
  paceListener,
  paceText,
  type PaceMark,
  type PaceName,
  type PaceNote,
} from "./pace.ts";
import { stopPlayback } from "./playback.ts";
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
  pace: string;
  step: PaceName | "";
  stepAt: number;
};

type StartupName = "loading" | "ready" | "misconfigured";

export function useSession(): CapriceSession {
  const voice = useVoice();
  const session = useRef<Session | undefined>(undefined);
  const startup = useRef<StartupName>("loading");
  const [problem, setProblem] = useState("loading");
  const [hold, setHold] = useState<TalkHold | undefined>(undefined);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("idle");
  const [marks, setMarks] = useState<readonly PaceMark[]>([]);
  const [step, setStep] = useState<PaceName | "">("");
  const [stepAt, setStepAt] = useState(0);

  const note = useRef<PaceNote>({
    begin() {},
    end() {},
  });

  note.current = {
    begin(name) {
      setStep(name);
      setStepAt(performance.now());
    },
    end(name, ms) {
      setMarks((current) => [...current, { name, ms }]);
      setStep((current) => (current === name ? "" : current));
    },
  };

  useEffect(() => {
    let alive = true;
    const listener = paceListener(voice.listener, note, performance.now);

    const pace: TurnPace = {
      note: note.current,
      now: performance.now,
      watchVoice: voice.watchVoice,
    };

    let turnAbort: AbortController | undefined;
    const remarks = { current: new AbortController() };
    let phaseNow: TalkPhase = "idle";
    const watch = new AbortController();

    const stopRemark = () => {
      remarks.current.abort();
      remarks.current = new AbortController();
    };

    const stopTurn = () => {
      stopRemark();
      session.current?.cancel();
      listener.cancel();
      turnAbort?.abort();
      stopPlayback();
    };

    const next = holdToTalk(
      listener,
      async () => {
        const current = session.current;

        setMarks([]);
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
          listenAndSay(current, listener, voice.speaker, controller.signal, {
            ...pace,
            note: note.current,
          }),
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
        stopRemark();
        session.current?.cancel();
        next.press();
      },
      release() {
        next.release();
      },
    };

    setHold(hold);

    const unbind = bindTalk(hold, window);

    const unbindCancel = bindCancel(window, stopTurn);

    void openCaprice(browserDeps(rememberedEvents())).then(
      (opened) => {
        if (!alive) {
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

        startup.current = "ready";
        session.current = opened.session;
        setProblem("");

        if (!voice.inShell) {
          return;
        }

        void followMatch(
          () => invoke<string>("league_live", { path: liveMatchPath }),
          (cue, fallback) => {
            const current = session.current;

            if (current === undefined || phaseNow !== "idle") {
              return Promise.resolve(false);
            }

            const signal = remarks.current.signal;

            if (signal.aborted) {
              return Promise.resolve(false);
            }

            return remarkAndSpeak(
              current,
              voice.speaker,
              cue,
              fallback,
              signal,
            );
          },
          watch.signal,
          abortableSleep,
          () => Date.now(),
        );
      },
      () => {
        if (!alive) {
          return;
        }

        startup.current = "misconfigured";
        setProblem("the model is not configured");
      },
    );

    return () => {
      alive = false;
      watch.abort();
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
    pace: paceText(marks),
    step,
    stepAt,
  };
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

function browserDeps(remembered: readonly TranscriptEvent[]): CapriceDeps {
  const inShell = "__TAURI_INTERNALS__" in window;

  return {
    voiceSkill: skill,
    hostSkill,
    env: modelEnv(),
    inShell,
    readShell: () => invoke<ShellModelPayload>("model_endpoint"),
    postShell: postModel,
    postBrowser: postJson,
    remembered,
    integrations: [
      leagueIntegration(
        leagueSkill,
        shellLeagueBridge(
          inShell,
          (path) => invoke<string>("league_live", { path }),
          (request) => invoke<string>("league_lcu", { request }),
        ),
      ),
    ],
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
