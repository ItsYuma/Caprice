import {
  chatModel,
  httpChatClient,
  openSession,
  personaText,
  postJson,
  tryCatch,
  type Result,
  type Session,
} from "@caprice/core";
import { recordingSpeaker } from "@caprice/voice";
import { invoke } from "@tauri-apps/api/core";
import skill from "../../../skills/capri/SKILL.md?raw";

import { loadModelEndpoint, type ShellModelEndpoint } from "./endpoint.ts";
import { sayAndSpeak } from "./host.ts";

const recording = recordingSpeaker();
const log = document.querySelector("#log");
const form = document.querySelector("#say");
const field = document.querySelector("#host");

let session: Session | undefined;

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

async function postChat(
  url: string,
  body: string,
  apiKey: string,
): Promise<Result<string>> {
  if ("__TAURI_INTERNALS__" in window) {
    return tryCatch(
      invoke<string>("model_complete", { url, body, apiKey }),
      "the model request failed",
    );
  }

  return postJson(url, body, apiKey);
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
  void submitLine(current, text);
});

async function submitLine(current: Session, text: string): Promise<void> {
  const line = await sayAndSpeak(current, recording.speaker, text);

  paint();

  if (!line.ok) {
    showProblem(line.error.message);
  }
}

async function start(): Promise<void> {
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
    showProblem(loaded.error.message);

    return;
  }

  session = openSession(
    personaText(skill),
    chatModel(httpChatClient(loaded.value, postChat)),
    [],
  );
}

void start();
