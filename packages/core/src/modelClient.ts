import { deadlineError, modelDeadlineMs, openDeadline } from "./deadline.ts";
import { tryCatch, type Result } from "./result.ts";

export type ModelProtocol = "text" | "native";

export type ModelEnv = {
  CAPRICE_MODEL_URL: string | undefined;
  CAPRICE_MODEL: string | undefined;
  CAPRICE_MODEL_API_KEY: string | undefined;
  CAPRICE_MODEL_PROTOCOL: string | undefined;
};

export type ModelEndpoint = {
  url: string;
  model: string;
  apiKey: string;
  protocol: ModelProtocol;
};

export type ModelConfig = {
  model: string;
  protocol: ModelProtocol;
  timeoutMs?: number;
};

export type ShellModelPayload = {
  model?: string;
  protocol?: string;
  timeoutMs?: number;
};

export function readModelEndpoint(env: ModelEnv): ModelEndpoint {
  return {
    url: required("CAPRICE_MODEL_URL", env.CAPRICE_MODEL_URL),
    model: required("CAPRICE_MODEL", env.CAPRICE_MODEL),
    apiKey: env.CAPRICE_MODEL_API_KEY?.trim() ?? "",
    protocol: readProtocol(env.CAPRICE_MODEL_PROTOCOL),
  };
}

export function readShellModelConfig(payload: ShellModelPayload): ModelConfig {
  const config: ModelConfig = {
    model: required("CAPRICE_MODEL", payload.model),
    protocol: readProtocol(payload.protocol),
  };

  const timeoutMs = readTimeout(payload.timeoutMs);

  if (timeoutMs !== undefined) {
    config.timeoutMs = timeoutMs;
  }

  return config;
}

export function readProtocol(value: string | undefined): ModelProtocol {
  const text = value?.trim() ?? "";

  if (text.length === 0 || text === "text") {
    return "text";
  }

  if (text === "native") {
    return "native";
  }

  throw new Error("CAPRICE_MODEL_PROTOCOL is text or native");
}

export function postJson(
  url: string,
  body: string,
  apiKey: string,
  signal: AbortSignal,
  deadlineMs: number = modelDeadlineMs,
): Promise<Result<string>> {
  return tryCatch(
    fetchText(url, body, apiKey, signal, deadlineMs),
    "the model request failed",
  );
}

function readTimeout(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  throw new Error("model timeout is not valid");
}

function required(name: string, value: string | undefined): string {
  const text = value?.trim() ?? "";

  if (text.length === 0) {
    throw new Error(`${name} is required`);
  }

  return text;
}

async function fetchText(
  url: string,
  body: string,
  apiKey: string,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<string> {
  const deadline = openDeadline(signal, deadlineMs);
  const headers = new Headers({ "content-type": "application/json" });

  if (apiKey.length > 0) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  try {
    const early = deadlineError(deadline);

    if (early !== undefined) {
      throw early;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: deadline.signal,
    });

    if (!response.ok) {
      throw new Error(`model request failed: ${response.status}`);
    }

    return await response.text();
  } catch (caught) {
    const reason = deadlineError(deadline);

    if (reason !== undefined) {
      throw reason;
    }

    throw caught;
  } finally {
    deadline.stop();
  }
}
