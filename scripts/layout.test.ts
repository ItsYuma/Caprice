import { expect, test } from "bun:test";

import {
  barkDir,
  barkFileNames,
  capriceDataDir,
  commandEnv,
  configText,
  containerCommand,
  devRelease,
  filled,
  launchEnv,
  launcherPath,
  launcherText,
  prependHomeBins,
  tauriDevArgs,
  missingNames,
  parseSetupArgs,
  platformOf,
  readConfig,
  venvPython,
  woofDir,
  type CapriceConfig,
  type LaunchEnv,
  type SetupArgs,
} from "./layout.ts";

const home = "/Users/ada";

function isSetupArgs(value: SetupArgs | string): value is SetupArgs {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sample(repo: string): CapriceConfig {
  return {
    modelUrl: "http://brain.example/v1/chat/completions",
    model: "local",
    modelApiKey: "",
    sttEngine: "bark",
    sttModel: barkDir("linux", "/data/caprice"),
    ttsEngine: "woof",
    ttsWoof: woofDir("linux", "/data/caprice"),
    ttsVoice: "mira",
    python: "/data/caprice/python/bin/python3",
    repo,
    container: "",
  };
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

test("arguments accept flags and reject a voice the shell does not know", () => {
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

  expect(parsed.modelUrl).toBe("http://brain.example/v1/chat/completions");
  expect(parsed.model).toBe("local");
  expect(parsed.voice).toBe("mira");
  expect(parseSetupArgs(["--voice", "nova"])).toBe("unknown woof voice: nova");
  expect(parseSetupArgs(["--nope"])).toBe("unknown argument: --nope");
  expect(parseSetupArgs(["--help"])).toEqual({
    modelUrl: "",
    model: "",
    modelApiKey: "",
    voice: "",
    dataDir: "",
    python: "",
    container: "",
    help: true,
  });
  expect(parseSetupArgs(["--container", "caprice"])).toEqual({
    modelUrl: "",
    model: "",
    modelApiKey: "",
    voice: "",
    dataDir: "",
    python: "",
    container: "caprice",
    help: false,
  });
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
    sttEngine: "",
    sttModel: "",
    ttsEngine: "",
    ttsWoof: "",
    ttsVoice: "",
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
  const plainDev = containerCommand("/work/caprice", "caprice", merged);
  expect(plainDev).toContain("exec bun run dev");
  expect(plainDev.includes("--release")).toBe(false);
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
