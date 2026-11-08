import type { PushListener } from "@caprice/voice";

export const talkChord = {
  code: "Space",
  altKey: true,
} as const;

export type TalkKey = {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};

export type TalkRelease = {
  code: string;
  key: string;
};

export type TalkPhase = "idle" | "listening" | "busy";

export type TalkHold = {
  press: () => void;
  release: () => void;
  phase: () => TalkPhase;
};

export function talkChordLabel(): string {
  const key = talkChord.code === "Space" ? "Space" : talkChord.code;

  if (talkChord.altKey) {
    return `Alt+${key}`;
  }

  return key;
}

export function isTalkChord(event: TalkKey): boolean {
  return (
    event.code === talkChord.code &&
    event.altKey === talkChord.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.repeat
  );
}

export function isTalkRelease(event: TalkRelease): boolean {
  if (event.code === talkChord.code) {
    return true;
  }

  if (!talkChord.altKey) {
    return false;
  }

  return (
    event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight"
  );
}

export function holdToTalk(
  listener: PushListener,
  turn: () => Promise<void>,
  onPhase: (phase: TalkPhase) => void,
): TalkHold {
  let phase: TalkPhase = "idle";

  const setPhase = (next: TalkPhase) => {
    phase = next;
    onPhase(phase);
  };

  return {
    phase: () => phase,
    press() {
      if (phase !== "idle") {
        return;
      }

      setPhase("listening");

      let pending: Promise<void>;

      try {
        pending = turn();
      } catch {
        setPhase("idle");

        return;
      }

      void pending.finally(() => {
        setPhase("idle");
      });
    },
    release() {
      if (phase !== "listening") {
        return;
      }

      setPhase("busy");
      listener.release();
    },
  };
}

export function bindTalk(hold: TalkHold): () => void {
  const down = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !isTalkChord(event)) {
      return;
    }

    event.preventDefault();
    hold.press();
  };

  const up = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !isTalkRelease(event)) {
      return;
    }

    hold.release();
  };

  const blur = () => {
    hold.release();
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);

  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

export function bindTalkButton(
  button: HTMLButtonElement,
  hold: TalkHold,
): () => void {
  const down = (event: Event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0) {
      return;
    }

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    hold.press();
  };

  const release = () => {
    hold.release();
  };

  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);

  return () => {
    button.removeEventListener("pointerdown", down);
    button.removeEventListener("pointerup", release);
    button.removeEventListener("pointercancel", release);
  };
}
