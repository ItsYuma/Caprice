import {
  deadlineError,
  modelDeadlineMs,
  openDeadline,
  tryCatch,
  type Result,
} from "@caprice/core";
import { invoke } from "@tauri-apps/api/core";

export type ModelCommand = {
  complete: (body: string, requestId: string) => Promise<string>;
  cancel: (requestId: string) => Promise<void>;
};

export function postModel(
  body: string,
  signal: AbortSignal,
  deadlineMs: number = modelDeadlineMs,
): Promise<Result<string>> {
  return completeModel(shellModelCommand(), body, signal, deadlineMs);
}

export function completeModel(
  command: ModelCommand,
  body: string,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<Result<string>> {
  const requestId = crypto.randomUUID();

  return tryCatch(
    invokeBody(command, body, requestId, signal, deadlineMs),
    "the model request failed",
  );
}

function shellModelCommand(): ModelCommand {
  return {
    complete(body, requestId) {
      return invoke<string>("model_complete", { body, requestId });
    },
    cancel(requestId) {
      return invoke("model_cancel", { requestId }).then(() => undefined);
    },
  };
}

async function invokeBody(
  command: ModelCommand,
  body: string,
  requestId: string,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<string> {
  const deadline = openDeadline(signal, deadlineMs);
  let started = false;
  let cancelSent = false;

  const cancel = () => {
    if (!started || cancelSent) {
      return;
    }

    cancelSent = true;

    try {
      void command.cancel(requestId).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      return;
    }
  };

  try {
    const early = deadlineError(deadline);

    if (early !== undefined) {
      throw early;
    }

    let pending: Promise<string>;

    try {
      pending = command.complete(body, requestId);
      started = true;
    } catch (cause) {
      if (cause instanceof Error && cause.message.length > 0) {
        throw cause;
      }

      throw new Error("the model request failed");
    }

    return await firstResult(pending, deadline.signal, () => {
      cancel();

      return deadlineError(deadline);
    });
  } finally {
    deadline.stop();
  }
}

function firstResult(
  pending: Promise<string>,
  signal: AbortSignal,
  reason: () => Error | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (value: string | undefined, error: Error | undefined) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);

      if (error !== undefined) {
        reject(error);

        return;
      }

      resolve(value ?? "");
    };

    const onAbort = () => {
      finish(undefined, reason() ?? new Error("cancelled"));
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    pending.then(
      (value) => {
        finish(value, undefined);
      },
      (cause) => {
        if (signal.aborted) {
          finish(undefined, reason() ?? new Error("cancelled"));

          return;
        }

        if (cause instanceof Error && cause.message.length > 0) {
          finish(undefined, cause);

          return;
        }

        if (isString(cause) && cause.length > 0) {
          finish(undefined, new Error(cause));

          return;
        }

        finish(undefined, new Error("the model request failed"));
      },
    );
  });
}

function isString(cause: unknown): cause is string {
  return Object.prototype.toString.call(cause) === "[object String]";
}
