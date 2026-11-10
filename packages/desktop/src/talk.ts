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

export type TalkPhase = "idle" | "armed" | "listening" | "busy";

export type TalkHold = {
  press: () => void;
  pressNow: () => void;
  release: () => void;
  phase: () => TalkPhase;
};

export function talkChordLabel(): string {
  return talkChords.map((chord) => chord.label).join(" or ");
}

export function talkChordShortcuts(): string {
  return talkChords.map((chord) => chord.shortcut).join(" ");
}

export type TalkChord = "alt" | "ctrl";

export function talkChord(event: TalkKey): TalkChord | undefined {
  if (
    event.repeat ||
    event.metaKey ||
    event.shiftKey ||
    event.code !== "Space"
  ) {
    return undefined;
  }

  if (event.altKey && !event.ctrlKey) {
    return "alt";
  }

  if (event.ctrlKey && !event.altKey) {
    return "ctrl";
  }

  return undefined;
}

export function isTalkChord(event: TalkKey): boolean {
  return talkChord(event) !== undefined;
}

export function releasesChord(chord: TalkChord, event: TalkRelease): boolean {
  if (event.code === "Space") {
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

  if (chord === "alt") {
    return alt;
  }

  return control;
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

type HoldState =
  | { status: "idle" }
  | { status: "armed"; cancel: () => void }
  | { status: "listening" }
  | { status: "busy" };

export function holdToTalk(
  listener: PushListener,
  turn: () => Promise<void>,
  onPhase: (phase: TalkPhase) => void,
  later: (run: () => void) => () => void = afterTalkHold,
): TalkHold {
  let state: HoldState = { status: "idle" };

  const enter = (next: HoldState) => {
    state = next;
    onPhase(next.status);
  };

  const finishTurn = () => {
    if (state.status === "listening" || state.status === "busy") {
      enter({ status: "idle" });
    }
  };

  const begin = () => {
    if (state.status !== "armed") {
      return;
    }

    enter({ status: "listening" });

    let pending: Promise<void>;

    try {
      pending = turn();
    } catch {
      enter({ status: "idle" });

      return;
    }

    void pending.then(finishTurn, finishTurn);
  };

  return {
    phase: () => state.status,
    press() {
      if (state.status !== "idle") {
        return;
      }

      state = { status: "armed", cancel: () => {} };
      onPhase("armed");

      const cancel = later(begin);

      if (state.status === "armed") {
        state = { status: "armed", cancel };
      }
    },
    pressNow() {
      if (state.status === "listening" || state.status === "busy") {
        return;
      }

      if (state.status === "armed") {
        state.cancel();
        begin();

        return;
      }

      state = { status: "armed", cancel: () => {} };
      onPhase("armed");
      begin();
    },
    release() {
      if (state.status === "armed") {
        state.cancel();
        enter({ status: "idle" });

        return;
      }

      if (state.status !== "listening") {
        return;
      }

      enter({ status: "busy" });
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

export function bindTalk(hold: TalkHold, target: EventTarget): () => void {
  let chord: TalkChord | undefined;

  const down = (event: Event) => {
    if (!isKeyEvent(event)) {
      return;
    }

    const next = talkChord(event);

    if (next === undefined || chord !== undefined) {
      return;
    }

    event.preventDefault();
    chord = next;
    hold.press();
  };

  const up = (event: Event) => {
    if (!isKeyEvent(event) || chord === undefined) {
      return;
    }

    if (!releasesChord(chord, event)) {
      return;
    }

    chord = undefined;
    hold.release();
  };

  const blur = () => {
    chord = undefined;
    hold.release();
  };

  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);

  return () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
    target.removeEventListener("blur", blur);
  };
}

export function bindCancel(
  target: EventTarget,
  cancel: () => void,
): () => void {
  const down = (event: Event) => {
    if (!isKeyEvent(event) || event.repeat || event.code !== "Escape") {
      return;
    }

    cancel();
  };

  target.addEventListener("keydown", down);

  return () => {
    target.removeEventListener("keydown", down);
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

function isKeyEvent(event: Event): event is Event & TalkKey & TalkRelease {
  if (!("code" in event) || !("key" in event) || !("repeat" in event)) {
    return false;
  }

  return (
    "altKey" in event &&
    "ctrlKey" in event &&
    "metaKey" in event &&
    "shiftKey" in event
  );
}

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
