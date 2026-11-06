import type { Heard, Listener } from "./ports.ts";

export type PushListener = Listener & {
  release: () => void;
};

export type Capture = {
  begin: () => Promise<void>;
  finish: () => Promise<string>;
};

type OpenListen = {
  begun: boolean;
  finishing: boolean;
  finishNow: boolean;
  resolve: (heard: Heard) => void;
  reject: (error: Error) => void;
};

type ListenGate = {
  pending: Promise<Heard>;
  resolve: (heard: Heard) => void;
  reject: (error: Error) => void;
};

export function captureListener(capture: Capture): PushListener {
  let open: OpenListen | undefined;
  let releaseBeforeListen = false;

  function fail(current: OpenListen, error: Error): void {
    if (open === current) {
      open = undefined;
    }

    current.reject(error);
  }

  function settle(current: OpenListen): void {
    if (current.finishing) {
      return;
    }

    current.finishing = true;
    void finish(current);
  }

  async function finish(current: OpenListen): Promise<void> {
    try {
      const text = await capture.finish();

      if (open === current) {
        open = undefined;
      }

      current.resolve({ text: text.trim() });
    } catch (error) {
      if (isError(error) || isMessage(error)) {
        fail(current, heardFailure(error));

        return;
      }

      fail(current, new Error("could not listen"));
    }
  }

  async function run(current: OpenListen): Promise<void> {
    try {
      await capture.begin();
    } catch (error) {
      if (isError(error) || isMessage(error)) {
        fail(current, heardFailure(error));

        return;
      }

      fail(current, new Error("could not listen"));

      return;
    }

    if (open !== current) {
      return;
    }

    current.begun = true;

    if (current.finishNow) {
      settle(current);
    }
  }

  return {
    release() {
      if (open === undefined) {
        releaseBeforeListen = true;

        return;
      }

      if (open.finishing) {
        return;
      }

      if (!open.begun) {
        open.finishNow = true;

        return;
      }

      settle(open);
    },
    listen() {
      if (open !== undefined) {
        return Promise.reject(new Error("already listening"));
      }

      const finishNow = releaseBeforeListen;
      releaseBeforeListen = false;
      const gate = listenGate();

      const current: OpenListen = {
        begun: false,
        finishing: false,
        finishNow,
        resolve: gate.resolve,
        reject: gate.reject,
      };

      open = current;
      void run(current);

      return gate.pending;
    },
  };
}

function listenGate(): ListenGate {
  let resolve: (heard: Heard) => void = () => {};
  let reject: (error: Error) => void = () => {};

  const pending = new Promise<Heard>((succeed, fail) => {
    resolve = succeed;
    reject = fail;
  });

  return { pending, resolve, reject };
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isMessage(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function heardFailure(error: Error | string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(error);
}
