import {
  chatModel,
  httpChatClient,
  ok,
  openSession,
  personaText,
  tryCatch,
  type Line,
  type Result,
  type Session,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { listenAndSay, sayAndSpeak } from "./host.ts";
import { postChat } from "./postChat.ts";
import { bindTalk, holdToTalk, type TalkHold, type TalkPhase } from "./talk.ts";
import { windowVoice } from "./windowVoice.ts";

const voice = windowVoice();

export type CapriceSession = {
  lines: readonly Line[];
  problem: string;
  submit: (text: string) => boolean;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  talkHint: string;
  talkStatus: string;
};

export function useSession(): CapriceSession {
  const session = useRef<Session | undefined>(undefined);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [problem, setProblem] = useState("");
  const [hold, setHold] = useState<TalkHold | undefined>(undefined);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("idle");
  const [talkStatus, setTalkStatus] = useState("");

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

        setTalkStatus("Listening");

        const heard = await tryCatch(
          listenAndSay(current, voice.listener, voice.speaker),
          "the model request failed",
        );

        setLines(current.lines());

        if (!heard.ok) {
          setTalkStatus("");
          setProblem(heard.error.message);

          return;
        }

        if (heard.value === undefined) {
          setTalkStatus("didn't catch that");

          return;
        }

        if (!heard.value.ok) {
          setTalkStatus("");
          setProblem(heard.value.error.message);

          return;
        }

        setTalkStatus("");
        setProblem("");
      },
      setTalkPhase,
    );

    setHold(next);

    return bindTalk(next);
  }, []);

  function submit(text: string): boolean {
    const current = session.current;
    const trimmed = text.trim();

    if (current === undefined || trimmed.length === 0) {
      return false;
    }

    void send(current, trimmed);

    return true;
  }

  async function send(current: Session, text: string): Promise<void> {
    const line = await sayAndSpeak(current, voice.speaker, text);

    setLines(current.lines());

    if (!line.ok) {
      setProblem(line.error.message);

      return;
    }

    setProblem("");
  }

  return {
    lines,
    problem,
    submit,
    hold,
    talkPhase,
    talkHint: voice.hint,
    talkStatus,
  };
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

  return ok(
    openSession(
      personaText(skill),
      chatModel(httpChatClient(loaded.value, postChat)),
      [],
    ),
  );
}
