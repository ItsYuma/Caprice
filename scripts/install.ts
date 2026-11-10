import { access, chmod, mkdir, readdir } from "node:fs/promises";

import {
  barkFileNames,
  barkRepo,
  capriceDataDir,
  choose,
  configPath,
  configText,
  installHelp,
  launcherPath,
  launcherText,
  missingNames,
  parseSetupArgs,
  planInstall,
  platformOf,
  readConfig,
  usesBark,
  venvDir,
  venvPython,
  woofRepo,
  type CapriceConfig,
  type ConfigEnv,
  type InstallPlan,
  type Platform,
  type SetupArgs,
} from "./layout.ts";

const downloadProgram = `
import sys
from huggingface_hub import snapshot_download
snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])
`;

const missingChat =
  "Pass --model-url and --model. Those are the chat endpoint and the model name.";

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
  const plan = await planned(parsed, previous, platform, data, repo);
  const config = plan.config;

  await mkdir(data, { recursive: true });

  if (plan.python) {
    config.python = await ensurePython(parsed.python, platform, data);
    await ensurePackages(config.python);
  }

  if (plan.bark) {
    await mkdir(config.sttModel, { recursive: true });
    await ensureBark(config.python, config.sttModel);
  }

  if (plan.woof) {
    await mkdir(config.ttsWoof, { recursive: true });
    await ensureWoof(config.python, config.ttsWoof);
  }

  await verifySpeech(plan);
  await run(process.execPath, ["install"], repo);
  await Bun.write(configPath(platform, data), configText(config));
  const launcher = launcherPath(platform, data);
  await Bun.write(launcher, launcherText(platform, repo, config.container));

  if (platform !== "windows") {
    await chmod(launcher, 0o755);
  }

  console.log(`Caprice is set up in ${data}`);
  console.log(`Listen: ${shownEngine(config.sttEngine)} ${config.sttModel}`);

  if (config.ttsEngine === "woof") {
    console.log(`Woof: ${config.ttsWoof}`);
    console.log(`Voice: ${config.ttsVoice}`);
  } else {
    console.log(`Speech: ${config.ttsUrl}`);
  }

  console.log(`Start it with ${launcher}`);
  console.log("Or from this repo: bun run dev");
  console.log("The first launch compiles the window.");
}

async function planned(
  args: SetupArgs,
  previous: CapriceConfig | undefined,
  platform: Platform,
  data: string,
  repo: string,
): Promise<InstallPlan> {
  const env = currentEnv();
  let plan = planInstall(args, previous, env, platform, data, repo);

  if (plan === missingChat) {
    const current = currentChat(args, previous, env);
    const prompted = await promptForChat(current.modelUrl, current.model);
    args.modelUrl = prompted.modelUrl;
    args.model = prompted.model;
    plan = planInstall(args, previous, env, platform, data, repo);
  }

  if (!isInstallPlan(plan)) {
    throw new Error(plan);
  }

  return plan;
}

function currentChat(
  args: SetupArgs,
  previous: CapriceConfig | undefined,
  env: ConfigEnv,
): ChatPrompt {
  return {
    modelUrl: choose(args.modelUrl, env.modelUrl, previous?.modelUrl, ""),
    model: choose(args.model, env.model, previous?.model, ""),
  };
}

async function promptForChat(
  modelUrl: string,
  model: string,
): Promise<ChatPrompt> {
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

  const read = readConfig(await file.text());

  if (read === undefined) {
    throw new Error(`${path} could not be read`);
  }

  return read;
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

async function ensureBark(python: string, directory: string): Promise<void> {
  if ((await missingBark(directory)).length === 0) {
    return;
  }

  console.log(`Downloading ${barkRepo}`);
  await run(
    python,
    ["-c", downloadProgram, barkRepo, directory],
    process.cwd(),
  );
  const missing = await missingBark(directory);

  if (missing.length > 0) {
    throw new Error(`Bark is missing ${missing.join(", ")} in ${directory}`);
  }
}

async function ensureWoof(python: string, directory: string): Promise<void> {
  if (await importsWoof(python, directory)) {
    return;
  }

  console.log(`Downloading ${woofRepo}`);
  await run(
    python,
    ["-c", downloadProgram, woofRepo, directory],
    process.cwd(),
  );

  if (!(await importsWoof(python, directory))) {
    throw new Error(`Woof did not import from ${directory}`);
  }
}

async function verifySpeech(plan: InstallPlan): Promise<void> {
  const config = plan.config;

  if (!plan.bark && usesBark(config.sttEngine)) {
    const missing = await missingBark(config.sttModel);

    if (missing.length > 0) {
      throw new Error(
        `Bark is missing ${missing.join(", ")} in ${config.sttModel}`,
      );
    }
  }

  if (config.sttEngine === "onnx" || config.sttEngine === "parakeet") {
    if (!(await pathExists(config.sttModel))) {
      throw new Error(`Pass --stt-model for the ${config.sttEngine} engine.`);
    }
  }

  if (config.ttsEngine === "woof" && !plan.woof) {
    if (!(await pathExists(config.ttsWoof))) {
      throw new Error(`Woof was not found at ${config.ttsWoof}`);
    }
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

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function isFile(path: string): Promise<boolean> {
  return pathExists(path);
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

function currentEnv(): ConfigEnv {
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
    sttDeadlineMs: process.env.CAPRICE_STT_DEADLINE_MS ?? "",
    ttsEngine: process.env.CAPRICE_TTS_ENGINE ?? "",
    ttsWoof: process.env.CAPRICE_TTS_WOOF ?? "",
    ttsVoice: process.env.CAPRICE_TTS_VOICE ?? "",
    ttsUrl: process.env.CAPRICE_TTS_URL ?? "",
    ttsModel: process.env.CAPRICE_TTS_MODEL ?? "",
    ttsApiKey: process.env.CAPRICE_TTS_API_KEY ?? "",
    ttsDeadlineMs: process.env.CAPRICE_TTS_DEADLINE_MS ?? "",
  };
}

function shownEngine(engine: string): string {
  if (engine.length === 0) {
    return "bark";
  }

  return engine;
}

function isSetupArgs(value: SetupArgs | string): value is SetupArgs {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isInstallPlan(value: InstallPlan | string): value is InstallPlan {
  return Object.prototype.toString.call(value) === "[object Object]";
}

type ChatPrompt = {
  modelUrl: string;
  model: string;
};
