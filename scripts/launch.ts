import {
  capriceDataDir,
  configPath,
  launchEnv,
  platformOf,
  readConfig,
  type LaunchEnv,
} from "./layout.ts";

if (import.meta.main) {
  const code = await launch();
  process.exit(code);
}

async function launch(): Promise<number> {
  const platform = platformOf(process.platform);

  if (platform === undefined) {
    console.error(`unsupported platform: ${process.platform}`);

    return 1;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const data = capriceDataDir(
    platform,
    home,
    process.env.XDG_DATA_HOME ?? "",
    process.env.LOCALAPPDATA ?? "",
  );

  const saved = readConfig(
    await Bun.file(configPath(platform, data))
      .text()
      .catch(() => ""),
  );

  const current = currentEnv();

  const merged =
    saved === undefined ? current : launchEnv(saved, current, platform);

  if (merged.modelUrl.length === 0 || merged.model.length === 0) {
    console.error(
      "Pass CAPRICE_MODEL_URL and CAPRICE_MODEL, or run scripts/install.sh so the chat endpoint is saved.",
    );
  }

  apply(merged);

  const child = Bun.spawn(
    [process.execPath, "run", "--filter", "@caprice/desktop", "tauri", "dev"],
    {
      cwd: process.cwd(),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  return child.exited;
}

function currentEnv(): LaunchEnv {
  return {
    modelUrl: process.env.CAPRICE_MODEL_URL ?? "",
    model: process.env.CAPRICE_MODEL ?? "",
    modelApiKey: process.env.CAPRICE_MODEL_API_KEY ?? "",
    sttEngine: process.env.CAPRICE_STT_ENGINE ?? "",
    sttModel: process.env.CAPRICE_STT_MODEL ?? "",
    ttsEngine: process.env.CAPRICE_TTS_ENGINE ?? "",
    ttsWoof: process.env.CAPRICE_TTS_WOOF ?? "",
    ttsVoice: process.env.CAPRICE_TTS_VOICE ?? "",
    python: process.env.CAPRICE_PYTHON ?? "",
    path: process.env.PATH ?? "",
  };
}

function apply(env: LaunchEnv): void {
  setEnv("CAPRICE_MODEL_URL", env.modelUrl);
  setEnv("CAPRICE_MODEL", env.model);
  setEnv("CAPRICE_MODEL_API_KEY", env.modelApiKey);
  setEnv("CAPRICE_STT_ENGINE", env.sttEngine);
  setEnv("CAPRICE_STT_MODEL", env.sttModel);
  setEnv("CAPRICE_TTS_ENGINE", env.ttsEngine);
  setEnv("CAPRICE_TTS_WOOF", env.ttsWoof);
  setEnv("CAPRICE_TTS_VOICE", env.ttsVoice);
  setEnv("CAPRICE_PYTHON", env.python);
  setEnv("PATH", env.path);
}

function setEnv(key: string, value: string): void {
  if (value.length === 0) {
    delete process.env[key];

    return;
  }

  process.env[key] = value;
}
