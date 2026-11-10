import type { Heard, Listener } from "./ports.ts";

export type PushListener = Listener & {
  release: () => void;
  cancel: () => void;
};

export type Capture = {
  begin: () => Promise<void>;
  finish: () => Promise<string>;
  cancel: () => Promise<void>;
};

type Gate = {
  promise: Promise<Heard>;
  resolve: (heard: Heard) => void;
  reject: (error: Error) => void;
  settled: () => boolean;
};

type ListenState =
  | { status: "idle" }
  | { status: "released" }
  | { status: "starting"; generation: number; gate: Gate }
  | { status: "starting-release"; generation: number; gate: Gate }
  | { status: "starting-cancel"; generation: number; gate: Gate }
  | { status: "recording"; generation: number; gate: Gate }
  | { status: "finishing"; generation: number; gate: Gate }
  | { status: "abandoning"; generation: number; gate: Gate };

export function captureListener(capture: Capture): PushListener {
  let generation = 0;
  let state: ListenState = { status: "idle" };
  let cancelTail: Promise<void> | undefined;

  function active(current: number): boolean {
    return (
      state.status !== "idle" &&
      state.status !== "released" &&
      state.generation === current
    );
  }

  function settleIdle(): void {
    state = { status: "idle" };
  }

  function invokeCancel(current: number): void {
    if (generation !== current) {
      return;
    }

    let pending: Promise<void>;

    try {
      pending = capture.cancel().then(
        () => undefined,
        () => undefined,
      );
    } catch {
      return;
    }

    cancelTail = pending;
    void pending.then(() => {
      if (cancelTail === pending) {
        cancelTail = undefined;
      }
    });
  }

  async function begin(current: number, gate: Gate): Promise<void> {
    try {
      await capture.begin();
    } catch (cause) {
      if (!active(current)) {
        return;
      }

      const cancel = state.status === "starting-cancel";

      settleIdle();

      if (cancel) {
        invokeCancel(current);

        return;
      }

      if (!gate.settled()) {
        gate.reject(listenError(cause));
      }

      return;
    }

    if (!active(current)) {
      return;
    }

    if (state.status === "starting-cancel") {
      settleIdle();
      invokeCancel(current);

      return;
    }

    if (state.status === "starting-release") {
      state = { status: "finishing", generation: current, gate };
      void finish(current, gate);

      return;
    }

    if (state.status !== "starting") {
      return;
    }

    state = { status: "recording", generation: current, gate };
  }

  async function finish(current: number, gate: Gate): Promise<void> {
    let failure: Error | undefined;
    let text = "";

    try {
      text = await capture.finish();
    } catch (cause) {
      failure = listenError(cause);
    }

    if (
      !active(current) ||
      (state.status !== "finishing" && state.status !== "abandoning")
    ) {
      return;
    }

    const abandoned = state.status === "abandoning";

    settleIdle();

    if (abandoned || gate.settled() || failure !== undefined) {
      if (!abandoned && failure !== undefined && !gate.settled()) {
        gate.reject(failure);
      }

      return;
    }

    gate.resolve({ text: text.trim() });
  }

  return {
    release() {
      if (state.status === "idle") {
        state = { status: "released" };

        return;
      }

      if (
        state.status === "released" ||
        state.status === "starting-release" ||
        state.status === "starting-cancel" ||
        state.status === "finishing" ||
        state.status === "abandoning"
      ) {
        return;
      }

      if (state.status === "starting") {
        state = {
          status: "starting-release",
          generation: state.generation,
          gate: state.gate,
        };

        return;
      }

      if (state.status === "recording") {
        const current = state.generation;
        const gate = state.gate;

        state = { status: "finishing", generation: current, gate };
        void finish(current, gate);
      }
    },
    cancel() {
      if (state.status === "idle" || state.status === "released") {
        state = { status: "idle" };

        return;
      }

      if (state.status === "starting" || state.status === "starting-release") {
        const gate = state.gate;

        state = {
          status: "starting-cancel",
          generation: state.generation,
          gate,
        };
        gate.reject(new Error("cancelled"));

        return;
      }

      if (state.status === "starting-cancel") {
        state.gate.reject(new Error("cancelled"));

        return;
      }

      if (state.status === "recording") {
        const current = state.generation;
        const gate = state.gate;

        gate.reject(new Error("cancelled"));
        settleIdle();
        invokeCancel(current);

        return;
      }

      if (state.status === "finishing") {
        const current = state.generation;
        const gate = state.gate;

        gate.reject(new Error("cancelled"));
        state = { status: "abandoning", generation: current, gate };
        invokeCancel(current);

        return;
      }

      state.gate.reject(new Error("cancelled"));
    },
    listen() {
      if (state.status !== "idle" && state.status !== "released") {
        return Promise.reject(new Error("already listening"));
      }

      const releaseRequested = state.status === "released";
      const tail = cancelTail;

      generation += 1;
      const current = generation;
      const gate = openGate();

      state = releaseRequested
        ? { status: "starting-release", generation: current, gate }
        : { status: "starting", generation: current, gate };

      if (tail === undefined) {
        void begin(current, gate);
      } else {
        void tail.then(() => {
          if (generation !== current || state.status === "idle") {
            return;
          }

          void begin(current, gate);
        });
      }

      return gate.promise;
    },
  };
}

function openGate(): Gate {
  let resolve: (heard: Heard) => void = () => {};
  let reject: (error: Error) => void = () => {};
  let settled = false;

  const promise = new Promise<Heard>((succeed, fail) => {
    resolve = (heard) => {
      if (settled) {
        return;
      }

      settled = true;
      succeed(heard);
    };

    reject = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      fail(error);
    };
  });

  return {
    promise,
    resolve,
    reject,
    settled: () => settled,
  };
}

function listenError(cause: unknown): Error {
  if (cause instanceof Error) {
    return cause;
  }

  if (isMessage(cause)) {
    return new Error(cause);
  }

  return new Error("could not listen");
}

function isMessage(cause: unknown): cause is string {
  return Object.prototype.toString.call(cause) === "[object String]";
}
