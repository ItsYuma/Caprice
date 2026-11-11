import { access } from "node:fs/promises";

import {
  capriceDataDir,
  commandEnv,
  configPath,
  containerCommand,
  devRelease,
  joinPath,
  launchEnv,
  platformOf,
  prependHomeBins,
  readConfig,
  tauriDevArgs,
  windowsCmakeCandidates,
  type LaunchEnv,
  type Platform,
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

  merged.path = prependHomeBins(platform, home, merged.path);
  const cmake = await cmakeBin(platform, merged.path);

  if (cmake.length > 0) {
    const separator = platform === "windows" ? ";" : ":";
    merged.path = `${cmake}${separator}${merged.path}`;
  }

  if (merged.modelUrl.length === 0 || merged.model.length === 0) {
    console.error(
      "Pass CAPRICE_MODEL_URL and CAPRICE_MODEL, or run scripts/install.sh so the chat endpoint is saved.",
    );
  }

  const container = saved?.container ?? "";
  const release = devRelease(process.argv);

  if (container.length > 0 && !insideFedora()) {
    const child = Bun.spawn(
      [
        "bash",
        "-lc",
        containerCommand(process.cwd(), container, merged, release),
      ],
      {
        cwd: process.cwd(),
        env: spawnEnv(),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    return child.exited;
  }

  apply(merged);

  const child = Bun.spawn([process.execPath, ...tauriDevArgs(release)], {
    cwd: process.cwd(),
    env: spawnEnv(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return child.exited;
}

function insideFedora(): boolean {
  if ((process.env.CAPRICE_CONTAINER ?? "").length > 0) {
    return true;
  }

  return (process.env.DISTROBOX_ENTER_PATH ?? "").length > 0;
}

function currentEnv(): LaunchEnv {
  return {
    modelUrl: process.env.CAPRICE_MODEL_URL ?? "",
    model: process.env.CAPRICE_MODEL ?? "",
    modelApiKey: process.env.CAPRICE_MODEL_API_KEY ?? "",
    modelProtocol: process.env.CAPRICE_MODEL_PROTOCOL ?? "",
    modelRuntime: process.env.CAPRICE_MODEL_RUNTIME ?? "",
    modelExecutable: process.env.CAPRICE_MODEL_EXECUTABLE ?? "",
    modelDeadlineMs: process.env.CAPRICE_MODEL_DEADLINE_MS ?? "",
    sttEngine: process.env.CAPRICE_STT_ENGINE ?? "",
    sttModel: process.env.CAPRICE_STT_MODEL ?? "",
    sttUrl: process.env.CAPRICE_STT_URL ?? "",
    sttDeadlineMs: process.env.CAPRICE_STT_DEADLINE_MS ?? "",
    ttsEngine: process.env.CAPRICE_TTS_ENGINE ?? "",
    ttsVoice: process.env.CAPRICE_TTS_VOICE ?? "",
    ttsUrl: process.env.CAPRICE_TTS_URL ?? "",
    ttsModel: process.env.CAPRICE_TTS_MODEL ?? "",
    ttsApiKey: process.env.CAPRICE_TTS_API_KEY ?? "",
    ttsDeadlineMs: process.env.CAPRICE_TTS_DEADLINE_MS ?? "",
    python: process.env.CAPRICE_PYTHON ?? "",
    path: process.env.PATH ?? "",
  };
}

function apply(env: LaunchEnv): void {
  setEnv("CAPRICE_MODEL_URL", env.modelUrl);
  setEnv("CAPRICE_MODEL", env.model);
  setEnv("CAPRICE_MODEL_API_KEY", env.modelApiKey);
  setEnv("CAPRICE_MODEL_PROTOCOL", env.modelProtocol);
  setEnv("CAPRICE_MODEL_RUNTIME", env.modelRuntime);
  setEnv("CAPRICE_MODEL_EXECUTABLE", env.modelExecutable);
  setEnv("CAPRICE_MODEL_DEADLINE_MS", env.modelDeadlineMs);
  setEnv("CAPRICE_STT_ENGINE", env.sttEngine);
  setEnv("CAPRICE_STT_MODEL", env.sttModel);
  setEnv("CAPRICE_STT_URL", env.sttUrl);
  setEnv("CAPRICE_STT_DEADLINE_MS", env.sttDeadlineMs);
  setEnv("CAPRICE_TTS_ENGINE", env.ttsEngine);
  setEnv("CAPRICE_TTS_VOICE", env.ttsVoice);
  setEnv("CAPRICE_TTS_URL", env.ttsUrl);
  setEnv("CAPRICE_TTS_MODEL", env.ttsModel);
  setEnv("CAPRICE_TTS_API_KEY", env.ttsApiKey);
  setEnv("CAPRICE_TTS_DEADLINE_MS", env.ttsDeadlineMs);
  setEnv("CAPRICE_PYTHON", env.python);
  setEnv("PATH", env.path);
}

async function cmakeBin(platform: Platform, path: string): Promise<string> {
  if (await cmakeOnPath(platform, path)) {
    return "";
  }

  if (platform !== "windows") {
    return "";
  }

  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";

  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  const discovered = await vswhereCmakeBin();

  const candidates =
    discovered.length > 0
      ? [discovered, ...windowsCmakeCandidates(programFiles, programFilesX86)]
      : windowsCmakeCandidates(programFiles, programFilesX86);

  for (const bin of candidates) {
    if (await isFile(joinPath("windows", bin, "cmake.exe"))) {
      return bin;
    }
  }

  return "";
}

async function cmakeOnPath(platform: Platform, path: string): Promise<boolean> {
  const separator = platform === "windows" ? ";" : ":";
  const name = platform === "windows" ? "cmake.exe" : "cmake";
  const parts = path.length === 0 ? [] : path.split(separator);

  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }

    if (await isFile(joinPath(platform, part, name))) {
      return true;
    }
  }

  return false;
}

async function vswhereCmakeBin(): Promise<string> {
  const vswhere = joinPath(
    "windows",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (!(await isFile(vswhere))) {
    return "";
  }

  const child = Bun.spawn(
    [vswhere, "-latest", "-products", "*", "-property", "installationPath"],
    { stdout: "pipe", stderr: "pipe" },
  );

  const code = await child.exited;

  if (code !== 0 || child.stdout === null) {
    return "";
  }

  const text = (await new Response(child.stdout).text()).trim();
  const install = text.split(/\r?\n/)[0]?.trim() ?? "";

  if (install.length === 0) {
    return "";
  }

  return joinPath(
    "windows",
    install,
    "Common7",
    "IDE",
    "CommonExtensions",
    "Microsoft",
    "CMake",
    "CMake",
    "bin",
  );
}

async function isFile(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function spawnEnv() {
  const entries: (readonly [string, string])[] = [];

  for (const key of Object.keys(process.env)) {
    const value = process.env[key];

    if (value === undefined) {
      continue;
    }

    entries.push([key, value]);
  }

  return Object.fromEntries(commandEnv(entries));
}

function setEnv(key: string, value: string): void {
  if (value.length === 0) {
    delete process.env[key];

    return;
  }

  process.env[key] = value;
}
