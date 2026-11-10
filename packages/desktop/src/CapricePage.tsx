import { getCurrentWindow } from "@tauri-apps/api/window";

import type { PaceName } from "./pace.ts";
import { Presence } from "./Presence.tsx";
import type { TalkHold, TalkPhase } from "./talk.ts";

export type CapricePageProps = {
  problem: string;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  hint: string;
  credit: string;
  step: PaceName | "";
};

export function CapricePage(props: CapricePageProps) {
  return (
    <main>
      <div className="plate" data-tauri-drag-region="" />
      <div className="stack">
        <button
          type="button"
          id="close"
          aria-label="Close"
          onClick={closeWindow}
        >
          ×
        </button>
        <Presence
          phase={props.talkPhase}
          hold={props.hold}
          hint={props.hint}
          problem={props.problem}
          credit={props.credit}
          step={props.step}
          drag={dragWindow}
        />
      </div>
    </main>
  );
}

function closeWindow(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  void getCurrentWindow()
    .close()
    .then(
      () => undefined,
      () => undefined,
    );
}

function dragWindow(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  void getCurrentWindow()
    .startDragging()
    .then(
      () => undefined,
      () => undefined,
    );
}
