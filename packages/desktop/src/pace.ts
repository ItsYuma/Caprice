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

export function formatPace(ms: number): string {
  const safe = ms < 0 ? 0 : ms;

  if (safe < 1000) {
    return `${Math.round(safe)}ms`;
  }

  const seconds = safe / 1000;

  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.round(seconds)}s`;
}

export function paceText(marks: readonly PaceMark[]): string {
  return marks.map((mark) => `${mark.name} ${formatPace(mark.ms)}`).join(" · ");
}

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
