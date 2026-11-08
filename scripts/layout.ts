export const woofRepo = "ConwayResearch/Underdog-Woof";

export const barkRepo = "ConwayResearch/Underdog-Bark-3.0-Pro";

export const barkFileNames = [
  "config.json",
  "tokenizer.json",
  "model.safetensors",
] as const;

export const bunVersion = "1.4.4";

export type Platform = "linux" | "macos" | "windows";

export type CapriceConfig = {
  modelUrl: string;
  model: string;
  modelApiKey: string;
  sttEngine: string;
  sttModel: string;
  ttsEngine: string;
  ttsWoof: string;
  ttsVoice: string;
  python: string;
  repo: string;
  container: string;
};

export type SetupArgs = {
  modelUrl: string;
  model: string;
  modelApiKey: string;
  voice: string;
  dataDir: string;
  python: string;
  container: string;
  help: boolean;
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
  const args: SetupArgs = {
    modelUrl: "",
    model: "",
    modelApiKey: "",
    voice: "",
    dataDir: "",
    python: "",
    container: "",
    help: false,
  };

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

    const modelUrl = flagValue(token, next, "--model-url");

    if (modelUrl !== undefined) {
      args.modelUrl = modelUrl.value;
      index += modelUrl.ate;

      continue;
    }

    const model = flagValue(token, next, "--model");

    if (model !== undefined) {
      args.model = model.value;
      index += model.ate;

      continue;
    }

    const modelApiKey = flagValue(token, next, "--model-api-key");

    if (modelApiKey !== undefined) {
      args.modelApiKey = modelApiKey.value;
      index += modelApiKey.ate;

      continue;
    }

    const voice = flagValue(token, next, "--voice");

    if (voice !== undefined) {
      args.voice = voice.value.trim().toLowerCase();
      index += voice.ate;

      continue;
    }

    const dataDir = flagValue(token, next, "--data-dir");

    if (dataDir !== undefined) {
      args.dataDir = dataDir.value;
      index += dataDir.ate;

      continue;
    }

    const python = flagValue(token, next, "--python");

    if (python !== undefined) {
      args.python = python.value;
      index += python.ate;

      continue;
    }

    const container = flagValue(token, next, "--container");

    if (container !== undefined) {
      args.container = container.value.trim();
      index += container.ate;

      continue;
    }

    return `unknown argument: ${token}`;
  }

  if (args.voice.length > 0 && args.voice !== "juno" && args.voice !== "mira") {
    return `unknown woof voice: ${args.voice}`;
  }

  return args;
}

export function filled(
  flag: string,
  fromEnv: string,
  fromFile: string,
): string {
  const chosen = flag.trim();

  if (chosen.length > 0) {
    return chosen;
  }

  const env = fromEnv.trim();

  if (env.length > 0) {
    return env;
  }

  return fromFile.trim();
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

  return {
    modelUrl: readString(parsed, "modelUrl") ?? "",
    model: readString(parsed, "model") ?? "",
    modelApiKey: readString(parsed, "modelApiKey") ?? "",
    sttEngine: readString(parsed, "sttEngine") ?? "",
    sttModel: readString(parsed, "sttModel") ?? "",
    ttsEngine: readString(parsed, "ttsEngine") ?? "",
    ttsWoof: readString(parsed, "ttsWoof") ?? "",
    ttsVoice: readString(parsed, "ttsVoice") ?? "",
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
    exportEnv("CAPRICE_STT_ENGINE", env.sttEngine),
    exportEnv("CAPRICE_STT_MODEL", env.sttModel),
    exportEnv("CAPRICE_TTS_ENGINE", env.ttsEngine),
    exportEnv("CAPRICE_TTS_WOOF", env.ttsWoof),
    exportEnv("CAPRICE_TTS_VOICE", env.ttsVoice),
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
  sttEngine: string;
  sttModel: string;
  ttsEngine: string;
  ttsWoof: string;
  ttsVoice: string;
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
    sttEngine: prefer(current.sttEngine, config.sttEngine),
    sttModel: prefer(current.sttModel, config.sttModel),
    ttsEngine: prefer(current.ttsEngine, config.ttsEngine),
    ttsWoof: prefer(current.ttsWoof, config.ttsWoof),
    ttsVoice: prefer(current.ttsVoice, config.ttsVoice),
    python,
    path,
  };
}

export const installHelp = `Download Woof and Bark, create a Python environment, and write Caprice's config.

Linux and macOS:
  scripts/install.sh --model-url http://your-brain/v1/chat/completions --model your-model

Windows:
  powershell -ExecutionPolicy Bypass -File scripts\\install.ps1 --model-url http://your-brain/v1/chat/completions --model your-model

--model-url       Chat endpoint. CAPRICE_MODEL_URL is the same value.
--model           Model name sent to that endpoint.
--model-api-key   Optional bearer token.
--voice           juno or mira. Empty means juno.
--data-dir        Where models, Python, and config.json go.
--python          System Python used to create the virtual environment.
--container       Fedora container name. Rocky Linux 9 uses caprice.
--skip-system     Do not install OS packages.
--help            Show this text.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The window needs 4.1, so the installer continues in a Fedora container and bun run dev enters it.

Then, from the repo, run bun run dev. The first launch compiles the window.
`;

function blankLaunch(): LaunchEnv {
  return {
    modelUrl: "",
    model: "",
    modelApiKey: "",
    sttEngine: "",
    sttModel: "",
    ttsEngine: "",
    ttsWoof: "",
    ttsVoice: "",
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

type Flag = {
  value: string;
  ate: number;
};

function flagValue(
  token: string,
  next: string,
  name: string,
): Flag | undefined {
  if (token === name) {
    return { value: next, ate: 1 };
  }

  const prefix = `${name}=`;

  if (token.startsWith(prefix)) {
    return { value: token.slice(prefix.length), ate: 0 };
  }

  return undefined;
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
