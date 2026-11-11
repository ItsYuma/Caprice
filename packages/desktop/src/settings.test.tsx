import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsForm } from "./Settings.tsx";
import {
  gamesFromText,
  gamesText,
  isCapriceSettings,
  isModelList,
  replyEngineOf,
  showsSettings,
  speechEngineOf,
  type CapriceSettings,
  type ModelEntry,
} from "./settings.ts";

const settings: CapriceSettings = {
  version: 1,
  modelUrl: "http://brain.example/v1/chat/completions",
  model: "local",
  modelApiKey: "",
  modelProtocol: "",
  modelRuntime: "",
  modelExecutable: "",
  modelDeadlineMs: "",
  sttEngine: "",
  sttModel: "",
  sttUrl: "",
  sttDeadlineMs: "",
  ttsEngine: "",
  ttsWoof: "",
  ttsVoice: "",
  ttsUrl: "http://speech.example/v1/audio/speech",
  ttsModel: "voice",
  ttsApiKey: "",
  ttsDeadlineMs: "",
  python: "",
  repo: "/work/caprice",
  container: "caprice",
  modelDirectory: "",
  recordingMode: "hold",
  vadSensitivity: 40,
  talkChord: "both",
  enabledGames: [],
  sttModelId: "",
  ttsModelId: "",
};

const parakeet: ModelEntry = {
  id: "parakeet-en.gguf",
  family: "parakeet",
  path: "/models/parakeet-en.gguf",
  bytes: 12,
  languages: ["en"],
  note: "Parakeet GGUF that this window streams while the key is held.",
  loadable: true,
  streaming: true,
  role: "stt",
};

test("settings parse the saved document and default the chord", () => {
  expect(showsSettings(false, "settings")).toBe(false);
  expect(showsSettings(true, "main")).toBe(false);
  expect(showsSettings(true, "settings")).toBe(true);
  expect(isCapriceSettings(settings)).toBe(true);
  expect(isCapriceSettings({ version: 1 })).toBe(false);
  expect(speechEngineOf("bark")).toBe("parakeet");
  expect(speechEngineOf("http")).toBe("http");
  expect(replyEngineOf("local")).toBe("http");
  expect(replyEngineOf("piper")).toBe("piper");
  expect(gamesFromText("league\n\n")).toEqual(["league"]);
  expect(gamesText(["league"])).toBe("league");
  expect(isModelList([parakeet])).toBe(true);
  expect(isModelList([{ id: "nope" }])).toBe(false);
});

test("the settings form lists a discovered model and the save control", () => {
  const html = renderToStaticMarkup(
    <SettingsForm
      settings={settings}
      models={[parakeet]}
      problem=""
      onSave={() => {}}
      onDirectory={() => {}}
    />,
  );

  expect(html).toContain(
    "Parakeet GGUF that this window streams while the key is held.",
  );
  expect(html).toContain("LLM");
  expect(html).toContain("Save");
  expect(html).toContain('value="40"');
});
