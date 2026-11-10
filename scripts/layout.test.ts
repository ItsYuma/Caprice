import { expect, test } from "bun:test";

import {
  barkDir,
  barkFileNames,
  capriceDataDir,
  commandEnv,
  configText,
  containerCommand,
  filled,
  launchEnv,
  launcherPath,
  launcherText,
  missingNames,
  parseSetupArgs,
  planInstall,
  platformOf,
  prependHomeBins,
  readConfig,
  windowsCmakeCandidates,
  woofDir,
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
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsWoof: "",
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
    sttEngine: "bark",
    sttModel: barkDir("linux", "/data/caprice"),
    sttDeadlineMs: "",
    ttsEngine: "woof",
    ttsWoof: woofDir("linux", "/data/caprice"),
    ttsVoice: "mira",
    ttsUrl: "",
    ttsModel: "",
    ttsApiKey: "",
    ttsDeadlineMs: "",
    python: "/data/caprice/python/bin/python3",
    repo,
    container: "",
  };
}

function chatArgs(): SetupArgs {
  const args = blankArgs();
  args.modelUrl = chatUrl;
  args.model = "local";

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
  expect(woofDir("macos", "/data/caprice")).toBe(
    "/data/caprice/models/underdog-woof",
  );
  expect(barkDir("windows", "D:\\caprice")).toBe(
    "D:\\caprice\\models\\underdog-bark",
  );
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
  expect(missingNames(["config.json"], barkFileNames)).toEqual([
    "tokenizer.json",
    "model.safetensors",
  ]);
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
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsWoof: "",
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
  expect(containerCommand("/work/caprice", "caprice", merged)).toContain(
    "BASH_FUNC_",
  );
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

test("a fresh install uses bark and keeps a saved bark-stream", () => {
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

  expect(fresh.config.sttEngine).toBe("bark");
  expect(fresh.config.sttModel).toBe(barkDir("linux", "/data/caprice"));
  expect(fresh.config.ttsEngine).toBe("woof");
  expect(fresh.config.ttsWoof).toBe(woofDir("linux", "/data/caprice"));
  expect(fresh.config.ttsVoice).toBe("juno");
  expect(fresh.config.modelProtocol).toBe("");
  expect(fresh.config.modelDeadlineMs).toBe("");
  expect(fresh.config.sttDeadlineMs).toBe("");
  expect(fresh.config.ttsDeadlineMs).toBe("");
  expect(fresh.bark).toBe(true);
  expect(fresh.woof).toBe(true);

  const saved = sample("/work/caprice");
  saved.sttEngine = "bark-stream";
  saved.sttModel = "/models/bark";
  saved.ttsWoof = "/models/woof";
  saved.modelProtocol = "native";
  saved.sttDeadlineMs = "90000";
  saved.ttsDeadlineMs = "";

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

  expect(kept.config.sttEngine).toBe("bark-stream");
  expect(kept.config.sttModel).toBe("/models/bark");
  expect(kept.config.ttsWoof).toBe("/models/woof");
  expect(kept.config.modelProtocol).toBe("native");
  expect(kept.config.sttDeadlineMs).toBe("90000");
  expect(kept.config.ttsDeadlineMs).toBe("");
  expect(kept.bark).toBe(false);
  expect(kept.woof).toBe(false);
  expect(kept.python).toBe(true);

  const switched = chatArgs();
  switched.sttEngine = "parakeet";
  expect(
    planInstall(
      switched,
      saved,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("Pass --stt-model for the parakeet engine.");
  switched.sttModel = "/models/parakeet.gguf";

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

  expect(selected.config.sttEngine).toBe("parakeet");
  expect(selected.config.sttModel).toBe("/models/parakeet.gguf");
  expect(selected.config.ttsVoice).toBe("mira");
  expect(selected.bark).toBe(false);

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
  expect(
    planInstall(
      nova,
      undefined,
      blankEnv(),
      "linux",
      "/data/caprice",
      "/work/caprice",
    ),
  ).toBe("unknown woof voice: nova");

  const http = chatArgs();
  http.ttsEngine = "http";
  http.voice = "Mira";
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
  expect(spoken.woof).toBe(false);
  expect(spoken.bark).toBe(true);

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

test("a legacy config stays on bark-stream and windows cmake starts at BuildTools", () => {
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

  const plan = planInstall(
    chatArgs(),
    legacy,
    blankEnv(),
    "linux",
    "/data/caprice",
    "/work/caprice",
  );

  if (!isPlan(plan)) {
    throw new Error(plan);
  }

  expect(plan.config.version).toBe(1);
  expect(plan.config.sttEngine).toBe("bark-stream");
  expect(plan.config.sttModel).toBe("/models/bark");
  expect(plan.bark).toBe(false);
  expect(plan.woof).toBe(false);

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
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsWoof: "",
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
