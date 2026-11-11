export const bunVersion = "1.4.4";

export const configVersion = 1;

const deadlineLimit = 18446744073709551615n;

export type Platform = "linux" | "macos" | "windows";

export type CapriceConfig = {
  version: 1;
  modelUrl: string;
  model: string;
  modelApiKey: string;
  modelProtocol: string;
  modelRuntime: string;
  modelExecutable: string;
  modelDeadlineMs: string;
  sttEngine: string;
  sttModel: string;
  sttUrl: string;
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsWoof: string;
  ttsVoice: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
  python: string;
  repo: string;
  container: string;
  modelDirectory: string;
  recordingMode: string;
  vadSensitivity: number;
  talkChord: string;
  enabledGames: string[];
  sttModelId: string;
  ttsModelId: string;
};

export type SetupArgs = {
  modelUrl: string;
  model: string;
  modelApiKey: string;
  modelProtocol: string;
  modelRuntime: string;
  modelExecutable: string;
  modelDeadlineMs: string;
  voice: string;
  sttEngine: string;
  sttModel: string;
  sttUrl: string;
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
  dataDir: string;
  python: string;
  container: string;
  help: boolean;
};

export type ConfigEnv = {
  modelUrl: string;
  model: string;
  modelApiKey: string;
  modelProtocol: string;
  modelRuntime: string;
  modelExecutable: string;
  modelDeadlineMs: string;
  sttEngine: string;
  sttModel: string;
  sttUrl: string;
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsVoice: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
};

export type InstallPlan = {
  config: CapriceConfig;
};

export function platformOf(osName: string): Platform | undefined {
  if (osName === "linux") {
    return "linux";
  }

  if (osName === "darwin") {
    return "macos";
  }

  if (osName === "win32") {
    return "windows";
  }

  return undefined;
}

export function capriceDataDir(
  platform: Platform,
  home: string,
  xdgDataHome: string,
  localAppData: string,
): string {
  if (platform === "windows") {
    const base =
      localAppData.length > 0
        ? localAppData
        : joinPath(platform, home, "AppData", "Local");

    return joinPath(platform, base, "caprice");
  }

  if (platform === "macos") {
    return joinPath(
      platform,
      home,
      "Library",
      "Application Support",
      "caprice",
    );
  }

  const base =
    xdgDataHome.length > 0
      ? xdgDataHome
      : joinPath(platform, home, ".local", "share");

  return joinPath(platform, base, "caprice");
}

export function joinPath(
  platform: Platform,
  ...parts: readonly string[]
): string {
  const separator = platform === "windows" ? "\\" : "/";
  let path = "";

  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }

    if (path.length === 0) {
      path = part;

      continue;
    }

    const root = part.startsWith("/") || part.startsWith("\\");

    if (root) {
      path = part;

      continue;
    }

    const glued = path.endsWith("/") || path.endsWith("\\");
    path = glued ? `${path}${part}` : `${path}${separator}${part}`;
  }

  return path;
}

export function modelsDir(platform: Platform, data: string): string {
  return joinPath(platform, data, "models");
}

export function venvDir(platform: Platform, data: string): string {
  return joinPath(platform, data, "python");
}

export function prependHomeBins(
  platform: Platform,
  home: string,
  path: string,
): string {
  return prependMissing(
    platform,
    [
      joinPath(platform, home, ".cargo", "bin"),
      joinPath(platform, home, ".bun", "bin"),
    ],
    path,
  );
}

export function windowsCmakeCandidates(
  programFiles: string,
  programFilesX86: string,
): string[] {
  const roots = [programFilesX86, programFiles];
  const years = ["2022", "18"];
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  const bins: string[] = [];

  for (const root of roots) {
    if (root.length === 0) {
      continue;
    }

    for (const year of years) {
      for (const edition of editions) {
        bins.push(
          joinPath(
            "windows",
            root,
            "Microsoft Visual Studio",
            year,
            edition,
            "Common7",
            "IDE",
            "CommonExtensions",
            "Microsoft",
            "CMake",
            "CMake",
            "bin",
          ),
        );
      }
    }
  }

  return bins;
}

export function venvPython(platform: Platform, data: string): string {
  if (platform === "windows") {
    return joinPath(platform, venvDir(platform, data), "Scripts", "python.exe");
  }

  return joinPath(platform, venvDir(platform, data), "bin", "python3");
}

export function configPath(platform: Platform, data: string): string {
  return joinPath(platform, data, "config.json");
}

export function launcherPath(platform: Platform, data: string): string {
  if (platform === "windows") {
    return joinPath(platform, data, "run.ps1");
  }

  return joinPath(platform, data, "run.sh");
}

export function missingNames(
  present: readonly string[],
  required: readonly string[],
): string[] {
  const missing: string[] = [];

  for (const name of required) {
    let found = false;

    for (const have of present) {
      if (have === name) {
        found = true;
      }
    }

    if (!found) {
      missing.push(name);
    }
  }

  return missing;
}

export function parseSetupArgs(argv: readonly string[]): SetupArgs | string {
  const args = emptyArgs();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const next = argv[index + 1] ?? "";

    if (token === "--help" || token === "-h") {
      args.help = true;

      continue;
    }

    if (token === "--skip-system") {
      continue;
    }

    const matched = takeFlag(token, next);

    if (matched === "unknown") {
      return `unknown argument: ${token}`;
    }

    if (matched !== undefined) {
      assignFlag(args, matched.key, matched.value);
      index += matched.ate;
    }
  }

  return args;
}

export function filled(
  flag: string,
  fromEnv: string,
  fromFile: string,
): string {
  return choose(flag, fromEnv, fromFile, "");
}

export function choose(
  flag: string,
  fromEnv: string,
  saved: string | undefined,
  fallback: string,
): string {
  const chosen = flag.trim();

  if (chosen.length > 0) {
    return chosen;
  }

  const env = fromEnv.trim();

  if (env.length > 0) {
    return env;
  }

  if (saved !== undefined) {
    return saved.trim();
  }

  return fallback;
}

export function planInstall(
  args: SetupArgs,
  previous: CapriceConfig | undefined,
  env: ConfigEnv,
  platform: Platform,
  data: string,
  repo: string,
): InstallPlan | string {
  const sttEngine = choose(
    args.sttEngine,
    env.sttEngine,
    saved(previous, (item) => item.sttEngine),
    "",
  );

  const sttModel = choose(
    args.sttModel,
    env.sttModel,
    sameEngine(previous?.sttEngine, sttEngine)
      ? saved(previous, (item) => item.sttModel)
      : undefined,
    "",
  );

  const ttsEngine = choose(
    args.ttsEngine,
    env.ttsEngine,
    saved(previous, (item) => item.ttsEngine),
    "",
  );

  const config: CapriceConfig = {
    version: configVersion,
    modelUrl: choose(
      args.modelUrl,
      env.modelUrl,
      saved(previous, (item) => item.modelUrl),
      "",
    ),
    model: choose(
      args.model,
      env.model,
      saved(previous, (item) => item.model),
      "",
    ),
    modelApiKey: choose(
      args.modelApiKey,
      env.modelApiKey,
      saved(previous, (item) => item.modelApiKey),
      "",
    ),
    modelProtocol: choose(
      args.modelProtocol,
      env.modelProtocol,
      saved(previous, (item) => item.modelProtocol),
      "",
    ),
    modelRuntime: choose(
      args.modelRuntime,
      env.modelRuntime,
      saved(previous, (item) => item.modelRuntime),
      "",
    ),
    modelExecutable: choose(
      args.modelExecutable,
      env.modelExecutable,
      saved(previous, (item) => item.modelExecutable),
      "",
    ),
    modelDeadlineMs: choose(
      args.modelDeadlineMs,
      env.modelDeadlineMs,
      saved(previous, (item) => item.modelDeadlineMs),
      "",
    ),
    sttEngine,
    sttModel,
    sttUrl: choose(
      args.sttUrl,
      env.sttUrl,
      saved(previous, (item) => item.sttUrl),
      "",
    ),
    sttDeadlineMs: choose(
      args.sttDeadlineMs,
      env.sttDeadlineMs,
      saved(previous, (item) => item.sttDeadlineMs),
      "",
    ),
    ttsEngine,
    ttsWoof: previous?.ttsWoof ?? "",
    ttsVoice: choose(
      args.voice,
      env.ttsVoice,
      saved(previous, (item) => item.ttsVoice),
      "",
    ),
    ttsUrl: choose(
      args.ttsUrl,
      env.ttsUrl,
      saved(previous, (item) => item.ttsUrl),
      "",
    ),
    ttsModel: choose(
      args.ttsModel,
      env.ttsModel,
      saved(previous, (item) => item.ttsModel),
      "",
    ),
    ttsApiKey: choose(
      args.ttsApiKey,
      env.ttsApiKey,
      saved(previous, (item) => item.ttsApiKey),
      "",
    ),
    ttsDeadlineMs: choose(
      args.ttsDeadlineMs,
      env.ttsDeadlineMs,
      saved(previous, (item) => item.ttsDeadlineMs),
      "",
    ),
    python: choose(
      args.python,
      "",
      saved(previous, (item) => item.python),
      "",
    ),
    repo,
    container: choose(
      args.container,
      "",
      saved(previous, (item) => item.container),
      "",
    ),
    modelDirectory: previous?.modelDirectory ?? "",
    recordingMode: previous?.recordingMode ?? "hold",
    vadSensitivity: previous?.vadSensitivity ?? 40,
    talkChord: previous?.talkChord ?? "both",
    enabledGames: copyGames(previous?.enabledGames),
    sttModelId: previous?.sttModelId ?? "",
    ttsModelId: previous?.ttsModelId ?? "",
  };

  const problem = configError(config);

  if (problem !== undefined) {
    return problem;
  }

  return { config };
}

export function configError(config: CapriceConfig): string | undefined {
  if (config.modelUrl.length === 0 || config.model.length === 0) {
    return "Pass --model-url and --model. Those are the chat endpoint and the model name.";
  }

  const url = httpUrlError(config.modelUrl);

  if (url !== undefined) {
    return url;
  }

  const protocol = tokenError(
    config.modelProtocol,
    ["", "text", "native"],
    "CAPRICE_MODEL_PROTOCOL is text or native",
  );

  if (protocol !== undefined) {
    return protocol;
  }

  const runtime = tokenError(
    config.modelRuntime,
    ["", "external", "ollama"],
    "CAPRICE_MODEL_RUNTIME is external or ollama",
  );

  if (runtime !== undefined) {
    return runtime;
  }

  if (config.modelRuntime === "ollama" && config.modelExecutable.length === 0) {
    return "CAPRICE_MODEL_EXECUTABLE is required";
  }

  const modelDeadline = deadlineError(
    "CAPRICE_MODEL_DEADLINE_MS",
    config.modelDeadlineMs,
  );

  if (modelDeadline !== undefined) {
    return modelDeadline;
  }

  const retiredStt = retiredSpeech(config.sttEngine);

  if (retiredStt !== undefined) {
    return retiredStt;
  }

  const sttEngine = tokenError(
    config.sttEngine,
    ["", "parakeet", "http"],
    `unknown speech engine: ${config.sttEngine}`,
  );

  if (sttEngine !== undefined) {
    return sttEngine;
  }

  if (config.sttEngine === "http") {
    if (config.sttUrl.length === 0 || config.sttModel.length === 0) {
      return "Pass --stt-url and --stt-model for the http speech engine.";
    }

    const sttUrl = endpointUrlError("CAPRICE_STT_URL", config.sttUrl);

    if (sttUrl !== undefined) {
      return sttUrl;
    }
  }

  const sttDeadline = deadlineError(
    "CAPRICE_STT_DEADLINE_MS",
    config.sttDeadlineMs,
  );

  if (sttDeadline !== undefined) {
    return sttDeadline;
  }

  if (config.ttsEngine === "woof") {
    return "woof is retired. Use http.";
  }

  const ttsEngine = tokenError(
    config.ttsEngine,
    ["", "http", "piper", "kokoro"],
    `unknown reply engine: ${config.ttsEngine}`,
  );

  if (ttsEngine !== undefined) {
    return ttsEngine;
  }

  const ttsDeadline = deadlineError(
    "CAPRICE_TTS_DEADLINE_MS",
    config.ttsDeadlineMs,
  );

  if (ttsDeadline !== undefined) {
    return ttsDeadline;
  }

  const mode = tokenError(
    config.recordingMode,
    ["hold", "vad"],
    "recordingMode is hold or vad",
  );

  if (mode !== undefined) {
    return mode;
  }

  const chord = tokenError(
    config.talkChord,
    ["both", "alt-space", "ctrl-space"],
    "talkChord is both, alt-space, or ctrl-space",
  );

  if (chord !== undefined) {
    return chord;
  }

  if (
    !Number.isInteger(config.vadSensitivity) ||
    config.vadSensitivity < 0 ||
    config.vadSensitivity > 100
  ) {
    return "vadSensitivity is 0 through 100";
  }

  if (config.ttsEngine === "piper" || config.ttsEngine === "kokoro") {
    return undefined;
  }

  if (config.ttsUrl.length === 0 || config.ttsModel.length === 0) {
    return "Pass --tts-url and --tts-model for the http reply engine.";
  }

  return endpointUrlError("CAPRICE_TTS_URL", config.ttsUrl);
}

export function configText(config: CapriceConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function readConfig(text: string): CapriceConfig | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  const version = readVersion(parsed);

  if (version === "rejected") {
    return undefined;
  }

  return {
    version: configVersion,
    modelUrl: readString(parsed, "modelUrl") ?? "",
    model: readString(parsed, "model") ?? "",
    modelApiKey: readString(parsed, "modelApiKey") ?? "",
    modelProtocol: readString(parsed, "modelProtocol") ?? "",
    modelRuntime: readString(parsed, "modelRuntime") ?? "",
    modelExecutable: readString(parsed, "modelExecutable") ?? "",
    modelDeadlineMs: readString(parsed, "modelDeadlineMs") ?? "",
    sttEngine: readString(parsed, "sttEngine") ?? "",
    sttModel: readString(parsed, "sttModel") ?? "",
    sttUrl: readString(parsed, "sttUrl") ?? "",
    sttDeadlineMs: readString(parsed, "sttDeadlineMs") ?? "",
    ttsEngine: readString(parsed, "ttsEngine") ?? "",
    ttsWoof: readString(parsed, "ttsWoof") ?? "",
    ttsVoice: readString(parsed, "ttsVoice") ?? "",
    ttsUrl: readString(parsed, "ttsUrl") ?? "",
    ttsModel: readString(parsed, "ttsModel") ?? "",
    ttsApiKey: readString(parsed, "ttsApiKey") ?? "",
    ttsDeadlineMs: readString(parsed, "ttsDeadlineMs") ?? "",
    python: readString(parsed, "python") ?? "",
    repo: readString(parsed, "repo") ?? "",
    container: readString(parsed, "container") ?? "",
    modelDirectory: readString(parsed, "modelDirectory") ?? "",
    recordingMode: readMode(parsed),
    vadSensitivity: readSensitivity(parsed),
    talkChord: readChord(parsed),
    enabledGames: readGames(parsed),
    sttModelId: readString(parsed, "sttModelId") ?? "",
    ttsModelId: readString(parsed, "ttsModelId") ?? "",
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function posixLauncher(repo: string, container: string): string {
  if (container.length > 0) {
    return `#!/bin/bash
set -euo pipefail
${containerCommand(repo, container, blankLaunch())}
`;
  }

  return `#!/bin/sh
set -eu
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
cd ${shellQuote(repo)}
exec bun run dev
`;
}

export function windowsLauncher(repo: string): string {
  return `$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\\.cargo\\bin;$env:USERPROFILE\\.bun\\bin;" + $env:PATH
Set-Location -LiteralPath ${powershellQuote(repo)}
bun run dev
`;
}

export function launcherText(
  platform: Platform,
  repo: string,
  container: string,
): string {
  if (platform === "windows") {
    return windowsLauncher(repo);
  }

  return posixLauncher(repo, container);
}

export function devRelease(argv: readonly string[]): boolean {
  return argv.includes("--release");
}

export function tauriDevArgs(release: boolean): string[] {
  const args = ["run", "--filter", "@caprice/desktop", "tauri", "dev"];

  if (release) {
    args.push("--release");
  }

  return args;
}

export function containerCommand(
  repo: string,
  container: string,
  env: LaunchEnv,
  release = false,
): string {
  const inner = [
    "export CAPRICE_CONTAINER=1",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"',
    exportEnv("CAPRICE_MODEL_URL", env.modelUrl),
    exportEnv("CAPRICE_MODEL", env.model),
    exportEnv("CAPRICE_MODEL_API_KEY", env.modelApiKey),
    exportEnv("CAPRICE_MODEL_PROTOCOL", env.modelProtocol),
    exportEnv("CAPRICE_MODEL_RUNTIME", env.modelRuntime),
    exportEnv("CAPRICE_MODEL_EXECUTABLE", env.modelExecutable),
    exportEnv("CAPRICE_MODEL_DEADLINE_MS", env.modelDeadlineMs),
    exportEnv("CAPRICE_STT_ENGINE", env.sttEngine),
    exportEnv("CAPRICE_STT_MODEL", env.sttModel),
    exportEnv("CAPRICE_STT_URL", env.sttUrl),
    exportEnv("CAPRICE_STT_DEADLINE_MS", env.sttDeadlineMs),
    exportEnv("CAPRICE_TTS_ENGINE", env.ttsEngine),
    exportEnv("CAPRICE_TTS_VOICE", env.ttsVoice),
    exportEnv("CAPRICE_TTS_URL", env.ttsUrl),
    exportEnv("CAPRICE_TTS_MODEL", env.ttsModel),
    exportEnv("CAPRICE_TTS_API_KEY", env.ttsApiKey),
    exportEnv("CAPRICE_TTS_DEADLINE_MS", env.ttsDeadlineMs),
    exportEnv("CAPRICE_PYTHON", env.python),
    `cd ${shellQuote(repo)}`,
    release ? "exec bun run dev -- --release" : "exec bun run dev",
  ]
    .filter((line) => line.length > 0)
    .join("; ");

  return withoutExportedShellFunctions(
    `export PATH="$HOME/.local/bin:$PATH"; exec distrobox enter ${shellQuote(container)} -- bash -lc ${shellQuote(inner)}`,
  );
}

export function commandEnv(
  entries: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  const kept: (readonly [string, string])[] = [];

  for (const entry of entries) {
    if (entry[0].startsWith("BASH_FUNC_")) {
      continue;
    }

    kept.push(entry);
  }

  return kept;
}

function withoutExportedShellFunctions(command: string): string {
  const entryKey = "$" + "{entry%%=*}";
  const keyRef = "$" + "{key}";
  const flagCount = "$" + "{#flags[@]}";
  const flagsRef = "$" + "{flags[@]}";

  return `flags=()
entry=""
key=""
while IFS= read -r -d '' entry; do
  key="${entryKey}"
  case "${keyRef}" in
    BASH_FUNC_*) flags+=("-u" "${keyRef}") ;;
  esac
done < <(env -0)
if [[ ${flagCount} -gt 0 ]]; then
  exec env "${flagsRef}" bash -c ${shellQuote(command)}
fi
${command}`;
}

export type LaunchEnv = {
  modelUrl: string;
  model: string;
  modelApiKey: string;
  modelProtocol: string;
  modelRuntime: string;
  modelExecutable: string;
  modelDeadlineMs: string;
  sttEngine: string;
  sttModel: string;
  sttUrl: string;
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsVoice: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
  python: string;
  path: string;
};

export function launchEnv(
  config: CapriceConfig,
  current: LaunchEnv,
  platform: Platform,
): LaunchEnv {
  const python = prefer(current.python, config.python);
  const path = prependPython(platform, python, current.path);

  return {
    modelUrl: prefer(current.modelUrl, config.modelUrl),
    model: prefer(current.model, config.model),
    modelApiKey: prefer(current.modelApiKey, config.modelApiKey),
    modelProtocol: prefer(current.modelProtocol, config.modelProtocol),
    modelRuntime: prefer(current.modelRuntime, config.modelRuntime),
    modelExecutable: prefer(current.modelExecutable, config.modelExecutable),
    modelDeadlineMs: prefer(current.modelDeadlineMs, config.modelDeadlineMs),
    sttEngine: prefer(current.sttEngine, config.sttEngine),
    sttModel: prefer(current.sttModel, config.sttModel),
    sttUrl: prefer(current.sttUrl, config.sttUrl),
    sttDeadlineMs: prefer(current.sttDeadlineMs, config.sttDeadlineMs),
    ttsEngine: prefer(current.ttsEngine, config.ttsEngine),
    ttsVoice: prefer(current.ttsVoice, config.ttsVoice),
    ttsUrl: prefer(current.ttsUrl, config.ttsUrl),
    ttsModel: prefer(current.ttsModel, config.ttsModel),
    ttsApiKey: prefer(current.ttsApiKey, config.ttsApiKey),
    ttsDeadlineMs: prefer(current.ttsDeadlineMs, config.ttsDeadlineMs),
    python,
    path,
  };
}

export const installHelp = `Download the selected bundled models and write Caprice's config.

Linux and macOS:
  scripts/install.sh --model-url http://your-brain/v1/chat/completions --model your-model

Windows:
  powershell -ExecutionPolicy Bypass -File scripts\\install.ps1 --model-url http://your-brain/v1/chat/completions --model your-model

--model-url         Chat endpoint. CAPRICE_MODEL_URL is the same value.
--model             Model name sent to that endpoint.
--model-api-key     Optional bearer token. The shell keeps it.
--model-protocol    text or native. Empty means text.
--model-runtime     external or ollama. Empty means external.
--model-executable  Ollama executable. Required when the runtime is ollama.
--model-deadline-ms Chat deadline in milliseconds. Empty means 60000.
--voice             Optional HTTP voice. Sent only when it is non-empty.
--stt-engine        parakeet or http. Empty means parakeet. An existing engine is kept.
--stt-model         Parakeet GGUF, or the HTTP model name. Empty parakeet is chosen later in settings.
--stt-url           HTTP speech endpoint. Required when the speech engine is http.
--stt-deadline-ms   Listen deadline in milliseconds. Empty means 180000.
--tts-engine        http, piper, or kokoro. Empty means http. piper and kokoro are not loaded yet.
--tts-url           HTTP speech endpoint.
--tts-model         HTTP speech model name.
--tts-api-key       Optional HTTP speech bearer token.
--tts-deadline-ms   Speech deadline in milliseconds. Empty means 60000.
--data-dir          Where config.json goes. Models live in its models folder.
--python            Stored interpreter path. Speech does not start a Python child.
--container         Fedora container name. Rocky Linux 9 uses caprice.
--skip-system       Do not install OS packages. CMake is still required to build speech.
--help              Show this text.

Windows uses the Visual Studio CMake when that install already has one. transcribe.cpp needs CMake.

bark, bark-stream, onnx, and woof are retired. Use parakeet or http.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The window needs 4.1, so the installer continues in a Fedora container and bun run dev enters it.

Then, from the repo, run bun run dev. The first launch compiles the window.
`;

function blankLaunch(): LaunchEnv {
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
    python: "",
    path: "",
  };
}

function exportEnv(name: string, value: string): string {
  if (value.length === 0) {
    return "";
  }

  return `export ${name}=${shellQuote(value)}`;
}

function prefer(current: string, saved: string): string {
  const chosen = current.trim();

  if (chosen.length > 0) {
    return chosen;
  }

  return saved.trim();
}

function prependMissing(
  platform: Platform,
  bins: readonly string[],
  path: string,
): string {
  const separator = platform === "windows" ? ";" : ":";
  const parts = path.length === 0 ? [] : path.split(separator);
  const front: string[] = [];

  for (const bin of bins) {
    let found = false;

    for (const part of parts) {
      if (part === bin) {
        found = true;
      }
    }

    for (const part of front) {
      if (part === bin) {
        found = true;
      }
    }

    if (!found) {
      front.push(bin);
    }
  }

  if (front.length === 0) {
    return path;
  }

  const head = front.join(separator);

  if (path.length === 0) {
    return head;
  }

  return `${head}${separator}${path}`;
}

function prependPython(
  platform: Platform,
  python: string,
  path: string,
): string {
  const separator = platform === "windows" ? "\\" : "/";
  const index = python.lastIndexOf(separator);

  if (index <= 0) {
    return path;
  }

  const bin = python.slice(0, index);
  const pathSeparator = platform === "windows" ? ";" : ":";

  if (path.length === 0) {
    return bin;
  }

  return `${bin}${pathSeparator}${path}`;
}

type FlagKey =
  | "modelUrl"
  | "model"
  | "modelApiKey"
  | "modelProtocol"
  | "modelRuntime"
  | "modelExecutable"
  | "modelDeadlineMs"
  | "voice"
  | "sttEngine"
  | "sttModel"
  | "sttUrl"
  | "sttDeadlineMs"
  | "ttsEngine"
  | "ttsUrl"
  | "ttsModel"
  | "ttsApiKey"
  | "ttsDeadlineMs"
  | "dataDir"
  | "python"
  | "container";

const flags: readonly (readonly [string, FlagKey])[] = [
  ["--model-url", "modelUrl"],
  ["--model-api-key", "modelApiKey"],
  ["--model-protocol", "modelProtocol"],
  ["--model-runtime", "modelRuntime"],
  ["--model-executable", "modelExecutable"],
  ["--model-deadline-ms", "modelDeadlineMs"],
  ["--model", "model"],
  ["--voice", "voice"],
  ["--stt-engine", "sttEngine"],
  ["--stt-model", "sttModel"],
  ["--stt-url", "sttUrl"],
  ["--stt-deadline-ms", "sttDeadlineMs"],
  ["--tts-engine", "ttsEngine"],
  ["--tts-url", "ttsUrl"],
  ["--tts-model", "ttsModel"],
  ["--tts-api-key", "ttsApiKey"],
  ["--tts-deadline-ms", "ttsDeadlineMs"],
  ["--data-dir", "dataDir"],
  ["--python", "python"],
  ["--container", "container"],
];

type Taken = {
  key: FlagKey;
  value: string;
  ate: number;
};

function takeFlag(token: string, next: string): Taken | "unknown" | undefined {
  for (const [name, key] of flags) {
    if (token === name) {
      return { key, value: next, ate: 1 };
    }

    const prefix = `${name}=`;

    if (token.startsWith(prefix)) {
      return { key, value: token.slice(prefix.length), ate: 0 };
    }
  }

  return "unknown";
}

function assignFlag(args: SetupArgs, key: FlagKey, value: string): void {
  if (
    key === "voice" ||
    key === "container" ||
    key === "modelProtocol" ||
    key === "modelRuntime" ||
    key === "sttEngine" ||
    key === "ttsEngine"
  ) {
    args[key] = value.trim();

    return;
  }

  args[key] = value;
}

function emptyArgs(): SetupArgs {
  return {
    modelUrl: "",
    model: "",
    modelApiKey: "",
    modelProtocol: "",
    modelRuntime: "",
    modelExecutable: "",
    modelDeadlineMs: "",
    voice: "",
    sttEngine: "",
    sttModel: "",
    sttUrl: "",
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsUrl: "",
    ttsModel: "",
    ttsApiKey: "",
    ttsDeadlineMs: "",
    dataDir: "",
    python: "",
    container: "",
    help: false,
  };
}

function saved(
  previous: CapriceConfig | undefined,
  read: (config: CapriceConfig) => string,
): string | undefined {
  if (previous === undefined) {
    return undefined;
  }

  return read(previous);
}

function sameEngine(savedEngine: string | undefined, chosen: string): boolean {
  return savedEngine === chosen;
}

function tokenError(
  value: string,
  allowed: readonly string[],
  message: string,
): string | undefined {
  for (const item of allowed) {
    if (item === value) {
      return undefined;
    }
  }

  return message;
}

function deadlineError(name: string, value: string): string | undefined {
  if (value.length === 0) {
    return undefined;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return `${name} is not a whole number of milliseconds`;
    }
  }

  const parsed = BigInt(value);

  if (parsed === 0n || parsed > deadlineLimit) {
    return `${name} is not a whole number of milliseconds`;
  }

  return undefined;
}

function httpUrlError(value: string): string | undefined {
  if (!isHttpUrl(value)) {
    return "CAPRICE_MODEL_URL is not an http url";
  }

  return undefined;
}

function endpointUrlError(name: string, value: string): string | undefined {
  if (!isHttpUrl(value)) {
    return `${name} is not an http url`;
  }

  return undefined;
}

function retiredSpeech(engine: string): string | undefined {
  if (engine === "bark" || engine === "bark-stream" || engine === "onnx") {
    return `${engine} is retired. Use parakeet or http.`;
  }

  return undefined;
}

function copyGames(games: readonly string[] | undefined): string[] {
  const copy: string[] = [];

  if (games === undefined) {
    return copy;
  }

  for (const game of games) {
    copy.push(game);
  }

  return copy;
}

function readMode(value: JsonRecord): string {
  return readString(value, "recordingMode") ?? "hold";
}

function readChord(value: JsonRecord): string {
  return readString(value, "talkChord") ?? "both";
}

function readSensitivity(value: JsonRecord): number {
  let saw = false;
  let number: number | undefined;

  for (const [name, field] of Object.entries(value)) {
    if (name !== "vadSensitivity") {
      continue;
    }

    saw = true;

    if (isNumber(field)) {
      number = field;
    }
  }

  if (!saw) {
    return 40;
  }

  if (
    number !== undefined &&
    Number.isInteger(number) &&
    number >= 0 &&
    number <= 100
  ) {
    return number;
  }

  return -1;
}

function readGames(value: JsonRecord): string[] {
  let items: readonly JsonValue[] | undefined;

  for (const [name, field] of Object.entries(value)) {
    if (name === "enabledGames" && isArray(field)) {
      items = field;
    }
  }

  if (items === undefined) {
    return [];
  }

  const games: string[] = [];

  for (const item of items) {
    if (!isString(item)) {
      return [];
    }

    games.push(item);
  }

  return games;
}

function isHttpUrl(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return false;
  }

  return url.hostname.length > 0;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isNumber(value: unknown): value is number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isArray(value: unknown): value is readonly JsonValue[] {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function readString(value: JsonRecord, key: string): string | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isString(field)) {
      return field;
    }
  }

  return undefined;
}

function readVersion(value: JsonRecord): "legacy" | "current" | "rejected" {
  let saw = false;
  let number: number | undefined;

  for (const [name, field] of Object.entries(value)) {
    if (name !== "version") {
      continue;
    }

    saw = true;

    if (isNumber(field)) {
      number = field;
    }
  }

  if (!saw) {
    return "legacy";
  }

  if (number === configVersion) {
    return "current";
  }

  return "rejected";
}
