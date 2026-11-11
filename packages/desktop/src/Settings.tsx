import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import {
  gamesFromText,
  gamesText,
  isCapriceSettings,
  isModelList,
  replyEngineOf,
  speechEngineOf,
  type CapriceSettings,
  type ModelEntry,
  type ReplyEngine,
  type SpeechEngine,
} from "./settings.ts";

export type SettingsFormProps = {
  settings: CapriceSettings;
  models: readonly ModelEntry[];
  problem: string;
  onSave: (settings: CapriceSettings) => void;
  onDirectory: (directory: string) => void;
};

export function SettingsPage() {
  const [settings, setSettings] = useState<CapriceSettings | undefined>(
    undefined,
  );

  const [models, setModels] = useState<ModelEntry[]>([]);

  const [problem, setProblem] = useState("");

  useEffect(() => {
    let alive = true;

    void loadSettings().then(
      (loaded) => {
        if (!alive) {
          return;
        }

        setSettings(loaded.settings);
        setModels(loaded.models);
        setProblem("");
      },
      (cause: unknown) => {
        if (!alive) {
          return;
        }

        setProblem(failureText(cause));
      },
    );

    return () => {
      alive = false;
    };
  }, []);

  if (settings === undefined) {
    return (
      <main className="settings">
        <p>{problem.length > 0 ? problem : "Loading settings"}</p>
      </main>
    );
  }

  return (
    <SettingsForm
      settings={settings}
      models={models}
      problem={problem}
      onDirectory={(directory) => {
        void loadModels(directory).then(setModels, (cause: unknown) => {
          setProblem(failureText(cause));
        });
      }}
      onSave={(next) => {
        void saveSettings(next).then(
          (saved) => {
            setSettings(saved);
            setProblem("");
          },
          (cause: unknown) => {
            setProblem(failureText(cause));
          },
        );
      }}
    />
  );
}

export function SettingsForm(props: SettingsFormProps) {
  const [draft, setDraft] = useState(props.settings);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  const sttEngine = speechEngineOf(draft.sttEngine);
  const ttsEngine = replyEngineOf(draft.ttsEngine);
  const sttModels: ModelEntry[] = [];
  const ttsModels: ModelEntry[] = [];

  for (const model of props.models) {
    if (model.role === "stt") {
      sttModels.push(model);
    } else {
      ttsModels.push(model);
    }
  }

  return (
    <main className="settings">
      <h1>Settings</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave(draft);
        }}
      >
        <fieldset>
          <legend>Speech</legend>
          <label>
            Model directory
            <input
              value={draft.modelDirectory}
              onChange={(event) => {
                setDraft(withDirectory(draft, event.currentTarget.value));
              }}
              onBlur={() => {
                props.onDirectory(draft.modelDirectory);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              props.onDirectory(draft.modelDirectory);
            }}
          >
            Look up
          </button>
          <label>
            Speech engine
            <select
              value={sttEngine}
              onChange={(event) => {
                setDraft(withSttEngine(draft, event.currentTarget.value));
              }}
            >
              <option value="parakeet">Parakeet</option>
              <option value="http">HTTP</option>
            </select>
          </label>
          {sttEngine === "http" ? (
            <>
              <label>
                Speech URL
                <input
                  value={draft.sttUrl}
                  onChange={(event) => {
                    setDraft({ ...draft, sttUrl: event.currentTarget.value });
                  }}
                />
              </label>
              <label>
                Speech model
                <input
                  value={draft.sttModel}
                  onChange={(event) => {
                    setDraft({ ...draft, sttModel: event.currentTarget.value });
                  }}
                />
              </label>
            </>
          ) : (
            <ModelList
              models={sttModels}
              selected={draft.sttModelId}
              onSelect={(model) => {
                setDraft(withSttModel(draft, model));
              }}
            />
          )}
          <label>
            Reply engine
            <select
              value={ttsEngine}
              onChange={(event) => {
                setDraft(withTtsEngine(draft, event.currentTarget.value));
              }}
            >
              <option value="http">HTTP</option>
              <option value="piper">Piper</option>
              <option value="kokoro">Kokoro</option>
            </select>
          </label>
          {ttsEngine === "http" ? (
            <>
              <label>
                Reply URL
                <input
                  value={draft.ttsUrl}
                  onChange={(event) => {
                    setDraft({ ...draft, ttsUrl: event.currentTarget.value });
                  }}
                />
              </label>
              <label>
                Reply model
                <input
                  value={draft.ttsModel}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      ttsModel: event.currentTarget.value,
                    });
                  }}
                />
              </label>
              <label>
                Voice
                <input
                  value={draft.ttsVoice}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      ttsVoice: event.currentTarget.value,
                    });
                  }}
                />
              </label>
              <label>
                Reply API key
                <input
                  type="password"
                  value={draft.ttsApiKey}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      ttsApiKey: event.currentTarget.value,
                    });
                  }}
                />
              </label>
            </>
          ) : (
            <p>{ttsEngine} is not loaded yet.</p>
          )}
          {ttsModels.length > 0 ? (
            <ModelList
              models={ttsModels}
              selected={draft.ttsModelId}
              onSelect={(model) => {
                setDraft(withTtsModel(draft, model));
              }}
            />
          ) : null}
        </fieldset>
        <fieldset>
          <legend>LLM</legend>
          <label>
            Base URL
            <input
              value={draft.modelUrl}
              onChange={(event) => {
                setDraft({ ...draft, modelUrl: event.currentTarget.value });
              }}
            />
          </label>
          <label>
            Model name
            <input
              value={draft.model}
              onChange={(event) => {
                setDraft({ ...draft, model: event.currentTarget.value });
              }}
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={draft.modelApiKey}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  modelApiKey: event.currentTarget.value,
                });
              }}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Talk</legend>
          <label>
            Recording
            <select
              value={draft.recordingMode}
              onChange={(event) => {
                setDraft(withMode(draft, event.currentTarget.value));
              }}
            >
              <option value="hold">Hold to talk</option>
              <option value="vad">Voice activity</option>
            </select>
          </label>
          <label>
            VAD sensitivity
            <input
              type="range"
              min="0"
              max="100"
              value={draft.vadSensitivity}
              onChange={(event) => {
                setDraft(withSensitivity(draft, event.currentTarget.value));
              }}
            />
          </label>
          <label>
            Talk chord
            <select
              value={draft.talkChord}
              onChange={(event) => {
                setDraft(withChord(draft, event.currentTarget.value));
              }}
            >
              <option value="both">Alt+Space or Ctrl+Space</option>
              <option value="alt-space">Alt+Space</option>
              <option value="ctrl-space">Ctrl+Space</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Games</legend>
          <label>
            Enabled games
            <textarea
              value={gamesText(draft.enabledGames)}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  enabledGames: gamesFromText(event.currentTarget.value),
                });
              }}
            />
          </label>
        </fieldset>
        {props.problem.length > 0 ? <p id="problem">{props.problem}</p> : null}
        <button type="submit">Save</button>
      </form>
    </main>
  );
}

function ModelList(props: {
  models: readonly ModelEntry[];
  selected: string;
  onSelect: (model: ModelEntry) => void;
}) {
  return (
    <ul>
      {props.models.map((model) => (
        <li key={model.id}>
          <label>
            <input
              type="radio"
              name={model.role}
              checked={props.selected === model.id}
              disabled={model.role === "stt" && !model.loadable}
              onChange={() => {
                props.onSelect(model);
              }}
            />
            <span>{model.id}</span>
            <span>{model.note}</span>
            {model.languages.length > 0 ? (
              <span>{model.languages.join(", ")}</span>
            ) : null}
          </label>
        </li>
      ))}
    </ul>
  );
}

function withDirectory(
  settings: CapriceSettings,
  directory: string,
): CapriceSettings {
  return { ...settings, modelDirectory: directory };
}

function withSttEngine(
  settings: CapriceSettings,
  engine: string,
): CapriceSettings {
  const next: SpeechEngine = engine === "http" ? "http" : "parakeet";

  return { ...settings, sttEngine: next };
}

function withTtsEngine(
  settings: CapriceSettings,
  engine: string,
): CapriceSettings {
  const next: ReplyEngine = replyEngineOf(engine);

  return { ...settings, ttsEngine: next };
}

function withSttModel(
  settings: CapriceSettings,
  model: ModelEntry,
): CapriceSettings {
  return {
    ...settings,
    sttEngine: "parakeet",
    sttModel: model.path,
    sttModelId: model.id,
  };
}

function withTtsModel(
  settings: CapriceSettings,
  model: ModelEntry,
): CapriceSettings {
  const engine = replyEngineOf(model.family);

  return {
    ...settings,
    ttsEngine: engine,
    ttsModel: model.path,
    ttsModelId: model.id,
  };
}

function withMode(settings: CapriceSettings, mode: string): CapriceSettings {
  if (mode !== "hold" && mode !== "vad") {
    return settings;
  }

  return { ...settings, recordingMode: mode };
}

function withChord(settings: CapriceSettings, chord: string): CapriceSettings {
  if (chord !== "both" && chord !== "alt-space" && chord !== "ctrl-space") {
    return settings;
  }

  return { ...settings, talkChord: chord };
}

function withSensitivity(
  settings: CapriceSettings,
  raw: string,
): CapriceSettings {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return settings;
  }

  return { ...settings, vadSensitivity: value };
}

async function loadSettings(): Promise<{
  settings: CapriceSettings;
  models: ModelEntry[];
}> {
  const loaded: unknown = await invoke("settings_get");

  if (!isCapriceSettings(loaded)) {
    throw new Error("settings could not be read");
  }

  const models = await loadModels(loaded.modelDirectory);

  return { settings: loaded, models };
}

async function loadModels(directory: string): Promise<ModelEntry[]> {
  const listed: unknown = await invoke("models_list", { directory });

  if (!isModelList(listed)) {
    throw new Error("models could not be read");
  }

  return listed;
}

function failureText(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (isMessage(cause)) {
    return cause;
  }

  return "settings could not be saved";
}

function isMessage(cause: unknown): cause is string {
  return Object.prototype.toString.call(cause) === "[object String]";
}

async function saveSettings(
  settings: CapriceSettings,
): Promise<CapriceSettings> {
  const saved: unknown = await invoke("settings_put", { patch: settings });

  if (!isCapriceSettings(saved)) {
    throw new Error("settings could not be saved");
  }

  return saved;
}
