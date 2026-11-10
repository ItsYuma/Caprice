import type { PushListener } from "@caprice/voice";

export type PaceName = "hear" | "reply" | "voice";

export type PaceMark = {
  name: PaceName;
  ms: number;
};

export type PaceNote = {
  begin: (name: PaceName) => void;
  end: (name: PaceName, ms: number) => void;
};

export type PaceSlot = {
  current: PaceNote;
};

export function paceListener(
  listener: PushListener,
  note: PaceSlot,
  now: () => number,
): PushListener {
  let open = false;
  let releasedAt = 0;

  return {
    cancel() {
      listener.cancel();
    },
    release() {
      if (open) {
        try {
          releasedAt = now();
          note.current.begin("hear");
        } catch {
          releasedAt = 0;
        }
      }

      listener.release();
    },
    async listen() {
      open = true;

      try {
        return await listener.listen();
      } finally {
        open = false;

        if (releasedAt > 0) {
          note.current.end("hear", Math.max(0, now() - releasedAt));
          releasedAt = 0;
        }
      }
    },
  };
}
