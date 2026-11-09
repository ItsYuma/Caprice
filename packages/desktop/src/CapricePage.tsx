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
  pace: string;
  step: PaceName | "";
  stepAt: number;
  ask: string;
  onAllow: () => void;
  onRefuse: () => void;
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
          pace={props.pace}
          step={props.step}
          stepAt={props.stepAt}
        />
        {props.ask.length > 0 ? (
          <div className="ask" role="group" aria-label="Confirm tool">
            <p id="ask">{props.ask}</p>
            <button type="button" id="allow" onClick={props.onAllow}>
              Allow
            </button>
            <button type="button" id="refuse" onClick={props.onRefuse}>
              Refuse
            </button>
          </div>
        ) : null}
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
