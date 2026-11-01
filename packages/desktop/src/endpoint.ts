import {
  readModelEndpoint,
  type ModelEndpoint,
  type ModelEnv,
} from "@caprice/core";

export type ShellModelEndpoint = {
  url: string;
  model: string;
  apiKey: string;
};

export type ModelEndpointSource = {
  inShell: boolean;
  readShell: () => Promise<ShellModelEndpoint>;
};

export async function loadModelEndpoint(
  env: ModelEnv,
  source: ModelEndpointSource,
): Promise<ModelEndpoint> {
  if (!source.inShell) {
    return readModelEndpoint(env);
  }

  const shell = await source.readShell();

  return readModelEndpoint({
    CAPRICE_MODEL_URL: shell.url,
    CAPRICE_MODEL: shell.model,
    CAPRICE_MODEL_API_KEY: shell.apiKey,
  });
}
