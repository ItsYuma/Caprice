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

export const talkHoldDelay = 200;

export const talkDragDistance = 8;

export function pointerMoved(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  const dx = x - startX;
  const dy = y - startY;

  return dx * dx + dy * dy > talkDragDistance * talkDragDistance;
}

export function dragInsteadOfTalk(phase: TalkPhase, moved: boolean): boolean {
  return moved && phase !== "listening";
}

export function holdToTalk(
  listener: PushListener,
  turn: () => Promise<void>,
  onPhase: (phase: TalkPhase) => void,
  later: (run: () => void) => () => void = afterTalkHold,
): TalkHold {
  let phase: TalkPhase = "idle";
  let armed = false;
  let cancelArm = () => {};

  const setPhase = (next: TalkPhase) => {
    phase = next;
    onPhase(phase);
  };

  const begin = () => {
    armed = false;

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
  };

  return {
    phase: () => phase,
    press() {
      if (phase !== "idle" || armed) {
        return;
      }

      armed = true;

      const cancel = later(begin);

      if (armed) {
        cancelArm = cancel;
      }
    },
    release() {
      if (armed) {
        armed = false;
        cancelArm();
        cancelArm = () => {};

        return;
      }

      if (phase !== "listening") {
        return;
      }

      setPhase("busy");
      listener.release();
    },
  };
}

function afterTalkHold(run: () => void): () => void {
  const timer = setTimeout(run, talkHoldDelay);

  return () => {
    clearTimeout(timer);
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

export type TalkTarget = {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

type PointerPress = Event & {
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  pointerId: number;
};

function pointerPress(event: Event): event is PointerPress {
  if (!("button" in event) || !("buttons" in event)) {
    return false;
  }

  if (!("clientX" in event) || !("clientY" in event)) {
    return false;
  }

  return "pointerId" in event;
}

function primaryDown(event: Event): event is PointerPress {
  return pointerPress(event) && event.button === 0;
}

function primaryDrag(event: Event): event is PointerPress {
  return pointerPress(event) && (event.buttons & 1) === 1;
}

export function bindTalkButton(
  button: TalkTarget,
  hold: TalkHold,
  drag: () => void,
): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let dragged = false;

  const down = (event: Event) => {
    if (!primaryDown(event)) {
      return;
    }

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
    dragged = false;
    hold.press();
  };

  const move = (event: Event) => {
    if (!primaryDrag(event) || !tracking || dragged) {
      return;
    }

    const moved = pointerMoved(startX, startY, event.clientX, event.clientY);

    if (!dragInsteadOfTalk(hold.phase(), moved)) {
      return;
    }

    dragged = true;

    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }

    hold.release();
    drag();
  };

  const release = () => {
    tracking = false;
    hold.release();
  };

  button.addEventListener("pointerdown", down);
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);

  return () => {
    button.removeEventListener("pointerdown", down);
    button.removeEventListener("pointermove", move);
    button.removeEventListener("pointerup", release);
    button.removeEventListener("pointercancel", release);
  };
}
