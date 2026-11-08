import type { PushListener } from "@caprice/voice";

export const talkChords = [
  {
    code: "Space",
    altKey: true,
    ctrlKey: false,
    label: "Alt+Space",
    shortcut: "Alt+Space",
  },
  {
    code: "Space",
    altKey: false,
    ctrlKey: true,
    label: "Ctrl+Space",
    shortcut: "Control+Space",
  },
] as const;

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
  return talkChords.map((chord) => chord.label).join(" or ");
}

export function talkChordShortcuts(): string {
  return talkChords.map((chord) => chord.shortcut).join(" ");
}

export function isTalkChord(event: TalkKey): boolean {
  return talkChords.some(
    (chord) =>
      event.code === chord.code &&
      event.altKey === chord.altKey &&
      event.ctrlKey === chord.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.repeat,
  );
}

export function isTalkRelease(event: TalkRelease): boolean {
  if (talkChords.some((chord) => event.code === chord.code)) {
    return true;
  }

  const alt =
    event.key === "Alt" ||
    event.code === "AltLeft" ||
    event.code === "AltRight";

  const control =
    event.key === "Control" ||
    event.code === "ControlLeft" ||
    event.code === "ControlRight";

  return talkChords.some(
    (chord) => (chord.altKey && alt) || (chord.ctrlKey && control),
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
