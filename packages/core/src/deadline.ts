export const modelDeadlineMs = 60_000;

export type Deadline = {
  signal: AbortSignal;
  stop: () => void;
  cancelled: () => boolean;
  timedOut: () => boolean;
};

export function openDeadline(
  parent: AbortSignal,
  deadlineMs: number,
): Deadline {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineMs);

  const onParent = () => {
    controller.abort();
  };

  if (parent.aborted) {
    controller.abort();
  } else {
    parent.addEventListener("abort", onParent, { once: true });
  }

  return {
    signal: controller.signal,
    stop() {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
    cancelled() {
      return parent.aborted;
    },
    timedOut() {
      return timedOut && !parent.aborted;
    },
  };
}

export function deadlineError(
  deadline: Deadline,
  timeout = "the model timed out",
): Error | undefined {
  if (deadline.cancelled()) {
    return new Error("cancelled");
  }

  if (deadline.timedOut()) {
    return new Error(timeout);
  }

  return undefined;
}
