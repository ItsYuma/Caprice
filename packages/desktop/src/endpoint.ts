import {
  readModelEndpoint,
  readShellModelConfig,
  type ModelConfig,
  type ModelEndpoint,
  type ModelEnv,
  type ShellModelPayload,
} from "@caprice/core";

export type { ShellModelPayload };

export type ModelEndpointSource = {
  inShell: boolean;
  readShell: () => Promise<ShellModelPayload>;
};

export type ModelSource =
  | { where: "browser"; endpoint: ModelEndpoint }
  | { where: "shell"; config: ModelConfig };

export async function loadModelSource(
  env: ModelEnv,
  source: ModelEndpointSource,
): Promise<ModelSource> {
  if (!source.inShell) {
    return { where: "browser", endpoint: readModelEndpoint(env) };
  }

  const shell = await source.readShell();

  return { where: "shell", config: readShellModelConfig(shell) };
}
