import { getCurrentWindow } from "@tauri-apps/api/window";

import { Presence } from "./Presence.tsx";
import type { TalkHold, TalkPhase } from "./talk.ts";

export type CapricePageProps = {
  problem: string;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  hint: string;
  credit: string;
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
        />
      </div>
    </main>
  );
}

function closeWindow(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  void getCurrentWindow().close();
}
