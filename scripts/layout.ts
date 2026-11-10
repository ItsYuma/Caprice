export const woofRepo = "ConwayResearch/Underdog-Woof";

export const barkRepo = "ConwayResearch/Underdog-Bark-3.0-Pro";

export const barkFileNames = [
  "config.json",
  "tokenizer.json",
  "model.safetensors",
] as const;

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
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsWoof: string;
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
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsWoof: string;
  ttsVoice: string;
  ttsUrl: string;
  ttsModel: string;
  ttsApiKey: string;
  ttsDeadlineMs: string;
};

export type InstallPlan = {
  config: CapriceConfig;
  bark: boolean;
  woof: boolean;
  python: boolean;
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

export function woofDir(platform: Platform, data: string): string {
  return joinPath(platform, data, "models", "underdog-woof");
}

export function barkDir(platform: Platform, data: string): string {
  return joinPath(platform, data, "models", "underdog-bark");
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

export function usesBark(engine: string): boolean {
  return engine.length === 0 || engine === "bark" || engine === "bark-stream";
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
    "bark",
  );

  const sttModel = choose(
    args.sttModel,
    env.sttModel,
    sameEngine(previous?.sttEngine, sttEngine)
      ? saved(previous, (item) => item.sttModel)
      : undefined,
    usesBark(sttEngine) ? barkDir(platform, data) : "",
  );

  const ttsEngine = choose(
    args.ttsEngine,
    env.ttsEngine,
    saved(previous, (item) => item.ttsEngine),
    "woof",
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
    sttDeadlineMs: choose(
      args.sttDeadlineMs,
      env.sttDeadlineMs,
      saved(previous, (item) => item.sttDeadlineMs),
      "",
    ),
    ttsEngine,
    ttsWoof: choose(
      args.ttsWoof,
      env.ttsWoof,
      saved(previous, (item) => item.ttsWoof),
      ttsEngine === "woof" ? woofDir(platform, data) : "",
    ),
    ttsVoice: canonicalVoice(
      ttsEngine,
      choose(
        args.voice,
        env.ttsVoice,
        saved(previous, (item) => item.ttsVoice),
        "",
      ),
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
    python: previous?.python ?? "",
    repo,
    container: choose(
      args.container,
      "",
      saved(previous, (item) => item.container),
      "",
    ),
  };

  const problem = configError(config);

  if (problem !== undefined) {
    return problem;
  }

  const bark =
    usesBark(config.sttEngine) &&
    bundled(platform, config.sttModel, barkDir(platform, data));

  const woof =
    config.ttsEngine === "woof" &&
    bundled(platform, config.ttsWoof, woofDir(platform, data));

  return {
    config,
    bark,
    woof,
    python: config.ttsEngine === "woof" || bark || woof,
  };
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

  const sttEngine = tokenError(
    config.sttEngine,
    ["", "bark-stream", "bark", "onnx", "parakeet"],
    `unknown speech engine: ${config.sttEngine}`,
  );

  if (sttEngine !== undefined) {
    return sttEngine;
  }

  if (config.sttModel.length === 0) {
    const name =
      config.sttEngine.length === 0 ? "bark" : config.sttEngine;

    return `Pass --stt-model for the ${name} engine.`;
  }

  const sttDeadline = deadlineError(
    "CAPRICE_STT_DEADLINE_MS",
    config.sttDeadlineMs,
  );

  if (sttDeadline !== undefined) {
    return sttDeadline;
  }

  const ttsEngine = tokenError(
    config.ttsEngine,
    ["", "http", "woof"],
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

  if (config.ttsEngine === "woof") {
    if (config.ttsWoof.length === 0) {
      return "Pass --tts-woof for the woof reply engine.";
    }

    if (config.ttsVoice !== "juno" && config.ttsVoice !== "mira") {
      return `unknown woof voice: ${config.ttsVoice}`;
    }

    return undefined;
  }

  if (config.ttsUrl.length === 0 || config.ttsModel.length === 0) {
    return "Pass --tts-url and --tts-model for the http reply engine.";
  }

  return speechUrlError(config.ttsUrl);
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

export function containerCommand(
  repo: string,
  container: string,
  env: LaunchEnv,
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
    exportEnv("CAPRICE_STT_DEADLINE_MS", env.sttDeadlineMs),
    exportEnv("CAPRICE_TTS_ENGINE", env.ttsEngine),
    exportEnv("CAPRICE_TTS_WOOF", env.ttsWoof),
    exportEnv("CAPRICE_TTS_VOICE", env.ttsVoice),
    exportEnv("CAPRICE_TTS_URL", env.ttsUrl),
    exportEnv("CAPRICE_TTS_MODEL", env.ttsModel),
    exportEnv("CAPRICE_TTS_API_KEY", env.ttsApiKey),
    exportEnv("CAPRICE_TTS_DEADLINE_MS", env.ttsDeadlineMs),
    exportEnv("CAPRICE_PYTHON", env.python),
    `cd ${shellQuote(repo)}`,
    "exec bun run dev",
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
  sttDeadlineMs: string;
  ttsEngine: string;
  ttsWoof: string;
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
    sttDeadlineMs: prefer(current.sttDeadlineMs, config.sttDeadlineMs),
    ttsEngine: prefer(current.ttsEngine, config.ttsEngine),
    ttsWoof: prefer(current.ttsWoof, config.ttsWoof),
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
--voice             Woof voice juno or mira. Empty means juno. HTTP keeps the given voice.
--stt-engine        bark, bark-stream, onnx, or parakeet. A new install uses bark. bark-stream and parakeet stream. An existing engine is kept.
--stt-model         Model directory or file. A new bark install uses the bundled Bark directory.
--stt-deadline-ms   Listen deadline in milliseconds. Empty means 180000.
--tts-engine        woof or http. A new install uses woof. An existing engine is kept.
--tts-woof          Woof directory. A new woof install uses the bundled directory.
--tts-url           HTTP speech endpoint.
--tts-model         HTTP speech model name.
--tts-api-key       Optional HTTP speech bearer token.
--tts-deadline-ms   Speech deadline in milliseconds. Empty means 60000.
--data-dir          Where models, Python, and config.json go.
--python            System Python used to create the virtual environment.
--container         Fedora container name. Rocky Linux 9 uses caprice.
--skip-system       Do not install OS packages. CMake is still required to build speech.
--help              Show this text.

Windows uses the Visual Studio CMake when that install already has one. transcribe.cpp needs CMake.

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
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsWoof: "",
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
  | "sttDeadlineMs"
  | "ttsEngine"
  | "ttsWoof"
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
  ["--stt-deadline-ms", "sttDeadlineMs"],
  ["--tts-engine", "ttsEngine"],
  ["--tts-woof", "ttsWoof"],
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
    sttDeadlineMs: "",
    ttsEngine: "",
    ttsWoof: "",
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

function canonicalVoice(engine: string, voice: string): string {
  if (engine === "woof") {
    const lowered = voice.trim().toLowerCase();

    if (lowered.length === 0) {
      return "juno";
    }

    return lowered;
  }

  return voice.trim();
}

function bundled(
  platform: Platform,
  configured: string,
  bundledPath: string,
): boolean {
  return (
    normalizePath(platform, configured) === normalizePath(platform, bundledPath)
  );
}

function normalizePath(platform: Platform, value: string): string {
  let text = value.trim();

  if (platform === "windows") {
    text = text.replaceAll("/", "\\").toLowerCase();
  }

  while (text.endsWith("/") || text.endsWith("\\")) {
    text = text.slice(0, -1);
  }

  return text;
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

function speechUrlError(value: string): string | undefined {
  if (!isHttpUrl(value)) {
    return "CAPRICE_TTS_URL is not an http url";
  }

  return undefined;
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
