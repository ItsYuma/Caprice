import { expect, test } from "bun:test";

import {
  capriceDataDir,
  commandEnv,
  configError,
  configText,
  containerCommand,
  devRelease,
  filled,
  launchEnv,
  launcherPath,
  launcherText,
  missingNames,
  modelsDir,
  parseSetupArgs,
  planInstall,
  platformOf,
  prependHomeBins,
  readConfig,
  tauriDevArgs,
  windowsCmakeCandidates,
  venvPython,
  type CapriceConfig,
  type ConfigEnv,
  type InstallPlan,
  type LaunchEnv,
  type SetupArgs,
} from "./layout.ts";

const home = "/Users/ada";

const chatUrl = "http://brain.example/v1/chat/completions";

function isSetupArgs(value: SetupArgs | string): value is SetupArgs {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isPlan(value: InstallPlan | string): value is InstallPlan {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function blankArgs(): SetupArgs {
  const parsed = parseSetupArgs([]);

  if (!isSetupArgs(parsed)) {
    throw new Error(parsed);
  }

  return parsed;
}

function blankEnv(): ConfigEnv {
  return {
    modelUrl: "",
    model: "",
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
    ttsVoice: "",
    ttsUrl: "",
    ttsModel: "",
    ttsApiKey: "",
    ttsDeadlineMs: "",
  };
}

function sample(repo: string): CapriceConfig {
  return {
    version: 1,
    modelUrl: chatUrl,
    model: "local",
    modelApiKey: "",
    modelProtocol: "",
    modelRuntime: "",
    modelExecutable: "",
    modelDeadlineMs: "",
    sttEngine: "parakeet",
    sttModel: "/models/parakeet.gguf",
    sttUrl: "",
    sttDeadlineMs: "",
    ttsEngine: "http",
    ttsWoof: "",
    ttsVoice: "mira",
    ttsUrl: "http://speech.example/v1/audio/speech",
    ttsModel: "voice",
    ttsApiKey: "",
    ttsDeadlineMs: "",
    python: "/data/caprice/python/bin/python3",
    repo,
    container: "",
    modelDirectory: "",
    recordingMode: "hold",
    vadSensitivity: 40,
    talkChord: "both",
    enabledGames: [],
    sttModelId: "",
    ttsModelId: "",
  };
}

function chatArgs(): SetupArgs {
  const args = blankArgs();
  args.modelUrl = chatUrl;
  args.model = "local";
  args.ttsUrl = "http://speech.example/v1/audio/speech";
  args.ttsModel = "voice";

  return args;
}

test("each platform has its own data directory", () => {
  expect(platformOf("linux")).toBe("linux");
  expect(platformOf("darwin")).toBe("macos");
  expect(platformOf("win32")).toBe("windows");
  expect(platformOf("freebsd")).toBeUndefined();
  expect(capriceDataDir("linux", home, "", "")).toBe(
    `${home}/.local/share/caprice`,
  );
  expect(capriceDataDir("linux", home, "/var/data", "")).toBe(
    "/var/data/caprice",
  );
  expect(capriceDataDir("macos", home, "", "")).toBe(
    `${home}/Library/Application Support/caprice`,
  );
  expect(
    capriceDataDir("windows", "C:\\Users\\ada", "", "D:\\AppData\\Local"),
  ).toBe("D:\\AppData\\Local\\caprice");
  expect(modelsDir("macos", "/data/caprice")).toBe("/data/caprice/models");
  expect(modelsDir("windows", "D:\\caprice")).toBe("D:\\caprice\\models");
  expect(venvPython("linux", "/data/caprice")).toBe(
    "/data/caprice/python/bin/python3",
  );
  expect(venvPython("windows", "D:\\caprice")).toBe(
    "D:\\caprice\\python\\Scripts\\python.exe",
  );
  expect(launcherPath("macos", "/data/caprice")).toBe("/data/caprice/run.sh");
  expect(launcherPath("windows", "D:\\caprice")).toBe("D:\\caprice\\run.ps1");
});

test("arguments accept flags and leave an http voice unchanged", () => {
  const parsed = parseSetupArgs([
    "--model-url=http://brain.example/v1/chat/completions",
    "--model",
    "local",
    "--voice",
    "Mira",
    "--skip-system",
  ]);

  if (!isSetupArgs(parsed)) {
    throw new Error(parsed);
  }

  expect(parsed.modelUrl).toBe(chatUrl);
  expect(parsed.model).toBe("local");
  expect(parsed.voice).toBe("Mira");
  expect(parseSetupArgs(["--nope"])).toBe("unknown argument: --nope");

  const help = blankArgs();
  help.help = true;
  expect(parseSetupArgs(["--help"])).toEqual(help);

  const container = blankArgs();
  container.container = "caprice";
  expect(parseSetupArgs(["--container", "caprice"])).toEqual(container);
});

test("a saved config fills only the values the command left empty", () => {
  expect(filled("  flag  ", "env", "file")).toBe("flag");
  expect(filled("", " env ", "file")).toBe("env");
  expect(filled(" ", " ", " file ")).toBe("file");
});

test("config json round-trips and the launcher returns to the repo", () => {
  const config = sample("/work/caprice");
  const text = configText(config);
  const read = readConfig(text);

  expect(read).toEqual(config);
  expect(readConfig('{"modelUrl":"u"}')?.container).toBe("");
  expect(readConfig('{"modelUrl":"u"}')?.version).toBe(1);
  expect(readConfig('{"version":2,"modelUrl":"u"}')).toBeUndefined();
  expect(readConfig("{")).toBeUndefined();
  expect(readConfig("[]")).toBeUndefined();
  expect(
    missingNames(["config.json"], ["tokenizer.json", "model.safetensors"]),
  ).toEqual(["tokenizer.json", "model.safetensors"]);
  expect(read?.recordingMode).toBe("hold");
  expect(read?.vadSensitivity).toBe(40);
  expect(read?.talkChord).toBe("both");
  expect(read?.enabledGames).toEqual([]);
  expect(launcherText("linux", "/work/caprice", "")).toContain(
    "cd '/work/caprice'",
  );
  expect(launcherText("linux", "/work/o'hara", "")).toContain(
    "cd '/work/o'\\''hara'",
  );
  expect(launcherText("windows", "C:\\work\\caprice", "caprice")).toContain(
    "Set-Location -LiteralPath 'C:\\work\\caprice'",
  );
  expect(launcherText("linux", "/work/caprice", "caprice")).toContain(
    "distrobox enter 'caprice'",
  );
  expect(launcherText("linux", "/work/caprice", "caprice")).toContain(
    "export CAPRICE_CONTAINER=1",
  );
});

test("a shell variable wins over the saved config and python stays on PATH", () => {
  const config = sample("/work/caprice");

  const current: LaunchEnv = {
    modelUrl: "http://other.example/v1/chat/completions",
    model: "",
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
    ttsVoice: "",
    ttsUrl: "",
    ttsModel: "",
    ttsApiKey: "",
    ttsDeadlineMs: "",
    python: "",
    path: "/usr/bin",
  };

  const merged = launchEnv(config, current, "linux");

  expect(merged.modelUrl).toBe("http://other.example/v1/chat/completions");
  expect(merged.model).toBe("local");
  expect(merged.ttsVoice).toBe("mira");
  expect(merged.python).toBe("/data/caprice/python/bin/python3");
  expect(merged.path).toBe("/data/caprice/python/bin:/usr/bin");
  expect(prependHomeBins("windows", "C:\\Users\\ada", "C:\\Windows")).toBe(
    "C:\\Users\\ada\\.cargo\\bin;C:\\Users\\ada\\.bun\\bin;C:\\Windows",
  );
  expect(
    prependHomeBins("linux", "/home/ada", "/home/ada/.cargo/bin:/usr/bin"),
  ).toBe("/home/ada/.bun/bin:/home/ada/.cargo/bin:/usr/bin");
  expect(launcherText("windows", "C:\\work\\caprice", "")).toContain(
    "$env:USERPROFILE\\.cargo\\bin",
  );
  expect(containerCommand("/work/caprice", "caprice", merged)).toContain(
    "CAPRICE_MODEL_URL='\\''http://other.example/v1/chat/completions'\\''",
  );
  expect(containerCommand("/work/caprice", "caprice", merged)).toContain(
    "CAPRICE_PYTHON='\\''/data/caprice/python/bin/python3'\\''",
  );
  expect(containerCommand("/work/caprice", "caprice", merged)).not.toContain(
    "CAPRICE_MODEL_DEADLINE_MS",
  );
  const plainDev = containerCommand("/work/caprice", "caprice", merged);
  expect(plainDev).toContain("exec bun run dev");
  expect(plainDev).not.toContain("--release");
  expect(containerCommand("/work/caprice", "caprice", merged, true)).toContain(
    "exec bun run dev -- --release",
  );
  expect(containerCommand("/work/caprice", "caprice", merged)).toContain(
    "BASH_FUNC_",
  );
  expect(devRelease(["bun", "scripts/launch.ts"])).toBe(false);
  expect(devRelease(["bun", "scripts/launch.ts", "--release"])).toBe(true);
  expect(tauriDevArgs(false)).toEqual([
    "run",
    "--filter",
    "@caprice/desktop",
    "tauri",
    "dev",
  ]);
  expect(tauriDevArgs(true)).toEqual([
    "run",
    "--filter",
    "@caprice/desktop",
    "tauri",
    "dev",
    "--release",
  ]);
  expect(
    commandEnv([
      ["PATH", "/usr/bin"],
      ["BASH_FUNC_which%%", "() { ( true; }"],
      ["HOME", "/home/ada"],
    ]),
  ).toEqual([
    ["PATH", "/usr/bin"],
    ["HOME", "/home/ada"],
  ]);
});

test("a fresh install uses parakeet and http, and a saved engine stays", () => {
  const fresh = planInstall(
    chatArgs(),
    undefined,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(fresh)) {
    throw new Error(fresh);
  }

  expect(fresh.config.sttEngine).toBe("");
  expect(fresh.config.sttModel).toBe("");
  expect(fresh.config.ttsEngine).toBe("");
  expect(fresh.config.ttsWoof).toBe("");
  expect(fresh.config.ttsVoice).toBe("");
  expect(fresh.config.ttsUrl).toBe("http://speech.example/v1/audio/speech");
  expect(fresh.config.modelProtocol).toBe("");
  expect(fresh.config.modelDeadlineMs).toBe("");
  expect(fresh.config.sttDeadlineMs).toBe("");
  expect(fresh.config.ttsDeadlineMs).toBe("");
  expect(fresh.config.recordingMode).toBe("hold");
  expect(fresh.config.vadSensitivity).toBe(40);
  expect(fresh.config.talkChord).toBe("both");
  expect(fresh.config.enabledGames).toEqual([]);

  const saved = sample("/work/caprice");
  saved.sttEngine = "parakeet";
  saved.sttModel = "/models/parakeet.gguf";
  saved.ttsWoof = "/models/old-tts";
  saved.modelProtocol = "native";
  saved.sttDeadlineMs = "90000";
  saved.ttsDeadlineMs = "";
  saved.recordingMode = "vad";
  saved.vadSensitivity = 15;
  saved.talkChord = "alt-space";
  saved.enabledGames = ["league"];

  const kept = planInstall(
    chatArgs(),
    saved,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(kept)) {
    throw new Error(kept);
  }

  expect(kept.config.sttEngine).toBe("parakeet");
  expect(kept.config.sttModel).toBe("/models/parakeet.gguf");
  expect(kept.config.ttsWoof).toBe("/models/old-tts");
  expect(kept.config.modelProtocol).toBe("native");
  expect(kept.config.sttDeadlineMs).toBe("90000");
  expect(kept.config.ttsDeadlineMs).toBe("");
  expect(kept.config.recordingMode).toBe("vad");
  expect(kept.config.vadSensitivity).toBe(15);
  expect(kept.config.talkChord).toBe("alt-space");
  expect(kept.config.enabledGames).toEqual(["league"]);

  const switched = chatArgs();
  switched.sttEngine = "http";
  expect(
    planInstall(
      switched,
      saved,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("Pass --stt-url and --stt-model for the http speech engine.");
  switched.sttModel = "remote-stt";
  switched.sttUrl = "http://stt.example/v1/audio";

  const selected = planInstall(
    switched,
    saved,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(selected)) {
    throw new Error(selected);
  }

  expect(selected.config.sttEngine).toBe("http");
  expect(selected.config.sttModel).toBe("remote-stt");
  expect(selected.config.sttUrl).toBe("http://stt.example/v1/audio");
  expect(selected.config.ttsVoice).toBe("mira");

  const around = blankEnv();
  around.modelProtocol = "native";
  const flagged = chatArgs();
  flagged.modelProtocol = "text";

  const protocol = planInstall(
    flagged,
    saved,
    around,
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(protocol)) {
    throw new Error(protocol);
  }

  expect(protocol.config.modelProtocol).toBe("text");
  flagged.modelProtocol = "";

  const fromEnv = planInstall(
    flagged,
    saved,
    around,
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(fromEnv)) {
    throw new Error(fromEnv);
  }

  expect(fromEnv.config.modelProtocol).toBe("native");
  around.modelProtocol = "";

  const fromFile = planInstall(
    flagged,
    saved,
    around,
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(fromFile)) {
    throw new Error(fromFile);
  }

  expect(fromFile.config.modelProtocol).toBe("native");
});

test("install rejects a bad deadline, voice, runtime, and speech pairing", () => {
  const deadline = chatArgs();
  deadline.modelDeadlineMs = "0";
  expect(
    planInstall(
      deadline,
      undefined,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("CAPRICE_MODEL_DEADLINE_MS is not a whole number of milliseconds");
  deadline.modelDeadlineMs = "1500";
  deadline.sttDeadlineMs = "180000";
  deadline.ttsDeadlineMs = "60000";

  const timed = planInstall(
    deadline,
    undefined,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(timed)) {
    throw new Error(timed);
  }

  expect(timed.config.modelDeadlineMs).toBe("1500");
  expect(timed.config.sttDeadlineMs).toBe("180000");
  expect(timed.config.ttsDeadlineMs).toBe("60000");

  const nova = chatArgs();
  nova.voice = "nova";

  const named = planInstall(
    nova,
    undefined,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(named)) {
    throw new Error(named);
  }

  expect(named.config.ttsVoice).toBe("nova");

  const http = chatArgs();
  http.ttsEngine = "http";
  http.voice = "Mira";
  http.ttsUrl = "";
  http.ttsModel = "";
  expect(
    planInstall(
      http,
      undefined,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("Pass --tts-url and --tts-model for the http reply engine.");
  http.ttsUrl = "http://speech.example/v1/audio/speech";
  http.ttsModel = "voice";

  const spoken = planInstall(
    http,
    undefined,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(spoken)) {
    throw new Error(spoken);
  }

  expect(spoken.config.ttsVoice).toBe("Mira");
  expect(spoken.config.ttsEngine).toBe("http");

  const ollama = chatArgs();
  ollama.modelRuntime = "ollama";
  expect(
    planInstall(
      ollama,
      undefined,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("CAPRICE_MODEL_EXECUTABLE is required");
  ollama.modelExecutable = "C:\\ollama\\ollama.exe";

  const managed = planInstall(
    ollama,
    undefined,
    blankEnv(),
    "windows",
    "D:\\caprice",
    "D:\\work",
  );

  if (!isPlan(managed)) {
    throw new Error(managed);
  }

  expect(managed.config.modelRuntime).toBe("ollama");
  expect(managed.config.modelExecutable).toBe("C:\\ollama\\ollama.exe");

  const secret = chatArgs();
  secret.modelUrl = "http://user:pass@brain.example/v1/chat/completions";
  expect(
    planInstall(
      secret,
      undefined,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("CAPRICE_MODEL_URL is not an http url");
});

test("a legacy config still parses and retired engines fail later", () => {
  const legacy = readConfig(
    JSON.stringify({
      modelUrl: chatUrl,
      model: "local",
      sttEngine: "bark-stream",
      sttModel: "/models/bark",
      ttsEngine: "woof",
      ttsWoof: "/models/woof",
      ttsVoice: "mira",
    }),
  );

  expect(legacy?.version).toBe(1);
  expect(legacy?.sttEngine).toBe("bark-stream");
  expect(legacy?.sttModel).toBe("/models/bark");
  expect(legacy?.ttsEngine).toBe("woof");
  expect(legacy?.ttsWoof).toBe("/models/woof");
  expect(legacy?.recordingMode).toBe("hold");
  expect(legacy?.vadSensitivity).toBe(40);
  expect(legacy?.talkChord).toBe("both");
  expect(legacy?.enabledGames).toEqual([]);

  if (legacy === undefined) {
    throw new Error("legacy config");
  }

  expect(configError(legacy)).toBe(
    "bark-stream is retired. Use parakeet or http.",
  );
  legacy.sttEngine = "parakeet";
  expect(configError(legacy)).toBe("woof is retired. Use http.");
  expect(
    planInstall(
      chatArgs(),
      legacy,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("woof is retired. Use http.");

  const bins = windowsCmakeCandidates(
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  );

  expect(bins[0]).toBe(
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin",
  );
  expect(bins).toContain(
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin",
  );
});

test("a saved deadline is forwarded only when it is set", () => {
  const config = sample("/work/caprice");
  config.modelProtocol = "native";
  config.modelDeadlineMs = "1500";
  config.sttDeadlineMs = "180000";

  const current: LaunchEnv = {
    modelUrl: "",
    model: "",
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
    ttsVoice: "",
    ttsUrl: "",
    ttsModel: "",
    ttsApiKey: "",
    ttsDeadlineMs: "",
    python: "",
    path: "/usr/bin",
  };

  const merged = launchEnv(config, current, "linux");
  const command = containerCommand("/work/caprice", "caprice", merged);

  expect(merged.modelProtocol).toBe("native");
  expect(merged.modelDeadlineMs).toBe("1500");
  expect(merged.sttDeadlineMs).toBe("180000");
  expect(merged.ttsDeadlineMs).toBe("");
  expect(command).toContain("CAPRICE_MODEL_PROTOCOL='\\''native'\\''");
  expect(command).toContain("CAPRICE_MODEL_DEADLINE_MS='\\''1500'\\''");
  expect(command).toContain("CAPRICE_STT_DEADLINE_MS='\\''180000'\\''");
  expect(command).not.toContain("CAPRICE_TTS_DEADLINE_MS");
});
