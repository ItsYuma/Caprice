import { access, chmod, mkdir, readdir } from "node:fs/promises";

import {
  barkDir,
  barkFileNames,
  barkRepo,
  capriceDataDir,
  configPath,
  configText,
  filled,
  installHelp,
  launcherPath,
  launcherText,
  missingNames,
  parseSetupArgs,
  platformOf,
  readConfig,
  venvDir,
  venvPython,
  woofDir,
  woofRepo,
  type CapriceConfig,
  type Platform,
  type SetupArgs,
} from "./layout.ts";

const downloadProgram = `
import sys
from huggingface_hub import snapshot_download
snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])
`;

if (import.meta.main) {
  try {
    await installMain();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }

    process.exit(1);
  }
}

async function installMain(): Promise<void> {
  const parsed = parseSetupArgs(process.argv.slice(2));

  if (!isSetupArgs(parsed)) {
    throw new Error(parsed);
  }

  if (parsed.help) {
    console.log(installHelp);

    return;
  }

  const platform = platformOf(process.platform);

  if (platform === undefined) {
    throw new Error(`unsupported platform: ${process.platform}`);
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const data =
    parsed.dataDir.trim().length > 0
      ? parsed.dataDir.trim()
      : capriceDataDir(
          platform,
          home,
          process.env.XDG_DATA_HOME ?? "",
          process.env.LOCALAPPDATA ?? "",
        );

  const repo = process.cwd();
  const previous = await savedConfig(platform, data);
  const config = await choices(parsed, previous, platform, data, repo);

  await mkdir(data, { recursive: true });
  await mkdir(woofDir(platform, data), { recursive: true });
  await mkdir(barkDir(platform, data), { recursive: true });
  const python = await ensurePython(parsed.python, platform, data);
  config.python = python;
  await ensurePackages(python);
  await ensureModels(python, platform, data);
  await run(process.execPath, ["install"], repo);
  await Bun.write(configPath(platform, data), configText(config));
  const launcher = launcherPath(platform, data);
  await Bun.write(launcher, launcherText(platform, repo));

  if (platform !== "windows") {
    await chmod(launcher, 0o755);
  }

  console.log(`Caprice is set up in ${data}`);
  console.log(`Woof: ${config.ttsWoof}`);
  console.log(`Bark: ${config.sttModel}`);
  console.log(`Voice: ${config.ttsVoice}`);
  console.log(`Start it with ${launcher}`);
  console.log("Or from this repo: bun run dev");
  console.log("The first launch compiles the window.");
}

async function choices(
  args: SetupArgs,
  previous: CapriceConfig | undefined,
  platform: Platform,
  data: string,
  repo: string,
): Promise<CapriceConfig> {
  const saved = previous ?? emptyConfig();

  let modelUrl = filled(
    args.modelUrl,
    process.env.CAPRICE_MODEL_URL ?? "",
    saved.modelUrl,
  );

  let model = filled(args.model, process.env.CAPRICE_MODEL ?? "", saved.model);

  if (modelUrl.length === 0 || model.length === 0) {
    const prompted = await promptForChat(modelUrl, model);
    modelUrl = prompted.modelUrl;
    model = prompted.model;
  }

  if (modelUrl.length === 0 || model.length === 0) {
    throw new Error(
      "Pass --model-url and --model. Those are the chat endpoint and the model name.",
    );
  }

  const voice = filled(
    args.voice,
    process.env.CAPRICE_TTS_VOICE ?? "",
    saved.ttsVoice,
  );

  const chosenVoice = voice.length === 0 ? "juno" : voice;

  if (chosenVoice !== "juno" && chosenVoice !== "mira") {
    throw new Error(`unknown woof voice: ${chosenVoice}`);
  }

  return {
    modelUrl,
    model,
    modelApiKey: filled(
      args.modelApiKey,
      process.env.CAPRICE_MODEL_API_KEY ?? "",
      saved.modelApiKey,
    ),
    sttEngine: "bark",
    sttModel: barkDir(platform, data),
    ttsEngine: "woof",
    ttsWoof: woofDir(platform, data),
    ttsVoice: chosenVoice,
    python: "",
    repo,
  };
}

async function promptForChat(
  modelUrl: string,
  model: string,
): Promise<{ modelUrl: string; model: string }> {
  if (process.stdin.isTTY !== true) {
    return { modelUrl, model };
  }

  let url = modelUrl;
  let name = model;

  if (url.length === 0) {
    url = (prompt("Chat URL (CAPRICE_MODEL_URL): ") ?? "").trim();
  }

  if (name.length === 0) {
    name = (prompt("Model name (CAPRICE_MODEL): ") ?? "").trim();
  }

  return { modelUrl: url, model: name };
}

async function savedConfig(
  platform: Platform,
  data: string,
): Promise<CapriceConfig | undefined> {
  const path = configPath(platform, data);
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return undefined;
  }

  return readConfig(await file.text());
}

async function ensurePython(
  systemPython: string,
  platform: Platform,
  data: string,
): Promise<string> {
  const created = venvPython(platform, data);

  if (await isFile(created)) {
    return created;
  }

  const base =
    systemPython.trim().length > 0
      ? systemPython.trim()
      : (Bun.which("python3") ?? Bun.which("python") ?? "");

  if (base.length === 0) {
    throw new Error("python3 is not installed.");
  }

  await run(base, ["-m", "venv", venvDir(platform, data)], process.cwd());

  if (!(await isFile(created))) {
    throw new Error(`python venv did not create ${created}`);
  }

  return created;
}

async function ensurePackages(python: string): Promise<void> {
  const ready = await runQuiet(python, ["-c", "import numpy, huggingface_hub"]);

  if (ready === 0) {
    return;
  }

  await run(
    python,
    ["-m", "pip", "install", "numpy", "huggingface_hub"],
    process.cwd(),
  );
}

async function ensureModels(
  python: string,
  platform: Platform,
  data: string,
): Promise<void> {
  const woof = woofDir(platform, data);
  const bark = barkDir(platform, data);
  const woofReady = await importsWoof(python, woof);
  const barkReady = (await missingBark(bark)).length === 0;

  if (woofReady && barkReady) {
    return;
  }

  if (!woofReady) {
    console.log(`Downloading ${woofRepo}`);
    await run(python, ["-c", downloadProgram, woofRepo, woof], process.cwd());
  }

  if (!barkReady) {
    console.log(`Downloading ${barkRepo}`);
    await run(python, ["-c", downloadProgram, barkRepo, bark], process.cwd());
  }

  if (!(await importsWoof(python, woof))) {
    throw new Error(`Woof did not import from ${woof}`);
  }

  const missing = await missingBark(bark);

  if (missing.length > 0) {
    throw new Error(`Bark is missing ${missing.join(", ")} in ${bark}`);
  }
}

async function importsWoof(
  python: string,
  directory: string,
): Promise<boolean> {
  const code = await runQuiet(python, [
    "-c",
    "import sys; sys.path.insert(0, sys.argv[1]); import underdog_woof",
    directory,
  ]);

  return code === 0;
}

async function missingBark(directory: string): Promise<string[]> {
  let names: string[] = [];

  try {
    names = await readdir(directory);
  } catch {
    return [...barkFileNames];
  }

  return missingNames(names, barkFileNames);
}

async function isFile(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const code = await spawn(command, args, cwd, "inherit");

  if (code !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed`);
  }
}

async function runQuiet(
  command: string,
  args: readonly string[],
): Promise<number> {
  return spawn(command, args, process.cwd(), "pipe");
}

async function spawn(
  command: string,
  args: readonly string[],
  cwd: string,
  output: "inherit" | "pipe",
): Promise<number> {
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdin: "inherit",
    stdout: output,
    stderr: output,
  });

  return child.exited;
}

function isSetupArgs(value: SetupArgs | string): value is SetupArgs {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function emptyConfig(): CapriceConfig {
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
    repo: "",
  };
}
