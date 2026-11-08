import { postJson, tryCatch, type Result } from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";

export function postChat(
  url: string,
  body: string,
  apiKey: string,
): Promise<Result<string>> {
  if ("__TAURI_INTERNALS__" in window) {
    return tryCatch(
      invoke<string>("model_complete", { url, body, apiKey }),
      "the model request failed",
    );
  }

  return postJson(url, body, apiKey);
}
