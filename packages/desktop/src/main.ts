import {
  chatModel,
  httpChatClient,
  openSession,
  personaText,
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
  void sayAndSpeak(current, recording.speaker, text)
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
      inShell: "__TAURI_INTERNALS__" in window,
      readShell: () => invoke<ShellModelEndpoint>("model_endpoint"),
    },
  );

  session = openSession(
    personaText(skill),
    chatModel(httpChatClient(endpoint, postChat)),
    [],
  );
}

void start().catch((error) => {
  showProblem(
    error instanceof Error ? error.message : "the model is not configured",
  );
});
