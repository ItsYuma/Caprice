import { openSession, personaText, stubModel } from "@caprice/core";
import { recordingSpeaker } from "@caprice/voice";
import skill from "../../../skills/capri/SKILL.md?raw";

import { sayAndSpeak } from "./host.ts";

const session = openSession(personaText(skill), stubModel(), []);
const recording = recordingSpeaker();
const log = document.querySelector("#log");
const form = document.querySelector("#say");
const field = document.querySelector("#host");

function paint(): void {
  if (!(log instanceof HTMLElement)) {
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

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!(field instanceof HTMLInputElement)) {
    return;
  }

  const text = field.value.trim();

  if (text.length === 0) {
    return;
  }

  field.value = "";
  void sayAndSpeak(session, recording.speaker, text).then(() => {
    paint();
  });
});
