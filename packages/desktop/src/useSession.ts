import {
  chatModel,
  contractText,
  httpChatClient,
  ok,
  openSession,
  pendingLabel,
  personaText,
  tryCatch,
  type Line,
  type Result,
  type Session,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";
import hostSkill from "../../../skills/host/SKILL.md?raw";

import { leagueTools, shellLeagueBridge } from "./league.ts";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { listenAndSay, type TurnPace } from "./host.ts";
import {
  paceListener,
  paceText,
  type PaceMark,
  type PaceName,
  type PaceNote,
} from "./pace.ts";
import { postChat } from "./postChat.ts";
import { bindTalk, holdToTalk, type TalkHold, type TalkPhase } from "./talk.ts";
import { readThread, threadStore, writeThread } from "./thread.ts";
import { windowVoice } from "./windowVoice.ts";

const voice = windowVoice();

export type CapriceSession = {
  problem: string;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  hint: string;
  pace: string;
  step: PaceName | "";
  stepAt: number;
  ask: string;
  allow: () => void;
  refuse: () => void;
};

export function useSession(): CapriceSession {
  const session = useRef<Session | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const [hold, setHold] = useState<TalkHold | undefined>(undefined);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("idle");
  const [marks, setMarks] = useState<readonly PaceMark[]>([]);
  const [step, setStep] = useState<PaceName | "">("");
  const [stepAt, setStepAt] = useState(0);
  const [ask, setAsk] = useState("");

  function publishAsk(current: Session): void {
    const waiting = current.pending();

    setAsk(waiting === undefined ? "" : pendingLabel(waiting));
  }

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
    let current = true;

    void open().then((opened) => {
      if (!current) {
        return;
      }

      if (!opened.ok) {
        setProblem(opened.error.message);

        return;
      }

      session.current = opened.value;
    });

    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const listener = paceListener(voice.listener, note, performance.now);

    const pace: TurnPace = {
      note: note.current,
      now: performance.now,
      watchVoice: voice.watchVoice,
    };

    const next = holdToTalk(
      listener,
      async () => {
        const current = session.current;

        setMarks([]);
        setStep("");

        if (current === undefined) {
          setProblem("the model is not configured");

          return;
        }

        const heard = await tryCatch(
          listenAndSay(current, listener, voice.speaker, {
            ...pace,
            note: note.current,
          }),
          "the model request failed",
        );

        remember(current);

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

        setProblem("");
        publishAsk(current);
      },
      setTalkPhase,
    );

    setHold(next);

    return bindTalk(next);
  }, []);

  async function settle(
    run: (current: Session) => Promise<Result<Line>>,
  ): Promise<void> {
    const current = session.current;

    if (current === undefined) {
      setProblem("the model is not configured");

      return;
    }

    setTalkPhase("busy");

    let line: Result<Line>;

    try {
      line = await run(current);
    } catch {
      setTalkPhase("idle");
      setProblem("the model request failed");

      return;
    }

    setTalkPhase("idle");

    if (!line.ok) {
      setProblem(line.error.message);
      publishAsk(current);

      return;
    }

    setProblem("");
    publishAsk(current);
    remember(current);

    if (line.value.text.length === 0) {
      return;
    }

    const spoken = await tryCatch(
      voice.speaker.speak(line.value.text),
      "the model request failed",
    );

    if (!spoken.ok) {
      setProblem(spoken.error.message);
    }
  }

  return {
    problem,
    hold,
    talkPhase,
    hint: voice.hint,
    pace: paceText(marks),
    step,
    stepAt,
    ask,
    allow() {
      void settle((current) => current.allow());
    },
    refuse() {
      void settle((current) => current.refuse());
    },
  };
}

function remember(current: Session): void {
  const store = threadStore();

  if (store === undefined) {
    return;
  }

  writeThread(store, current.lines());
}

async function open(): Promise<Result<Session>> {
  const loaded = await tryCatch(
    loadModelEndpoint(
      {
        CAPRICE_MODEL_URL: import.meta.env.CAPRICE_MODEL_URL,
        CAPRICE_MODEL: import.meta.env.CAPRICE_MODEL,
        CAPRICE_MODEL_API_KEY: import.meta.env.CAPRICE_MODEL_API_KEY,
      },
      {
        inShell: "__TAURI_INTERNALS__" in window,
        readShell: () => invoke<ShellModelEndpoint>("model_endpoint"),
      },
    ),
    "the model is not configured",
  );

  if (!loaded.ok) {
    return loaded;
  }

  const store = threadStore();
  const inShell = "__TAURI_INTERNALS__" in window;

  return ok(
    openSession(
      `${personaText(skill)}\n\n${contractText(hostSkill)}`,
      chatModel(httpChatClient(loaded.value, postChat)),
      leagueTools(
        shellLeagueBridge(
          inShell,
          (path) => invoke<string>("league_live", { path }),
          (request) => invoke<string>("league_lcu", { request }),
        ),
      ),
      store === undefined ? [] : readThread(store),
    ),
  );
}
