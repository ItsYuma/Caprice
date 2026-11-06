import {
  chatModel,
  httpChatClient,
  openSession,
  personaText,
  type Session,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";
import skill from "../../../skills/capri/SKILL.md?raw";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { listenAndSay, sayAndSpeak } from "./host.ts";
import {
  pageListener,
  pageSpeaker,
  playSpeech,
  postSpeech,
  shellListener,
  shellSpeaker,
  speechHint,
  tauriCommands,
  type SpeechBridge,
  type TtsEnv,
} from "./speech.ts";
import {
  bindTalk,
  bindTalkButton,
  holdToTalk,
  talkChordLabel,
} from "./talk.ts";

const inShell = "__TAURI_INTERNALS__" in window;
const commands = inShell ? tauriCommands(speechBridge()) : undefined;

const listener =
  commands === undefined ? pageListener() : shellListener(commands);

const speaker =
  commands === undefined
    ? pageSpeaker(ttsEnv(), postSpeech, playSpeech)
    : shellSpeaker(commands, playSpeech);

const log = document.querySelector("#log");
const form = document.querySelector("#say");
const field = document.querySelector("#host");
const talkButton = document.querySelector("#talk");
const talkHint = document.querySelector("#talk-hint");
const talkStatus = document.querySelector("#talk-status");

let session: Session | undefined;

if (talkHint instanceof HTMLElement) {
  talkHint.textContent = speechHint(inShell);
}

if (talkButton instanceof HTMLButtonElement) {
  talkButton.setAttribute("aria-keyshortcuts", talkChordLabel());
}

function paint(): void {
  if (session === undefined || !(log instanceof HTMLElement)) {
    return;
  }

  log.replaceChildren();

  for (const line of session.lines()) {
    const row = document.createElement("p");
    row.dataset.who = line.who;
    row.textContent = line.text;
    log.append(row);
  }
}

function showProblem(text: string): void {
  if (!(log instanceof HTMLElement)) {
    return;
  }

  const row = document.createElement("p");
  row.textContent = text;
  log.append(row);
}

function setStatus(text: string): void {
  if (talkStatus instanceof HTMLElement) {
    talkStatus.textContent = text;
  }
}

async function postChat(
  url: string,
  body: string,
  apiKey: string,
): Promise<string> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<string>("model_complete", { url, body, apiKey });
  }

  const headers = new Headers({ "content-type": "application/json" });

  if (apiKey.length > 0) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const response = await fetch(url, { method: "POST", headers, body });

  if (!response.ok) {
    throw new Error(`model request failed: ${response.status}`);
  }

  return response.text();
}

const hold = holdToTalk(
  listener,
  async () => {
    const current = session;

    if (current === undefined) {
      showProblem("the model is not configured");

      return;
    }

    setStatus("Listening");

    try {
      const line = await listenAndSay(current, listener, speaker);
      paint();

      if (line === undefined) {
        setStatus("didn't catch that");

        return;
      }

      setStatus("");
    } catch (error) {
      paint();
      setStatus("");
      showProblem(
        error instanceof Error ? error.message : "the model request failed",
      );
    }
  },
  (phase) => {
    if (talkButton instanceof HTMLButtonElement) {
      talkButton.dataset.phase = phase;
    }
  },
);

bindTalk(hold);

if (talkButton instanceof HTMLButtonElement) {
  bindTalkButton(talkButton, hold);
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  const current = session;

  if (current === undefined || !(field instanceof HTMLInputElement)) {
    return;
  }

  const text = field.value.trim();

  if (text.length === 0) {
    return;
  }

  field.value = "";
  setStatus("");
  void sayAndSpeak(current, speaker, text)
    .then(() => {
      paint();
    })
    .catch((error) => {
      paint();
      showProblem(
        error instanceof Error ? error.message : "the model request failed",
      );
    });
});

async function start(): Promise<void> {
  const endpoint = await loadModelEndpoint(
    {
      CAPRICE_MODEL_URL: import.meta.env.CAPRICE_MODEL_URL,
      CAPRICE_MODEL: import.meta.env.CAPRICE_MODEL,
      CAPRICE_MODEL_API_KEY: import.meta.env.CAPRICE_MODEL_API_KEY,
    },
    {
      inShell,
      readShell: () => invoke<ShellModelEndpoint>("model_endpoint"),
    },
  );

  session = openSession(
    personaText(skill),
    chatModel(httpChatClient(endpoint, postChat)),
    [],
  );
}

function ttsEnv(): TtsEnv {
  return {
    CAPRICE_TTS_URL: import.meta.env.CAPRICE_TTS_URL,
    CAPRICE_TTS_MODEL: import.meta.env.CAPRICE_TTS_MODEL,
    CAPRICE_TTS_VOICE: import.meta.env.CAPRICE_TTS_VOICE,
    CAPRICE_TTS_API_KEY: import.meta.env.CAPRICE_TTS_API_KEY,
  };
}

function speechBridge(): SpeechBridge {
  return {
    async run(command) {
      await invoke(command);
    },
    text(command) {
      return invoke<string>(command);
    },
    speak(command, text) {
      return invoke<string>(command, { text });
    },
  };
}

void start().catch((error) => {
  showProblem(
    error instanceof Error ? error.message : "the model is not configured",
  );
});
