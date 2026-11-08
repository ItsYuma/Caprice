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
import { recordingSpeaker } from "@caprice/voice";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import skill from "../../../skills/capri/SKILL.md?raw";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { sayAndSpeak } from "./host.ts";
import { postChat } from "./postChat.ts";

const recording = recordingSpeaker();

export type CapriceSession = {
  lines: readonly Line[];
  problem: string;
  submit: (text: string) => boolean;
};

export function useSession(): CapriceSession {
  const session = useRef<Session | undefined>(undefined);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [problem, setProblem] = useState("");

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
    const line = await sayAndSpeak(current, recording.speaker, text);

    setLines(current.lines());

    if (!line.ok) {
      setProblem(line.error.message);

      return;
    }

    setProblem("");
  }

  return { lines, problem, submit };
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
