import {
  chatModel,
  httpChatClient,
  ok,
  openSession,
  personaText,
  tryCatch,
  type Result,
  type Session,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { listenAndSay } from "./host.ts";
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
};

export function useSession(): CapriceSession {
  const session = useRef<Session | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const [hold, setHold] = useState<TalkHold | undefined>(undefined);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("idle");

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
    const next = holdToTalk(
      voice.listener,
      async () => {
        const current = session.current;

        if (current === undefined) {
          setProblem("the model is not configured");

          return;
        }

        const heard = await tryCatch(
          listenAndSay(current, voice.listener, voice.speaker),
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
      },
      setTalkPhase,
    );

    setHold(next);

    return bindTalk(next);
  }, []);

  return {
    problem,
    hold,
    talkPhase,
    hint: voice.hint,
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

  return ok(
    openSession(
      personaText(skill),
      chatModel(httpChatClient(loaded.value, postChat)),
      [],
      store === undefined ? [] : readThread(store),
    ),
  );
}
